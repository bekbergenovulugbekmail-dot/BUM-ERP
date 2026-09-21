/**
 * Foydalanuvchi litsenziyalari: berish, bo'shatish, hisob, ro'yxat.
 *
 *  - Dasturdan foydalanadigan har faol a'zo — bitta joriy (bekor qilinmagan) litsenziya; bepul xodimda litsenziya yo'q.
 *  - Included — obunadagi `included_licenses` doirasida (egasi ham shulardan birini egallaydi). Tugasa — qo'shimcha
 *    litsenziya tarifi tanlanadi: litsenziya `pending_payment` bo'lib yaratiladi va to'lov so'rovi ochiladi;
 *    platforma admini tasdiqlamaguncha foydalanuvchi kira olmaydi.
 *  - Hisoblash va berish obuna qatorini `FOR UPDATE` qulflab bajariladi — parallel so'rovlar limitdan oshirolmaydi.
 *  - A'zolik vaqtincha o'chirilsa included litsenziya bo'shaydi; to'langan qo'shimcha litsenziya xodimda qoladi
 *    (muddati tugaguncha). Xodim dasturdan butunlay uzilsa (`revoke`) — bekor qilinadi, kutilayotgan to'lovi ham.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { AppError, LICENSE_LIMIT_REACHED, LICENSE_WARNING_DAYS, daysLeft, forbidden, licenseWarning } from "@bum/shared";
import { employees } from "../../db/schema/hr.js";
import { companyMembers, users } from "../../db/schema/platform.js";
import { licenseHistory, licenses, subscriptionPayments, subscriptionPlans, subscriptions } from "../../db/schema/subscription.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { accessDenied, subscriptionDenial } from "./access.js";
import { loadActivePlan } from "./plans.js";

export type LicenseRow = typeof licenses.$inferSelect;
export type PaymentRow = typeof subscriptionPayments.$inferSelect;
export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type Actor = { id: string; name: string | null } | null;

export type LicenseCounts = {
  /** Obunadagi included litsenziyalar (egasi bilan). */
  includedTotal: number;
  includedUsed: number;
  includedAvailable: number;
  additionalActive: number;
  additionalPending: number;
  additionalExpired: number;
  /** Amaldagi, lekin tugashiga 10 kundan kam qolgan qo'shimcha litsenziyalar. */
  additionalExpiringSoon: number;
  /** Amaldagi (kira oladigan) litsenziyalar: included + muddati o'tmagan additional. */
  totalActive: number;
};

export async function lockSubscription(tx: Tx, companyId: string): Promise<SubscriptionRow> {
  const [row] = await tx.select().from(subscriptions).where(eq(subscriptions.companyId, companyId)).limit(1).for("update");
  if (!row) throw forbidden("Kompaniya obunasi topilmadi. Platforma admini bilan bog'laning.");
  return row;
}

export async function licenseCounts(conn: DbOrTx, companyId: string, includedTotal: number, now = new Date()): Promise<LicenseCounts> {
  const at = now.toISOString();
  const soon = new Date(now.getTime() + Math.max(...LICENSE_WARNING_DAYS) * 86_400_000).toISOString();
  const rows = await conn
    .select({
      type: licenses.licenseType,
      active: sql<number>`(count(*) filter (where ${licenses.status} = 'active' and (${licenses.licenseType} = 'included' or ${licenses.expiresAt} > ${at}::timestamptz)))::int`,
      pending: sql<number>`(count(*) filter (where ${licenses.status} = 'pending_payment'))::int`,
      expired: sql<number>`(count(*) filter (where ${licenses.status} = 'expired' or (${licenses.status} = 'active' and ${licenses.licenseType} = 'additional' and ${licenses.expiresAt} <= ${at}::timestamptz)))::int`,
      expiringSoon: sql<number>`(count(*) filter (where ${licenses.status} = 'active' and ${licenses.licenseType} = 'additional' and ${licenses.expiresAt} > ${at}::timestamptz and ${licenses.expiresAt} <= ${soon}::timestamptz))::int`,
    })
    .from(licenses)
    .where(and(eq(licenses.companyId, companyId), ne(licenses.status, "revoked")))
    .groupBy(licenses.licenseType);

  const included = rows.find((row) => row.type === "included");
  const additional = rows.find((row) => row.type === "additional");
  const includedUsed = included?.active ?? 0;
  const additionalActive = additional?.active ?? 0;
  return {
    includedTotal,
    includedUsed,
    includedAvailable: Math.max(0, includedTotal - includedUsed),
    additionalActive,
    additionalPending: additional?.pending ?? 0,
    additionalExpired: additional?.expired ?? 0,
    additionalExpiringSoon: additional?.expiringSoon ?? 0,
    totalActive: includedUsed + additionalActive,
  };
}

export function licenseLimitReached(counts: LicenseCounts): AppError {
  return new AppError(
    "FORBIDDEN",
    `${counts.includedTotal} ta included foydalanuvchi litsenziyasi ishlatilgan. Yangi foydalanuvchi uchun qo'shimcha litsenziya tarifini tanlang.`,
    { reason: LICENSE_LIMIT_REACHED, counts },
  );
}

export async function lockCurrentLicense(tx: Tx, companyId: string, userId: string): Promise<LicenseRow | null> {
  const [row] = await tx
    .select()
    .from(licenses)
    .where(and(eq(licenses.companyId, companyId), eq(licenses.userId, userId), ne(licenses.status, "revoked")))
    .limit(1)
    .for("update");
  return row ?? null;
}

export async function writeLicenseHistory(
  tx: Tx,
  license: LicenseRow,
  event: string,
  extra: { actorId?: string | null; paymentId?: string | null; planName?: string | null } = {},
): Promise<void> {
  await tx.insert(licenseHistory).values({
    companyId: license.companyId,
    licenseId: license.id,
    userId: license.userId,
    employeeId: license.employeeId,
    event,
    licenseType: license.licenseType,
    status: license.status,
    planId: license.planId,
    planName: extra.planName ?? null,
    price: license.price,
    startAt: license.startAt,
    expiresAt: license.expiresAt,
    paymentId: extra.paymentId ?? null,
    actorId: extra.actorId ?? null,
  });
}

export function auditLicense(
  tx: Tx,
  actor: Actor,
  meta: RequestMeta | undefined,
  action: string,
  license: LicenseRow,
  details: Record<string, unknown> = {},
): Promise<void> {
  return writeAuditLog(
    {
      companyId: license.companyId,
      userId: actor?.id ?? null,
      userName: actor?.name ?? null,
      action,
      resource: "licenses",
      resourceId: license.id,
      details: {
        userId: license.userId,
        employeeId: license.employeeId,
        licenseType: license.licenseType,
        status: license.status,
        expiresAt: license.expiresAt?.toISOString() ?? null,
        ...details,
      },
      ...(meta ?? {}),
    },
    tx,
  );
}

export type AssignLicenseInput = {
  companyId: string;
  userId: string;
  employeeId?: string | null;
  actor: Actor;
  meta?: RequestMeta;
  /** Included tugagan bo'lsa — qo'shimcha litsenziya tarifi (litsenziya to'lov tasdiqlanguncha yopiq). */
  additionalPlanId?: string | null;
  now?: Date;
};

export type AssignLicenseResult = { license: LicenseRow; payment: PaymentRow | null; created: boolean };

/**
 * Foydalanuvchiga litsenziya: joriysi bo'lsa — o'sha (idempotent), bo'sh included bo'lsa — included,
 * aks holda `additionalPlanId` bilan qo'shimcha (to'lov so'rovi), u ham bo'lmasa — `license_limit_reached`.
 */
export async function assignLicense(tx: Tx, input: AssignLicenseInput): Promise<AssignLicenseResult> {
  const now = input.now ?? new Date();
  const subscription = await lockSubscription(tx, input.companyId);

  const existing = await lockCurrentLicense(tx, input.companyId, input.userId);
  if (existing) {
    if (input.employeeId && existing.employeeId !== input.employeeId) {
      const [linked] = await tx
        .update(licenses)
        .set({ employeeId: input.employeeId, updatedAt: now })
        .where(eq(licenses.id, existing.id))
        .returning();
      return { license: linked!, payment: null, created: false };
    }
    return { license: existing, payment: null, created: false };
  }

  const counts = await licenseCounts(tx, input.companyId, subscription.includedLicenses, now);
  if (counts.includedAvailable > 0) {
    const [license] = await tx
      .insert(licenses)
      .values({
        companyId: input.companyId,
        userId: input.userId,
        employeeId: input.employeeId ?? null,
        subscriptionId: subscription.id,
        licenseType: "included",
        status: "active",
        price: "0",
        startAt: now,
        expiresAt: null,
        assignedBy: input.actor?.id ?? null,
        assignedAt: now,
      })
      .returning();
    await writeLicenseHistory(tx, license!, "assigned", { actorId: input.actor?.id });
    await auditLicense(tx, input.actor, input.meta, "LICENSE_ASSIGNED", license!);
    return { license: license!, payment: null, created: true };
  }

  if (!input.additionalPlanId) throw licenseLimitReached(counts);
  // Tugagan obunada qo'shimcha litsenziya sotib olinmaydi — avval obuna uzaytiriladi
  const denial = subscriptionDenial(subscription, now);
  if (denial) throw accessDenied(denial, subscription);

  const plan = await loadActivePlan(tx, input.additionalPlanId, "additional_license");
  const [license] = await tx
    .insert(licenses)
    .values({
      companyId: input.companyId,
      userId: input.userId,
      employeeId: input.employeeId ?? null,
      subscriptionId: subscription.id,
      planId: plan.id,
      licenseType: "additional",
      status: "pending_payment",
      price: plan.price,
      assignedBy: input.actor?.id ?? null,
      assignedAt: now,
    })
    .returning();
  const [payment] = await tx
    .insert(subscriptionPayments)
    .values({
      companyId: input.companyId,
      kind: "license",
      planId: plan.id,
      licenseId: license!.id,
      amount: plan.price,
      currency: plan.currency,
      status: "pending",
      idempotencyKey: `license:${license!.id}:${randomUUID()}`,
      requestedBy: input.actor?.id ?? null,
    })
    .returning();
  await writeLicenseHistory(tx, license!, "pending_payment", { actorId: input.actor?.id, paymentId: payment!.id, planName: plan.name });
  await auditLicense(tx, input.actor, input.meta, "ADDITIONAL_LICENSE_REQUESTED", license!, {
    planCode: plan.code,
    amount: plan.price,
    paymentId: payment!.id,
  });
  return { license: license!, payment: payment!, created: true };
}

export type ReleaseMode =
  /** A'zolik vaqtincha o'chirildi (ishdan bo'shatish, agentni faolsizlantirish): included bo'shaydi, to'langan additional qoladi. */
  | "deactivate"
  /** Xodim dasturdan butunlay uzildi (bepul xodimga aylantirildi): har qanday litsenziya bekor. */
  | "revoke";

export async function releaseLicense(
  tx: Tx,
  input: { companyId: string; userId: string; actor: Actor; meta?: RequestMeta; mode: ReleaseMode; reason: string; now?: Date },
): Promise<LicenseRow | null> {
  const now = input.now ?? new Date();
  const existing = await lockCurrentLicense(tx, input.companyId, input.userId);
  if (!existing) return null;
  if (input.mode === "deactivate" && existing.licenseType === "additional" && existing.status !== "pending_payment") return existing;

  const [revoked] = await tx
    .update(licenses)
    .set({ status: "revoked", revokedAt: now, revokeReason: input.reason.slice(0, 200), updatedAt: now })
    .where(eq(licenses.id, existing.id))
    .returning();
  // To'lanmagan so'rov qolib ketmasin
  await tx
    .update(subscriptionPayments)
    .set({ status: "cancelled", cancelledAt: now, updatedAt: now, note: "Litsenziya bekor qilindi" })
    .where(and(eq(subscriptionPayments.licenseId, existing.id), eq(subscriptionPayments.status, "pending")));
  await writeLicenseHistory(tx, revoked!, "revoked", { actorId: input.actor?.id });
  await auditLicense(tx, input.actor, input.meta, "LICENSE_REVOKED", revoked!, { reason: input.reason, mode: input.mode });
  return revoked!;
}

/** Kompaniyaning joriy (bekor qilinmagan) litsenziyalari — kim, qaysi xodim, qaysi tarif, kutilayotgan to'lov. */
export async function listLicenses(conn: DbOrTx, companyId: string, ownerId: string | null, now = new Date()) {
  const rows = await conn
    .select({
      id: licenses.id,
      userId: licenses.userId,
      employeeId: licenses.employeeId,
      licenseType: licenses.licenseType,
      status: licenses.status,
      price: licenses.price,
      startAt: licenses.startAt,
      expiresAt: licenses.expiresAt,
      assignedAt: licenses.assignedAt,
      planId: licenses.planId,
      planName: subscriptionPlans.name,
      userName: users.name,
      userPhone: users.phone,
      companyRole: companyMembers.companyRole,
      memberActive: companyMembers.isActive,
      employeeName: employees.name,
      employeeCode: employees.code,
      pendingPaymentId: sql<string | null>`(select p."id" from "subscription_payments" p where p."license_id" = ${licenses.id} and p."status" = 'pending' limit 1)`,
    })
    .from(licenses)
    .innerJoin(users, eq(users.id, licenses.userId))
    .leftJoin(companyMembers, and(eq(companyMembers.companyId, licenses.companyId), eq(companyMembers.userId, licenses.userId)))
    .leftJoin(employees, eq(employees.id, licenses.employeeId))
    .leftJoin(subscriptionPlans, eq(subscriptionPlans.id, licenses.planId))
    .where(and(eq(licenses.companyId, companyId), ne(licenses.status, "revoked")))
    .orderBy(asc(licenses.licenseType), asc(licenses.assignedAt));
  return rows.map((row) => ({
    ...row,
    isOwner: row.userId === ownerId,
    /** Qolgan kunlar va tugash ogohlantirishi (qo'shimcha litsenziya uchun; included — obuna bilan). */
    daysLeft: row.licenseType === "additional" ? daysLeft(row.expiresAt, now) : null,
    expiryWarning: licenseWarning({ type: row.licenseType, status: row.status, expiresAt: row.expiresAt }, now),
  }));
}
