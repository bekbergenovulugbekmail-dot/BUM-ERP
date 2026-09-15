/**
 * "Sotuv agenti qo'shish" — bitta tranzaksiyada:
 *   1. tizim foydalanuvchisi (login — telefon, parol argon2id hash, auditga yozilmaydi)
 *   2. kompaniya a'zoligi "Sotuv agenti" roli bilan (standart filial)
 *   3. HR xodimi (lavozim "Sotuv agenti", bo'lim "Savdo" — bo'lmasa yaratiladi), foydalanuvchiga bog'langan
 *   4. savdo agenti profili (hudud, oylik plan, supervayzer), xodim va foydalanuvchiga bog'langan
 * Takror telefon — 409, hech narsa yaratilmaydi. Faolsizlantirish: agent, xodim ("ishdan bo'shatilgan") va login
 * birga bloklanadi (`setMemberAccess`), qayta faollashtirish — birga ochiladi.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { FULL_ACCESS_ROLES, badRequest, notFound } from "@bum/shared";
import { salesReps } from "../../db/schema/crm.js";
import { departments, employees, positions } from "../../db/schema/hr.js";
import { companyMembers, roles, users } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import type { TenantContext } from "../company/tenant.js";
import { createSalesRep } from "../distribution/sales-reps.service.js";
import { todayIso } from "../finance/cash.service.js";
import { createEmployee as createHrEmployee } from "../hr/employees.service.js";
import { setMemberAccess } from "../users/member-access.js";
import { endActiveSessions } from "./work-session.repo.js";
import { createEmployee as createAccount } from "../users/user-admin.service.js";

export const SALES_AGENT_ROLE = "Sotuv agenti";
const SALES_DEPARTMENT = { code: "SAVDO", name: "Savdo" };
const SALES_POSITION = "Sotuv agenti";

export type NewSalesAgentInput = {
  name: string;
  phone: string;
  password: string;
  region?: string | null;
  supervisorUserId?: string | null;
  monthlyTarget?: string;
  hireDate?: string;
};

function audit(tx: Tx, tenant: TenantContext, meta: RequestMeta, action: string, resourceId: string, details: Record<string, unknown>) {
  return writeAuditLog(
    { userId: tenant.user.id, userName: tenant.user.name, companyId: tenant.company.id, action, resource: "sales_reps", resourceId, details, ...meta },
    tx,
  );
}

/** "Savdo" bo'limi va "Sotuv agenti" lavozimi — bo'lmasa yaratiladi. */
async function salesPosition(tx: Tx, companyId: string) {
  let [department] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.companyId, companyId), eq(departments.code, SALES_DEPARTMENT.code)))
    .limit(1);
  if (!department) {
    [department] = await tx.insert(departments).values({ companyId, ...SALES_DEPARTMENT }).returning({ id: departments.id });
  }
  let [position] = await tx
    .select({ id: positions.id })
    .from(positions)
    .where(and(eq(positions.companyId, companyId), eq(positions.departmentId, department!.id), eq(positions.name, SALES_POSITION)))
    .limit(1);
  if (!position) {
    [position] = await tx
      .insert(positions)
      .values({ companyId, departmentId: department!.id, name: SALES_POSITION })
      .returning({ id: positions.id });
  }
  return { departmentId: department!.id, positionId: position!.id };
}

/** Kompaniyaning faol a'zosi — supervayzer sifatida tanlanadi. */
async function assertSupervisor(conn: DbOrTx, companyId: string, userId: string) {
  const [member] = await conn
    .select({ id: companyMembers.id })
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId), eq(companyMembers.isActive, true)))
    .limit(1);
  if (!member) throw badRequest("Supervayzer kompaniyaning faol a'zosi emas");
}

const supervisorUser = alias(users, "supervisor_user");

const teamFields = {
  id: salesReps.id,
  code: salesReps.code,
  name: salesReps.name,
  phone: salesReps.phone,
  region: salesReps.region,
  monthlyTarget: salesReps.monthlyTarget,
  isActive: salesReps.isActive,
  userId: salesReps.userId,
  employeeId: salesReps.employeeId,
  employeeCode: employees.code,
  employeeStatus: employees.status,
  positionName: positions.name,
  supervisorUserId: salesReps.supervisorUserId,
  supervisorName: supervisorUser.name,
  loginActive: sql<boolean>`coalesce(${users.isActive} and ${companyMembers.isActive}, false)`,
};

function teamQuery(conn: DbOrTx) {
  return conn
    .select(teamFields)
    .from(salesReps)
    .leftJoin(employees, eq(employees.id, salesReps.employeeId))
    .leftJoin(positions, eq(positions.id, employees.positionId))
    .leftJoin(users, eq(users.id, salesReps.userId))
    .leftJoin(companyMembers, and(eq(companyMembers.userId, salesReps.userId), eq(companyMembers.companyId, salesReps.companyId)))
    .leftJoin(supervisorUser, eq(supervisorUser.id, salesReps.supervisorUserId));
}

export function listTeam(conn: DbOrTx, tenant: TenantContext) {
  return teamQuery(conn).where(eq(salesReps.companyId, tenant.company.id)).orderBy(asc(salesReps.name));
}

async function teamMember(conn: DbOrTx, companyId: string, salesRepId: string) {
  const [row] = await teamQuery(conn)
    .where(and(eq(salesReps.id, salesRepId), eq(salesReps.companyId, companyId)))
    .limit(1);
  if (!row) throw notFound("Savdo agenti topilmadi");
  return row;
}

/** Supervayzer tanlash uchun: `sales_agent.supervise` ruxsati bor yoki to'liq huquqli faol a'zolar. */
export async function supervisorCandidates(conn: DbOrTx, companyId: string) {
  const rows = await conn
    .select({
      userId: users.id,
      name: users.name,
      phone: users.phone,
      companyRole: companyMembers.companyRole,
      permissions: roles.permissions,
    })
    .from(companyMembers)
    .innerJoin(users, eq(users.id, companyMembers.userId))
    .leftJoin(
      roles,
      sql`(${companyMembers.roleId} is not null and ${roles.id} = ${companyMembers.roleId})
        or (${companyMembers.roleId} is null and ${roles.name} = ${companyMembers.companyRole}
            and (${roles.companyId} = ${companyId} or ${roles.companyId} is null))`,
    )
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.isActive, true), eq(users.isActive, true)));
  const seen = new Set<string>();
  return rows
    .filter((row) => (FULL_ACCESS_ROLES as readonly string[]).includes(row.companyRole) || row.permissions?.includes("sales_agent.supervise"))
    .filter((row) => !seen.has(row.userId) && Boolean(seen.add(row.userId)))
    .map(({ permissions: _permissions, ...row }) => row);
}

export async function createSalesAgent(tx: Tx, tenant: TenantContext, input: NewSalesAgentInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  if (input.supervisorUserId) await assertSupervisor(tx, companyId, input.supervisorUserId);

  // 1–2. Login va a'zolik (telefon normallashtiriladi, parol siyosati va takror telefon tekshiriladi)
  const { user } = await createAccount(
    tx,
    tenant.user,
    { id: companyId, name: tenant.company.name },
    { name: input.name, phone: input.phone, password: input.password, role: SALES_AGENT_ROLE },
    meta,
  );

  // 3. HR xodimi
  const { departmentId, positionId } = await salesPosition(tx, companyId);
  const employee = await createHrEmployee(
    tx,
    tenant,
    {
      name: input.name.trim(),
      phone: user.phone,
      userId: user.id,
      departmentId,
      positionId,
      hireDate: input.hireDate ?? todayIso(),
      baseSalary: "0",
      salaryType: "monthly",
    },
    meta,
  );

  // 4. Agent profili
  const rep = await createSalesRep(
    tx,
    tenant,
    { name: input.name.trim(), phone: user.phone, userId: user.id, region: input.region ?? null, monthlyTarget: input.monthlyTarget ?? "0" },
    meta,
  );
  await tx
    .update(salesReps)
    .set({ employeeId: employee.id, supervisorUserId: input.supervisorUserId ?? null, updatedAt: new Date() })
    .where(eq(salesReps.id, rep.id));

  await audit(tx, tenant, meta, "SALES_AGENT_CREATED", rep.id, {
    userId: user.id,
    employeeId: employee.id,
    phone: user.phone,
    region: input.region ?? null,
    supervisorUserId: input.supervisorUserId ?? null,
  });
  return teamMember(tx, companyId, rep.id);
}

export type TeamPatch = {
  name?: string;
  region?: string | null;
  supervisorUserId?: string | null;
  monthlyTarget?: string;
  isActive?: boolean;
};

export async function updateTeamMember(tx: Tx, tenant: TenantContext, salesRepId: string, patch: TeamPatch, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const [rep] = await tx
    .select({ id: salesReps.id, userId: salesReps.userId, employeeId: salesReps.employeeId, isActive: salesReps.isActive })
    .from(salesReps)
    .where(and(eq(salesReps.id, salesRepId), eq(salesReps.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!rep) throw notFound("Savdo agenti topilmadi");
  if (patch.supervisorUserId) await assertSupervisor(tx, companyId, patch.supervisorUserId);

  const { isActive, ...fields } = patch;
  await tx
    .update(salesReps)
    .set({ ...fields, ...(isActive !== undefined ? { isActive } : {}), updatedAt: new Date() })
    .where(eq(salesReps.id, rep.id));

  if (isActive !== undefined && isActive !== rep.isActive) {
    if (rep.employeeId) {
      await tx
        .update(employees)
        .set({ status: isActive ? "active" : "terminated", updatedAt: new Date() })
        .where(eq(employees.id, rep.employeeId));
    }
    if (rep.userId) await setMemberAccess(tx, companyId, rep.userId, isActive, { agentRole: { role: SALES_AGENT_ROLE, tenant } });
    if (!isActive) await endActiveSessions(tx, [rep.id], "deactivated");
  }
  await audit(tx, tenant, meta, isActive === false ? "SALES_AGENT_DEACTIVATED" : isActive === true ? "SALES_AGENT_ACTIVATED" : "SALES_AGENT_UPDATED", rep.id, {
    changes: Object.keys(patch),
  });
  return teamMember(tx, companyId, rep.id);
}
