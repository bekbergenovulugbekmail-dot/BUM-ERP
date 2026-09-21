/**
 * Obuna va litsenziya: tariflar, kompaniya obunasi, foydalanuvchi litsenziyalari, to'lov so'rovlari va tarix.
 *
 * Employee ≠ User ≠ License: HR xodimi (`employees`) dasturdan foydalanmasligi mumkin; dasturdan foydalanadigan
 * har faol a'zo (`company_members`) — bitta joriy litsenziya (`licenses`, bekor qilinmagan). Obuna kompaniyaga bitta
 * (`subscriptions.company_id` unikal); har o'zgarish `subscription_history` / `license_history` da qoladi.
 * To'lov shlyuzi yo'q: egasi so'rov yuboradi (`subscription_payments`, pending), platforma admini tasdiqlaydi —
 * faollashtirish shu tranzaksiyada va idempotent.
 *
 * Moliyaviy tarix saqlanishi uchun kompaniya FK lari `restrict`.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { employees } from "./hr.js";
import { companies, users } from "./platform.js";
import { createdAt, money, pk, timestamps } from "./_shared.js";

export const subscriptionStatus = pgEnum("subscription_status", ["trial", "active", "expired", "cancelled"]);
export const subscriptionPlanKind = pgEnum("subscription_plan_kind", ["main", "additional_license"]);
export const licenseType = pgEnum("license_type", ["included", "additional"]);
export const licenseStatus = pgEnum("license_status", ["active", "pending_payment", "expired", "revoked"]);
export const subscriptionPaymentKind = pgEnum("subscription_payment_kind", ["subscription", "license"]);
export const subscriptionPaymentStatus = pgEnum("subscription_payment_status", ["pending", "paid", "cancelled"]);

// ─── subscription_plans ──────────────────────────────────────────────────────

/** Tariflar bazada — narx va muddat kodga yozilmaydi (boshlang'ich qatorlar migratsiyada). */
export const subscriptionPlans = pgTable(
  "subscription_plans",
  {
    id: pk(),
    code: varchar("code", { length: 40 }).notNull(),
    kind: subscriptionPlanKind("kind").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    price: money("price").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("UZS"),
    durationMonths: integer("duration_months").notNull(),
    bonusMonths: integer("bonus_months").notNull().default(0),
    /** Asosiy tarif beradigan included litsenziyalar (qo'shimcha litsenziya tarifida 0). */
    includedLicenses: integer("included_licenses").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("subscription_plans_code_key").on(t.code),
    index("subscription_plans_kind_idx").on(t.kind, t.isActive),
    check("subscription_plans_duration", sql`${t.durationMonths} between 1 and 120`),
    check("subscription_plans_bonus", sql`${t.bonusMonths} between 0 and 120`),
    check("subscription_plans_price_non_negative", sql`${t.price} >= 0`),
    check("subscription_plans_included_licenses", sql`${t.includedLicenses} >= 0`),
  ],
);

// ─── subscriptions ───────────────────────────────────────────────────────────

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    /** Oxirgi to'langan asosiy tarif; trial va tizimdan oldingi (muddatsiz) obunada NULL. */
    planId: uuid("plan_id").references(() => subscriptionPlans.id, { onDelete: "restrict" }),
    status: subscriptionStatus("status").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    baseDurationMonths: integer("base_duration_months").notNull().default(0),
    bonusMonths: integer("bonus_months").notNull().default(0),
    /** NULL — muddatsiz: tizim joriy etilgunga qadar faol bo'lgan kompaniyalar (hech kim uzilib qolmasin). */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** Kompaniya egasi ham shu litsenziyalardan birini egallaydi. */
    includedLicenses: integer("included_licenses").notNull().default(3),
    /** Oxirgi yuborilgan trial ogohlantirishi (10/5/3/1 kun) — qayta yuborilmasin. */
    trialWarningDays: integer("trial_warning_days"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("subscriptions_company_key").on(t.companyId),
    index("subscriptions_status_expires_idx").on(t.status, t.expiresAt),
    check("subscriptions_included_licenses", sql`${t.includedLicenses} between 1 and 10000`),
    check("subscriptions_trial_expires", sql`${t.status} <> 'trial' or ${t.expiresAt} is not null`),
  ],
);

// ─── licenses ────────────────────────────────────────────────────────────────

export const licenses = pgTable(
  "licenses",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "set null" }),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "restrict" }),
    /** Qo'shimcha litsenziya tarifi (included da NULL). */
    planId: uuid("plan_id").references(() => subscriptionPlans.id, { onDelete: "restrict" }),
    licenseType: licenseType("license_type").notNull(),
    status: licenseStatus("status").notNull(),
    price: money("price").notNull().default("0"),
    /** Included — obuna muddati bilan; additional — o'z muddati. To'lov tasdiqlanmaguncha NULL. */
    startAt: timestamp("start_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** Oxirgi yuborilgan tugash ogohlantirishi (kun): har chegara bir marta, uzaytirilganda null. */
    warningDays: integer("warning_days"),
    assignedBy: uuid("assigned_by").references(() => users.id, { onDelete: "set null" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokeReason: varchar("revoke_reason", { length: 200 }),
    ...timestamps(),
  },
  (t) => [
    /** Foydalanuvchida kompaniyada bittadan ortiq joriy (bekor qilinmagan) litsenziya bo'lmaydi. */
    uniqueIndex("licenses_company_user_current_key")
      .on(t.companyId, t.userId)
      .where(sql`${t.status} <> 'revoked'`),
    index("licenses_company_status_idx").on(t.companyId, t.status),
    index("licenses_subscription_idx").on(t.subscriptionId),
    index("licenses_employee_idx").on(t.employeeId),
    index("licenses_status_expires_idx").on(t.status, t.expiresAt),
    check("licenses_additional_plan", sql`${t.licenseType} = 'included' or ${t.planId} is not null`),
    check("licenses_price_non_negative", sql`${t.price} >= 0`),
  ],
);

// ─── subscription_payments ───────────────────────────────────────────────────

export const subscriptionPayments = pgTable(
  "subscription_payments",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    kind: subscriptionPaymentKind("kind").notNull(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => subscriptionPlans.id, { onDelete: "restrict" }),
    /** kind = license: qaysi xodim litsenziyasi (yangi yoki uzaytiriladigan). */
    licenseId: uuid("license_id").references(() => licenses.id, { onDelete: "restrict" }),
    /** So'rov paytidagi tarif narxi — keyin tarif o'zgarsa ham hisob o'zgarmaydi. */
    amount: money("amount").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("UZS"),
    status: subscriptionPaymentStatus("status").notNull().default("pending"),
    /** Takroriy bosish yoki qayta yuborish ikkinchi so'rov yaratmaydi. */
    idempotencyKey: varchar("idempotency_key", { length: 100 }).notNull(),
    /** To'lov hujjati (kvitansiya, bank o'tkazmasi raqami) — admin tasdiqlashda. */
    reference: varchar("reference", { length: 200 }),
    note: text("note"),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    confirmedBy: uuid("confirmed_by").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("subscription_payments_idempotency_key").on(t.companyId, t.idempotencyKey),
    index("subscription_payments_company_created_idx").on(t.companyId, t.createdAt),
    index("subscription_payments_status_idx").on(t.status, t.createdAt),
    /** Kompaniyada bitta kutilayotgan obuna to'lovi, litsenziyaga bitta kutilayotgan to'lov. */
    uniqueIndex("subscription_payments_pending_subscription_key")
      .on(t.companyId)
      .where(sql`${t.status} = 'pending' and ${t.kind} = 'subscription'`),
    uniqueIndex("subscription_payments_pending_license_key")
      .on(t.licenseId)
      .where(sql`${t.status} = 'pending'`),
    check("subscription_payments_amount_non_negative", sql`${t.amount} >= 0`),
    check("subscription_payments_license_kind", sql`(${t.kind} = 'license') = (${t.licenseId} is not null)`),
  ],
);

// ─── subscription_history ────────────────────────────────────────────────────

export const subscriptionHistory = pgTable(
  "subscription_history",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "restrict" }),
    /** trial_started | activated | renewed | expired | cancelled | licenses_changed | legacy_migrated */
    event: varchar("event", { length: 40 }).notNull(),
    status: subscriptionStatus("status").notNull(),
    planId: uuid("plan_id").references(() => subscriptionPlans.id, { onDelete: "restrict" }),
    planName: varchar("plan_name", { length: 120 }),
    price: money("price").notNull().default("0"),
    durationMonths: integer("duration_months").notNull().default(0),
    bonusMonths: integer("bonus_months").notNull().default(0),
    effectiveMonths: integer("effective_months").notNull().default(0),
    startAt: timestamp("start_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    includedLicenses: integer("included_licenses"),
    paymentId: uuid("payment_id").references(() => subscriptionPayments.id, { onDelete: "restrict" }),
    paymentReference: varchar("payment_reference", { length: 200 }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("subscription_history_company_created_idx").on(t.companyId, t.createdAt)],
);

// ─── license_history ─────────────────────────────────────────────────────────

export const licenseHistory = pgTable(
  "license_history",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    licenseId: uuid("license_id")
      .notNull()
      .references(() => licenses.id, { onDelete: "restrict" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "set null" }),
    /** assigned | pending_payment | activated | renewed | expired | revoked | legacy_migrated */
    event: varchar("event", { length: 40 }).notNull(),
    licenseType: licenseType("license_type").notNull(),
    status: licenseStatus("status").notNull(),
    planId: uuid("plan_id").references(() => subscriptionPlans.id, { onDelete: "restrict" }),
    planName: varchar("plan_name", { length: 120 }),
    price: money("price").notNull().default("0"),
    startAt: timestamp("start_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    paymentId: uuid("payment_id").references(() => subscriptionPayments.id, { onDelete: "restrict" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("license_history_company_created_idx").on(t.companyId, t.createdAt),
    index("license_history_license_idx").on(t.licenseId),
  ],
);
