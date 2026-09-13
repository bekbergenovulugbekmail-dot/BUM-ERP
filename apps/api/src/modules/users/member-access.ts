/**
 * Xodimning kompaniyaga kirishini yoqish/o'chirish (sotuv agenti faolsizlantirilganda yoki HR xodimi ishdan
 * bo'shatilganda). O'chirishda: shu kompaniyadagi a'zolik nofaol, barcha sessiyalar bekor; boshqa faol a'zoligi
 * bo'lmasa hisob ham nofaol — login rad etiladi va hisob "yetim" bo'lib qolmaydi (a'zolik va xodim bilan bog'liq).
 * Platforma admini va bootstrap admin hisobi o'zgartirilmaydi.
 *
 * Litsenziya: qayta yoqishda litsenziya kerak (xodimdagi to'langan qo'shimcha yoki bo'sh included; bo'lmasa —
 * `license_limit_reached`, hech narsa o'zgarmaydi); o'chirishda included litsenziya bo'shaydi. Kompaniya egasining
 * litsenziyasiga tegilmaydi.
 */
import { and, eq, ne } from "drizzle-orm";
import { companies, companyMembers, users } from "../../db/schema/platform.js";
import type { Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { revokeUserSessions } from "../auth/session.js";
import { assignLicense, releaseLicense, type Actor } from "../subscription/license.service.js";

export type MemberAccessOptions = {
  actor?: Actor;
  meta?: RequestMeta;
  additionalLicensePlanId?: string | null;
};

export async function setMemberAccess(tx: Tx, companyId: string, userId: string, active: boolean, options: MemberAccessOptions = {}) {
  const [user] = await tx
    .select({ id: users.id, isPlatformAdmin: users.isPlatformAdmin, isBootstrapAdmin: users.isBootstrapAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .for("update");
  if (!user) return;

  const [company] = await tx.select({ ownerId: companies.ownerId }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (company?.ownerId !== userId) {
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
  }

  await tx
    .update(companyMembers)
    .set({ isActive: active, updatedAt: new Date() })
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)));

  if (user.isPlatformAdmin || user.isBootstrapAdmin) return;
  if (active) {
    await tx.update(users).set({ isActive: true, updatedAt: new Date() }).where(eq(users.id, userId));
    return;
  }
  await revokeUserSessions(tx, userId);
  const [otherMembership] = await tx
    .select({ id: companyMembers.id })
    .from(companyMembers)
    .where(and(eq(companyMembers.userId, userId), ne(companyMembers.companyId, companyId), eq(companyMembers.isActive, true)))
    .limit(1);
  if (!otherMembership) await tx.update(users).set({ isActive: false, updatedAt: new Date() }).where(eq(users.id, userId));
}
