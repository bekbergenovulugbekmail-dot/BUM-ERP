/**
 * Sotuv va POS.
 *
 * Atomarlik talabi (audit §9):
 *   Jo'natish  → 5 jadval: order, items, stock_levels, stock_movements, JE
 *   POS sotuvi → 6 jadval: yuqoridagilar + cash_transactions + shift yig'indisi
 *
 * `sales_order_items.cost_price` — sotuv paytidagi AVCO qiymati. U keyin
 * o'zgarmaydi, chunki COGS o'sha lahzadagi tannarxga bog'langan.
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
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
import { posDevices } from "./pos.js";
import { cashAccounts, journalEntries } from "./finance.js";
import { paymentMethod } from "./purchase.js";
import { legacyId, money, percent, pk, price, qty, timestamps } from "./_shared.js";

export const salesOrderStatus = pgEnum("sales_order_status", [
  "draft",
  "confirmed",
  "shipped",
  "delivered",
  "returned",
  "cancelled",
]);

export const posShiftStatus = pgEnum("pos_shift_status", ["open", "closed"]);

/** Mijoz balansi (hamyon) harakati. Keshbek bu yerda emas — alohida hisob. */
export const customerBalanceTxType = pgEnum("customer_balance_tx_type", [
  "deposit", //      kassada balansni to'ldirish
  "change", //       chek qaytimi mijozga berilmay balansga yozildi
  "sale_payment", // chek yoki qarz balansdan to'landi
  "refund", //       qaytarilgan chekning balansdan to'langan qismi
]);

/** Keshbek hisobi harakati — pul balansidan alohida. */
export const customerCashbackTxType = pgEnum("customer_cashback_tx_type", [
  "earn", //          chekdan hisoblandi
  "redeem", //        chek keshbek bilan to'landi
  "earn_reversal", // qaytarilgan chekdan berilgan keshbek bekor qilindi
  "redeem_refund", // qaytarilgan chekda ishlatilgan keshbek qaytdi
  "adjustment", //    qo'lda tuzatish
]);

// ─── customers ───────────────────────────────────────────────────────────────

export const customers = pgTable(
  "customers",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    name: varchar("name", { length: 200 }).notNull(),
    code: varchar("code", { length: 32 }).notNull(),
    phone: varchar("phone", { length: 20 }),
    email: varchar("email", { length: 255 }),
    address: text("address"),
    taxId: varchar("tax_id", { length: 32 }),
    /** Do'kon egasi yoki mas'ul shaxs. */
    contactName: varchar("contact_name", { length: 200 }),
    /** Do'kon joylashuvi (WGS-84): agentga masofa va geofence uchun. */
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),

    discountPercent: percent("discount_percent").notNull().default("0"),
    creditLimit: money("credit_limit").notNull().default("0"),
    paymentTermDays: integer("payment_term_days").notNull().default(0),
    currency: varchar("currency", { length: 3 }).notNull().default("UZS"),

    totalDebt: money("total_debt").notNull().default("0"),
    totalPurchased: money("total_purchased").notNull().default("0"),
    /** Oldindan to'langan pul (hamyon) — qarzdan alohida; o'zgarishi faqat customer_balance_transactions orqali. */
    balance: money("balance").notNull().default("0"),
    /** Keshbek — balansdan alohida; o'zgarishi faqat customer_cashback_transactions orqali. */
    cashbackBalance: money("cashback_balance").notNull().default("0"),

    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("customers_company_code_key").on(t.companyId, t.code),
    index("customers_company_active_idx").on(t.companyId, t.isActive),
    index("customers_company_phone_idx").on(t.companyId, t.phone),
    check("customers_balance_non_negative", sql`${t.balance} >= 0`),
    check("customers_cashback_non_negative", sql`${t.cashbackBalance} >= 0`),
  ],
);

// ─── pos_shifts ──────────────────────────────────────────────────────────────

export const posShifts = pgTable(
  "pos_shifts",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id, { onDelete: "restrict" }),

    cashierId: uuid("cashier_id").references(() => users.id, { onDelete: "set null" }),
    cashierName: varchar("cashier_name", { length: 200 }),
    /** Desktop kassa qurilmasi; null — web kassa. */
    deviceId: uuid("device_id").references(() => posDevices.id, { onDelete: "set null" }),

    status: posShiftStatus("status").notNull().default("open"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),

    openingCash: money("opening_cash").notNull().default("0"),
    closingCash: money("closing_cash"),
    totalSales: money("total_sales").notNull().default("0"),
    totalCash: money("total_cash").notNull().default("0"),
    totalCard: money("total_card").notNull().default("0"),
    receiptCount: integer("receipt_count").notNull().default(0),
    /** Chet valyuta bo'yicha (`{ USD: "20.00" }`): boshlang'ich naqd, naqd va karta tushumi, yopilishda sanalgan naqd. */
    openingForeignCash: jsonb("opening_foreign_cash").$type<Record<string, string>>().notNull().default({}),
    foreignCash: jsonb("foreign_cash").$type<Record<string, string>>().notNull().default({}),
    foreignCard: jsonb("foreign_card").$type<Record<string, string>>().notNull().default({}),
    closingForeignCash: jsonb("closing_foreign_cash").$type<Record<string, string>>(),

    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    index("ps_company_warehouse_idx").on(t.companyId, t.warehouseId),
    index("ps_company_status_idx").on(t.companyId, t.status),
    /** Web kassa: bitta omborda bir vaqtda bitta ochiq smena; desktop kassa: har qurilmada bitta. */
    uniqueIndex("ps_one_open_per_warehouse")
      .on(t.companyId, t.warehouseId)
      .where(sql`${t.status} = 'open' and ${t.deviceId} is null`),
    uniqueIndex("ps_one_open_per_device")
      .on(t.deviceId)
      .where(sql`${t.status} = 'open' and ${t.deviceId} is not null`),
  ],
);

// ─── sales_orders ────────────────────────────────────────────────────────────

export const salesOrders = pgTable(
  "sales_orders",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    number: varchar("number", { length: 32 }).notNull(),
    /** POS sotuvida mijoz ko'rsatilmasligi mumkin. */
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "restrict" }),
    warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id, { onDelete: "restrict" }),

    status: salesOrderStatus("status").notNull().default("draft"),
    orderDate: date("order_date").notNull(),
    deliveryDate: date("delivery_date"),

    currency: varchar("currency", { length: 3 }).notNull().default("UZS"),
    exchangeRate: price("exchange_rate").notNull().default("1"),

    subtotal: money("subtotal").notNull().default("0"),
    taxAmount: money("tax_amount").notNull().default("0"),
    discountAmount: money("discount_amount").notNull().default("0"),
    totalAmount: money("total_amount").notNull().default("0"),
    paidAmount: money("paid_amount").notNull().default("0"),

    isPos: boolean("is_pos").notNull().default(false),
    posShiftId: uuid("pos_shift_id").references(() => posShifts.id, { onDelete: "set null" }),

    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("so_company_number_key").on(t.companyId, t.number),
    index("so_company_status_idx").on(t.companyId, t.status),
    index("so_company_customer_idx").on(t.companyId, t.customerId),
    index("so_company_date_idx").on(t.companyId, t.orderDate),
    index("so_pos_shift_idx").on(t.posShiftId),
    check("so_amounts_non_negative", sql`${t.totalAmount} >= 0 AND ${t.paidAmount} >= 0`),
  ],
);

export const salesOrderItems = pgTable(
  "sales_order_items",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull().references(() => salesOrders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
    unitId: uuid("unit_id").notNull().references(() => units.id),

    quantity: qty("quantity").notNull(),
    unitPrice: price("unit_price").notNull(),
    taxRate: percent("tax_rate").notNull().default("0"),
    discountPercent: percent("discount_percent").notNull().default("0"),
    lineTotal: money("line_total").notNull().default("0"),

    /** Sotuv lahzasidagi AVCO tannarx — COGS shundan hisoblanadi, keyin o'zgarmaydi. */
    costPrice: price("cost_price").notNull().default("0"),

    /**
     * Chekda ko'rsatiladigan va to'lanadigan valyuta (POS sotuv valyutalari); null — asosiy.
     * `lineTotal` asosiy valyutada (buxgalteriya), `currencyTotal` = lineTotal / priceRate.
     */
    priceCurrency: varchar("price_currency", { length: 3 }),
    priceRate: price("price_rate").notNull().default("1"),
    currencyTotal: money("currency_total").notNull().default("0"),

    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    index("soi_order_idx").on(t.orderId),
    index("soi_company_product_idx").on(t.companyId, t.productId),
    check("soi_qty_positive", sql`${t.quantity} > 0`),
    check("soi_price_non_negative", sql`${t.unitPrice} >= 0 AND ${t.costPrice} >= 0`),
  ],
);

// ─── customer_payments ───────────────────────────────────────────────────────

export const customerPayments = pgTable(
  "customer_payments",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "restrict" }),
    orderId: uuid("order_id").references(() => salesOrders.id, { onDelete: "set null" }),

    amount: money("amount").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("UZS"),
    exchangeRate: price("exchange_rate").notNull().default("1"),
    /** Chet valyutadagi to'lov summasi (`currency` da); `amount` — asosiy valyutadagi qiymati. */
    foreignAmount: money("foreign_amount").notNull().default("0"),
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
    index("cp_company_customer_idx").on(t.companyId, t.customerId),
    index("cp_company_date_idx").on(t.companyId, t.paymentDate),
    index("cp_order_idx").on(t.orderId),
    /** Takroriy yuborish ikkinchi to'lov yaratmasin (Convex ham kompaniya bo'yicha tekshirardi). */
    uniqueIndex("cp_company_reference_key")
      .on(t.companyId, t.reference)
      .where(sql`${t.reference} IS NOT NULL`),
    check("cp_amount_positive", sql`${t.amount} > 0`),
  ],
);

// ─── customer_balance_transactions ───────────────────────────────────────────

export const customerBalanceTransactions = pgTable(
  "customer_balance_transactions",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "restrict" }),

    type: customerBalanceTxType("type").notNull(),
    /** Ishorali: kirim musbat, sarf manfiy. */
    amount: money("amount").notNull(),
    balanceAfter: money("balance_after").notNull(),
    /** Kirimda — pul qanday tushgani; sarfda null. */
    method: paymentMethod("method"),

    orderId: uuid("order_id").references(() => salesOrders.id, { onDelete: "set null" }),
    paymentId: uuid("payment_id").references(() => customerPayments.id, { onDelete: "set null" }),
    posShiftId: uuid("pos_shift_id").references(() => posShifts.id, { onDelete: "set null" }),
    cashAccountId: uuid("cash_account_id").references(() => cashAccounts.id, { onDelete: "set null" }),
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id, { onDelete: "set null" }),

    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    index("cbt_company_customer_idx").on(t.companyId, t.customerId, t.createdAt),
    index("cbt_order_idx").on(t.orderId),
    check("cbt_amount_non_zero", sql`${t.amount} <> 0`),
    check("cbt_balance_after_non_negative", sql`${t.balanceAfter} >= 0`),
  ],
);

// ─── customer_cashback_transactions ──────────────────────────────────────────

export const customerCashbackTransactions = pgTable(
  "customer_cashback_transactions",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "restrict" }),

    type: customerCashbackTxType("type").notNull(),
    /** Ishorali: kirim musbat, sarf manfiy. */
    amount: money("amount").notNull(),
    balanceAfter: money("balance_after").notNull(),

    orderId: uuid("order_id").references(() => salesOrders.id, { onDelete: "set null" }),
    paymentId: uuid("payment_id").references(() => customerPayments.id, { onDelete: "set null" }),
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id, { onDelete: "set null" }),

    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    index("cct_company_customer_idx").on(t.companyId, t.customerId, t.createdAt),
    index("cct_order_idx").on(t.orderId),
    check("cct_amount_non_zero", sql`${t.amount} <> 0`),
    check("cct_balance_after_non_negative", sql`${t.balanceAfter} >= 0`),
  ],
);

// ─── relations ───────────────────────────────────────────────────────────────

export const customersRelations = relations(customers, ({ many }) => ({
  orders: many(salesOrders),
  payments: many(customerPayments),
}));

export const salesOrdersRelations = relations(salesOrders, ({ one, many }) => ({
  customer: one(customers, { fields: [salesOrders.customerId], references: [customers.id] }),
  warehouse: one(warehouses, { fields: [salesOrders.warehouseId], references: [warehouses.id] }),
  shift: one(posShifts, { fields: [salesOrders.posShiftId], references: [posShifts.id] }),
  items: many(salesOrderItems),
  payments: many(customerPayments),
}));

export const salesOrderItemsRelations = relations(salesOrderItems, ({ one }) => ({
  order: one(salesOrders, { fields: [salesOrderItems.orderId], references: [salesOrders.id] }),
  product: one(products, { fields: [salesOrderItems.productId], references: [products.id] }),
}));

export const posShiftsRelations = relations(posShifts, ({ one, many }) => ({
  warehouse: one(warehouses, { fields: [posShifts.warehouseId], references: [warehouses.id] }),
  orders: many(salesOrders),
}));
