/**
 * Do'konga tashrif (`agent_visits`).
 *
 *  - Boshlash: do'kon agentga ochiq bo'lishi, joy sifati (siyosat) va geofence serverda tekshiriladi. Rad etilsa hodisa
 *    (va geofence uchun audit) saqlanadi — shuning uchun xato tranzaksiya yakunlangach qaytariladi (`VisitOutcome`).
 *    Bir agentda bitta ochiq tashrif (agent qatori qulflanadi, unikal indeks ham bor).
 *  - Rasmlar: imzolangan yuklash; kalit shu kompaniyaning `visit-photo/` prefiksida, fayl haqiqatan yuklangan, turi va
 *    hajmi tekshiriladi; ko'rish — 5 daqiqalik imzolangan havola (ochiq URL yo'q).
 *  - Yakunlash: joy sifati, siyosat talab qilsa rasm, buyurtma bo'lmasa sabab ("Boshqa" — izoh bilan); davomiylik serverda.
 * Sana va vaqt — server; agent faqat o'z tashriflarini, supervayzer — kompaniyaniki ko'radi.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { AppError, badRequest, conflict, notFound } from "@bum/shared";
import { salesReps } from "../../db/schema/crm.js";
import { customers } from "../../db/schema/sales.js";
import { agentVisitPhotos, agentVisits } from "../../db/schema/sales-agent.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type AuditEntry, type RequestMeta } from "../../shared/audit.js";
import { distanceMeters, isValidCoordinate, pointOf } from "../../shared/geo.js";
import type { StorageClient } from "../../shared/storage.js";
import type { TenantContext } from "../company/tenant.js";
import { IMAGE_TYPES, MB, VIEW_TTL, assertUploadKey, headUpload, signUpload } from "../files/files.service.js";
import { todayIso } from "../finance/cash.service.js";
import type { AgentContext } from "./agent-context.js";
import { checkLocationQuality, insertLocationEvent, type LocationInput } from "./location.service.js";
import { getSalesAgentPolicy } from "./policy.service.js";
import { accessibleStore } from "./stores.service.js";

export type NoOrderReason = (typeof agentVisits.noOrderReason.enumValues)[number];
export type VisitPhotoKind = (typeof agentVisitPhotos.kind.enumValues)[number];
export type StoreVisitStatus = "waiting" | "in_progress" | "ordered" | "visited_no_order";

/** Rad etish hodisasi saqlanishi uchun xato tranzaksiyadan keyin tashlanadi. */
export type VisitOutcome<T> = { visit: T } | { blocked: AppError };

const PHOTO_RULES = { maxBytes: 8 * MB, types: IMAGE_TYPES };
const MAX_PHOTOS_PER_VISIT = 20;
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
  startDistanceMeters: agentVisits.startDistanceMeters,
  endDistanceMeters: agentVisits.endDistanceMeters,
  noOrderReason: agentVisits.noOrderReason,
  noOrderComment: agentVisits.noOrderComment,
  notes: agentVisits.notes,
};

type VisitFilter = {
  salesRepId?: string;
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

const storeDistance = (store: { latitude: string | null; longitude: string | null } | undefined, point: LocationInput) => {
  const storePoint = store ? pointOf(store.latitude, store.longitude) : null;
  return storePoint ? Math.round(distanceMeters(point, storePoint)) : null;
};

export async function startVisit(
  tx: Tx,
  context: AgentContext,
  input: LocationInput & { customerId: string },
  meta: RequestMeta,
): Promise<VisitOutcome<VisitView>> {
  const store = await accessibleStore(tx, context, input.customerId);
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
    await audit(tx, context, meta, { action: "GEO_FENCE_BLOCK", resource: "customers", resourceId: store.id, severity: "warning", details });
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

  const [created] = await tx
    .insert(agentVisits)
    .values({
      companyId: context.company.id,
      salesRepId: context.agent.id,
      userId: context.user.id,
      customerId: store.id,
      routeId: store.routeId,
      visitDate: todayIso(),
      startedAt: new Date(),
      startLatitude: input.latitude.toFixed(6),
      startLongitude: input.longitude.toFixed(6),
      startAccuracy: input.accuracy.toFixed(2),
      startDistanceMeters: distance,
    })
    .returning({ id: agentVisits.id });
  await audit(tx, context, meta, {
    action: "VISIT_STARTED",
    resource: "agent_visits",
    resourceId: created!.id,
    details: { customerId: store.id, distanceMeters: distance },
  });
  return { visit: await visitById(tx, context.company.id, created!.id) };
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
    .select({ id: agentVisits.id, customerId: agentVisits.customerId, status: agentVisits.status, startedAt: agentVisits.startedAt })
    .from(agentVisits)
    .where(and(eq(agentVisits.id, visitId), eq(agentVisits.companyId, context.company.id), eq(agentVisits.salesRepId, context.agent.id)))
    .limit(1)
    .for("update");
  if (!visit) throw notFound("Tashrif topilmadi");
  if (visit.status !== "in_progress") throw conflict("Tashrif allaqachon yakunlangan");

  const policy = await getSalesAgentPolicy(tx, context.company.id);
  const rejection = checkLocationQuality(policy, input);
  if (rejection) {
    await insertLocationEvent(tx, context, rejection.reason, input, { action: "visit_complete", visitId: visit.id });
    return { blocked: badRequest(rejection.message, { reason: rejection.reason }) };
  }
  if (policy.photoRequired && (await tx.$count(agentVisitPhotos, eq(agentVisitPhotos.visitId, visit.id))) === 0) {
    throw badRequest("Tashrifni yakunlashdan oldin do'kon rasmini oling", { reason: "photo_required" });
  }

  // Buyurtma bilan bog'lanish F bosqichida: hozircha har yakunlangan tashrif — buyurtmasiz, sabab majburiy
  const comment = input.noOrderComment?.trim() || null;
  if (!input.noOrderReason) {
    throw badRequest("Buyurtma bo'lmagan tashrif uchun sababni tanlang", { reason: "no_order_reason_required" });
  }
  if (input.noOrderReason === "other" && (comment?.length ?? 0) < 3) {
    throw badRequest("\"Boshqa\" sababi uchun izoh yozing", { reason: "comment_required" });
  }

  const [store] = await tx
    .select({ latitude: customers.latitude, longitude: customers.longitude })
    .from(customers)
    .where(eq(customers.id, visit.customerId))
    .limit(1);
  const distance = storeDistance(store, input);
  const now = new Date();
  const durationSeconds = Math.max(0, Math.round((now.getTime() - visit.startedAt.getTime()) / 1000));

  await tx
    .update(agentVisits)
    .set({
      status: "completed",
      result: "no_order",
      completedAt: now,
      endLatitude: input.latitude.toFixed(6),
      endLongitude: input.longitude.toFixed(6),
      endAccuracy: input.accuracy.toFixed(2),
      endDistanceMeters: distance,
      durationSeconds,
      noOrderReason: input.noOrderReason,
      noOrderComment: comment,
      notes: input.notes?.trim() || null,
      updatedAt: now,
    })
    .where(eq(agentVisits.id, visit.id));
  await audit(tx, context, meta, {
    action: "VISIT_COMPLETED",
    resource: "agent_visits",
    resourceId: visit.id,
    details: { customerId: visit.customerId, result: "no_order", durationSeconds, distanceMeters: distance },
  });
  await audit(tx, context, meta, {
    action: "VISIT_NO_ORDER",
    resource: "agent_visits",
    resourceId: visit.id,
    details: { customerId: visit.customerId, reason: input.noOrderReason, comment },
  });
  return { visit: await visitById(tx, context.company.id, visit.id) };
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

async function ownOpenVisit(conn: DbOrTx, context: AgentContext, visitId: string, lock: boolean) {
  const query = conn
    .select({ id: agentVisits.id, status: agentVisits.status, customerId: agentVisits.customerId })
    .from(agentVisits)
    .where(and(eq(agentVisits.id, visitId), eq(agentVisits.companyId, context.company.id), eq(agentVisits.salesRepId, context.agent.id)))
    .limit(1);
  const [visit] = lock ? await query.for("update") : await query;
  if (!visit) throw notFound("Tashrif topilmadi");
  if (visit.status !== "in_progress") throw conflict("Yakunlangan tashrifga rasm qo'shib bo'lmaydi");
  return visit;
}

async function assertPhotoCapacity(conn: DbOrTx, visitId: string) {
  if ((await conn.$count(agentVisitPhotos, eq(agentVisitPhotos.visitId, visitId))) >= MAX_PHOTOS_PER_VISIT) {
    throw badRequest(`Bir tashrifga ${MAX_PHOTOS_PER_VISIT} tadan ko'p rasm qo'shib bo'lmaydi`);
  }
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

export async function addVisitPhoto(
  tx: Tx,
  context: AgentContext,
  visitId: string,
  input: { key: string; kind: VisitPhotoKind; latitude?: number; longitude?: number; accuracy?: number | null },
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
  const stored = await headUpload(client, PHOTO_RULES, input.key);

  const point =
    input.latitude !== undefined && input.longitude !== undefined && isValidCoordinate({ latitude: input.latitude, longitude: input.longitude })
      ? { latitude: input.latitude.toFixed(6), longitude: input.longitude.toFixed(6) }
      : { latitude: null, longitude: null };
  const [photo] = await tx
    .insert(agentVisitPhotos)
    .values({
      companyId: context.company.id,
      visitId: visit.id,
      userId: context.user.id,
      kind: input.kind,
      storageKey: input.key,
      sizeBytes: stored.size,
      ...point,
      accuracy: point.latitude !== null && input.accuracy != null ? input.accuracy.toFixed(2) : null,
      takenAt: new Date(),
    })
    .returning({ id: agentVisitPhotos.id, kind: agentVisitPhotos.kind, takenAt: agentVisitPhotos.takenAt });
  await audit(tx, context, meta, {
    action: "STORE_PHOTO_ADDED",
    resource: "agent_visits",
    resourceId: visit.id,
    details: { photoId: photo!.id, kind: input.kind, customerId: visit.customerId, size: stored.size },
  });
  return photo!;
}

/** Imzolangan ko'rish havolasi; `salesRepId` berilsa — faqat shu agentning tashrifi. */
export async function visitPhotoUrl(
  conn: DbOrTx,
  companyId: string,
  ids: { visitId: string; photoId: string },
  client: StorageClient,
  salesRepId?: string,
) {
  const [photo] = await conn
    .select({ key: agentVisitPhotos.storageKey })
    .from(agentVisitPhotos)
    .innerJoin(agentVisits, eq(agentVisits.id, agentVisitPhotos.visitId))
    .where(
      and(
        eq(agentVisitPhotos.id, ids.photoId),
        eq(agentVisitPhotos.visitId, ids.visitId),
        eq(agentVisits.companyId, companyId),
        salesRepId ? eq(agentVisits.salesRepId, salesRepId) : undefined,
      ),
    )
    .limit(1);
  if (!photo) throw notFound("Rasm topilmadi");
  return { url: client.signedUrl("GET", photo.key, VIEW_TTL), expiresIn: VIEW_TTL };
}

// ─── Supervayzer ─────────────────────────────────────────────────────────────

export async function supervisorVisits(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { date: string; salesRepId?: string; limit: number },
) {
  const visits = await findVisits(conn, tenant.company.id, { date: options.date, salesRepId: options.salesRepId }, options.limit);
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
