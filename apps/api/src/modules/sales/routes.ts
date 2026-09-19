/**
 * /api/sales — mijozlar, savdo buyurtmalari, mijoz to'lovlari, POS (convex/sales/*).
 *
 *   GET    /customers (?search=&includeInactive=&limit=), /customers/:customerId   sales.view
 *   POST   /customers, PATCH /customers/:customerId       crm.manage
 *   GET    /orders (?status=&customerId=&warehouseId=&isPos=&shiftId=&dateFrom=&dateTo=&search=&limit=&cursor=)   sales.view
 *   GET    /orders/stats, /orders/:orderId                sales.view
 *   POST   /orders                                        sales.create (narx/chegirma o'zgartirish — sales.edit)
 *   PATCH  /orders/:orderId (faqat qoralama)              sales.edit
 *   POST   /orders/:orderId/confirm, /orders/:orderId/ship   sales.approve (+ ombor ruxsati)
 *   POST   /orders/:orderId/cancel                        sales.cancel
 *   POST   /orders/:orderId/return                        sales.refund
 *   POST   /orders/:orderId/return-items                  sales.refund   (qisman qaytarish)
 *   GET    /payments (?customerId=&orderId=&limit=&cursor=)   sales.view
 *   POST   /payments                                      finance.manage (201 yangi / 200 takroriy reference)
 *   GET    /pos/shifts (?warehouseId=&status=&limit=), /pos/shifts/open?warehouseId=, /pos/shifts/:shiftId   pos.use
 *   POST   /pos/shifts, /pos/shifts/:shiftId/close        pos.use (yopish — kassirning o'zi yoki sales.approve)
 *   GET    /pos/shift-reviews (?status=&limit=)            sales.approve (kassa farqi chegaradan oshgan smenalar)
 *   POST   /pos/shifts/:shiftId/review                    sales.approve (tasdiqlash/rad; o'z smenasi — faqat ega)
 *   GET    /policy, PUT /policy                            settings.view / settings.manage (savdo siyosati)
 *   GET    /pos/payment-options                           pos.use (faol karta terminallari)
 *   POST   /pos/sales                                     pos.use (aralash to'lov, balansdan, qaytim balansga, nasiya)
 *   POST   /pos/customers                                 pos.use (kassada mijoz qo'shish)
 *   POST   /pos/customers/:customerId/payments            pos.use (balansni to'ldirish / qarzni to'lash)
 *   GET    /customers/:customerId/balance (?limit=)       sales.view (balans tarixi)
 *   GET    /customers/:customerId/cashback (?limit=)      sales.view (keshbek tarixi)
 *   POST   /customers/:customerId/balance-adjust          finance.approve (balans, qarz, keshbekni to'g'rilash)
 *   GET    /customers/export (?includeInactive=)          sales.view (CSV)
 *   POST   /customers/import                              crm.manage (CSV qatorlari; pul qiymatlari o'zgarmaydi)
 *   GET    /cashback/settings                             sales.view
 *   PUT    /cashback/settings                             settings.manage
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { ALLOCATION_METHODS, MAX_PAYMENT_PARTS, type Permission } from "@bum/shared";
import { db } from "../../db/client.js";
import { withTransaction, type Tx } from "../../db/transaction.js";
import { requestMeta } from "../../shared/audit.js";
import { notifyCustomerPaymentReceived, notifyOrderPurchase } from "../telegram/notify.service.js";
import { alertBigDiscount, alertShiftDifference } from "../telegram/alerts.service.js";
import { decimalSchema, moneySchema, percentSchema, priceSchema } from "../../shared/decimal.js";
import { authOf, requireAuth } from "../auth/guard.js";
import { requireAnyPermission, requirePermission, requireTenant, requireTenantForWrite, type TenantContext } from "../company/tenant.js";
import { autoCreateDeliveryTask } from "../delivery/tasks.service.js";
import { createCustomer, getCustomer, listCustomers, updateCustomer } from "./customers.service.js";
import {
  cancelOrder,
  confirmOrder,
  createOrder,
  getOrder,
  listOrders,
  returnOrder,
  salesStats,
  shipOrder,
  updateOrder,
} from "./orders.service.js";
import { listCustomerPayments, recordSalesPayment } from "./payments.service.js";
import { recordMixedCustomerPayment } from "./payment-allocation.service.js";
import { paymentTerminalOptions, posBankAccountOptions } from "../finance/terminals.service.js";
import { getPosAppearance } from "../pos-device/appearance.service.js";
import {
  cashbackSettingsSchema,
  getCashbackSettings,
  listCashbackTransactions,
  saveCashbackSettings,
} from "./cashback.service.js";
import { exportCustomersCsv, importCustomers } from "./customers-csv.service.js";
import { listBalanceTransactions, setCustomerBalances } from "./customer-balance.service.js";
import {
  closeShift,
  completeSale,
  createPosCustomer,
  getOpenShift,
  getShift,
  listShifts,
  listShiftReviews,
  openShift,
  posCustomerPayment,
  reviewShiftDifference,
} from "./pos.service.js";
import { getSalesPolicy, salesPolicySchema, saveSalesPolicy } from "./sales-policy.service.js";
import { CASH_MOVEMENT_KINDS, listCashMovements, posCashMovement } from "./pos-cash.service.js";
import { REFUND_METHODS, returnSaleItems } from "./returns.service.js";

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
const positiveMoney = decimalSchema({ scale: 2, positive: true });
const paymentMethod = z.enum(["cash", "bank", "card", "transfer"]);
const currencyCode = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Valyuta kodi 3 harf (ISO 4217)");

const customerBody = z.strictObject({
  name: z.string().trim().min(1).max(200),
  phone: nullableText(20),
  email: nullableText(255),
  address: nullableText(1000),
  taxId: nullableText(32),
  partyType: z.enum(["individual", "legal"]).optional(),
  bankAccount: nullableText(64),
  bankMfo: nullableText(16),
  discountPercent: percentSchema.optional(),
  creditLimit: moneySchema.optional(),
  paymentTermDays: z.number().int().min(0).max(3650).optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  notes: nullableText(2000),
  contactName: nullableText(200),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  city: nullableText(100),
  district: nullableText(100),
});
const customerPatch = customerBody.partial().extend({ isActive: z.boolean().optional() });
const customersQuery = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  includeInactive: boolQuery,
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

const salesItem = z.strictObject({
  productId: z.uuid(),
  unitId: z.uuid().optional(),
  quantity: positiveQty,
  unitPrice: priceSchema.optional(),
  discountPercent: percentSchema.optional(),
  notes: nullableText(1000),
});
const orderBody = z.strictObject({
  customerId: z.uuid().nullable().optional(),
  warehouseId: z.uuid(),
  orderDate: isoDate,
  deliveryDate: isoDate.nullable().optional(),
  /** Yetkazib berish kerakmi (null — dostavka siyosati bo'yicha); tasdiqlanganda yetkazma yaratiladi. */
  deliveryRequired: z.boolean().nullable().optional(),
  notes: nullableText(2000),
  items: z.array(salesItem).min(1).max(500),
  /** Sotuv valyutalari: mahsulot o'z narx valyutasida, tanlanmagan bo'lsa birinchi valyutada. */
  saleCurrencies: z.array(currencyCode).min(1).max(6).optional(),
});
const ordersQuery = z.object({
  status: z.enum(["draft", "confirmed", "completed", "shipped", "delivered", "returned", "cancelled"]).optional(),
  customerId: z.uuid().optional(),
  warehouseId: z.uuid().optional(),
  isPos: boolQuery,
  shiftId: z.uuid().optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  search: z.string().trim().min(1).max(100).optional(),
  limit: limitQuery,
  cursor: cursorQuery,
});
const cancelBody = z.strictObject({ reason: nullableText(1000) }).optional();
const returnBody = z
  .strictObject({
    reason: nullableText(1000),
    refund: z.boolean().optional(),
    method: paymentMethod.optional(),
    cashAccountId: z.uuid().nullable().optional(),
  })
  .optional();

const returnItemsBody = z.strictObject({
  items: z.array(z.strictObject({ orderItemId: z.uuid(), quantity: positiveQty })).min(1).max(500),
  refundMethod: z.enum(REFUND_METHODS).default("cash"),
  /** Pulni usullar bo'yicha qaytarish (aralash to'lovli chek): yig'indisi qaytadigan pulga teng, har usul chekda to'langanidan oshmaydi. */
  refunds: z.array(z.strictObject({ method: z.enum(REFUND_METHODS), amount: moneySchema })).min(1).max(4).optional(),
  reason: nullableText(1000),
  /** Pul qaytaradigan ochiq web kassa smenasi (ixtiyoriy). */
  shiftId: z.uuid().nullable().optional(),
});

const paymentBody = z.strictObject({
  customerId: z.uuid().nullable().optional(),
  orderId: z.uuid().nullable().optional(),
  /** `currency` berilsa — shu valyutada. */
  amount: positiveMoney,
  currency: currencyCode.optional(),
  paymentDate: isoDate.optional(),
  method: z.enum(["cash", "bank", "card", "transfer", "balance", "cashback"]).default("cash"),
  cashAccountId: z.uuid().nullable().optional(),
  reference: nullableText(100),
  notes: nullableText(2000),
});
const paymentPart = z.strictObject({
  method: z.enum(ALLOCATION_METHODS),
  amount: moneySchema,
  /** Karta terminali — pul uning bank hisobiga. */
  terminalId: z.uuid().nullable().optional(),
  cashAccountId: z.uuid().nullable().optional(),
});
const posPaymentPart = paymentPart.extend({ method: z.enum(["cash", "card", "bank"]) });
/** Aralash mijoz/buyurtma to'lovi: qismlar yig'indisi qarz yoki buyurtma qoldig'idan oshmaydi. */
const mixedPaymentBody = z.strictObject({
  customerId: z.uuid().nullable().optional(),
  orderId: z.uuid().nullable().optional(),
  parts: z.array(paymentPart).min(1).max(MAX_PAYMENT_PARTS),
  paymentDate: isoDate.optional(),
  /** Takroriy yuborishdan himoya kaliti. */
  reference: nullableText(100),
  notes: nullableText(2000),
});
const paymentsQuery = z.object({
  customerId: z.uuid().optional(),
  orderId: z.uuid().optional(),
  limit: limitQuery,
  cursor: cursorQuery,
});

const shiftsQuery = z.object({
  warehouseId: z.uuid().optional(),
  status: z.enum(["open", "closed"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});
const openShiftQuery = z.object({ warehouseId: z.uuid() });
const currencyAmount = z.strictObject({ currency: currencyCode, amount: moneySchema });
const openShiftBody = z.strictObject({
  warehouseId: z.uuid(),
  openingCash: moneySchema.default("0"),
  /** Chet valyutadagi boshlang'ich naqd. */
  openingForeignCash: z.array(currencyAmount).max(10).optional(),
  notes: nullableText(1000),
});
const closeShiftBody = z.strictObject({
  closingCash: moneySchema,
  /** Kassada sanalgan chet valyuta naqdi. */
  closingForeignCash: z.array(currencyAmount).max(10).optional(),
  notes: nullableText(1000),
});
const posSaleBody = z.strictObject({
  shiftId: z.uuid(),
  customerId: z.uuid().nullable().optional(),
  items: z.array(salesItem).min(1).max(500),
  paymentMethod: paymentMethod.default("cash"),
  amountPaid: moneySchema.optional(),
  /**
   * Aralash to'lov (asosiy valyutada): naqd + karta (terminal bo'yicha) + bank — berilsa paymentMethod/amountPaid o'rniga.
   * Jami chek summasidan oshmaydi (qaytim faqat bitta naqd to'lovda).
   */
  payments: z.array(posPaymentPart).min(1).max(MAX_PAYMENT_PARTS).optional(),
  /** Nasiya: to'lanmagan qoldiq mijoz qarziga (mijoz shart). Belgilanmasa kam to'lov rad etiladi. */
  onCredit: z.boolean().optional(),
  /** So'rov kaliti — takroriy yuborishda ikkinchi chek yozilmaydi. */
  clientRequestId: z.uuid().optional(),
  cashbackAmount: moneySchema.optional(),
  balanceAmount: moneySchema.optional(),
  changeToBalance: z.boolean().optional(),
  /** Sotuv valyutalari; bitta chet valyuta — hamma narx shu valyutada. */
  saleCurrencies: z.array(currencyCode).min(1).max(6).optional(),
  /** Chet valyutadagi to'lovlar: naqd (standart) yoki karta — shu valyutadagi kassa/bankka. */
  currencyPayments: z
    .array(z.strictObject({ currency: currencyCode, amount: moneySchema, method: z.enum(["cash", "card"]).optional() }))
    .max(6)
    .optional(),
  notes: nullableText(1000),
}).refine((body) => body.amountPaid !== undefined || body.payments !== undefined, "To'lov summasi (amountPaid) yoki to'lov qismlari (payments) kiritilsin");
const cashMovementBody = z.strictObject({
  kind: z.enum(CASH_MOVEMENT_KINDS),
  amount: positiveMoney,
  category: nullableText(64),
  notes: nullableText(500),
  /** Inkassatsiyani bank yoki boshqa kassaga o'tkazish. */
  targetAccountId: z.uuid().nullable().optional(),
});
const posCustomerBody = z.strictObject({
  name: z.string().trim().min(1).max(200),
  phone: nullableText(20),
  notes: nullableText(2000),
});
const posCustomerPaymentBody = z
  .strictObject({
    shiftId: z.uuid(),
    purpose: z.enum(["deposit", "debt"]),
    amount: positiveMoney.optional(),
    method: z.enum(["cash", "bank", "card", "transfer", "balance"]).default("cash"),
    /** Qarzni aralash to'lash: naqd + karta (terminal) + bank; jami qarzdan oshmaydi. */
    parts: z.array(paymentPart).min(1).max(MAX_PAYMENT_PARTS).optional(),
    clientRequestId: z.uuid().optional(),
    notes: nullableText(1000),
  })
  .refine((body) => body.amount !== undefined || body.parts !== undefined, "To'lov summasi (amount) yoki qismlari (parts) kiritilsin");
const balanceQuery = z.object({ limit: limitQuery });
const customersExportQuery = z.object({ includeInactive: boolQuery });
/** CSV import: fayl brauzerda o'qiladi, qatorlar shu yerda tekshiriladi. Qarz va balans ustunlari e'tiborsiz. */
const customerImportBody = z.strictObject({
  /** Preview: faqat tekshirish — bazaga hech narsa yozilmaydi. */
  dryRun: z.boolean().optional(),
  rows: z
    .array(
      z.strictObject({
        name: z.string().max(300).optional(),
        partyType: z.string().max(50).optional(),
        phone: z.string().max(50).optional(),
        email: z.string().max(300).optional(),
        address: z.string().max(1000).optional(),
        contactName: z.string().max(300).optional(),
        taxId: z.string().max(50).optional(),
        bankAccount: z.string().max(100).optional(),
        bankMfo: z.string().max(50).optional(),
        city: z.string().max(200).optional(),
        district: z.string().max(200).optional(),
        discountPercent: z.string().max(50).optional(),
        creditLimit: z.string().max(50).optional(),
        paymentTermDays: z.string().max(50).optional(),
      }),
    )
    .min(1)
    .max(500),
});
/** Balansni to'g'rilash: berilgan qiymat(lar) to'g'ri qiymatga o'rnatiladi, sabab majburiy. */
const balanceAdjustBody = z.strictObject({
  balance: moneySchema.optional(),
  totalDebt: moneySchema.optional(),
  cashback: moneySchema.optional(),
  reason: z.string().trim().min(3).max(500),
  date: z.iso.date().optional(),
});

const customerParams = z.object({ customerId: z.uuid() });
const orderParams = z.object({ orderId: z.uuid() });
const shiftParams = z.object({ shiftId: z.uuid() });
const shiftReviewsQuery = z.object({
  status: z.enum(["pending", "approved", "rejected"]).default("pending"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const shiftReviewBody = z.strictObject({ decision: z.enum(["approved", "rejected"]), note: nullableText(1000) });

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

/**
 * Mijozdan to'lov qabul qilish: kassir va savdo menejerida `sales.collect_payment`,
 * moliya xodimlarida (buxgalter, moliya menejeri, direktor, ega) `finance.manage`.
 */
const PAYMENT_PERMISSIONS = ["sales.collect_payment", "finance.manage"] as const satisfies readonly [Permission, ...Permission[]];

/** Mijozdan to'lov qabul qilish kabi amallar: ruxsatlardan biri yetarli. */
function writeInTenantAny<T>(
  req: FastifyRequest,
  permissions: readonly [Permission, ...Permission[]],
  fn: (tx: Tx, tenant: TenantContext) => Promise<T>,
): Promise<T> {
  return withTransaction(async (tx) => {
    const tenant = await requireTenantForWrite(tx, authOf(req).user);
    await requireAnyPermission(tx, tenant, permissions);
    return fn(tx, tenant);
  });
}

export async function salesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // ─── Mijozlar ────────────────────────────────────────────────────────────

  app.get("/customers", async (req) => {
    const query = customersQuery.parse(req.query);
    return { customers: await listCustomers(db, await readTenant(req, "sales.view"), query) };
  });

  app.get("/customers/export", async (req, reply) => {
    const { includeInactive } = customersExportQuery.parse(req.query);
    const csv = await exportCustomersCsv(db, await readTenant(req, "sales.view"), { includeInactive: includeInactive ?? false });
    const date = new Date().toISOString().slice(0, 10);
    reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="mijozlar-${date}.csv"`);
    return csv;
  });

  app.post("/customers/import", async (req) => {
    const { rows, dryRun } = customerImportBody.parse(req.body);
    return writeInTenant(req, "crm.manage", (tx, tenant) => importCustomers(tx, tenant, rows, requestMeta(req), { dryRun }));
  });

  app.get("/customers/:customerId", async (req) => {
    const { customerId } = customerParams.parse(req.params);
    return { customer: await getCustomer(db, await readTenant(req, "sales.view"), customerId) };
  });

  app.get("/customers/:customerId/balance", async (req) => {
    const { customerId } = customerParams.parse(req.params);
    const { limit } = balanceQuery.parse(req.query);
    return { transactions: await listBalanceTransactions(db, await readTenant(req, "sales.view"), customerId, limit) };
  });

  app.get("/customers/:customerId/cashback", async (req) => {
    const { customerId } = customerParams.parse(req.params);
    const { limit } = balanceQuery.parse(req.query);
    return { transactions: await listCashbackTransactions(db, await readTenant(req, "sales.view"), customerId, limit) };
  });

  app.post("/customers/:customerId/balance-adjust", async (req) => {
    const { customerId } = customerParams.parse(req.params);
    const body = balanceAdjustBody.parse(req.body);
    return writeInTenant(req, "finance.approve", (tx, tenant) =>
      setCustomerBalances(tx, tenant, { ...body, customerId }, requestMeta(req)),
    );
  });

  // ─── Keshbek sozlamalari ─────────────────────────────────────────────────

  app.get("/cashback/settings", async (req) => {
    const tenant = await readTenant(req, "sales.view");
    return { settings: await getCashbackSettings(db, tenant.company.id) };
  });

  app.put("/cashback/settings", async (req) => {
    const body = cashbackSettingsSchema.parse(req.body);
    const settings = await writeInTenant(req, "settings.manage", (tx, tenant) =>
      saveCashbackSettings(tx, tenant, body, requestMeta(req)),
    );
    return { settings };
  });

  app.post("/customers", async (req, reply) => {
    const body = customerBody.parse(req.body);
    const customer = await writeInTenant(req, "crm.manage", (tx, tenant) =>
      createCustomer(tx, tenant, body, requestMeta(req)),
    );
    reply.status(201);
    return { customer };
  });

  app.patch("/customers/:customerId", async (req) => {
    const { customerId } = customerParams.parse(req.params);
    const patch = customerPatch.parse(req.body);
    const customer = await writeInTenant(req, "crm.manage", (tx, tenant) =>
      updateCustomer(tx, tenant, customerId, patch, requestMeta(req)),
    );
    return { customer };
  });

  // ─── Buyurtmalar ─────────────────────────────────────────────────────────

  app.get("/orders", async (req) => {
    const query = ordersQuery.parse(req.query);
    return listOrders(db, await readTenant(req, "sales.view"), query);
  });

  app.get("/orders/stats", async (req) => salesStats(db, await readTenant(req, "sales.view")));

  app.get("/orders/:orderId", async (req) => {
    const { orderId } = orderParams.parse(req.params);
    return { order: await getOrder(db, await readTenant(req, "sales.view"), orderId) };
  });

  app.post("/orders", async (req, reply) => {
    const body = orderBody.parse(req.body);
    let companyId = "";
    const order = await writeInTenant(req, "sales.create", (tx, tenant) => {
      companyId = tenant.company.id;
      return createOrder(tx, tenant, body, requestMeta(req));
    });
    reply.status(201);
    if (order.customerId) void notifyOrderPurchase(companyId, order.id);
    return { order };
  });

  app.patch("/orders/:orderId", async (req) => {
    const { orderId } = orderParams.parse(req.params);
    const patch = orderBody.partial().parse(req.body);
    const order = await writeInTenant(req, "sales.edit", (tx, tenant) =>
      updateOrder(tx, tenant, orderId, patch, requestMeta(req)),
    );
    return { order };
  });

  app.post("/orders/:orderId/confirm", async (req) => {
    const { orderId } = orderParams.parse(req.params);
    const order = await writeInTenant(req, "sales.approve", async (tx, tenant) => {
      const confirmed = await confirmOrder(tx, tenant, orderId, requestMeta(req));
      // Yetkazish kerak bo'lsa — yetkazma (DeliveryTask) shu tranzaksiyada yaratiladi
      await autoCreateDeliveryTask(tx, tenant, orderId, requestMeta(req));
      return confirmed;
    });
    return { order };
  });

  app.post("/orders/:orderId/ship", async (req) => {
    const { orderId } = orderParams.parse(req.params);
    const order = await writeInTenant(req, "sales.approve", (tx, tenant) =>
      shipOrder(tx, tenant, orderId, requestMeta(req)),
    );
    return { order };
  });

  app.post("/orders/:orderId/cancel", async (req) => {
    const { orderId } = orderParams.parse(req.params);
    const body = cancelBody.parse(req.body);
    const order = await writeInTenant(req, "sales.cancel", (tx, tenant) =>
      cancelOrder(tx, tenant, orderId, body?.reason ?? null, requestMeta(req)),
    );
    return { order };
  });

  app.post("/orders/:orderId/return", async (req) => {
    const { orderId } = orderParams.parse(req.params);
    const body = returnBody.parse(req.body) ?? {};
    return writeInTenant(req, "sales.refund", (tx, tenant) =>
      returnOrder(tx, tenant, orderId, body, requestMeta(req)),
    );
  });

  app.post("/orders/:orderId/return-items", async (req, reply) => {
    const { orderId } = orderParams.parse(req.params);
    const body = returnItemsBody.parse(req.body);
    const result = await writeInTenant(req, "sales.refund", (tx, tenant) =>
      returnSaleItems(tx, tenant, orderId, body, requestMeta(req)),
    );
    reply.status(201);
    return result;
  });

  // ─── To'lovlar ───────────────────────────────────────────────────────────

  app.get("/payments", async (req) => {
    const query = paymentsQuery.parse(req.query);
    return listCustomerPayments(db, await readTenant(req, "sales.view"), query);
  });

  app.post("/payments", async (req, reply) => {
    // Aralash to'lov (`parts`) — universal taqsimot; aks holda bitta usul (valyuta, balans, keshbek bilan)
    let companyId = "";
    if (req.body && typeof req.body === "object" && "parts" in req.body) {
      const body = mixedPaymentBody.parse(req.body);
      const result = await writeInTenantAny(req, PAYMENT_PERMISSIONS, (tx, tenant) => {
        companyId = tenant.company.id;
        return recordMixedCustomerPayment(
          tx,
          tenant,
          {
            source: "sales_payment",
            customerId: body.customerId,
            orderId: body.orderId,
            parts: body.parts,
            idempotencyKey: body.reference ? `sales_payment:${body.reference}` : null,
            ...(body.paymentDate ? { paymentDate: body.paymentDate } : {}),
            notes: body.notes,
          },
          requestMeta(req),
        );
      });
      reply.status(result.created ? 201 : 200);
      if (result.created) {
        void notifyCustomerPaymentReceived({
          companyId,
          customerId: body.customerId ?? null,
          orderId: body.orderId ?? null,
          amount: result.payment.totalAmount,
          method: body.parts.length > 1 ? "mixed" : body.parts[0]!.method,
        });
      }
      return result;
    }
    const body = paymentBody.parse(req.body);
    const result = await writeInTenantAny(req, PAYMENT_PERMISSIONS, (tx, tenant) => {
      companyId = tenant.company.id;
      return recordSalesPayment(tx, tenant, body, requestMeta(req));
    });
    reply.status(result.created ? 201 : 200);
    // Chet valyutadagi to'lovda summa asosiy valyutada emas — xabar yuborilmaydi (noto'g'ri raqam chiqmasin)
    if (result.created && !body.currency) {
      void notifyCustomerPaymentReceived({
        companyId,
        customerId: body.customerId ?? null,
        orderId: body.orderId ?? null,
        amount: body.amount,
        method: body.method,
      });
    }
    return result;
  });

  // ─── POS ─────────────────────────────────────────────────────────────────

  app.get("/pos/shifts", async (req) => {
    const query = shiftsQuery.parse(req.query);
    return { shifts: await listShifts(db, await readTenant(req, "pos.use"), query) };
  });

  // Kassa ekrani: "Kassada ko'rsatish" belgilangan terminallar (UZCARD, HUMO ...) va bank hisoblari — komissiya ma'lumotisiz
  app.get("/pos/payment-options", async (req) => {
    const tenant = await readTenant(req, "pos.use");
    return {
      terminals: await paymentTerminalOptions(db, tenant.company.id, { posOnly: true }),
      bankAccounts: await posBankAccountOptions(db, tenant.company.id),
      maxParts: MAX_PAYMENT_PARTS,
      // Biznes egasi tanlagan kassa tuzilishi (web kassa ham desktop kabi)
      layout: await getPosAppearance(db, tenant.company.id).then(({ paymentPanelSide, layout }) => ({ paymentPanelSide, layout })),
    };
  });

  app.get("/pos/shifts/open", async (req) => {
    const { warehouseId } = openShiftQuery.parse(req.query);
    return { shift: await getOpenShift(db, await readTenant(req, "pos.use"), warehouseId) };
  });

  app.get("/pos/shifts/:shiftId", async (req) => {
    const { shiftId } = shiftParams.parse(req.params);
    return { shift: await getShift(db, await readTenant(req, "pos.use"), shiftId) };
  });

  app.post("/pos/shifts", async (req, reply) => {
    const body = openShiftBody.parse(req.body);
    const shift = await writeInTenant(req, "pos.use", (tx, tenant) => openShift(tx, tenant, body, requestMeta(req)));
    reply.status(201);
    return { shift };
  });

  app.post("/pos/shifts/:shiftId/close", async (req) => {
    const { shiftId } = shiftParams.parse(req.params);
    const body = closeShiftBody.parse(req.body);
    let companyId = "";
    const result = await writeInTenant(req, "pos.use", (tx, tenant) => {
      companyId = tenant.company.id;
      return closeShift(tx, tenant, shiftId, body, requestMeta(req));
    });
    // Egasiga darhol xabar: farq chegaradan oshdi
    if (result.review === "pending") {
      void alertShiftDifference(companyId, {
        cashier: result.shift.cashierName ?? null,
        difference: result.difference,
        expected: result.expectedCash,
        counted: body.closingCash,
      });
    }
    return result;
  });

  // Savdo siyosati: chegirma chegarasi, kassir depozit chegarasi, smena farqi chegarasi
  app.get("/policy", async (req) => {
    const tenant = await readTenant(req, "settings.view");
    return { policy: await getSalesPolicy(db, tenant.company.id) };
  });

  app.put("/policy", async (req) => {
    const body = salesPolicySchema.parse(req.body);
    const policy = await writeInTenant(req, "settings.manage", (tx, tenant) => saveSalesPolicy(tx, tenant, body, requestMeta(req)));
    return { policy };
  });

  // Kassa farqi chegaradan oshgan smenalar — rahbar ko'rib chiqadi
  app.get("/pos/shift-reviews", async (req) => {
    const query = shiftReviewsQuery.parse(req.query);
    return { shifts: await listShiftReviews(db, await readTenant(req, "sales.approve"), query) };
  });

  app.post("/pos/shifts/:shiftId/review", async (req) => {
    const { shiftId } = shiftParams.parse(req.params);
    const body = shiftReviewBody.parse(req.body);
    const shift = await writeInTenant(req, "sales.approve", (tx, tenant) => reviewShiftDifference(tx, tenant, shiftId, body, requestMeta(req)));
    return { shift };
  });

  app.get("/pos/shifts/:shiftId/cash-movements", async (req) => {
    const { shiftId } = shiftParams.parse(req.params);
    return { movements: await listCashMovements(db, await readTenant(req, "pos.use"), shiftId) };
  });

  app.post("/pos/shifts/:shiftId/cash-movements", async (req, reply) => {
    const { shiftId } = shiftParams.parse(req.params);
    const body = cashMovementBody.parse(req.body);
    const result = await writeInTenant(req, "pos.use", (tx, tenant) => posCashMovement(tx, tenant, { ...body, shiftId }, requestMeta(req)));
    reply.status(201);
    return { movement: result.movement, shift: result.shift };
  });

  app.post("/pos/sales", async (req, reply) => {
    const body = posSaleBody.parse(req.body);
    let companyId = "";
    const result = await writeInTenant(req, "pos.use", (tx, tenant) => {
      companyId = tenant.company.id;
      return completeSale(tx, tenant, body, requestMeta(req));
    });
    reply.status(201);
    // Mijozga chek — tranzaksiyadan KEYIN va javobni kutmasdan (Telegram kassani sekinlashtirmaydi)
    if (body.customerId) void notifyOrderPurchase(companyId, result.order.id);
    // Egasiga: chegirma siyosat chegarasidan oshgan bo'lsa
    const overLimit = result.conflicts.find((conflict) => conflict.kind === "discount_over_limit");
    if (overLimit) {
      void alertBigDiscount(companyId, {
        number: result.order.number,
        cashier: authOf(req).user.name ?? null,
        items: (overLimit.details.items as { name: string; discountPercent: string; maxDiscountPercent: string }[]) ?? [],
      });
    }
    return result;
  });

  app.post("/pos/customers", async (req, reply) => {
    const body = posCustomerBody.parse(req.body);
    const customer = await writeInTenant(req, "pos.use", (tx, tenant) =>
      createPosCustomer(tx, tenant, body, requestMeta(req)),
    );
    reply.status(201);
    return { customer };
  });

  app.post("/pos/customers/:customerId/payments", async (req, reply) => {
    const { customerId } = customerParams.parse(req.params);
    const body = posCustomerPaymentBody.parse(req.body);
    let companyId = "";
    const result = await writeInTenant(req, "pos.use", (tx, tenant) => {
      companyId = tenant.company.id;
      return posCustomerPayment(tx, tenant, { ...body, customerId }, requestMeta(req));
    });
    reply.status(201);
    // Qarz to'lash — mijozga xabar; balansni to'ldirish xarid emas, xabar yuborilmaydi
    if (body.purpose === "debt") {
      const parts = body.parts ?? [];
      void notifyCustomerPaymentReceived({
        companyId,
        customerId,
        amount: parts.length > 0 ? String(parts.reduce((sum, part) => sum + Number(part.amount), 0)) : (body.amount ?? "0"),
        method: parts.length > 1 ? "mixed" : (parts[0]?.method ?? body.method),
        collectedBy: "Kassa",
      });
    }
    return result;
  });
}
