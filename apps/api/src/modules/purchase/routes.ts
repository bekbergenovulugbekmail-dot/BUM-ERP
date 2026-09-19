/**
 * /api/purchase — ta'minotchilar, xarid buyurtmalari, tovar qabuli, to'lovlar (convex/purchase/*).
 *
 *   GET    /suppliers (?includeInactive=&search=), /suppliers/:supplierId     purchase.view
 *   POST   /suppliers                                     purchase.create
 *   PATCH  /suppliers/:supplierId                         purchase.edit
 *   POST   /suppliers/:supplierId/set-debt                finance.approve (qarzni to'g'rilash, sabab bilan)
 *   GET    /suppliers/export (?includeInactive=)          purchase.view (CSV)
 *   POST   /suppliers/import                              purchase.create (CSV qatorlari; qarz o'zgarmaydi)
 *   GET    /orders (?supplierId=&status=&dateFrom=&dateTo=&search=&limit=&cursor=), /orders/:orderId   purchase.view
 *   POST   /orders                                        purchase.create
 *   PATCH  /orders/:orderId (faqat qoralama)              purchase.edit
 *   POST   /orders/:orderId/confirm                       purchase.approve
 *   POST   /orders/:orderId/cancel                        purchase.cancel
 *   POST   /orders/:orderId/receipts                      warehouse.receive (+ ombor ruxsati)
 *   POST   /orders/:orderId/returns                       purchase.return (qisman; ta'minotchi qaytargan pul bilan)
 *   GET    /orders/export (?supplierId=&status=&dateFrom=&dateTo=)   purchase.view (CSV: hujjat qatorlari)
 *   POST   /orders/import ({rows, dryRun})                purchase.create (qoralama hujjat; dryRun — faqat tekshirish)
 *   GET    /payments (?supplierId=&orderId=&limit=&cursor=)   purchase.view
 *   POST   /payments                                      purchase.approve (201 yangi / 200 takroriy reference)
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { ALLOCATION_METHODS, MAX_PAYMENT_PARTS, type Permission } from "@bum/shared";
import { db } from "../../db/client.js";
import { withTransaction, type Tx } from "../../db/transaction.js";
import { requestMeta } from "../../shared/audit.js";
import { decimalSchema, percentSchema, priceSchema } from "../../shared/decimal.js";
import { authOf, requireAuth } from "../auth/guard.js";
import { requirePermission, requireTenant, requireTenantForWrite, type TenantContext } from "../company/tenant.js";
import {
  cancelOrder,
  confirmOrder,
  createOrder,
  getOrder,
  listOrders,
  receiveGoods,
  updateOrder,
} from "./orders.service.js";
import { exportPurchaseOrdersCsv, importPurchaseOrders } from "./orders-csv.service.js";
import { listSupplierPayments, recordMixedSupplierPayment, recordSupplierPayment } from "./payments.service.js";
import { returnPurchaseItems } from "./returns.service.js";
import { exportSuppliersCsv, importSuppliers } from "./suppliers-csv.service.js";
import { createSupplier, getSupplier, listSuppliers, setSupplierDebt, updateSupplier } from "./suppliers.service.js";

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();
const boolQuery = z.enum(["true", "false"]).transform((v) => v === "true").optional();
const isoDate = z.iso.date();
const limitQuery = z.coerce.number().int().min(1).max(200).default(50);
const cursorQuery = z.string().max(500).optional();
const positiveQty = decimalSchema({ scale: 4, positive: true });
const currencyCode = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Valyuta kodi 3 harf (ISO 4217)");

const supplierBody = z.strictObject({
  name: z.string().trim().min(1).max(200),
  /** Berilmasa — avtomatik (S-0001). */
  code: z.string().trim().min(1).max(32).optional(),
  contactPerson: nullableText(200),
  phone: nullableText(20),
  email: nullableText(255),
  address: nullableText(1000),
  taxId: nullableText(32),
  partyType: z.enum(["individual", "legal"]).optional(),
  bankAccount: nullableText(64),
  bankMfo: nullableText(16),
  paymentTermDays: z.number().int().min(0).max(3650).optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  notes: nullableText(2000),
});
const supplierPatch = supplierBody.omit({ code: true }).partial().extend({ isActive: z.boolean().optional() });
const suppliersQuery = z.object({ includeInactive: boolQuery, search: z.string().trim().min(1).max(100).optional() });
const suppliersExportQuery = z.object({ includeInactive: boolQuery });
/** CSV import: fayl brauzerda o'qiladi, qatorlar shu yerda tekshiriladi. Qarz ustuni e'tiborsiz qoldiriladi. */
const supplierImportBody = z.strictObject({
  /** Preview: faqat tekshirish — bazaga hech narsa yozilmaydi. */
  dryRun: z.boolean().optional(),
  rows: z
    .array(
      z.strictObject({
        name: z.string().max(300).optional(),
        code: z.string().max(50).optional(),
        partyType: z.string().max(50).optional(),
        contactPerson: z.string().max(300).optional(),
        phone: z.string().max(50).optional(),
        email: z.string().max(300).optional(),
        address: z.string().max(1000).optional(),
        taxId: z.string().max(50).optional(),
        bankAccount: z.string().max(100).optional(),
        bankMfo: z.string().max(50).optional(),
        paymentTermDays: z.string().max(50).optional(),
      }),
    )
    .min(1)
    .max(500),
});

const orderItem = z.strictObject({
  productId: z.uuid(),
  unitId: z.uuid(),
  orderedQty: positiveQty,
  unitPrice: priceSchema,
  taxRate: percentSchema.optional(),
  discountPercent: percentSchema.optional(),
  notes: nullableText(1000),
  /** Qator valyutasi; berilmasa yoki null — asosiy valyuta. */
  currency: currencyCode.nullable().optional(),
  /** Qabulda mahsulotga yoziladigan sotuv narxi (asosiy birlik uchun). */
  salesPrice: priceSchema.nullable().optional(),
  salesCurrency: currencyCode.nullable().optional(),
});
const orderBody = z.strictObject({
  supplierId: z.uuid(),
  warehouseId: z.uuid(),
  orderDate: isoDate,
  expectedDate: isoDate.nullable().optional(),
  notes: nullableText(2000),
  items: z.array(orderItem).min(1).max(500),
});
const ordersQuery = z.object({
  supplierId: z.uuid().optional(),
  status: z.enum(["draft", "confirmed", "partial", "received", "invoiced", "paid", "cancelled"]).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  search: z.string().trim().min(1).max(100).optional(),
  limit: limitQuery,
  cursor: cursorQuery,
});
const ordersExportQuery = z.object({
  supplierId: z.uuid().optional(),
  status: z.enum(["draft", "confirmed", "partial", "received", "invoiced", "paid", "cancelled"]).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});
/**
 * CSV import: fayl qatori = hujjat qatori; bir xil "Hujjat raqami" bitta hujjatga birlashadi.
 * `dryRun` — faqat tekshirish (preview), bazaga hech narsa yozilmaydi.
 */
const orderImportBody = z.strictObject({
  dryRun: z.boolean().optional(),
  rows: z
    .array(
      z.strictObject({
        number: z.string().max(50).optional(),
        // Raqamsiz qatorlarni bitta hujjatga bog'laydi ("Tezda qo'shish"); raqam sifatida saqlanmaydi
        docKey: z.string().max(100).optional(),
        orderDate: z.string().max(50).optional(),
        supplier: z.string().max(300).optional(),
        warehouse: z.string().max(300).optional(),
        product: z.string().max(300).optional(),
        quantity: z.string().max(50).optional(),
        unit: z.string().max(50).optional(),
        price: z.string().max(50).optional(),
        discountPercent: z.string().max(50).optional(),
        taxRate: z.string().max(50).optional(),
        expectedDate: z.string().max(50).optional(),
        notes: z.string().max(2000).optional(),
      }),
    )
    .min(1)
    .max(500),
});
const cancelBody = z.strictObject({ reason: nullableText(1000) }).optional();
const receiptBody = z.strictObject({
  receiptDate: isoDate.optional(),
  notes: nullableText(2000),
  items: z
    .array(
      z.strictObject({
        orderItemId: z.uuid(),
        receivedQty: positiveQty,
        batchNumber: nullableText(64),
        expiryDate: isoDate.nullable().optional(),
      }),
    )
    .min(1)
    .max(500),
});

const purchaseReturnBody = z.strictObject({
  items: z.array(z.strictObject({ orderItemId: z.uuid(), quantity: positiveQty })).min(1).max(500),
  reason: nullableText(1000),
  refund: z
    .strictObject({ amount: decimalSchema({ scale: 2, positive: true }), method: z.enum(["cash", "card"]) })
    .nullable()
    .optional(),
});

/** Aralash to'lov qismi — mijoz to'lovlaridagi bilan bir xil shakl. */
const supplierPaymentPart = z.strictObject({
  method: z.enum(ALLOCATION_METHODS),
  amount: decimalSchema({ scale: 2, positive: true }),
  terminalId: z.uuid().nullable().optional(),
  cashAccountId: z.uuid().nullable().optional(),
});
const paymentBody = z
  .strictObject({
    supplierId: z.uuid(),
    orderId: z.uuid().nullable().optional(),
    /** Bitta usulli to'lov summasi; `parts` berilsa yuborilmaydi. */
    amount: decimalSchema({ scale: 2, positive: true }).optional(),
    /** To'lov valyutasi — kassa ham shu valyutada; standart asosiy valyuta. Aralash to'lov faqat asosiy valyutada. */
    currency: currencyCode.optional(),
    paymentDate: isoDate.optional(),
    method: z.enum(["cash", "bank", "card", "transfer"]).default("cash"),
    cashAccountId: z.uuid().nullable().optional(),
    /** Aralash to'lov (naqd + UZCARD + bank): har qism o'z hisobidan chiqadi. */
    parts: z.array(supplierPaymentPart).min(1).max(MAX_PAYMENT_PARTS).optional(),
    reference: nullableText(100),
    notes: nullableText(2000),
  })
  .refine((body) => Boolean(body.amount) !== Boolean(body.parts), {
    message: "Summa yoki aralash to'lov qismlaridan bittasi yuboriladi",
  })
  .refine((body) => !body.parts || !body.currency, {
    message: "Aralash to'lov faqat asosiy valyutada — valyutadagi to'lov bitta usul bilan kiritiladi",
  });
/** Bitta usulli to'lov `{ payment }`, aralash to'lov `{ payments }` qaytaradi — mavjud javob shakli o'zgarmaydi. */
type SupplierPaymentResult =
  | Awaited<ReturnType<typeof recordSupplierPayment>>
  | Awaited<ReturnType<typeof recordMixedSupplierPayment>>;
const paymentsQuery = z.object({
  supplierId: z.uuid().optional(),
  orderId: z.uuid().optional(),
  limit: limitQuery,
  cursor: cursorQuery,
});

const supplierParams = z.object({ supplierId: z.uuid() });
/** Ta'minotchi qarzini to'g'rilash: qarz to'g'ri qiymatga o'rnatiladi, sabab majburiy. */
const supplierDebtBody = z.strictObject({
  totalDebt: decimalSchema({ scale: 2 }),
  reason: z.string().trim().min(3).max(500),
  date: isoDate.optional(),
});
const orderParams = z.object({ orderId: z.uuid() });

async function readTenant(req: FastifyRequest, permission: Permission): Promise<TenantContext> {
  const tenant = await requireTenant(db, authOf(req).user);
  await requirePermission(db, tenant, permission);
  return tenant;
}

function writeInTenant<T>(
  req: FastifyRequest,
  permission: Permission,
  fn: (tx: Tx, tenant: TenantContext) => Promise<T>,
): Promise<T> {
  return withTransaction(async (tx) => {
    const tenant = await requireTenantForWrite(tx, authOf(req).user);
    await requirePermission(tx, tenant, permission);
    return fn(tx, tenant);
  });
}

export async function purchaseRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // ─── Ta'minotchilar ──────────────────────────────────────────────────────

  app.get("/suppliers", async (req) => {
    const query = suppliersQuery.parse(req.query);
    return { suppliers: await listSuppliers(db, await readTenant(req, "purchase.view"), query) };
  });

  app.get("/suppliers/:supplierId", async (req) => {
    const { supplierId } = supplierParams.parse(req.params);
    return { supplier: await getSupplier(db, await readTenant(req, "purchase.view"), supplierId) };
  });

  app.post("/suppliers", async (req, reply) => {
    const body = supplierBody.parse(req.body);
    const supplier = await writeInTenant(req, "purchase.create", (tx, tenant) =>
      createSupplier(tx, tenant, body, requestMeta(req)),
    );
    reply.status(201);
    return { supplier };
  });

  app.patch("/suppliers/:supplierId", async (req) => {
    const { supplierId } = supplierParams.parse(req.params);
    const patch = supplierPatch.parse(req.body);
    const supplier = await writeInTenant(req, "purchase.edit", (tx, tenant) =>
      updateSupplier(tx, tenant, supplierId, patch, requestMeta(req)),
    );
    return { supplier };
  });

  app.get("/suppliers/export", async (req, reply) => {
    const { includeInactive } = suppliersExportQuery.parse(req.query);
    const csv = await exportSuppliersCsv(db, await readTenant(req, "purchase.view"), { includeInactive: includeInactive ?? false });
    const date = new Date().toISOString().slice(0, 10);
    reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="taminotchilar-${date}.csv"`);
    return csv;
  });

  app.post("/suppliers/import", async (req) => {
    const { rows, dryRun } = supplierImportBody.parse(req.body);
    return writeInTenant(req, "purchase.create", (tx, tenant) => importSuppliers(tx, tenant, rows, requestMeta(req), { dryRun }));
  });

  app.post("/suppliers/:supplierId/set-debt", async (req) => {
    const { supplierId } = supplierParams.parse(req.params);
    const body = supplierDebtBody.parse(req.body);
    return writeInTenant(req, "finance.approve", (tx, tenant) =>
      setSupplierDebt(tx, tenant, supplierId, body, requestMeta(req)),
    );
  });

  // ─── Buyurtmalar ─────────────────────────────────────────────────────────

  app.get("/orders", async (req) => {
    const query = ordersQuery.parse(req.query);
    return listOrders(db, await readTenant(req, "purchase.view"), query);
  });

  app.get("/orders/export", async (req, reply) => {
    const filters = ordersExportQuery.parse(req.query);
    const csv = await exportPurchaseOrdersCsv(db, await readTenant(req, "purchase.view"), filters);
    const date = new Date().toISOString().slice(0, 10);
    reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="xaridlar-${date}.csv"`);
    return csv;
  });

  app.post("/orders/import", async (req) => {
    const { rows, dryRun } = orderImportBody.parse(req.body);
    return writeInTenant(req, "purchase.create", (tx, tenant) =>
      importPurchaseOrders(tx, tenant, rows, requestMeta(req), { dryRun }),
    );
  });

  app.get("/orders/:orderId", async (req) => {
    const { orderId } = orderParams.parse(req.params);
    return { order: await getOrder(db, await readTenant(req, "purchase.view"), orderId) };
  });

  app.post("/orders", async (req, reply) => {
    const body = orderBody.parse(req.body);
    const order = await writeInTenant(req, "purchase.create", (tx, tenant) =>
      createOrder(tx, tenant, body, requestMeta(req)),
    );
    reply.status(201);
    return { order };
  });

  app.patch("/orders/:orderId", async (req) => {
    const { orderId } = orderParams.parse(req.params);
    const patch = orderBody.partial().parse(req.body);
    const order = await writeInTenant(req, "purchase.edit", (tx, tenant) =>
      updateOrder(tx, tenant, orderId, patch, requestMeta(req)),
    );
    return { order };
  });

  app.post("/orders/:orderId/confirm", async (req) => {
    const { orderId } = orderParams.parse(req.params);
    const order = await writeInTenant(req, "purchase.approve", (tx, tenant) =>
      confirmOrder(tx, tenant, orderId, requestMeta(req)),
    );
    return { order };
  });

  app.post("/orders/:orderId/cancel", async (req) => {
    const { orderId } = orderParams.parse(req.params);
    const body = cancelBody.parse(req.body);
    const order = await writeInTenant(req, "purchase.cancel", (tx, tenant) =>
      cancelOrder(tx, tenant, orderId, body?.reason ?? null, requestMeta(req)),
    );
    return { order };
  });

  app.post("/orders/:orderId/receipts", async (req, reply) => {
    const { orderId } = orderParams.parse(req.params);
    const body = receiptBody.parse(req.body);
    const result = await writeInTenant(req, "warehouse.receive", (tx, tenant) =>
      receiveGoods(tx, tenant, orderId, body, requestMeta(req)),
    );
    reply.status(201);
    return result;
  });

  app.post("/orders/:orderId/returns", async (req, reply) => {
    const { orderId } = orderParams.parse(req.params);
    const body = purchaseReturnBody.parse(req.body);
    const result = await writeInTenant(req, "purchase.return", async (tx, tenant) => {
      const created = await returnPurchaseItems(tx, tenant, orderId, body, requestMeta(req));
      return { return: created.return, order: await getOrder(tx, tenant, orderId) };
    });
    reply.status(201);
    return result;
  });

  // ─── To'lovlar ───────────────────────────────────────────────────────────

  app.get("/payments", async (req) => {
    const query = paymentsQuery.parse(req.query);
    return listSupplierPayments(db, await readTenant(req, "purchase.view"), query);
  });

  app.post("/payments", async (req, reply) => {
    const { parts, amount, ...rest } = paymentBody.parse(req.body);
    const result = await writeInTenant(req, "purchase.approve", (tx, tenant): Promise<SupplierPaymentResult> =>
      parts
        ? recordMixedSupplierPayment(
            tx,
            tenant,
            {
              supplierId: rest.supplierId,
              orderId: rest.orderId,
              parts,
              paymentDate: rest.paymentDate,
              reference: rest.reference,
              notes: rest.notes,
            },
            requestMeta(req),
          )
        : recordSupplierPayment(tx, tenant, { ...rest, amount: amount! }, requestMeta(req)),
    );
    reply.status(result.created ? 201 : 200);
    return result;
  });
}
