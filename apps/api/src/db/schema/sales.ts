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
import { cashAccounts, expenses, journalEntries } from "./finance.js";
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
    /** Jismoniy (`individual`) yoki yuridik (`legal`) shaxs. */
    partyType: varchar("party_type", { length: 16 }).notNull().default("individual"),
    /** Yuridik shaxs bank rekvizitlari. */
    bankAccount: varchar("bank_account", { length: 64 }),
    bankMfo: varchar("bank_mfo", { length: 16 }),
    /** Do'kon egasi yoki mas'ul shaxs. */
    contactName: varchar("contact_name", { length: 200 }),
    /** Do'kon joylashuvi (WGS-84): agentga masofa va geofence uchun. */
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    /** Hudud: shahar yoki tuman (masalan "Urganch") va mahalla/hudud ("Luchevoy") — dostavkani hudud bo'yicha taqsimlash. */
    city: varchar("city", { length: 100 }),
    district: varchar("district", { length: 100 }),

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
    index("customers_company_region_idx").on(t.companyId, t.city, t.district),
    check("customers_balance_non_negative", sql`${t.balance} >= 0`),
    check("customers_cashback_non_negative", sql`${t.cashbackBalance} >= 0`),
    check("customers_party_type", sql`${t.partyType} in ('individual', 'legal')`),
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
    /** Bank (va o'tkazma) orqali tushum — aralash to'lovda naqd va kartadan alohida. */
    totalBank: money("total_bank").notNull().default("0"),
    /** Shu smenada qaytarilgan mahsulotlar summasi (qisman qaytarishlar). */
    totalReturns: money("total_returns").notNull().default("0"),
    /** Kassaga kirim (almashtirish puli va h.k.) va chiqim (inkassatsiya, xarajat) — kutilgan naqdda hisobga olinadi. */
    cashIn: money("cash_in").notNull().default("0"),
    cashOut: money("cash_out").notNull().default("0"),
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
    /** Yetkazib berish kerakmi: null — kompaniya dostavka siyosati bo'yicha (`deliveryRequiredByDefault`). */
    deliveryRequired: boolean("delivery_required"),

    currency: varchar("currency", { length: 3 }).notNull().default("UZS"),
    exchangeRate: price("exchange_rate").notNull().default("1"),

    subtotal: money("subtotal").notNull().default("0"),
    taxAmount: money("tax_amount").notNull().default("0"),
    discountAmount: money("discount_amount").notNull().default("0"),
    totalAmount: money("total_amount").notNull().default("0"),
    paidAmount: money("paid_amount").notNull().default("0"),

    isPos: boolean("is_pos").notNull().default(false),
    posShiftId: uuid("pos_shift_id").references(() => posShifts.id, { onDelete: "set null" }),
    /** Desktop kassa qurilmasi (offline chek); `created_at` — chek qurilmada yopilgan vaqt. */
    deviceId: uuid("device_id").references(() => posDevices.id, { onDelete: "set null" }),
    /** Web kassa so'rov kaliti (idempotentlik): takroriy yuborishda ikkinchi chek, to'lov va jurnal yozilmaydi. */
    clientRequestId: uuid("client_request_id"),

    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("so_company_number_key").on(t.companyId, t.number),
    uniqueIndex("so_company_client_request_key").on(t.companyId, t.clientRequestId).where(sql`${t.clientRequestId} IS NOT NULL`),
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
    /** Qisman qaytarishlar bilan qaytarilgan miqdor (qator birligida). */
    returnedQty: qty("returned_qty").notNull().default("0"),

    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    index("soi_order_idx").on(t.orderId),
    index("soi_company_product_idx").on(t.companyId, t.productId),
    check("soi_qty_positive", sql`${t.quantity} > 0`),
    check("soi_returned_qty_range", sql`${t.returnedQty} >= 0 AND ${t.returnedQty} <= ${t.quantity}`),
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

// ─── sales_returns ───────────────────────────────────────────────────────────

/**
 * Chekdagi mahsulotlarni qisman qaytarish (kassa yoki web). To'liq qaytarish (`returnOrder`) buyurtma holatini
 * o'zgartiradi va bu jadvalga yozilmaydi; qisman qaytarilgan chekni to'liq qaytarib bo'lmaydi.
 *   total      — qaytarilgan qatorlar summasi (sotuv narxida)
 *   refund*    — mijozga qaytgan pul: tanlangan usulda (`refund_method`), balans va keshbekdan to'langan ulushi
 *                o'z hisobiga; mijoz qarzi bo'lsa avval qarz kamayadi
 */
export const salesReturns = pgTable(
  "sales_returns",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    orderId: uuid("order_id").notNull().references(() => salesOrders.id, { onDelete: "restrict" }),
    number: varchar("number", { length: 32 }).notNull(),
    posShiftId: uuid("pos_shift_id").references(() => posShifts.id, { onDelete: "set null" }),
    deviceId: uuid("device_id").references(() => posDevices.id, { onDelete: "set null" }),

    totalAmount: money("total_amount").notNull(),
    cogs: money("cogs").notNull().default("0"),
    /** cash | card | bank | balance; bir nechta usulga taqsimlangan bo'lsa — `mixed` (tarkibi `refunds` da). */
    refundMethod: varchar("refund_method", { length: 16 }).notNull(),
    refundAmount: money("refund_amount").notNull().default("0"),
    /** Qaytgan pul usullar bo'yicha: `[{ method, amount }]` (aralash to'lovli chek). Eski yozuvlarda null. */
    refunds: jsonb("refunds").$type<{ method: string; amount: string }[]>(),
    balanceRestored: money("balance_restored").notNull().default("0"),
    cashbackRestored: money("cashback_restored").notNull().default("0"),
    cashbackReversed: money("cashback_reversed").notNull().default("0"),

    reason: text("reason"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("sr_company_number_key").on(t.companyId, t.number),
    index("sr_order_idx").on(t.orderId),
    index("sr_shift_idx").on(t.posShiftId),
    index("sr_company_created_idx").on(t.companyId, t.createdAt),
    check("sr_refund_method", sql`${t.refundMethod} in ('cash', 'card', 'bank', 'balance', 'mixed')`),
    check(
      "sr_amounts_non_negative",
      sql`${t.totalAmount} >= 0 AND ${t.refundAmount} >= 0 AND ${t.balanceRestored} >= 0 AND ${t.cashbackRestored} >= 0 AND ${t.cashbackReversed} >= 0`,
    ),
  ],
);

export const salesReturnItems = pgTable(
  "sales_return_items",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    returnId: uuid("return_id").notNull().references(() => salesReturns.id, { onDelete: "cascade" }),
    orderItemId: uuid("order_item_id").notNull().references(() => salesOrderItems.id, { onDelete: "restrict" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
    quantity: qty("quantity").notNull(),
    lineTotal: money("line_total").notNull(),
    cogs: money("cogs").notNull().default("0"),
    ...timestamps(),
  },
  (t) => [
    index("sri_return_idx").on(t.returnId),
    index("sri_order_item_idx").on(t.orderItemId),
    check("sri_qty_positive", sql`${t.quantity} > 0`),
  ],
);

// ─── pos_cash_movements ──────────────────────────────────────────────────────

/**
 * Kassa smenasidagi naqd harakati: inkassatsiya (naqdni seyf/bankka olish), almashtirish puli, kassadan xarajat,
 * boshqa kirim/chiqim. Xarajat — `expenses` hujjati (to'langan) bilan bog'lanadi.
 */
export const posCashMovements = pgTable(
  "pos_cash_movements",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    shiftId: uuid("shift_id").notNull().references(() => posShifts.id, { onDelete: "restrict" }),
    deviceId: uuid("device_id").references(() => posDevices.id, { onDelete: "set null" }),
    type: varchar("type", { length: 8 }).notNull(),
    kind: varchar("kind", { length: 16 }).notNull(),
    amount: money("amount").notNull(),
    category: varchar("category", { length: 64 }),
    notes: text("notes"),
    expenseId: uuid("expense_id").references(() => expenses.id, { onDelete: "set null" }),
    /** Ta'minotchiga to'lov / qaytgan pul: `supplier_payment` yoki `purchase_return` hujjati. */
    referenceType: varchar("reference_type", { length: 40 }),
    referenceId: uuid("reference_id"),
    cashierId: uuid("cashier_id").references(() => users.id, { onDelete: "set null" }),
    cashierName: varchar("cashier_name", { length: 200 }),
    /** Qurilmada bajarilgan vaqt (offline bo'lishi mumkin). */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (t) => [
    index("pcm_shift_idx").on(t.shiftId, t.occurredAt),
    index("pcm_company_occurred_idx").on(t.companyId, t.occurredAt),
    check("pcm_type", sql`${t.type} in ('in', 'out')`),
    check("pcm_kind", sql`${t.kind} in ('collection', 'change_fund', 'expense', 'other_in', 'other_out', 'supplier_payment', 'supplier_refund')`),
    check("pcm_amount_positive", sql`${t.amount} > 0`),
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
