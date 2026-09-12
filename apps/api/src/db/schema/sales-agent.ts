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
  customType,
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
import { customers, salesOrders } from "./sales.js";
import { products } from "./catalog.js";
import { money, percent, pk, qty, timestamps } from "./_shared.js";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const agentLocationEventType = pgEnum("agent_location_event_type", [
  "permission_denied",
  "update_failure",
  "low_accuracy",
  "stale",
  "invalid",
  "jump",
  "mock",
  "geofence_block",
  "visit_exit", // tashrif paytida do'kon hududidan chiqdi
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
    /** Nuqta faqat ish sessiyasida qabul qilinadi (eski yozuvlarda bo'sh). */
    workSessionId: uuid("work_session_id").references(() => agentWorkSessions.id, { onDelete: "set null" }),
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

// ─── Ish sessiyasi ───────────────────────────────────────────────────────────

export const workSessionStatus = pgEnum("agent_work_session_status", ["active", "ended"]);
/** agent — o'zi yakunladi; auto — uzoq ochiq qolgan sessiya yopildi; deactivated — agent faolsizlantirildi. */
export const workSessionEndReason = pgEnum("agent_work_session_end_reason", ["agent", "auto", "deactivated"]);

/**
 * Ish vaqti: lokatsiya faqat faol sessiyada qabul qilinadi va saqlanadi; sessiya yopilganda jonli joy o'chiriladi.
 * Bir agentda bir vaqtda bitta faol sessiya.
 */
export const agentWorkSessions = pgTable(
  "agent_work_sessions",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    salesRepId: uuid("sales_rep_id").notNull().references(() => salesReps.id, { onDelete: "restrict" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    status: workSessionStatus("status").notNull().default("active"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    startLatitude: numeric("start_latitude", { precision: 9, scale: 6 }).notNull(),
    startLongitude: numeric("start_longitude", { precision: 9, scale: 6 }).notNull(),
    startAccuracy: numeric("start_accuracy", { precision: 8, scale: 2 }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endLatitude: numeric("end_latitude", { precision: 9, scale: 6 }),
    endLongitude: numeric("end_longitude", { precision: 9, scale: 6 }),
    endAccuracy: numeric("end_accuracy", { precision: 8, scale: 2 }),
    endReason: workSessionEndReason("end_reason"),
    ...timestamps(),
  },
  (t) => [
    index("aws_company_rep_started_idx").on(t.companyId, t.salesRepId, t.startedAt),
    uniqueIndex("aws_rep_active_key").on(t.salesRepId).where(sql`${t.status} = 'active'`),
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
  "not_needed", //   mahsulot kerak emas
  "store_closed", // do'kon yopiq (polka rasmi va minimal vaqt talab qilinmaydi)
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

    /** Taymer vitrina rasmidan boshlanadi — minimal vaqt shundan hisoblanadi. */
    timerStartedAt: timestamp("timer_started_at", { withTimezone: true }),
    /** "pause" siyosatida hududdan tashqarida o'tgan (hisoblanmaydigan) vaqt, soniya. */
    pausedSeconds: integer("paused_seconds").notNull().default(0),
    /** Hozir hududdan tashqarida bo'lsa — chiqqan vaqt (lokatsiya nuqtalaridan). */
    outsideSince: timestamp("outside_since", { withTimezone: true }),
    outsideCount: integer("outside_count").notNull().default(0),
    /** "invalidate" siyosatida hududdan chiqqan vaqt — tashrif buyurtmaga yaroqsiz. */
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),

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
    /** Fayl saqlash (S3) sozlanmaganda rasm bazada (`storage_key` — `db/<uuid>`); ko'rish — autentifikatsiyali endpoint. */
    content: bytea("content"),
    contentType: varchar("content_type", { length: 50 }),
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    accuracy: numeric("accuracy", { precision: 8, scale: 2 }),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("avp_company_visit_idx").on(t.companyId, t.visitId), uniqueIndex("avp_storage_key_key").on(t.storageKey)],
);

// ─── Agent buyurtmalari ──────────────────────────────────────────────────────

export const orderPaymentType = pgEnum("order_payment_type", ["cash", "card", "credit"]);
/** Kredit limitidan oshgan buyurtma (siyosat "approval") — supervayzer qarori. */
export const agentOrderApproval = pgEnum("agent_order_approval", ["pending", "approved", "rejected"]);

/** Agent kiritgan qator: dona va blok alohida (sotuv qatorida — asosiy birlikdagi jami). */
export type AgentOrderLine = {
  productId: string;
  pieces: string;
  boxes: string;
  boxUnitId: string | null;
  boxFactor: string | null;
};

/**
 * Sotuv buyurtmasining agent qismi (1:1 `sales_orders`): kim, qaysi tashrifda, to'lov turi va muddati,
 * mijoz so'rov identifikatori (qayta urinishda takror buyurtma yaratilmaydi), yuborilgan joy va masofa, tasdiq.
 */
export const agentOrders = pgTable(
  "agent_orders",
  {
    orderId: uuid("order_id")
      .primaryKey()
      .references(() => salesOrders.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    salesRepId: uuid("sales_rep_id").notNull().references(() => salesReps.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    visitId: uuid("visit_id").references(() => agentVisits.id, { onDelete: "set null" }),
    clientRequestId: uuid("client_request_id").notNull(),
    paymentType: orderPaymentType("payment_type").notNull().default("cash"),
    paymentDueDate: date("payment_due_date"),
    lines: jsonb("lines").$type<AgentOrderLine[]>().notNull().default([]),

    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    submitLatitude: numeric("submit_latitude", { precision: 9, scale: 6 }),
    submitLongitude: numeric("submit_longitude", { precision: 9, scale: 6 }),
    submitAccuracy: numeric("submit_accuracy", { precision: 8, scale: 2 }),
    submitDistanceMeters: integer("submit_distance_meters"),

    approvalStatus: agentOrderApproval("approval_status"),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("ao_rep_request_key").on(t.salesRepId, t.clientRequestId),
    index("ao_company_rep_idx").on(t.companyId, t.salesRepId, t.updatedAt),
    index("ao_company_approval_idx").on(t.companyId, t.approvalStatus),
    index("ao_visit_idx").on(t.visitId),
  ],
);

// ─── Yangi mijozlar (prospekt) ───────────────────────────────────────────────

export const prospectStatus = pgEnum("prospect_status", ["new", "converted", "rejected"]);

/** Agent topgan potentsial do'kon: supervayzer mijozga aylantiradi yoki sabab bilan rad etadi. */
export const agentProspects = pgTable(
  "agent_prospects",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    salesRepId: uuid("sales_rep_id").notNull().references(() => salesReps.id, { onDelete: "restrict" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    name: varchar("name", { length: 200 }).notNull(),
    phone: varchar("phone", { length: 20 }),
    address: text("address"),
    comment: text("comment"),
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    accuracy: numeric("accuracy", { precision: 8, scale: 2 }),
    status: prospectStatus("status").notNull().default("new"),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    ...timestamps(),
  },
  (t) => [
    index("apr_company_status_idx").on(t.companyId, t.status, t.createdAt),
    index("apr_company_rep_idx").on(t.companyId, t.salesRepId, t.createdAt),
  ],
);

// ─── Aksiyalar ───────────────────────────────────────────────────────────────

/** buy_x_get_y — har `minQuantity` uchun `freeQuantity` bepul; percent_discount — `minQuantity` dan foiz chegirma. */
export const promotionType = pgEnum("promotion_type", ["buy_x_get_y", "percent_discount"]);

export const promotions = pgTable(
  "promotions",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    type: promotionType("type").notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Asosiy birlikda. */
    minQuantity: qty("min_quantity").notNull(),
    freeQuantity: qty("free_quantity"),
    discountPercent: percent("discount_percent"),
    startsAt: date("starts_at").notNull(),
    endsAt: date("ends_at").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    index("promo_company_period_idx").on(t.companyId, t.isActive, t.startsAt, t.endsAt),
    index("promo_company_product_idx").on(t.companyId, t.productId),
    check("promo_dates_check", sql`${t.endsAt} >= ${t.startsAt}`),
    check(
      "promo_rule_check",
      sql`${t.minQuantity} > 0 and ((${t.type} = 'buy_x_get_y' and ${t.freeQuantity} > 0) or (${t.type} = 'percent_discount' and ${t.discountPercent} > 0 and ${t.discountPercent} <= 100))`,
    ),
  ],
);

/** Buyurtmada qo'llangan qoida nusxasi — aksiya keyin o'zgarsa ham tarix saqlanadi. */
export type PromotionRule = {
  name: string;
  type: "buy_x_get_y" | "percent_discount";
  minQuantity: string;
  freeQuantity: string | null;
  discountPercent: string | null;
};

export const orderPromotions = pgTable(
  "order_promotions",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => salesOrders.id, { onDelete: "cascade" }),
    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "restrict" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    rule: jsonb("rule").$type<PromotionRule>().notNull(),
    paidQuantity: qty("paid_quantity").notNull(),
    freeQuantity: qty("free_quantity").notNull().default("0"),
    /** Bepul tovar qiymati yoki foiz chegirma summasi (prays-list narxida). */
    discountAmount: money("discount_amount").notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("op_order_idx").on(t.orderId), index("op_company_promotion_idx").on(t.companyId, t.promotionId)],
);
