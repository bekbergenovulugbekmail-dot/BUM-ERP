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
 *   POST   /pos/sales                                     pos.use (balansdan to'lash, qaytim balansga, qarzga)
 *   POST   /pos/customers                                 pos.use (kassada mijoz qo'shish)
 *   POST   /pos/customers/:customerId/payments            pos.use (balansni to'ldirish / qarzni to'lash)
 *   GET    /customers/:customerId/balance (?limit=)       sales.view (balans tarixi)
 *   GET    /customers/:customerId/cashback (?limit=)      sales.view (keshbek tarixi)
 *   GET    /cashback/settings                             sales.view
 *   PUT    /cashback/settings                             settings.manage
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Permission } from "@bum/shared";
import { db } from "../../db/client.js";
import { withTransaction, type Tx } from "../../db/transaction.js";
import { requestMeta } from "../../shared/audit.js";
import { decimalSchema, moneySchema, percentSchema, priceSchema } from "../../shared/decimal.js";
import { authOf, requireAuth } from "../auth/guard.js";
import { requirePermission, requireTenant, requireTenantForWrite, type TenantContext } from "../company/tenant.js";
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
import {
  cashbackSettingsSchema,
  getCashbackSettings,
  listCashbackTransactions,
  saveCashbackSettings,
} from "./cashback.service.js";
import { listBalanceTransactions } from "./customer-balance.service.js";
import {
  closeShift,
  completeSale,
  createPosCustomer,
  getOpenShift,
  getShift,
  listShifts,
  openShift,
  posCustomerPayment,
} from "./pos.service.js";
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
  status: z.enum(["draft", "confirmed", "shipped", "delivered", "returned", "cancelled"]).optional(),
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
  /** Aralash to'lov: naqd + karta + bank (asosiy valyutada, har usul bir marta) — berilsa paymentMethod/amountPaid o'rniga. */
  payments: z.array(z.strictObject({ method: z.enum(["cash", "card", "bank"]), amount: moneySchema })).min(1).max(3).optional(),
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
const posCustomerPaymentBody = z.strictObject({
  shiftId: z.uuid(),
  purpose: z.enum(["deposit", "debt"]),
  amount: positiveMoney,
  method: z.enum(["cash", "bank", "card", "transfer", "balance"]).default("cash"),
  notes: nullableText(1000),
});
const balanceQuery = z.object({ limit: limitQuery });

const customerParams = z.object({ customerId: z.uuid() });
const orderParams = z.object({ orderId: z.uuid() });
const shiftParams = z.object({ shiftId: z.uuid() });

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

export async function salesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // ─── Mijozlar ────────────────────────────────────────────────────────────

  app.get("/customers", async (req) => {
    const query = customersQuery.parse(req.query);
    return { customers: await listCustomers(db, await readTenant(req, "sales.view"), query) };
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
    const order = await writeInTenant(req, "sales.create", (tx, tenant) =>
      createOrder(tx, tenant, body, requestMeta(req)),
    );
    reply.status(201);
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
    const body = paymentBody.parse(req.body);
    const result = await writeInTenant(req, "finance.manage", (tx, tenant) =>
      recordSalesPayment(tx, tenant, body, requestMeta(req)),
    );
    reply.status(result.created ? 201 : 200);
    return result;
  });

  // ─── POS ─────────────────────────────────────────────────────────────────

  app.get("/pos/shifts", async (req) => {
    const query = shiftsQuery.parse(req.query);
    return { shifts: await listShifts(db, await readTenant(req, "pos.use"), query) };
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
    return writeInTenant(req, "pos.use", (tx, tenant) => closeShift(tx, tenant, shiftId, body, requestMeta(req)));
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
    const result = await writeInTenant(req, "pos.use", (tx, tenant) =>
      completeSale(tx, tenant, body, requestMeta(req)),
    );
    reply.status(201);
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
    const result = await writeInTenant(req, "pos.use", (tx, tenant) =>
      posCustomerPayment(tx, tenant, { ...body, customerId }, requestMeta(req)),
    );
    reply.status(201);
    return result;
  });
}
