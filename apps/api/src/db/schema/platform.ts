/**
 * Platforma darajasidagi jadvallar: foydalanuvchi, sessiya, kompaniya,
 * a'zolik, rol, filial, sozlama, audit, taklif.
 *
 * `users`, `companies` va `sessions` — tenantdan YUQORIDA turadi, ya'ni
 * ularda `company_id` yo'q. Qolgan hamma narsada bor.
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  auditSeverity,
  companyStatus,
  legacyId,
  passwordAlgo,
  pk,
  timestamps,
} from "./_shared.js";

// ─── users ───────────────────────────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: pk(),
    legacyId: legacyId(),

    /** Login identifikatori. Har doim +998XXXXXXXXX ko'rinishida saqlanadi. */
    phone: varchar("phone", { length: 20 }).notNull(),
    name: varchar("name", { length: 200 }),
    email: varchar("email", { length: 255 }),
    avatarUrl: text("avatar_url"),

    /** Argon2id hash. Migratsiya davrida eski akkauntlarda scrypt bo'lishi mumkin. */
    passwordHash: text("password_hash"),
    passwordAlgo: passwordAlgo("password_algo").notNull().default("argon2id"),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),

    isActive: boolean("is_active").notNull().default(true),
    isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
    /**
     * Ildiz platforma admini — .env dan seed qilinadi (`db:seed`). API orqali
     * o'zgartirilmaydi; bazada o'chirish va maqomini olish trigger bilan taqiqlangan.
     */
    isBootstrapAdmin: boolean("is_bootstrap_admin").notNull().default(false),

    activeCompanyId: uuid("active_company_id"),

    // ── PIN tez qulfdan chiqarish ──
    // PIN sessiya YARATMAYDI — u faqat mavjud sessiyaning UI qulfini ochadi.
    pinHash: text("pin_hash"),
    pinFailedAttempts: integer("pin_failed_attempts").notNull().default(0),
    pinLockedUntil: timestamp("pin_locked_until", { withTimezone: true }),
    autoLockSeconds: integer("auto_lock_seconds").notNull().default(30),

    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("users_phone_key").on(t.phone),
    uniqueIndex("users_legacy_id_key").on(t.legacyId),
    index("users_active_company_idx").on(t.activeCompanyId),
    /** Bootstrap admin faqat bitta bo'ladi. */
    uniqueIndex("users_single_bootstrap_admin_key")
      .on(t.isBootstrapAdmin)
      .where(sql`${t.isBootstrapAdmin}`),
    /** Bootstrap admin doim faol platforma admini — adminlikni olish yoki bloklash imkonsiz. */
    check(
      "users_bootstrap_admin_active_platform_admin",
      sql`NOT ${t.isBootstrapAdmin} OR (${t.isPlatformAdmin} AND ${t.isActive})`,
    ),
  ],
);

// ─── sessions ────────────────────────────────────────────────────────────────

export const sessions = pgTable(
  "sessions",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** Cookie'dagi token xom saqlanmaydi — faqat SHA-256 hash. */
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),

    /** Mutlaq muddat — uzaytirilmaydi. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Faolsizlik muddati — har so'rovda uzaytiriladi. */
    idleExpiresAt: timestamp("idle_expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** Ekran qulflangan — sessiya saqlanadi, ochish faqat PIN bilan (chiqishdan keyin PIN ishlamaydi). */
    lockedAt: timestamp("locked_at", { withTimezone: true }),

    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamps().createdAt,
  },
  (t) => [
    uniqueIndex("sessions_token_hash_key").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
    index("sessions_expires_idx").on(t.expiresAt),
  ],
);

// ─── password reset codes ────────────────────────────────────────────────────

export const passwordResetCodes = pgTable(
  "password_reset_codes",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** OTP ochiq saqlanmaydi. */
    codeHash: varchar("code_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamps().createdAt,
  },
  (t) => [
    index("prc_user_idx").on(t.userId),
    index("prc_expires_idx").on(t.expiresAt),
  ],
);

// ─── rate limits ─────────────────────────────────────────────────────────────

/** Redis o'rniga — hozirgi hajm uchun PostgreSQL to'liq yetadi. */
export const rateLimits = pgTable(
  "rate_limits",
  {
    id: pk(),
    /** Masalan "login:+998901234567" yoki "reset-request:1.2.3.4". */
    bucket: varchar("bucket", { length: 200 }).notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [uniqueIndex("rate_limits_bucket_window_key").on(t.bucket, t.windowStart)],
);

// ─── companies ───────────────────────────────────────────────────────────────

export const companies = pgTable(
  "companies",
  {
    id: pk(),
    legacyId: legacyId(),

    name: varchar("name", { length: 200 }).notNull(),
    legalName: varchar("legal_name", { length: 300 }),
    /** STIR */
    taxId: varchar("tax_id", { length: 32 }),
    phone: varchar("phone", { length: 20 }),
    email: varchar("email", { length: 255 }),
    website: varchar("website", { length: 255 }),
    address: text("address"),
    city: varchar("city", { length: 100 }),
    region: varchar("region", { length: 100 }),
    country: varchar("country", { length: 2 }).notNull().default("UZ"),
    currency: varchar("currency", { length: 3 }).notNull().default("UZS"),
    language: varchar("language", { length: 2 }).notNull().default("uz"),
    logoUrl: text("logo_url"),

    /** Subdomen va /t/:slug portali uchun. */
    slug: varchar("slug", { length: 40 }),

    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),

    status: companyStatus("status").notNull().default("trial"),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    isPlatformTenant: boolean("is_platform_tenant").notNull().default(false),

    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    suspendReason: text("suspend_reason"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),

    ...timestamps(),
  },
  (t) => [
    uniqueIndex("companies_slug_key").on(t.slug),
    uniqueIndex("companies_legacy_id_key").on(t.legacyId),
    index("companies_status_idx").on(t.status),
  ],
);

// ─── branches ────────────────────────────────────────────────────────────────

export const branches = pgTable(
  "branches",
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
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    index("branches_company_idx").on(t.companyId),
    uniqueIndex("branches_company_code_key").on(t.companyId, t.code),
    /** Har kompaniyada bitta asosiy filial (Convex'da ikkitasi bo'lib qolishi mumkin edi). */
    uniqueIndex("branches_one_default_per_company_key")
      .on(t.companyId)
      .where(sql`${t.isDefault}`),
  ],
);

// ─── roles ───────────────────────────────────────────────────────────────────

/**
 * `company_id` NULL bo'lsa — global (tizim) rol.
 * Convexda bu ajratim indeks bilan ta'minlanmagan edi va `by_name` bo'yicha
 * `.first()` noto'g'ri rolni qaytarish muammosini keltirib chiqargan (audit).
 *
 * Unikallik NULLS NOT DISTINCT — oddiy unikal indeksda NULL lar bir-biriga
 * teng emas, ya'ni bir xil nomli global rollar takrorlanib ketaverardi.
 */
export const roles = pgTable(
  "roles",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),

    name: varchar("name", { length: 100 }).notNull(),
    description: text("description"),
    color: varchar("color", { length: 16 }),
    permissions: text("permissions").array().notNull().default([]),
    isSystem: boolean("is_system").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    memberCount: integer("member_count").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    unique("roles_company_name_key").on(t.companyId, t.name).nullsNotDistinct(),
    index("roles_company_idx").on(t.companyId),
  ],
);

// ─── company_members ─────────────────────────────────────────────────────────

export const companyMembers = pgTable(
  "company_members",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** Rol nomi ("Business Owner", "Kassir" …) — roles.name bilan mos. */
    companyRole: varchar("company_role", { length: 100 }).notNull(),
    roleId: uuid("role_id").references(() => roles.id, { onDelete: "set null" }),

    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    /** Bo'sh massiv = barcha omborlarga ruxsat. */
    allowedWarehouseIds: uuid("allowed_warehouse_ids").array().notNull().default([]),
    /** Mas'ul kategoriyalar (ichki kategoriyalari bilan). Bo'sh massiv = barcha kategoriyalar. */
    allowedCategoryIds: uuid("allowed_category_ids").array().notNull().default([]),

    isActive: boolean("is_active").notNull().default(true),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("company_members_company_user_key").on(t.companyId, t.userId),
    index("company_members_user_idx").on(t.userId),
  ],
);

// ─── settings ────────────────────────────────────────────────────────────────

/** `company_id` NULL = platforma darajasidagi sozlama. */
export const settings = pgTable(
  "settings",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),

    key: varchar("key", { length: 100 }).notNull(),
    value: text("value").notNull(),
    description: text("description"),
    group: varchar("group", { length: 50 }).notNull(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    // NULLS NOT DISTINCT: platforma sozlamasi (company_id NULL) ham bitta kalitga bitta
    unique("settings_company_key_key").on(t.companyId, t.key).nullsNotDistinct(),
    index("settings_company_group_idx").on(t.companyId, t.group),
  ],
);

// ─── audit_logs ──────────────────────────────────────────────────────────────

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),

    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** Foydalanuvchi o'chirilsa ham kim qilgani ma'lum qolishi uchun. */
    userName: varchar("user_name", { length: 200 }),

    action: varchar("action", { length: 100 }).notNull(),
    resource: varchar("resource", { length: 100 }).notNull(),
    resourceId: varchar("resource_id", { length: 64 }),
    details: jsonb("details"),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    severity: auditSeverity("severity").notNull().default("info"),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamps().createdAt,
  },
  (t) => [
    index("audit_logs_company_occurred_idx").on(t.companyId, t.occurredAt),
    index("audit_logs_user_idx").on(t.userId),
    index("audit_logs_resource_idx").on(t.resource, t.resourceId),
  ],
);

// ─── invitations ─────────────────────────────────────────────────────────────

export const invitations = pgTable(
  "invitations",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    phone: varchar("phone", { length: 20 }),
    email: varchar("email", { length: 255 }),
    companyRole: varchar("company_role", { length: 100 }).notNull(),
    token: varchar("token", { length: 64 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("invitations_token_key").on(t.token),
    index("invitations_company_idx").on(t.companyId),
    index("invitations_status_idx").on(t.companyId, t.status),
  ],
);

// ─── relations ───────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many, one }) => ({
  sessions: many(sessions),
  memberships: many(companyMembers),
  activeCompany: one(companies, {
    fields: [users.activeCompanyId],
    references: [companies.id],
  }),
}));

export const companiesRelations = relations(companies, ({ many, one }) => ({
  members: many(companyMembers),
  branches: many(branches),
  owner: one(users, { fields: [companies.ownerId], references: [users.id] }),
}));

export const companyMembersRelations = relations(companyMembers, ({ one }) => ({
  company: one(companies, {
    fields: [companyMembers.companyId],
    references: [companies.id],
  }),
  user: one(users, { fields: [companyMembers.userId], references: [users.id] }),
  role: one(roles, { fields: [companyMembers.roleId], references: [roles.id] }),
  branch: one(branches, { fields: [companyMembers.branchId], references: [branches.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));
