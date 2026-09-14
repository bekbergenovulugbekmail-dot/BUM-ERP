/**
 * Xodimning kompaniyaga kirishini yoqish/o'chirish (sotuv agenti faolsizlantirilganda yoki HR xodimi ishdan
 * bo'shatilganda). O'chirishda: shu kompaniyadagi a'zolik nofaol, barcha sessiyalar bekor; boshqa faol a'zoligi
 * bo'lmasa hisob ham nofaol — login rad etiladi va hisob "yetim" bo'lib qolmaydi (a'zolik va xodim bilan bog'liq).
 *
 * Himoya (xavfsizlik auditi): kompaniya egasi, to'liq huquqli rol (Superadmin / Business Owner) va platforma admini
 * kirishini bu yo'l bilan o'zgartirib bo'lmaydi — aks holda HR yoki agentlar menejeri xodim yozuvini egaga bog'lab,
 * egani kompaniyadan chiqarib yuborishi mumkin edi. Qayta yoqish platforma admini bloklagan hisobni ochmaydi.
 *
 * Litsenziya: qayta yoqishda litsenziya kerak (xodimdagi to'langan qo'shimcha yoki bo'sh included; bo'lmasa —
 * `license_limit_reached`, hech narsa o'zgarmaydi); o'chirishda included litsenziya bo'shaydi.
 */
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { FULL_ACCESS_ROLES, forbidden } from "@bum/shared";
import { auditLogs, companies, companyMembers, users } from "../../db/schema/platform.js";
import { posDeviceCashiers } from "../../db/schema/pos.js";
import type { Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { revokeUserSessions } from "../auth/session.js";
import { requirePermission, type TenantContext } from "../company/tenant.js";
import { assignLicense, releaseLicense, type Actor } from "../subscription/license.service.js";

export type MemberAccessOptions = {
  actor?: Actor;
  meta?: RequestMeta;
  additionalLicensePlanId?: string | null;
  /** Kirishni HR orqali o'zgartirayotgan foydalanuvchi — `employee.software_access.manage` talab qilinadi. */
  requirePermissionOf?: TenantContext;
  /** Himoyalangan a'zo (ega, to'liq huquq, platforma admini) — xato o'rniga o'zgarishsiz `false` qaytadi. */
  skipProtected?: boolean;
};

/** A'zo kirishini xodim/agent boshqaruvi orqali o'zgartirib bo'lmasa — sababi, aks holda null. */
export async function protectedMemberReason(tx: Tx, companyId: string, userId: string): Promise<string | null> {
  const [user] = await tx
    .select({ isPlatformAdmin: users.isPlatformAdmin, isBootstrapAdmin: users.isBootstrapAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return null;
  const [company] = await tx.select({ ownerId: companies.ownerId }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (company?.ownerId === userId) return "Kompaniya egasining kirishini bu yerda o'zgartirib bo'lmaydi";
  if (user.isPlatformAdmin || user.isBootstrapAdmin) return "Platforma admini hisobini bu yerda o'zgartirib bo'lmaydi";
  const [member] = await tx
    .select({ companyRole: companyMembers.companyRole })
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)))
    .limit(1);
  if (member && (FULL_ACCESS_ROLES as readonly string[]).includes(member.companyRole)) {
    return "To'liq huquqli foydalanuvchining kirishini faqat kompaniya egasi boshqaradi";
  }
  return null;
}

/** Platforma admini bloklaganmi — foydalanuvchi bo'yicha oxirgi USER_BLOCKED / USER_ACTIVATED yozuvi. */
async function blockedByPlatform(tx: Tx, userId: string): Promise<boolean> {
  const [last] = await tx
    .select({ action: auditLogs.action })
    .from(auditLogs)
    .where(and(eq(auditLogs.resource, "users"), eq(auditLogs.resourceId, userId), inArray(auditLogs.action, ["USER_BLOCKED", "USER_ACTIVATED"])))
    .orderBy(desc(auditLogs.occurredAt))
    .limit(1);
  return last?.action === "USER_BLOCKED";
}

/** `true` — kirish o'zgartirildi; `false` — foydalanuvchi yo'q yoki himoyalangan (`skipProtected`). */
export async function setMemberAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  active: boolean,
  options: MemberAccessOptions = {},
): Promise<boolean> {
  const reason = await protectedMemberReason(tx, companyId, userId);
  if (reason) {
    if (options.skipProtected) return false;
    throw forbidden(reason);
  }
  if (options.requirePermissionOf) await requirePermission(tx, options.requirePermissionOf, "employee.software_access.manage");

  const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1).for("update");
  if (!user) return false;

  if (active) {
    await assignLicense(tx, {
      companyId,
      userId,
      actor: options.actor ?? null,
      meta: options.meta,
      additionalPlanId: options.additionalLicensePlanId ?? null,
    });
  } else {
    await releaseLicense(tx, { companyId, userId, actor: options.actor ?? null, meta: options.meta, mode: "deactivate", reason: "A'zolik o'chirildi" });
  }

  await tx
    .update(companyMembers)
    .set({ isActive: active, updatedAt: new Date() })
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)));

  if (active) {
    // Platforma admini bloklagan hisob HR/agent orqali ochilmaydi — faqat platforma admini ochadi
    if (!(await blockedByPlatform(tx, userId))) {
      await tx.update(users).set({ isActive: true, updatedAt: new Date() }).where(eq(users.id, userId));
    }
    return true;
  }
  await revokeUserSessions(tx, userId);
  // Kassa qurilmalaridagi bog'lanishlar ham bekor — qayta yoqilganda kassir parol bilan qayta kiradi
  await tx
    .update(posDeviceCashiers)
    .set({ revokedAt: new Date() })
    .where(and(eq(posDeviceCashiers.companyId, companyId), eq(posDeviceCashiers.userId, userId), isNull(posDeviceCashiers.revokedAt)));
  const [otherMembership] = await tx
    .select({ id: companyMembers.id })
    .from(companyMembers)
    .where(and(eq(companyMembers.userId, userId), ne(companyMembers.companyId, companyId), eq(companyMembers.isActive, true)))
    .limit(1);
  if (!otherMembership) await tx.update(users).set({ isActive: false, updatedAt: new Date() }).where(eq(users.id, userId));
  return true;
}
