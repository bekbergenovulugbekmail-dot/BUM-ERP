/**
 * /api/hr — bo'limlar, lavozimlar, xodimlar, davomat, ta'tillar, maosh (convex/hr/*).
 *
 *   GET    /departments, /positions (?departmentId=), /employees (?departmentId=&status=&search=&limit=),
 *          /employees/stats, /employees/:employeeId                             hr.view (maxfiy maydonlar — hr.manage)
 *   POST / PATCH / DELETE  /departments, /positions, /employees                  hr.manage
 *          (POST /employees {softwareAccess} — qo'shimcha employee.software_access.manage)
 *   POST   /employees/:employeeId/software-access   bepul → dasturdan foydalanuvchi   hr.manage + employee.software_access.manage
 *   DELETE /employees/:employeeId/software-access   dasturdan foydalanuvchi → bepul   hr.manage + employee.software_access.manage
 *   GET    /attendance (?employeeId=&month=&date=&limit=), /attendance/stats?month=   hr.view
 *   PUT    /attendance, /attendance/bulk                                          hr.attendance
 *   GET    /leaves (?employeeId=&status=&limit=)                                  hr.view
 *   POST   /leaves, DELETE /leaves/:leaveId                                       hr.manage
 *   POST   /leaves/:leaveId/decision                                              hr.approve
 *   GET    /salaries (?month=&employeeId=&status=&limit=), /salaries/summary?month=   hr.view
 *   POST   /salaries/generate, PATCH / DELETE /salaries/:salaryId                 hr.salary
 *   POST   /salaries/:salaryId/approve, /revert, /pay                             hr.approve
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { PIN_PATTERN, type Permission } from "@bum/shared";
import { db } from "../../db/client.js";
import { withTransaction, type Tx } from "../../db/transaction.js";
import { requestMeta } from "../../shared/audit.js";
import { decimalSchema, moneySchema, percentSchema, qtySchema } from "../../shared/decimal.js";
import { authOf, requireAuth } from "../auth/guard.js";
import { requirePermission, requireTenant, requireTenantForWrite, type TenantContext } from "../company/tenant.js";
import { attendanceStats, bulkRecordAttendance, listAttendance, recordAttendance } from "./attendance.service.js";
import {
  createEmployee,
  deleteEmployee,
  disableSoftwareAccess,
  employeeStats,
  enableSoftwareAccess,
  getEmployee,
  listEmployees,
  updateEmployee,
} from "./employees.service.js";
import { createLeave, decideLeave, deleteLeave, listLeaves } from "./leaves.service.js";
import {
  createDepartment,
  createPosition,
  deleteDepartment,
  deletePosition,
  listDepartments,
  listPositions,
  updateDepartment,
  updatePosition,
} from "./org.service.js";
import {
  approveSalary,
  deleteSalary,
  generateSalaries,
  listSalaries,
  paySalary,
  revertSalary,
  salarySummary,
  updateSalary,
} from "./salary.service.js";

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();
const boolQuery = z.enum(["true", "false"]).transform((v) => v === "true").optional();
const isoDate = z.iso.date();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Oy YYYY-MM ko'rinishida bo'lishi kerak");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Vaqt HH:MM ko'rinishida bo'lishi kerak");
const limitQuery = z.coerce.number().int().min(1).max(1000).default(200);

const departmentBody = z.strictObject({
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().min(1).max(32),
  parentId: z.uuid().nullable().optional(),
  managerId: z.uuid().nullable().optional(),
});
const departmentPatch = departmentBody.omit({ code: true }).partial().extend({ isActive: z.boolean().optional() });

const positionBody = z.strictObject({
  departmentId: z.uuid(),
  name: z.string().trim().min(1).max(200),
  level: nullableText(64),
  minSalary: moneySchema.nullable().optional(),
  maxSalary: moneySchema.nullable().optional(),
});
const positionPatch = positionBody.omit({ departmentId: true }).partial().extend({ isActive: z.boolean().optional() });

const employeeBody = z.strictObject({
  name: z.string().trim().min(1).max(200),
  phone: nullableText(20),
  email: nullableText(255),
  departmentId: z.uuid().nullable().optional(),
  positionId: z.uuid().nullable().optional(),
  managerId: z.uuid().nullable().optional(),
  userId: z.uuid().nullable().optional(),
  hireDate: isoDate,
  birthDate: isoDate.nullable().optional(),
  gender: z.enum(["male", "female"]).nullable().optional(),
  address: nullableText(1000),
  passportNumber: nullableText(32),
  inn: nullableText(32),
  bankAccount: nullableText(64),
  baseSalary: moneySchema,
  salaryType: z.enum(["monthly", "hourly", "daily"]),
  notes: nullableText(2000),
  /** Berilsa — "BEPUL" o'chiq: xodim dasturdan foydalanadi (login, parol, PIN, rol, litsenziya). */
  softwareAccess: z
    .strictObject({
      phone: z.string().min(1).max(32),
      password: z.string().min(1).max(256),
      pin: z.string().regex(PIN_PATTERN, "PIN 4-8 ta raqamdan iborat bo'lishi kerak"),
      role: z.string().trim().min(1).max(100),
      additionalLicensePlanId: z.uuid().nullable().optional(),
    })
    .nullable()
    .optional(),
});
const employeePatch = employeeBody
  .omit({ softwareAccess: true })
  .partial()
  .extend({ status: z.enum(["active", "on_leave", "terminated"]).optional() });
const softwareAccessBody = z.strictObject({
  phone: z.string().min(1).max(32).optional(),
  password: z.string().min(1).max(256).optional(),
  pin: z.string().regex(PIN_PATTERN, "PIN 4-8 ta raqamdan iborat bo'lishi kerak").optional(),
  role: z.string().trim().min(1).max(100).optional(),
  additionalLicensePlanId: z.uuid().nullable().optional(),
});
const employeesQuery = z.object({
  departmentId: z.uuid().optional(),
  status: z.enum(["active", "on_leave", "terminated"]).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  limit: limitQuery,
});

const attendanceStatuses = ["present", "absent", "late", "half_day", "holiday", "on_leave"] as const;
const attendanceFields = {
  status: z.enum(attendanceStatuses),
  checkIn: time.nullable().optional(),
  checkOut: time.nullable().optional(),
  workHours: decimalSchema({ scale: 4, min: 0, max: 24 }).optional(),
  overtime: decimalSchema({ scale: 4, min: 0, max: 24 }).optional(),
  notes: nullableText(1000),
};
const attendanceBody = z.strictObject({ employeeId: z.uuid(), date: isoDate, ...attendanceFields });
const bulkAttendanceBody = z.strictObject({
  date: isoDate,
  records: z.array(z.strictObject({ employeeId: z.uuid(), ...attendanceFields })).min(1).max(1000),
});
const attendanceQuery = z.object({
  employeeId: z.uuid().optional(),
  month: month.optional(),
  date: isoDate.optional(),
  limit: limitQuery,
});

const leaveBody = z.strictObject({
  employeeId: z.uuid(),
  type: z.enum(["annual", "sick", "unpaid", "maternity", "other"]),
  startDate: isoDate,
  endDate: isoDate,
  days: qtySchema.optional(),
  reason: nullableText(1000),
  notes: nullableText(1000),
});
const leaveDecisionBody = z.strictObject({ status: z.enum(["approved", "rejected"]), notes: nullableText(1000) });
const leavesQuery = z.object({
  employeeId: z.uuid().optional(),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  limit: limitQuery,
});

const generateBody = z.strictObject({
  month,
  taxRate: percentSchema.optional(),
  workDays: decimalSchema({ scale: 4, positive: true, max: 31 }).optional(),
});
const salaryPatch = z.strictObject({ bonus: moneySchema.optional(), deductions: moneySchema.optional(), notes: nullableText(1000) });
const payBody = z
  .strictObject({
    method: z.enum(["cash", "bank", "card", "transfer"]).optional(),
    cashAccountId: z.uuid().nullable().optional(),
    paidDate: isoDate.optional(),
  })
  .optional();
const salariesQuery = z.object({
  month: month.optional(),
  employeeId: z.uuid().optional(),
  status: z.enum(["draft", "approved", "paid"]).optional(),
  limit: limitQuery,
});
const monthQuery = z.object({ month });

const includeInactiveQuery = z.object({ includeInactive: boolQuery });
const positionsQuery = z.object({ departmentId: z.uuid().optional(), includeInactive: boolQuery });
const idParams = (key: string) => z.object({ [key]: z.uuid() });

async function readTenant(req: FastifyRequest): Promise<TenantContext> {
  const tenant = await requireTenant(db, authOf(req).user);
  await requirePermission(db, tenant, "hr.view");
  return tenant;
}

function writeInTenant<T>(
  req: FastifyRequest,
  permission: Permission,
  fn: (tx: Tx, tenant: TenantContext) => Promise<T>,
): Promise<T> {
  return withTransaction(async (tx) => {
    const tenant = await requireTenantForWrite(tx, authOf(req).user);
    await requirePermission(tx, tenant, permission);
    return fn(tx, tenant);
  });
}

export async function hrRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  const param = (req: FastifyRequest, key: string) => (idParams(key).parse(req.params) as Record<string, string>)[key]!;

  // ─── Bo'limlar va lavozimlar ─────────────────────────────────────────────

  app.get("/departments", async (req) => {
    const { includeInactive } = includeInactiveQuery.parse(req.query);
    return { departments: await listDepartments(db, await readTenant(req), includeInactive ?? false) };
  });

  app.post("/departments", async (req, reply) => {
    const body = departmentBody.parse(req.body);
    const department = await writeInTenant(req, "hr.manage", (tx, t) => createDepartment(tx, t, body, requestMeta(req)));
    reply.status(201);
    return { department };
  });

  app.patch("/departments/:departmentId", async (req) => {
    const id = param(req, "departmentId");
    const patch = departmentPatch.parse(req.body);
    return { department: await writeInTenant(req, "hr.manage", (tx, t) => updateDepartment(tx, t, id, patch, requestMeta(req))) };
  });

  app.delete("/departments/:departmentId", async (req, reply) => {
    const id = param(req, "departmentId");
    await writeInTenant(req, "hr.manage", (tx, t) => deleteDepartment(tx, t, id, requestMeta(req)));
    return reply.status(204).send();
  });

  app.get("/positions", async (req) => {
    const query = positionsQuery.parse(req.query);
    return { positions: await listPositions(db, await readTenant(req), query) };
  });

  app.post("/positions", async (req, reply) => {
    const body = positionBody.parse(req.body);
    const position = await writeInTenant(req, "hr.manage", (tx, t) => createPosition(tx, t, body, requestMeta(req)));
    reply.status(201);
    return { position };
  });

  app.patch("/positions/:positionId", async (req) => {
    const id = param(req, "positionId");
    const patch = positionPatch.parse(req.body);
    return { position: await writeInTenant(req, "hr.manage", (tx, t) => updatePosition(tx, t, id, patch, requestMeta(req))) };
  });

  app.delete("/positions/:positionId", async (req, reply) => {
    const id = param(req, "positionId");
    await writeInTenant(req, "hr.manage", (tx, t) => deletePosition(tx, t, id, requestMeta(req)));
    return reply.status(204).send();
  });

  // ─── Xodimlar ────────────────────────────────────────────────────────────

  app.get("/employees", async (req) => {
    const query = employeesQuery.parse(req.query);
    return { employees: await listEmployees(db, await readTenant(req), query) };
  });

  app.get("/employees/stats", async (req) => employeeStats(db, await readTenant(req)));

  app.get("/employees/:employeeId", async (req) => {
    const id = param(req, "employeeId");
    return { employee: await getEmployee(db, await readTenant(req), id) };
  });

  app.post("/employees", async (req, reply) => {
    const { softwareAccess, ...body } = employeeBody.parse(req.body);
    const employee = await writeInTenant(req, "hr.manage", async (tx, t) => {
      if (softwareAccess) await requirePermission(tx, t, "employee.software_access.manage");
      // Maosh belgilash — tahrirlashdagi kabi `hr.salary` (kartochka ochish ruxsati yetmaydi)
      if (Number(body.baseSalary) > 0) await requirePermission(tx, t, "hr.salary");
      return createEmployee(tx, t, body, requestMeta(req), softwareAccess ?? null);
    });
    reply.status(201);
    return { employee };
  });

  app.post("/employees/:employeeId/software-access", async (req) => {
    const id = param(req, "employeeId");
    const body = softwareAccessBody.parse(req.body);
    const employee = await writeInTenant(req, "hr.manage", async (tx, t) => {
      await requirePermission(tx, t, "employee.software_access.manage");
      return enableSoftwareAccess(tx, t, id, body, requestMeta(req));
    });
    return { employee };
  });

  app.delete("/employees/:employeeId/software-access", async (req) => {
    const id = param(req, "employeeId");
    const employee = await writeInTenant(req, "hr.manage", async (tx, t) => {
      await requirePermission(tx, t, "employee.software_access.manage");
      return disableSoftwareAccess(tx, t, id, requestMeta(req));
    });
    return { employee };
  });

  app.patch("/employees/:employeeId", async (req) => {
    const id = param(req, "employeeId");
    const patch = employeePatch.parse(req.body);
    return {
      employee: await writeInTenant(req, "hr.manage", async (tx, t) => {
        // Maoshni o'zgartirish — maosh ruxsati (`hr.salary`), xodim kartochkasini tahrirlash ruxsati yetmaydi
        if (patch.baseSalary !== undefined) await requirePermission(tx, t, "hr.salary");
        return updateEmployee(tx, t, id, patch, requestMeta(req));
      }),
    };
  });

  app.delete("/employees/:employeeId", async (req, reply) => {
    const id = param(req, "employeeId");
    await writeInTenant(req, "hr.manage", (tx, t) => deleteEmployee(tx, t, id, requestMeta(req)));
    return reply.status(204).send();
  });

  // ─── Davomat ─────────────────────────────────────────────────────────────

  app.get("/attendance", async (req) => {
    const query = attendanceQuery.parse(req.query);
    return { attendance: await listAttendance(db, await readTenant(req), query) };
  });

  app.get("/attendance/stats", async (req) => {
    const { month: value } = monthQuery.parse(req.query);
    return attendanceStats(db, await readTenant(req), value);
  });

  app.put("/attendance", async (req) => {
    const body = attendanceBody.parse(req.body);
    return { attendance: await writeInTenant(req, "hr.attendance", (tx, t) => recordAttendance(tx, t, body, requestMeta(req))) };
  });

  app.put("/attendance/bulk", async (req) => {
    const body = bulkAttendanceBody.parse(req.body);
    return writeInTenant(req, "hr.attendance", (tx, t) => bulkRecordAttendance(tx, t, body, requestMeta(req)));
  });

  // ─── Ta'tillar ───────────────────────────────────────────────────────────

  app.get("/leaves", async (req) => {
    const query = leavesQuery.parse(req.query);
    return { leaves: await listLeaves(db, await readTenant(req), query) };
  });

  app.post("/leaves", async (req, reply) => {
    const body = leaveBody.parse(req.body);
    const leave = await writeInTenant(req, "hr.manage", (tx, t) => createLeave(tx, t, body, requestMeta(req)));
    reply.status(201);
    return { leave };
  });

  app.post("/leaves/:leaveId/decision", async (req) => {
    const id = param(req, "leaveId");
    const body = leaveDecisionBody.parse(req.body);
    return { leave: await writeInTenant(req, "hr.approve", (tx, t) => decideLeave(tx, t, id, body, requestMeta(req))) };
  });

  app.delete("/leaves/:leaveId", async (req, reply) => {
    const id = param(req, "leaveId");
    await writeInTenant(req, "hr.manage", (tx, t) => deleteLeave(tx, t, id, requestMeta(req)));
    return reply.status(204).send();
  });

  // ─── Maosh ───────────────────────────────────────────────────────────────

  app.get("/salaries", async (req) => {
    const query = salariesQuery.parse(req.query);
    return { salaries: await listSalaries(db, await readTenant(req), query) };
  });

  app.get("/salaries/summary", async (req) => {
    const { month: value } = monthQuery.parse(req.query);
    return salarySummary(db, await readTenant(req), value);
  });

  app.post("/salaries/generate", async (req) => {
    const body = generateBody.parse(req.body);
    return writeInTenant(req, "hr.salary", (tx, t) => generateSalaries(tx, t, body, requestMeta(req)));
  });

  app.patch("/salaries/:salaryId", async (req) => {
    const id = param(req, "salaryId");
    const patch = salaryPatch.parse(req.body);
    return { salary: await writeInTenant(req, "hr.salary", (tx, t) => updateSalary(tx, t, id, patch, requestMeta(req))) };
  });

  app.delete("/salaries/:salaryId", async (req, reply) => {
    const id = param(req, "salaryId");
    await writeInTenant(req, "hr.salary", (tx, t) => deleteSalary(tx, t, id, requestMeta(req)));
    return reply.status(204).send();
  });

  app.post("/salaries/:salaryId/approve", async (req) => {
    const id = param(req, "salaryId");
    return { salary: await writeInTenant(req, "hr.approve", (tx, t) => approveSalary(tx, t, id, requestMeta(req))) };
  });

  app.post("/salaries/:salaryId/revert", async (req) => {
    const id = param(req, "salaryId");
    return { salary: await writeInTenant(req, "hr.approve", (tx, t) => revertSalary(tx, t, id, requestMeta(req))) };
  });

  app.post("/salaries/:salaryId/pay", async (req) => {
    const id = param(req, "salaryId");
    const body = payBody.parse(req.body) ?? {};
    return { salary: await writeInTenant(req, "hr.approve", (tx, t) => paySalary(tx, t, id, body, requestMeta(req))) };
  });
}
