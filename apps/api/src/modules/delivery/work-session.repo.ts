/**
 * Yetkazuvchi ish sessiyasi yordamchilari (faqat sxemaga bog'liq — HR, tozalash va dostavka servislari sikl hosil
 * qilmasdan ishlatadi). Sessiya tashqarisida lokatsiya va yetkazish amallari qabul qilinmaydi.
 */
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { AppError } from "@bum/shared";
import { deliveryAgents, deliveryLocationLatest, deliveryWorkSessions } from "../../db/schema/delivery.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { publishDeliveryEvent } from "./realtime-bus.js";

/** Shundan uzoq ochiq qolgan sessiya avtomatik yopiladi (yakunlash unutilganda shaxsiy vaqt kuzatilmasin). */
export const MAX_DELIVERY_SESSION_HOURS = 16;

export async function activeDeliverySession(conn: DbOrTx, deliveryAgentId: string) {
  const [session] = await conn
    .select({ id: deliveryWorkSessions.id, startedAt: deliveryWorkSessions.startedAt })
    .from(deliveryWorkSessions)
    .where(and(eq(deliveryWorkSessions.deliveryAgentId, deliveryAgentId), eq(deliveryWorkSessions.status, "active")))
    .limit(1);
  return session ?? null;
}

/** Ish boshlanmagan — 409 (`work_session_required`). */
export async function requireDeliverySession(conn: DbOrTx, deliveryAgentId: string) {
  const session = await activeDeliverySession(conn, deliveryAgentId);
  if (!session) {
    throw new AppError("CONFLICT", "Ish boshlanmagan — avval «Ishni boshlash» tugmasini bosing", { reason: "work_session_required" });
  }
  return session;
}

export async function endDeliverySessions(tx: Tx, deliveryAgentIds: string[], reason: "deactivated" | "auto") {
  if (deliveryAgentIds.length === 0) return 0;
  const now = new Date();
  const ended = await tx
    .update(deliveryWorkSessions)
    .set({ status: "ended", endedAt: now, endReason: reason, updatedAt: now })
    .where(and(inArray(deliveryWorkSessions.deliveryAgentId, deliveryAgentIds), eq(deliveryWorkSessions.status, "active")))
    .returning({ id: deliveryWorkSessions.id, companyId: deliveryWorkSessions.companyId, deliveryAgentId: deliveryWorkSessions.deliveryAgentId });
  await tx.delete(deliveryLocationLatest).where(inArray(deliveryLocationLatest.deliveryAgentId, deliveryAgentIds));
  await publishSessionsEnded(tx, ended);
  return ended.length;
}

/** Yopilgan sessiyalar — boshqaruvchi xaritasi va agentning o'z ekrani yangilansin. */
async function publishSessionsEnded(tx: Tx, ended: { companyId: string; deliveryAgentId: string }[]) {
  for (const row of ended) await publishDeliveryEvent(tx, { type: "session", companyId: row.companyId, deliveryAgentId: row.deliveryAgentId });
}

/**
 * HR xodimi ishdan bo'shatilsa/o'chirilsa yoki qayta ishga olinsa: bog'langan yetkazuvchi profili faolligi va
 * (faolsizlantirishda) ish sessiyasi.
 */
export async function setDeliveryAgentsActiveForUser(tx: Tx, companyId: string, userId: string, active: boolean) {
  const agents = await tx
    .update(deliveryAgents)
    .set({ isActive: active, updatedAt: new Date() })
    .where(and(eq(deliveryAgents.companyId, companyId), eq(deliveryAgents.userId, userId)))
    .returning({ id: deliveryAgents.id });
  if (!active) await endDeliverySessions(tx, agents.map((agent) => agent.id), "deactivated");
  return agents.length;
}

/** Sozlama matnidan saqlash kunlari (JSON buzilgan bo'lsa ham topiladi). */
const RETENTION_PATTERN = '"locationRetentionDays"\\s*:\\s*(\\d+)';

/**
 * Saqlash muddati: dostavka siyosatidagi kundan (standart 90, kamida 7) eski lokatsiya nuqtalari o'chiriladi.
 * Oxirgi joy faqat ish sessiyasi davomida bor (sessiya tugaganda o'chiriladi).
 */
export async function purgeDeliveryLocations(tx: Tx, now = new Date()) {
  const cutoff = sql`${now.toISOString()}::timestamptz - make_interval(days => greatest(7, coalesce(nullif(substring(s."value" from ${RETENTION_PATTERN}), '')::int, 90)))`;
  const result = await tx.execute(sql`
    delete from "delivery_locations" dl
     using "companies" c
      left join "settings" s on s."company_id" = c."id" and s."key" = 'delivery.policy'
     where dl."company_id" = c."id" and dl."recorded_at" < ${cutoff}`);
  return result.rowCount ?? 0;
}

export async function autoEndStaleDeliverySessions(tx: Tx, now = new Date()) {
  const cutoff = new Date(now.getTime() - MAX_DELIVERY_SESSION_HOURS * 3_600_000);
  const ended = await tx
    .update(deliveryWorkSessions)
    .set({
      status: "ended",
      endReason: "auto",
      endedAt: sql`${deliveryWorkSessions.startedAt} + make_interval(hours => ${MAX_DELIVERY_SESSION_HOURS})`,
      updatedAt: now,
    })
    .where(and(eq(deliveryWorkSessions.status, "active"), lt(deliveryWorkSessions.startedAt, cutoff)))
    .returning({ deliveryAgentId: deliveryWorkSessions.deliveryAgentId, companyId: deliveryWorkSessions.companyId });
  if (ended.length > 0) {
    await tx.delete(deliveryLocationLatest).where(inArray(deliveryLocationLatest.deliveryAgentId, ended.map((row) => row.deliveryAgentId)));
    await publishSessionsEnded(tx, ended);
  }
  return ended.length;
}
