/**
 * CRM va distribution: savdo vakillari, lidlar, faoliyatlar, segmentlar,
 * marshrutlar va tashriflar.
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { employees } from "./hr.js";
import { companies, users } from "./platform.js";
import { customers } from "./sales.js";
import { legacyId, money, percent, pk, timestamps } from "./_shared.js";

export const leadSource = pgEnum("lead_source", [
  "website",
  "referral",
  "social",
  "cold_call",
  "exhibition",
  "other",
]);

export const leadStage = pgEnum("lead_stage", [
  "new",
  "contacted",
  "qualified",
  "proposal",
  "won",
  "lost",
]);

export const activityType = pgEnum("activity_type", [
  "call",
  "meeting",
  "email",
  "note",
  "task",
]);

export const activityStatus = pgEnum("activity_status", ["planned", "done", "cancelled"]);

export const routeVisitStatus = pgEnum("route_visit_status", [
  "planned",
  "in_progress",
  "completed",
  "cancelled",
]);

// ─── sales_reps ──────────────────────────────────────────────────────────────

export const salesReps = pgTable(
  "sales_reps",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    name: varchar("name", { length: 200 }).notNull(),
    code: varchar("code", { length: 32 }).notNull(),
    phone: varchar("phone", { length: 20 }),
    email: varchar("email", { length: 255 }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** HR xodimi (agent "Sotuv agenti qo'shish" orqali yaratilganda bog'lanadi). */
    employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "set null" }),
    /** Mas'ul supervayzer (tizim foydalanuvchisi). */
    supervisorUserId: uuid("supervisor_user_id").references(() => users.id, { onDelete: "set null" }),
    region: varchar("region", { length: 100 }),

    monthlyTarget: money("monthly_target").notNull().default("0"),
    commission: percent("commission").notNull().default("0"),

    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("sr_company_code_key").on(t.companyId, t.code),
    index("sr_company_active_idx").on(t.companyId, t.isActive),
    /** Bitta foydalanuvchi — bitta savdo agenti (agent ish joyi shu bog'lanish orqali ochiladi). */
    uniqueIndex("sr_company_user_key").on(t.companyId, t.userId).where(sql`${t.userId} is not null`),
  ],
);

// ─── leads ───────────────────────────────────────────────────────────────────

export const leads = pgTable(
  "leads",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    name: varchar("name", { length: 200 }).notNull(),
    companyName: varchar("company_name", { length: 200 }),
    phone: varchar("phone", { length: 20 }),
    email: varchar("email", { length: 255 }),

    source: leadSource("source").notNull().default("other"),
    stage: leadStage("stage").notNull().default("new"),
    estimatedValue: money("estimated_value"),

    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    salesRepId: uuid("sales_rep_id").references(() => salesReps.id, { onDelete: "set null" }),

    expectedCloseDate: date("expected_close_date"),
    notes: text("notes"),
    lostReason: text("lost_reason"),
    ...timestamps(),
  },
  (t) => [
    index("leads_company_stage_idx").on(t.companyId, t.stage),
    index("leads_company_rep_idx").on(t.companyId, t.salesRepId),
    index("leads_customer_idx").on(t.customerId),
  ],
);

// ─── activities ──────────────────────────────────────────────────────────────

export const activities = pgTable(
  "activities",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    type: activityType("type").notNull().default("note"),
    title: varchar("title", { length: 300 }).notNull(),
    description: text("description"),

    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),

    activityDate: date("activity_date").notNull(),
    dueDate: date("due_date"),
    status: activityStatus("status").notNull().default("planned"),
    outcome: text("outcome"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    index("act_company_date_idx").on(t.companyId, t.activityDate),
    index("act_company_status_idx").on(t.companyId, t.status),
    index("act_customer_idx").on(t.customerId),
    index("act_lead_idx").on(t.leadId),
  ],
);

// ─── customer_segments ───────────────────────────────────────────────────────

export const customerSegments = pgTable(
  "customer_segments",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    color: varchar("color", { length: 16 }).notNull().default("#64748b"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [uniqueIndex("cs_company_name_key").on(t.companyId, t.name)],
);

export const customerSegmentMembers = pgTable(
  "customer_segment_members",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    segmentId: uuid("segment_id").notNull().references(() => customerSegments.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    createdAt: timestamps().createdAt,
  },
  (t) => [
    uniqueIndex("csm_segment_customer_key").on(t.segmentId, t.customerId),
    index("csm_company_idx").on(t.companyId),
  ],
);

// ─── distribution ────────────────────────────────────────────────────────────

export const distributionRoutes = pgTable(
  "distribution_routes",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    name: varchar("name", { length: 200 }).notNull(),
    salesRepId: uuid("sales_rep_id").references(() => salesReps.id, { onDelete: "set null" }),
    description: text("description"),
    /** Hafta kunlari: 0 = yakshanba … 6 = shanba. */
    days: integer("days").array().notNull().default([]),
    color: varchar("color", { length: 16 }),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    index("dr_company_active_idx").on(t.companyId, t.isActive),
    index("dr_company_rep_idx").on(t.companyId, t.salesRepId),
  ],
);

export const routeCustomers = pgTable(
  "route_customers",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    routeId: uuid("route_id").notNull().references(() => distributionRoutes.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),

    sortOrder: integer("sort_order").notNull().default(0),
    visitNotes: text("visit_notes"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("rc_route_customer_key").on(t.routeId, t.customerId),
    index("rc_company_idx").on(t.companyId),
  ],
);

export const routeVisits = pgTable(
  "route_visits",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    routeId: uuid("route_id").notNull().references(() => distributionRoutes.id, { onDelete: "restrict" }),
    salesRepId: uuid("sales_rep_id").references(() => salesReps.id, { onDelete: "set null" }),

    visitDate: date("visit_date").notNull(),
    status: routeVisitStatus("status").notNull().default("planned"),
    customersVisited: integer("customers_visited").notNull().default(0),
    ordersCreated: integer("orders_created").notNull().default(0),
    totalAmount: money("total_amount").notNull().default("0"),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    index("rv_company_date_idx").on(t.companyId, t.visitDate),
    index("rv_company_route_idx").on(t.companyId, t.routeId),
    index("rv_company_rep_idx").on(t.companyId, t.salesRepId),
  ],
);

/**
 * Marshrutni aniq sanaga agentga biriktirish (hudud va kun). Shu kunga biriktirish bo'lsa — hafta kuni
 * jadvalidan ustun; bir marshrut bir kunda bitta agentda.
 */
export const routeAssignments = pgTable(
  "route_assignments",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    routeId: uuid("route_id").notNull().references(() => distributionRoutes.id, { onDelete: "cascade" }),
    salesRepId: uuid("sales_rep_id").notNull().references(() => salesReps.id, { onDelete: "cascade" }),
    assignDate: date("assign_date").notNull(),
    /** Shu kungi buyurtmalarning yetkazish kuni; null — kompaniya siyosati bo'yicha. */
    deliveryDate: date("delivery_date"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("ra_route_date_key").on(t.routeId, t.assignDate),
    index("ra_company_rep_date_idx").on(t.companyId, t.salesRepId, t.assignDate),
  ],
);

// ─── relations ───────────────────────────────────────────────────────────────

export const leadsRelations = relations(leads, ({ one, many }) => ({
  customer: one(customers, { fields: [leads.customerId], references: [customers.id] }),
  salesRep: one(salesReps, { fields: [leads.salesRepId], references: [salesReps.id] }),
  activities: many(activities),
}));

export const salesRepsRelations = relations(salesReps, ({ many }) => ({
  leads: many(leads),
  routes: many(distributionRoutes),
}));

export const distributionRoutesRelations = relations(distributionRoutes, ({ one, many }) => ({
  salesRep: one(salesReps, {
    fields: [distributionRoutes.salesRepId],
    references: [salesReps.id],
  }),
  customers: many(routeCustomers),
  visits: many(routeVisits),
}));
