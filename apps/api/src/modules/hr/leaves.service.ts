/**
 * Ta'tillar (convex/hr/salary.ts: *Leave).
 *
 * Holatlar: pending → approved | rejected (qaror yakuniy).
 *
 * Convex'dan farqlar:
 *  - `approvedBy` mijozdan kelardi (istalgan xodim ID si) — endi qaror qilgan foydalanuvchining xodim yozuvi
 *  - istalgan holatdan istalganiga o'tkazilardi (rad etilgani tasdiqlanardi)
 *  - kunlar soni sanalar oralig'i bilan tekshirilmasdi; bir xodimning ta'tillari ustma-ust tushardi
 *  - ishdan bo'shatilgan xodimga ta'til yozilardi; o'qish ruxsatsiz edi
 */
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { badRequest, conflict, forbidden, notFound } from "@bum/shared";
import { employees, leaves } from "../../db/schema/hr.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { toMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { todayIso } from "../finance/cash.service.js";
import { hrAudit } from "./org.service.js";

export type LeaveType = (typeof leaves.type.enumValues)[number];
export type LeaveStatus = (typeof leaves.status.enumValues)[number];

function inclusiveDays(start: string, end: string) {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
}

export async function listLeaves(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { employeeId?: string; status?: LeaveStatus; limit: number },
) {
  return conn
    .select({
      id: leaves.id,
      employeeId: leaves.employeeId,
      type: leaves.type,
      startDate: leaves.startDate,
      endDate: leaves.endDate,
      days: leaves.days,
      status: leaves.status,
      reason: leaves.reason,
      approvedBy: leaves.approvedBy,
      notes: leaves.notes,
      createdAt: leaves.createdAt,
      employeeName: employees.name,
    })
    .from(leaves)
    .innerJoin(employees, eq(employees.id, leaves.employeeId))
    .where(
      and(
        eq(leaves.companyId, tenant.company.id),
        options.employeeId ? eq(leaves.employeeId, options.employeeId) : undefined,
        options.status ? eq(leaves.status, options.status) : undefined,
      ),
    )
    .orderBy(desc(leaves.startDate), desc(leaves.createdAt))
    .limit(options.limit);
}

export async function createLeave(
  tx: Tx,
  tenant: TenantContext,
  input: {
    employeeId: string;
    type: LeaveType;
    startDate: string;
    endDate: string;
    days?: string;
    reason?: string | null;
    notes?: string | null;
  },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  // Xodim qatori qulflanadi — parallel so'rovlar ustma-ust ta'til yarata olmaydi
  const [employee] = await tx
    .select({ id: employees.id, status: employees.status })
    .from(employees)
    .where(and(eq(employees.id, input.employeeId), eq(employees.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!employee) throw badRequest("Xodim topilmadi");
  if (employee.status === "terminated") throw badRequest("Ishdan bo'shatilgan xodimga ta'til berilmaydi");
  if (input.endDate < input.startDate) throw badRequest("Tugash sanasi boshlanishdan oldin");

  const span = inclusiveDays(input.startDate, input.endDate);
  const days = input.days ?? String(span);
  if (toMinor(days, 4) <= 0n || toMinor(days, 4) > BigInt(span) * 10000n) {
    throw badRequest(`Kunlar soni 0 dan katta va ${span} dan oshmasligi kerak`);
  }

  const [overlap] = await tx
    .select({ id: leaves.id })
    .from(leaves)
    .where(
      and(
        eq(leaves.employeeId, employee.id),
        inArray(leaves.status, ["pending", "approved"]),
        lte(leaves.startDate, input.endDate),
        gte(leaves.endDate, input.startDate),
      ),
    )
    .limit(1);
  if (overlap) throw conflict("Bu oraliqda xodimning boshqa ta'tili bor");

  const [leave] = await tx
    .insert(leaves)
    .values({ ...input, days, companyId })
    .returning();
  await hrAudit(tx, tenant, meta, {
    action: "LEAVE_CREATED",
    resource: "leaves",
    resourceId: leave!.id,
    details: { employeeId: employee.id, type: input.type, startDate: input.startDate, endDate: input.endDate },
  });
  const { legacyId: _l, companyId: _c, ...result } = leave!;
  return result;
}

export async function decideLeave(
  tx: Tx,
  tenant: TenantContext,
  leaveId: string,
  input: { status: "approved" | "rejected"; notes?: string | null },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const [leave] = await tx
    .select()
    .from(leaves)
    .where(and(eq(leaves.id, leaveId), eq(leaves.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!leave) throw notFound("Ta'til topilmadi");
  if (leave.status !== "pending") throw badRequest("Qaror allaqachon qabul qilingan");

  const [approver] = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.companyId, companyId), eq(employees.userId, tenant.user.id)))
    .limit(1);
  // Vazifalar ajratimi: o'z ta'tilini o'zi tasdiqlamaydi (kompaniya egasidan tashqari)
  if (input.status === "approved" && approver?.id === leave.employeeId && tenant.company.ownerId !== tenant.user.id) {
    throw forbidden("O'z ta'tilingizni tasdiqlay olmaysiz — boshqa mas'ul tasdiqlaydi");
  }

  const [updated] = await tx
    .update(leaves)
    .set({ status: input.status, approvedBy: approver?.id ?? null, notes: input.notes ?? leave.notes, updatedAt: new Date() })
    .where(eq(leaves.id, leaveId))
    .returning();

  const today = todayIso();
  if (input.status === "approved" && leave.startDate <= today && leave.endDate >= today) {
    await tx
      .update(employees)
      .set({ status: "on_leave", updatedAt: new Date() })
      .where(and(eq(employees.id, leave.employeeId), eq(employees.status, "active")));
  }

  await hrAudit(tx, tenant, meta, {
    action: input.status === "approved" ? "LEAVE_APPROVED" : "LEAVE_REJECTED",
    resource: "leaves",
    resourceId: leaveId,
    details: { employeeId: leave.employeeId },
  });
  const { legacyId: _l, companyId: _c, ...result } = updated!;
  return result;
}

export async function deleteLeave(tx: Tx, tenant: TenantContext, leaveId: string, meta: RequestMeta) {
  const [leave] = await tx
    .select({ id: leaves.id, status: leaves.status, employeeId: leaves.employeeId })
    .from(leaves)
    .where(and(eq(leaves.id, leaveId), eq(leaves.companyId, tenant.company.id)))
    .limit(1)
    .for("update");
  if (!leave) throw notFound("Ta'til topilmadi");
  if (leave.status !== "pending") throw badRequest("Faqat ko'rib chiqilmagan ta'til o'chiriladi");

  await tx.delete(leaves).where(eq(leaves.id, leaveId));
  await hrAudit(tx, tenant, meta, {
    action: "LEAVE_DELETED",
    resource: "leaves",
    resourceId: leaveId,
    details: { employeeId: leave.employeeId },
  });
}
