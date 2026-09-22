/**
 * Mahsulotlar va partiyalar (convex/products/products.ts).
 *
 * Convex'dan farqlar:
 *  - getByBarcode global indeksdan birinchi mahsulotni olib, keyin kompaniyani
 *    tekshirardi — boshqa kompaniyada shu shtrix-kod bo'lsa, o'z mahsulotini
 *    topa olmasdi. Endi qidiruv kompaniya ichida
 *  - list/getById ruxsat tekshirmasdi — endi `products.view`
 *  - narxlar float edi — endi numeric satr (shared/decimal.ts)
 *  - costingMethod: amalda faqat AVCO ishlaydi (audit Blocker 1) — boshqa usul
 *    tanlansa aniq xato, jimgina AVCO ga o'tib ketmaydi
 *  - imageUrl (foydalanuvchi kiritgan tashqi URL — saqlangan XSS yo'li) qabul
 *    qilinmaydi; rasm fayl saqlash bilan PHASE 14 da (`image_key`)
 *  - CSV import serverda: qatorma-qator xatolar, noma'lum o'lchov birligi rad
 *    etiladi (Convex frontendi jimgina birinchi birlikni qo'yardi)
 */
import { and, asc, eq, getTableColumns, gt, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { badRequest, notFound } from "@bum/shared";
import { batches, brands, categories, productKind, products, unitConversions, units } from "../../db/schema/catalog.js";

/** Katalog turi — sxemadagi enum bilan bir xil. */
export type ProductKind = (typeof productKind.enumValues)[number];
import { warehouses } from "../../db/schema/inventory.js";
import { suppliers } from "../../db/schema/purchase.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { cleanNumber } from "../../shared/csv.js";
import { UUID_RE, decodeCursor, encodeCursor } from "../../shared/cursor.js";
import { priceSchema, qtySchema } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { companyCurrency } from "../finance/accounts.service.js";
import { currencyRate } from "../finance/currencies.service.js";
import { assertUnitsActive, listUnits } from "./units.service.js";
import {
  assertCategoryInScope,
  assertProductCategoryInScope,
  categoryScope,
  productScopeCondition,
} from "./category-scope.js";

const { legacyId: _productLegacy, companyId: _productCompany, ...productFields } = getTableColumns(products);
const { legacyId: _batchLegacy, companyId: _batchCompany, ...batchFields } = getTableColumns(batches);

const purchaseUnit = alias(units, "purchase_unit");
const salesUnit = alias(units, "sales_unit");

const MAX_EXPORT_ROWS = 10_000;
const IMPORT_CHUNK = 500;

function audit(
  tx: Tx,
  tenant: TenantContext,
  meta: RequestMeta,
  entry: { action: string; resource: string; resourceId: string; details?: Record<string, unknown> },
) {
  return writeAuditLog(
    { userId: tenant.user.id, userName: tenant.user.name, companyId: tenant.company.id, ...entry, ...meta },
    tx,
  );
}

function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// ─── O'qish ──────────────────────────────────────────────────────────────────

export type ProductFilters = {
  search?: string;
  categoryId?: string;
  brandId?: string;
  isActive?: boolean;
  /** Katalog turi: mahsulot, xom ashyo yoki yarim tayyor. */
  kind?: ProductKind;
};

function productWhere(tenant: TenantContext, f: ProductFilters, scope: string[] | null) {
  const pattern = f.search ? likePattern(f.search) : null;
  return and(
    eq(products.companyId, tenant.company.id),
    productScopeCondition(scope),
    f.categoryId ? eq(products.categoryId, f.categoryId) : undefined,
    f.kind ? eq(products.kind, f.kind) : undefined,
    f.brandId ? eq(products.brandId, f.brandId) : undefined,
    f.isActive === undefined ? undefined : eq(products.isActive, f.isActive),
    pattern
      ? or(ilike(products.name, pattern), ilike(products.sku, pattern), ilike(products.barcode, pattern))
      : undefined,
  );
}

/**
 * Kirim narxi (tannarx) `products.view_cost` ruxsatisiz QAYTARILMAYDI: kassir va sotuv agenti
 * mahsulotni ko'radi, lekin firma uni qanchaga olganini ko'rmaydi. Filtrlash serverda — brauzerdagi
 * yashirish himoya emas.
 */
function stripCost<T extends { purchasePrice?: string }>(row: T, canViewCost: boolean): T {
  if (canViewCost) return row;
  const { purchasePrice: _hidden, ...rest } = row;
  return rest as T;
}

/** Nom bo'yicha tartib, `(name, id)` kursori. */
export async function listProducts(
  conn: DbOrTx,
  tenant: TenantContext,
  options: ProductFilters & { limit: number; cursor?: string; canViewCost?: boolean },
) {
  let after: { name: string; id: string } | null = null;
  if (options.cursor) {
    const [name, id] = decodeCursor(options.cursor, 2) as [string, string];
    if (!UUID_RE.test(id)) throw badRequest("Kursor noto'g'ri");
    after = { name, id };
  }

  const rows = await conn
    .select({
      ...productFields,
      categoryName: categories.name,
      brandName: brands.name,
      baseUnitName: units.shortName,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(brands, eq(brands.id, products.brandId))
    .innerJoin(units, eq(units.id, products.baseUnitId))
    .where(
      and(
        productWhere(tenant, options, await categoryScope(conn, tenant)),
        after
          ? or(gt(products.name, after.name), and(eq(products.name, after.name), gt(products.id, after.id)))
          : undefined,
      ),
    )
    .orderBy(asc(products.name), asc(products.id))
    .limit(options.limit + 1);

  const page = rows.slice(0, options.limit);
  const last = page.at(-1);
  return {
    products: page.map((row) => stripCost(row, options.canViewCost === true)),
    nextCursor: rows.length > options.limit && last ? encodeCursor([last.name, last.id]) : null,
  };
}

export async function getProduct(
  conn: DbOrTx,
  tenant: TenantContext,
  productId: string,
  options: { canViewCost?: boolean } = {},
) {
  const [row] = await conn
    .select({
      ...productFields,
      categoryName: categories.name,
      brandName: brands.name,
      baseUnitName: units.shortName,
      purchaseUnitName: purchaseUnit.shortName,
      salesUnitName: salesUnit.shortName,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(brands, eq(brands.id, products.brandId))
    .innerJoin(units, eq(units.id, products.baseUnitId))
    .leftJoin(purchaseUnit, eq(purchaseUnit.id, products.purchaseUnitId))
    .leftJoin(salesUnit, eq(salesUnit.id, products.salesUnitId))
    .where(
      and(
        eq(products.id, productId),
        eq(products.companyId, tenant.company.id),
        productScopeCondition(await categoryScope(conn, tenant)),
      ),
    )
    .limit(1);
  if (!row) throw notFound("Mahsulot topilmadi");

  const productBatches = await conn
    .select(batchFields)
    .from(batches)
    .where(and(eq(batches.productId, productId), eq(batches.companyId, tenant.company.id)))
    .orderBy(asc(batches.expiryDate), asc(batches.createdAt));

  return { ...stripCost(row, options.canViewCost === true), batches: productBatches };
}

export async function getProductByBarcode(
  conn: DbOrTx,
  tenant: TenantContext,
  barcode: string,
  options: { canViewCost?: boolean } = {},
) {
  const [row] = await conn
    .select({ ...productFields, baseUnitName: units.shortName })
    .from(products)
    .innerJoin(units, eq(units.id, products.baseUnitId))
    .where(
      and(
        eq(products.companyId, tenant.company.id),
        eq(products.barcode, barcode),
        productScopeCondition(await categoryScope(conn, tenant)),
      ),
    )
    .orderBy(asc(products.createdAt))
    .limit(1);
  if (!row) throw notFound("Mahsulot topilmadi");
  return stripCost(row, options.canViewCost === true);
}

// ─── Yozish ──────────────────────────────────────────────────────────────────

export type CostingMethod = "average" | "fifo" | "fefo" | "manual";

export type ProductInput = {
  name: string;
  /** Berilmasa — `nextNumericSku`. */
  sku?: string;
  barcode?: string | null;
  qrCode?: string | null;
  description?: string | null;
  categoryId?: string | null;
  brandId?: string | null;
  manufacturer?: string | null;
  baseUnitId: string;
  purchaseUnitId?: string | null;
  salesUnitId?: string | null;
  purchasePrice?: string;
  salesPrice?: string;
  wholesalePrice?: string | null;
  retailPrice?: string | null;
  promoPrice?: string | null;
  promoPriceEnd?: string | null;
  /** null yoki asosiy valyuta — asosiy valyuta (null saqlanadi); boshqasi kompaniyada yoqilgan bo'lishi kerak. */
  purchaseCurrency?: string | null;
  salesCurrency?: string | null;
  taxRate?: string;
  taxIncluded?: boolean;
  minStock?: string;
  maxStock?: string | null;
  reorderPoint?: string | null;
  trackBatch?: boolean;
  trackExpiry?: boolean;
  shelfLifeDays?: number | null;
  costingMethod?: CostingMethod;
  kind?: ProductKind;
  isSaleable?: boolean;
  isPurchaseable?: boolean;
  isManufactured?: boolean;
  weight?: string | null;
  weightUnit?: string | null;
  isWeighted?: boolean;
  pluCode?: number | null;
};

const FIRST_AUTO_SKU = 1001n;

/**
 * Avtomatik SKU: kompaniyadagi eng katta raqamli SKU + 1, lekin 1001 dan kam emas.
 * Parallel yaratishda takrorlanmasligi uchun kompaniya bo'yicha advisory lock (unique indeks — ikkinchi qatlam).
 */
export async function nextNumericSku(tx: Tx, companyId: string): Promise<bigint> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${companyId}:product-sku`}))`);
  const [row] = await tx
    .select({ last: sql<string | null>`max(${products.sku}::bigint)` })
    .from(products)
    .where(and(eq(products.companyId, companyId), sql`${products.sku} ~ '^[0-9]{1,18}$'`));
  const next = BigInt(row?.last ?? "0") + 1n;
  return next < FIRST_AUTO_SKU ? FIRST_AUTO_SKU : next;
}

function assertCostingMethod(method: CostingMethod | undefined): void {
  if (method !== undefined && method !== "average") {
    throw badRequest("Hozircha faqat o'rtacha tannarx (average) usuli qo'llab-quvvatlanadi");
  }
}

/** Kategoriya, brend (shu kompaniyaniki) va o'lchov birliklari (faol) tekshiruvi. */
async function assertReferences(tx: Tx, tenant: TenantContext, input: Partial<ProductInput>): Promise<void> {
  if (input.categoryId) {
    const [category] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, input.categoryId), eq(categories.companyId, tenant.company.id)))
      .limit(1);
    if (!category) throw badRequest("Kategoriya topilmadi");
  }
  if (input.brandId) {
    const [brand] = await tx
      .select({ id: brands.id })
      .from(brands)
      .where(and(eq(brands.id, input.brandId), eq(brands.companyId, tenant.company.id)))
      .limit(1);
    if (!brand) throw badRequest("Brend topilmadi");
  }
  await assertUnitsActive(tx, [input.baseUnitId, input.purchaseUnitId, input.salesUnitId]);
}

/** Narx valyutasi: asosiy valyuta — null; boshqasi kompaniyada yoqilgan bo'lishi kerak. */
async function normalizeCurrency(tx: Tx, companyId: string, code: string | null | undefined) {
  if (code === undefined || code === null) return code;
  if (code === (await companyCurrency(tx, companyId))) return null;
  await currencyRate(tx, companyId, code);
  return code;
}

async function normalizeCurrencies<T extends Partial<ProductInput>>(tx: Tx, companyId: string, input: T): Promise<T> {
  const purchaseCurrency = await normalizeCurrency(tx, companyId, input.purchaseCurrency);
  const salesCurrency = await normalizeCurrency(tx, companyId, input.salesCurrency);
  return {
    ...input,
    ...(purchaseCurrency !== undefined ? { purchaseCurrency } : {}),
    ...(salesCurrency !== undefined ? { salesCurrency } : {}),
  };
}

async function loadProductForUpdate(tx: Tx, tenant: TenantContext, productId: string) {
  const [product] = await tx
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      isActive: products.isActive,
      categoryId: products.categoryId,
    })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.companyId, tenant.company.id)))
    .limit(1)
    .for("update");
  if (!product) throw notFound("Mahsulot topilmadi");
  assertProductCategoryInScope(await categoryScope(tx, tenant), product.categoryId);
  return product;
}

/** Tarozi PLU kodi kompaniyada band emas (unikal indeks — ikkinchi qatlam, bu yerda tushunarli xabar). */
async function assertPluFree(tx: Tx, companyId: string, pluCode: number | null | undefined, exceptProductId?: string) {
  if (pluCode === null || pluCode === undefined) return;
  const [taken] = await tx
    .select({ name: products.name })
    .from(products)
    .where(and(eq(products.companyId, companyId), eq(products.pluCode, pluCode), exceptProductId ? sql`${products.id} <> ${exceptProductId}` : undefined))
    .limit(1);
  if (taken) throw badRequest(`PLU ${pluCode} band: ${taken.name}`);
}

export async function createProduct(tx: Tx, tenant: TenantContext, rawInput: ProductInput, meta: RequestMeta) {
  assertCostingMethod(rawInput.costingMethod);
  await assertReferences(tx, tenant, rawInput);
  const input = await normalizeCurrencies(tx, tenant.company.id, rawInput);
  // Cheklangan xodim mahsulotni faqat o'z kategoriyasida yaratadi (kategoriyasiz — yo'q)
  assertCategoryInScope(await categoryScope(tx, tenant), input.categoryId);
  await assertPluFree(tx, tenant.company.id, input.pluCode);

  const [product] = await tx
    .insert(products)
    .values({
      ...input,
      sku: input.sku ?? (await nextNumericSku(tx, tenant.company.id)).toString(),
      costingMethod: "average",
      companyId: tenant.company.id,
    })
    .returning(productFields);

  await audit(tx, tenant, meta, {
    action: "PRODUCT_CREATED",
    resource: "products",
    resourceId: product!.id,
    details: { name: product!.name, sku: product!.sku },
  });
  return product!;
}

export async function updateProduct(
  tx: Tx,
  tenant: TenantContext,
  productId: string,
  patch: Partial<ProductInput> & { isActive?: boolean },
  meta: RequestMeta,
) {
  const current = await loadProductForUpdate(tx, tenant, productId);
  assertCostingMethod(patch.costingMethod);
  await assertReferences(tx, tenant, patch);
  if (patch.categoryId !== undefined) assertCategoryInScope(await categoryScope(tx, tenant), patch.categoryId);
  await assertPluFree(tx, tenant.company.id, patch.pluCode, current.id);

  const { costingMethod: _costing, ...fields } = await normalizeCurrencies(tx, tenant.company.id, patch);
  const [updated] = await tx
    .update(products)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(products.id, current.id))
    .returning(productFields);

  await audit(tx, tenant, meta, {
    action: "PRODUCT_UPDATED",
    resource: "products",
    resourceId: current.id,
    details: { sku: updated!.sku, changes: Object.keys(patch) },
  });
  return updated!;
}

/** Convex'dagi remove kabi — o'chirmaydi, faolsizlantiradi (tarix va hujjatlar saqlanadi). */
export async function deactivateProduct(tx: Tx, tenant: TenantContext, productId: string, meta: RequestMeta) {
  const current = await loadProductForUpdate(tx, tenant, productId);
  if (!current.isActive) return;
  await tx.update(products).set({ isActive: false, updatedAt: new Date() }).where(eq(products.id, current.id));
  await audit(tx, tenant, meta, {
    action: "PRODUCT_DEACTIVATED",
    resource: "products",
    resourceId: current.id,
    details: { sku: current.sku, name: current.name },
  });
}

// ─── Partiyalar ──────────────────────────────────────────────────────────────

export type BatchInput = {
  batchNumber: string;
  supplierId?: string | null;
  warehouseId?: string | null;
  manufacturedDate?: string | null;
  expiryDate?: string | null;
  quantity: string;
  unitId: string;
  costPrice?: string;
  notes?: string | null;
};

export async function addBatch(
  tx: Tx,
  tenant: TenantContext,
  productId: string,
  input: BatchInput,
  meta: RequestMeta,
) {
  const product = await loadProductForUpdate(tx, tenant, productId);
  await assertUnitsActive(tx, [input.unitId]);

  if (input.manufacturedDate && input.expiryDate && input.expiryDate < input.manufacturedDate) {
    throw badRequest("Yaroqlilik muddati ishlab chiqarilgan sanadan oldin bo'lishi mumkin emas");
  }
  if (input.warehouseId) {
    const [warehouse] = await tx
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.id, input.warehouseId), eq(warehouses.companyId, tenant.company.id)))
      .limit(1);
    if (!warehouse) throw badRequest("Ombor topilmadi");
  }
  if (input.supplierId) {
    const [supplier] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.id, input.supplierId), eq(suppliers.companyId, tenant.company.id)))
      .limit(1);
    if (!supplier) throw badRequest("Ta'minotchi topilmadi");
  }

  const [batch] = await tx
    .insert(batches)
    .values({ ...input, productId: product.id, companyId: tenant.company.id })
    .returning(batchFields);

  await audit(tx, tenant, meta, {
    action: "BATCH_CREATED",
    resource: "batches",
    resourceId: batch!.id,
    details: { productId: product.id, batchNumber: batch!.batchNumber, quantity: batch!.quantity },
  });
  return batch!;
}

export async function listExpiringBatches(conn: DbOrTx, tenant: TenantContext, daysAhead: number) {
  const today = new Date();
  const cutoff = new Date(today.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  return conn
    .select({ ...batchFields, productName: products.name, productSku: products.sku })
    .from(batches)
    .innerJoin(products, eq(products.id, batches.productId))
    .where(
      and(
        eq(batches.companyId, tenant.company.id),
        gte(batches.expiryDate, iso(today)),
        lte(batches.expiryDate, iso(cutoff)),
      ),
    )
    .orderBy(asc(batches.expiryDate));
}

// ─── CSV import / export ─────────────────────────────────────────────────────

export type ImportRow = {
  name?: string;
  sku?: string;
  barcode?: string;
  /** ASOSIY birlik (qoldiq va tannarx shunda yuritiladi) — berilmasa "dona". */
  unit?: string;
  /** Xarid qilinadigan birlik ("blok", "pachka") — `unitsPerPackage` bilan birga. */
  purchaseUnit?: string;
  /** Sotiladigan birlik; berilmasa asosiy birlik. */
  saleUnit?: string;
  /** 1 qadoqda nechta asosiy birlik bor (1 blok = 6 dona → 6). */
  unitsPerPackage?: string | number;
  purchasePrice?: string | number;
  salesPrice?: string | number;
  minStock?: string | number;
  category?: string;
  brand?: string;
};

export type ImportError = { row: number; sku: string | null; message: string };

/**
 * Preview qatori: foydalanuvchi importdan OLDIN nima bo'lishini ko'radi —
 * normallashtirilgan narx, qadoq konversiyasi va bitta asosiy birlikka tushadigan tannarx.
 */
export type ImportPreviewRow = {
  row: number;
  status: "new" | "duplicate" | "error";
  name: string;
  sku: string;
  barcode: string | null;
  /** Asosiy birlik nomi (qoldiq shunda). */
  baseUnit: string;
  /** Xarid birligi va 1 qadoqdagi asosiy birlik soni; qadoq yo'q bo'lsa null. */
  purchaseUnit: string | null;
  unitsPerPackage: string | null;
  /** Faylda yozilgani va tizim tushungan qiymat — noaniqlik yashirilmaydi. */
  purchasePriceRaw: string;
  purchasePrice: string;
  salesPriceRaw: string;
  salesPrice: string;
  /**
   * Bitta ASOSIY birlikka tushadigan kirim narxi: xarid birligi qadoq bo'lsa
   * `purchasePrice / unitsPerPackage`, aks holda `purchasePrice`.
   */
  unitCost: string;
  message: string | null;
};

/** Xato yoki dublikat qatorining preview ko'rinishi — sababi bilan. */
function errorPreview(item: ImportError, status: "error" | "duplicate"): ImportPreviewRow {
  return {
    row: item.row,
    status,
    name: "",
    sku: item.sku ?? "",
    barcode: null,
    baseUnit: "",
    purchaseUnit: null,
    unitsPerPackage: null,
    purchasePriceRaw: "",
    purchasePrice: "0",
    salesPriceRaw: "",
    salesPrice: "0",
    unitCost: "0",
    message: item.message,
  };
}

export async function importProducts(
  tx: Tx,
  tenant: TenantContext,
  rows: ImportRow[],
  meta: RequestMeta,
  options: { dryRun?: boolean } = {},
) {
  const companyId = tenant.company.id;
  const dryRun = options.dryRun === true;

  const unitIndex = new Map<string, string>();
  for (const unit of await listUnits(tx)) {
    unitIndex.set(unit.shortName.toLowerCase(), unit.id);
    unitIndex.set(unit.name.toLowerCase(), unit.id);
  }
  const defaultUnitId = unitIndex.get("d") ?? unitIndex.get("dona");

  const categoryIndex = new Map(
    (await tx.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.companyId, companyId)))
      .map((c) => [c.name.toLowerCase(), c.id]),
  );
  const brandIndex = new Map(
    (await tx.select({ id: brands.id, name: brands.name }).from(brands).where(eq(brands.companyId, companyId)))
      .map((b) => [b.name.toLowerCase(), b.id]),
  );

  const scope = await categoryScope(tx, tenant);

  const fileSkus = [...new Set(rows.map((r) => r.sku?.trim()).filter((s): s is string => Boolean(s)))];
  const taken = new Set(
    fileSkus.length === 0
      ? []
      : (await tx
          .select({ sku: products.sku })
          .from(products)
          .where(and(eq(products.companyId, companyId), inArray(products.sku, fileSkus))))
          .map((p) => p.sku),
  );

  const errors: ImportError[] = [];
  const duplicates: ImportError[] = [];
  const warnings: ImportError[] = [];
  const values: (typeof products.$inferInsert)[] = [];
  /** Qadoq konversiyalari — mahsulotlar yozilgandan keyin id bo'yicha bog'lanadi. */
  const conversions: { sku: string; fromUnitId: string; toUnitId: string; factor: string }[] = [];
  const preview: ImportPreviewRow[] = [];
  const unitNameById = new Map((await listUnits(tx)).map((unit) => [unit.id, unit.shortName]));
  let autoSku = await nextNumericSku(tx, companyId);

  rows.forEach((row, index) => {
    const line = index + 1;
    const name = row.name?.trim() ?? "";
    let sku = row.sku?.trim() ?? "";
    const fail = (message: string) => errors.push({ row: line, sku: sku || null, message });

    if (!name) return fail("Nomi majburiy");
    if (!sku) {
      // SKU berilmasa — avtomatik raqam (1001 dan), fayldagi va bazadagilar bilan to'qnashmasdan
      while (taken.has(autoSku.toString())) autoSku += 1n;
      sku = autoSku.toString();
      autoSku += 1n;
    }
    if (name.length > 300 || sku.length > 64) return fail("Nomi yoki SKU juda uzun");
    // CREATE ONLY: mavjud SKU — xato emas, dublikat (yangi mahsulot ochilmaydi)
    if (taken.has(sku)) {
      duplicates.push({ row: line, sku, message: "Bu SKU allaqachon mavjud" });
      return;
    }

    const unitKey = row.unit?.trim().toLowerCase();
    const baseUnitId = unitKey ? unitIndex.get(unitKey) : defaultUnitId;
    if (!baseUnitId) return fail(`O'lchov birligi topilmadi: ${row.unit ?? ""}`);

    // Xarid va sotuv birligi — asosiy birlikdan farq qilsa, konversiya majburiy
    const purchaseUnitKey = row.purchaseUnit?.trim().toLowerCase();
    const purchaseUnitId = purchaseUnitKey ? unitIndex.get(purchaseUnitKey) : null;
    if (purchaseUnitKey && !purchaseUnitId) return fail(`Xarid birligi topilmadi: ${row.purchaseUnit}`);
    const saleUnitKey = row.saleUnit?.trim().toLowerCase();
    const saleUnitId = saleUnitKey ? unitIndex.get(saleUnitKey) : null;
    if (saleUnitKey && !saleUnitId) return fail(`Sotuv birligi topilmadi: ${row.saleUnit}`);

    const packText = cleanNumber(row.unitsPerPackage);
    const packParsed = qtySchema.safeParse(packText);
    if (!packParsed.success) return fail("Qadoqdagi miqdor noto'g'ri son");
    const perPackage = Number(packParsed.data);
    // "1 blok = 6 dona" — blok ko'rsatilgan bo'lsa, nechtaligi ham aytilishi shart,
    // aks holda 10 blok 10 dona bo'lib tushib ketardi
    if (purchaseUnitId && purchaseUnitId !== baseUnitId && perPackage <= 0) {
      return fail(`"${row.purchaseUnit}" uchun 1 qadoqdagi miqdor ko'rsatilmagan`);
    }
    if (saleUnitId && saleUnitId !== baseUnitId && saleUnitId !== purchaseUnitId && perPackage <= 0) {
      return fail(`"${row.saleUnit}" uchun 1 qadoqdagi miqdor ko'rsatilmagan`);
    }
    if (perPackage > 0 && !purchaseUnitId && !saleUnitId) {
      warnings.push({ row: line, sku, message: "Qadoqdagi miqdor ko'rsatilgan, lekin qadoq birligi yo'q — e'tiborsiz qoldirildi" });
    }

    const purchasePrice = priceSchema.safeParse(cleanNumber(row.purchasePrice));
    const salesPrice = priceSchema.safeParse(cleanNumber(row.salesPrice));
    const minStock = qtySchema.safeParse(cleanNumber(row.minStock));
    if (!purchasePrice.success || !salesPrice.success || !minStock.success) {
      return fail("Narx yoki qoldiq noto'g'ri son");
    }

    const categoryId = row.category ? (categoryIndex.get(row.category.trim().toLowerCase()) ?? null) : null;
    if (scope !== null && (!categoryId || !scope.includes(categoryId))) {
      return fail("Kategoriya ko'rsatilmagan yoki sizga biriktirilmagan");
    }

    const barcode = row.barcode?.trim();
    taken.add(sku);
    values.push({
      companyId,
      name,
      sku,
      barcode: barcode ? barcode.slice(0, 64) : null,
      baseUnitId,
      purchaseUnitId: purchaseUnitId ?? null,
      salesUnitId: saleUnitId ?? null,
      purchasePrice: purchasePrice.data,
      salesPrice: salesPrice.data,
      minStock: minStock.data,
      categoryId,
      brandId: row.brand ? (brandIndex.get(row.brand.trim().toLowerCase()) ?? null) : null,
    });

    // Qadoq → asosiy birlik konversiyasi (mahsulotga xos). Xarid va sotuv birligi bir xil bo'lsa bitta yozuv.
    const packUnits = [...new Set([purchaseUnitId, saleUnitId].filter((id): id is string => Boolean(id) && id !== baseUnitId))];
    if (perPackage > 0) {
      for (const unitId of packUnits) {
        conversions.push({ sku, fromUnitId: unitId, toUnitId: baseUnitId, factor: packParsed.data });
      }
    }

    preview.push({
      row: line,
      status: "new",
      name,
      sku,
      barcode: barcode ? barcode.slice(0, 64) : null,
      baseUnit: unitNameById.get(baseUnitId) ?? "",
      purchaseUnit: purchaseUnitId ? (unitNameById.get(purchaseUnitId) ?? null) : null,
      unitsPerPackage: perPackage > 0 ? packParsed.data : null,
      purchasePriceRaw: String(row.purchasePrice ?? ""),
      purchasePrice: purchasePrice.data,
      salesPriceRaw: String(row.salesPrice ?? ""),
      salesPrice: salesPrice.data,
      // Kirim narxi qadoq uchun berilgan bo'lsa — bitta asosiy birlikka tushadigan tannarx
      unitCost:
        purchaseUnitId && purchaseUnitId !== baseUnitId && perPackage > 0
          ? (Number(purchasePrice.data) / perPackage).toFixed(4)
          : purchasePrice.data,
      message: null,
    });
  });

  // Xato va dublikat qatorlari ham previewda ko'rinsin (foydalanuvchi sababini ko'radi)
  for (const item of errors) preview.push(errorPreview(item, "error"));
  for (const item of duplicates) preview.push(errorPreview(item, "duplicate"));
  preview.sort((a, b) => a.row - b.row);

  // Preview (`dryRun`): tekshiruv tugadi — bazaga hech narsa yozilmaydi
  if (dryRun) return { created: 0, valid: values.length, errors, duplicates, warnings, preview, dryRun: true };

  const insertedIds = new Map<string, string>();
  for (let i = 0; i < values.length; i += IMPORT_CHUNK) {
    const chunk = await tx
      .insert(products)
      .values(values.slice(i, i + IMPORT_CHUNK))
      .returning({ id: products.id, sku: products.sku });
    for (const item of chunk) insertedIds.set(item.sku, item.id);
  }

  // Qadoq konversiyalari: "1 blok = 6 dona" — xarid va sotuv shu koeffitsientdan foydalanadi
  const conversionValues = conversions
    .map((item) => ({
      companyId,
      productId: insertedIds.get(item.sku) ?? null,
      fromUnitId: item.fromUnitId,
      toUnitId: item.toUnitId,
      factor: item.factor,
    }))
    .filter((item) => item.productId !== null);
  for (let i = 0; i < conversionValues.length; i += IMPORT_CHUNK) {
    await tx.insert(unitConversions).values(conversionValues.slice(i, i + IMPORT_CHUNK));
  }

  await audit(tx, tenant, meta, {
    action: "PRODUCTS_IMPORTED",
    resource: "products",
    resourceId: "import",
    details: { created: values.length, failed: errors.length, duplicates: duplicates.length, conversions: conversionValues.length },
  });
  return { created: values.length, valid: values.length, errors, duplicates, warnings, preview, dryRun: false };
}

const CSV_HEADER = ["Nomi", "SKU", "Shtrix-kod", "Kategoriya", "Brend", "O'lchov birligi", "Kirim narxi", "Sotuv narxi", "Min. qoldiq", "Faol"];
/** Tannarx ruxsatisiz eksportda "Kirim narxi" ustuni butunlay bo'lmaydi. */
const CSV_HEADER_NO_COST = CSV_HEADER.filter((title) => title !== "Kirim narxi");

/** Excel formula injection'dan himoya: =, +, -, @ bilan boshlangan matn apostrof bilan. */
function csvText(value: string | null | undefined): string {
  const text = value ?? "";
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function exportProductsCsv(
  conn: DbOrTx,
  tenant: TenantContext,
  filters: ProductFilters,
  options: { canViewCost?: boolean } = {},
): Promise<string> {
  const canViewCost = options.canViewCost === true;
  const rows = await conn
    .select({
      name: products.name,
      sku: products.sku,
      barcode: products.barcode,
      categoryName: categories.name,
      brandName: brands.name,
      unit: units.shortName,
      purchasePrice: products.purchasePrice,
      salesPrice: products.salesPrice,
      minStock: products.minStock,
      isActive: products.isActive,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(brands, eq(brands.id, products.brandId))
    .innerJoin(units, eq(units.id, products.baseUnitId))
    .where(productWhere(tenant, filters, await categoryScope(conn, tenant)))
    .orderBy(asc(products.name), asc(products.id))
    .limit(MAX_EXPORT_ROWS);

  const lines = [
    (canViewCost ? CSV_HEADER : CSV_HEADER_NO_COST).map(csvText).join(","),
    ...rows.map((r) =>
      [
        csvText(r.name),
        csvText(r.sku),
        csvText(r.barcode),
        csvText(r.categoryName),
        csvText(r.brandName),
        csvText(r.unit),
        ...(canViewCost ? [r.purchasePrice] : []),
        r.salesPrice,
        r.minStock,
        r.isActive ? "ha" : "yo'q",
      ].join(","),
    ),
  ];
  // UTF-8 BOM — Excel kirillcha/o'zbekcha belgilarni to'g'ri ochishi uchun
  return String.fromCharCode(0xfeff) + lines.join("\r\n");
}
