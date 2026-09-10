/**
 * Sxema bo'ylab takrorlanadigan ustunlar va tiplar.
 *
 * Convexdan farqli qaror: pul va miqdor `numeric` bo'ladi, `float` emas.
 * Convexda hammasi JS number (float64) edi — bu buxgalteriyada yaxlitlash
 * xatosi manbai. PostgreSQL `numeric` aniq o'nlik arifmetika beradi.
 */
import { sql } from "drizzle-orm";
import {
  numeric,
  pgEnum,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/** Miqdor: 4 kasr xona (kg, litr, dona ulushlari uchun). */
export const qty = (name: string) => numeric(name, { precision: 18, scale: 4 });

/** Pul: 2 kasr xona. */
export const money = (name: string) => numeric(name, { precision: 18, scale: 2 });

/** Narx: 4 kasr xona — birlik narxi yaxlitlanmasligi uchun. */
export const price = (name: string) => numeric(name, { precision: 18, scale: 4 });

/** Foiz: 5,2 — 0.00 dan 999.99 gacha. */
export const percent = (name: string) => numeric(name, { precision: 5, scale: 2 });

export const pk = () => uuid("id").primaryKey().defaultRandom();

/**
 * Convex hujjat ID'si. Ma'lumot ko'chirishda havolalarni tiklash uchun
 * kerak; migratsiya tugab, tekshiruvlar o'tgach ustun o'chiriladi.
 */
export const legacyId = () => varchar("legacy_id", { length: 64 });

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`);

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`);

export const timestamps = () => ({
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ─── Umumiy enum'lar ─────────────────────────────────────────────────────────
// Convexda bular v.union(v.literal(...)) edi — ro'yxat allaqachon yopiq.

export const companyStatus = pgEnum("company_status", [
  "active",
  "trial",
  "pending",
  "suspended",
  "cancelled",
]);

export const auditSeverity = pgEnum("audit_severity", ["info", "warning", "error"]);

export const passwordAlgo = pgEnum("password_algo", ["argon2id", "scrypt"]);

/**
 * Zaxira baholash usuli.
 *
 * DIQQAT: hozirgi tizimda AMALDA faqat `average` (AVCO) yozilgan —
 * `fifo`/`fefo` uchun batch tanlash mantiqi hech qachon yozilmagan
 * (audit, Blocker 1). Migratsiya mavjud xatti-harakatni aynan saqlaydi:
 * enum saqlanadi, lekin hisoblash AVCO bo'yicha ketadi va boshqa qiymat
 * tanlansa servis qatlami buni aniq xato bilan rad etadi.
 */
export const costingMethod = pgEnum("costing_method", [
  "average",
  "fifo",
  "fefo",
  "manual",
]);
