/**
 * Xodimning kompaniyaga kirishini yoqish/o'chirish (sotuv agenti faolsizlantirilganda yoki HR xodimi ishdan
 * bo'shatilganda). O'chirishda: shu kompaniyadagi a'zolik nofaol, barcha sessiyalar bekor; boshqa faol a'zoligi
 * bo'lmasa hisob ham nofaol — login rad etiladi va hisob "yetim" bo'lib qolmaydi (a'zolik va xodim bilan bog'liq).
 * Platforma admini va bootstrap admin hisobi o'zgartirilmaydi.
 */
import { and, eq, ne } from "drizzle-orm";
import { companyMembers, users } from "../../db/schema/platform.js";
import type { Tx } from "../../db/transaction.js";
import { revokeUserSessions } from "../auth/session.js";

export async function setMemberAccess(tx: Tx, companyId: string, userId: string, active: boolean) {
  const [user] = await tx
    .select({ id: users.id, isPlatformAdmin: users.isPlatformAdmin, isBootstrapAdmin: users.isBootstrapAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .for("update");
  if (!user) return;

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
