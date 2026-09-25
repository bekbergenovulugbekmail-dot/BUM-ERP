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
import { cashAccounts, expenses, journalEntries, paymentTerminals } from "./finance.js";
import { paymentMethod } from "./purchase.js";
import { legacyId, money, percent, pk, price, qty, timestamps } from "./_shared.js";

/**
 * Sotuv hujjatining hayot sikli — faqat sotuvniki. To'lov holati bu yerda emas: u `paid_amount` va
 * `total_amount` dan hisoblanadi; yetkazish holati ham bu yerda emas: u `delivery_tasks.status` da.
 *
 * `completed` — sotuv yakunlandi (tovar berildi, zaxira chiqdi, jurnal yozildi). Kassa cheki ham,
 * yetkazib berilgan buyurtma ham shu holatga keladi — "yetkazildi" degani emas.
 *
 * `shipped` va `delivered` — eski yozuvlar uchun saqlanadi: ular aslida to'lov holatini bildirgan
 * (`shipped` — qarz bor, `delivered` — to'langan) va yetkazishga aloqasi yo'q edi. Yangi yozuvlarda
 * ishlatilmaydi; o'qishda `completed` bilan teng.
 */
export const salesOrderStatus = pgEnum("sales_order_status", [
  "draft",
  "confirmed",
  "shipped",
  "delivered",
  "returned",
  "cancelled",
  "completed",
]);

/** Sotuv qaysi kirish nuqtasidan kelgan — biznes turi yoki modul emas, aynan kanal. */
export const salesOrderSource = pgEnum("sales_order_source", [
  "pos", //         kassa (web yoki desktop)
  "sales_agent", // savdo agenti buyurtmasi
  "manual", //      ERP'da qo'lda kiritilgan
  "import", //      fayldan import qilingan
  "bot", //         mijozning Telegram boti orqali (qoralama)
]);

/** Tovar mijozga qanday yetadi — sotuv holatidan mustaqil o'q. */
export const salesFulfillmentMethod = pgEnum("sales_fulfillment_method", [
  "counter", //  kassada qo'lma-qo'l berildi
  "pickup", //   mijoz o'zi olib ketadi
  "delivery", // yetkazma orqali
]);

export const posShiftStatus = pgEnum("pos_shift_status", ["open", "closed"]);

/** Mijoz balansi (hamyon) harakati. Keshbek bu yerda emas — alohida hisob. */
export const customerBalanceTxType = pgEnum("customer_balance_tx_type", [
  "deposit", //      kassada balansni to'ldirish
  "change", //       chek qaytimi mijozga berilmay balansga yozildi
  "sale_payment", // chek yoki qarz balansdan to'landi
  "refund", //       qaytarilgan chekning balansdan to'langan qismi
  "adjustment", //   qo'lda tuzatish: balansni to'g'ri qiymatga o'rnatish (sabab bilan, audit va jurnal yozuvi)
  "withdrawal", //   balansdagi pul mijozga QAYTARILDI (haqiqiy pul chiqimi — tuzatish emas)
  "deposit_reversal", // noto'g'ri kiritilgan kirim BEKOR QILINDI (asl qator `reversed`, pul hisobdan qaytadi)
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

    /**
     * Kredit holati: `ok` — cheklovsiz, `hold` — NASIYA sotuv rad etiladi.
     * Naqd sotuv va qarzni to'lash hech qachon bloklanmaydi (mijozni faolsizlantirishdan farqi shu).
     * Qo'lda ham qo'yiladi, siyosatdagi muddat/summa chegarasidan avtomatik ham.
     */
    creditStatus: varchar("credit_status", { length: 16 }).notNull().default("ok"),
    creditHoldReason: text("credit_hold_reason"),
    creditHoldAt: timestamp("credit_hold_at", { withTimezone: true }),
    creditHoldBy: uuid("credit_hold_by").references(() => users.id, { onDelete: "set null" }),

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
    check("customers_credit_status_check", sql`${t.creditStatus} in ('ok', 'hold')`),
    index("customers_company_credit_status_idx").on(t.companyId, t.creditStatus).where(sql`${t.creditStatus} <> 'ok'`),
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
    /** Yopilishdagi kassa farqi (sanalgan − kutilgan); savdo siyosatidagi chegaradan oshsa rahbar ko'rib chiqadi. */
    cashDifference: money("cash_difference"),
    differenceReview: varchar("difference_review", { length: 16 }).$type<"pending" | "approved" | "rejected">(),
    differenceReviewedBy: uuid("difference_reviewed_by").references(() => users.id, { onDelete: "set null" }),
    differenceReviewedAt: timestamp("difference_reviewed_at", { withTimezone: true }),
    differenceReviewNote: text("difference_review_note"),

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
    /** Sotuv kanali — POS savdosini agent va qo'lda kiritilgan savdodan ajratish uchun. */
    source: salesOrderSource("source").notNull().default("manual"),
    /** Yetkazib berish usuli; null — hujjat yaratilganda aniqlanmagan (eski yozuvlar). */
    fulfillmentMethod: salesFulfillmentMethod("fulfillment_method"),

    currency: varchar("currency", { length: 3 }).notNull().default("UZS"),
    exchangeRate: price("exchange_rate").notNull().default("1"),

    subtotal: money("subtotal").notNull().default("0"),
    taxAmount: money("tax_amount").notNull().default("0"),
    discountAmount: money("discount_amount").notNull().default("0"),
    totalAmount: money("total_amount").notNull().default("0"),
    paidAmount: money("paid_amount").notNull().default("0"),

    /**
     * Tasdiqlangan buyurtma omborda tovarni BAND qilgan (`stock_levels.reserved_qty`).
     * Jo'natilganda yoki bekor qilinganda bo'shatiladi.
     */
    stockReserved: boolean("stock_reserved").notNull().default(false),

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
    /**
     * Shu qator uchun omborda HAQIQATDA band qilingan miqdor — ASOSIY birlikda.
     * Buyurtma miqdoridan kam bo'lishi mumkin: qoldiq yetmasa farqi band qilinmaydi (oldindan
     * buyurtma), chunki band qilingan miqdor hech qachon ombordagi qoldiqdan oshmaydi.
     * Bo'shatish aynan shu qiymat bo'yicha bajariladi — qayta hisoblashda og'ish bo'lmaydi.
     */
    reservedQty: qty("reserved_qty").notNull().default("0"),

    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    index("soi_order_idx").on(t.orderId),
    index("soi_company_product_idx").on(t.companyId, t.productId),
    check("soi_qty_positive", sql`${t.quantity} > 0`),
    check("soi_returned_qty_range", sql`${t.returnedQty} >= 0 AND ${t.returnedQty} <= ${t.quantity}`),
    check("soi_reserved_qty_non_negative", sql`${t.reservedQty} >= 0`),
    check("soi_price_non_negative", sql`${t.unitPrice} >= 0 AND ${t.costPrice} >= 0`),
  ],
);

// ─── customer_payments ───────────────────────────────────────────────────────

/**
 * To'lov hujjati (sarlavha) — mijozdan pul qabul qilishning bitta amali: POS cheki (web yoki desktop), yetkazishda
 * yig'ilgan pul, qarz yoki buyurtma to'lovi. Tarkibi — usul bo'yicha `customer_payments` qatorlari (taqsimot: usul,
 * summa, kassa/bank hisobi, terminal). `idempotency_key` — takroriy yuborish (ikki marta bosish, tarmoq qayta urinishi,
 * oflayn sinxron) ikkinchi to'lov yaratmaydi.
 */
export const payments = pgTable(
  "payments",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    /** pos | pos_device | delivery | sales_payment | pos_customer_payment | bank_receipt */
    source: varchar("source", { length: 24 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 120 }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "restrict" }),
    orderId: uuid("order_id").references(() => salesOrders.id, { onDelete: "set null" }),
    /** Qismlar yig'indisi (asosiy valyutada). */
    totalAmount: money("total_amount").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("UZS"),
    /** `posted` | `reversed` — qismlaridan biri emas, BUTUN to'lov bekor qilinadi (aralash to'lov bir hujjat). */
    status: varchar("status", { length: 16 }).notNull().default("posted"),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by").references(() => users.id, { onDelete: "set null" }),
    reversalReason: text("reversal_reason"),
    /** Bank tushumi (`bank_receipt`): bank hujjati raqami, izoh, hisob va sana — avans qismi ham shu hujjatda. */
    reference: varchar("reference", { length: 100 }),
    notes: text("notes"),
    cashAccountId: uuid("cash_account_id").references(() => cashAccounts.id, { onDelete: "set null" }),
    paymentDate: date("payment_date"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamps().createdAt,
  },
  (t) => [
    uniqueIndex("pay_company_bank_reference_key")
      .on(t.companyId, t.cashAccountId, t.reference)
      .where(sql`${t.source} = 'bank_receipt' AND ${t.reference} IS NOT NULL AND ${t.status} = 'posted'`),
    check("pay_status_known", sql`${t.status} IN ('posted', 'reversed')`),
    uniqueIndex("pay_company_idempotency_key")
      .on(t.companyId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    index("pay_company_order_idx").on(t.companyId, t.orderId),
    index("pay_company_customer_idx").on(t.companyId, t.customerId),
    check("pay_total_positive", sql`${t.totalAmount} > 0`),
    check("pay_source_valid", sql`${t.source} in ('pos', 'pos_device', 'delivery', 'sales_payment', 'pos_customer_payment', 'bank_receipt')`),
  ],
);

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
    /** To'lov hujjati — aralash to'lovning qismlari bitta hujjatda. Eski yozuvlarda null. */
    paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "set null" }),
    /** Karta to'lovi qaysi terminal orqali (hisob — terminalga bog'langan bank hisobi). */
    terminalId: uuid("terminal_id").references(() => paymentTerminals.id, { onDelete: "set null" }),
    /**
     * Kassa smenasi: to'lov qaysi sessiyada qabul qilingan. Buyurtmasiz to'lovda (qarz to'lash)
     * smenani buyurtma orqali topib bo'lmaydi — shuning uchun to'g'ridan-to'g'ri saqlanadi.
     * Kassadan tashqari to'lovlarda null.
     */
    posShiftId: uuid("pos_shift_id").references(() => posShifts.id, { onDelete: "set null" }),
    /**
     * `posted` | `reversed`. Bekor qilingan to'lov O'CHIRILMAYDI: asl yozuv saqlanadi, teskari kassa
     * harakati va jurnal yozuvi qo'shiladi (moliyaviy tarix yo'qolmaydi). Hisobotlar faqat `posted` ni oladi.
     */
    status: varchar("status", { length: 16 }).notNull().default("posted"),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by").references(() => users.id, { onDelete: "set null" }),
    reversalReason: text("reversal_reason"),
    reversalJournalEntryId: uuid("reversal_journal_entry_id").references(() => journalEntries.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    check("cp_status_known", sql`${t.status} IN ('posted', 'reversed')`),
    check("cp_reversal_complete", sql`${t.status} = 'posted' OR (${t.reversedAt} IS NOT NULL AND ${t.reversalReason} IS NOT NULL)`),
    index("cp_company_customer_idx").on(t.companyId, t.customerId),
    index("cp_payment_idx").on(t.paymentId),
    index("cp_shift_idx").on(t.posShiftId),
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


/**
 * Buyurtmasiz to'lovning ochiq hujjatlarga taqsimoti (eng eski muddat birinchi). To'lov bekor qilinganda
 * AYNAN shu summalar hujjatlardan qaytariladi — taxmin qilinmaydi.
 */
export const customerPaymentAllocations = pgTable(
  "customer_payment_allocations",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    paymentId: uuid("payment_id").notNull().references(() => customerPayments.id, { onDelete: "restrict" }),
    orderId: uuid("order_id").notNull().references(() => salesOrders.id, { onDelete: "restrict" }),
    amount: money("amount").notNull(),
    createdAt: timestamps().createdAt,
  },
  (t) => [
    index("cpa_payment_idx").on(t.paymentId),
    index("cpa_order_idx").on(t.orderId),
    check("cpa_amount_positive", sql`${t.amount} > 0`),
  ],
);
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
    /** To'lov hujjati (bank tushumining avans qismi) — hujjat bekor qilinsa bu kirim ham bekor bo'ladi. */
    paymentHeaderId: uuid("payment_header_id").references(() => payments.id, { onDelete: "set null" }),
    /** `posted` | `reversed` — kirim o'chirilmaydi, bekor qilinadi (teskari qator `deposit_reversal`). */
    status: varchar("status", { length: 16 }).notNull().default("posted"),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by").references(() => users.id, { onDelete: "set null" }),
    reversalReason: text("reversal_reason"),
    reversalJournalEntryId: uuid("reversal_journal_entry_id").references(() => journalEntries.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    check("cbt_status_known", sql`${t.status} IN ('posted', 'reversed')`),
    index("cbt_payment_header_idx").on(t.paymentHeaderId).where(sql`${t.paymentHeaderId} IS NOT NULL`),
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
    refunds: jsonb("refunds").$type<{ method: string; amount: string; cashAccountId?: string | null }[]>(),
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

// ─── customer_prices ─────────────────────────────────────────────────────────

/**
 * Mijoz bilan KELISHILGAN narx: mijoz × mahsulot × birlik. Ulgurjida narx har mijoz bilan alohida
 * kelishiladi — bu jadval shuni saqlaydi, prays-listni (`products.sales_price`) o'zgartirmaydi va
 * boshqa mijozlarga ta'sir qilmaydi.
 *
 * Narx ASOSIY valyutada (kurs bilan qayta hisoblanmaydi): kelishilgan summa shartnomadagidek qoladi.
 * Tarix saqlanadi — narx o'chirilmaydi, `effectiveTo` bilan yopiladi va yangisi qo'shiladi.
 */
export const customerPrices = pgTable(
  "customer_prices",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Qaysi birlik uchun kelishilgan (dona, blok ...) — buyurtma qatori shu birlikda bo'lsa qo'llanadi. */
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    price: price("price").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    /** null — muddatsiz (bekor qilinmaguncha amalda). */
    effectiveTo: date("effective_to"),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    index("cp_company_customer_product_idx").on(t.companyId, t.customerId, t.productId, t.unitId),
    index("cp_company_product_idx").on(t.companyId, t.productId),
    /** Bir vaqtda bitta amaldagi narx: ochiq muddatli faol narx yagona. */
    uniqueIndex("cp_open_active_key")
      .on(t.companyId, t.customerId, t.productId, t.unitId)
      .where(sql`${t.isActive} and ${t.effectiveTo} is null`),
    check("customer_prices_price_non_negative", sql`${t.price} >= 0`),
    check("customer_prices_period_check", sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`),
  ],
);
