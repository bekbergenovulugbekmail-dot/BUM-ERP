/**
 * Offline kassa qurilmalari (BUM POS KASSA desktop) va ulardan kelgan sinxron amallari.
 *
 *  - Qurilma tokeni faqat SHA-256 xeshi bilan saqlanadi; qurilma bitta kompaniya va omborga bog'langan.
 *  - `code` — offline chek raqami prefiksi (K01, K02 …), kompaniyada unikal.
 *  - `pos_sync_operations` — qurilmadan kelgan har amal (`op_id`) bir marta bajariladi; natija yoki rad etish sababi
 *    saqlanadi va takroriy yuborishda o'sha javob qaytadi.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { companies, users } from "./platform.js";
import { warehouses } from "./inventory.js";
import { pk, timestamps } from "./_shared.js";

export const posSyncOpStatus = pgEnum("pos_sync_op_status", ["applied", "rejected"]);

export const posDevices = pgTable(
  "pos_devices",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 100 }).notNull(),
    /** Chek raqami prefiksi: K01, K02 … */
    code: varchar("code", { length: 8 }).notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    registeredBy: uuid("registered_by").references(() => users.id, { onDelete: "set null" }),
    appVersion: varchar("app_version", { length: 32 }),
    platform: varchar("platform", { length: 32 }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    lastPullAt: timestamp("last_pull_at", { withTimezone: true }),
    lastPushAt: timestamp("last_push_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("pos_devices_company_code_key").on(t.companyId, t.code),
    uniqueIndex("pos_devices_token_hash_key").on(t.tokenHash),
    index("pos_devices_company_idx").on(t.companyId),
  ],
);

export type PosSyncError = { code: string; message: string; details?: unknown };

export const posSyncOperations = pgTable(
  "pos_sync_operations",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => posDevices.id, { onDelete: "cascade" }),
    /** Qurilma yaratgan identifikator — takroriy yuborishda bitta amal. */
    opId: uuid("op_id").notNull(),
    type: varchar("type", { length: 40 }).notNull(),
    cashierId: uuid("cashier_id").references(() => users.id, { onDelete: "set null" }),
    status: posSyncOpStatus("status").notNull(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: jsonb("error").$type<PosSyncError>(),
    /** Amal qurilmada bajarilgan vaqt (offline bo'lishi mumkin). */
    clientCreatedAt: timestamp("client_created_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("pso_device_op_key").on(t.deviceId, t.opId),
    index("pso_company_received_idx").on(t.companyId, t.receivedAt),
    index("pso_device_status_idx").on(t.deviceId, t.status),
  ],
);

/**
 * Offline amal sinxronida aniqlangan nomuvofiqlik — amal baribir bajarilgan (sotuv jismonan bo'lgan), rahbar ko'rib
 * chiqadi: zaxira yetmadi (qoldiq manfiy), narx yoki kurs o'zgargan, mijoz faol emas, kredit limiti, balans/keshbek
 * yetmadi (farqi qarzga), yopilgan smenaga chek, takroriy telefonli mijoz.
 */
export const posSyncConflicts = pgTable(
  "pos_sync_conflicts",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => posDevices.id, { onDelete: "cascade" }),
    opId: uuid("op_id").notNull(),
    kind: varchar("kind", { length: 40 }).notNull(),
    referenceType: varchar("reference_type", { length: 40 }),
    referenceId: uuid("reference_id"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index("psc_company_open_idx").on(t.companyId, t.resolvedAt, t.createdAt),
    index("psc_device_op_idx").on(t.deviceId, t.opId),
  ],
);

/**
 * Serverda butunlay o'chirilgan ma'lumotnoma yozuvi (kategoriya, brend, birlik konversiyasi) — qurilmalar pull'da
 * (`deletions`) lokal nusxasini olib tashlaydi. Qolgan ma'lumotnomalar o'chirilmaydi, faolsizlantiriladi.
 */
export const syncDeletions = pgTable(
  "sync_deletions",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** Pull turi: `categories`, `brands`, `unitConversions`. */
    entity: varchar("entity", { length: 32 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("sd_company_deleted_idx").on(t.companyId, t.deletedAt, t.id)],
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/**
 * Desktop kassa relizlari (NSIS o'rnatuvchi): platforma admini yuklaydi, e'lon qiladi; qurilmalar qurilma tokeni bilan
 * yuklab oladi va SHA-256 ni tekshiradi. Fayl bazada 4 MB bo'laklarda — alohida fayl ombori shart emas.
 */
export const desktopReleases = pgTable(
  "desktop_releases",
  {
    id: pk(),
    version: varchar("version", { length: 32 }).notNull(),
    fileName: varchar("file_name", { length: 200 }).notNull(),
    size: integer("size").notNull().default(0),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    notes: text("notes"),
    /** Bundan eski versiyalar uchun yangilanish majburiy. */
    minVersion: varchar("min_version", { length: 32 }),
    /** uploading (qisman) → draft (to'liq, SHA-256 tekshirilgan) → published → archived; failed — SHA-256 mos kelmadi. */
    status: varchar("status", { length: 16 }).notNull().default("draft"),
    /** Bo'lak hajmi (bayt): bo'laklab yuklashda mijoz tanlaydi, bitta oqim bilan yuklanganda — 4 MB. */
    chunkSize: integer("chunk_size").notNull().default(4 * 1024 * 1024),
    /** Bo'laklab yuklash sessiyasi: mijoz aytgan hajm va SHA-256 — yakunlashda server hisoblagani bilan solishtiriladi. */
    expectedSize: integer("expected_size"),
    expectedSha256: varchar("expected_sha256", { length: 64 }),
    /** `failed` sababi. */
    error: text("error"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("desktop_releases_version_key").on(t.version),
    check("desktop_releases_status", sql`${t.status} in ('uploading', 'draft', 'published', 'archived', 'failed')`),
  ],
);

export const desktopReleaseChunks = pgTable(
  "desktop_release_chunks",
  {
    releaseId: uuid("release_id")
      .notNull()
      .references(() => desktopReleases.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    data: bytea("data").notNull(),
  },
  (t) => [primaryKey({ columns: [t.releaseId, t.seq] })],
);
