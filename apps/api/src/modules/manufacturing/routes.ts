/**
 * /api/manufacturing — retseptlar, ish markazlari, ishlab chiqarish buyurtmalari (convex/manufacturing/*).
 *
 *   GET    /boms (?productId=&includeInactive=), /boms/:bomId                  manufacturing.view
 *   POST   /boms, PATCH / DELETE /boms/:bomId                                 manufacturing.manage
 *   POST   /boms/:bomId/items, PATCH / DELETE /boms/:bomId/items/:itemId      manufacturing.manage
 *   GET    /work-centers (?includeInactive=)                                  manufacturing.view
 *   POST   /work-centers, PATCH / DELETE /work-centers/:workCenterId          manufacturing.manage
 *   GET    /orders (?status=&productId=&dateFrom=&dateTo=&limit=), /orders/stats, /orders/:orderId   manufacturing.view
 *   POST   /orders, /orders/:orderId/start, /orders/:orderId/cancel, /orders/:orderId/complete       manufacturing.manage
 *   POST   /orders/:orderId/confirm                                           manufacturing.approve
 *   POST   /orders/:orderId/time-lines, DELETE /orders/:orderId/time-lines/:timeLineId               manufacturing.manage
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Permission } from "@bum/shared";
import { db } from "../../db/client.js";
import { withTransaction, type Tx } from "../../db/transaction.js";
import { requestMeta } from "../../shared/audit.js";
import { decimalSchema, moneySchema, percentSchema, qtySchema } from "../../shared/decimal.js";
import { authOf, requireAuth } from "../auth/guard.js";
import { requirePermission, requireTenant, requireTenantForWrite, type TenantContext } from "../company/tenant.js";
import { addBomItem, createBom, deleteBom, deleteBomItem, getBom, listBoms, updateBom, updateBomItem } from "./boms.service.js";
import {
  addTimeLine,
  cancelOrder,
  completeOrder,
  confirmOrder,
  createOrder,
  deleteTimeLine,
  getOrder,
  listOrders,
  productionStats,
  startOrder,
} from "./orders.service.js";
import { createWorkCenter, deleteWorkCenter, listWorkCenters, updateWorkCenter } from "./work-centers.service.js";

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
const positiveQty = decimalSchema({ scale: 4, positive: true });

const bomBody = z.strictObject({
  productId: z.uuid(),
  name: z.string().trim().min(1).max(200),
  version: z.string().trim().min(1).max(32).optional(),
  quantity: positiveQty.optional(),
  unitId: z.uuid().optional(),
  notes: nullableText(2000),
});
const bomPatch = z.strictObject({
  name: z.string().trim().min(1).max(200).optional(),
  version: z.string().trim().min(1).max(32).optional(),
  quantity: positiveQty.optional(),
  isActive: z.boolean().optional(),
  notes: nullableText(2000),
});
const bomItemBody = z.strictObject({
  productId: z.uuid(),
  quantity: positiveQty,
  unitId: z.uuid().optional(),
  scrapPercent: percentSchema.optional(),
  notes: nullableText(1000),
});
const bomItemPatch = z.strictObject({
  quantity: positiveQty.optional(),
  scrapPercent: percentSchema.optional(),
  notes: nullableText(1000),
});
const bomsQuery = z.object({ productId: z.uuid().optional(), includeInactive: boolQuery });

const workCenterTypes = ["machine", "labor", "subcontract"] as const;
const workCenterBody = z.strictObject({
  name: z.string().trim().min(1).max(200),
  type: z.enum(workCenterTypes).optional(),
  costPerHour: moneySchema.optional(),
});
const workCenterPatch = workCenterBody.partial().extend({ isActive: z.boolean().optional() });

const orderBody = z.strictObject({
  bomId: z.uuid(),
  warehouseId: z.uuid(),
  plannedQty: positiveQty,
  plannedDate: isoDate,
  notes: nullableText(2000),
});
const ordersQuery = z.object({
  status: z.enum(["draft", "confirmed", "in_progress", "completed", "cancelled"]).optional(),
  productId: z.uuid().optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
const timeLineBody = z.strictObject({
  workCenterId: z.uuid(),
  plannedHours: qtySchema.optional(),
  actualHours: qtySchema,
});
const completeBody = z.strictObject({
  producedQty: positiveQty,
  actualMaterials: z.array(z.strictObject({ materialId: z.uuid(), actualQty: qtySchema })).max(500).optional(),
});

const includeInactiveQuery = z.object({ includeInactive: boolQuery });
const bomParams = z.object({ bomId: z.uuid() });
const bomItemParams = z.object({ bomId: z.uuid(), itemId: z.uuid() });
const workCenterParams = z.object({ workCenterId: z.uuid() });
const orderParams = z.object({ orderId: z.uuid() });
const timeLineParams = z.object({ orderId: z.uuid(), timeLineId: z.uuid() });

async function readTenant(req: FastifyRequest): Promise<TenantContext> {
  const tenant = await requireTenant(db, authOf(req).user);
  await requirePermission(db, tenant, "manufacturing.view");
  return tenant;
}

function writeInTenant<T>(
  req: FastifyRequest,
  fn: (tx: Tx, tenant: TenantContext) => Promise<T>,
  permission: Permission = "manufacturing.manage",
): Promise<T> {
  return withTransaction(async (tx) => {
    const tenant = await requireTenantForWrite(tx, authOf(req).user);
    await requirePermission(tx, tenant, permission);
    return fn(tx, tenant);
  });
}

export async function manufacturingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // ─── Retseptlar ──────────────────────────────────────────────────────────

  app.get("/boms", async (req) => {
    const query = bomsQuery.parse(req.query);
    return { boms: await listBoms(db, await readTenant(req), query) };
  });

  app.get("/boms/:bomId", async (req) => {
    const { bomId } = bomParams.parse(req.params);
    return { bom: await getBom(db, await readTenant(req), bomId) };
  });

  app.post("/boms", async (req, reply) => {
    const body = bomBody.parse(req.body);
    const bom = await writeInTenant(req, (tx, tenant) => createBom(tx, tenant, body, requestMeta(req)));
    reply.status(201);
    return { bom };
  });

  app.patch("/boms/:bomId", async (req) => {
    const { bomId } = bomParams.parse(req.params);
    const patch = bomPatch.parse(req.body);
    return { bom: await writeInTenant(req, (tx, tenant) => updateBom(tx, tenant, bomId, patch, requestMeta(req))) };
  });

  app.delete("/boms/:bomId", async (req, reply) => {
    const { bomId } = bomParams.parse(req.params);
    await writeInTenant(req, (tx, tenant) => deleteBom(tx, tenant, bomId, requestMeta(req)));
    return reply.status(204).send();
  });

  app.post("/boms/:bomId/items", async (req, reply) => {
    const { bomId } = bomParams.parse(req.params);
    const body = bomItemBody.parse(req.body);
    const item = await writeInTenant(req, (tx, tenant) => addBomItem(tx, tenant, bomId, body, requestMeta(req)));
    reply.status(201);
    return { item };
  });

  app.patch("/boms/:bomId/items/:itemId", async (req) => {
    const { bomId, itemId } = bomItemParams.parse(req.params);
    const patch = bomItemPatch.parse(req.body);
    return { item: await writeInTenant(req, (tx, tenant) => updateBomItem(tx, tenant, bomId, itemId, patch, requestMeta(req))) };
  });

  app.delete("/boms/:bomId/items/:itemId", async (req, reply) => {
    const { bomId, itemId } = bomItemParams.parse(req.params);
    await writeInTenant(req, (tx, tenant) => deleteBomItem(tx, tenant, bomId, itemId, requestMeta(req)));
    return reply.status(204).send();
  });

  // ─── Ish markazlari ──────────────────────────────────────────────────────

  app.get("/work-centers", async (req) => {
    const { includeInactive } = includeInactiveQuery.parse(req.query);
    return { workCenters: await listWorkCenters(db, await readTenant(req), includeInactive ?? false) };
  });

  app.post("/work-centers", async (req, reply) => {
    const body = workCenterBody.parse(req.body);
    const workCenter = await writeInTenant(req, (tx, tenant) => createWorkCenter(tx, tenant, body, requestMeta(req)));
    reply.status(201);
    return { workCenter };
  });

  app.patch("/work-centers/:workCenterId", async (req) => {
    const { workCenterId } = workCenterParams.parse(req.params);
    const patch = workCenterPatch.parse(req.body);
    return { workCenter: await writeInTenant(req, (tx, tenant) => updateWorkCenter(tx, tenant, workCenterId, patch, requestMeta(req))) };
  });

  app.delete("/work-centers/:workCenterId", async (req, reply) => {
    const { workCenterId } = workCenterParams.parse(req.params);
    await writeInTenant(req, (tx, tenant) => deleteWorkCenter(tx, tenant, workCenterId, requestMeta(req)));
    return reply.status(204).send();
  });

  // ─── Buyurtmalar ─────────────────────────────────────────────────────────

  app.get("/orders", async (req) => {
    const query = ordersQuery.parse(req.query);
    return { orders: await listOrders(db, await readTenant(req), query) };
  });

  app.get("/orders/stats", async (req) => productionStats(db, await readTenant(req)));

  app.get("/orders/:orderId", async (req) => {
    const { orderId } = orderParams.parse(req.params);
    return { order: await getOrder(db, await readTenant(req), orderId) };
  });

  app.post("/orders", async (req, reply) => {
    const body = orderBody.parse(req.body);
    const order = await writeInTenant(req, (tx, tenant) => createOrder(tx, tenant, body, requestMeta(req)));
    reply.status(201);
    return { order };
  });

  app.post("/orders/:orderId/confirm", async (req) => {
    const { orderId } = orderParams.parse(req.params);
    return {
      order: await writeInTenant(req, (tx, tenant) => confirmOrder(tx, tenant, orderId, requestMeta(req)), "manufacturing.approve"),
    };
  });

  app.post("/orders/:orderId/start", async (req) => {
    const { orderId } = orderParams.parse(req.params);
    return { order: await writeInTenant(req, (tx, tenant) => startOrder(tx, tenant, orderId, requestMeta(req))) };
  });

  app.post("/orders/:orderId/cancel", async (req) => {
    const { orderId } = orderParams.parse(req.params);
    return { order: await writeInTenant(req, (tx, tenant) => cancelOrder(tx, tenant, orderId, requestMeta(req))) };
  });

  app.post("/orders/:orderId/complete", async (req) => {
    const { orderId } = orderParams.parse(req.params);
    const body = completeBody.parse(req.body);
    return { order: await writeInTenant(req, (tx, tenant) => completeOrder(tx, tenant, orderId, body, requestMeta(req))) };
  });

  app.post("/orders/:orderId/time-lines", async (req, reply) => {
    const { orderId } = orderParams.parse(req.params);
    const body = timeLineBody.parse(req.body);
    const timeLine = await writeInTenant(req, (tx, tenant) => addTimeLine(tx, tenant, orderId, body, requestMeta(req)));
    reply.status(201);
    return { timeLine };
  });

  app.delete("/orders/:orderId/time-lines/:timeLineId", async (req, reply) => {
    const { orderId, timeLineId } = timeLineParams.parse(req.params);
    await writeInTenant(req, (tx, tenant) => deleteTimeLine(tx, tenant, orderId, timeLineId, requestMeta(req)));
    return reply.status(204).send();
  });
}
