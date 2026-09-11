/**
 * Davomat (convex/hr/attendance.ts).
 *
 * Convex'dan farqlar:
 *  - ommaviy yozishda boshqa kompaniya xodimi jimgina o'tkazib yuborilardi — endi butun so'rov rad etiladi
 *  - ishdan bo'shatilgan xodimga va ishga qabul qilinishidan oldingi sanaga davomat yozilardi
 *  - vaqt formati va ketma-ketligi (kelish ≤ ketish), manfiy soatlar tekshirilmasdi
 *  - yozish `hr.attendance` (Convex `hr.manage`); o'qish ruxsatsiz edi — `hr.view`
 *  - oylik statistika barcha davomatni xotiraga yuklab filtrlardi — endi sana oralig'i bilan
 */
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { badRequest } from "@bum/shared";
import { attendances, departments, employees } from "../../db/schema/hr.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import type { TenantContext } from "../company/tenant.js";
import { hrAudit } from "./org.service.js";

export type AttendanceStatus = (typeof attendances.status.enumValues)[number];

/** Soatlar berilmasa holatdan: to'liq kun 8, yarim kun 4. */
const DEFAULT_HOURS: Record<AttendanceStatus, string> = {
  present: "8",
  late: "8",
  half_day: "4",
  absent: "0",
  holiday: "0",
  on_leave: "0",
};

export function monthRange(month: string) {
  const [year, mon] = month.split("-").map(Number) as [number, number];
  const next = mon === 12 ? `${year + 1}-01-01` : `${year}-${String(mon + 1).padStart(2, "0")}-01`;
  return { start: `${month}-01`, next };
}

export type AttendanceInput = {
  date: string;
  status: AttendanceStatus;
  checkIn?: string | null;
  checkOut?: string | null;
  workHours?: string;
  overtime?: string;
  notes?: string | null;
};

type EmployeeRef = { id: string; name: string; status: string; hireDate: string };

async function upsert(tx: Tx, companyId: string, employee: EmployeeRef, input: AttendanceInput) {
  if (employee.status === "terminated") throw badRequest(`${employee.name}: ishdan bo'shatilgan`);
  if (input.date < employee.hireDate) throw badRequest(`${employee.name}: ishga qabul qilinishidan oldingi sana`);
  if (input.checkIn && input.checkOut && input.checkOut < input.checkIn) {
    throw badRequest(`${employee.name}: ketish vaqti kelishdan oldin`);
  }

  const values = {
    checkIn: input.checkIn ?? null,
    checkOut: input.checkOut ?? null,
    workHours: input.workHours ?? DEFAULT_HOURS[input.status],
    overtime: input.overtime ?? "0",
    status: input.status,
    notes: input.notes ?? null,
  };
  const [row] = await tx
    .insert(attendances)
    .values({ ...values, companyId, employeeId: employee.id, attendanceDate: input.date })
    .onConflictDoUpdate({ target: [attendances.employeeId, attendances.attendanceDate], set: { ...values, updatedAt: new Date() } })
    .returning();
  const { legacyId: _l, companyId: _c, ...attendance } = row!;
  return attendance;
}

async function loadEmployees(tx: Tx, companyId: string, ids: string[]) {
  const rows = await tx
    .select({ id: employees.id, name: employees.name, status: employees.status, hireDate: employees.hireDate })
    .from(employees)
    .where(and(eq(employees.companyId, companyId), inArray(employees.id, ids)));
  if (rows.length !== new Set(ids).size) throw badRequest("Xodim topilmadi");
  return new Map(rows.map((r) => [r.id, r]));
}

export async function listAttendance(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { employeeId?: string; month?: string; date?: string; limit: number },
) {
  const range = options.month ? monthRange(options.month) : null;
  return conn
    .select({
      id: attendances.id,
      employeeId: attendances.employeeId,
      attendanceDate: attendances.attendanceDate,
      checkIn: attendances.checkIn,
      checkOut: attendances.checkOut,
      workHours: attendances.workHours,
      overtime: attendances.overtime,
      status: attendances.status,
      notes: attendances.notes,
      employeeName: employees.name,
      departmentName: departments.name,
    })
    .from(attendances)
    .innerJoin(employees, eq(employees.id, attendances.employeeId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(
      and(
        eq(attendances.companyId, tenant.company.id),
        options.employeeId ? eq(attendances.employeeId, options.employeeId) : undefined,
        options.date ? eq(attendances.attendanceDate, options.date) : undefined,
        range ? gte(attendances.attendanceDate, range.start) : undefined,
        range ? lt(attendances.attendanceDate, range.next) : undefined,
      ),
    )
    .orderBy(desc(attendances.attendanceDate), asc(employees.name))
    .limit(options.limit);
}

export async function attendanceStats(conn: DbOrTx, tenant: TenantContext, month: string) {
  const { start, next } = monthRange(month);
  const [stats] = await conn
    .select({
      total: sql<number>`count(*)::int`,
      present: sql<number>`(count(*) filter (where ${attendances.status} = 'present'))::int`,
      absent: sql<number>`(count(*) filter (where ${attendances.status} = 'absent'))::int`,
      late: sql<number>`(count(*) filter (where ${attendances.status} = 'late'))::int`,
      halfDay: sql<number>`(count(*) filter (where ${attendances.status} = 'half_day'))::int`,
      onLeave: sql<number>`(count(*) filter (where ${attendances.status} = 'on_leave'))::int`,
      totalHours: sql<string>`coalesce(sum(${attendances.workHours}), 0)::numeric(18,4)`,
      totalOvertime: sql<string>`coalesce(sum(${attendances.overtime}), 0)::numeric(18,4)`,
    })
    .from(attendances)
    .where(
      and(eq(attendances.companyId, tenant.company.id), gte(attendances.attendanceDate, start), lt(attendances.attendanceDate, next)),
    );
  return stats!;
}

export async function recordAttendance(
  tx: Tx,
  tenant: TenantContext,
  input: AttendanceInput & { employeeId: string },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const employee = (await loadEmployees(tx, companyId, [input.employeeId])).get(input.employeeId)!;
  const attendance = await upsert(tx, companyId, employee, input);
  await hrAudit(tx, tenant, meta, {
    action: "ATTENDANCE_RECORDED",
    resource: "attendances",
    resourceId: attendance.id,
    details: { employeeId: employee.id, date: input.date, status: input.status },
  });
  return attendance;
}

export async function bulkRecordAttendance(
  tx: Tx,
  tenant: TenantContext,
  input: { date: string; records: (Omit<AttendanceInput, "date"> & { employeeId: string })[] },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const ids = input.records.map((r) => r.employeeId);
  if (new Set(ids).size !== ids.length) throw badRequest("Xodim ikki marta kiritilgan");
  const staff = await loadEmployees(tx, companyId, ids);

  for (const record of input.records) {
    await upsert(tx, companyId, staff.get(record.employeeId)!, { ...record, date: input.date });
  }
  await hrAudit(tx, tenant, meta, {
    action: "ATTENDANCE_BULK_RECORDED",
    resource: "attendances",
    resourceId: companyId,
    details: { date: input.date, count: input.records.length },
  });
  return { processed: input.records.length };
}
