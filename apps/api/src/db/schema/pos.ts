/**
 * Offline kassa qurilmalari (BUM POS KASSA desktop) va ulardan kelgan sinxron amallari.
 *
 *  - Qurilma tokeni faqat SHA-256 xeshi bilan saqlanadi; qurilma bitta kompaniya va omborga bog'langan.
 *  - `code` — offline chek raqami prefiksi (K01, K02 …), kompaniyada unikal.
 *  - `pos_sync_operations` — qurilmadan kelgan har amal (`op_id`) bir marta bajariladi; natija yoki rad etish sababi
 *    saqlanadi va takroriy yuborishda o'sha javob qaytadi.
 */
import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgEnum, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
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
