/**
 * Ish sessiyasi: "ISHNI BOSHLASH" — yangi GPS o'lchovi bilan (sifat siyosat bo'yicha), "ISHNI YAKUNLASH" — ochiq
 * tashrif bo'lmasa. Sessiya tashqarisida lokatsiya qabul qilinmaydi va saqlanmaydi; yakunlanganda jonli joy
 * o'chiriladi. Takroriy "boshlash" o'sha sessiyani qaytaradi. Audit: WORK_SESSION_START / WORK_SESSION_END.
 */
import { and, desc, eq, gte, ne } from "drizzle-orm";
import { AppError, badRequest, conflict } from "@bum/shared";
import { salesReps } from "../../db/schema/crm.js";
import { agentLocationLatest, agentVisits, agentWorkSessions } from "../../db/schema/sales-agent.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { isValidCoordinate } from "../../shared/geo.js";
import type { AgentContext } from "./agent-context.js";
import { checkLocationQuality, type LocationInput } from "./location.service.js";
import { getSalesAgentPolicy } from "./policy.service.js";

const sessionFields = {
  id: agentWorkSessions.id,
  status: agentWorkSessions.status,
  startedAt: agentWorkSessions.startedAt,
  endedAt: agentWorkSessions.endedAt,
  endReason: agentWorkSessions.endReason,
};

function audit(tx: Tx, context: AgentContext, meta: RequestMeta, action: string, resourceId: string, details: Record<string, unknown>) {
  return writeAuditLog(
    { userId: context.user.id, userName: context.user.name, companyId: context.company.id, action, resource: "agent_work_sessions", resourceId, details, ...meta },
    tx,
  );
}

export async function currentWorkSession(conn: DbOrTx, context: AgentContext) {
  const [session] = await conn
    .select(sessionFields)
    .from(agentWorkSessions)
    .where(and(eq(agentWorkSessions.salesRepId, context.agent.id), eq(agentWorkSessions.status, "active")))
    .limit(1);
  return session ?? null;
}

export async function startWorkSession(tx: Tx, context: AgentContext, input: LocationInput, meta: RequestMeta) {
  await tx.select({ id: salesReps.id }).from(salesReps).where(eq(salesReps.id, context.agent.id)).for("update");
  const existing = await currentWorkSession(tx, context);
  if (existing) return { session: existing, created: false };

  const policy = await getSalesAgentPolicy(tx, context.company.id);
  const rejection = checkLocationQuality(policy, input);
  if (rejection) throw badRequest(rejection.message, { reason: rejection.reason });

  const [created] = await tx
    .insert(agentWorkSessions)
    .values({
      companyId: context.company.id,
      salesRepId: context.agent.id,
      userId: context.user.id,
      startedAt: new Date(),
      startLatitude: input.latitude.toFixed(6),
      startLongitude: input.longitude.toFixed(6),
      startAccuracy: input.accuracy.toFixed(2),
    })
    .returning(sessionFields);
  await audit(tx, context, meta, "WORK_SESSION_START", created!.id, { accuracy: Math.round(input.accuracy) });
  return { session: created!, created: true };
}

export async function endWorkSession(tx: Tx, context: AgentContext, input: Partial<LocationInput>, meta: RequestMeta) {
  await tx.select({ id: salesReps.id }).from(salesReps).where(eq(salesReps.id, context.agent.id)).for("update");
  const session = await currentWorkSession(tx, context);
  if (!session) throw conflict("Ish sessiyasi faol emas");

  const [openVisit] = await tx
    .select({ id: agentVisits.id })
    .from(agentVisits)
    .where(and(eq(agentVisits.salesRepId, context.agent.id), ne(agentVisits.status, "completed")))
    .limit(1);
  if (openVisit) {
    throw new AppError("CONFLICT", "Avval ochiq tashrifni yakunlang", { reason: "visit_in_progress", visitId: openVisit.id });
  }

  const point =
    input.latitude !== undefined && input.longitude !== undefined && isValidCoordinate({ latitude: input.latitude, longitude: input.longitude })
      ? {
          endLatitude: input.latitude.toFixed(6),
          endLongitude: input.longitude.toFixed(6),
          endAccuracy: input.accuracy !== undefined ? input.accuracy.toFixed(2) : null,
        }
      : {};
  const now = new Date();
  const [ended] = await tx
    .update(agentWorkSessions)
    .set({ status: "ended", endedAt: now, endReason: "agent", ...point, updatedAt: now })
    .where(eq(agentWorkSessions.id, session.id))
    .returning(sessionFields);
  // Ish tugadi — jonli joy ko'rinmaydi
  await tx.delete(agentLocationLatest).where(eq(agentLocationLatest.salesRepId, context.agent.id));
  await audit(tx, context, meta, "WORK_SESSION_END", session.id, {
    durationMinutes: Math.round((now.getTime() - session.startedAt.getTime()) / 60_000),
  });
  return ended!;
}

/** Kun (UTC+5) bo'yicha ish sessiyalari — supervayzer tafsiloti va tarix uchun. */
export function sessionsSince(conn: DbOrTx, companyId: string, salesRepId: string, from: Date) {
  return conn
    .select(sessionFields)
    .from(agentWorkSessions)
    .where(and(eq(agentWorkSessions.companyId, companyId), eq(agentWorkSessions.salesRepId, salesRepId), gte(agentWorkSessions.startedAt, from)))
    .orderBy(desc(agentWorkSessions.startedAt))
    .limit(20);
}
