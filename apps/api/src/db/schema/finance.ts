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
} from "drizzle-orm/pg-core";
import { companies, users } from "./platform.js";
import { legacyId, money, pk, timestamps } from "./_shared.js";

export const accountType = pgEnum("account_type", [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
]);

export const journalStatus = pgEnum("journal_status", ["draft", "posted", "voided"]);
export const expenseStatus = pgEnum("expense_status", ["pending", "approved", "paid"]);
export const cashAccountType = pgEnum("cash_account_type", ["cash", "bank"]);
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
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    index("ca_company_type_idx").on(t.companyId, t.type),
    index("ca_company_default_idx").on(t.companyId, t.isDefault),
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
    paidBy: varchar("paid_by", { length: 200 }),
    attachmentKey: text("attachment_key"),

    status: expenseStatus("status").notNull().default("pending"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("expenses_company_number_key").on(t.companyId, t.number),
    index("expenses_company_status_idx").on(t.companyId, t.status),
    index("expenses_company_date_idx").on(t.companyId, t.expenseDate),
    check("expenses_amount_positive", sql`${t.amount} > 0`),
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
