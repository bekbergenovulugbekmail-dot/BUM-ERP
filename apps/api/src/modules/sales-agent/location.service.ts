/**
 * Agent lokatsiyasi: qabul qilish (sifat tekshiruvi), oxirgi joy, hodisalar va saqlash muddati.
 *
 * Tekshiruvlar (serverda, mijozning "ichida"/"masofa" qiymatiga ishonilmaydi):
 *  - noto'g'ri koordinata yoki kelajakdagi vaqt — rad (`invalid`)
 *  - siyosatdagi muddatdan eski — rad (`stale`)
 *  - aniqligi siyosatdagi chegaradan yomon — rad (`low_accuracy`), agent qayta urinadi
 *  - oldingi nuqtadan imkonsiz tezlikdagi sakrash (`jump`) yoki qurilma soxta GPS belgisi (`mock`) —
 *    nuqta saqlanadi, lekin shubhali deb belgilanadi. Soxta GPS'ni 100% aniqlab bo'lmaydi.
 * Rad etilgan va shubhali holatlar `agent_location_events` ga yoziladi (supervayzer ko'radi).
 */
import { and, eq, sql } from "drizzle-orm";
import { DEFAULT_SALES_AGENT_POLICY, rateLimited, type SalesAgentPolicy } from "@bum/shared";
import { customers } from "../../db/schema/sales.js";
import { agentLocationEvents, agentLocationLatest, agentLocations, agentVisits } from "../../db/schema/sales-agent.js";
import type { Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { distanceMeters, isValidCoordinate, pointOf } from "../../shared/geo.js";
import { recordHit } from "../../shared/rate-limit.js";
import type { AgentContext } from "./agent-context.js";
import { SALES_AGENT_POLICY_KEY, getSalesAgentPolicy } from "./policy.service.js";
import { requireWorkSession } from "./work-session.repo.js";

export type LocationEventType = (typeof agentLocationEvents.type.enumValues)[number];

export type LocationInput = {
  latitude: number;
  longitude: number;
  /** Aniqlik radiusi, metr. */
  accuracy: number;
  recordedAt: Date;
  /** Qurilma soxta lokatsiya belgisini bersa (native ilovada). */
  mocked?: boolean;
};

export type LocationRejection = { reason: LocationEventType; message: string };

export type LocationResult =
  | { accepted: true; suspicious: boolean; flags: LocationEventType[]; nextIntervalSeconds: number }
  | ({ accepted: false; nextIntervalSeconds: number } & LocationRejection);

/** Bir agentdan daqiqasiga shuncha nuqta (kuzatuv odatda 1 ta). */
const LOCATIONS_PER_MINUTE = 12;
const PROBLEMS_PER_MINUTE = 10;
/** Qurilma soati shunchalik oldinda bo'lsa ham qabul (soniya). */
const FUTURE_TOLERANCE_SECONDS = 60;
/** Bundan qisqa "sakrash" — GPS shovqini. */
const MIN_JUMP_METERS = 1000;

const ageSecondsOf = (input: LocationInput, now: number) => (now - input.recordedAt.getTime()) / 1000;

/** Siyosat bo'yicha sifat tekshiruvi — lokatsiya kuzatuvi, tashrif va buyurtmada bir xil. */
export function checkLocationQuality(policy: SalesAgentPolicy, input: LocationInput, now = Date.now()): LocationRejection | null {
  const ageSeconds = ageSecondsOf(input, now);
  if (!isValidCoordinate(input)) return { reason: "invalid", message: "Koordinata noto'g'ri" };
  if (ageSeconds < -FUTURE_TOLERANCE_SECONDS) {
    return { reason: "invalid", message: "Qurilma vaqti noto'g'ri — telefon soatini tekshiring" };
  }
  if (ageSeconds > policy.maxLocationAgeSeconds) return { reason: "stale", message: "Lokatsiya eskirgan — qayta aniqlang" };
  if (input.accuracy > policy.maxAccuracyMeters) {
    return { reason: "low_accuracy", message: "Lokatsiya aniqligi yetarli emas. Ochiqroq joyda qayta urinib ko'ring." };
  }
  return null;
}

export async function insertLocationEvent(
  tx: Tx,
  context: AgentContext,
  type: LocationEventType,
  point: Pick<LocationInput, "latitude" | "longitude" | "accuracy"> | null,
  details: Record<string, unknown>,
) {
  const valid = point && isValidCoordinate(point);
  await tx.insert(agentLocationEvents).values({
    companyId: context.company.id,
    salesRepId: context.agent.id,
    userId: context.user.id,
    type,
    latitude: valid ? point.latitude.toFixed(6) : null,
    longitude: valid ? point.longitude.toFixed(6) : null,
    accuracy: point && Number.isFinite(point.accuracy) ? point.accuracy.toFixed(2) : null,
    details,
  });
}

export async function recordAgentLocation(tx: Tx, context: AgentContext, input: LocationInput): Promise<LocationResult> {
  if ((await recordHit(`agent-location:${context.agent.id}`, 60)) > LOCATIONS_PER_MINUTE) throw rateLimited();
  // Shaxsiy vaqtdagi lokatsiya hech qachon saqlanmaydi
  const session = await requireWorkSession(tx, context.agent.id);
  const policy = await getSalesAgentPolicy(tx, context.company.id);

  const rejection = checkLocationQuality(policy, input);
  if (rejection) {
    await insertLocationEvent(tx, context, rejection.reason, input, {
      ageSeconds: Math.round(ageSecondsOf(input, Date.now())),
      maxAccuracyMeters: policy.maxAccuracyMeters,
      maxLocationAgeSeconds: policy.maxLocationAgeSeconds,
    });
    return { accepted: false, ...rejection, nextIntervalSeconds: policy.trackingIntervalSeconds };
  }

  const [latest] = await tx
    .select()
    .from(agentLocationLatest)
    .where(eq(agentLocationLatest.salesRepId, context.agent.id))
    .limit(1)
    .for("update");

  const flags: LocationEventType[] = [];
  if (input.mocked) flags.push("mock");
  const previous = latest ? pointOf(latest.latitude, latest.longitude) : null;
  let jumpDetails: Record<string, unknown> = {};
  if (latest && previous) {
    const hours = (input.recordedAt.getTime() - latest.recordedAt.getTime()) / 3_600_000;
    const meters = distanceMeters(previous, input);
    const speedKmh = hours > 0 ? meters / 1000 / hours : 0;
    if (hours > 0 && meters > MIN_JUMP_METERS && speedKmh > policy.maxJumpSpeedKmh) {
      flags.push("jump");
      jumpDetails = { fromLatitude: previous.latitude, fromLongitude: previous.longitude, meters: Math.round(meters), speedKmh: Math.round(speedKmh) };
    }
  }
  for (const flag of flags) await insertLocationEvent(tx, context, flag, input, flag === "jump" ? jumpDetails : {});

  const values = {
    latitude: input.latitude.toFixed(6),
    longitude: input.longitude.toFixed(6),
    accuracy: input.accuracy.toFixed(2),
    recordedAt: input.recordedAt,
    suspicious: flags.length > 0,
  };
  await tx.insert(agentLocations).values({
    companyId: context.company.id,
    salesRepId: context.agent.id,
    userId: context.user.id,
    workSessionId: session.id,
    ...values,
  });
  // Kechikib kelgan (eskiroq) nuqta oxirgi joyni almashtirmaydi
  if (!latest || input.recordedAt > latest.recordedAt) {
    const now = new Date();
    await tx
      .insert(agentLocationLatest)
      .values({ companyId: context.company.id, salesRepId: context.agent.id, ...values, receivedAt: now })
      .onConflictDoUpdate({ target: agentLocationLatest.salesRepId, set: { ...values, receivedAt: now } });
  }
  // Shubhali (sakrash, soxta GPS) nuqta tashrif holatini o'zgartirmaydi
  if (flags.length === 0) await trackVisitGeofence(tx, context, policy, input);
  return { accepted: true, suspicious: flags.length > 0, flags, nextIntervalSeconds: policy.trackingIntervalSeconds };
}

/**
 * Ochiq tashrif paytida do'kon hududidan chiqish va qaytish: chiqishda hodisa `visit_exit` va audit
 * `VISIT_OUTSIDE_GEOFENCE`; "pause" — tashqaridagi vaqt tashrif vaqtidan chiqariladi, "invalidate" — tashrif
 * buyurtmaga yaroqsiz bo'ladi, "flag" — faqat qayd.
 */
async function trackVisitGeofence(tx: Tx, context: AgentContext, policy: SalesAgentPolicy, input: LocationInput) {
  const [visit] = await tx
    .select({
      id: agentVisits.id,
      customerId: agentVisits.customerId,
      outsideSince: agentVisits.outsideSince,
      invalidatedAt: agentVisits.invalidatedAt,
      storeLatitude: customers.latitude,
      storeLongitude: customers.longitude,
    })
    .from(agentVisits)
    .innerJoin(customers, eq(customers.id, agentVisits.customerId))
    .where(and(eq(agentVisits.salesRepId, context.agent.id), eq(agentVisits.status, "in_progress")))
    .limit(1)
    .for("update", { of: agentVisits });
  if (!visit || visit.invalidatedAt) return;
  const store = pointOf(visit.storeLatitude, visit.storeLongitude);
  if (!store) return;

  const distance = Math.round(distanceMeters(input, store));
  const outside = distance > policy.geofenceRadiusMeters;
  const now = new Date();
  if (outside && !visit.outsideSince) {
    await tx
      .update(agentVisits)
      .set({
        outsideSince: now,
        outsideCount: sql`${agentVisits.outsideCount} + 1`,
        invalidatedAt: policy.visitExitPolicy === "invalidate" ? now : null,
        updatedAt: now,
      })
      .where(eq(agentVisits.id, visit.id));
    const details = {
      visitId: visit.id,
      customerId: visit.customerId,
      distanceMeters: distance,
      radiusMeters: policy.geofenceRadiusMeters,
      exitPolicy: policy.visitExitPolicy,
    };
    await insertLocationEvent(tx, context, "visit_exit", input, details);
    await writeAuditLog(
      {
        userId: context.user.id,
        userName: context.user.name,
        companyId: context.company.id,
        action: "VISIT_OUTSIDE_GEOFENCE",
        resource: "agent_visits",
        resourceId: visit.id,
        severity: "warning",
        details,
      },
      tx,
    );
  } else if (!outside && visit.outsideSince) {
    const paused = policy.visitExitPolicy === "pause" ? Math.max(0, Math.round((now.getTime() - visit.outsideSince.getTime()) / 1000)) : 0;
    await tx
      .update(agentVisits)
      .set({ outsideSince: null, pausedSeconds: sql`${agentVisits.pausedSeconds} + ${paused}`, updatedAt: now })
      .where(eq(agentVisits.id, visit.id));
  }
}

/** Agent qurilmasi xabari: lokatsiyaga ruxsat berilmadi yoki aniqlab bo'lmadi. */
export async function reportLocationProblem(
  tx: Tx,
  context: AgentContext,
  input: { type: "permission_denied" | "update_failure"; message?: string | null },
  meta: RequestMeta,
) {
  if ((await recordHit(`agent-location-problem:${context.agent.id}`, 60)) > PROBLEMS_PER_MINUTE) throw rateLimited();
  const details = input.message ? { message: input.message } : {};
  await insertLocationEvent(tx, context, input.type, null, details);
  await writeAuditLog(
    {
      userId: context.user.id,
      userName: context.user.name,
      companyId: context.company.id,
      action: input.type === "permission_denied" ? "LOCATION_PERMISSION_DENIED" : "LOCATION_UPDATE_FAILURE",
      resource: "sales_reps",
      resourceId: context.agent.id,
      severity: "warning",
      details,
      ...meta,
    },
    tx,
  );
}

/** Sozlama matnidan saqlash kunlari (JSON buzilgan bo'lsa ham topiladi). */
const RETENTION_PATTERN = '"locationRetentionDays"\\s*:\\s*(\\d+)';

/**
 * Saqlash muddati: kompaniya siyosatidagi kundan (standart 90, kamida 7) eski nuqtalar va hodisalar o'chiriladi.
 * Sozlama JSON'i buzilgan bo'lsa ham ishlaydi (qiymat matndan olinadi). Oxirgi joy (`latest`) qoladi.
 */
export async function purgeAgentLocations(tx: Tx, now = new Date()) {
  const cutoff = sql`${now.toISOString()}::timestamptz - make_interval(days => greatest(7, coalesce(nullif(substring(s."value" from ${RETENTION_PATTERN}), '')::int, ${DEFAULT_SALES_AGENT_POLICY.locationRetentionDays}::int)))`;
  const locations = await tx.execute(sql`
    delete from "agent_locations" al
     using "companies" c
      left join "settings" s on s."company_id" = c."id" and s."key" = ${SALES_AGENT_POLICY_KEY}
     where al."company_id" = c."id" and al."recorded_at" < ${cutoff}`);
  const events = await tx.execute(sql`
    delete from "agent_location_events" ale
     using "companies" c
      left join "settings" s on s."company_id" = c."id" and s."key" = ${SALES_AGENT_POLICY_KEY}
     where ale."company_id" = c."id" and ale."occurred_at" < ${cutoff}`);
  return { agentLocations: locations.rowCount ?? 0, agentLocationEvents: events.rowCount ?? 0 };
}
