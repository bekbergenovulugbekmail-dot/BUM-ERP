/**
 * Dostavka: yetkazuvchi agentlar, yetkazma vazifalari (buyurtmadan alohida — ORDER ≠ DELIVERY), yetkaziladigan
 * qatorlar, hodisalar tarixi, isbotlar (rasm, imzo), yig'ilgan to'lovlar, ish sessiyasi va lokatsiya.
 *
 * Enum qiymatlari `@bum/shared` `delivery.ts` bilan bir xil (test tekshiradi). Barcha jadvallarda `company_id` —
 * tenant chegarasi. Zaxira, qarz va jurnal mavjud savdo oqimida (jo'natish, qaytarish, mijoz to'lovi) yoziladi —
 * bu jadvallar ularning nusxasi emas, faqat yetkazish jarayoni va havolalar.
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
  time,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { money, pk, qty, timestamps } from "./_shared.js";
import { products } from "./catalog.js";
import { employees } from "./hr.js";
import { warehouses } from "./inventory.js";
import { branches, companies, users } from "./platform.js";
import { customerPayments, customers, salesOrderItems, salesOrders } from "./sales.js";
import { workSessionEndReason, workSessionStatus } from "./sales-agent.js";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const deliveryTaskStatus = pgEnum("delivery_task_status", [
  "ready",
  "assigned",
  "accepted",
  "out_for_delivery",
  "arrived",
  "delivering",
  "delivered",
  "partially_delivered",
  "failed",
  "returned",
  "cancelled",
]);
export const deliveryPriority = pgEnum("delivery_priority", ["low", "normal", "high", "urgent"]);
export const deliveryVehicleType = pgEnum("delivery_vehicle_type", ["foot", "bicycle", "motorcycle", "car", "van", "truck"]);
export const deliveryFailureReason = pgEnum("delivery_failure_reason", [
  "customer_absent",
  "address_not_found",
  "no_answer",
  "goods_not_ready",
  "payment_issue",
  "customer_refused",
  "vehicle_issue",
  "other",
]);
export const deliveryPaymentType = pgEnum("delivery_payment_type", ["cash", "card", "bank", "credit"]);
export const deliveryPaymentStatus = pgEnum("delivery_payment_status", ["not_required", "pending", "paid", "partial", "mismatch"]);
export const deliveryPaymentReview = pgEnum("delivery_payment_review", ["none", "pending", "approved", "rejected"]);
export const deliveryCollectionMethod = pgEnum("delivery_collection_method", ["cash", "card", "bank"]);
export const deliveryProofKind = pgEnum("delivery_proof_kind", ["photo", "signature"]);

/** Yakunlanmagan holatlar — bitta buyurtmada bittadan ortiq ochiq yetkazma bo'lmaydi. */
const OPEN_STATUSES_SQL = sql.raw(`'ready', 'assigned', 'accepted', 'out_for_delivery', 'arrived', 'delivering'`);

export type DeliveryWorkingSchedule = { days: number[]; start: string; end: string };

/**
 * Yetkazuvchi agent profili — xodim (HR) va tizim foydalanuvchisiga bog'langan. Ism va telefon foydalanuvchida
 * (takrorlanmaydi); bu yerda faqat dostavkaga xos ma'lumot.
 */
export const deliveryAgents = pgTable(
  "delivery_agents",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "set null" }),
    code: varchar("code", { length: 20 }).notNull(),
    supervisorUserId: uuid("supervisor_user_id").references(() => users.id, { onDelete: "set null" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    territory: varchar("territory", { length: 100 }),
    deliveryZone: varchar("delivery_zone", { length: 200 }),
    vehicleType: deliveryVehicleType("vehicle_type"),
    vehicleNumber: varchar("vehicle_number", { length: 20 }),
    maxLoadKg: numeric("max_load_kg", { precision: 10, scale: 2 }),
    workingSchedule: jsonb("working_schedule").$type<DeliveryWorkingSchedule>(),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("da_company_user_key").on(t.companyId, t.userId),
    uniqueIndex("da_company_code_key").on(t.companyId, t.code),
    index("da_company_active_idx").on(t.companyId, t.isActive),
    check("da_max_load_positive", sql`${t.maxLoadKg} is null or ${t.maxLoadKg} > 0`),
  ],
);

/**
 * Yetkazma vazifasi. Holat o'tishlari serverda; vaqt belgilari har bosqichda yoziladi. `expected_amount` —
 * yetkazishda yig'ilishi kerak bo'lgan summa (nasiya — 0), `collected_amount` — yig'ilgani (`delivery_payments`).
 * OTP faqat HMAC hash ko'rinishida saqlanadi.
 */
export const deliveryTasks = pgTable(
  "delivery_tasks",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    number: varchar("number", { length: 32 }).notNull(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => salesOrders.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    deliveryAgentId: uuid("delivery_agent_id").references(() => deliveryAgents.id, { onDelete: "restrict" }),

    status: deliveryTaskStatus("status").notNull().default("ready"),
    priority: deliveryPriority("priority").notNull().default("normal"),
    scheduledDate: date("scheduled_date").notNull(),
    windowStart: time("window_start"),
    windowEnd: time("window_end"),
    /** Agentning shu kundagi yetkazish tartibi (1 dan). */
    routeOrder: integer("route_order"),

    paymentType: deliveryPaymentType("payment_type").notNull().default("cash"),
    expectedAmount: money("expected_amount").notNull().default("0"),
    collectedAmount: money("collected_amount").notNull().default("0"),
    paymentStatus: deliveryPaymentStatus("payment_status").notNull().default("pending"),
    paymentReview: deliveryPaymentReview("payment_review").notNull().default("none"),
    paymentReviewedBy: uuid("payment_reviewed_by").references(() => users.id, { onDelete: "set null" }),
    paymentReviewedAt: timestamp("payment_reviewed_at", { withTimezone: true }),
    paymentReviewNote: text("payment_review_note"),

    /** Mijoz izohi (buyurtmadan) — agentga ko'rinadi. */
    customerNote: text("customer_note"),
    /** Yetkazish bo'yicha ko'rsatma — agentga ko'rinadi. */
    deliveryNote: text("delivery_note"),
    /** Ichki izoh — agentga ko'rinmaydi. */
    supervisorNote: text("supervisor_note"),

    assignedBy: uuid("assigned_by").references(() => users.id, { onDelete: "set null" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }),
    deliveringAt: timestamp("delivering_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    failureReason: deliveryFailureReason("failure_reason"),
    failureComment: text("failure_comment"),
    cancelReason: text("cancel_reason"),

    arrivalLatitude: numeric("arrival_latitude", { precision: 9, scale: 6 }),
    arrivalLongitude: numeric("arrival_longitude", { precision: 9, scale: 6 }),
    arrivalAccuracy: numeric("arrival_accuracy", { precision: 8, scale: 2 }),
    arrivalDistanceMeters: integer("arrival_distance_meters"),
    confirmLatitude: numeric("confirm_latitude", { precision: 9, scale: 6 }),
    confirmLongitude: numeric("confirm_longitude", { precision: 9, scale: 6 }),
    confirmAccuracy: numeric("confirm_accuracy", { precision: 8, scale: 2 }),
    confirmDistanceMeters: integer("confirm_distance_meters"),

    otpHash: varchar("otp_hash", { length: 64 }),
    otpExpiresAt: timestamp("otp_expires_at", { withTimezone: true }),
    otpAttempts: integer("otp_attempts").notNull().default(0),
    otpVerifiedAt: timestamp("otp_verified_at", { withTimezone: true }),
    signerName: varchar("signer_name", { length: 200 }),

    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("dt_company_number_key").on(t.companyId, t.number),
    uniqueIndex("dt_order_open_key").on(t.orderId).where(sql`${t.status} in (${OPEN_STATUSES_SQL})`),
    index("dt_company_status_date_idx").on(t.companyId, t.status, t.scheduledDate),
    index("dt_company_agent_date_idx").on(t.companyId, t.deliveryAgentId, t.scheduledDate),
    index("dt_company_date_idx").on(t.companyId, t.scheduledDate),
    index("dt_company_order_idx").on(t.companyId, t.orderId),
    index("dt_company_customer_idx").on(t.companyId, t.customerId),
    index("dt_company_review_idx").on(t.companyId, t.paymentReview).where(sql`${t.paymentReview} = 'pending'`),
    check("dt_window_pair", sql`(${t.windowStart} is null) = (${t.windowEnd} is null) and (${t.windowStart} is null or ${t.windowStart} < ${t.windowEnd})`),
    check("dt_amounts_non_negative", sql`${t.expectedAmount} >= 0 and ${t.collectedAmount} >= 0`),
    check("dt_route_order_positive", sql`${t.routeOrder} is null or ${t.routeOrder} >= 1`),
    check("dt_otp_attempts_non_negative", sql`${t.otpAttempts} >= 0`),
  ],
);

/** Yetkaziladigan qatorlar (buyurtma qatoridan, qaytarilganidan tashqari); yetkazilgan va omborga qaytgan miqdor. */
export const deliveryTaskItems = pgTable(
  "delivery_task_items",
  {
    id: pk(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => deliveryTasks.id, { onDelete: "cascade" }),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => salesOrderItems.id, { onDelete: "restrict" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    /** Buyurtma birligida. */
    quantity: qty("quantity").notNull(),
    deliveredQty: qty("delivered_qty"),
    returnedQty: qty("returned_qty").notNull().default("0"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("dti_task_order_item_key").on(t.taskId, t.orderItemId),
    check("dti_quantity_positive", sql`${t.quantity} > 0`),
    check("dti_delivered_range", sql`${t.deliveredQty} is null or (${t.deliveredQty} >= 0 and ${t.deliveredQty} <= ${t.quantity})`),
    check("dti_returned_range", sql`${t.returnedQty} >= 0 and ${t.returnedQty} + coalesce(${t.deliveredQty}, 0) <= ${t.quantity}`),
  ],
);

/**
 * Yetkazma tarixi: har holat o'zgarishi va muhim amal (to'lov, isbot, geofence rad etilishi, OTP xatosi).
 * `client_request_id` — agent amali idempotentligi (takroriy bosish yoki oflayn navbat qayta yuborilishi).
 */
export const deliveryEvents = pgTable(
  "delivery_events",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => deliveryTasks.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 40 }).notNull(),
    fromStatus: deliveryTaskStatus("from_status"),
    toStatus: deliveryTaskStatus("to_status"),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    /** Amal qurilmada bajarilgan vaqt (oflayn navbatda — keyinroq keladi); server tekshirgan. */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    accuracy: numeric("accuracy", { precision: 8, scale: 2 }),
    distanceMeters: integer("distance_meters"),
    note: text("note"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    clientRequestId: uuid("client_request_id"),
    offline: boolean("offline").notNull().default(false),
  },
  (t) => [
    uniqueIndex("de_task_request_key").on(t.taskId, t.clientRequestId).where(sql`${t.clientRequestId} is not null`),
    index("de_task_occurred_idx").on(t.taskId, t.occurredAt),
    index("de_company_occurred_idx").on(t.companyId, t.occurredAt),
  ],
);

/** Topshirish isboti: kamera rasmi yoki mijoz imzosi (bazada, turi baytlardan tekshirilgan). */
export const deliveryProofs = pgTable(
  "delivery_proofs",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => deliveryTasks.id, { onDelete: "cascade" }),
    kind: deliveryProofKind("kind").notNull(),
    content: bytea("content").notNull(),
    contentType: varchar("content_type", { length: 50 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    signerName: varchar("signer_name", { length: 200 }),
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    accuracy: numeric("accuracy", { precision: 8, scale: 2 }),
    distanceMeters: integer("distance_meters"),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    clientRequestId: uuid("client_request_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("dp_task_request_key").on(t.taskId, t.clientRequestId), index("dp_task_idx").on(t.taskId)],
);

/**
 * Yetkazishda yig'ilgan pul — har biri mavjud mijoz to'lovi (`customer_payments`: kassa/bank kirimi, jurnal, qarz)
 * bilan bog'langan; bu jadval faqat yetkazma bilan havola va idempotentlik (`client_request_id`).
 */
export const deliveryPayments = pgTable(
  "delivery_payments",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => deliveryTasks.id, { onDelete: "cascade" }),
    customerPaymentId: uuid("customer_payment_id")
      .notNull()
      .references(() => customerPayments.id, { onDelete: "restrict" }),
    method: deliveryCollectionMethod("method").notNull(),
    amount: money("amount").notNull(),
    collectedBy: uuid("collected_by").references(() => users.id, { onDelete: "set null" }),
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(),
    clientRequestId: uuid("client_request_id").notNull(),
    offline: boolean("offline").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("dpay_company_request_key").on(t.companyId, t.clientRequestId),
    index("dpay_task_idx").on(t.taskId),
    index("dpay_company_collected_idx").on(t.companyId, t.collectedAt),
    check("dpay_amount_positive", sql`${t.amount} > 0`),
  ],
);

/** Yetkazuvchining ish vaqti: lokatsiya faqat faol sessiyada qabul qilinadi; bir agentda bitta faol sessiya. */
export const deliveryWorkSessions = pgTable(
  "delivery_work_sessions",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    deliveryAgentId: uuid("delivery_agent_id")
      .notNull()
      .references(() => deliveryAgents.id, { onDelete: "restrict" }),
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
    index("dws_company_agent_started_idx").on(t.companyId, t.deliveryAgentId, t.startedAt),
    uniqueIndex("dws_agent_active_key").on(t.deliveryAgentId).where(sql`${t.status} = 'active'`),
  ],
);

/** Lokatsiya nuqtalari (auditga yozilmaydi — iz shu yerda, saqlash muddati siyosat bo'yicha). */
export const deliveryLocations = pgTable(
  "delivery_locations",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    deliveryAgentId: uuid("delivery_agent_id")
      .notNull()
      .references(() => deliveryAgents.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    workSessionId: uuid("work_session_id").references(() => deliveryWorkSessions.id, { onDelete: "set null" }),
    latitude: numeric("latitude", { precision: 9, scale: 6 }).notNull(),
    longitude: numeric("longitude", { precision: 9, scale: 6 }).notNull(),
    accuracy: numeric("accuracy", { precision: 8, scale: 2 }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    suspicious: boolean("suspicious").notNull().default(false),
  },
  (t) => [
    index("dl_company_agent_recorded_idx").on(t.companyId, t.deliveryAgentId, t.recordedAt),
    index("dl_company_recorded_idx").on(t.companyId, t.recordedAt),
  ],
);

/** Har agentning oxirgi joyi (bitta qator; ish sessiyasi tugaganda o'chiriladi). */
export const deliveryLocationLatest = pgTable(
  "delivery_location_latest",
  {
    deliveryAgentId: uuid("delivery_agent_id")
      .primaryKey()
      .references(() => deliveryAgents.id, { onDelete: "cascade" }),
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
  (t) => [index("dll_company_idx").on(t.companyId)],
);
