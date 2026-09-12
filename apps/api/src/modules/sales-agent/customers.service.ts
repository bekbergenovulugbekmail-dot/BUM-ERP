/**
 * "Mijozlar" bo'limi — agentga ochiq mijoz (boshqasi — 404):
 *  - tarix: buyurtmalar (agentniki belgilangan), to'lovlar, agentning o'z tashriflari, o'rtacha buyurtma va buyurtmalar oralig'i
 *  - aloqa ma'lumotlarini tahrirlash (`sales_agent.customer.edit`) — moliyaviy maydonlar (limit, chegirma, muddat) o'zgarmaydi
 *  - joylashuvni saqlash (`sales_agent.customer.location.edit`) — ish vaqtida, sifatli GPS bilan; koordinata bo'lsa faqat
 *    shu joydan geofence radiusi ichida (yonida turib aniqlashtirish), aks holda 403
 *  - vitrina rasmi (`sales_agent.customer.photo.create`) — kamera, mijoz hududida, bazada (oxirgi 5 tasi)
 * Audit: CUSTOMER_UPDATED, CUSTOMER_LOCATION_UPDATE, CUSTOMER_PHOTO_ADDED.
 */
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { AppError, badRequest, notFound } from "@bum/shared";
import { customerPayments, customers, salesOrders } from "../../db/schema/sales.js";
import { agentOrders, agentVisits, customerPhotos } from "../../db/schema/sales-agent.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type AuditEntry, type RequestMeta } from "../../shared/audit.js";
import { distanceMeters, pointOf } from "../../shared/geo.js";
import { MB } from "../files/files.service.js";
import type { AgentContext } from "./agent-context.js";
import { checkLocationQuality, type LocationInput } from "./location.service.js";
import { getSalesAgentPolicy } from "./policy.service.js";
import { accessibleStore } from "./stores.service.js";
import { DIRECT_PHOTO_MAX_BYTES, sniffImage, type PhotoPoint } from "./visits.service.js";
import { requireWorkSession } from "./work-session.repo.js";

const PHOTOS_KEPT = 5;
const DAY_MS = 86_400_000;

function audit(tx: Tx, context: AgentContext, meta: RequestMeta, entry: Omit<AuditEntry, "userId" | "userName" | "companyId">) {
  return writeAuditLog(
    { userId: context.user.id, userName: context.user.name, companyId: context.company.id, ...entry, ...meta },
    tx,
  );
}

export async function customerHistory(conn: DbOrTx, context: AgentContext, customerId: string) {
  await accessibleStore(conn, context, customerId);
  const companyId = context.company.id;
  const orderScope = and(eq(salesOrders.companyId, companyId), eq(salesOrders.customerId, customerId), sql`${salesOrders.status} <> 'cancelled'`);

  const [orderStats] = await conn
    .select({
      count: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${salesOrders.totalAmount}), 0)::numeric(18,2)::text`,
      average: sql<string>`coalesce(avg(${salesOrders.totalAmount}), 0)::numeric(18,2)::text`,
      firstDate: sql<string | null>`min(${salesOrders.orderDate})::text`,
      lastDate: sql<string | null>`max(${salesOrders.orderDate})::text`,
      byMe: sql<number>`(count(*) filter (where exists (select 1 from ${agentOrders} ao where ao.order_id = ${salesOrders.id} and ao.sales_rep_id = ${context.agent.id})))::int`,
    })
    .from(salesOrders)
    .where(orderScope);
  const [paymentStats] = await conn
    .select({
      total: sql<string>`coalesce(sum(${customerPayments.amount}), 0)::numeric(18,2)::text`,
      lastDate: sql<string | null>`max(${customerPayments.paymentDate})::text`,
    })
    .from(customerPayments)
    .where(and(eq(customerPayments.companyId, companyId), eq(customerPayments.customerId, customerId)));
  const visitScope = and(eq(agentVisits.companyId, companyId), eq(agentVisits.customerId, customerId), eq(agentVisits.salesRepId, context.agent.id));
  const [visitStats] = await conn
    .select({
      count: sql<number>`count(*)::int`,
      ordered: sql<number>`(count(*) filter (where ${agentVisits.result} = 'ordered'))::int`,
      lastDate: sql<string | null>`max(${agentVisits.visitDate})::text`,
    })
    .from(agentVisits)
    .where(visitScope);

  const orders = await conn
    .select({
      id: salesOrders.id,
      number: salesOrders.number,
      orderDate: salesOrders.orderDate,
      status: salesOrders.status,
      totalAmount: salesOrders.totalAmount,
      paidAmount: salesOrders.paidAmount,
      byMe: sql<boolean>`exists (select 1 from ${agentOrders} ao where ao.order_id = ${salesOrders.id} and ao.sales_rep_id = ${context.agent.id})`,
    })
    .from(salesOrders)
    .where(orderScope)
    .orderBy(desc(salesOrders.orderDate), desc(salesOrders.createdAt))
    .limit(20);
  const payments = await conn
    .select({ id: customerPayments.id, amount: customerPayments.amount, method: customerPayments.method, paymentDate: customerPayments.paymentDate })
    .from(customerPayments)
    .where(and(eq(customerPayments.companyId, companyId), eq(customerPayments.customerId, customerId)))
    .orderBy(desc(customerPayments.paymentDate), desc(customerPayments.createdAt))
    .limit(20);
  const visits = await conn
    .select({
      id: agentVisits.id,
      visitDate: agentVisits.visitDate,
      startedAt: agentVisits.startedAt,
      status: agentVisits.status,
      result: agentVisits.result,
      noOrderReason: agentVisits.noOrderReason,
      durationSeconds: agentVisits.durationSeconds,
      invalidatedAt: agentVisits.invalidatedAt,
    })
    .from(agentVisits)
    .where(visitScope)
    .orderBy(desc(agentVisits.startedAt))
    .limit(20);
  const [photo] = await conn
    .select({ id: customerPhotos.id, takenAt: customerPhotos.takenAt })
    .from(customerPhotos)
    .where(and(eq(customerPhotos.companyId, companyId), eq(customerPhotos.customerId, customerId)))
    .orderBy(desc(customerPhotos.takenAt))
    .limit(1);

  const span =
    orderStats!.firstDate && orderStats!.lastDate
      ? Math.round((Date.parse(`${orderStats!.lastDate}T00:00:00Z`) - Date.parse(`${orderStats!.firstDate}T00:00:00Z`)) / DAY_MS)
      : 0;
  return {
    stats: {
      orderCount: orderStats!.count,
      myOrderCount: orderStats!.byMe,
      salesTotal: orderStats!.total,
      averageOrder: orderStats!.average,
      /** Buyurtmalar orasidagi o'rtacha kun (kamida 2 ta buyurtma bo'lsa). */
      averageIntervalDays: orderStats!.count > 1 ? Math.round(span / (orderStats!.count - 1)) : null,
      firstOrderDate: orderStats!.firstDate,
      lastOrderDate: orderStats!.lastDate,
      paymentsTotal: paymentStats!.total,
      lastPaymentDate: paymentStats!.lastDate,
      visitCount: visitStats!.count,
      orderedVisitCount: visitStats!.ordered,
      lastVisitDate: visitStats!.lastDate,
    },
    orders,
    payments,
    visits,
    photo: photo ?? null,
  };
}

export type AgentCustomerPatch = { contactName?: string | null; phone?: string | null; address?: string | null; notes?: string | null };

export async function updateAgentCustomer(tx: Tx, context: AgentContext, customerId: string, patch: AgentCustomerPatch, meta: RequestMeta) {
  await accessibleStore(tx, context, customerId);
  const changes = Object.keys(patch);
  if (changes.length === 0) throw badRequest("O'zgartirish yo'q");
  await tx
    .update(customers)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(customers.id, customerId), eq(customers.companyId, context.company.id)));
  await audit(tx, context, meta, { action: "CUSTOMER_UPDATED", resource: "customers", resourceId: customerId, details: { changes, source: "sales_agent" } });
  return accessibleStore(tx, context, customerId);
}

/** Mijoz hududida bo'lish sharti: sifatli joy va (koordinata bo'lsa) geofence radiusi ichida. */
async function assertAtCustomer(conn: DbOrTx, context: AgentContext, store: { latitude: string | null; longitude: string | null }, point: PhotoPoint) {
  const policy = await getSalesAgentPolicy(conn, context.company.id);
  const rejection = point.recordedAt
    ? checkLocationQuality(policy, { ...point, recordedAt: point.recordedAt })
    : point.accuracy > policy.maxAccuracyMeters
      ? { reason: "low_accuracy" as const, message: `GPS aniqligi past (${Math.round(point.accuracy)} m)` }
      : null;
  if (rejection) throw badRequest(rejection.message, { reason: rejection.reason });
  const existing = pointOf(store.latitude, store.longitude);
  const distance = existing ? Math.round(distanceMeters(point, existing)) : null;
  if (distance !== null && distance > policy.geofenceRadiusMeters) {
    throw new AppError("FORBIDDEN", `Siz mijozdan ${distance} m uzoqdasiz — faqat mijoz yonida (${policy.geofenceRadiusMeters} m)`, {
      reason: "geofence",
      distanceMeters: distance,
      radiusMeters: policy.geofenceRadiusMeters,
    });
  }
  return distance;
}

export async function saveCustomerLocation(tx: Tx, context: AgentContext, customerId: string, input: LocationInput, meta: RequestMeta) {
  await requireWorkSession(tx, context.agent.id);
  await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)).for("update");
  const store = await accessibleStore(tx, context, customerId);
  const distance = await assertAtCustomer(tx, context, store, input);
  await tx
    .update(customers)
    .set({ latitude: input.latitude.toFixed(6), longitude: input.longitude.toFixed(6), updatedAt: new Date() })
    .where(eq(customers.id, customerId));
  await audit(tx, context, meta, {
    action: "CUSTOMER_LOCATION_UPDATE",
    resource: "customers",
    resourceId: customerId,
    details: {
      previousLatitude: store.latitude,
      previousLongitude: store.longitude,
      latitude: input.latitude.toFixed(6),
      longitude: input.longitude.toFixed(6),
      accuracy: Math.round(input.accuracy),
      movedMeters: distance,
    },
  });
  return accessibleStore(tx, context, customerId);
}

export async function addCustomerPhoto(
  tx: Tx,
  context: AgentContext,
  customerId: string,
  input: PhotoPoint & { data: Buffer },
  meta: RequestMeta,
) {
  await requireWorkSession(tx, context.agent.id);
  const store = await accessibleStore(tx, context, customerId);
  const contentType = sniffImage(input.data);
  if (!contentType || input.data.length > DIRECT_PHOTO_MAX_BYTES) {
    throw badRequest(`Rasm JPEG, PNG yoki WebP bo'lishi va ${DIRECT_PHOTO_MAX_BYTES / MB} MB dan oshmasligi kerak`, { reason: "photo_invalid" });
  }
  await assertAtCustomer(tx, context, store, input);

  const [photo] = await tx
    .insert(customerPhotos)
    .values({
      companyId: context.company.id,
      customerId,
      salesRepId: context.agent.id,
      userId: context.user.id,
      content: input.data,
      contentType,
      sizeBytes: input.data.length,
      latitude: input.latitude.toFixed(6),
      longitude: input.longitude.toFixed(6),
      accuracy: input.accuracy.toFixed(2),
      takenAt: new Date(),
    })
    .returning({ id: customerPhotos.id, takenAt: customerPhotos.takenAt });
  // Eski rasmlar: oxirgi PHOTOS_KEPT tasi qoladi
  const kept = await tx
    .select({ id: customerPhotos.id, takenAt: customerPhotos.takenAt })
    .from(customerPhotos)
    .where(and(eq(customerPhotos.companyId, context.company.id), eq(customerPhotos.customerId, customerId)))
    .orderBy(desc(customerPhotos.takenAt))
    .offset(PHOTOS_KEPT - 1)
    .limit(1);
  if (kept[0]) {
    await tx
      .delete(customerPhotos)
      .where(and(eq(customerPhotos.customerId, customerId), lt(customerPhotos.takenAt, kept[0].takenAt)));
  }
  await audit(tx, context, meta, {
    action: "CUSTOMER_PHOTO_ADDED",
    resource: "customers",
    resourceId: customerId,
    details: { photoId: photo!.id, size: input.data.length },
  });
  return photo!;
}

export async function customerPhotoContent(conn: DbOrTx, context: AgentContext, customerId: string) {
  await accessibleStore(conn, context, customerId);
  const [photo] = await conn
    .select({ content: customerPhotos.content, contentType: customerPhotos.contentType })
    .from(customerPhotos)
    .where(and(eq(customerPhotos.companyId, context.company.id), inArray(customerPhotos.customerId, [customerId])))
    .orderBy(desc(customerPhotos.takenAt))
    .limit(1);
  if (!photo) throw notFound("Rasm topilmadi");
  return photo;
}
