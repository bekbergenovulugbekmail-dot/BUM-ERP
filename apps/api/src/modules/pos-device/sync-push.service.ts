/**
 * Qurilmadan serverga amallar (push) — offline navbat.
 *
 *  - Har amal `opId` bilan: bir marta bajariladi, natija (yoki rad etish sababi) `pos_sync_operations` da saqlanadi;
 *    takror kelsa o'sha javob `duplicate: true` bilan qaytadi. Parallel takroriy so'rov unikal indeks bilan to'siladi.
 *  - Amallar kelgan tartibda, har biri o'z tranzaksiyasida. Biznes xatosi (AppError) yoki bazadagi cheklov buzilishi —
 *    amal rad etiladi va saqlanadi, keyingilari davom etadi; boshqa (infratuzilma) xato — butun so'rov 500, qurilma
 *    keyinroq qayta yuboradi (bajarilganlari takrorlanmaydi).
 *  - Amal vaqti qurilmadan (offline) — kelajakda 5 daqiqadan, o'tmishda 30 kundan uzoq bo'lmasin.
 *  - Kassir har amalda qayta tekshiriladi (`cashierTenant`).
 *  - Chek (`sale.complete`) jismonan bo'lgan: zaxira yetmasa, narx/kurs o'zgargan, balans yetmasa va h.k. — rad
 *    etilmaydi, `pos_sync_conflicts` ga yoziladi (rahbar ko'rib chiqadi).
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, badRequest, conflict, notFound } from "@bum/shared";
import { db } from "../../db/client.js";
import { posSyncConflicts, posSyncOperations, type PosSyncError } from "../../db/schema/pos.js";
import { purchaseOrderItems, purchaseOrders, purchaseReturns, suppliers } from "../../db/schema/purchase.js";
import { completeDirectPurchase } from "../purchase/direct-purchase.service.js";
import { recordSupplierPayment } from "../purchase/payments.service.js";
import { returnPurchaseItems } from "../purchase/returns.service.js";
import { createSupplier } from "../purchase/suppliers.service.js";
import { customers, posCashMovements, posShifts, salesOrderItems, salesOrders, salesReturns } from "../../db/schema/sales.js";
import { withTransaction, type Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { decimalSchema, moneySchema, percentSchema, priceSchema } from "../../shared/decimal.js";
import { requirePermission } from "../company/tenant.js";
import { closeShift, completeSale, openShift, posCustomerPayment, type SaleConflict } from "../sales/pos.service.js";
import { CASH_MOVEMENT_KINDS, posCashMovement } from "../sales/pos-cash.service.js";
import { createCustomer } from "../sales/customers.service.js";
import { REFUND_METHODS, returnSaleItems } from "../sales/returns.service.js";
import { cashierTenant, type DeviceContext } from "./device-auth.js";

export const MAX_OPS_PER_PUSH = 100;
const MAX_FUTURE_MS = 5 * 60_000;
const MAX_AGE_MS = 30 * 86_400_000;

const clientTime = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const currencyCode = z.string().regex(/^[A-Z]{3}$/, "Valyuta kodi 3 harf");
const foreignCash = z
  .array(z.strictObject({ currency: currencyCode, amount: moneySchema }))
  .max(10)
  .optional();
const notes = z.string().trim().max(500).nullable().optional();
const positiveQty = decimalSchema({ scale: 4, positive: true });
/** Qurilma hujjat raqami: `K01-000123` (chek), `K01-Q000004` (qaytarish). */
const deviceNumber = z.string().regex(/^[A-Z0-9]{1,8}-[A-Z]?\d{1,12}$/, "Hujjat raqami noto'g'ri");
const common = { opId: z.uuid(), cashierId: z.uuid(), createdAt: clientTime };

export const syncOperationSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...common,
    type: z.literal("shift.open"),
    payload: z.strictObject({ shiftId: z.uuid(), openingCash: moneySchema, openingForeignCash: foreignCash, notes }),
  }),
  z.strictObject({
    ...common,
    type: z.literal("shift.close"),
    payload: z.strictObject({ shiftId: z.uuid(), closingCash: moneySchema, closingForeignCash: foreignCash, notes }),
  }),
  z.strictObject({
    ...common,
    type: z.literal("sale.complete"),
    payload: z.strictObject({
      saleId: z.uuid(),
      shiftId: z.uuid(),
      number: deviceNumber,
      customerId: z.uuid().nullable().optional(),
      items: z
        .array(
          z.strictObject({
            id: z.uuid(),
            productId: z.uuid(),
            unitId: z.uuid(),
            quantity: positiveQty,
            unitPrice: priceSchema,
            discountPercent: percentSchema.optional(),
          }),
        )
        .min(1)
        .max(500)
        .refine((items) => new Set(items.map((item) => item.id)).size === items.length, "Chek qatori identifikatori takrorlangan"),
      paymentMethod: z.enum(["cash", "card", "bank", "transfer"]),
      amountPaid: moneySchema,
      cashbackAmount: moneySchema.optional(),
      balanceAmount: moneySchema.optional(),
      changeToBalance: z.boolean().optional(),
      saleCurrencies: z.array(currencyCode).min(1).max(6).optional(),
      currencyPayments: z
        .array(z.strictObject({ currency: currencyCode, amount: moneySchema, method: z.enum(["cash", "card"]) }))
        .max(6)
        .optional(),
      rates: z.record(currencyCode, decimalSchema({ scale: 4, positive: true })).optional(),
      notes,
    }),
  }),
  z.strictObject({
    ...common,
    type: z.literal("sale.return"),
    payload: z.strictObject({
      returnId: z.uuid(),
      orderId: z.uuid(),
      shiftId: z.uuid(),
      number: deviceNumber,
      items: z
        .array(z.strictObject({ orderItemId: z.uuid(), quantity: positiveQty }))
        .min(1)
        .max(500)
        .refine((items) => new Set(items.map((item) => item.orderItemId)).size === items.length, "Mahsulot qatori takrorlangan"),
      refundMethod: z.enum(REFUND_METHODS),
      reason: notes,
    }),
  }),
  z.strictObject({
    ...common,
    type: z.literal("customer.create"),
    payload: z.strictObject({
      customerId: z.uuid(),
      name: z.string().trim().min(1).max(200),
      phone: z.string().trim().max(20).nullable().optional(),
    }),
  }),
  z.strictObject({
    ...common,
    type: z.literal("cash.movement"),
    payload: z.strictObject({
      movementId: z.uuid(),
      shiftId: z.uuid(),
      kind: z.enum(CASH_MOVEMENT_KINDS),
      amount: decimalSchema({ scale: 2, positive: true }),
      category: z.string().trim().max(64).nullable().optional(),
      notes,
    }),
  }),
  z.strictObject({
    ...common,
    type: z.literal("customer.payment"),
    payload: z.strictObject({
      paymentId: z.uuid(),
      shiftId: z.uuid(),
      customerId: z.uuid(),
      purpose: z.enum(["deposit", "debt"]),
      amount: decimalSchema({ scale: 2, positive: true }),
      method: z.enum(["cash", "card"]),
      notes,
    }),
  }),
  z.strictObject({
    ...common,
    type: z.literal("supplier.create"),
    payload: z.strictObject({
      supplierId: z.uuid(),
      name: z.string().trim().min(1).max(200),
      phone: z.string().trim().max(20).nullable().optional(),
    }),
  }),
  z.strictObject({
    ...common,
    type: z.literal("purchase.complete"),
    payload: z.strictObject({
      purchaseId: z.uuid(),
      number: deviceNumber,
      supplierId: z.uuid(),
      items: z
        .array(
          z.strictObject({
            id: z.uuid(),
            productId: z.uuid(),
            unitId: z.uuid(),
            quantity: positiveQty,
            unitPrice: priceSchema,
            taxRate: percentSchema.optional(),
            discountPercent: percentSchema.optional(),
            currency: currencyCode.nullable().optional(),
            salesPrice: priceSchema.nullable().optional(),
            batchNumber: z.string().trim().max(64).nullable().optional(),
            expiryDate: z.iso.date().nullable().optional(),
          }),
        )
        .min(1)
        .max(500)
        .refine((items) => new Set(items.map((item) => item.id)).size === items.length, "Xarid qatori identifikatori takrorlangan"),
      rates: z.record(currencyCode, decimalSchema({ scale: 4, positive: true })).optional(),
      notes,
      payment: z
        .strictObject({ shiftId: z.uuid(), amount: decimalSchema({ scale: 2, positive: true }), method: z.enum(["cash", "card"]) })
        .nullable()
        .optional(),
    }),
  }),
  z.strictObject({
    ...common,
    type: z.literal("purchase.return"),
    payload: z.strictObject({
      returnId: z.uuid(),
      number: deviceNumber,
      orderId: z.uuid(),
      items: z
        .array(z.strictObject({ orderItemId: z.uuid(), quantity: positiveQty }))
        .min(1)
        .max(500)
        .refine((items) => new Set(items.map((item) => item.orderItemId)).size === items.length, "Mahsulot qatori takrorlangan"),
      reason: notes,
      refund: z
        .strictObject({ shiftId: z.uuid(), amount: decimalSchema({ scale: 2, positive: true }), method: z.enum(["cash", "card"]) })
        .nullable()
        .optional(),
    }),
  }),
  z.strictObject({
    ...common,
    type: z.literal("supplier.payment"),
    payload: z.strictObject({
      paymentId: z.uuid(),
      shiftId: z.uuid(),
      supplierId: z.uuid(),
      amount: decimalSchema({ scale: 2, positive: true }),
      method: z.enum(["cash", "card"]),
      orderId: z.uuid().nullable().optional(),
      notes,
    }),
  }),
]);
export type SyncOperation = z.infer<typeof syncOperationSchema>;

export type PushResult = {
  opId: string | null;
  status: "applied" | "rejected" | "invalid";
  duplicate?: boolean;
  result?: Record<string, unknown> | null;
  error?: PosSyncError | null;
};

function assertClientTime(at: Date) {
  const now = Date.now();
  if (at.getTime() > now + MAX_FUTURE_MS) throw badRequest("Qurilma vaqti noto'g'ri — soatni tekshiring", { reason: "clock_future" });
  if (at.getTime() < now - MAX_AGE_MS) throw badRequest("Amal 30 kundan eski — sinxron qilinmaydi", { reason: "too_old" });
}

async function deviceShift(tx: Tx, context: DeviceContext, shiftId: string) {
  const [shift] = await tx
    .select({ deviceId: posShifts.deviceId })
    .from(posShifts)
    .where(and(eq(posShifts.id, shiftId), eq(posShifts.companyId, context.company.id)))
    .limit(1);
  if (!shift || shift.deviceId !== context.device.id) throw notFound("Smena topilmadi");
}

function assertDeviceNumber(context: DeviceContext, number: string) {
  if (!number.startsWith(`${context.device.code}-`)) throw badRequest(`Hujjat raqami qurilma kodi (${context.device.code}) bilan boshlanishi kerak`);
}

async function recordConflicts(
  tx: Tx,
  context: DeviceContext,
  op: SyncOperation,
  reference: { type: string; id: string },
  conflicts: SaleConflict[],
) {
  if (conflicts.length === 0) return;
  await tx.insert(posSyncConflicts).values(
    conflicts.map((item) => ({
      companyId: context.company.id,
      deviceId: context.device.id,
      opId: op.opId,
      kind: item.kind,
      referenceType: reference.type,
      referenceId: reference.id,
      details: item.details,
    })),
  );
}

async function applyOperation(tx: Tx, context: DeviceContext, op: SyncOperation, meta: RequestMeta): Promise<Record<string, unknown>> {
  assertClientTime(op.createdAt);
  const tenant = await cashierTenant(tx, context, op.cashierId);

  switch (op.type) {
    case "shift.open": {
      const [existing] = await tx.select({ id: posShifts.id }).from(posShifts).where(eq(posShifts.id, op.payload.shiftId)).limit(1);
      if (existing) throw conflict("Bu smena identifikatori band");
      const shift = await openShift(
        tx,
        tenant,
        {
          warehouseId: context.device.warehouseId,
          openingCash: op.payload.openingCash,
          openingForeignCash: op.payload.openingForeignCash,
          notes: op.payload.notes ?? null,
          id: op.payload.shiftId,
          openedAt: op.createdAt,
          deviceId: context.device.id,
        },
        meta,
      );
      return { shiftId: shift.id };
    }
    case "shift.close": {
      await deviceShift(tx, context, op.payload.shiftId);
      const closed = await closeShift(
        tx,
        tenant,
        op.payload.shiftId,
        {
          closingCash: op.payload.closingCash,
          closingForeignCash: op.payload.closingForeignCash,
          notes: op.payload.notes ?? null,
          closedAt: op.createdAt,
          deviceId: context.device.id,
        },
        meta,
      );
      return { shiftId: op.payload.shiftId, expectedCash: closed.expectedCash, difference: closed.difference, foreignCash: closed.foreignCash };
    }
    case "sale.complete": {
      const payload = op.payload;
      assertDeviceNumber(context, payload.number);
      await deviceShift(tx, context, payload.shiftId);
      const [taken] = await tx
        .select({ id: salesOrders.id })
        .from(salesOrders)
        .where(or(eq(salesOrders.id, payload.saleId), and(eq(salesOrders.companyId, context.company.id), eq(salesOrders.number, payload.number))))
        .limit(1);
      if (taken) throw conflict("Chek identifikatori yoki raqami band");
      const [itemTaken] = await tx
        .select({ id: salesOrderItems.id })
        .from(salesOrderItems)
        .where(inArray(salesOrderItems.id, payload.items.map((item) => item.id)))
        .limit(1);
      if (itemTaken) throw conflict("Chek qatori identifikatori band");

      const sale = await completeSale(
        tx,
        tenant,
        {
          shiftId: payload.shiftId,
          customerId: payload.customerId ?? null,
          items: payload.items.map(({ id: _id, ...item }) => item),
          paymentMethod: payload.paymentMethod,
          amountPaid: payload.amountPaid,
          cashbackAmount: payload.cashbackAmount,
          balanceAmount: payload.balanceAmount,
          changeToBalance: payload.changeToBalance,
          saleCurrencies: payload.saleCurrencies,
          currencyPayments: payload.currencyPayments,
          notes: payload.notes ?? null,
          offline: {
            id: payload.saleId,
            number: payload.number,
            soldAt: op.createdAt,
            deviceId: context.device.id,
            itemIds: payload.items.map((item) => item.id),
            rates: payload.rates,
          },
        },
        meta,
      );
      await recordConflicts(tx, context, op, { type: "sales_order", id: payload.saleId }, sale.conflicts);
      return {
        orderId: sale.order.id,
        number: sale.order.number,
        totalAmount: sale.order.totalAmount,
        paid: sale.paid,
        change: sale.change,
        debt: sale.debt,
        balanceUsed: sale.balanceUsed,
        changeToBalance: sale.changeToBalance,
        cashbackUsed: sale.cashbackUsed,
        cashbackEarned: sale.cashbackEarned,
        customer: sale.customer,
        conflicts: sale.conflicts.map((item) => item.kind),
      };
    }
    case "sale.return": {
      const payload = op.payload;
      assertDeviceNumber(context, payload.number);
      await requirePermission(tx, tenant, "sales.refund");
      await deviceShift(tx, context, payload.shiftId);
      const [taken] = await tx
        .select({ id: salesReturns.id })
        .from(salesReturns)
        .where(
          or(eq(salesReturns.id, payload.returnId), and(eq(salesReturns.companyId, context.company.id), eq(salesReturns.number, payload.number))),
        )
        .limit(1);
      if (taken) throw conflict("Qaytarish identifikatori yoki raqami band");
      const result = await returnSaleItems(
        tx,
        tenant,
        payload.orderId,
        {
          items: payload.items,
          refundMethod: payload.refundMethod,
          reason: payload.reason ?? null,
          shiftId: payload.shiftId,
          offline: { id: payload.returnId, number: payload.number, returnedAt: op.createdAt, deviceId: context.device.id },
        },
        meta,
      );
      return { ...result.return, returnId: result.return.id, orderId: payload.orderId, orderStatus: result.order.status };
    }
    case "customer.create": {
      const payload = op.payload;
      const [taken] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, payload.customerId)).limit(1);
      if (taken) throw conflict("Mijoz identifikatori band");
      // Takroriy telefon offline'da aniqlanmaydi — mijoz baribir yaratiladi (cheklar unga bog'langan), rahbar birlashtiradi
      const found: SaleConflict[] = [];
      const digits = payload.phone?.replace(/\D/g, "") ?? "";
      if (digits.length >= 9) {
        const [existing] = await tx
          .select({ id: customers.id, name: customers.name })
          .from(customers)
          .where(
            and(
              eq(customers.companyId, context.company.id),
              sql`right(regexp_replace(coalesce(${customers.phone}, ''), '[^0-9]', '', 'g'), 9) = ${digits.slice(-9)}`,
            ),
          )
          .limit(1);
        if (existing) found.push({ kind: "customer_duplicate_phone", details: { existingId: existing.id, existingName: existing.name } });
      }
      const customer = await createCustomer(tx, tenant, { id: payload.customerId, name: payload.name, phone: payload.phone ?? null }, meta);
      await recordConflicts(tx, context, op, { type: "customer", id: customer.id }, found);
      return { customerId: customer.id, code: customer.code, conflicts: found.map((item) => item.kind) };
    }
    case "cash.movement": {
      const payload = op.payload;
      await deviceShift(tx, context, payload.shiftId);
      const [taken] = await tx.select({ id: posCashMovements.id }).from(posCashMovements).where(eq(posCashMovements.id, payload.movementId)).limit(1);
      if (taken) throw conflict("Kassa harakati identifikatori band");
      const result = await posCashMovement(
        tx,
        tenant,
        {
          shiftId: payload.shiftId,
          kind: payload.kind,
          amount: payload.amount,
          category: payload.category ?? null,
          notes: payload.notes ?? null,
          offline: { id: payload.movementId, occurredAt: op.createdAt, deviceId: context.device.id },
        },
        meta,
      );
      await recordConflicts(tx, context, op, { type: "pos_cash_movement", id: payload.movementId }, result.conflicts);
      return {
        movementId: result.movement.id,
        kind: result.movement.kind,
        amount: result.movement.amount,
        expenseId: result.movement.expenseId,
        expectedCash: result.shift.expectedCash,
        conflicts: result.conflicts.map((item) => item.kind),
      };
    }
    case "customer.payment": {
      const payload = op.payload;
      await deviceShift(tx, context, payload.shiftId);
      const result = await posCustomerPayment(
        tx,
        tenant,
        {
          shiftId: payload.shiftId,
          customerId: payload.customerId,
          purpose: payload.purpose,
          amount: payload.amount,
          method: payload.method,
          notes: payload.notes ?? null,
          offline: { occurredAt: op.createdAt, deviceId: context.device.id },
        },
        meta,
      );
      await recordConflicts(tx, context, op, { type: "customer", id: payload.customerId }, result.conflicts);
      return { paymentId: payload.paymentId, customer: result.customer, conflicts: result.conflicts.map((item) => item.kind) };
    }
    case "supplier.create": {
      const payload = op.payload;
      await requirePermission(tx, tenant, "purchase.create");
      const [taken] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, payload.supplierId)).limit(1);
      if (taken) throw conflict("Ta'minotchi identifikatori band");
      const supplier = await createSupplier(tx, tenant, { id: payload.supplierId, name: payload.name, phone: payload.phone ?? null }, meta);
      return { supplierId: supplier.id, code: supplier.code };
    }
    case "purchase.complete": {
      const payload = op.payload;
      await requirePermission(tx, tenant, "purchase.create");
      await requirePermission(tx, tenant, "warehouse.receive");
      if (payload.payment) {
        await requirePermission(tx, tenant, "purchase.approve");
        await deviceShift(tx, context, payload.payment.shiftId);
      }
      assertDeviceNumber(context, payload.number);
      const [taken] = await tx
        .select({ id: purchaseOrders.id })
        .from(purchaseOrders)
        .where(
          or(eq(purchaseOrders.id, payload.purchaseId), and(eq(purchaseOrders.companyId, context.company.id), eq(purchaseOrders.number, payload.number))),
        )
        .limit(1);
      if (taken) throw conflict("Xarid identifikatori yoki raqami band");
      const [itemTaken] = await tx
        .select({ id: purchaseOrderItems.id })
        .from(purchaseOrderItems)
        .where(inArray(purchaseOrderItems.id, payload.items.map((item) => item.id)))
        .limit(1);
      if (itemTaken) throw conflict("Xarid qatori identifikatori band");
      const result = await completeDirectPurchase(
        tx,
        tenant,
        {
          supplierId: payload.supplierId,
          warehouseId: context.device.warehouseId,
          notes: payload.notes ?? null,
          items: payload.items.map(({ quantity, ...item }) => ({ ...item, orderedQty: quantity })),
          payment: payload.payment ?? null,
          offline: { id: payload.purchaseId, number: payload.number, occurredAt: op.createdAt, deviceId: context.device.id, rates: payload.rates },
        },
        meta,
      );
      return { ...result, conflicts: [] };
    }
    case "purchase.return": {
      const payload = op.payload;
      await requirePermission(tx, tenant, "purchase.return");
      assertDeviceNumber(context, payload.number);
      if (payload.refund) await deviceShift(tx, context, payload.refund.shiftId);
      const [taken] = await tx
        .select({ id: purchaseReturns.id })
        .from(purchaseReturns)
        .where(
          or(eq(purchaseReturns.id, payload.returnId), and(eq(purchaseReturns.companyId, context.company.id), eq(purchaseReturns.number, payload.number))),
        )
        .limit(1);
      if (taken) throw conflict("Qaytarish identifikatori yoki raqami band");
      const result = await returnPurchaseItems(
        tx,
        tenant,
        payload.orderId,
        {
          items: payload.items,
          reason: payload.reason ?? null,
          refund: payload.refund ? { amount: payload.refund.amount, method: payload.refund.method } : null,
          offline: { id: payload.returnId, number: payload.number, occurredAt: op.createdAt, deviceId: context.device.id },
        },
        meta,
      );
      if (payload.refund?.method === "cash") {
        await posCashMovement(
          tx,
          tenant,
          {
            shiftId: payload.refund.shiftId,
            kind: "supplier_refund",
            amount: payload.refund.amount,
            notes: payload.number,
            reference: { type: "purchase_return", id: payload.returnId },
            offline: { id: randomUUID(), occurredAt: op.createdAt, deviceId: context.device.id },
          },
          meta,
        );
      }
      await recordConflicts(tx, context, op, { type: "purchase_return", id: payload.returnId }, result.conflicts);
      return { ...result.return, returnId: result.return.id, conflicts: result.conflicts.map((item) => item.kind) };
    }
    case "supplier.payment": {
      const payload = op.payload;
      await requirePermission(tx, tenant, "purchase.approve");
      await deviceShift(tx, context, payload.shiftId);
      const date = op.createdAt.toISOString().slice(0, 10);
      const paid = await recordSupplierPayment(
        tx,
        tenant,
        {
          supplierId: payload.supplierId,
          orderId: payload.orderId ?? null,
          amount: payload.amount,
          method: payload.method,
          paymentDate: date,
          notes: payload.notes ?? null,
          offline: true,
        },
        meta,
      );
      if (payload.method === "cash") {
        await posCashMovement(
          tx,
          tenant,
          {
            shiftId: payload.shiftId,
            kind: "supplier_payment",
            amount: payload.amount,
            notes: payload.notes ?? null,
            reference: { type: "supplier_payment", id: paid.payment.id },
            offline: { id: payload.paymentId, occurredAt: op.createdAt, deviceId: context.device.id },
          },
          meta,
        );
      }
      const found: SaleConflict[] = paid.overpaid ? [{ kind: "supplier_overpaid", details: { supplierId: payload.supplierId, advance: paid.overpaid } }] : [];
      await recordConflicts(tx, context, op, { type: "supplier_payment", id: paid.payment.id }, found);
      return { paymentId: paid.payment.id, advance: paid.overpaid, conflicts: found.map((item) => item.kind) };
    }
  }
}

async function storedOperation(deviceId: string, opId: string): Promise<PushResult | null> {
  const [row] = await db
    .select({ status: posSyncOperations.status, result: posSyncOperations.result, error: posSyncOperations.error })
    .from(posSyncOperations)
    .where(and(eq(posSyncOperations.deviceId, deviceId), eq(posSyncOperations.opId, opId)))
    .limit(1);
  return row ? { opId, status: row.status, duplicate: true, result: row.result, error: row.error } : null;
}

const errorOf = (error: AppError): PosSyncError => ({
  code: error.code,
  message: error.message,
  ...(error.details === undefined ? {} : { details: error.details }),
});

/** PostgreSQL cheklov buzilishi (23xxx) — amal tarkibi bilan bog'liq, qayta yuborish yordam bermaydi. */
function constraintError(error: unknown): PosSyncError | null {
  for (let current: unknown = error, depth = 0; current && depth < 3; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^23\d{3}$/.test(code)) {
      const constraint = (current as { constraint?: unknown }).constraint;
      return {
        code: "CONFLICT",
        message: "Ma'lumotlar bazasi cheklovi buzildi",
        details: { sqlState: code, ...(typeof constraint === "string" ? { constraint } : {}) },
      };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

export async function pushOperations(context: DeviceContext, rawOps: unknown[], meta: RequestMeta): Promise<PushResult[]> {
  const results: PushResult[] = [];
  for (const raw of rawOps) {
    const head = z.object({ opId: z.uuid(), type: z.string().max(40) }).safeParse(raw);
    if (!head.success) {
      results.push({ opId: null, status: "invalid", error: { code: "BAD_REQUEST", message: "Amal identifikatori (opId) yoki turi noto'g'ri" } });
      continue;
    }
    const { opId, type } = head.data;
    const stored = await storedOperation(context.device.id, opId);
    if (stored) {
      results.push(stored);
      continue;
    }

    const parsed = syncOperationSchema.safeParse(raw);
    const record = (status: "applied" | "rejected", extra: { result?: Record<string, unknown>; error?: PosSyncError }) => ({
      companyId: context.company.id,
      deviceId: context.device.id,
      opId,
      type,
      status,
      cashierId: parsed.success ? parsed.data.cashierId : null,
      clientCreatedAt: parsed.success ? parsed.data.createdAt : null,
      ...extra,
    });

    if (!parsed.success) {
      const error: PosSyncError = { code: "BAD_REQUEST", message: "Amal tarkibi noto'g'ri", details: z.flattenError(parsed.error).fieldErrors };
      await db.insert(posSyncOperations).values(record("rejected", { error })).onConflictDoNothing();
      results.push((await storedOperation(context.device.id, opId)) ?? { opId, status: "rejected", error });
      continue;
    }

    try {
      const applied = await withTransaction(async (tx) => {
        const [claimed] = await tx
          .insert(posSyncOperations)
          .values(record("applied", {}))
          .onConflictDoNothing()
          .returning({ id: posSyncOperations.id });
        if (!claimed) return null;
        const result = await applyOperation(tx, context, parsed.data, meta);
        await tx.update(posSyncOperations).set({ result }).where(eq(posSyncOperations.id, claimed.id));
        return result;
      });
      results.push(applied === null ? ((await storedOperation(context.device.id, opId)) ?? { opId, status: "applied" }) : { opId, status: "applied", result: applied });
    } catch (err) {
      const error = err instanceof AppError ? errorOf(err) : constraintError(err);
      if (!error) throw err;
      await db.insert(posSyncOperations).values(record("rejected", { error })).onConflictDoNothing();
      results.push({ opId, status: "rejected", error });
    }
  }
  return results;
}
