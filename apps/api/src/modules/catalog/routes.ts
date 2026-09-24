/**
 * /api/catalog — mahsulot katalogi (convex/products/*).
 *
 *   GET    /units                              o'lchov birliklari            (sessiya)
 *   POST   /units, PATCH /units/:unitId        birlik yaratish/tahrirlash    (platforma admini)
 *   GET    /unit-conversions                   konversiyalar (?productId=)   (a'zo)
 *   POST   /unit-conversions                   konversiya                    (products.manage)
 *   DELETE /unit-conversions/:conversionId                                   (products.manage)
 *   GET    /categories                         (?includeInactive=true)       (a'zo)
 *   POST   /categories, PATCH|DELETE /categories/:categoryId                 (products.manage)
 *   GET    /brands                             (?isActive=)                  (a'zo)
 *   POST   /brands, PATCH|DELETE /brands/:brandId                            (products.manage)
 *   GET    /products                           ro'yxat (?search=&categoryId=&brandId=&isActive=&limit=&cursor=)  (products.view)
 *   GET    /products/costs                     tannarx ro'yxati (?search=&limit=)  (products.view_cost)
 *   GET    /products/:productId/price-suggestions  narx tavsiyalari (?unitId=)   (products.view_cost)
 *   GET    /products/:productId/cost-history   tannarx tarixi (?limit=)       (products.view_cost)
 *   GET    /products/export                    CSV                           (products.view)
 *   POST   /products/import                    CSV qatorlari (JSON)          (products.create)
 *   GET    /products/by-barcode/:barcode                                     (products.view)
 *   GET    /products/:productId                partiyalar bilan              (products.view)
 *   POST   /products                                                         (products.create)
 *   PATCH  /products/:productId                                              (products.edit)
 *   DELETE /products/:productId                faolsizlantirish              (products.delete)
 *   POST   /products/:productId/batches        partiya                       (warehouse.manage)
 *   GET    /batches/expiring                   (?daysAhead=30)               (warehouse.view)
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Permission } from "@bum/shared";
import { db } from "../../db/client.js";
import { withTransaction, type DbOrTx } from "../../db/transaction.js";
import { requestMeta } from "../../shared/audit.js";
import { decimalSchema, percentSchema, priceSchema, qtySchema } from "../../shared/decimal.js";
import { authOf, requireAuth, requirePlatformAdmin } from "../auth/guard.js";
import {
  hasPermission,
  requirePermission,
  requireTenant,
  requireTenantForWrite,
  type TenantContext,
} from "../company/tenant.js";
import {
  createBrand,
  createCategory,
  deleteBrand,
  deleteCategory,
  listBrands,
  listCategories,
  updateBrand,
  updateCategory,
} from "./categories.service.js";
import { costHistory, priceSuggestions, productCosts } from "./product-cost.service.js";
import {
  addBatch,
  createProduct,
  deactivateProduct,
  exportProductsCsv,
  getProduct,
  getProductByBarcode,
  importProducts,
  listExpiringBatches,
  listProducts,
  updateProduct,
} from "./products.service.js";
import {
  createConversion,
  createUnit,
  deleteConversion,
  listConversions,
  listUnits,
  updateUnit,
} from "./units.service.js";

// ─── Sxemalar ────────────────────────────────────────────────────────────────

/** Bo'sh satr NULL sifatida saqlanadi. */
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();
const optionalId = z.uuid().nullable().optional();
const boolQuery = z.enum(["true", "false"]).transform((v) => v === "true").optional();

const unitBody = z.strictObject({
  name: z.string().trim().min(1).max(60),
  shortName: z.string().trim().min(1).max(16),
  isBase: z.boolean(),
  /** Kasr miqdor mumkinmi (kg — ha, dona — yo'q); berilmasa — mumkin. */
  allowsFraction: z.boolean().optional(),
});
const unitPatch = unitBody.partial().extend({ isActive: z.boolean().optional() });

const conversionBody = z.strictObject({
  fromUnitId: z.uuid(),
  toUnitId: z.uuid(),
  factor: decimalSchema({ scale: 4, positive: true }),
  productId: optionalId,
});

const categoryBody = z.strictObject({
  name: z.string().trim().min(1).max(200),
  parentId: optionalId,
  description: nullableText(1000),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
});
const categoryPatch = categoryBody.partial().extend({ isActive: z.boolean().optional() });

const brandBody = z.strictObject({
  name: z.string().trim().min(1).max(200),
  description: nullableText(1000),
});
const brandPatch = brandBody.partial().extend({ isActive: z.boolean().optional() });

const currencyCode = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Valyuta kodi 3 harf (ISO 4217)");

// Standart qiymatlar sxemada EMAS — PATCH da berilmagan maydon tiklanib ketmasligi uchun
const productBody = z.strictObject({
  name: z.string().trim().min(1).max(300),
  /** Berilmasa — avtomatik raqam (1001 dan). */
  sku: z.string().trim().min(1).max(64).optional(),
  barcode: nullableText(64),
  qrCode: nullableText(128),
  description: nullableText(5000),
  categoryId: optionalId,
  brandId: optionalId,
  manufacturer: nullableText(200),
  baseUnitId: z.uuid(),
  purchaseUnitId: optionalId,
  salesUnitId: optionalId,
  purchasePrice: priceSchema.optional(),
  salesPrice: priceSchema.optional(),
  wholesalePrice: priceSchema.nullable().optional(),
  retailPrice: priceSchema.nullable().optional(),
  promoPrice: priceSchema.nullable().optional(),
  promoPriceEnd: z.iso.date().nullable().optional(),
  /** Narx valyutasi; null — asosiy valyuta. */
  purchaseCurrency: currencyCode.nullable().optional(),
  salesCurrency: currencyCode.nullable().optional(),
  taxRate: percentSchema.optional(),
  taxIncluded: z.boolean().optional(),
  minStock: qtySchema.optional(),
  maxStock: qtySchema.nullable().optional(),
  reorderPoint: qtySchema.nullable().optional(),
  trackBatch: z.boolean().optional(),
  trackExpiry: z.boolean().optional(),
  shelfLifeDays: z.number().int().min(0).max(36_500).nullable().optional(),
  costingMethod: z.enum(["average", "fifo", "fefo", "manual"]).optional(),
  /** Katalog turi: sotiladigan mahsulot, xom ashyo yoki yarim tayyor. Berilmasa — `product`. */
  kind: z.enum(["product", "raw_material", "semi_finished"]).optional(),
  isSaleable: z.boolean().optional(),
  isPurchaseable: z.boolean().optional(),
  isManufactured: z.boolean().optional(),
  weight: qtySchema.nullable().optional(),
  weightUnit: nullableText(16),
  /** Tarozida tortiladi (miqdor — og'irlik). */
  isWeighted: z.boolean().optional(),
  /** Tarozi PLU kodi (etiketka shtrix-kodida), kompaniyada unikal. */
  pluCode: z.number().int().min(1).max(999_999).nullable().optional(),
});
const productPatch = productBody.partial().extend({ isActive: z.boolean().optional() });

const productListQuery = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  categoryId: z.uuid().optional(),
  brandId: z.uuid().optional(),
  kind: z.enum(["product", "raw_material", "semi_finished"]).optional(),
  isActive: boolQuery,
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(1000).optional(),
  /** Har mahsulot uchun kiritish mumkin bo'lgan birliklar ("dona", "blok") — xarid hujjati uchun. */
  withUnits: boolQuery,
});
const exportQuery = productListQuery.omit({ limit: true, cursor: true, withUnits: true });

const importCell = z.union([z.string().max(1000), z.number()]).optional();
const importBody = z.strictObject({
  /** Preview: faqat tekshirish — bazaga hech narsa yozilmaydi. */
  dryRun: z.boolean().optional(),
  rows: z
    .array(
      z.object({
        name: z.string().max(1000).optional(),
        sku: z.string().max(1000).optional(),
        barcode: z.string().max(1000).optional(),
        unit: z.string().max(100).optional(),
        /** Qadoq birliklari: "blok", "pachka" — `unitsPerPackage` bilan birga keladi. */
        purchaseUnit: z.string().max(100).optional(),
        saleUnit: z.string().max(100).optional(),
        unitsPerPackage: importCell,
        purchasePrice: importCell,
        salesPrice: importCell,
        minStock: importCell,
        category: z.string().max(200).optional(),
        brand: z.string().max(200).optional(),
      }),
    )
    .min(1)
    .max(1000),
});

const batchBody = z.strictObject({
  batchNumber: z.string().trim().min(1).max(64),
  supplierId: optionalId,
  warehouseId: optionalId,
  manufacturedDate: z.iso.date().nullable().optional(),
  expiryDate: z.iso.date().nullable().optional(),
  quantity: qtySchema,
  unitId: z.uuid(),
  costPrice: priceSchema.optional(),
  notes: nullableText(2000),
});
const expiringQuery = z.object({ daysAhead: z.coerce.number().int().min(0).max(3650).default(30) });

const unitParams = z.object({ unitId: z.uuid() });
const conversionParams = z.object({ conversionId: z.uuid() });
const categoryParams = z.object({ categoryId: z.uuid() });
const brandParams = z.object({ brandId: z.uuid() });
const productParams = z.object({ productId: z.uuid() });
const barcodeParams = z.object({ barcode: z.string().trim().min(1).max(64) });
const costQuery = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
/** `unitId` — tavsiya narxi shu birlik uchun keltiriladi; berilmasa asosiy birlik. */
const suggestionQuery = z.object({ unitId: z.uuid().optional() });
const historyQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });
const conversionQuery = z.object({ productId: z.uuid().optional() });
const categoryQuery = z.object({ includeInactive: boolQuery });
const brandQuery = z.object({ isActive: boolQuery });

// ─── Yordamchilar ────────────────────────────────────────────────────────────

async function readTenant(req: FastifyRequest, permission?: Permission): Promise<TenantContext> {
  const tenant = await requireTenant(db, authOf(req).user);
  if (permission) await requirePermission(db, tenant, permission);
  return tenant;
}

/** Mahsulotni ko'rish ruxsati + tannarxni ko'rish huquqi (alohida ruxsat). */
async function readCatalogTenant(req: FastifyRequest): Promise<{ tenant: TenantContext; canViewCost: boolean }> {
  const tenant = await readTenant(req, "products.view");
  return { tenant, canViewCost: await hasPermission(db, tenant, "products.view_cost") };
}

/** Yozish: tranzaksiya ichida tenant (to'xtatilgan/sinov muddati tekshiruvi) + ruxsat. */
function writeInTenant<T>(
  req: FastifyRequest,
  permission: Permission,
  fn: (tx: Parameters<Parameters<typeof withTransaction>[0]>[0], tenant: TenantContext) => Promise<T>,
): Promise<T> {
  return withTransaction(async (tx) => {
    const tenant = await requireTenantForWrite(tx as DbOrTx, authOf(req).user);
    await requirePermission(tx, tenant, permission);
    return fn(tx, tenant);
  });
}

export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // ─── O'lchov birliklari ──────────────────────────────────────────────────

  app.get("/units", async () => ({ units: await listUnits(db) }));

  app.post("/units", { preHandler: requirePlatformAdmin }, async (req, reply) => {
    const body = unitBody.parse(req.body);
    const unit = await withTransaction((tx) => createUnit(tx, authOf(req).user, body, requestMeta(req)));
    reply.status(201);
    return { unit };
  });

  app.patch("/units/:unitId", { preHandler: requirePlatformAdmin }, async (req) => {
    const { unitId } = unitParams.parse(req.params);
    const patch = unitPatch.parse(req.body);
    const unit = await withTransaction((tx) => updateUnit(tx, authOf(req).user, unitId, patch, requestMeta(req)));
    return { unit };
  });

  // ─── Konversiyalar ───────────────────────────────────────────────────────

  app.get("/unit-conversions", async (req) => {
    const { productId } = conversionQuery.parse(req.query);
    return { conversions: await listConversions(db, await readTenant(req), productId) };
  });

  app.post("/unit-conversions", async (req, reply) => {
    const body = conversionBody.parse(req.body);
    const conversion = await writeInTenant(req, "products.manage", (tx, tenant) =>
      createConversion(tx, tenant, body, requestMeta(req)),
    );
    reply.status(201);
    return { conversion };
  });

  app.delete("/unit-conversions/:conversionId", async (req) => {
    const { conversionId } = conversionParams.parse(req.params);
    await writeInTenant(req, "products.manage", (tx, tenant) =>
      deleteConversion(tx, tenant, conversionId, requestMeta(req)),
    );
    return { ok: true };
  });

  // ─── Kategoriyalar ───────────────────────────────────────────────────────

  app.get("/categories", async (req) => {
    const { includeInactive } = categoryQuery.parse(req.query);
    return { categories: await listCategories(db, await readTenant(req), includeInactive ?? false) };
  });

  app.post("/categories", async (req, reply) => {
    const body = categoryBody.parse(req.body);
    const category = await writeInTenant(req, "products.manage", (tx, tenant) =>
      createCategory(tx, tenant, body, requestMeta(req)),
    );
    reply.status(201);
    return { category };
  });

  app.patch("/categories/:categoryId", async (req) => {
    const { categoryId } = categoryParams.parse(req.params);
    const patch = categoryPatch.parse(req.body);
    const category = await writeInTenant(req, "products.manage", (tx, tenant) =>
      updateCategory(tx, tenant, categoryId, patch, requestMeta(req)),
    );
    return { category };
  });

  app.delete("/categories/:categoryId", async (req) => {
    const { categoryId } = categoryParams.parse(req.params);
    await writeInTenant(req, "products.manage", (tx, tenant) =>
      deleteCategory(tx, tenant, categoryId, requestMeta(req)),
    );
    return { ok: true };
  });

  // ─── Brendlar ────────────────────────────────────────────────────────────

  app.get("/brands", async (req) => {
    const { isActive } = brandQuery.parse(req.query);
    return { brands: await listBrands(db, await readTenant(req), isActive) };
  });

  app.post("/brands", async (req, reply) => {
    const body = brandBody.parse(req.body);
    const brand = await writeInTenant(req, "products.manage", (tx, tenant) =>
      createBrand(tx, tenant, body, requestMeta(req)),
    );
    reply.status(201);
    return { brand };
  });

  app.patch("/brands/:brandId", async (req) => {
    const { brandId } = brandParams.parse(req.params);
    const patch = brandPatch.parse(req.body);
    const brand = await writeInTenant(req, "products.manage", (tx, tenant) =>
      updateBrand(tx, tenant, brandId, patch, requestMeta(req)),
    );
    return { brand };
  });

  app.delete("/brands/:brandId", async (req) => {
    const { brandId } = brandParams.parse(req.params);
    await writeInTenant(req, "products.manage", (tx, tenant) => deleteBrand(tx, tenant, brandId, requestMeta(req)));
    return { ok: true };
  });

  // ─── Mahsulotlar ─────────────────────────────────────────────────────────

  app.get("/products", async (req) => {
    const query = productListQuery.parse(req.query);
    const { tenant, canViewCost } = await readCatalogTenant(req);
    return listProducts(db, tenant, { ...query, canViewCost });
  });

  /** Tannarx sahifasi — faqat `products.view_cost`. */
  app.get("/products/costs", async (req) => {
    const query = costQuery.parse(req.query);
    return productCosts(db, await readTenant(req, "products.view_cost"), query);
  });

  /**
   * Xarid hujjatida narx tavsiyalari (oxirgi xarid, o'rtacha xarid, oxirgi sotuv narxi).
   * Faqat ma'lumot qaytaradi — hech narsani o'zgartirmaydi va avtomatik qo'llamaydi.
   */
  app.get("/products/:productId/price-suggestions", async (req) => {
    const { productId } = productParams.parse(req.params);
    const { unitId } = suggestionQuery.parse(req.query);
    return priceSuggestions(db, await readTenant(req, "products.view_cost"), { productId, unitId });
  });

  /** Tannarx tarixi — tovar kelgan xarid hujjatlari (yangisidan eskisiga). */
  app.get("/products/:productId/cost-history", async (req) => {
    const { productId } = productParams.parse(req.params);
    const { limit } = historyQuery.parse(req.query);
    return costHistory(db, await readTenant(req, "products.view_cost"), productId, limit);
  });

  app.get("/products/export", async (req, reply) => {
    const filters = exportQuery.parse(req.query);
    const { tenant, canViewCost } = await readCatalogTenant(req);
    const csv = await exportProductsCsv(db, tenant, filters, { canViewCost });
    const date = new Date().toISOString().slice(0, 10);
    reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="mahsulotlar-${date}.csv"`);
    return csv;
  });

  app.post("/products/import", async (req) => {
    const { rows, dryRun } = importBody.parse(req.body);
    return writeInTenant(req, "products.create", (tx, tenant) => importProducts(tx, tenant, rows, requestMeta(req), { dryRun }));
  });

  app.get("/products/by-barcode/:barcode", async (req) => {
    const { barcode } = barcodeParams.parse(req.params);
    const { tenant, canViewCost } = await readCatalogTenant(req);
    return { product: await getProductByBarcode(db, tenant, barcode, { canViewCost }) };
  });

  app.get("/products/:productId", async (req) => {
    const { productId } = productParams.parse(req.params);
    const { tenant, canViewCost } = await readCatalogTenant(req);
    return { product: await getProduct(db, tenant, productId, { canViewCost }) };
  });

  app.post("/products", async (req, reply) => {
    const body = productBody.parse(req.body);
    const product = await writeInTenant(req, "products.create", (tx, tenant) =>
      createProduct(tx, tenant, body, requestMeta(req)),
    );
    reply.status(201);
    return { product };
  });

  app.patch("/products/:productId", async (req) => {
    const { productId } = productParams.parse(req.params);
    const patch = productPatch.parse(req.body);
    const product = await writeInTenant(req, "products.edit", (tx, tenant) =>
      updateProduct(tx, tenant, productId, patch, requestMeta(req)),
    );
    return { product };
  });

  app.delete("/products/:productId", async (req) => {
    const { productId } = productParams.parse(req.params);
    await writeInTenant(req, "products.delete", (tx, tenant) =>
      deactivateProduct(tx, tenant, productId, requestMeta(req)),
    );
    return { ok: true };
  });

  // ─── Partiyalar ──────────────────────────────────────────────────────────

  app.post("/products/:productId/batches", async (req, reply) => {
    const { productId } = productParams.parse(req.params);
    const body = batchBody.parse(req.body);
    const batch = await writeInTenant(req, "warehouse.manage", (tx, tenant) =>
      addBatch(tx, tenant, productId, body, requestMeta(req)),
    );
    reply.status(201);
    return { batch };
  });

  app.get("/batches/expiring", async (req) => {
    const { daysAhead } = expiringQuery.parse(req.query);
    return { batches: await listExpiringBatches(db, await readTenant(req, "warehouse.view"), daysAhead) };
  });
}
