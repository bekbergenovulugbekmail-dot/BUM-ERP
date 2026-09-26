/**
 * Do'konga tashrif (`agent_visits`).
 *
 *  - Boshlash: ish sessiyasi, do'kon agentga ochiq bo'lishi, joy sifati (siyosat) va geofence serverda tekshiriladi.
 *    Rad etilsa hodisa (va geofence uchun audit) saqlanadi — shuning uchun xato tranzaksiya yakunlangach qaytariladi
 *    (`VisitOutcome`). Bir agentda bitta ochiq tashrif (agent qatori qulflanadi, unikal indeks ham bor).
 *  - Rasmlar (faqat do'kon hududida, joy bilan): avval vitrina — taymer shundan boshlanadi, keyin polka va boshqalar.
 *    Fayl saqlash (S3) bo'lsa imzolangan yuklash, bo'lmasa kichik JPEG/PNG/WebP bazada (turi baytlardan aniqlanadi);
 *    ko'rish — imzolangan havola yoki autentifikatsiyali endpoint (ochiq URL yo'q).
 *  - Hududdan chiqish (`location.service` nuqtalaridan): pause — tashqaridagi vaqt hisoblanmaydi, invalidate — tashrif
 *    buyurtmaga yaroqsiz, flag — faqat qayd.
 *  - Yakunlash (BUYURTMA YO'Q): sabab ("Boshqa" — izoh bilan), vitrina rasmi; polka rasmi va minimal vaqt — "Do'kon
 *    yopiq" dan tashqari. Buyurtma bilan yakunlash — buyurtma yuborilganda (`finishVisitWithOrder`).
 * Sana va vaqt — server; agent faqat o'z tashriflarini, supervayzer — kompaniyaniki ko'radi.
 */
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { AppError, badRequest, conflict, notFound, type SalesAgentPolicy } from "@bum/shared";
import { salesReps } from "../../db/schema/crm.js";
import { customers, salesOrders } from "../../db/schema/sales.js";
import { agentOrders, agentVisitPhotos, agentVisits } from "../../db/schema/sales-agent.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type AuditEntry, type RequestMeta } from "../../shared/audit.js";
import { distanceMeters, pointOf } from "../../shared/geo.js";
import type { StorageClient } from "../../shared/storage.js";
import type { TenantContext } from "../company/tenant.js";
import { IMAGE_TYPES, MB, assertUploadKey, headUpload, signUpload } from "../files/files.service.js";
import { todayIso } from "../finance/cash.service.js";
import type { AgentContext } from "./agent-context.js";
import { checkLocationQuality, insertLocationEvent, type LocationInput } from "./location.service.js";
import { getSalesAgentPolicy } from "./policy.service.js";
import { accessibleStore } from "./stores.service.js";
import { requireWorkSession } from "./work-session.repo.js";

export type NoOrderReason = (typeof agentVisits.noOrderReason.enumValues)[number];
export type VisitPhotoKind = (typeof agentVisitPhotos.kind.enumValues)[number];
export type StoreVisitStatus = "waiting" | "in_progress" | "ordered" | "visited_no_order";

/** Rad etish hodisasi saqlanishi uchun xato tranzaksiyadan keyin tashlanadi. */
export type VisitOutcome<T> = { visit: T } | { blocked: AppError };

const PHOTO_RULES = { maxBytes: 8 * MB, types: IMAGE_TYPES };
/** Bazada saqlanadigan rasm (S3 yo'q) — mijoz 1280 px JPEG ga siqadi, odatda 100–300 KB. */
export const DIRECT_PHOTO_MAX_BYTES = 3 * MB;
const MAX_PHOTOS_PER_VISIT = 20;
const DATABASE_KEY_PREFIX = "db/";
const photoPrefix = (companyId: string) => `companies/${companyId}/visit-photo/`;

const visitFields = {
  id: agentVisits.id,
  salesRepId: agentVisits.salesRepId,
  salesRepName: salesReps.name,
  customerId: agentVisits.customerId,
  customerName: customers.name,
  routeId: agentVisits.routeId,
  visitDate: agentVisits.visitDate,
  status: agentVisits.status,
  result: agentVisits.result,
  startedAt: agentVisits.startedAt,
  completedAt: agentVisits.completedAt,
  durationSeconds: agentVisits.durationSeconds,
  timerStartedAt: agentVisits.timerStartedAt,
  pausedSeconds: agentVisits.pausedSeconds,
  outsideSince: agentVisits.outsideSince,
  outsideCount: agentVisits.outsideCount,
  invalidatedAt: agentVisits.invalidatedAt,
  startDistanceMeters: agentVisits.startDistanceMeters,
  endDistanceMeters: agentVisits.endDistanceMeters,
  noOrderReason: agentVisits.noOrderReason,
  noOrderComment: agentVisits.noOrderComment,
  notes: agentVisits.notes,
};

/** Yozish amallari uchun qulflanadigan tashrif maydonlari. */
const lockedFields = {
  id: agentVisits.id,
  customerId: agentVisits.customerId,
  status: agentVisits.status,
  startedAt: agentVisits.startedAt,
  timerStartedAt: agentVisits.timerStartedAt,
  pausedSeconds: agentVisits.pausedSeconds,
  outsideSince: agentVisits.outsideSince,
  invalidatedAt: agentVisits.invalidatedAt,
};
export type LockedVisit = {
  id: string;
  customerId: string;
  status: "in_progress" | "completed";
  startedAt: Date;
  timerStartedAt: Date | null;
  pausedSeconds: number;
  outsideSince: Date | null;
  invalidatedAt: Date | null;
};

type VisitFilter = {
  salesRepId?: string;
  /** Supervayzer jamoasi chegarasi (`null`/yo'q — chegara yo'q). */
  salesRepIds?: string[] | null;
  visitId?: string;
  customerId?: string;
  date?: string;
  status?: "in_progress" | "completed";
};

async function findVisits(conn: DbOrTx, companyId: string, filter: VisitFilter, limit: number) {
  const rows = await conn
    .select(visitFields)
    .from(agentVisits)
    .innerJoin(customers, eq(customers.id, agentVisits.customerId))
    .innerJoin(salesReps, eq(salesReps.id, agentVisits.salesRepId))
    .where(
      and(
        eq(agentVisits.companyId, companyId),
        filter.salesRepId ? eq(agentVisits.salesRepId, filter.salesRepId) : undefined,
        filter.salesRepIds ? (filter.salesRepIds.length > 0 ? inArray(agentVisits.salesRepId, filter.salesRepIds) : sql`false`) : undefined,
        filter.visitId ? eq(agentVisits.id, filter.visitId) : undefined,
        filter.customerId ? eq(agentVisits.customerId, filter.customerId) : undefined,
        filter.date ? eq(agentVisits.visitDate, filter.date) : undefined,
        filter.status ? eq(agentVisits.status, filter.status) : undefined,
      ),
    )
    .orderBy(desc(agentVisits.startedAt))
    .limit(limit);
  if (rows.length === 0) return [];

  const photos = await conn
    .select({ id: agentVisitPhotos.id, visitId: agentVisitPhotos.visitId, kind: agentVisitPhotos.kind, takenAt: agentVisitPhotos.takenAt })
    .from(agentVisitPhotos)
    .where(inArray(agentVisitPhotos.visitId, rows.map((row) => row.id)))
    .orderBy(asc(agentVisitPhotos.takenAt));
  const byVisit = new Map<string, { id: string; kind: VisitPhotoKind; takenAt: Date }[]>();
  for (const { visitId, ...photo } of photos) byVisit.set(visitId, [...(byVisit.get(visitId) ?? []), photo]);
  return rows.map((row) => ({ ...row, photos: byVisit.get(row.id) ?? [] }));
}

export type VisitView = Awaited<ReturnType<typeof findVisits>>[number];

async function visitById(conn: DbOrTx, companyId: string, visitId: string): Promise<VisitView> {
  const [visit] = await findVisits(conn, companyId, { visitId }, 1);
  if (!visit) throw notFound("Tashrif topilmadi");
  return visit;
}

function audit(tx: Tx, context: AgentContext, meta: RequestMeta, entry: Omit<AuditEntry, "userId" | "userName" | "companyId">) {
  return writeAuditLog(
    { userId: context.user.id, userName: context.user.name, companyId: context.company.id, ...entry, ...meta },
    tx,
  );
}

const storeDistance = (store: { latitude: string | null; longitude: string | null } | undefined, point: { latitude: number; longitude: number }) => {
  const storePoint = store ? pointOf(store.latitude, store.longitude) : null;
  return storePoint ? Math.round(distanceMeters(point, storePoint)) : null;
};

async function storeOf(conn: DbOrTx, customerId: string) {
  const [store] = await conn
    .select({ latitude: customers.latitude, longitude: customers.longitude })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  return store;
}

// ─── Vaqt va tayyorlik ───────────────────────────────────────────────────────

/**
 * Hisoblanadigan tashrif vaqti, soniya: vitrina rasmidan (vitrina talab qilinmasa — boshlanishdan), "pause" siyosatida
 * hududdan tashqarida o'tgan (va hozir tashqarida o'tayotgan) vaqtsiz.
 */
export function effectiveVisitSeconds(
  visit: Pick<LockedVisit, "startedAt" | "timerStartedAt" | "pausedSeconds" | "outsideSince">,
  policy: Pick<SalesAgentPolicy, "storefrontPhotoRequired" | "visitExitPolicy">,
  now = new Date(),
): number {
  const start = visit.timerStartedAt ?? (policy.storefrontPhotoRequired ? null : visit.startedAt);
  if (!start) return 0;
  const outside =
    policy.visitExitPolicy === "pause" && visit.outsideSince ? Math.max(0, now.getTime() - visit.outsideSince.getTime()) / 1000 : 0;
  return Math.max(0, Math.floor((now.getTime() - start.getTime()) / 1000 - visit.pausedSeconds - outside));
}

async function photoKinds(conn: DbOrTx, visitId: string) {
  const rows = await conn.select({ kind: agentVisitPhotos.kind }).from(agentVisitPhotos).where(eq(agentVisitPhotos.visitId, visitId));
  return new Set(rows.map((row) => row.kind));
}

/** Buyurtma yuborish va buyurtmasiz yakunlashdan oldin: majburiy rasmlar va minimal vaqt (siyosat bo'yicha). */
export async function assertVisitReady(
  conn: DbOrTx,
  visit: LockedVisit,
  policy: SalesAgentPolicy,
  require: { shelf: boolean; duration: boolean },
  now = new Date(),
) {
  const kinds = await photoKinds(conn, visit.id);
  if (policy.storefrontPhotoRequired && !kinds.has("storefront")) {
    throw badRequest("Avval do'kon vitrinasi rasmini oling", { reason: "storefront_photo_required" });
  }
  if (require.shelf && policy.shelfPhotoRequired && !kinds.has("shelf")) {
    throw badRequest("Polka (javon) rasmini oling", { reason: "shelf_photo_required" });
  }
  if (require.duration && policy.minVisitMinutes > 0) {
    const remainingSeconds = policy.minVisitMinutes * 60 - effectiveVisitSeconds(visit, policy, now);
    if (remainingSeconds > 0) {
      throw badRequest(
        `Tashrif kamida ${policy.minVisitMinutes} daqiqa davom etadi — yana ${Math.ceil(remainingSeconds / 60)} daqiqa`,
        { reason: "visit_too_short", remainingSeconds, minVisitMinutes: policy.minVisitMinutes },
      );
    }
  }
}

// ─── Boshlash va yakunlash ───────────────────────────────────────────────────

export async function startVisit(
  tx: Tx,
  context: AgentContext,
  input: LocationInput & { customerId: string },
  meta: RequestMeta,
): Promise<VisitOutcome<VisitView>> {
  const store = await accessibleStore(tx, context, input.customerId);
  await requireWorkSession(tx, context.agent.id);
  // Bir agentning parallel "boshlash" so'rovlari navbatma-navbat
  await tx.select({ id: salesReps.id }).from(salesReps).where(eq(salesReps.id, context.agent.id)).for("update");
  const policy = await getSalesAgentPolicy(tx, context.company.id);

  const rejection = checkLocationQuality(policy, input);
  if (rejection) {
    await insertLocationEvent(tx, context, rejection.reason, input, { action: "visit_start", customerId: store.id });
    return { blocked: badRequest(rejection.message, { reason: rejection.reason }) };
  }

  const distance = storeDistance(store, input);
  if (distance !== null && distance > policy.geofenceRadiusMeters) {
    const details = { action: "visit_start", customerId: store.id, distanceMeters: distance, radiusMeters: policy.geofenceRadiusMeters };
    await insertLocationEvent(tx, context, "geofence_block", input, details);
    await audit(tx, context, meta, { action: "GEOFENCE_BLOCK", resource: "customers", resourceId: store.id, severity: "warning", details });
    return {
      blocked: new AppError(
        "FORBIDDEN",
        `Siz do'kondan ${distance} m uzoqdasiz — tashrif ${policy.geofenceRadiusMeters} m ichida boshlanadi`,
        { reason: "geofence", distanceMeters: distance, radiusMeters: policy.geofenceRadiusMeters },
      ),
    };
  }

  const [open] = await findVisits(tx, context.company.id, { salesRepId: context.agent.id, status: "in_progress" }, 1);
  if (open) throw conflict(`"${open.customerName}" do'konida ochiq tashrif bor — avval uni yakunlang`);

  const now = new Date();
  const [created] = await tx
    .insert(agentVisits)
    .values({
      companyId: context.company.id,
      salesRepId: context.agent.id,
      userId: context.user.id,
      customerId: store.id,
      routeId: store.routeId,
      visitDate: todayIso(),
      startedAt: now,
      // Vitrina rasmi talab qilinmasa taymer darhol boshlanadi
      timerStartedAt: policy.storefrontPhotoRequired ? null : now,
      startLatitude: input.latitude.toFixed(6),
      startLongitude: input.longitude.toFixed(6),
      startAccuracy: input.accuracy.toFixed(2),
      startDistanceMeters: distance,
    })
    .returning({ id: agentVisits.id });
  await audit(tx, context, meta, {
    action: "VISIT_START",
    resource: "agent_visits",
    resourceId: created!.id,
    details: { customerId: store.id, distanceMeters: distance },
  });
  return { visit: await visitById(tx, context.company.id, created!.id) };
}

type CloseFields = { result: "ordered" | "no_order"; reason: NoOrderReason | null; comment: string | null; notes: string | null };

async function closeVisit(
  tx: Tx,
  context: AgentContext,
  visit: LockedVisit,
  policy: SalesAgentPolicy,
  input: LocationInput,
  distance: number | null,
  fields: CloseFields,
  meta: RequestMeta,
) {
  const now = new Date();
  const outsidePaused =
    policy.visitExitPolicy === "pause" && visit.outsideSince ? Math.round((now.getTime() - visit.outsideSince.getTime()) / 1000) : 0;
  const durationSeconds =
    visit.timerStartedAt || !policy.storefrontPhotoRequired
      ? effectiveVisitSeconds(visit, policy, now)
      : Math.max(0, Math.round((now.getTime() - visit.startedAt.getTime()) / 1000));

  await tx
    .update(agentVisits)
    .set({
      status: "completed",
      result: fields.result,
      completedAt: now,
      endLatitude: input.latitude.toFixed(6),
      endLongitude: input.longitude.toFixed(6),
      endAccuracy: input.accuracy.toFixed(2),
      endDistanceMeters: distance,
      durationSeconds,
      pausedSeconds: visit.pausedSeconds + Math.max(0, outsidePaused),
      outsideSince: null,
      noOrderReason: fields.reason,
      noOrderComment: fields.comment,
      notes: fields.notes,
      updatedAt: now,
    })
    .where(eq(agentVisits.id, visit.id));
  await audit(tx, context, meta, {
    action: "VISIT_END",
    resource: "agent_visits",
    resourceId: visit.id,
    details: { customerId: visit.customerId, result: fields.result, durationSeconds, distanceMeters: distance, invalid: visit.invalidatedAt !== null },
  });
}

export type CompleteVisitInput = LocationInput & {
  noOrderReason?: NoOrderReason;
  noOrderComment?: string;
  notes?: string;
};

export async function completeVisit(
  tx: Tx,
  context: AgentContext,
  visitId: string,
  input: CompleteVisitInput,
  meta: RequestMeta,
): Promise<VisitOutcome<VisitView>> {
  const [visit] = await tx
    .select(lockedFields)
    .from(agentVisits)
    .where(and(eq(agentVisits.id, visitId), eq(agentVisits.companyId, context.company.id), eq(agentVisits.salesRepId, context.agent.id)))
    .limit(1)
    .for("update");
  if (!visit) throw notFound("Tashrif topilmadi");
  if (visit.status !== "in_progress") throw conflict("Tashrif allaqachon yakunlangan");
  await requireWorkSession(tx, context.agent.id);

  const policy = await getSalesAgentPolicy(tx, context.company.id);
  const rejection = checkLocationQuality(policy, input);
  if (rejection) {
    await insertLocationEvent(tx, context, rejection.reason, input, { action: "visit_complete", visitId: visit.id });
    return { blocked: badRequest(rejection.message, { reason: rejection.reason }) };
  }

  // Tashrifda yuborilgan (tasdiqlangan yoki tasdiq kutayotgan) buyurtma bo'lsa — natija "ordered", sabab talab qilinmaydi
  const [linked] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(agentOrders)
    .innerJoin(salesOrders, eq(salesOrders.id, agentOrders.orderId))
    .where(and(eq(agentOrders.visitId, visit.id), isNotNull(agentOrders.submittedAt), ne(salesOrders.status, "cancelled")));
  const ordered = linked!.count > 0;
  // Hududdan chiqib bekor bo'lgan tashrif — sababsiz yopiladi (supervayzer "bekor" belgisini ko'radi)
  const invalid = visit.invalidatedAt !== null;
  const comment = ordered ? null : input.noOrderComment?.trim() || null;
  const reason = ordered ? null : (input.noOrderReason ?? null);
  if (!ordered && !invalid && !reason) {
    throw badRequest("Buyurtma bo'lmagan tashrif uchun sababni tanlang", { reason: "no_order_reason_required" });
  }
  if (reason === "other" && (comment?.length ?? 0) < 3) {
    throw badRequest("\"Boshqa\" sababi uchun izoh yozing", { reason: "comment_required" });
  }
  if (!ordered && !invalid) {
    const closed = reason === "store_closed";
    await assertVisitReady(tx, visit, policy, { shelf: !closed, duration: !closed });
  }

  const distance = storeDistance(await storeOf(tx, visit.customerId), input);
  const result = ordered ? "ordered" : "no_order";
  await closeVisit(tx, context, visit, policy, input, distance, { result, reason, comment, notes: input.notes?.trim() || null }, meta);
  if (!ordered) {
    await audit(tx, context, meta, {
      action: "NO_ORDER",
      resource: "agent_visits",
      resourceId: visit.id,
      details: { customerId: visit.customerId, reason, comment },
    });
  }
  return { visit: await visitById(tx, context.company.id, visit.id) };
}

/** Buyurtma uchun: agentning shu do'kondagi ochiq tashrifi (qulflangan). */
export async function openStoreVisit(tx: Tx, salesRepId: string, customerId: string): Promise<LockedVisit | null> {
  const [visit] = await tx
    .select(lockedFields)
    .from(agentVisits)
    .where(and(eq(agentVisits.salesRepId, salesRepId), eq(agentVisits.customerId, customerId), eq(agentVisits.status, "in_progress")))
    .limit(1)
    .for("update");
  return visit ?? null;
}

/** Buyurtma yuborilgach tashrif "ordered" natija bilan yopiladi (siyosat buyurtmani tashrifga bog'lasa). */
export function finishVisitWithOrder(
  tx: Tx,
  context: AgentContext,
  visit: LockedVisit,
  policy: SalesAgentPolicy,
  input: LocationInput,
  distance: number,
  meta: RequestMeta,
) {
  return closeVisit(tx, context, visit, policy, input, distance, { result: "ordered", reason: null, comment: null, notes: null }, meta);
}

// ─── Agent o'qishlari ────────────────────────────────────────────────────────

export async function currentVisit(conn: DbOrTx, context: AgentContext): Promise<VisitView | null> {
  const [visit] = await findVisits(conn, context.company.id, { salesRepId: context.agent.id, status: "in_progress" }, 1);
  return visit ?? null;
}

export function agentVisitsOn(conn: DbOrTx, context: AgentContext, date: string) {
  return findVisits(conn, context.company.id, { salesRepId: context.agent.id, date }, 200);
}

/** Shu do'konga bugungi oxirgi tashrif. */
export async function latestStoreVisit(conn: DbOrTx, context: AgentContext, customerId: string): Promise<VisitView | null> {
  const [visit] = await findVisits(conn, context.company.id, { salesRepId: context.agent.id, customerId, date: todayIso() }, 1);
  return visit ?? null;
}

type VisitedStatus = Exclude<StoreVisitStatus, "waiting">;
const STATUS_RANK: Record<VisitedStatus, number> = { visited_no_order: 1, ordered: 2, in_progress: 3 };

/** Bugungi marshrut do'konlari holati: ochiq tashrif > buyurtma > buyurtmasiz; tashrif bo'lmasa — ro'yxatda yo'q ("waiting"). */
export async function storeVisitStatuses(conn: DbOrTx, context: AgentContext, customerIds: string[], date: string) {
  const statuses = new Map<string, VisitedStatus>();
  if (customerIds.length === 0) return statuses;
  const rows = await conn
    .select({ customerId: agentVisits.customerId, status: agentVisits.status, result: agentVisits.result })
    .from(agentVisits)
    .where(
      and(
        eq(agentVisits.companyId, context.company.id),
        eq(agentVisits.salesRepId, context.agent.id),
        eq(agentVisits.visitDate, date),
        inArray(agentVisits.customerId, customerIds),
      ),
    );
  for (const row of rows) {
    const status: VisitedStatus = row.status === "in_progress" ? "in_progress" : row.result === "ordered" ? "ordered" : "visited_no_order";
    const previous = statuses.get(row.customerId);
    if (!previous || STATUS_RANK[status] > STATUS_RANK[previous]) statuses.set(row.customerId, status);
  }
  return statuses;
}

// ─── Rasmlar ─────────────────────────────────────────────────────────────────

export type PhotoPoint = { latitude: number; longitude: number; accuracy: number; recordedAt?: Date };

async function ownOpenVisit(conn: DbOrTx, context: AgentContext, visitId: string, lock: boolean): Promise<LockedVisit> {
  const query = conn
    .select(lockedFields)
    .from(agentVisits)
    .where(and(eq(agentVisits.id, visitId), eq(agentVisits.companyId, context.company.id), eq(agentVisits.salesRepId, context.agent.id)))
    .limit(1);
  const [visit] = lock ? await query.for("update") : await query;
  if (!visit) throw notFound("Tashrif topilmadi");
  if (visit.status !== "in_progress") throw conflict("Yakunlangan tashrifga rasm qo'shib bo'lmaydi");
  if (visit.invalidatedAt) throw badRequest("Tashrif hududdan chiqilgani uchun bekor qilingan", { reason: "visit_invalid" });
  await requireWorkSession(conn, context.agent.id);
  return visit;
}

async function assertPhotoCapacity(conn: DbOrTx, visitId: string) {
  if ((await conn.$count(agentVisitPhotos, eq(agentVisitPhotos.visitId, visitId))) >= MAX_PHOTOS_PER_VISIT) {
    throw badRequest(`Bir tashrifga ${MAX_PHOTOS_PER_VISIT} tadan ko'p rasm qo'shib bo'lmaydi`);
  }
}

/** Rasm do'kon hududida, sifatli joy bilan va vitrinadan boshlab olinadi. */
async function assertPhotoAllowed(conn: DbOrTx, context: AgentContext, visit: LockedVisit, kind: VisitPhotoKind, point: PhotoPoint) {
  const policy = await getSalesAgentPolicy(conn, context.company.id);
  const rejection = point.recordedAt
    ? checkLocationQuality(policy, { ...point, recordedAt: point.recordedAt })
    : point.accuracy > policy.maxAccuracyMeters
      ? { reason: "low_accuracy" as const, message: `GPS aniqligi past (${Math.round(point.accuracy)} m)` }
      : null;
  if (rejection) throw badRequest(rejection.message, { reason: rejection.reason });

  if (kind !== "storefront" && policy.storefrontPhotoRequired && !(await photoKinds(conn, visit.id)).has("storefront")) {
    throw badRequest("Avval do'kon vitrinasi rasmini oling", { reason: "storefront_photo_required" });
  }
  const distance = storeDistance(await storeOf(conn, visit.customerId), point);
  if (distance !== null && distance > policy.geofenceRadiusMeters) {
    throw new AppError("FORBIDDEN", `Rasm do'kon hududida olinadi — siz ${distance} m uzoqdasiz`, {
      reason: "geofence",
      distanceMeters: distance,
      radiusMeters: policy.geofenceRadiusMeters,
    });
  }
}

async function insertVisitPhoto(
  tx: Tx,
  context: AgentContext,
  visit: LockedVisit,
  input: { kind: VisitPhotoKind; storageKey: string; sizeBytes: number; point: PhotoPoint; content?: Buffer; contentType?: string },
  meta: RequestMeta,
) {
  const now = new Date();
  const [photo] = await tx
    .insert(agentVisitPhotos)
    .values({
      companyId: context.company.id,
      visitId: visit.id,
      userId: context.user.id,
      kind: input.kind,
      storageKey: input.storageKey,
      sizeBytes: input.sizeBytes,
      content: input.content ?? null,
      contentType: input.contentType ?? null,
      latitude: input.point.latitude.toFixed(6),
      longitude: input.point.longitude.toFixed(6),
      accuracy: input.point.accuracy.toFixed(2),
      takenAt: now,
    })
    .returning({ id: agentVisitPhotos.id, kind: agentVisitPhotos.kind, takenAt: agentVisitPhotos.takenAt });
  // Taymer vitrina rasmidan boshlanadi
  const timerStarted = input.kind === "storefront" && !visit.timerStartedAt;
  if (timerStarted) await tx.update(agentVisits).set({ timerStartedAt: now, updatedAt: now }).where(eq(agentVisits.id, visit.id));
  await audit(tx, context, meta, {
    action: input.kind === "storefront" ? "STORE_PHOTO" : input.kind === "shelf" ? "SHELF_PHOTO" : "VISIT_PHOTO",
    resource: "agent_visits",
    resourceId: visit.id,
    details: {
      photoId: photo!.id,
      kind: input.kind,
      customerId: visit.customerId,
      size: input.sizeBytes,
      stored: input.content ? "database" : "storage",
      timerStarted,
    },
  });
  return photo!;
}

export async function createVisitPhotoUpload(
  conn: DbOrTx,
  context: AgentContext,
  visitId: string,
  input: { contentType: string; size: number },
  client: StorageClient,
) {
  const visit = await ownOpenVisit(conn, context, visitId, false);
  await assertPhotoCapacity(conn, visit.id);
  return signUpload(client, photoPrefix(context.company.id), PHOTO_RULES, input);
}

/** S3 ga yuklangan rasmni biriktirish. */
export async function addVisitPhoto(
  tx: Tx,
  context: AgentContext,
  visitId: string,
  input: PhotoPoint & { key: string; kind: VisitPhotoKind },
  client: StorageClient,
  meta: RequestMeta,
) {
  const visit = await ownOpenVisit(tx, context, visitId, true);
  assertUploadKey(photoPrefix(context.company.id), input.key);
  const [existing] = await tx
    .select({ id: agentVisitPhotos.id })
    .from(agentVisitPhotos)
    .where(eq(agentVisitPhotos.storageKey, input.key))
    .limit(1);
  if (existing) throw conflict("Bu rasm allaqachon biriktirilgan");
  await assertPhotoCapacity(tx, visit.id);
  await assertPhotoAllowed(tx, context, visit, input.kind, input);
  const stored = await headUpload(client, PHOTO_RULES, input.key);
  return insertVisitPhoto(tx, context, visit, { kind: input.kind, storageKey: input.key, sizeBytes: stored.size, point: input }, meta);
}

/** Fayl turi baytlardan (mijoz yuborgan turga ishonilmaydi). */
export function sniffImage(bytes: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length > 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Fayl saqlash sozlanmaganda: rasm to'g'ridan-to'g'ri bazaga. */
export async function addDirectVisitPhoto(
  tx: Tx,
  context: AgentContext,
  visitId: string,
  input: PhotoPoint & { kind: VisitPhotoKind; data: Buffer },
  meta: RequestMeta,
) {
  const visit = await ownOpenVisit(tx, context, visitId, true);
  const contentType = sniffImage(input.data);
  if (!contentType || input.data.length > DIRECT_PHOTO_MAX_BYTES) {
    throw badRequest(`Rasm JPEG, PNG yoki WebP bo'lishi va ${DIRECT_PHOTO_MAX_BYTES / MB} MB dan oshmasligi kerak`, { reason: "photo_invalid" });
  }
  await assertPhotoCapacity(tx, visit.id);
  await assertPhotoAllowed(tx, context, visit, input.kind, input);
  return insertVisitPhoto(
    tx,
    context,
    visit,
    { kind: input.kind, storageKey: `${DATABASE_KEY_PREFIX}${randomUUID()}`, sizeBytes: input.data.length, point: input, content: input.data, contentType },
    meta,
  );
}

function photoScope(companyId: string, ids: { visitId: string; photoId: string }, salesRepId?: string) {
  return and(
    eq(agentVisitPhotos.id, ids.photoId),
    eq(agentVisitPhotos.visitId, ids.visitId),
    eq(agentVisits.companyId, companyId),
    salesRepId ? eq(agentVisits.salesRepId, salesRepId) : undefined,
  );
}

/** Rasm qayerda: bazada (ko'rish — autentifikatsiyali endpoint) yoki S3 da (imzolangan havola). `salesRepId` — faqat shu agentniki. */
export async function visitPhotoRef(conn: DbOrTx, companyId: string, ids: { visitId: string; photoId: string }, salesRepId?: string) {
  const [photo] = await conn
    .select({ key: agentVisitPhotos.storageKey })
    .from(agentVisitPhotos)
    .innerJoin(agentVisits, eq(agentVisits.id, agentVisitPhotos.visitId))
    .where(photoScope(companyId, ids, salesRepId))
    .limit(1);
  if (!photo) throw notFound("Rasm topilmadi");
  return { key: photo.key, inDatabase: photo.key.startsWith(DATABASE_KEY_PREFIX) };
}

export async function visitPhotoContent(conn: DbOrTx, companyId: string, ids: { visitId: string; photoId: string }, salesRepId?: string) {
  const [photo] = await conn
    .select({ content: agentVisitPhotos.content, contentType: agentVisitPhotos.contentType })
    .from(agentVisitPhotos)
    .innerJoin(agentVisits, eq(agentVisits.id, agentVisitPhotos.visitId))
    .where(photoScope(companyId, ids, salesRepId))
    .limit(1);
  if (!photo?.content || !photo.contentType) throw notFound("Rasm topilmadi");
  return { content: photo.content, contentType: photo.contentType };
}

// ─── Supervayzer ─────────────────────────────────────────────────────────────

export async function supervisorVisits(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { date: string; salesRepId?: string; salesRepIds?: string[] | null; limit: number },
) {
  const visits = await findVisits(conn, tenant.company.id, { date: options.date, salesRepId: options.salesRepId, salesRepIds: options.salesRepIds }, options.limit);
  const scope = and(
    eq(agentVisits.companyId, tenant.company.id),
    eq(agentVisits.visitDate, options.date),
    options.salesRepId ? eq(agentVisits.salesRepId, options.salesRepId) : undefined,
  );
  const [totals] = await conn
    .select({
      total: sql<number>`count(*)::int`,
      inProgress: sql<number>`(count(*) filter (where ${agentVisits.status} = 'in_progress'))::int`,
      ordered: sql<number>`(count(*) filter (where ${agentVisits.result} = 'ordered'))::int`,
      noOrder: sql<number>`(count(*) filter (where ${agentVisits.result} = 'no_order'))::int`,
    })
    .from(agentVisits)
    .where(scope);
  const reasonRows = await conn
    .select({ reason: agentVisits.noOrderReason, count: sql<number>`count(*)::int` })
    .from(agentVisits)
    .where(and(scope, eq(agentVisits.result, "no_order")))
    .groupBy(agentVisits.noOrderReason);
  const reasons: Partial<Record<NoOrderReason, number>> = {};
  for (const row of reasonRows) if (row.reason) reasons[row.reason] = row.count;
  return { visits, summary: { ...totals!, reasons } };
}
