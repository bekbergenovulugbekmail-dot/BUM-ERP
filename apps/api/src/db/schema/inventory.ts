/**
 * Ombor va zaxira.
 *
 * `stock_levels.quantity >= 0` cheklovi DB darajasida — Convexda bu himoya
 * faqat bitta kod yo'lida bor edi (warehouse/stock.ts:146). Endi ilova
 * mantig'i xato qilsa ham manfiy zaxira yozilmaydi.
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { companies, users } from "./platform.js";
import { batches, products, units } from "./catalog.js";
import { legacyId, pk, price, qty, timestamps } from "./_shared.js";

export const stockMovementType = pgEnum("stock_movement_type", [
  "receive",
  "issue",
  "transfer_out",
  "transfer_in",
  "adjust",
  "writeoff",
  "return_in",
  "return_out",
  "count",
]);

export const warehouseZoneType = pgEnum("warehouse_zone_type", [
  "zone",
  "rack",
  "shelf",
  "bin",
]);

export const inventoryCountStatus = pgEnum("inventory_count_status", [
  "draft",
  "in_progress",
  "completed",
  "cancelled",
]);

// ─── warehouses ──────────────────────────────────────────────────────────────

export const warehouses = pgTable(
  "warehouses",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    name: varchar("name", { length: 200 }).notNull(),
    code: varchar("code", { length: 32 }).notNull(),
    address: text("address"),
    city: varchar("city", { length: 100 }),
    phone: varchar("phone", { length: 20 }),
    managerId: uuid("manager_id").references(() => users.id, { onDelete: "set null" }),
    branchId: uuid("branch_id"),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("warehouses_company_code_key").on(t.companyId, t.code),
    index("warehouses_company_idx").on(t.companyId),
    uniqueIndex("warehouses_legacy_id_key").on(t.legacyId),
    /** Har kompaniyada bitta asosiy ombor. */
    uniqueIndex("warehouses_one_default_per_company_key")
      .on(t.companyId)
      .where(sql`${t.isDefault}`),
  ],
);

// ─── warehouse_zones ─────────────────────────────────────────────────────────

export const warehouseZones = pgTable(
  "warehouse_zones",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),

    name: varchar("name", { length: 100 }).notNull(),
    type: warehouseZoneType("type").notNull().default("zone"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [index("wz_company_warehouse_idx").on(t.companyId, t.warehouseId)],
);

// ─── stock_levels ────────────────────────────────────────────────────────────

export const stockLevels = pgTable(
  "stock_levels",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
    warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id, { onDelete: "restrict" }),

    quantity: qty("quantity").notNull().default("0"),
    reservedQty: qty("reserved_qty").notNull().default("0"),
    /** AVCO — o'rtacha tannarx. Yagona amalda ishlaydigan baholash usuli. */
    avgCostPrice: price("avg_cost_price").notNull().default("0"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("stock_levels_company_product_warehouse_key").on(
      t.companyId,
      t.productId,
      t.warehouseId,
    ),
    index("stock_levels_company_warehouse_idx").on(t.companyId, t.warehouseId),
    // Qoldiq manfiy bo'lishi mumkin faqat desktop kassaning offline sotuvi sinxronida (tovar jismonan sotilgan,
    // hisobdagi qoldiq kam edi) — nomuvofiqlik `pos_sync_conflicts` da. Boshqa chiqimlar `moveStock` da >= 0 shart bilan.
    check("stock_levels_reserved_non_negative", sql`${t.reservedQty} >= 0`),
    check("stock_levels_cost_non_negative", sql`${t.avgCostPrice} >= 0`),
  ],
);

// ─── stock_movements ─────────────────────────────────────────────────────────

/** O'zgarmas jurnal — zaxira qoldig'ini bu yerdan qayta hisoblash mumkin. */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    type: stockMovementType("type").notNull(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
    warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id, { onDelete: "restrict" }),
    zoneId: uuid("zone_id").references(() => warehouseZones.id, { onDelete: "set null" }),
    batchId: uuid("batch_id").references(() => batches.id, { onDelete: "set null" }),

    /** Musbat = kirim, manfiy = chiqim. */
    quantity: qty("quantity").notNull(),
    unitId: uuid("unit_id").notNull().references(() => units.id),
    costPrice: price("cost_price").notNull().default("0"),

    referenceType: varchar("reference_type", { length: 50 }),
    referenceId: uuid("reference_id"),

    notes: text("notes"),
    performedBy: uuid("performed_by").references(() => users.id, { onDelete: "set null" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamps().createdAt,
  },
  (t) => [
    index("sm_company_product_occurred_idx").on(t.companyId, t.productId, t.occurredAt),
    index("sm_company_warehouse_occurred_idx").on(t.companyId, t.warehouseId, t.occurredAt),
    index("sm_reference_idx").on(t.referenceType, t.referenceId),
    check("sm_quantity_not_zero", sql`${t.quantity} <> 0`),
  ],
);

// ─── inventory_counts ────────────────────────────────────────────────────────

export const inventoryCounts = pgTable(
  "inventory_counts",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id, { onDelete: "restrict" }),

    name: varchar("name", { length: 200 }).notNull(),
    status: inventoryCountStatus("status").notNull().default("draft"),
    countedBy: uuid("counted_by").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    adjustmentsMade: boolean("adjustments_made").notNull().default(false),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    index("ic_company_warehouse_idx").on(t.companyId, t.warehouseId),
    index("ic_company_status_idx").on(t.companyId, t.status),
  ],
);

export const inventoryCountItems = pgTable(
  "inventory_count_items",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    countId: uuid("count_id").notNull().references(() => inventoryCounts.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),

    expectedQty: qty("expected_qty").notNull().default("0"),
    countedQty: qty("counted_qty"),
    difference: qty("difference"),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("ici_count_product_key").on(t.countId, t.productId),
    index("ici_company_idx").on(t.companyId),
  ],
);

// ─── relations ───────────────────────────────────────────────────────────────

export const warehousesRelations = relations(warehouses, ({ one, many }) => ({
  company: one(companies, { fields: [warehouses.companyId], references: [companies.id] }),
  zones: many(warehouseZones),
  stockLevels: many(stockLevels),
}));

export const stockLevelsRelations = relations(stockLevels, ({ one }) => ({
  product: one(products, { fields: [stockLevels.productId], references: [products.id] }),
  warehouse: one(warehouses, { fields: [stockLevels.warehouseId], references: [warehouses.id] }),
}));

export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  product: one(products, { fields: [stockMovements.productId], references: [products.id] }),
  warehouse: one(warehouses, { fields: [stockMovements.warehouseId], references: [warehouses.id] }),
  unit: one(units, { fields: [stockMovements.unitId], references: [units.id] }),
}));

export const inventoryCountsRelations = relations(inventoryCounts, ({ one, many }) => ({
  warehouse: one(warehouses, { fields: [inventoryCounts.warehouseId], references: [warehouses.id] }),
  items: many(inventoryCountItems),
}));
