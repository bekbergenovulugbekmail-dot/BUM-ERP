/**
 * /api/inventory — omborlar, zaxira, o'tkazmalar, inventarizatsiya (convex/warehouse/*).
 *
 *   GET    /warehouses (?includeInactive=true)            a'zo (ombor ruxsati bo'yicha)
 *   GET    /warehouses/:warehouseId                       a'zo
 *   POST   /warehouses, PATCH /warehouses/:warehouseId    warehouses.manage
 *   GET    /stock (?warehouseId=&search=&lowStockOnly=)   warehouse.view
 *   GET    /stock/export (?warehouseId=&inStockOnly=)    warehouse.view (tannarx — products.view_cost)
 *   GET    /stock/stats (?warehouseId=)                   warehouse.view
 *   GET    /stock/products/:productId                     warehouse.view
 *   GET    /stock/movements (?warehouseId=&productId=&type=&limit=&cursor=)   warehouse.view
 *   POST   /stock/movements                               receive → warehouse.receive; boshqalar → warehouse.manage
 *   POST   /stock/transfers                               warehouse.transfer
 *   GET    /counts (?warehouseId=&status=)                              warehouse.view
 *   GET    /counts/:countId (?search=&limit=)                          warehouse.view
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
  hasPermission,
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
  exportStock,
  listStock,
  productStock,
  recordManualMovement,
  transferStock,
  warehouseStats,
} from "./stock.service.js";
import { createWarehouse, getWarehouse, listWarehouses, updateWarehouse } from "./warehouses.service.js";
import { allocateBackorders, listBackorders } from "./backorders.service.js";

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
const exportQuery = z.object({ warehouseId: z.uuid().optional(), inStockOnly: boolQuery });
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
  /** So'rov kaliti — takroriy yuborish ikkinchi o'tkazma yaratmaydi. */
  requestId: z.uuid().optional(),
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
/** Hisob qatorlari: katalog katta bo'lishi mumkin — qidiruv va chegara serverda. */
const countItemsQuery = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
});
const countItemParams = z.object({ countId: z.uuid(), itemId: z.uuid() });
const warehouseListQuery = z.object({ includeInactive: boolQuery });

/** Backorder reyestri filtrlari. */
const backordersQuery = z.object({
  customerId: z.uuid().optional(),
  productId: z.uuid().optional(),
  warehouseId: z.uuid().optional(),
  status: z.enum(["open", "partially_allocated"]).optional(),
  dateFrom: z.iso.date().optional(),
  dateTo: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});
const allocateBody = z.strictObject({
  warehouseId: z.uuid(),
  /** Berilmasa — shu ombordagi barcha ochiq backorder mahsulotlari. */
  productIds: z.array(z.uuid()).min(1).max(200).optional(),
});

async function readTenant(req: FastifyRequest, permission?: Permission): Promise<TenantContext> {
  const tenant = await requireTenant(db, authOf(req).user);
  if (permission) await requirePermission(db, tenant, permission);
  return tenant;
}

/**
 * Tannarxni ko'rish huquqi (`products.view_cost`) — ombor ruxsatidan ALOHIDA.
 *
 * Kompaniya egasining qarori: o'rtacha tannarx va ombor qiymati xodimlarga ko'rinmaydi. Qoldiq,
 * zaxira va harakatlar esa ochiq qoladi — ular ish uchun kerak va foyda ko'rsatmaydi.
 */
const canViewCost = (tenant: TenantContext) => hasPermission(db, tenant, "products.view_cost");

/** Ruxsat bo'lmasa tannarx maydoni `null` bo'lib qaytadi (0 emas — 0 noto'g'ri ma'lumot berardi). */
const hideCost = <T extends { avgCostPrice: string }>(rows: T[], allowed: boolean) =>
  allowed ? rows : rows.map((row) => ({ ...row, avgCostPrice: null }));

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

  // ─── Backorder reyestri ──────────────────────────────────────────────────

  app.get("/backorders", async (req) => {
    const query = backordersQuery.parse(req.query);
    return listBackorders(db, await readTenant(req, "warehouse.view"), query);
  });

  /** Tovar kelganda avtomatik taqsimlanadi; bu — qo'lda qayta urinish (masalan qoldiq tuzatilgandan keyin). */
  app.post("/backorders/allocate", async (req) => {
    const body = allocateBody.parse(req.body);
    const allocations = await writeInTenant(req, ["warehouse.receive"], async (tx, tenant) => {
      // Ombor shu kompaniyanikimi va foydalanuvchiga ochiqmi — begona ombor id'si 404 beradi
      await getWarehouse(tx, tenant, body.warehouseId);
      const productIds = body.productIds ?? (await listBackorders(tx, tenant, { warehouseId: body.warehouseId, limit: 1000 })).items.map((row) => row.productId);
      return allocateBackorders(tx, tenant.company.id, body.warehouseId, productIds);
    });
    return { allocations };
  });

  // ─── Zaxira ──────────────────────────────────────────────────────────────

  app.get("/stock", async (req) => {
    const query = stockQuery.parse(req.query);
    const tenant = await readTenant(req, "warehouse.view");
    return { stock: hideCost(await listStock(db, tenant, query), await canViewCost(tenant)) };
  });

  // Eksport: barcha ochiq omborlar (yoki bittasi) — mahsulot × ombor; tannarx faqat `products.view_cost` bilan
  app.get("/stock/export", async (req) => {
    const query = exportQuery.parse(req.query);
    const tenant = await readTenant(req, "warehouse.view");
    const allowed = await canViewCost(tenant);
    return { rows: hideCost(await exportStock(db, tenant, query), allowed), costVisible: allowed };
  });

  app.get("/stock/stats", async (req) => {
    const { warehouseId } = statsQuery.parse(req.query);
    const tenant = await readTenant(req, "warehouse.view");
    const stats = await warehouseStats(db, tenant, warehouseId);
    // Ombor qiymati = qoldiq × tannarx, ya'ni tannarxning o'zi — ruxsatsiz yuborilmaydi
    return (await canViewCost(tenant)) ? stats : { ...stats, totalValue: null };
  });

  app.get("/stock/products/:productId", async (req) => {
    const { productId } = productParams.parse(req.params);
    const tenant = await readTenant(req, "warehouse.view");
    return { stock: hideCost(await productStock(db, tenant, productId), await canViewCost(tenant)) };
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
    reply.status("duplicate" in result && result.duplicate ? 200 : 201);
    return result;
  });

  // ─── Inventarizatsiya ────────────────────────────────────────────────────

  app.get("/counts", async (req) => {
    const query = countListQuery.parse(req.query);
    return { counts: await listCounts(db, await readTenant(req, "warehouse.view"), query) };
  });

  app.get("/counts/:countId", async (req) => {
    const { countId } = countParams.parse(req.params);
    const query = countItemsQuery.parse(req.query);
    return { count: await getCount(db, await readTenant(req, "warehouse.view"), countId, query) };
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
