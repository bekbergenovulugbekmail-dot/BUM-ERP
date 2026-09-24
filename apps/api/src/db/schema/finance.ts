/**
 * Buxgalteriya — migratsiyaning eng nozik qismi.
 *
 * Convexdan ko'chirilgan qoidalar DB darajasida ham mustahkamlanadi:
 *   1. Debet = Kredit           → deferred constraint trigger (migratsiyada)
 *   2. Dublikat JE bo'lmasin    → unique partial index (quyida)
 *   3. Bir qatorda debet YOKI kredit → CHECK
 *
 * Ilova qatlamidagi tekshiruvlar (journalHelper.ts dan ko'chadi) saqlanadi —
 * DB cheklovlari ularni ALMASHTIRMAYDI, ikkinchi qatlam bo'lib turadi.
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
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { branches, companies, users } from "./platform.js";
import { percent } from "./_shared.js";
import { legacyId, money, pk, price, timestamps } from "./_shared.js";

export const accountType = pgEnum("account_type", [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
]);

export const journalStatus = pgEnum("journal_status", ["draft", "posted", "voided"]);
export const expenseStatus = pgEnum("expense_status", ["pending", "approved", "paid"]);
/**
 * Kassa/hisob turi: naqd, bank, hamda "kutilayotgan" hisoblar — karta terminali (UZCARD, HUMO) va elektron hamyon
 * (Payme, Click). Kutilayotgan hisobga tushgan pul bank hisobiga qirqim (settlement) bilan o'tadi: komissiya o'shanda
 * ushlanadi, qolgani bog'langan bank hisobiga tushadi.
 */
export const cashAccountType = pgEnum("cash_account_type", ["cash", "bank", "card", "ewallet"]);
export const cashTxType = pgEnum("cash_tx_type", ["in", "out", "transfer"]);

// ─── accounts (hisoblar rejasi) ──────────────────────────────────────────────

export const accounts = pgTable(
  "accounts",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    code: varchar("code", { length: 32 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    type: accountType("type").notNull(),
    subtype: varchar("subtype", { length: 64 }),
    parentId: uuid("parent_id"),
    currency: varchar("currency", { length: 3 }).notNull().default("UZS"),

    /** Yig'ma balans. Haqiqat manbai — journal_lines; bu keshlangan qiymat. */
    balance: money("balance").notNull().default("0"),

    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("accounts_company_code_key").on(t.companyId, t.code),
    index("accounts_company_type_idx").on(t.companyId, t.type),
    index("accounts_company_parent_idx").on(t.companyId, t.parentId),
  ],
);

// ─── journal_entries ─────────────────────────────────────────────────────────

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    number: varchar("number", { length: 32 }).notNull(),
    entryDate: date("entry_date").notNull(),
    description: text("description").notNull(),

    /** Manba hujjat: "sale_ship", "goods_receipt", "pos_sale" va h.k. */
    referenceType: varchar("reference_type", { length: 50 }),
    referenceId: uuid("reference_id"),

    status: journalStatus("status").notNull().default("posted"),
    totalDebit: money("total_debit").notNull().default("0"),
    totalCredit: money("total_credit").notNull().default("0"),

    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    notes: text("notes"),
    /** Bekor qilingan yozuv o'chirilmaydi — audit izi saqlanadi. */
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: uuid("voided_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("je_company_number_key").on(t.companyId, t.number),
    index("je_company_date_idx").on(t.companyId, t.entryDate),
    index("je_company_status_idx").on(t.companyId, t.status),
    /**
     * Dublikat himoyasi — Convexda bu ilova mantig'ida edi
     * (journalHelper.ts:88), endi baza darajasida ham imkonsiz.
     */
    uniqueIndex("je_company_reference_key")
      .on(t.companyId, t.referenceType, t.referenceId)
      .where(sql`${t.status} <> 'voided' AND ${t.referenceType} IS NOT NULL`),
    check("je_totals_non_negative", sql`${t.totalDebit} >= 0 AND ${t.totalCredit} >= 0`),
    check("je_balanced", sql`abs(${t.totalDebit} - ${t.totalCredit}) <= 1`),
  ],
);

// ─── journal_lines ───────────────────────────────────────────────────────────

export const journalLines = pgTable(
  "journal_lines",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    entryId: uuid("entry_id").notNull().references(() => journalEntries.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }),

    debit: money("debit").notNull().default("0"),
    credit: money("credit").notNull().default("0"),
    description: text("description"),
    createdAt: timestamps().createdAt,
  },
  (t) => [
    index("jl_entry_idx").on(t.entryId),
    index("jl_company_account_idx").on(t.companyId, t.accountId),
    check("jl_amounts_non_negative", sql`${t.debit} >= 0 AND ${t.credit} >= 0`),
    /** Bir qatorda faqat bittasi bo'ladi — ikkalasi ham nol emas. */
    check("jl_debit_xor_credit", sql`(${t.debit} = 0) <> (${t.credit} = 0)`),
  ],
);

// ─── cash_accounts ───────────────────────────────────────────────────────────

export const cashAccounts = pgTable(
  "cash_accounts",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    name: varchar("name", { length: 200 }).notNull(),
    type: cashAccountType("type").notNull().default("cash"),
    currency: varchar("currency", { length: 3 }).notNull().default("UZS"),
    bankName: varchar("bank_name", { length: 200 }),
    accountNumber: varchar("account_number", { length: 64 }),
    balance: money("balance").notNull().default("0"),
    /**
     * Hisoblar rejasidagi alohida hisob (masalan, 1021 "X bank UZS") — bir nechta bank hisobi buxgalteriyada ajralsin.
     * Bo'lmasa turi bo'yicha umumiy: 1010 naqd / 1020 bank.
     */
    ledgerAccountId: uuid("ledger_account_id").references(() => accounts.id, { onDelete: "set null" }),
    /** Kassada (web va desktop) to'lov usuli sifatida ko'rinadi — bank hisobi uchun ("Bank: Kapitalbank"). */
    showInPos: boolean("show_in_pos").notNull().default(false),
    /** Bank hisobidan pul chiqarishda bank komissiyasi, % (ta'minotchiga, xarajat, maosh, o'tkazma) — avtomatik yechiladi. */
    outgoingCommissionPercent: percent("outgoing_commission_percent").notNull().default("0"),
    /**
     * "Kutilayotgan" hisob (turi `card`/`ewallet`) qaysi bank hisobiga qirqiladi. Karta tushumi shu hisobda turadi,
     * bank pulni o'tkazganda `settlementCommissionPercent` ushlanib, qolgani shu bank hisobiga o'tadi.
     */
    settlesToCashAccountId: uuid("settles_to_cash_account_id").references((): AnyPgColumn => cashAccounts.id, { onDelete: "set null" }),
    /** Qirqim (settlement) komissiyasi, % — kutilayotgan hisobdan bankka o'tkazishda ushlanadi. */
    settlementCommissionPercent: percent("settlement_commission_percent").notNull().default("0"),
    /**
     * Yetkazuvchining "yo'ldagi naqd" hisobi: dostavkada yig'ilgan naqd kassaga topshirilguncha shu yerda.
     * FK yo'q (sales → finance importi aylanma bo'lmasin) — agent kodda tekshiriladi.
     */
    deliveryAgentId: uuid("delivery_agent_id"),
    /**
     * Savdo agentining "yo'ldagi naqd" hisobi: mijozdan yig'ilgan naqd kassaga topshirilguncha shu yerda.
     * FK yo'q (aylanma import bo'lmasin) — agent kodda tekshiriladi.
     */
    salesRepId: uuid("sales_rep_id"),
    /**
     * Kassaning mas'ul xodimi: rahbar (asosiy) kassadan tashqari har kassa bitta xodimga biriktiriladi —
     * "Kassir Diana", "Ishchilar kassasi" kabi. FK yo'q (hr → finance importi aylanma bo'lmasin),
     * xodim shu kompaniyaniki ekani kodda tekshiriladi; xodim o'chirilsa bog'lanish bo'shatiladi.
     */
    employeeId: uuid("employee_id"),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    index("ca_company_type_idx").on(t.companyId, t.type),
    uniqueIndex("ca_delivery_agent_key")
      .on(t.companyId, t.deliveryAgentId)
      .where(sql`${t.deliveryAgentId} is not null`),
    uniqueIndex("ca_sales_rep_key")
      .on(t.companyId, t.salesRepId)
      .where(sql`${t.salesRepId} is not null`),
    index("ca_company_employee_idx").on(t.companyId, t.employeeId),
    index("ca_company_default_idx").on(t.companyId, t.isDefault),
    /** Har kompaniyada bitta asosiy kassa — to'lovlar shunga tushadi. */
    uniqueIndex("ca_one_default_per_company_key")
      .on(t.companyId)
      .where(sql`${t.isDefault}`),
  ],
);

// ─── cash_transactions ───────────────────────────────────────────────────────

export const cashTransactions = pgTable(
  "cash_transactions",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    cashAccountId: uuid("cash_account_id").notNull().references(() => cashAccounts.id, { onDelete: "restrict" }),
    type: cashTxType("type").notNull(),
    amount: money("amount").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("UZS"),
    txDate: date("tx_date").notNull(),
    description: text("description").notNull(),
    category: varchar("category", { length: 64 }),

    referenceType: varchar("reference_type", { length: 50 }),
    referenceId: uuid("reference_id"),

    /** Tranzaksiyadan keyingi qoldiq — audit izi uchun. */
    balanceAfter: money("balance_after").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamps().createdAt,
  },
  (t) => [
    index("ct_company_account_date_idx").on(t.companyId, t.cashAccountId, t.txDate),
    index("ct_reference_idx").on(t.referenceType, t.referenceId),
    check("ct_amount_positive", sql`${t.amount} > 0`),
  ],
);

// ─── payment_terminals ───────────────────────────────────────────────────────

/**
 * Karta to'lov terminali (UZCARD, HUMO, VISA ...): karta tushumi qaysi bank hisobiga tushishini belgilaydi.
 * Haqiqiy ekvayring API'si ulanmagan — to'lov kassir yoki dostavshik tomonidan terminal chekiga qarab kiritiladi;
 * ekvayring adapteri keyin shu yozuvga ulanadi. O'chirilmaydi — faolsizlantiriladi (eski to'lovlar bog'lanishi saqlanadi).
 */
export const paymentTerminals = pgTable(
  "payment_terminals",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    name: varchar("name", { length: 100 }).notNull(),
    /** uzcard | humo | visa | mastercard | unionpay | other (@bum/shared TERMINAL_NETWORKS). */
    network: varchar("network", { length: 20 }).notNull(),
    /** Ekvayer bank yoki provayder nomi. */
    provider: varchar("provider", { length: 100 }),
    /** Tushum tushadigan bank hisobi (faqat `bank` turidagi, asosiy valyutada). */
    cashAccountId: uuid("cash_account_id")
      .notNull()
      .references(() => cashAccounts.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    /** Bank bergan terminal ID (TID). */
    terminalIdentifier: varchar("terminal_identifier", { length: 64 }),
    /** Ekvayring komissiyasi, %: 100 000 so'm to'lovda 0.25% — bank hisobiga 99 750, 250 so'm bank komissiyasi xarajati. */
    commissionPercent: percent("commission_percent").notNull().default("0"),
    /** Kassada (web va desktop) to'lov usuli sifatida ko'rinadi. */
    showInPos: boolean("show_in_pos").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    index("pt_company_active_idx").on(t.companyId, t.isActive),
    uniqueIndex("pt_company_name_key").on(t.companyId, t.name),
    uniqueIndex("pt_company_identifier_key")
      .on(t.companyId, t.terminalIdentifier)
      .where(sql`${t.terminalIdentifier} IS NOT NULL`),
    check("pt_network_valid", sql`${t.network} in ('uzcard', 'humo', 'visa', 'mastercard', 'unionpay', 'other')`),
  ],
);

// ─── expenses ────────────────────────────────────────────────────────────────

export const expenses = pgTable(
  "expenses",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    number: varchar("number", { length: 32 }).notNull(),
    category: varchar("category", { length: 64 }).notNull(),
    description: text("description").notNull(),
    amount: money("amount").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("UZS"),
    expenseDate: date("expense_date").notNull(),

    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    /**
     * Xarajat qaysi xodimga tegishli (maosh, ovqat puli, yo'l haqi). FK yo'q — hr → finance importi
     * aylanma bo'lmasin; xodim shu kompaniyaniki ekani kodda tekshiriladi.
     */
    employeeId: uuid("employee_id"),
    /** Xodimga to'lov turi: `salary`, `meal`, `transport`, `phone`, `housing`, `other`. */
    payoutKind: varchar("payout_kind", { length: 20 }),
    paidBy: varchar("paid_by", { length: 200 }),
    attachmentKey: text("attachment_key"),

    status: expenseStatus("status").notNull().default("pending"),
    notes: text("notes"),
    /**
     * Avtomatik xarajat manbai (masalan, bank komissiyasi: `customer_payment`, `supplier_payment` + ID). Qo'lda
     * kiritilganda null. Bitta manbadan bitta xarajat — takroriy so'rovda ikkinchi komissiya yozilmaydi.
     */
    referenceType: varchar("reference_type", { length: 50 }),
    referenceId: uuid("reference_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("expenses_company_number_key").on(t.companyId, t.number),
    uniqueIndex("expenses_company_reference_key")
      .on(t.companyId, t.referenceType, t.referenceId)
      .where(sql`${t.referenceType} IS NOT NULL`),
    index("expenses_company_status_idx").on(t.companyId, t.status),
    index("expenses_company_date_idx").on(t.companyId, t.expenseDate),
    check("expenses_amount_positive", sql`${t.amount} > 0`),
  ],
);

// ─── valyutalar va kurslar ───────────────────────────────────────────────────

export const currencyRateSource = pgEnum("currency_rate_source", ["manual", "cbu"]);

/** Kompaniya ishlatadigan valyutalar (asosiy valyutadan tashqari) va joriy kurs. */
export const companyCurrencies = pgTable(
  "company_currencies",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 3 }).notNull(),
    /** 1 birlik valyuta = `rate` asosiy valyuta. */
    rate: price("rate").notNull(),
    source: currencyRateSource("source").notNull().default("manual"),
    rateDate: date("rate_date").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("cc_company_code_key").on(t.companyId, t.code),
    check("cc_rate_positive", sql`${t.rate} > 0`),
  ],
);

/** Kurs tarixi — har o'zgarish. Hujjatlar o'z kursini o'zida saqlaydi. */
export const exchangeRates = pgTable(
  "exchange_rates",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 3 }).notNull(),
    /** Oldingi kurs (birinchi yozuvda null). */
    oldRate: price("old_rate"),
    rate: price("rate").notNull(),
    source: currencyRateSource("source").notNull(),
    rateDate: date("rate_date").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    /** Kassadan o'zgartirilgan bo'lsa — qurilma (sxemalar aylanma bog'lanmasin: FK yo'q). */
    deviceId: uuid("device_id"),
    createdAt: timestamps().createdAt,
  },
  (t) => [
    index("er_company_code_date_idx").on(t.companyId, t.code, t.rateDate),
    check("er_rate_positive", sql`${t.rate} > 0`),
  ],
);

// ─── relations ───────────────────────────────────────────────────────────────

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  parent: one(accounts, {
    fields: [accounts.parentId],
    references: [accounts.id],
    relationName: "account_parent",
  }),
  children: many(accounts, { relationName: "account_parent" }),
  lines: many(journalLines),
}));

export const journalEntriesRelations = relations(journalEntries, ({ one, many }) => ({
  company: one(companies, { fields: [journalEntries.companyId], references: [companies.id] }),
  lines: many(journalLines),
}));

export const journalLinesRelations = relations(journalLines, ({ one }) => ({
  entry: one(journalEntries, { fields: [journalLines.entryId], references: [journalEntries.id] }),
  account: one(accounts, { fields: [journalLines.accountId], references: [accounts.id] }),
}));

export const cashTransactionsRelations = relations(cashTransactions, ({ one }) => ({
  account: one(cashAccounts, {
    fields: [cashTransactions.cashAccountId],
    references: [cashAccounts.id],
  }),
}));

/**
 * PUL TOPSHIRISH HUJJATI: agent/yetkazuvchi yig'gan pulni mas'ul shaxsga topshiradi.
 *
 * Hayot sikli: `submitted` → `accepted` yoki `rejected` (yoki topshiruvchi `cancelled` qiladi).
 * Pul FAQAT qabul qilinganda ko'chadi — rad etishda buxgalteriya yozuvi umuman yaratilmagan
 * bo'ladi, shuning uchun qaytarish (reversal) kerak emas va ikki marta hisoblash xavfi yo'q.
 *
 * Karta tushumi jismonan agentda bo'lmaydi (to'g'ridan-to'g'ri bank/karta hisobiga tushadi),
 * shuning uchun qabul qilishda ikkinchi marta ko'chirilmaydi — faqat solishtirish uchun yoziladi.
 */
export const cashHandovers = pgTable(
  "cash_handovers",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    salesRepId: uuid("sales_rep_id"),
    deliveryAgentId: uuid("delivery_agent_id"),

    number: varchar("number", { length: 32 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("submitted"),

    cashAmount: money("cash_amount").notNull().default("0"),
    cardAmount: money("card_amount").notNull().default("0"),
    totalAmount: money("total_amount").notNull().default("0"),

    /** Qabul qilinganda haqiqatda kassaga tushgan naqd (farq bo'lsa kamroq bo'lishi mumkin). */
    acceptedCashAmount: money("accepted_cash_amount"),
    toCashAccountId: uuid("to_cash_account_id").references(() => cashAccounts.id, { onDelete: "set null" }),
    cashTransactionId: uuid("cash_transaction_id"),

    notes: text("notes"),
    rejectReason: text("reject_reason"),

    submittedBy: uuid("submitted_by").references(() => users.id, { onDelete: "set null" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("handover_company_number_key").on(t.companyId, t.number),
    index("handover_company_status_idx").on(t.companyId, t.status),
    index("handover_rep_idx").on(t.companyId, t.salesRepId),
    index("handover_agent_idx").on(t.companyId, t.deliveryAgentId),
    check("handover_one_holder", sql`(${t.salesRepId} is null) <> (${t.deliveryAgentId} is null)`),
    check("handover_status", sql`${t.status} in ('submitted', 'accepted', 'rejected', 'cancelled')`),
    check("handover_amounts_non_negative", sql`${t.cashAmount} >= 0 and ${t.cardAmount} >= 0 and ${t.totalAmount} >= 0`),
    check("handover_total_matches", sql`${t.totalAmount} = ${t.cashAmount} + ${t.cardAmount}`),
    check("handover_positive", sql`${t.totalAmount} > 0`),
    check(
      "handover_accepted_within",
      sql`${t.acceptedCashAmount} is null or (${t.acceptedCashAmount} >= 0 and ${t.acceptedCashAmount} <= ${t.cashAmount})`,
    ),
    check(
      "handover_reject_reason",
      sql`${t.status} <> 'rejected' or (${t.rejectReason} is not null and length(btrim(${t.rejectReason})) > 0)`,
    ),
  ],
);
