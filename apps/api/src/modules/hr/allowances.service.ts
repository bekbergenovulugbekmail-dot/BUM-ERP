/**
 * Xodimga biriktirilgan muntazam qo'shimcha to'lovlar: yo'l puli, ovqat puli, aloqa va boshqalar.
 *
 * Davri oylarda: `startMonth` dan `endMonth` gacha ("2026-01" ko'rinishida; `endMonth` bo'sh — muddatsiz).
 * Maosh tayyorlashda shu davrga tushgan to'lovlar avtomatik qo'shiladi (soliqqa kirmaydi — bu kompensatsiya).
 */
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { badRequest, notFound } from "@bum/shared";
import { employeeAllowances, employees } from "../../db/schema/hr.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { toMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { hrAudit } from "./org.service.js";

export type AllowanceKind = (typeof employeeAllowances.kind.enumValues)[number];

export const ALLOWANCE_LABELS: Record<AllowanceKind, string> = {
  transport: "Yo'l puli",
  meal: "Ovqat puli",
  phone: "Aloqa",
  housing: "Turar joy",
  other: "Boshqa",
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export type AllowanceInput = {
  employeeId: string;
  kind: AllowanceKind;
  label?: string | null;
  amount: string;
  startMonth: string;
  endMonth?: string | null;
  notes?: string | null;
  isActive?: boolean;
};

function assertPeriod(startMonth: string, endMonth: string | null | undefined) {
  if (!MONTH.test(startMonth)) throw badRequest("Boshlanish oyi YYYY-MM ko'rinishida bo'lishi kerak");
  if (endMonth) {
    if (!MONTH.test(endMonth)) throw badRequest("Tugash oyi YYYY-MM ko'rinishida bo'lishi kerak");
    if (endMonth < startMonth) throw badRequest("Tugash oyi boshlanish oyidan oldin bo'lmaydi");
  }
}

async function assertEmployee(conn: DbOrTx, companyId: string, employeeId: string) {
  const [employee] = await conn
    .select({ id: employees.id, name: employees.name })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.companyId, companyId)))
    .limit(1);
  if (!employee) throw notFound("Xodim topilmadi");
  return employee;
}

export function listAllowances(conn: DbOrTx, tenant: TenantContext, filters: { employeeId?: string; month?: string } = {}) {
  const conditions = [eq(employeeAllowances.companyId, tenant.company.id)];
  if (filters.employeeId) conditions.push(eq(employeeAllowances.employeeId, filters.employeeId));
  if (filters.month) {
    if (!MONTH.test(filters.month)) throw badRequest("Oy YYYY-MM ko'rinishida bo'lishi kerak");
    conditions.push(eq(employeeAllowances.isActive, true));
    conditions.push(sql`${employeeAllowances.startMonth} <= ${filters.month}`);
    conditions.push(or(isNull(employeeAllowances.endMonth), sql`${employeeAllowances.endMonth} >= ${filters.month}`)!);
  }
  return conn
    .select({
      id: employeeAllowances.id,
      employeeId: employeeAllowances.employeeId,
      employeeName: employees.name,
      kind: employeeAllowances.kind,
      label: employeeAllowances.label,
      amount: employeeAllowances.amount,
      startMonth: employeeAllowances.startMonth,
      endMonth: employeeAllowances.endMonth,
      isActive: employeeAllowances.isActive,
      notes: employeeAllowances.notes,
      createdAt: employeeAllowances.createdAt,
    })
    .from(employeeAllowances)
    .innerJoin(employees, eq(employees.id, employeeAllowances.employeeId))
    .where(and(...conditions))
    .orderBy(asc(employees.name), asc(employeeAllowances.startMonth));
}

/** Shu oyga tegishli to'lovlar yig'indisi — xodim bo'yicha (maosh tayyorlashda ishlatiladi). */
export async function allowanceTotalsForMonth(conn: DbOrTx, companyId: string, month: string) {
  const rows = await conn
    .select({ employeeId: employeeAllowances.employeeId, amount: employeeAllowances.amount })
    .from(employeeAllowances)
    .where(
      and(
        eq(employeeAllowances.companyId, companyId),
        eq(employeeAllowances.isActive, true),
        sql`${employeeAllowances.startMonth} <= ${month}`,
        or(isNull(employeeAllowances.endMonth), sql`${employeeAllowances.endMonth} >= ${month}`),
      ),
    );
  const totals = new Map<string, bigint>();
  for (const row of rows) {
    totals.set(row.employeeId, (totals.get(row.employeeId) ?? 0n) + toMinor(row.amount));
  }
  return totals;
}

export async function createAllowance(tx: Tx, tenant: TenantContext, input: AllowanceInput, meta: RequestMeta) {
  assertPeriod(input.startMonth, input.endMonth);
  const employee = await assertEmployee(tx, tenant.company.id, input.employeeId);
  if (toMinor(input.amount) <= 0n) throw badRequest("Summa musbat bo'lishi kerak");
  if (input.kind === "other" && !input.label?.trim()) throw badRequest("«Boshqa» uchun nom kiriting");

  const [created] = await tx
    .insert(employeeAllowances)
    .values({
      companyId: tenant.company.id,
      employeeId: input.employeeId,
      kind: input.kind,
      label: input.label?.trim() || null,
      amount: input.amount,
      startMonth: input.startMonth,
      endMonth: input.endMonth ?? null,
      isActive: input.isActive ?? true,
      notes: input.notes ?? null,
      createdBy: tenant.user.id,
    })
    .returning();

  await hrAudit(tx, tenant, meta, {
    action: "ALLOWANCE_CREATED",
    resource: "employee_allowances",
    resourceId: created!.id,
    details: { employee: employee.name, kind: input.kind, amount: input.amount, startMonth: input.startMonth, endMonth: input.endMonth ?? null },
  });
  return created!;
}

export async function updateAllowance(
  tx: Tx,
  tenant: TenantContext,
  allowanceId: string,
  patch: Partial<Omit<AllowanceInput, "employeeId">>,
  meta: RequestMeta,
) {
  const [current] = await tx
    .select()
    .from(employeeAllowances)
    .where(and(eq(employeeAllowances.id, allowanceId), eq(employeeAllowances.companyId, tenant.company.id)))
    .limit(1);
  if (!current) throw notFound("Qo'shimcha to'lov topilmadi");

  const startMonth = patch.startMonth ?? current.startMonth;
  const endMonth = patch.endMonth === undefined ? current.endMonth : patch.endMonth;
  assertPeriod(startMonth, endMonth);
  if (patch.amount !== undefined && toMinor(patch.amount) <= 0n) throw badRequest("Summa musbat bo'lishi kerak");
  const kind = patch.kind ?? current.kind;
  const label = patch.label === undefined ? current.label : patch.label?.trim() || null;
  if (kind === "other" && !label) throw badRequest("«Boshqa» uchun nom kiriting");

  const [updated] = await tx
    .update(employeeAllowances)
    .set({
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.label !== undefined ? { label } : {}),
      ...(patch.amount !== undefined ? { amount: patch.amount } : {}),
      startMonth,
      endMonth,
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      updatedAt: new Date(),
    })
    .where(eq(employeeAllowances.id, allowanceId))
    .returning();

  await hrAudit(tx, tenant, meta, {
    action: "ALLOWANCE_UPDATED",
    resource: "employee_allowances",
    resourceId: allowanceId,
    details: { kind, amount: updated!.amount, startMonth, endMonth, isActive: updated!.isActive },
  });
  return updated!;
}

export async function deleteAllowance(tx: Tx, tenant: TenantContext, allowanceId: string, meta: RequestMeta) {
  const [deleted] = await tx
    .delete(employeeAllowances)
    .where(and(eq(employeeAllowances.id, allowanceId), eq(employeeAllowances.companyId, tenant.company.id)))
    .returning({ id: employeeAllowances.id, kind: employeeAllowances.kind, employeeId: employeeAllowances.employeeId });
  if (!deleted) throw notFound("Qo'shimcha to'lov topilmadi");
  await hrAudit(tx, tenant, meta, {
    action: "ALLOWANCE_DELETED",
    resource: "employee_allowances",
    resourceId: allowanceId,
    details: { kind: deleted.kind, employeeId: deleted.employeeId },
  });
}
