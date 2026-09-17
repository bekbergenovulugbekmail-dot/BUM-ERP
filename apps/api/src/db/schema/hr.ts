/**
 * HR: bo'limlar, lavozimlar, xodimlar, davomat, ta'til, maosh.
 *
 * Vazifalar ajratimi (audit §7): maoshni TAYYORLASH (`hr.salary`) va
 * TASDIQLASH (`hr.approve`) alohida ruxsatlar. HR menejeri birinchisiga
 * ega, ikkinchisiga emas.
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  time,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { companies, users } from "./platform.js";
import { createdAt, legacyId, money, percent, pk, qty, timestamps } from "./_shared.js";

export const employeeStatus = pgEnum("employee_status", [
  "active",
  "on_leave",
  "terminated",
]);

export const salaryType = pgEnum("salary_type", ["monthly", "hourly", "daily"]);
export const genderType = pgEnum("gender_type", ["male", "female"]);

export const attendanceStatus = pgEnum("attendance_status", [
  "present",
  "absent",
  "late",
  "half_day",
  "holiday",
  "on_leave",
]);

export const leaveType = pgEnum("leave_type", [
  "annual",
  "sick",
  "unpaid",
  "maternity",
  "other",
]);

export const leaveStatus = pgEnum("leave_status", ["pending", "approved", "rejected"]);
export const salaryPaymentStatus = pgEnum("salary_payment_status", [
  "draft",
  "approved",
  "paid",
]);

// ─── departments ─────────────────────────────────────────────────────────────

export const departments = pgTable(
  "departments",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    name: varchar("name", { length: 200 }).notNull(),
    code: varchar("code", { length: 32 }).notNull(),
    parentId: uuid("parent_id"),
    /** Bo'lim boshlig'i — employees ga havola, quyida e'lon qilingan. */
    managerId: uuid("manager_id"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("dept_company_code_key").on(t.companyId, t.code),
    index("dept_company_parent_idx").on(t.companyId, t.parentId),
  ],
);

// ─── positions ───────────────────────────────────────────────────────────────

export const positions = pgTable(
  "positions",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").notNull().references(() => departments.id, { onDelete: "cascade" }),

    name: varchar("name", { length: 200 }).notNull(),
    level: varchar("level", { length: 64 }),
    minSalary: money("min_salary"),
    maxSalary: money("max_salary"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    index("pos_company_dept_idx").on(t.companyId, t.departmentId),
    check(
      "pos_salary_range",
      sql`${t.minSalary} IS NULL OR ${t.maxSalary} IS NULL OR ${t.minSalary} <= ${t.maxSalary}`,
    ),
  ],
);

// ─── employees ───────────────────────────────────────────────────────────────

export const employees = pgTable(
  "employees",
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

    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    positionId: uuid("position_id").references(() => positions.id, { onDelete: "set null" }),
    managerId: uuid("manager_id"),
    /** Xodim tizimga kiradigan bo'lsa — users bilan bog'lanadi. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),

    hireDate: date("hire_date").notNull(),
    birthDate: date("birth_date"),
    gender: genderType("gender"),
    address: text("address"),
    /** Shaxsiy hujjat ma'lumotlari — maxfiy, faqat hr.manage bilan ko'rinadi. */
    passportNumber: varchar("passport_number", { length: 32 }),
    inn: varchar("inn", { length: 32 }),
    bankAccount: varchar("bank_account", { length: 64 }),

    baseSalary: money("base_salary").notNull().default("0"),
    salaryType: salaryType("salary_type").notNull().default("monthly"),
    status: employeeStatus("status").notNull().default("active"),

    photoKey: text("photo_key"),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("emp_company_code_key").on(t.companyId, t.code),
    index("emp_company_status_idx").on(t.companyId, t.status),
    index("emp_company_dept_idx").on(t.companyId, t.departmentId),
    check("emp_salary_non_negative", sql`${t.baseSalary} >= 0`),
  ],
);

// ─── attendances ─────────────────────────────────────────────────────────────

export const attendances = pgTable(
  "attendances",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),

    attendanceDate: date("attendance_date").notNull(),
    checkIn: time("check_in"),
    checkOut: time("check_out"),
    workHours: qty("work_hours").notNull().default("0"),
    overtime: qty("overtime").notNull().default("0"),
    status: attendanceStatus("status").notNull().default("present"),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("att_employee_date_key").on(t.employeeId, t.attendanceDate),
    index("att_company_date_idx").on(t.companyId, t.attendanceDate),
    check("att_hours_non_negative", sql`${t.workHours} >= 0 AND ${t.overtime} >= 0`),
  ],
);

// ─── leaves ──────────────────────────────────────────────────────────────────

export const leaves = pgTable(
  "leaves",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),

    type: leaveType("type").notNull().default("annual"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    days: qty("days").notNull(),
    status: leaveStatus("status").notNull().default("pending"),
    reason: text("reason"),
    approvedBy: uuid("approved_by").references(() => employees.id, { onDelete: "set null" }),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    index("lv_company_status_idx").on(t.companyId, t.status),
    index("lv_company_employee_idx").on(t.companyId, t.employeeId),
    index("lv_company_start_idx").on(t.companyId, t.startDate),
    check("lv_date_order", sql`${t.startDate} <= ${t.endDate}`),
    check("lv_days_positive", sql`${t.days} > 0`),
  ],
);

// ─── salary_payments ─────────────────────────────────────────────────────────

export const salaryPayments = pgTable(
  "salary_payments",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id").notNull().references(() => employees.id, { onDelete: "restrict" }),

    /** "2026-09" ko'rinishida. */
    month: varchar("month", { length: 7 }).notNull(),

    baseSalary: money("base_salary").notNull().default("0"),
    workDays: qty("work_days").notNull().default("0"),
    actualDays: qty("actual_days").notNull().default("0"),
    overtime: qty("overtime").notNull().default("0"),
    overtimePay: money("overtime_pay").notNull().default("0"),
    bonus: money("bonus").notNull().default("0"),
    deductions: money("deductions").notNull().default("0"),
    /** Hisoblangan (ishlangan + ortiqcha ish + mukofot) — soliq shundan. */
    grossSalary: money("gross_salary").notNull().default("0"),
    /** Tayyorlashda tanlangan stavka — tahrirda qayta hisoblash uchun (Convex 12% ni qattiq yozgan edi). */
    taxRate: percent("tax_rate").notNull().default("12"),
    tax: money("tax").notNull().default("0"),
    netSalary: money("net_salary").notNull().default("0"),

    status: salaryPaymentStatus("status").notNull().default("draft"),
    paidDate: date("paid_date"),
    /** Kim tasdiqladi — tayyorlaganidan farq qilishi kerak. */
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("sal_employee_month_key").on(t.employeeId, t.month),
    index("sal_company_month_idx").on(t.companyId, t.month),
    index("sal_company_status_idx").on(t.companyId, t.status),
    check("sal_amounts_non_negative", sql`${t.netSalary} >= 0 AND ${t.tax} >= 0 AND ${t.deductions} >= 0`),
  ],
);

// ─── relations ───────────────────────────────────────────────────────────────

export const departmentsRelations = relations(departments, ({ one, many }) => ({
  parent: one(departments, {
    fields: [departments.parentId],
    references: [departments.id],
    relationName: "dept_parent",
  }),
  children: many(departments, { relationName: "dept_parent" }),
  positions: many(positions),
  employees: many(employees),
}));

export const employeesRelations = relations(employees, ({ one, many }) => ({
  department: one(departments, {
    fields: [employees.departmentId],
    references: [departments.id],
  }),
  position: one(positions, { fields: [employees.positionId], references: [positions.id] }),
  manager: one(employees, {
    fields: [employees.managerId],
    references: [employees.id],
    relationName: "emp_manager",
  }),
  reports: many(employees, { relationName: "emp_manager" }),
  attendances: many(attendances),
  leaves: many(leaves),
  salaries: many(salaryPayments),
}));

export const salaryPaymentsRelations = relations(salaryPayments, ({ one }) => ({
  employee: one(employees, { fields: [salaryPayments.employeeId], references: [employees.id] }),
}));

// ─── KPI: oylik mukofotni ishlangan ishdan hisoblash ─────────────────────────

/**
 * Qaysi ko'rsatkich bo'yicha hisoblanadi. Nom oldidagi bo'lak — kimga tegishli.
 * `_amount` — pul (stavka foizda), `_count` — dona, `_kg` — og'irlik (stavka dona/kg uchun summa).
 */
export const kpiMetric = pgEnum("kpi_metric", [
  "delivery_count",
  "delivery_amount",
  "delivery_weight_kg",
  "agent_sales_amount",
  "agent_order_count",
  "agent_visit_count",
  "agent_collected_amount",
  "cashier_receipt_count",
  "cashier_sales_amount",
  "warehouse_receipt_count",
  "warehouse_issue_count",
]);

/** `percent` — ko'rsatkich summasidan foiz; `per_unit` — har bir dona/kg uchun belgilangan summa. */
export const kpiRateType = pgEnum("kpi_rate_type", ["percent", "per_unit"]);

/**
 * KPI qoidasi. Lavozimga yozilsa — shu lavozimdagi hamma xodimga tegadi; xodimga yozilgani
 * o'sha xodim uchun lavozim qoidasining o'rniga ishlaydi (bitta ko'rsatkich bo'yicha).
 * Bir maqsadga bir nechta ko'rsatkich bo'lishi mumkin — ular qo'shiladi.
 */
export const kpiRules = pgTable(
  "kpi_rules",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    /** Lavozim qoidasi (xodim qoidasi bo'lmasa ishlatiladi). */
    positionId: uuid("position_id").references(() => positions.id, { onDelete: "cascade" }),
    /** Alohida xodim uchun — lavozim qoidasidan ustun. */
    employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "cascade" }),
    metric: kpiMetric("metric").notNull(),
    rateType: kpiRateType("rate_type").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("kpi_rule_position_metric_key")
      .on(t.companyId, t.positionId, t.metric)
      .where(sql`${t.positionId} is not null`),
    uniqueIndex("kpi_rule_employee_metric_key")
      .on(t.companyId, t.employeeId, t.metric)
      .where(sql`${t.employeeId} is not null`),
    index("kpi_rule_company_idx").on(t.companyId, t.isActive),
    check("kpi_rule_one_target", sql`(${t.positionId} is null) <> (${t.employeeId} is null)`),
  ],
);

/**
 * Bosqichlar. Hisob PROGRESSIV: har bosqich faqat o'z oralig'iga tushgan qismga qo'llanadi
 * (masalan 214 ta yetkazma → 100 tasi 1-bosqich stavkasida, 100 tasi 2-bosqichda, 14 tasi 3-bosqichda).
 */
export const kpiRuleTiers = pgTable(
  "kpi_rule_tiers",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => kpiRules.id, { onDelete: "cascade" }),
    /** Bosqich boshlanishi (shu qiymatdan). */
    fromValue: qty("from_value").notNull().default("0"),
    /** Bosqich tugashi (shu qiymatgacha); `null` — cheksiz. */
    toValue: qty("to_value"),
    /** `percent` bo'lsa — foiz, `per_unit` bo'lsa — bir dona/kg uchun summa. */
    rate: qty("rate").notNull().default("0"),
    ...timestamps(),
  },
  (t) => [
    index("kpi_tier_rule_idx").on(t.ruleId, t.fromValue),
    check("kpi_tier_range", sql`${t.toValue} is null or ${t.toValue} > ${t.fromValue}`),
    check("kpi_tier_non_negative", sql`${t.fromValue} >= 0 AND ${t.rate} >= 0`),
  ],
);

/** Oylikda KPI qanday chiqqani — qaysi ko'rsatkich, qancha bo'lgani va qancha pul bo'lgani. */
export const salaryKpiLines = pgTable(
  "salary_kpi_lines",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    salaryPaymentId: uuid("salary_payment_id")
      .notNull()
      .references(() => salaryPayments.id, { onDelete: "cascade" }),
    metric: kpiMetric("metric").notNull(),
    /** Ko'rsatkichning o'zi (dona, kg yoki so'm). */
    metricValue: qty("metric_value").notNull().default("0"),
    /** Shu ko'rsatkichdan chiqqan mukofot. */
    amount: money("amount").notNull().default("0"),
    ruleId: uuid("rule_id").references(() => kpiRules.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("kpi_line_salary_metric_key").on(t.salaryPaymentId, t.metric),
    index("kpi_line_company_idx").on(t.companyId),
  ],
);

export const kpiRulesRelations = relations(kpiRules, ({ one, many }) => ({
  position: one(positions, { fields: [kpiRules.positionId], references: [positions.id] }),
  employee: one(employees, { fields: [kpiRules.employeeId], references: [employees.id] }),
  tiers: many(kpiRuleTiers),
}));

export const kpiRuleTiersRelations = relations(kpiRuleTiers, ({ one }) => ({
  rule: one(kpiRules, { fields: [kpiRuleTiers.ruleId], references: [kpiRules.id] }),
}));

export const salaryKpiLinesRelations = relations(salaryKpiLines, ({ one }) => ({
  salary: one(salaryPayments, { fields: [salaryKpiLines.salaryPaymentId], references: [salaryPayments.id] }),
}));
