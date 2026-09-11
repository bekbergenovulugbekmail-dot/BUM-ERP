/**
 * POS: kassa smenalari va chek (convex/sales/pos.ts).
 *
 * Chek bitta tranzaksiyada: buyurtma (`isPos`), zaxira chiqimi va sotuv jurnali
 * (`dispatchOrder`), to'lov (`recordCustomerPayment` — kassa/bank + jurnal), smena yig'indilari.
 *
 * Convex'dan farqlar:
 *  - chek ombori mijozdan kelardi — smenadagidan boshqa ombordan sotish mumkin edi; endi smena ombori
 *  - zaxira yetmasa jimgina 0 ga tushirilardi, qoldig'i yo'q mahsulot ham "sotilardi" — endi xato
 *  - narx va chegirma mijozdan kelardi — kassir istalgan narxda sotardi; endi prays-list, o'zgartirish `sales.edit`
 *  - soliq doim narx ustiga qo'shilardi — `taxIncluded` mahsulotda mijoz soliqni ortiqcha to'lardi
 *  - qisman to'lovda ham jurnal kassani to'liq summaga debetlardi; mijozsiz qarzga sotish mumkin edi
 *  - karta to'lovi naqd kassaga yozilardi — endi bank hisobiga
 *  - smenani istalgan foydalanuvchi yopardi, yopilgan smena qayta yopilardi, kassa farqi hisoblanmasdi;
 *    ombor ruxsati tekshirilmasdi; `cashierName` mijozdan kelardi, `cashierId` yozilmasdi
 *  - `getShifts` / `getOpenShift` ruxsat tekshirmasdi — `pos.use`
 */
import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { badRequest, conflict, forbidden, notFound } from "@bum/shared";
import { warehouses } from "../../db/schema/inventory.js";
import { customers, posShifts, salesOrders } from "../../db/schema/sales.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import { nextDocumentNumber } from "../../shared/numbering.js";
import { effectivePermissions, type TenantContext } from "../company/tenant.js";
import { companyCurrency } from "../finance/accounts.service.js";
import { todayIso, type PaymentMethod } from "../finance/cash.service.js";
import { assertWarehouseAccess } from "../inventory/warehouses.service.js";
import { salesAudit } from "./customers.service.js";
import { dispatchOrder, getOrder, insertSalesItems, prepareSalesItems, type SalesItemInput } from "./orders.service.js";
import { recordCustomerPayment } from "./payments.service.js";

const { legacyId: _legacyId, companyId: _companyId, ...shiftFields } = getTableColumns(posShifts);
const expectedCashSql = sql<string>`(${posShifts.openingCash} + ${posShifts.totalCash})::numeric(18,2)`;

export type ShiftStatus = (typeof posShifts.status.enumValues)[number];

export async function getShift(conn: DbOrTx, tenant: TenantContext, shiftId: string) {
  const [shift] = await conn
    .select({ ...shiftFields, warehouseName: warehouses.name, expectedCash: expectedCashSql })
    .from(posShifts)
    .innerJoin(warehouses, eq(warehouses.id, posShifts.warehouseId))
    .where(and(eq(posShifts.id, shiftId), eq(posShifts.companyId, tenant.company.id)))
    .limit(1);
  if (!shift) throw notFound("Smena topilmadi");
  return shift;
}

export async function getOpenShift(conn: DbOrTx, tenant: TenantContext, warehouseId: string) {
  assertWarehouseAccess(tenant, warehouseId);
  const [shift] = await conn
    .select({ ...shiftFields, warehouseName: warehouses.name, expectedCash: expectedCashSql })
    .from(posShifts)
    .innerJoin(warehouses, eq(warehouses.id, posShifts.warehouseId))
    .where(
      and(eq(posShifts.companyId, tenant.company.id), eq(posShifts.warehouseId, warehouseId), eq(posShifts.status, "open")),
    )
    .limit(1);
  return shift ?? null;
}

export async function listShifts(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { warehouseId?: string; status?: ShiftStatus; limit: number },
) {
  if (options.warehouseId) assertWarehouseAccess(tenant, options.warehouseId);
  return conn
    .select({ ...shiftFields, warehouseName: warehouses.name, expectedCash: expectedCashSql })
    .from(posShifts)
    .innerJoin(warehouses, eq(warehouses.id, posShifts.warehouseId))
    .where(
      and(
        eq(posShifts.companyId, tenant.company.id),
        options.warehouseId ? eq(posShifts.warehouseId, options.warehouseId) : undefined,
        options.status ? eq(posShifts.status, options.status) : undefined,
      ),
    )
    .orderBy(desc(posShifts.openedAt))
    .limit(options.limit);
}

export async function openShift(
  tx: Tx,
  tenant: TenantContext,
  input: { warehouseId: string; openingCash: string; notes?: string | null },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const [warehouse] = await tx
    .select({ isActive: warehouses.isActive })
    .from(warehouses)
    .where(and(eq(warehouses.id, input.warehouseId), eq(warehouses.companyId, companyId)))
    .limit(1);
  if (!warehouse) throw badRequest("Ombor topilmadi");
  if (!warehouse.isActive) throw badRequest("Ombor faol emas");
  assertWarehouseAccess(tenant, input.warehouseId);

  const [existing] = await tx
    .select({ id: posShifts.id })
    .from(posShifts)
    .where(and(eq(posShifts.companyId, companyId), eq(posShifts.warehouseId, input.warehouseId), eq(posShifts.status, "open")))
    .limit(1);
  if (existing) throw conflict("Bu omborda smena allaqachon ochiq");

  const [shift] = await tx
    .insert(posShifts)
    .values({
      companyId,
      warehouseId: input.warehouseId,
      cashierId: tenant.user.id,
      cashierName: tenant.user.name,
      openedAt: new Date(),
      openingCash: input.openingCash,
      notes: input.notes ?? null,
    })
    .returning({ id: posShifts.id });

  await salesAudit(tx, tenant, meta, {
    action: "POS_SHIFT_OPENED",
    resource: "pos_shifts",
    resourceId: shift!.id,
    details: { warehouseId: input.warehouseId, openingCash: input.openingCash },
  });
  return getShift(tx, tenant, shift!.id);
}

async function lockShift(tx: Tx, tenant: TenantContext, shiftId: string) {
  const [shift] = await tx
    .select(shiftFields)
    .from(posShifts)
    .where(and(eq(posShifts.id, shiftId), eq(posShifts.companyId, tenant.company.id)))
    .limit(1)
    .for("update");
  if (!shift) throw notFound("Smena topilmadi");
  return shift;
}

/** Smenada kassirning o'zi yoki `sales.approve` ruxsatli menejer ishlaydi. */
async function assertShiftOperator(conn: DbOrTx, tenant: TenantContext, cashierId: string | null) {
  if (cashierId === tenant.user.id) return;
  if (!(await effectivePermissions(conn, tenant)).includes("sales.approve")) {
    throw forbidden("Bu smena boshqa kassirga tegishli");
  }
}

export async function closeShift(
  tx: Tx,
  tenant: TenantContext,
  shiftId: string,
  input: { closingCash: string; notes?: string | null },
  meta: RequestMeta,
) {
  const shift = await lockShift(tx, tenant, shiftId);
  if (shift.status !== "open") throw badRequest("Smena allaqachon yopilgan");
  await assertShiftOperator(tx, tenant, shift.cashierId);

  const expected = toMinor(shift.openingCash) + toMinor(shift.totalCash);
  const difference = toMinor(input.closingCash) - expected;
  await tx
    .update(posShifts)
    .set({
      status: "closed",
      closedAt: new Date(),
      closingCash: input.closingCash,
      notes: input.notes ?? shift.notes,
      updatedAt: new Date(),
    })
    .where(eq(posShifts.id, shiftId));

  await salesAudit(tx, tenant, meta, {
    action: "POS_SHIFT_CLOSED",
    resource: "pos_shifts",
    resourceId: shiftId,
    details: { expectedCash: fromMinor(expected), closingCash: input.closingCash, difference: fromMinor(difference) },
  });
  return { shift: await getShift(tx, tenant, shiftId), expectedCash: fromMinor(expected), difference: fromMinor(difference) };
}

export async function completeSale(
  tx: Tx,
  tenant: TenantContext,
  input: {
    shiftId: string;
    customerId?: string | null;
    items: SalesItemInput[];
    paymentMethod: PaymentMethod;
    amountPaid: string;
    notes?: string | null;
  },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const shift = await lockShift(tx, tenant, input.shiftId);
  if (shift.status !== "open") throw badRequest("Smena yopilgan");
  await assertShiftOperator(tx, tenant, shift.cashierId);
  assertWarehouseAccess(tenant, shift.warehouseId);

  let customerDiscount = "0";
  if (input.customerId) {
    const [customer] = await tx
      .select({ discountPercent: customers.discountPercent, isActive: customers.isActive })
      .from(customers)
      .where(and(eq(customers.id, input.customerId), eq(customers.companyId, companyId)))
      .limit(1);
    if (!customer) throw badRequest("Mijoz topilmadi");
    if (!customer.isActive) throw badRequest("Mijoz faol emas");
    customerDiscount = customer.discountPercent;
  }

  const { items, totals } = await prepareSalesItems(tx, tenant, input.items, customerDiscount);
  const total = toMinor(totals.totalAmount);
  const tendered = toMinor(input.amountPaid);
  if (input.paymentMethod !== "cash" && tendered > total) {
    throw badRequest("Karta yoki bank to'lovi chek summasidan oshmasligi kerak");
  }
  const paid = tendered < total ? tendered : total;
  const change = tendered - paid;
  if (!input.customerId && paid < total) throw badRequest("Mijozsiz sotuvda chek to'liq to'lanishi kerak");

  const today = todayIso();
  const number = await nextDocumentNumber(tx, {
    table: salesOrders,
    column: salesOrders.number,
    companyColumn: salesOrders.companyId,
    companyId,
    prefix: `SO-${today.slice(0, 4)}-`,
    width: 4,
  });

  const [order] = await tx
    .insert(salesOrders)
    .values({
      companyId,
      number,
      customerId: input.customerId ?? null,
      warehouseId: shift.warehouseId,
      status: "confirmed",
      orderDate: today,
      currency: await companyCurrency(tx, companyId),
      ...totals,
      isPos: true,
      posShiftId: shift.id,
      notes: input.notes ?? null,
      createdBy: tenant.user.id,
    })
    .returning({
      id: salesOrders.id,
      number: salesOrders.number,
      customerId: salesOrders.customerId,
      warehouseId: salesOrders.warehouseId,
      totalAmount: salesOrders.totalAmount,
      paidAmount: salesOrders.paidAmount,
      isPos: salesOrders.isPos,
    });
  await insertSalesItems(tx, companyId, order!.id, items);

  await dispatchOrder(tx, tenant, order!, today, paid);
  await tx
    .update(salesOrders)
    .set({ status: total === 0n ? "delivered" : "shipped", updatedAt: new Date() })
    .where(eq(salesOrders.id, order!.id));

  const paidText = fromMinor(paid);
  if (paid > 0n) {
    await recordCustomerPayment(
      tx,
      tenant,
      { orderId: order!.id, amount: paidText, method: input.paymentMethod, paymentDate: today },
      meta,
    );
  }

  await tx
    .update(posShifts)
    .set({
      totalSales: sql`${posShifts.totalSales} + ${totals.totalAmount}::numeric`,
      ...(input.paymentMethod === "cash" ? { totalCash: sql`${posShifts.totalCash} + ${paidText}::numeric` } : {}),
      ...(input.paymentMethod === "card" ? { totalCard: sql`${posShifts.totalCard} + ${paidText}::numeric` } : {}),
      receiptCount: sql`${posShifts.receiptCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(posShifts.id, shift.id));

  await salesAudit(tx, tenant, meta, {
    action: "POS_SALE_COMPLETED",
    resource: "sales_orders",
    resourceId: order!.id,
    details: { number, shiftId: shift.id, total: totals.totalAmount, paid: paidText, change: fromMinor(change) },
  });
  return { order: await getOrder(tx, tenant, order!.id), paid: paidText, change: fromMinor(change) };
}
