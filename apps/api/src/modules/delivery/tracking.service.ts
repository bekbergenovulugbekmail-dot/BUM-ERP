/**
 * Yetkazuvchi ish sessiyasi va lokatsiyasi.
 *  - Ish sessiyasi: "ISHNI BOSHLASH" — sifatli GPS bilan; "ISHNI YAKUNLASH" — mijozda topshirilayotgan yetkazma bo'lmasa.
 *    Sessiya tashqarisida lokatsiya qabul qilinmaydi va saqlanmaydi; yakunlanganda jonli joy o'chiriladi.
 *  - Lokatsiya: bir so'rovda bir nechta nuqta (oflayn yig'ilgani yoki oraliq bo'yicha); har nuqta sifati serverda,
 *    imkonsiz tezlikdagi sakrash — shubhali. Nuqtalar auditga yozilmaydi (iz — `delivery_locations`, saqlash muddati bilan).
 *  - Supervayzer: jonli holat (agent, joy, aniqlik, oxirgi yangilanish, ish sessiyasi, joriy yetkazma) va kunlik iz (audit).
 * Brauzer/PWA fonda yoki ekran qulflanganda lokatsiya bermasligi mumkin — 100% fondagi kuzatuv va'da qilinmaydi.
 */
import { and, asc, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import {
  AppError,
  DELIVERY_LOCATION_BATCH_MAX,
  DELIVERY_ONLINE_MINUTES,
  ON_ROUTE_DELIVERY_STATUSES,
  badRequest,
  conflict,
  notFound,
  rateLimited,
} from "@bum/shared";
import {
  deliveryAgents,
  deliveryEvents,
  deliveryLocationLatest,
  deliveryLocations,
  deliveryTasks,
  deliveryWorkSessions,
} from "../../db/schema/delivery.js";
import { users } from "../../db/schema/platform.js";
import { customers } from "../../db/schema/sales.js";
import { db } from "../../db/client.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { distanceMeters, isValidCoordinate, pointOf } from "../../shared/geo.js";
import { recordHit } from "../../shared/rate-limit.js";
import type { TenantContext } from "../company/tenant.js";
import { checkLocationQuality, type LocationInput } from "../sales-agent/location.service.js";
import type { DeliveryAgentContext } from "./agent-context.js";
import { getDeliveryPolicy } from "./policy.service.js";
import { localDate, localDayStart } from "./task.repo.js";

const REQUESTS_PER_MINUTE = 12;
/** Oflayn yig'ilgan nuqtalar shu vaqtgacha qabul qilinadi (joriy sessiya ichida). */
const BATCH_MAX_AGE_SECONDS = 30 * 60;
const MIN_JUMP_METERS = 1000;
const HISTORY_POINTS_MAX = 5000;

const sessionFields = {
  id: deliveryWorkSessions.id,
  status: deliveryWorkSessions.status,
  startedAt: deliveryWorkSessions.startedAt,
  endedAt: deliveryWorkSessions.endedAt,
  endReason: deliveryWorkSessions.endReason,
};

function sessionAudit(tx: Tx, context: DeliveryAgentContext, meta: RequestMeta, action: string, resourceId: string, details: Record<string, unknown>) {
  return writeAuditLog(
    { userId: context.user.id, userName: context.user.name, companyId: context.company.id, action, resource: "delivery_work_sessions", resourceId, details, ...meta },
    tx,
  );
}

export async function currentDeliverySession(conn: DbOrTx, deliveryAgentId: string) {
  const [session] = await conn
    .select(sessionFields)
    .from(deliveryWorkSessions)
    .where(and(eq(deliveryWorkSessions.deliveryAgentId, deliveryAgentId), eq(deliveryWorkSessions.status, "active")))
    .limit(1);
  return session ?? null;
}

async function lockAgent(tx: Tx, deliveryAgentId: string) {
  await tx.select({ id: deliveryAgents.id }).from(deliveryAgents).where(eq(deliveryAgents.id, deliveryAgentId)).for("update");
}

export async function startDeliverySession(tx: Tx, context: DeliveryAgentContext, input: LocationInput, meta: RequestMeta) {
  await lockAgent(tx, context.deliveryAgent.id);
  const existing = await currentDeliverySession(tx, context.deliveryAgent.id);
  if (existing) return { session: existing, created: false };
  const policy = await getDeliveryPolicy(tx, context.company.id);
  const rejection = checkLocationQuality(policy, input);
  if (rejection) {
    const message = rejection.reason === "low_accuracy" ? "GPS aniqligi yetarli emas. Iltimos, qayta urinib ko'ring." : rejection.message;
    throw badRequest(message, { reason: rejection.reason });
  }
  const [created] = await tx
    .insert(deliveryWorkSessions)
    .values({
      companyId: context.company.id,
      deliveryAgentId: context.deliveryAgent.id,
      userId: context.user.id,
      startedAt: new Date(),
      startLatitude: input.latitude.toFixed(6),
      startLongitude: input.longitude.toFixed(6),
      startAccuracy: input.accuracy.toFixed(2),
    })
    .returning(sessionFields);
  await sessionAudit(tx, context, meta, "WORK_SESSION_START", created!.id, { accuracy: Math.round(input.accuracy), module: "delivery" });
  return { session: created!, created: true };
}

export async function endDeliverySession(tx: Tx, context: DeliveryAgentContext, input: Partial<LocationInput>, meta: RequestMeta) {
  await lockAgent(tx, context.deliveryAgent.id);
  const session = await currentDeliverySession(tx, context.deliveryAgent.id);
  if (!session) throw conflict("Ish sessiyasi faol emas");
  const [handover] = await tx
    .select({ id: deliveryTasks.id, number: deliveryTasks.number })
    .from(deliveryTasks)
    .where(and(eq(deliveryTasks.deliveryAgentId, context.deliveryAgent.id), inArray(deliveryTasks.status, ["arrived", "delivering"])))
    .limit(1);
  if (handover) {
    throw new AppError("CONFLICT", `Avval mijozdagi yetkazmani yakunlang (${handover.number})`, { reason: "task_in_progress", taskId: handover.id });
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
    .update(deliveryWorkSessions)
    .set({ status: "ended", endedAt: now, endReason: "agent", ...point, updatedAt: now })
    .where(eq(deliveryWorkSessions.id, session.id))
    .returning(sessionFields);
  // Ish tugadi — jonli joy ko'rinmaydi, keyingi nuqtalar qabul qilinmaydi
  await tx.delete(deliveryLocationLatest).where(eq(deliveryLocationLatest.deliveryAgentId, context.deliveryAgent.id));
  await sessionAudit(tx, context, meta, "WORK_SESSION_END", session.id, {
    durationMinutes: Math.round((now.getTime() - session.startedAt.getTime()) / 60_000),
    module: "delivery",
  });
  return ended!;
}

export type LocationBatchResult = {
  accepted: number;
  rejected: { index: number; reason: string; message: string }[];
  suspicious: number;
  nextIntervalSeconds: number;
  distanceMeters: number;
};

export async function recordDeliveryLocations(tx: Tx, context: DeliveryAgentContext, points: LocationInput[]): Promise<LocationBatchResult> {
  if (points.length === 0 || points.length > DELIVERY_LOCATION_BATCH_MAX) throw badRequest(`Bir so'rovda 1–${DELIVERY_LOCATION_BATCH_MAX} ta nuqta`);
  if ((await recordHit(`delivery-location:${context.deliveryAgent.id}`, 60)) > REQUESTS_PER_MINUTE) throw rateLimited();
  // Shaxsiy vaqtdagi lokatsiya hech qachon saqlanmaydi
  const session = await currentDeliverySession(tx, context.deliveryAgent.id);
  if (!session) throw new AppError("CONFLICT", "Ish boshlanmagan — lokatsiya faqat ish vaqtida qabul qilinadi", { reason: "work_session_required" });
  const policy = await getDeliveryPolicy(tx, context.company.id);
  const batchPolicy = { maxAccuracyMeters: policy.maxAccuracyMeters, maxLocationAgeSeconds: Math.max(policy.maxLocationAgeSeconds, BATCH_MAX_AGE_SECONDS) };

  const [latest] = await tx
    .select()
    .from(deliveryLocationLatest)
    .where(eq(deliveryLocationLatest.deliveryAgentId, context.deliveryAgent.id))
    .limit(1)
    .for("update");
  let previous = latest ? { point: pointOf(latest.latitude, latest.longitude), recordedAt: latest.recordedAt } : null;
  let newest: (LocationInput & { suspicious: boolean }) | null = null;

  const ordered = points.map((point, index) => ({ point, index })).sort((a, b) => a.point.recordedAt.getTime() - b.point.recordedAt.getTime());
  const result: LocationBatchResult = { accepted: 0, rejected: [], suspicious: 0, nextIntervalSeconds: policy.trackingIntervalSeconds, distanceMeters: 0 };
  for (const { point, index } of ordered) {
    const rejection = checkLocationQuality(batchPolicy, point);
    if (rejection) {
      result.rejected.push({ index, reason: rejection.reason, message: rejection.message });
      continue;
    }
    if (point.recordedAt.getTime() < session.startedAt.getTime() - 60_000) {
      result.rejected.push({ index, reason: "outside_session", message: "Nuqta ish sessiyasidan oldin olingan" });
      continue;
    }
    let suspicious = point.mocked === true;
    if (previous?.point) {
      const hours = (point.recordedAt.getTime() - previous.recordedAt.getTime()) / 3_600_000;
      const meters = distanceMeters(previous.point, point);
      if (hours > 0 && meters > MIN_JUMP_METERS && meters / 1000 / hours > policy.maxJumpSpeedKmh) suspicious = true;
      else if (hours > 0) result.distanceMeters += Math.round(meters);
    }
    await tx.insert(deliveryLocations).values({
      companyId: context.company.id,
      deliveryAgentId: context.deliveryAgent.id,
      userId: context.user.id,
      workSessionId: session.id,
      latitude: point.latitude.toFixed(6),
      longitude: point.longitude.toFixed(6),
      accuracy: point.accuracy.toFixed(2),
      recordedAt: point.recordedAt,
      suspicious,
    });
    result.accepted += 1;
    if (suspicious) result.suspicious += 1;
    if (!suspicious) previous = { point: { latitude: point.latitude, longitude: point.longitude }, recordedAt: point.recordedAt };
    if (!newest || point.recordedAt > newest.recordedAt) newest = { ...point, suspicious };
  }

  // Kechikib kelgan (eskiroq) nuqta oxirgi joyni almashtirmaydi
  if (newest && (!latest || newest.recordedAt > latest.recordedAt)) {
    const values = {
      latitude: newest.latitude.toFixed(6),
      longitude: newest.longitude.toFixed(6),
      accuracy: newest.accuracy.toFixed(2),
      recordedAt: newest.recordedAt,
      suspicious: newest.suspicious,
      receivedAt: new Date(),
    };
    await tx
      .insert(deliveryLocationLatest)
      .values({ companyId: context.company.id, deliveryAgentId: context.deliveryAgent.id, ...values })
      .onConflictDoUpdate({ target: deliveryLocationLatest.deliveryAgentId, set: values });
  }
  return result;
}

// ─── Supervayzer ─────────────────────────────────────────────────────────────

/** Faol yetkazuvchilar: joriy joy, aniqlik, oxirgi yangilanish, ish sessiyasi, yo'ldagi yetkazma, bugungi progress. */
export async function deliveryLive(conn: DbOrTx, tenant: TenantContext, now = new Date()) {
  const companyId = tenant.company.id;
  const rows = await conn
    .select({
      id: deliveryAgents.id,
      code: deliveryAgents.code,
      name: users.name,
      phone: users.phone,
      territory: deliveryAgents.territory,
      branchId: deliveryAgents.branchId,
      vehicleType: deliveryAgents.vehicleType,
      vehicleNumber: deliveryAgents.vehicleNumber,
      latitude: deliveryLocationLatest.latitude,
      longitude: deliveryLocationLatest.longitude,
      accuracy: deliveryLocationLatest.accuracy,
      recordedAt: deliveryLocationLatest.recordedAt,
      receivedAt: deliveryLocationLatest.receivedAt,
      suspicious: deliveryLocationLatest.suspicious,
      sessionStartedAt: deliveryWorkSessions.startedAt,
    })
    .from(deliveryAgents)
    .innerJoin(users, eq(users.id, deliveryAgents.userId))
    .leftJoin(deliveryLocationLatest, eq(deliveryLocationLatest.deliveryAgentId, deliveryAgents.id))
    .leftJoin(deliveryWorkSessions, and(eq(deliveryWorkSessions.deliveryAgentId, deliveryAgents.id), eq(deliveryWorkSessions.status, "active")))
    .where(and(eq(deliveryAgents.companyId, companyId), eq(deliveryAgents.isActive, true)))
    .orderBy(asc(users.name));

  const today = localDate(now);
  const onRoute = await conn
    .select({
      deliveryAgentId: deliveryTasks.deliveryAgentId,
      id: deliveryTasks.id,
      number: deliveryTasks.number,
      status: deliveryTasks.status,
      startedAt: deliveryTasks.startedAt,
      customerName: customers.name,
      customerLatitude: customers.latitude,
      customerLongitude: customers.longitude,
    })
    .from(deliveryTasks)
    .innerJoin(customers, eq(customers.id, deliveryTasks.customerId))
    .where(and(eq(deliveryTasks.companyId, companyId), inArray(deliveryTasks.status, [...ON_ROUTE_DELIVERY_STATUSES])))
    .orderBy(desc(deliveryTasks.startedAt));
  const progress = await conn
    .select({
      deliveryAgentId: deliveryTasks.deliveryAgentId,
      total: sql<number>`count(*)::int`,
      done: sql<number>`count(*) filter (where ${deliveryTasks.status} in ('delivered', 'partially_delivered', 'failed', 'returned'))::int`,
    })
    .from(deliveryTasks)
    .where(and(eq(deliveryTasks.companyId, companyId), eq(deliveryTasks.scheduledDate, today), ne(deliveryTasks.status, "cancelled")))
    .groupBy(deliveryTasks.deliveryAgentId);

  const onlineSince = now.getTime() - DELIVERY_ONLINE_MINUTES * 60_000;
  return rows.map((row) => {
    const current = onRoute.find((task) => task.deliveryAgentId === row.id) ?? null;
    const today = progress.find((item) => item.deliveryAgentId === row.id);
    return {
      ...row,
      onDuty: row.sessionStartedAt !== null,
      online: row.sessionStartedAt !== null && row.receivedAt !== null && row.receivedAt.getTime() >= onlineSince,
      currentTask: current && {
        id: current.id,
        number: current.number,
        status: current.status,
        customerName: current.customerName,
        customerLatitude: current.customerLatitude,
        customerLongitude: current.customerLongitude,
      },
      today: { total: today?.total ?? 0, done: today?.done ?? 0 },
    };
  });
}

/** Agentning kunlik izi (mahalliy kun): nuqtalar, ish sessiyalari, joyli hodisalar. Har ko'rish auditga yoziladi. */
export async function deliveryAgentTrack(tenant: TenantContext, deliveryAgentId: string, date: string, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const [agent] = await db
    .select({ id: deliveryAgents.id, name: users.name })
    .from(deliveryAgents)
    .innerJoin(users, eq(users.id, deliveryAgents.userId))
    .where(and(eq(deliveryAgents.id, deliveryAgentId), eq(deliveryAgents.companyId, companyId)))
    .limit(1);
  if (!agent) throw notFound("Yetkazuvchi agent topilmadi");
  const from = localDayStart(date);
  const to = new Date(from.getTime() + 86_400_000);

  const points = await db
    .select({
      latitude: deliveryLocations.latitude,
      longitude: deliveryLocations.longitude,
      accuracy: deliveryLocations.accuracy,
      recordedAt: deliveryLocations.recordedAt,
      suspicious: deliveryLocations.suspicious,
    })
    .from(deliveryLocations)
    .where(
      and(
        eq(deliveryLocations.companyId, companyId),
        eq(deliveryLocations.deliveryAgentId, agent.id),
        gte(deliveryLocations.recordedAt, from),
        lt(deliveryLocations.recordedAt, to),
      ),
    )
    .orderBy(asc(deliveryLocations.recordedAt))
    .limit(HISTORY_POINTS_MAX);
  const sessions = await db
    .select(sessionFields)
    .from(deliveryWorkSessions)
    .where(and(eq(deliveryWorkSessions.deliveryAgentId, agent.id), gte(deliveryWorkSessions.startedAt, new Date(from.getTime() - 16 * 3_600_000)), lt(deliveryWorkSessions.startedAt, to)))
    .orderBy(asc(deliveryWorkSessions.startedAt));
  const events = await db
    .select({
      taskId: deliveryEvents.taskId,
      number: deliveryTasks.number,
      action: deliveryEvents.action,
      latitude: deliveryEvents.latitude,
      longitude: deliveryEvents.longitude,
      distanceMeters: deliveryEvents.distanceMeters,
      occurredAt: deliveryEvents.occurredAt,
    })
    .from(deliveryEvents)
    .innerJoin(deliveryTasks, eq(deliveryTasks.id, deliveryEvents.taskId))
    .where(
      and(
        eq(deliveryEvents.companyId, companyId),
        eq(deliveryTasks.deliveryAgentId, agent.id),
        gte(deliveryEvents.occurredAt, from),
        lt(deliveryEvents.occurredAt, to),
        sql`${deliveryEvents.latitude} is not null`,
      ),
    )
    .orderBy(asc(deliveryEvents.occurredAt));

  await writeAuditLog({
    userId: tenant.user.id,
    userName: tenant.user.name,
    companyId,
    action: "LOCATION_HISTORY_VIEWED",
    resource: "delivery_agents",
    resourceId: agent.id,
    details: { date, points: points.length },
    ...meta,
  });
  return { agent, date, points, sessions, events };
}
