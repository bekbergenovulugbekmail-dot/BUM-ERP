/**
 * /api/purchase — ta'minotchilar, xarid buyurtmalari, tovar qabuli, to'lovlar (convex/purchase/*).
 *
 *   GET    /suppliers (?includeInactive=&search=), /suppliers/:supplierId     purchase.view
 *   POST   /suppliers                                     purchase.create
 *   PATCH  /suppliers/:supplierId                         purchase.edit
 *   GET    /orders (?supplierId=&status=&dateFrom=&dateTo=&search=&limit=&cursor=), /orders/:orderId   purchase.view
 *   POST   /orders                                        purchase.create
 *   PATCH  /orders/:orderId (faqat qoralama)              purchase.edit
 *   POST   /orders/:orderId/confirm                       purchase.approve
 *   POST   /orders/:orderId/cancel                        purchase.cancel
 *   POST   /orders/:orderId/receipts                      warehouse.receive (+ ombor ruxsati)
 *   GET    /payments (?supplierId=&orderId=&limit=&cursor=)   purchase.view
 *   POST   /payments                                      purchase.approve (201 yangi / 200 takroriy reference)
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Permission } from "@bum/shared";
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
import { listSupplierPayments, recordSupplierPayment } from "./payments.service.js";
import { createSupplier, getSupplier, listSuppliers, updateSupplier } from "./suppliers.service.js";

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

const supplierBody = z.strictObject({
  name: z.string().trim().min(1).max(200),
  /** Berilmasa — avtomatik (S-0001). */
  code: z.string().trim().min(1).max(32).optional(),
  contactPerson: nullableText(200),
  phone: nullableText(20),
  email: nullableText(255),
  address: nullableText(1000),
  taxId: nullableText(32),
  bankAccount: nullableText(64),
  paymentTermDays: z.number().int().min(0).max(3650).optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  notes: nullableText(2000),
});
const supplierPatch = supplierBody.omit({ code: true }).partial().extend({ isActive: z.boolean().optional() });
const suppliersQuery = z.object({ includeInactive: boolQuery, search: z.string().trim().min(1).max(100).optional() });

const orderItem = z.strictObject({
  productId: z.uuid(),
  unitId: z.uuid(),
  orderedQty: positiveQty,
  unitPrice: priceSchema,
  taxRate: percentSchema.optional(),
  discountPercent: percentSchema.optional(),
  notes: nullableText(1000),
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

const paymentBody = z.strictObject({
  supplierId: z.uuid(),
  orderId: z.uuid().nullable().optional(),
  amount: decimalSchema({ scale: 2, positive: true }),
  paymentDate: isoDate.optional(),
  method: z.enum(["cash", "bank", "card", "transfer"]).default("cash"),
  cashAccountId: z.uuid().nullable().optional(),
  reference: nullableText(100),
  notes: nullableText(2000),
});
const paymentsQuery = z.object({
  supplierId: z.uuid().optional(),
  orderId: z.uuid().optional(),
  limit: limitQuery,
  cursor: cursorQuery,
});

const supplierParams = z.object({ supplierId: z.uuid() });
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

  // ─── Buyurtmalar ─────────────────────────────────────────────────────────

  app.get("/orders", async (req) => {
    const query = ordersQuery.parse(req.query);
    return listOrders(db, await readTenant(req, "purchase.view"), query);
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

  // ─── To'lovlar ───────────────────────────────────────────────────────────

  app.get("/payments", async (req) => {
    const query = paymentsQuery.parse(req.query);
    return listSupplierPayments(db, await readTenant(req, "purchase.view"), query);
  });

  app.post("/payments", async (req, reply) => {
    const body = paymentBody.parse(req.body);
    const result = await writeInTenant(req, "purchase.approve", (tx, tenant) =>
      recordSupplierPayment(tx, tenant, body, requestMeta(req)),
    );
    reply.status(result.created ? 201 : 200);
    return result;
  });
}
