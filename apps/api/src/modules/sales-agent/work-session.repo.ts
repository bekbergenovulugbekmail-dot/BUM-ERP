/**
 * Ish sessiyasi yordamchilari (faqat sxemaga bog'liq — lokatsiya, tashrif, buyurtma, HR va tozalash servislari
 * sikl hosil qilmasdan ishlatadi).
 */
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { AppError } from "@bum/shared";
import { salesReps } from "../../db/schema/crm.js";
import { agentLocationLatest, agentWorkSessions } from "../../db/schema/sales-agent.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";

/** Shundan uzoq ochiq qolgan sessiya avtomatik yopiladi (agent "yakunlash"ni unutganda shaxsiy vaqt kuzatilmasin). */
export const MAX_WORK_SESSION_HOURS = 16;

export async function activeWorkSession(conn: DbOrTx, salesRepId: string) {
  const [session] = await conn
    .select({ id: agentWorkSessions.id, startedAt: agentWorkSessions.startedAt })
    .from(agentWorkSessions)
    .where(and(eq(agentWorkSessions.salesRepId, salesRepId), eq(agentWorkSessions.status, "active")))
    .limit(1);
  return session ?? null;
}

/** Ish boshlanmagan bo'lsa — 409 (`work_session_required`): lokatsiya, tashrif va buyurtma faqat ish vaqtida. */
export async function requireWorkSession(conn: DbOrTx, salesRepId: string) {
  const session = await activeWorkSession(conn, salesRepId);
  if (!session) {
    throw new AppError("CONFLICT", "Ish boshlanmagan — avval «Ishni boshlash» tugmasini bosing", { reason: "work_session_required" });
  }
  return session;
}

/** Agentning faol sessiyalarini yopadi va jonli joyni o'chiradi. */
export async function endActiveSessions(tx: Tx, salesRepIds: string[], reason: "deactivated" | "auto") {
  if (salesRepIds.length === 0) return 0;
  const now = new Date();
  const ended = await tx
    .update(agentWorkSessions)
    .set({ status: "ended", endedAt: now, endReason: reason, updatedAt: now })
    .where(and(inArray(agentWorkSessions.salesRepId, salesRepIds), eq(agentWorkSessions.status, "active")))
    .returning({ salesRepId: agentWorkSessions.salesRepId });
  await tx.delete(agentLocationLatest).where(inArray(agentLocationLatest.salesRepId, salesRepIds));
  return ended.length;
}

/** Foydalanuvchiga bog'langan agent(lar)ning sessiyalari (HR xodimi ishdan bo'shatilganda). */
export async function endSessionsForUser(tx: Tx, companyId: string, userId: string) {
  const reps = await tx
    .select({ id: salesReps.id })
    .from(salesReps)
    .where(and(eq(salesReps.companyId, companyId), eq(salesReps.userId, userId)));
  return endActiveSessions(tx, reps.map((rep) => rep.id), "deactivated");
}

/** Davriy tozalash: `MAX_WORK_SESSION_HOURS` dan uzoq ochiq sessiyalar yopiladi (tugash — boshlanish + chegara). */
export async function autoEndStaleSessions(tx: Tx, now = new Date()) {
  const cutoff = new Date(now.getTime() - MAX_WORK_SESSION_HOURS * 3_600_000);
  const ended = await tx
    .update(agentWorkSessions)
    .set({
      status: "ended",
      endReason: "auto",
      endedAt: sql`${agentWorkSessions.startedAt} + make_interval(hours => ${MAX_WORK_SESSION_HOURS})`,
      updatedAt: now,
    })
    .where(and(eq(agentWorkSessions.status, "active"), lt(agentWorkSessions.startedAt, cutoff)))
    .returning({ salesRepId: agentWorkSessions.salesRepId });
  if (ended.length > 0) {
    await tx.delete(agentLocationLatest).where(inArray(agentLocationLatest.salesRepId, ended.map((row) => row.salesRepId)));
  }
  return ended.length;
}
