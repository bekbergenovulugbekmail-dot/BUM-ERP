/**
 * Bo'limlar va lavozimlar (convex/hr/employees.ts: *Department, *Position).
 *
 * Convex'dan farqlar:
 *  - `createDepartment` ota bo'limni tekshirmasdi (boshqa kompaniyadan ham), sikl mumkin edi;
 *    bo'lim boshlig'ini tayinlab bo'lmasdi
 *  - xodimlari yoki ichki bo'limlari bor bo'lim, xodimi bor lavozim o'chirilardi — endi faolsizlantirish
 *  - lavozimni tahrirlab bo'lmasdi; `update` / `delete` to'xtatilgan kompaniyada ham yozardi
 *  - o'qish ruxsatsiz edi — `hr.view`
 */
import { and, asc, eq, getTableColumns, sql } from "drizzle-orm";
import { badRequest, conflict, notFound } from "@bum/shared";
import { departments, employees, positions } from "../../db/schema/hr.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import type { TenantContext } from "../company/tenant.js";

const { legacyId: _l1, companyId: _c1, ...departmentFields } = getTableColumns(departments);
const { legacyId: _l2, companyId: _c2, ...positionFields } = getTableColumns(positions);

export function hrAudit(
  tx: Tx,
  tenant: TenantContext,
  meta: RequestMeta,
  entry: { action: string; resource: string; resourceId: string; details: Record<string, unknown> },
) {
  return writeAuditLog(
    { userId: tenant.user.id, userName: tenant.user.name, companyId: tenant.company.id, ...entry, ...meta },
    tx,
  );
}

/** Bitta jadvalli so'rovda drizzle ustunni jadval nomisiz yozadi — ichki so'rovda tashqi ustun aniq ko'rsatiladi. */
const outerDepartmentId = sql.raw(`"departments"."id"`);

export async function assertDepartment(conn: DbOrTx, companyId: string, departmentId: string) {
  const [department] = await conn
    .select({ id: departments.id, isActive: departments.isActive })
    .from(departments)
    .where(and(eq(departments.id, departmentId), eq(departments.companyId, companyId)))
    .limit(1);
  if (!department) throw badRequest("Bo'lim topilmadi");
  return department;
}

async function assertManagerEmployee(conn: DbOrTx, companyId: string, employeeId: string) {
  const [employee] = await conn
    .select({ id: employees.id, status: employees.status })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.companyId, companyId)))
    .limit(1);
  if (!employee) throw badRequest("Xodim topilmadi");
  if (employee.status === "terminated") throw badRequest("Ishdan bo'shatilgan xodim rahbar bo'la olmaydi");
}

// ─── Bo'limlar ───────────────────────────────────────────────────────────────

export async function listDepartments(conn: DbOrTx, tenant: TenantContext, includeInactive = false) {
  return conn
    .select({
      ...departmentFields,
      employeeCount: sql<number>`(select count(*)::int from ${employees} where ${employees.departmentId} = ${outerDepartmentId} and ${employees.status} <> 'terminated')`,
      positionCount: sql<number>`(select count(*)::int from ${positions} where ${positions.departmentId} = ${outerDepartmentId})`,
    })
    .from(departments)
    .where(and(eq(departments.companyId, tenant.company.id), includeInactive ? undefined : eq(departments.isActive, true)))
    .orderBy(asc(departments.name));
}

export type DepartmentInput = { name: string; code: string; parentId?: string | null; managerId?: string | null };

export async function createDepartment(tx: Tx, tenant: TenantContext, input: DepartmentInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  if (input.parentId) await assertDepartment(tx, companyId, input.parentId);
  if (input.managerId) await assertManagerEmployee(tx, companyId, input.managerId);

  const [department] = await tx.insert(departments).values({ ...input, companyId }).returning(departmentFields);
  await hrAudit(tx, tenant, meta, {
    action: "DEPARTMENT_CREATED",
    resource: "departments",
    resourceId: department!.id,
    details: { code: department!.code, name: department!.name },
  });
  return department!;
}

export async function updateDepartment(
  tx: Tx,
  tenant: TenantContext,
  departmentId: string,
  patch: Partial<Omit<DepartmentInput, "code">> & { isActive?: boolean },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const [current] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.id, departmentId), eq(departments.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!current) throw notFound("Bo'lim topilmadi");

  if (patch.parentId) {
    let cursor: string | null = patch.parentId;
    for (let depth = 0; cursor; depth++) {
      if (cursor === departmentId) throw badRequest("Bo'lim o'ziga yoki ichki bo'limiga bo'ysuna olmaydi");
      if (depth > 50) throw badRequest("Bo'limlar ierarxiyasi juda chuqur");
      const [parent] = await tx
        .select({ parentId: departments.parentId })
        .from(departments)
        .where(and(eq(departments.id, cursor), eq(departments.companyId, companyId)))
        .limit(1);
      if (!parent) throw badRequest("Ota bo'lim topilmadi");
      cursor = parent.parentId;
    }
  }
  if (patch.managerId) await assertManagerEmployee(tx, companyId, patch.managerId);

  const [department] = await tx
    .update(departments)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(departments.id, departmentId))
    .returning(departmentFields);
  await hrAudit(tx, tenant, meta, {
    action: "DEPARTMENT_UPDATED",
    resource: "departments",
    resourceId: departmentId,
    details: { changes: Object.keys(patch) },
  });
  return department!;
}

export async function deleteDepartment(tx: Tx, tenant: TenantContext, departmentId: string, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const [department] = await tx
    .select({ id: departments.id, code: departments.code })
    .from(departments)
    .where(and(eq(departments.id, departmentId), eq(departments.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!department) throw notFound("Bo'lim topilmadi");

  const [usage] = await tx
    .select({
      used: sql<boolean>`exists (select 1 from ${employees} where ${employees.departmentId} = ${departmentId})
        or exists (select 1 from ${positions} where ${positions.departmentId} = ${departmentId})
        or exists (select 1 from ${departments} where ${departments.parentId} = ${departmentId})`,
    })
    .from(sql`(select 1) as probe`);
  if (usage?.used) throw conflict("Bo'limda xodimlar, lavozimlar yoki ichki bo'limlar bor — faolsizlantiring");

  await tx.delete(departments).where(eq(departments.id, departmentId));
  await hrAudit(tx, tenant, meta, {
    action: "DEPARTMENT_DELETED",
    resource: "departments",
    resourceId: departmentId,
    details: { code: department.code },
  });
}

// ─── Lavozimlar ──────────────────────────────────────────────────────────────

export async function listPositions(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { departmentId?: string; includeInactive?: boolean },
) {
  return conn
    .select({
      ...positionFields,
      departmentName: departments.name,
      employeeCount: sql<number>`(select count(*)::int from ${employees} where ${employees.positionId} = ${positions.id} and ${employees.status} <> 'terminated')`,
    })
    .from(positions)
    .innerJoin(departments, eq(departments.id, positions.departmentId))
    .where(
      and(
        eq(positions.companyId, tenant.company.id),
        options.departmentId ? eq(positions.departmentId, options.departmentId) : undefined,
        options.includeInactive ? undefined : eq(positions.isActive, true),
      ),
    )
    .orderBy(asc(departments.name), asc(positions.name));
}

export type PositionInput = {
  departmentId: string;
  name: string;
  level?: string | null;
  minSalary?: string | null;
  maxSalary?: string | null;
};

export async function createPosition(tx: Tx, tenant: TenantContext, input: PositionInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const department = await assertDepartment(tx, companyId, input.departmentId);
  if (!department.isActive) throw badRequest("Bo'lim faol emas");

  const [position] = await tx.insert(positions).values({ ...input, companyId }).returning(positionFields);
  await hrAudit(tx, tenant, meta, {
    action: "POSITION_CREATED",
    resource: "positions",
    resourceId: position!.id,
    details: { name: position!.name, departmentId: input.departmentId },
  });
  return position!;
}

export async function updatePosition(
  tx: Tx,
  tenant: TenantContext,
  positionId: string,
  patch: Partial<Omit<PositionInput, "departmentId">> & { isActive?: boolean },
  meta: RequestMeta,
) {
  const [position] = await tx
    .update(positions)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(positions.id, positionId), eq(positions.companyId, tenant.company.id)))
    .returning(positionFields);
  if (!position) throw notFound("Lavozim topilmadi");

  await hrAudit(tx, tenant, meta, {
    action: "POSITION_UPDATED",
    resource: "positions",
    resourceId: positionId,
    details: { changes: Object.keys(patch) },
  });
  return position;
}

export async function deletePosition(tx: Tx, tenant: TenantContext, positionId: string, meta: RequestMeta) {
  const [position] = await tx
    .select({ id: positions.id, name: positions.name })
    .from(positions)
    .where(and(eq(positions.id, positionId), eq(positions.companyId, tenant.company.id)))
    .limit(1)
    .for("update");
  if (!position) throw notFound("Lavozim topilmadi");

  const [used] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.positionId, positionId)).limit(1);
  if (used) throw conflict("Lavozimda xodimlar bor — faolsizlantiring");

  await tx.delete(positions).where(eq(positions.id, positionId));
  await hrAudit(tx, tenant, meta, {
    action: "POSITION_DELETED",
    resource: "positions",
    resourceId: positionId,
    details: { name: position.name },
  });
}
