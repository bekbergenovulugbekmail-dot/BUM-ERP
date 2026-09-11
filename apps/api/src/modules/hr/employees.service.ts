/**
 * Xodimlar (convex/hr/employees.ts: *Employee, getStats).
 *
 * Convex'dan farqlar:
 *  - pasport, INN va bank hisobi `hr.view` siz ham, hamma a'zolarga qaytarilardi — endi faqat `hr.manage`
 *  - bo'lim, lavozim va rahbar boshqa kompaniyadan ham qabul qilinardi; lavozim boshqa bo'limniki
 *    bo'lishi, xodim o'ziga rahbar bo'lishi va rahbarlar zanjiri sikl hosil qilishi mumkin edi
 *  - `userId` tekshirilmasdi; bitta foydalanuvchi bir necha xodimga bog'lanardi
 *  - kod "oxirgi + 1" edi — parallel yaratishda takrorlanardi (`EMP-0001`, advisory lock)
 *  - davomat/maosh tarixi bor xodim o'chirilardi — endi faqat ishdan bo'shatish (`terminated`)
 *  - `update` / `delete` to'xtatilgan kompaniyada ham yozardi; o'qish ruxsatsiz edi
 */
import { and, asc, eq, getTableColumns, ilike, ne, or, sql } from "drizzle-orm";
import { badRequest, conflict, notFound } from "@bum/shared";
import { attendances, departments, employees, leaves, positions, salaryPayments } from "../../db/schema/hr.js";
import { companyMembers } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { nextDocumentNumber } from "../../shared/numbering.js";
import { effectivePermissions, type TenantContext } from "../company/tenant.js";
import { hrAudit } from "./org.service.js";

const { legacyId: _legacyId, companyId: _companyId, ...employeeFields } = getTableColumns(employees);

export type EmployeeStatus = (typeof employees.status.enumValues)[number];
export type SalaryType = (typeof employees.salaryType.enumValues)[number];

export type EmployeeInput = {
  name: string;
  phone?: string | null;
  email?: string | null;
  departmentId?: string | null;
  positionId?: string | null;
  managerId?: string | null;
  userId?: string | null;
  hireDate: string;
  birthDate?: string | null;
  gender?: "male" | "female" | null;
  address?: string | null;
  passportNumber?: string | null;
  inn?: string | null;
  bankAccount?: string | null;
  baseSalary: string;
  salaryType: SalaryType;
  notes?: string | null;
};

/** Maxfiy maydonlar faqat `hr.manage` bilan ko'rinadi. */
async function redactor(conn: DbOrTx, tenant: TenantContext) {
  const canSee = (await effectivePermissions(conn, tenant)).includes("hr.manage");
  return <T extends { passportNumber: string | null; inn: string | null; bankAccount: string | null }>(row: T) => {
    if (canSee) return row;
    const { passportNumber: _p, inn: _i, bankAccount: _b, ...rest } = row;
    return rest;
  };
}

export async function listEmployees(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { departmentId?: string; status?: EmployeeStatus; search?: string; limit: number },
) {
  const pattern = options.search ? `%${options.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const rows = await conn
    .select({ ...employeeFields, departmentName: departments.name, positionName: positions.name })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(positions, eq(positions.id, employees.positionId))
    .where(
      and(
        eq(employees.companyId, tenant.company.id),
        options.departmentId ? eq(employees.departmentId, options.departmentId) : undefined,
        options.status ? eq(employees.status, options.status) : undefined,
        pattern
          ? or(ilike(employees.name, pattern), ilike(employees.code, pattern), ilike(employees.phone, pattern))
          : undefined,
      ),
    )
    .orderBy(asc(employees.name))
    .limit(options.limit);
  const redact = await redactor(conn, tenant);
  return rows.map(redact);
}

export async function getEmployee(conn: DbOrTx, tenant: TenantContext, employeeId: string) {
  const [employee] = await conn
    .select({ ...employeeFields, departmentName: departments.name, positionName: positions.name })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(positions, eq(positions.id, employees.positionId))
    .where(and(eq(employees.id, employeeId), eq(employees.companyId, tenant.company.id)))
    .limit(1);
  if (!employee) throw notFound("Xodim topilmadi");

  let managerName: string | null = null;
  if (employee.managerId) {
    const [manager] = await conn.select({ name: employees.name }).from(employees).where(eq(employees.id, employee.managerId));
    managerName = manager?.name ?? null;
  }
  const redact = await redactor(conn, tenant);
  return { ...redact(employee), managerName };
}

export async function employeeStats(conn: DbOrTx, tenant: TenantContext) {
  const [stats] = await conn
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`(count(*) filter (where ${employees.status} = 'active'))::int`,
      onLeave: sql<number>`(count(*) filter (where ${employees.status} = 'on_leave'))::int`,
      terminated: sql<number>`(count(*) filter (where ${employees.status} = 'terminated'))::int`,
      totalSalary: sql<string>`coalesce(sum(${employees.baseSalary}) filter (where ${employees.status} <> 'terminated' and ${employees.salaryType} = 'monthly'), 0)::numeric(18,2)`,
    })
    .from(employees)
    .where(eq(employees.companyId, tenant.company.id));
  return stats!;
}

/** Bo'lim, lavozim, rahbar va foydalanuvchi shu kompaniyaniki va o'zaro mos. */
async function resolveReferences(
  tx: Tx,
  companyId: string,
  input: Partial<EmployeeInput>,
  current: { id: string; departmentId: string | null; positionId: string | null } | null,
) {
  let departmentId = input.departmentId !== undefined ? input.departmentId : current?.departmentId ?? null;
  const positionId = input.positionId !== undefined ? input.positionId : current?.positionId ?? null;

  if (input.departmentId) {
    const [department] = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.id, input.departmentId), eq(departments.companyId, companyId)))
      .limit(1);
    if (!department) throw badRequest("Bo'lim topilmadi");
  }
  if (positionId && (input.positionId !== undefined || input.departmentId !== undefined)) {
    const [position] = await tx
      .select({ departmentId: positions.departmentId })
      .from(positions)
      .where(and(eq(positions.id, positionId), eq(positions.companyId, companyId)))
      .limit(1);
    if (!position) throw badRequest("Lavozim topilmadi");
    if (departmentId && position.departmentId !== departmentId) throw badRequest("Lavozim boshqa bo'limga tegishli");
    departmentId = position.departmentId;
  }

  if (input.managerId) {
    let cursor: string | null = input.managerId;
    for (let depth = 0; cursor; depth++) {
      if (current && cursor === current.id) throw badRequest("Rahbarlar zanjiri siklik bo'lib qoladi");
      if (depth > 50) throw badRequest("Rahbarlar zanjiri juda uzun");
      const [manager] = await tx
        .select({ managerId: employees.managerId, status: employees.status })
        .from(employees)
        .where(and(eq(employees.id, cursor), eq(employees.companyId, companyId)))
        .limit(1);
      if (!manager) throw badRequest("Rahbar topilmadi");
      if (depth === 0 && manager.status === "terminated") throw badRequest("Ishdan bo'shatilgan xodim rahbar bo'la olmaydi");
      cursor = manager.managerId;
    }
  }

  if (input.userId) {
    const [member] = await tx
      .select({ id: companyMembers.id })
      .from(companyMembers)
      .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, input.userId)))
      .limit(1);
    if (!member) throw badRequest("Foydalanuvchi kompaniya a'zosi emas");
    const [taken] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(
        and(
          eq(employees.companyId, companyId),
          eq(employees.userId, input.userId),
          current ? ne(employees.id, current.id) : undefined,
        ),
      )
      .limit(1);
    if (taken) throw conflict("Foydalanuvchi boshqa xodimga bog'langan");
  }

  return { departmentId, positionId };
}

export async function createEmployee(tx: Tx, tenant: TenantContext, input: EmployeeInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const references = await resolveReferences(tx, companyId, input, null);
  const code = await nextDocumentNumber(tx, {
    table: employees,
    column: employees.code,
    companyColumn: employees.companyId,
    companyId,
    prefix: "EMP-",
    width: 4,
  });

  const [employee] = await tx
    .insert(employees)
    .values({ ...input, ...references, code, companyId })
    .returning({ id: employees.id });
  await hrAudit(tx, tenant, meta, {
    action: "EMPLOYEE_CREATED",
    resource: "employees",
    resourceId: employee!.id,
    details: { code, name: input.name },
  });
  return getEmployee(tx, tenant, employee!.id);
}

export async function updateEmployee(
  tx: Tx,
  tenant: TenantContext,
  employeeId: string,
  patch: Partial<EmployeeInput> & { status?: EmployeeStatus },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const [current] = await tx
    .select({ id: employees.id, departmentId: employees.departmentId, positionId: employees.positionId })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!current) throw notFound("Xodim topilmadi");

  const references = await resolveReferences(tx, companyId, patch, current);
  await tx
    .update(employees)
    .set({ ...patch, ...references, updatedAt: new Date() })
    .where(eq(employees.id, employeeId));

  // Maosh va bank ma'lumotlari o'zgarishi auditda maydon nomi bilan qoladi, qiymati bilan emas
  await hrAudit(tx, tenant, meta, {
    action: patch.status === "terminated" ? "EMPLOYEE_TERMINATED" : "EMPLOYEE_UPDATED",
    resource: "employees",
    resourceId: employeeId,
    details: { changes: Object.keys(patch) },
  });
  return getEmployee(tx, tenant, employeeId);
}

export async function deleteEmployee(tx: Tx, tenant: TenantContext, employeeId: string, meta: RequestMeta) {
  const [employee] = await tx
    .select({ id: employees.id, code: employees.code })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.companyId, tenant.company.id)))
    .limit(1)
    .for("update");
  if (!employee) throw notFound("Xodim topilmadi");

  const [usage] = await tx
    .select({
      used: sql<boolean>`exists (select 1 from ${attendances} where ${attendances.employeeId} = ${employeeId})
        or exists (select 1 from ${leaves} where ${leaves.employeeId} = ${employeeId})
        or exists (select 1 from ${salaryPayments} where ${salaryPayments.employeeId} = ${employeeId})`,
    })
    .from(sql`(select 1) as probe`);
  if (usage?.used) throw conflict("Xodimning davomat, ta'til yoki maosh tarixi bor — ishdan bo'shating");

  await tx.delete(employees).where(eq(employees.id, employeeId));
  await hrAudit(tx, tenant, meta, {
    action: "EMPLOYEE_DELETED",
    resource: "employees",
    resourceId: employeeId,
    details: { code: employee.code },
  });
}
