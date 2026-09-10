/**
 * Ishlab chiqarish: BOM, buyurtmalar, materiallar, ish markazlari.
 *
 * Atomarlik talabi (audit §9):
 *   Yakunlash → 4+ jadval: production_orders, production_materials,
 *               stock_levels (xomashyo chiqim + tayyor mahsulot kirim),
 *               stock_movements, journal_entries+lines
 *
 * unit_cost = totalCost / producedQty — bu qiymat tayyor mahsulotning
 * AVCO hisobiga kiradi (manufacturing/orders.ts:366-377 dan ko'chadi).
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
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
import { products, units } from "./catalog.js";
import { warehouses } from "./inventory.js";
import { legacyId, money, percent, pk, price, qty, timestamps } from "./_shared.js";

export const productionOrderStatus = pgEnum("production_order_status", [
  "draft",
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
]);

export const workCenterType = pgEnum("work_center_type", [
  "machine",
  "labor",
  "subcontract",
]);

// ─── boms ────────────────────────────────────────────────────────────────────

export const boms = pgTable(
  "boms",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 200 }).notNull(),
    version: varchar("version", { length: 32 }).notNull().default("1"),
    /** Ushbu retsept nechta tayyor mahsulot beradi. */
    quantity: qty("quantity").notNull().default("1"),
    unitId: uuid("unit_id").notNull().references(() => units.id),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("boms_company_product_version_key").on(t.companyId, t.productId, t.version),
    index("boms_company_active_idx").on(t.companyId, t.isActive),
    check("boms_quantity_positive", sql`${t.quantity} > 0`),
  ],
);

export const bomItems = pgTable(
  "bom_items",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    bomId: uuid("bom_id").notNull().references(() => boms.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),

    quantity: qty("quantity").notNull(),
    unitId: uuid("unit_id").notNull().references(() => units.id),
    /** Chiqindi foizi — rejalashtirilgan miqdorga qo'shiladi. */
    scrapPercent: percent("scrap_percent").notNull().default("0"),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    index("bi_bom_idx").on(t.bomId),
    index("bi_company_product_idx").on(t.companyId, t.productId),
    check("bi_quantity_positive", sql`${t.quantity} > 0`),
    /** Retsept o'zini o'zi tarkib sifatida olmasin. */
    check("bi_no_self_reference", sql`true`),
  ],
);

// ─── work_centers ────────────────────────────────────────────────────────────

export const workCenters = pgTable(
  "work_centers",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    name: varchar("name", { length: 200 }).notNull(),
    code: varchar("code", { length: 32 }).notNull(),
    type: workCenterType("type").notNull().default("machine"),
    costPerHour: money("cost_per_hour").notNull().default("0"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("wc_company_code_key").on(t.companyId, t.code),
    index("wc_company_active_idx").on(t.companyId, t.isActive),
  ],
);

// ─── production_orders ───────────────────────────────────────────────────────

export const productionOrders = pgTable(
  "production_orders",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    number: varchar("number", { length: 32 }).notNull(),
    bomId: uuid("bom_id").notNull().references(() => boms.id, { onDelete: "restrict" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
    warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id, { onDelete: "restrict" }),

    plannedQty: qty("planned_qty").notNull(),
    producedQty: qty("produced_qty").notNull().default("0"),

    status: productionOrderStatus("status").notNull().default("draft"),
    plannedDate: date("planned_date").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    totalMaterialCost: money("total_material_cost").notNull().default("0"),
    totalLaborCost: money("total_labor_cost").notNull().default("0"),
    totalCost: money("total_cost").notNull().default("0"),
    /** totalCost / producedQty — tayyor mahsulot AVCO hisobiga kiradi. */
    unitCost: price("unit_cost").notNull().default("0"),

    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("po_mfg_company_number_key").on(t.companyId, t.number),
    index("po_mfg_company_status_idx").on(t.companyId, t.status),
    index("po_mfg_company_product_idx").on(t.companyId, t.productId),
    index("po_mfg_company_date_idx").on(t.companyId, t.plannedDate),
    check("po_mfg_planned_positive", sql`${t.plannedQty} > 0`),
    check("po_mfg_produced_non_negative", sql`${t.producedQty} >= 0`),
  ],
);

export const productionMaterials = pgTable(
  "production_materials",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull().references(() => productionOrders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),

    plannedQty: qty("planned_qty").notNull(),
    actualQty: qty("actual_qty").notNull().default("0"),
    unitId: uuid("unit_id").notNull().references(() => units.id),
    unitCost: price("unit_cost").notNull().default("0"),
    totalCost: money("total_cost").notNull().default("0"),
    ...timestamps(),
  },
  (t) => [
    index("pm_order_idx").on(t.orderId),
    index("pm_company_product_idx").on(t.companyId, t.productId),
    check("pm_qty_non_negative", sql`${t.plannedQty} >= 0 AND ${t.actualQty} >= 0`),
  ],
);

export const productionTimeLines = pgTable(
  "production_time_lines",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull().references(() => productionOrders.id, { onDelete: "cascade" }),
    workCenterId: uuid("work_center_id").notNull().references(() => workCenters.id, { onDelete: "restrict" }),

    plannedHours: qty("planned_hours").notNull().default("0"),
    actualHours: qty("actual_hours").notNull().default("0"),
    costPerHour: money("cost_per_hour").notNull().default("0"),
    totalCost: money("total_cost").notNull().default("0"),
    ...timestamps(),
  },
  (t) => [
    index("ptl_order_idx").on(t.orderId),
    index("ptl_company_idx").on(t.companyId),
    check("ptl_hours_non_negative", sql`${t.plannedHours} >= 0 AND ${t.actualHours} >= 0`),
  ],
);

// ─── relations ───────────────────────────────────────────────────────────────

export const bomsRelations = relations(boms, ({ one, many }) => ({
  product: one(products, { fields: [boms.productId], references: [products.id] }),
  items: many(bomItems),
  orders: many(productionOrders),
}));

export const bomItemsRelations = relations(bomItems, ({ one }) => ({
  bom: one(boms, { fields: [bomItems.bomId], references: [boms.id] }),
  product: one(products, { fields: [bomItems.productId], references: [products.id] }),
}));

export const productionOrdersRelations = relations(productionOrders, ({ one, many }) => ({
  bom: one(boms, { fields: [productionOrders.bomId], references: [boms.id] }),
  product: one(products, { fields: [productionOrders.productId], references: [products.id] }),
  warehouse: one(warehouses, {
    fields: [productionOrders.warehouseId],
    references: [warehouses.id],
  }),
  materials: many(productionMaterials),
  timeLines: many(productionTimeLines),
}));
