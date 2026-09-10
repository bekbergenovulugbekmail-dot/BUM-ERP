/**
 * Xarid: yetkazuvchilar, buyurtmalar, qabullar, to'lovlar.
 *
 * Atomarlik talabi (audit §9):
 *   Tovar qabuli  → 5 jadval: receipt, receipt_items, stock_levels,
 *                   stock_movements, journal_entries+lines
 *   To'lov        → 3 jadval: supplier_payments, cash_transactions, JE
 * Ikkalasi ham bitta db.transaction() ichida bajariladi.
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { companies, users } from "./platform.js";
import { products, units } from "./catalog.js";
import { warehouses } from "./inventory.js";
import { cashAccounts, journalEntries } from "./finance.js";
import { legacyId, money, percent, pk, price, qty, timestamps } from "./_shared.js";

export const purchaseOrderStatus = pgEnum("purchase_order_status", [
  "draft",
  "confirmed",
  "partial",
  "received",
  "invoiced",
  "paid",
  "cancelled",
]);

export const paymentMethod = pgEnum("payment_method", [
  "cash",
  "bank",
  "card",
  "transfer",
]);

// ─── suppliers ───────────────────────────────────────────────────────────────

export const suppliers = pgTable(
  "suppliers",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    name: varchar("name", { length: 200 }).notNull(),
    code: varchar("code", { length: 32 }).notNull(),
    contactPerson: varchar("contact_person", { length: 200 }),
    phone: varchar("phone", { length: 20 }),
    email: varchar("email", { length: 255 }),
    address: text("address"),
    /** STIR */
    taxId: varchar("tax_id", { length: 32 }),
    bankAccount: varchar("bank_account", { length: 64 }),
    paymentTermDays: integer("payment_term_days").notNull().default(0),
    currency: varchar("currency", { length: 3 }).notNull().default("UZS"),

    /** Keshlangan yig'indilar — haqiqat manbai to'lovlar va buyurtmalar. */
    totalDebt: money("total_debt").notNull().default("0"),
    totalPurchased: money("total_purchased").notNull().default("0"),

    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("suppliers_company_code_key").on(t.companyId, t.code),
    index("suppliers_company_active_idx").on(t.companyId, t.isActive),
  ],
);

// ─── purchase_orders ─────────────────────────────────────────────────────────

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    number: varchar("number", { length: 32 }).notNull(),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "restrict" }),
    warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id, { onDelete: "restrict" }),

    status: purchaseOrderStatus("status").notNull().default("draft"),
    orderDate: date("order_date").notNull(),
    expectedDate: date("expected_date"),

    currency: varchar("currency", { length: 3 }).notNull().default("UZS"),
    exchangeRate: price("exchange_rate").notNull().default("1"),

    subtotal: money("subtotal").notNull().default("0"),
    taxAmount: money("tax_amount").notNull().default("0"),
    discountAmount: money("discount_amount").notNull().default("0"),
    totalAmount: money("total_amount").notNull().default("0"),
    paidAmount: money("paid_amount").notNull().default("0"),

    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("po_company_number_key").on(t.companyId, t.number),
    index("po_company_status_idx").on(t.companyId, t.status),
    index("po_company_supplier_idx").on(t.companyId, t.supplierId),
    index("po_company_date_idx").on(t.companyId, t.orderDate),
    check("po_amounts_non_negative", sql`${t.totalAmount} >= 0 AND ${t.paidAmount} >= 0`),
  ],
);

export const purchaseOrderItems = pgTable(
  "purchase_order_items",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
    unitId: uuid("unit_id").notNull().references(() => units.id),

    orderedQty: qty("ordered_qty").notNull(),
    receivedQty: qty("received_qty").notNull().default("0"),
    unitPrice: price("unit_price").notNull(),
    taxRate: percent("tax_rate").notNull().default("0"),
    discountPercent: percent("discount_percent").notNull().default("0"),
    lineTotal: money("line_total").notNull().default("0"),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    index("poi_order_idx").on(t.orderId),
    index("poi_company_product_idx").on(t.companyId, t.productId),
    check("poi_ordered_positive", sql`${t.orderedQty} > 0`),
    check("poi_received_not_over", sql`${t.receivedQty} >= 0 AND ${t.receivedQty} <= ${t.orderedQty}`),
  ],
);

// ─── purchase_receipts ───────────────────────────────────────────────────────

export const purchaseReceipts = pgTable(
  "purchase_receipts",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    orderId: uuid("order_id").notNull().references(() => purchaseOrders.id, { onDelete: "restrict" }),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "restrict" }),
    warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id, { onDelete: "restrict" }),

    receiptDate: date("receipt_date").notNull(),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    index("pr_company_order_idx").on(t.companyId, t.orderId),
    index("pr_company_date_idx").on(t.companyId, t.receiptDate),
  ],
);

export const purchaseReceiptItems = pgTable(
  "purchase_receipt_items",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    receiptId: uuid("receipt_id").notNull().references(() => purchaseReceipts.id, { onDelete: "cascade" }),
    orderItemId: uuid("order_item_id").notNull().references(() => purchaseOrderItems.id, { onDelete: "restrict" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
    unitId: uuid("unit_id").notNull().references(() => units.id),

    receivedQty: qty("received_qty").notNull(),
    unitPrice: price("unit_price").notNull(),
    batchNumber: varchar("batch_number", { length: 64 }),
    expiryDate: date("expiry_date"),
    ...timestamps(),
  },
  (t) => [
    index("pri_receipt_idx").on(t.receiptId),
    index("pri_company_product_idx").on(t.companyId, t.productId),
    check("pri_qty_positive", sql`${t.receivedQty} > 0`),
  ],
);

// ─── supplier_payments ───────────────────────────────────────────────────────

export const supplierPayments = pgTable(
  "supplier_payments",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "restrict" }),
    orderId: uuid("order_id").references(() => purchaseOrders.id, { onDelete: "set null" }),

    amount: money("amount").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("UZS"),
    exchangeRate: price("exchange_rate").notNull().default("1"),
    paymentDate: date("payment_date").notNull(),
    method: paymentMethod("method").notNull().default("cash"),

    reference: varchar("reference", { length: 100 }),
    notes: text("notes"),
    cashAccountId: uuid("cash_account_id").references(() => cashAccounts.id, { onDelete: "set null" }),
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    index("sp_company_supplier_idx").on(t.companyId, t.supplierId),
    index("sp_company_date_idx").on(t.companyId, t.paymentDate),
    check("sp_amount_positive", sql`${t.amount} > 0`),
  ],
);

// ─── relations ───────────────────────────────────────────────────────────────

export const suppliersRelations = relations(suppliers, ({ many }) => ({
  orders: many(purchaseOrders),
  payments: many(supplierPayments),
}));

export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  supplier: one(suppliers, { fields: [purchaseOrders.supplierId], references: [suppliers.id] }),
  warehouse: one(warehouses, { fields: [purchaseOrders.warehouseId], references: [warehouses.id] }),
  items: many(purchaseOrderItems),
  receipts: many(purchaseReceipts),
}));

export const purchaseOrderItemsRelations = relations(purchaseOrderItems, ({ one }) => ({
  order: one(purchaseOrders, { fields: [purchaseOrderItems.orderId], references: [purchaseOrders.id] }),
  product: one(products, { fields: [purchaseOrderItems.productId], references: [products.id] }),
}));

export const purchaseReceiptsRelations = relations(purchaseReceipts, ({ one, many }) => ({
  order: one(purchaseOrders, { fields: [purchaseReceipts.orderId], references: [purchaseOrders.id] }),
  items: many(purchaseReceiptItems),
}));
