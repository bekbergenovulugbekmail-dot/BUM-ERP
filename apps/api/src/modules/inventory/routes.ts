/**
 * /api/inventory — omborlar, zaxira, o'tkazmalar, inventarizatsiya (convex/warehouse/*).
 *
 *   GET    /warehouses (?includeInactive=true)            a'zo (ombor ruxsati bo'yicha)
 *   GET    /warehouses/:warehouseId                       a'zo
 *   POST   /warehouses, PATCH /warehouses/:warehouseId    warehouses.manage
 *   GET    /stock (?warehouseId=&search=&lowStockOnly=)   warehouse.view
 *   GET    /stock/stats (?warehouseId=)                   warehouse.view
 *   GET    /stock/products/:productId                     warehouse.view
 *   GET    /stock/movements (?warehouseId=&productId=&type=&limit=&cursor=)   warehouse.view
 *   POST   /stock/movements                               receive → warehouse.receive; boshqalar → warehouse.manage
 *   POST   /stock/transfers                               warehouse.transfer
 *   GET    /counts (?warehouseId=&status=), /counts/:countId           warehouse.view
 *   POST   /counts, /counts/:countId/items, /counts/:countId/status    warehouse.count
 *   PATCH  /counts/:countId/items/:itemId                              warehouse.count
 *   POST   /counts/:countId/apply                         warehouse.count + warehouse.manage
 *
 * Har yozish amalida a'zoning `allowedWarehouseIds` ruxsati tekshiriladi.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Permission } from "@bum/shared";
import { db } from "../../db/client.js";
import { withTransaction, type Tx } from "../../db/transaction.js";
import { requestMeta } from "../../shared/audit.js";
import { decimalSchema, priceSchema, qtySchema } from "../../shared/decimal.js";
import { authOf, requireAuth } from "../auth/guard.js";
import {
  requirePermission,
  requireTenant,
  requireTenantForWrite,
  type TenantContext,
} from "../company/tenant.js";
import {
  addCountItem,
  applyCount,
  createCount,
  getCount,
  listCounts,
  setCountStatus,
  updateCountItem,
} from "./counts.service.js";
import {
  MANUAL_MOVEMENT_TYPES,
  listMovements,
  listStock,
  productStock,
  recordManualMovement,
  transferStock,
  warehouseStats,
} from "./stock.service.js";
import { createWarehouse, getWarehouse, listWarehouses, updateWarehouse } from "./warehouses.service.js";

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();
const boolQuery = z.enum(["true", "false"]).transform((v) => v === "true").optional();

const warehouseBody = z.strictObject({
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().min(1).max(32),
  address: nullableText(1000),
  city: nullableText(100),
  phone: nullableText(20),
  managerId: z.uuid().nullable().optional(),
  branchId: z.uuid().nullable().optional(),
  isDefault: z.boolean().optional(),
  notes: nullableText(2000),
});
const warehousePatch = warehouseBody.partial().extend({ isActive: z.boolean().optional() });

const stockQuery = z.object({
  warehouseId: z.uuid(),
  search: z.string().trim().min(1).max(100).optional(),
  lowStockOnly: boolQuery,
});
const statsQuery = z.object({ warehouseId: z.uuid() });
const movementTypes = [
  "receive", "issue", "transfer_out", "transfer_in", "adjust", "writeoff", "return_in", "return_out", "count",
] as const;
const movementsQuery = z.object({
  warehouseId: z.uuid().optional(),
  productId: z.uuid().optional(),
  type: z.enum(movementTypes).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(500).optional(),
});

/** adjust uchun ishorali farq, qolganlarida musbat miqdor. */
const signedQty = decimalSchema({ scale: 4 });
const movementBody = z
  .strictObject({
    type: z.enum(MANUAL_MOVEMENT_TYPES),
    productId: z.uuid(),
    warehouseId: z.uuid(),
    quantity: signedQty,
    /** Kiritilgan birlik (konversiya bilan asosiy birlikka); `costPrice` shu birlik narxi. */
    unitId: z.uuid().nullable().optional(),
    costPrice: priceSchema.nullable().optional(),
    batchId: z.uuid().nullable().optional(),
    /** Buxgalteriyadagi qarshi hisob (masalan, kreditorlar); berilmasa — kapital / boshqa daromad / boshqa xarajat. */
    counterAccountId: z.uuid().nullable().optional(),
    notes: nullableText(2000),
    occurredAt: z.iso.datetime({ offset: true }).transform((v) => new Date(v)).optional(),
  })
  .refine((m) => m.type === "adjust" || !m.quantity.startsWith("-"), {
    message: "Miqdor musbat bo'lishi kerak (farq uchun adjust turini tanlang)",
    path: ["quantity"],
  });

const transferBody = z.strictObject({
  productId: z.uuid(),
  fromWarehouseId: z.uuid(),
  toWarehouseId: z.uuid(),
  quantity: decimalSchema({ scale: 4, positive: true }),
  unitId: z.uuid().nullable().optional(),
  occurredAt: z.iso.datetime({ offset: true }).transform((v) => new Date(v)).optional(),
  notes: nullableText(2000),
});

const countListQuery = z.object({
  warehouseId: z.uuid().optional(),
  status: z.enum(["draft", "in_progress", "completed", "cancelled"]).optional(),
});
const countBody = z.strictObject({
  warehouseId: z.uuid(),
  name: z.string().trim().min(1).max(200),
  notes: nullableText(2000),
});
const countItemBody = z.strictObject({ productId: z.uuid() });
const countItemPatch = z.strictObject({ countedQty: qtySchema, notes: nullableText(2000) });
const countStatusBody = z.strictObject({ status: z.enum(["in_progress", "cancelled"]) });

const warehouseParams = z.object({ warehouseId: z.uuid() });
const productParams = z.object({ productId: z.uuid() });
const countParams = z.object({ countId: z.uuid() });
const countItemParams = z.object({ countId: z.uuid(), itemId: z.uuid() });
const warehouseListQuery = z.object({ includeInactive: boolQuery });

async function readTenant(req: FastifyRequest, permission?: Permission): Promise<TenantContext> {
  const tenant = await requireTenant(db, authOf(req).user);
  if (permission) await requirePermission(db, tenant, permission);
  return tenant;
}

function writeInTenant<T>(
  req: FastifyRequest,
  permissions: Permission[],
  fn: (tx: Tx, tenant: TenantContext) => Promise<T>,
): Promise<T> {
  return withTransaction(async (tx) => {
    const tenant = await requireTenantForWrite(tx, authOf(req).user);
    for (const permission of permissions) await requirePermission(tx, tenant, permission);
    return fn(tx, tenant);
  });
}

export async function inventoryRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // ─── Omborlar ────────────────────────────────────────────────────────────

  app.get("/warehouses", async (req) => {
    const { includeInactive } = warehouseListQuery.parse(req.query);
    return { warehouses: await listWarehouses(db, await readTenant(req), includeInactive ?? false) };
  });

  app.get("/warehouses/:warehouseId", async (req) => {
    const { warehouseId } = warehouseParams.parse(req.params);
    return { warehouse: await getWarehouse(db, await readTenant(req), warehouseId) };
  });

  app.post("/warehouses", async (req, reply) => {
    const body = warehouseBody.parse(req.body);
    const warehouse = await writeInTenant(req, ["warehouses.manage"], (tx, tenant) =>
      createWarehouse(tx, tenant, body, requestMeta(req)),
    );
    reply.status(201);
    return { warehouse };
  });

  app.patch("/warehouses/:warehouseId", async (req) => {
    const { warehouseId } = warehouseParams.parse(req.params);
    const patch = warehousePatch.parse(req.body);
    const warehouse = await writeInTenant(req, ["warehouses.manage"], (tx, tenant) =>
      updateWarehouse(tx, tenant, warehouseId, patch, requestMeta(req)),
    );
    return { warehouse };
  });

  // ─── Zaxira ──────────────────────────────────────────────────────────────

  app.get("/stock", async (req) => {
    const query = stockQuery.parse(req.query);
    return { stock: await listStock(db, await readTenant(req, "warehouse.view"), query) };
  });

  app.get("/stock/stats", async (req) => {
    const { warehouseId } = statsQuery.parse(req.query);
    return warehouseStats(db, await readTenant(req, "warehouse.view"), warehouseId);
  });

  app.get("/stock/products/:productId", async (req) => {
    const { productId } = productParams.parse(req.params);
    return { stock: await productStock(db, await readTenant(req, "warehouse.view"), productId) };
  });

  app.get("/stock/movements", async (req) => {
    const query = movementsQuery.parse(req.query);
    return listMovements(db, await readTenant(req, "warehouse.view"), query);
  });

  app.post("/stock/movements", async (req, reply) => {
    const body = movementBody.parse(req.body);
    const permission: Permission = body.type === "receive" ? "warehouse.receive" : "warehouse.manage";
    // Qarshi buxgalteriya hisobini tanlash (daromad, kassa va h.k.) — moliya amali; omborchi ruxsati yetmaydi
    const permissions: Permission[] = body.counterAccountId ? [permission, "finance.manage"] : [permission];
    const result = await writeInTenant(req, permissions, (tx, tenant) =>
      recordManualMovement(tx, tenant, body, requestMeta(req)),
    );
    reply.status(201);
    return result;
  });

  app.post("/stock/transfers", async (req, reply) => {
    const body = transferBody.parse(req.body);
    const result = await writeInTenant(req, ["warehouse.transfer"], (tx, tenant) =>
      transferStock(tx, tenant, body, requestMeta(req)),
    );
    reply.status(201);
    return result;
  });

  // ─── Inventarizatsiya ────────────────────────────────────────────────────

  app.get("/counts", async (req) => {
    const query = countListQuery.parse(req.query);
    return { counts: await listCounts(db, await readTenant(req, "warehouse.view"), query) };
  });

  app.get("/counts/:countId", async (req) => {
    const { countId } = countParams.parse(req.params);
    return { count: await getCount(db, await readTenant(req, "warehouse.view"), countId) };
  });

  app.post("/counts", async (req, reply) => {
    const body = countBody.parse(req.body);
    const count = await writeInTenant(req, ["warehouse.count"], (tx, tenant) =>
      createCount(tx, tenant, body, requestMeta(req)),
    );
    reply.status(201);
    return { count };
  });

  app.post("/counts/:countId/items", async (req, reply) => {
    const { countId } = countParams.parse(req.params);
    const { productId } = countItemBody.parse(req.body);
    const item = await writeInTenant(req, ["warehouse.count"], (tx, tenant) =>
      addCountItem(tx, tenant, countId, productId, requestMeta(req)),
    );
    reply.status(201);
    return { item };
  });

  app.patch("/counts/:countId/items/:itemId", async (req) => {
    const { countId, itemId } = countItemParams.parse(req.params);
    const body = countItemPatch.parse(req.body);
    const item = await writeInTenant(req, ["warehouse.count"], (tx, tenant) =>
      updateCountItem(tx, tenant, countId, itemId, body),
    );
    return { item };
  });

  app.post("/counts/:countId/status", async (req) => {
    const { countId } = countParams.parse(req.params);
    const { status } = countStatusBody.parse(req.body);
    const count = await writeInTenant(req, ["warehouse.count"], (tx, tenant) =>
      setCountStatus(tx, tenant, countId, status, requestMeta(req)),
    );
    return { count };
  });

  app.post("/counts/:countId/apply", async (req) => {
    const { countId } = countParams.parse(req.params);
    return writeInTenant(req, ["warehouse.count", "warehouse.manage"], (tx, tenant) =>
      applyCount(tx, tenant, countId, requestMeta(req)),
    );
  });
}
