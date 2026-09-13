/**
 * "Dostavka agenti qo'shish" — bitta tranzaksiyada:
 *   1. tizim foydalanuvchisi (login — telefon, parol argon2id hash; parol auditga yozilmaydi)
 *   2. kompaniya a'zoligi "Dostavka agenti" roli bilan
 *   3. HR xodimi (bo'lim "Logistika", lavozim "Dostavka agenti" — bo'lmasa yaratiladi), foydalanuvchiga bog'langan
 *   4. yetkazuvchi profili (filial, hudud, zona, transport, yuk sig'imi, ish jadvali, supervayzer)
 * Takror telefon — 409, hech narsa yaratilmaydi. Ism va telefon foydalanuvchida — profil ularni takrorlamaydi.
 * Faolsizlantirish: profil, xodim ("ishdan bo'shatilgan") va login birga bloklanadi, ish sessiyasi yopiladi;
 * agentda yakunlanmagan yetkazma bo'lsa — avval boshqa agentga o'tkaziladi (409).
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { AppError, FULL_ACCESS_ROLES, OPEN_DELIVERY_STATUSES, badRequest, notFound, type DeliveryVehicleType } from "@bum/shared";
import { deliveryAgents, deliveryTasks, type DeliveryWorkingSchedule } from "../../db/schema/delivery.js";
import { departments, employees, positions } from "../../db/schema/hr.js";
import { branches, companyMembers, roles, users } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { nextDocumentNumber } from "../../shared/numbering.js";
import type { TenantContext } from "../company/tenant.js";
import { todayIso } from "../finance/cash.service.js";
import { createEmployee as createHrEmployee } from "../hr/employees.service.js";
import { createEmployee as createAccount } from "../users/user-admin.service.js";
import { setMemberAccess } from "../users/member-access.js";
import { publishDeliveryEvent } from "./realtime-bus.js";
import { endDeliverySessions } from "./work-session.repo.js";

export const DELIVERY_AGENT_ROLE = "Dostavka agenti";
const LOGISTICS_DEPARTMENT = { code: "LOGISTIKA", name: "Logistika" };
const DELIVERY_POSITION = "Dostavka agenti";

type ProfileFields = {
  supervisorUserId?: string | null;
  branchId?: string | null;
  territory?: string | null;
  deliveryZone?: string | null;
  vehicleType?: DeliveryVehicleType | null;
  vehicleNumber?: string | null;
  maxLoadKg?: string | null;
  workingSchedule?: DeliveryWorkingSchedule | null;
  notes?: string | null;
};

export type NewDeliveryAgentInput = ProfileFields & { name: string; phone: string; password: string; hireDate?: string };
export type DeliveryAgentPatch = ProfileFields & { isActive?: boolean };

function audit(tx: Tx, tenant: TenantContext, meta: RequestMeta, action: string, resourceId: string, details: Record<string, unknown>) {
  return writeAuditLog(
    { userId: tenant.user.id, userName: tenant.user.name, companyId: tenant.company.id, action, resource: "delivery_agents", resourceId, details, ...meta },
    tx,
  );
}

async function logisticsPosition(tx: Tx, companyId: string) {
  let [department] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.companyId, companyId), eq(departments.code, LOGISTICS_DEPARTMENT.code)))
    .limit(1);
  if (!department) {
    [department] = await tx.insert(departments).values({ companyId, ...LOGISTICS_DEPARTMENT }).returning({ id: departments.id });
  }
  let [position] = await tx
    .select({ id: positions.id })
    .from(positions)
    .where(and(eq(positions.companyId, companyId), eq(positions.departmentId, department!.id), eq(positions.name, DELIVERY_POSITION)))
    .limit(1);
  if (!position) {
    [position] = await tx.insert(positions).values({ companyId, departmentId: department!.id, name: DELIVERY_POSITION }).returning({ id: positions.id });
  }
  return { departmentId: department!.id, positionId: position!.id };
}

async function assertProfileReferences(conn: DbOrTx, companyId: string, fields: ProfileFields) {
  if (fields.supervisorUserId) {
    const [member] = await conn
      .select({ id: companyMembers.id })
      .from(companyMembers)
      .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, fields.supervisorUserId), eq(companyMembers.isActive, true)))
      .limit(1);
    if (!member) throw badRequest("Supervayzer kompaniyaning faol a'zosi emas");
  }
  if (fields.branchId) {
    const [branch] = await conn
      .select({ isActive: branches.isActive })
      .from(branches)
      .where(and(eq(branches.id, fields.branchId), eq(branches.companyId, companyId)))
      .limit(1);
    if (!branch) throw badRequest("Filial topilmadi");
    if (!branch.isActive) throw badRequest("Filial faol emas");
  }
}

const supervisorUser = alias(users, "delivery_supervisor_user");

export const deliveryAgentFields = {
  id: deliveryAgents.id,
  code: deliveryAgents.code,
  name: users.name,
  phone: users.phone,
  userId: deliveryAgents.userId,
  employeeId: deliveryAgents.employeeId,
  employeeCode: employees.code,
  employeeStatus: employees.status,
  supervisorUserId: deliveryAgents.supervisorUserId,
  supervisorName: supervisorUser.name,
  branchId: deliveryAgents.branchId,
  branchName: branches.name,
  territory: deliveryAgents.territory,
  deliveryZone: deliveryAgents.deliveryZone,
  vehicleType: deliveryAgents.vehicleType,
  vehicleNumber: deliveryAgents.vehicleNumber,
  maxLoadKg: deliveryAgents.maxLoadKg,
  workingSchedule: deliveryAgents.workingSchedule,
  notes: deliveryAgents.notes,
  isActive: deliveryAgents.isActive,
  loginActive: sql<boolean>`coalesce(${users.isActive} and ${companyMembers.isActive}, false)`,
  createdAt: deliveryAgents.createdAt,
};

function agentQuery(conn: DbOrTx) {
  return conn
    .select(deliveryAgentFields)
    .from(deliveryAgents)
    .innerJoin(users, eq(users.id, deliveryAgents.userId))
    .leftJoin(employees, eq(employees.id, deliveryAgents.employeeId))
    .leftJoin(branches, eq(branches.id, deliveryAgents.branchId))
    .leftJoin(companyMembers, and(eq(companyMembers.userId, deliveryAgents.userId), eq(companyMembers.companyId, deliveryAgents.companyId)))
    .leftJoin(supervisorUser, eq(supervisorUser.id, deliveryAgents.supervisorUserId));
}

export function listDeliveryAgents(conn: DbOrTx, tenant: TenantContext, options: { activeOnly?: boolean; branchId?: string; territory?: string } = {}) {
  return agentQuery(conn)
    .where(
      and(
        eq(deliveryAgents.companyId, tenant.company.id),
        options.activeOnly ? eq(deliveryAgents.isActive, true) : undefined,
        options.branchId ? eq(deliveryAgents.branchId, options.branchId) : undefined,
        options.territory ? eq(deliveryAgents.territory, options.territory) : undefined,
      ),
    )
    .orderBy(asc(users.name));
}

export async function getDeliveryAgent(conn: DbOrTx, companyId: string, deliveryAgentId: string) {
  const [row] = await agentQuery(conn)
    .where(and(eq(deliveryAgents.id, deliveryAgentId), eq(deliveryAgents.companyId, companyId)))
    .limit(1);
  if (!row) throw notFound("Yetkazuvchi agent topilmadi");
  return row;
}

/** Supervayzer tanlash uchun: `delivery.assign` ruxsati bor yoki to'liq huquqli faol a'zolar. */
export async function deliverySupervisorCandidates(conn: DbOrTx, companyId: string) {
  const rows = await conn
    .select({ userId: users.id, name: users.name, phone: users.phone, companyRole: companyMembers.companyRole, permissions: roles.permissions })
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
    .filter((row) => (FULL_ACCESS_ROLES as readonly string[]).includes(row.companyRole) || row.permissions?.includes("delivery.assign"))
    .filter((row) => !seen.has(row.userId) && Boolean(seen.add(row.userId)))
    .map(({ permissions: _permissions, ...row }) => row);
}

export async function createDeliveryAgent(tx: Tx, tenant: TenantContext, input: NewDeliveryAgentInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  await assertProfileReferences(tx, companyId, input);

  // 1–2. Login va a'zolik (telefon normallashtiriladi, parol siyosati va takror telefon tekshiriladi)
  const { user } = await createAccount(
    tx,
    tenant.user,
    { id: companyId, name: tenant.company.name },
    { name: input.name, phone: input.phone, password: input.password, role: DELIVERY_AGENT_ROLE },
    meta,
  );
  if (input.branchId) {
    await tx
      .update(companyMembers)
      .set({ branchId: input.branchId, updatedAt: new Date() })
      .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, user.id)));
  }

  // 3. HR xodimi
  const { departmentId, positionId } = await logisticsPosition(tx, companyId);
  const employee = await createHrEmployee(
    tx,
    tenant,
    { name: input.name.trim(), phone: user.phone, userId: user.id, departmentId, positionId, hireDate: input.hireDate ?? todayIso(), baseSalary: "0", salaryType: "monthly" },
    meta,
  );

  // 4. Yetkazuvchi profili
  const code = await nextDocumentNumber(tx, {
    table: deliveryAgents,
    column: deliveryAgents.code,
    companyColumn: deliveryAgents.companyId,
    companyId,
    prefix: "DA-",
    width: 3,
  });
  const [agent] = await tx
    .insert(deliveryAgents)
    .values({
      companyId,
      userId: user.id,
      employeeId: employee.id,
      code,
      supervisorUserId: input.supervisorUserId ?? null,
      branchId: input.branchId ?? null,
      territory: input.territory ?? null,
      deliveryZone: input.deliveryZone ?? null,
      vehicleType: input.vehicleType ?? null,
      vehicleNumber: input.vehicleNumber ?? null,
      maxLoadKg: input.maxLoadKg ?? null,
      workingSchedule: input.workingSchedule ?? null,
      notes: input.notes ?? null,
    })
    .returning({ id: deliveryAgents.id });

  await audit(tx, tenant, meta, "DELIVERY_AGENT_CREATED", agent!.id, {
    userId: user.id,
    employeeId: employee.id,
    phone: user.phone,
    code,
    branchId: input.branchId ?? null,
    territory: input.territory ?? null,
    supervisorUserId: input.supervisorUserId ?? null,
  });
  await publishDeliveryEvent(tx, { type: "agents", companyId });
  return getDeliveryAgent(tx, companyId, agent!.id);
}

export async function updateDeliveryAgent(tx: Tx, tenant: TenantContext, deliveryAgentId: string, patch: DeliveryAgentPatch, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const [agent] = await tx
    .select({ id: deliveryAgents.id, userId: deliveryAgents.userId, employeeId: deliveryAgents.employeeId, isActive: deliveryAgents.isActive })
    .from(deliveryAgents)
    .where(and(eq(deliveryAgents.id, deliveryAgentId), eq(deliveryAgents.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!agent) throw notFound("Yetkazuvchi agent topilmadi");
  await assertProfileReferences(tx, companyId, patch);

  const { isActive, ...fields } = patch;
  if (isActive === false && agent.isActive) {
    const [open] = await tx
      .select({ id: deliveryTasks.id, number: deliveryTasks.number })
      .from(deliveryTasks)
      .where(and(eq(deliveryTasks.deliveryAgentId, agent.id), inArray(deliveryTasks.status, [...OPEN_DELIVERY_STATUSES])))
      .limit(1);
    if (open) {
      throw new AppError("CONFLICT", `Agentda yakunlanmagan yetkazma bor (${open.number}) — avval boshqa agentga o'tkazing`, {
        reason: "open_tasks",
        taskId: open.id,
      });
    }
  }

  await tx
    .update(deliveryAgents)
    .set({ ...fields, ...(isActive !== undefined ? { isActive } : {}), updatedAt: new Date() })
    .where(eq(deliveryAgents.id, agent.id));
  if (fields.branchId !== undefined) {
    await tx
      .update(companyMembers)
      .set({ branchId: fields.branchId, updatedAt: new Date() })
      .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, agent.userId)));
  }

  if (isActive !== undefined && isActive !== agent.isActive) {
    if (agent.employeeId) {
      await tx
        .update(employees)
        .set({ status: isActive ? "active" : "terminated", updatedAt: new Date() })
        .where(eq(employees.id, agent.employeeId));
    }
    await setMemberAccess(tx, companyId, agent.userId, isActive);
    if (!isActive) await endDeliverySessions(tx, [agent.id], "deactivated");
  }
  await audit(
    tx,
    tenant,
    meta,
    isActive === false ? "DELIVERY_AGENT_DEACTIVATED" : isActive === true ? "DELIVERY_AGENT_ACTIVATED" : "DELIVERY_AGENT_UPDATED",
    agent.id,
    { changes: Object.keys(patch) },
  );
  await publishDeliveryEvent(tx, { type: "agents", companyId });
  return getDeliveryAgent(tx, companyId, agent.id);
}
