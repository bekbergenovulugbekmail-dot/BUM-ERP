/**
 * Sotuv agenti: lokatsiya nuqtalari, har agentning oxirgi joyi, lokatsiya hodisalari
 * (sifat rad etishlari, ruxsat berilmagani, shubhali sakrash, soxta GPS, geofence), do'konga tashriflar va tashrif rasmlari.
 *
 * Lokatsiya — maxfiy operatsion ma'lumot: faqat tenant ichida va ruxsat bilan ko'rinadi, tarix kompaniya
 * siyosatidagi muddatdan keyin o'chiriladi (`agent_location_latest` — faqat oxirgi nuqta, doim bitta qator).
 */
import { sql } from "drizzle-orm";
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
import { distributionRoutes, salesReps } from "./crm.js";
import { companies, users } from "./platform.js";
import { customers } from "./sales.js";
import { pk, timestamps } from "./_shared.js";

export const agentLocationEventType = pgEnum("agent_location_event_type", [
  "permission_denied",
  "update_failure",
  "low_accuracy",
  "stale",
  "invalid",
  "jump",
  "mock",
  "geofence_block",
]);

export const agentLocations = pgTable(
  "agent_locations",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    salesRepId: uuid("sales_rep_id").notNull().references(() => salesReps.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    latitude: numeric("latitude", { precision: 9, scale: 6 }).notNull(),
    longitude: numeric("longitude", { precision: 9, scale: 6 }).notNull(),
    /** GPS aniqlik radiusi, metr. */
    accuracy: numeric("accuracy", { precision: 8, scale: 2 }),
    /** Qurilmadagi o'lchov vaqti (serverda eskirganlik tekshirilgan). */
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    /** Imkonsiz sakrash yoki soxta GPS belgisi — nuqta saqlanadi, lekin ishonchsiz. */
    suspicious: boolean("suspicious").notNull().default(false),
  },
  (t) => [
    index("al_company_rep_recorded_idx").on(t.companyId, t.salesRepId, t.recordedAt),
    index("al_company_recorded_idx").on(t.companyId, t.recordedAt),
  ],
);

export const agentLocationLatest = pgTable(
  "agent_location_latest",
  {
    salesRepId: uuid("sales_rep_id")
      .primaryKey()
      .references(() => salesReps.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    latitude: numeric("latitude", { precision: 9, scale: 6 }).notNull(),
    longitude: numeric("longitude", { precision: 9, scale: 6 }).notNull(),
    accuracy: numeric("accuracy", { precision: 8, scale: 2 }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    suspicious: boolean("suspicious").notNull().default(false),
  },
  (t) => [index("all_company_idx").on(t.companyId)],
);

export const agentLocationEvents = pgTable(
  "agent_location_events",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    salesRepId: uuid("sales_rep_id").notNull().references(() => salesReps.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    type: agentLocationEventType("type").notNull(),
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    accuracy: numeric("accuracy", { precision: 8, scale: 2 }),
    /** Qo'shimcha ma'lumot (masofa, radius, sabab) — parol/token hech qachon yozilmaydi. */
    details: jsonb("details").$type<Record<string, unknown>>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ale_company_occurred_idx").on(t.companyId, t.occurredAt),
    index("ale_company_rep_occurred_idx").on(t.companyId, t.salesRepId, t.occurredAt),
  ],
);

// ─── Tashriflar ──────────────────────────────────────────────────────────────

export const agentVisitStatus = pgEnum("agent_visit_status", ["in_progress", "completed"]);
export const agentVisitResult = pgEnum("agent_visit_result", ["ordered", "no_order"]);
export const visitNoOrderReason = pgEnum("visit_no_order_reason", [
  "no_money", //     pul yo'q
  "has_stock", //    mahsulot hali bor
  "has_debt", //     qarzdorligi mavjud
  "owner_absent", // egasi yo'q
  "competitor", //   raqobatchidan olgan
  "price", //        narx mos emas
  "other", //        boshqa (izoh majburiy)
]);
export const visitPhotoKind = pgEnum("visit_photo_kind", ["storefront", "shelf", "placement", "promotion"]);

/**
 * Do'konga tashrif: boshlanish/yakunlanish vaqti va joyi (server tekshirgan), do'kongacha masofa, davomiylik,
 * natija va buyurtmasiz sabab. Bir agentda bir vaqtda bitta ochiq tashrif.
 */
export const agentVisits = pgTable(
  "agent_visits",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    salesRepId: uuid("sales_rep_id").notNull().references(() => salesReps.id, { onDelete: "restrict" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    routeId: uuid("route_id").references(() => distributionRoutes.id, { onDelete: "set null" }),
    /** Server sanasi (mahalliy kun). */
    visitDate: date("visit_date").notNull(),
    status: agentVisitStatus("status").notNull().default("in_progress"),
    result: agentVisitResult("result"),

    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    startLatitude: numeric("start_latitude", { precision: 9, scale: 6 }).notNull(),
    startLongitude: numeric("start_longitude", { precision: 9, scale: 6 }).notNull(),
    startAccuracy: numeric("start_accuracy", { precision: 8, scale: 2 }).notNull(),
    /** Do'kon koordinatasi bo'lmasa null. */
    startDistanceMeters: integer("start_distance_meters"),

    completedAt: timestamp("completed_at", { withTimezone: true }),
    endLatitude: numeric("end_latitude", { precision: 9, scale: 6 }),
    endLongitude: numeric("end_longitude", { precision: 9, scale: 6 }),
    endAccuracy: numeric("end_accuracy", { precision: 8, scale: 2 }),
    endDistanceMeters: integer("end_distance_meters"),
    durationSeconds: integer("duration_seconds"),

    noOrderReason: visitNoOrderReason("no_order_reason"),
    noOrderComment: text("no_order_comment"),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    index("av_company_date_idx").on(t.companyId, t.visitDate),
    index("av_company_rep_date_idx").on(t.companyId, t.salesRepId, t.visitDate),
    index("av_company_customer_idx").on(t.companyId, t.customerId, t.startedAt),
    uniqueIndex("av_rep_open_key").on(t.salesRepId).where(sql`${t.status} = 'in_progress'`),
    check(
      "agent_visits_completion_check",
      sql`${t.status} = 'in_progress' or (${t.completedAt} is not null and ${t.result} is not null and ${t.durationSeconds} is not null)`,
    ),
  ],
);

/** Tashrif rasmi: saqlashdagi kalit (ochiq URL yo'q — ko'rish imzolangan qisqa muddatli havola), vaqt va joy. */
export const agentVisitPhotos = pgTable(
  "agent_visit_photos",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    visitId: uuid("visit_id")
      .notNull()
      .references(() => agentVisits.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    kind: visitPhotoKind("kind").notNull(),
    storageKey: varchar("storage_key", { length: 300 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    accuracy: numeric("accuracy", { precision: 8, scale: 2 }),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("avp_company_visit_idx").on(t.companyId, t.visitId), uniqueIndex("avp_storage_key_key").on(t.storageKey)],
);
