/**
 * Mahsulot katalogi: birliklar, konversiyalar, kategoriyalar, brendlar,
 * mahsulotlar, partiyalar.
 *
 * Tenant qarori (audit, Blocker 4):
 *   units            → PLATFORMA darajasida qoladi. O'lchov birligi universal
 *                      ("kg", "dona"), yozish faqat platforma adminiga.
 *   unit_conversions → TENANT ga aylanadi. Konversiya koeffitsienti biznesga
 *                      va mahsulotga bog'liq, ya'ni u umumiy bo'la olmaydi.
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { companies } from "./platform.js";
import {
  costingMethod,
  legacyId,
  money,
  percent,
  pk,
  price,
  qty,
  timestamps,
} from "./_shared.js";

// ─── units (platforma) ───────────────────────────────────────────────────────

export const units = pgTable(
  "units",
  {
    id: pk(),
    legacyId: legacyId(),
    name: varchar("name", { length: 60 }).notNull(),
    shortName: varchar("short_name", { length: 16 }).notNull(),
    isBase: boolean("is_base").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("units_name_key").on(t.name),
    uniqueIndex("units_legacy_id_key").on(t.legacyId),
  ],
);

// ─── unit_conversions (tenant) ───────────────────────────────────────────────

export const unitConversions = pgTable(
  "unit_conversions",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    fromUnitId: uuid("from_unit_id").notNull().references(() => units.id),
    toUnitId: uuid("to_unit_id").notNull().references(() => units.id),
    factor: price("factor").notNull(),
    /** NULL = kompaniya bo'yicha umumiy konversiya. */
    productId: uuid("product_id"),
    ...timestamps(),
  },
  (t) => [
    index("unit_conv_company_idx").on(t.companyId),
    // NULLS NOT DISTINCT: umumiy (product_id NULL) konversiya ham takrorlanmasin
    unique("unit_conv_unique")
      .on(t.companyId, t.fromUnitId, t.toUnitId, t.productId)
      .nullsNotDistinct(),
    check("unit_conv_factor_positive", sql`${t.factor} > 0`),
    check("unit_conv_not_self", sql`${t.fromUnitId} <> ${t.toUnitId}`),
  ],
);

// ─── categories ──────────────────────────────────────────────────────────────

export const categories = pgTable(
  "categories",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    name: varchar("name", { length: 200 }).notNull(),
    parentId: uuid("parent_id"),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    index("categories_company_idx").on(t.companyId),
    index("categories_company_parent_idx").on(t.companyId, t.parentId),
  ],
);

// ─── brands ──────────────────────────────────────────────────────────────────

export const brands = pgTable(
  "brands",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    index("brands_company_idx").on(t.companyId),
    uniqueIndex("brands_company_name_key").on(t.companyId, t.name),
  ],
);

// ─── products ────────────────────────────────────────────────────────────────

/** Katalog elementi nimaligi. `product` — sukut (mavjud yozuvlar shunday qoladi). */
export const productKind = pgEnum("product_kind", ["product", "raw_material", "semi_finished"]);

export const products = pgTable(
  "products",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    name: varchar("name", { length: 300 }).notNull(),
    sku: varchar("sku", { length: 64 }).notNull(),
    barcode: varchar("barcode", { length: 64 }),
    qrCode: varchar("qr_code", { length: 128 }),
    description: text("description"),
    /** StorageService kaliti — foydalanuvchi kiritgan tashqi URL emas. */
    imageKey: text("image_key"),

    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    manufacturer: varchar("manufacturer", { length: 200 }),

    baseUnitId: uuid("base_unit_id").notNull().references(() => units.id),
    purchaseUnitId: uuid("purchase_unit_id").references(() => units.id),
    salesUnitId: uuid("sales_unit_id").references(() => units.id),

    purchasePrice: price("purchase_price").notNull().default("0"),
    salesPrice: price("sales_price").notNull().default("0"),
    wholesalePrice: price("wholesale_price"),
    retailPrice: price("retail_price"),
    promoPrice: price("promo_price"),
    promoPriceEnd: date("promo_price_end"),
    /** Narx valyutasi; null — kompaniya asosiy valyutasi. Ulgurji, chakana va aksiya narxi sotuv valyutasida. */
    purchaseCurrency: varchar("purchase_currency", { length: 3 }),
    salesCurrency: varchar("sales_currency", { length: 3 }),

    taxRate: percent("tax_rate").notNull().default("0"),
    taxIncluded: boolean("tax_included").notNull().default(true),

    minStock: qty("min_stock").notNull().default("0"),
    maxStock: qty("max_stock"),
    reorderPoint: qty("reorder_point"),

    trackBatch: boolean("track_batch").notNull().default(false),
    trackExpiry: boolean("track_expiry").notNull().default(false),
    shelfLifeDays: integer("shelf_life_days"),

    /** Hozircha amalda faqat `average` qo'llab-quvvatlanadi — _shared.ts ga qarang. */
    costingMethod: costingMethod("costing_method").notNull().default("average"),

    isActive: boolean("is_active").notNull().default(true),
    /**
     * Nimaligi: sotiladigan mahsulot, xom ashyo (ishlab chiqarishga kiradi) yoki yarim tayyor
     * (ishlab chiqarilgan, lekin yana boshqa mahsulotga kiradi). Qoldiq va harakat ikkalasida bir xil.
     */
    kind: productKind("kind").notNull().default("product"),
    isSaleable: boolean("is_saleable").notNull().default(true),
    isPurchaseable: boolean("is_purchaseable").notNull().default(true),
    isManufactured: boolean("is_manufactured").notNull().default(false),

    weight: qty("weight"),
    weightUnit: varchar("weight_unit", { length: 16 }),
    /** Tarozida tortib sotiladi: miqdor — og'irlik (kassada tarozidan yoki etiketka shtrix-kodidan). */
    isWeighted: boolean("is_weighted").notNull().default(false),
    /** Tarozi PLU kodi — etiketka shtrix-kodidagi mahsulot kodi; kompaniyada unikal. */
    pluCode: integer("plu_code"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("products_company_sku_key").on(t.companyId, t.sku),
    index("products_company_barcode_idx").on(t.companyId, t.barcode),
    index("products_company_category_idx").on(t.companyId, t.categoryId),
    index("products_company_brand_idx").on(t.companyId, t.brandId),
    index("products_company_active_idx").on(t.companyId, t.isActive),
    uniqueIndex("products_legacy_id_key").on(t.legacyId),
    uniqueIndex("products_company_plu_key").on(t.companyId, t.pluCode).where(sql`${t.pluCode} is not null`),
    check("products_prices_non_negative", sql`${t.purchasePrice} >= 0 AND ${t.salesPrice} >= 0`),
    check("products_plu_range", sql`${t.pluCode} is null or ${t.pluCode} between 1 and 999999`),
  ],
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/**
 * Mahsulot rasmi bazada — fayl saqlash (S3) sozlanmagan bo'lsa. `products.image_key` shu yozuvning `key` i (`db/…`)
 * bo'lgandagina amalda; mahsulotga bitta rasm, almashtirilganda ustiga yoziladi.
 */
export const productImages = pgTable(
  "product_images",
  {
    productId: uuid("product_id")
      .primaryKey()
      .references(() => products.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    content: bytea("content").notNull(),
    contentType: varchar("content_type", { length: 50 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    ...timestamps(),
  },
  (t) => [index("product_images_company_idx").on(t.companyId), check("product_images_size_check", sql`${t.sizeBytes} > 0`)],
);

// ─── batches ─────────────────────────────────────────────────────────────────

export const batches = pgTable(
  "batches",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
    batchNumber: varchar("batch_number", { length: 64 }).notNull(),
    supplierId: uuid("supplier_id"),
    warehouseId: uuid("warehouse_id"),

    manufacturedDate: date("manufactured_date"),
    expiryDate: date("expiry_date"),

    quantity: qty("quantity").notNull().default("0"),
    unitId: uuid("unit_id").notNull().references(() => units.id),
    costPrice: price("cost_price").notNull().default("0"),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    index("batches_company_product_idx").on(t.companyId, t.productId),
    index("batches_company_expiry_idx").on(t.companyId, t.expiryDate),
    check("batches_quantity_non_negative", sql`${t.quantity} >= 0`),
  ],
);

// ─── relations ───────────────────────────────────────────────────────────────

export const productsRelations = relations(products, ({ one, many }) => ({
  company: one(companies, { fields: [products.companyId], references: [companies.id] }),
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  brand: one(brands, { fields: [products.brandId], references: [brands.id] }),
  baseUnit: one(units, { fields: [products.baseUnitId], references: [units.id] }),
  batches: many(batches),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: "category_parent",
  }),
  children: many(categories, { relationName: "category_parent" }),
  products: many(products),
}));

export const batchesRelations = relations(batches, ({ one }) => ({
  product: one(products, { fields: [batches.productId], references: [products.id] }),
  unit: one(units, { fields: [batches.unitId], references: [units.id] }),
}));
