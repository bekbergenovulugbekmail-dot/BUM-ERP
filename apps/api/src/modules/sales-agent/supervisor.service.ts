/**
 * Supervayzer ko'rinishi: agentlar holati (onlayn/oflayn), oxirgi joyi va bugungi marshruti, jonli yangilanish,
 * lokatsiya tarixi va hodisalar. Faqat tenant ichida; tarixni ko'rish audit qilinadi.
 * Kun chegarasi — O'zbekiston vaqti (UTC+5).
 */
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { AGENT_ONLINE_MINUTES, notFound } from "@bum/shared";
import { salesReps } from "../../db/schema/crm.js";
import { companies } from "../../db/schema/platform.js";
import { salesOrders } from "../../db/schema/sales.js";
import { agentLocationEvents, agentLocationLatest, agentLocations, agentOrders } from "../../db/schema/sales-agent.js";
import type { DbOrTx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import type { TenantContext } from "../company/tenant.js";
import { todayIso } from "../finance/cash.service.js";
import type { AgentContext } from "./agent-context.js";
import { SOLD_STATUSES } from "./dashboard.service.js";
import type { LocationEventType } from "./location.service.js";
import { agentToday, routesForAgent } from "./stores.service.js";
import { currentVisit, storeVisitStatuses } from "./visits.service.js";

const HISTORY_POINT_LIMIT = 5000;
const DAY_MS = 86_400_000;

/** Mahalliy kun (UTC+5) chegaralari. */
function dayRange(date: string) {
  const from = new Date(`${date}T00:00:00+05:00`);
  return { from, to: new Date(from.getTime() + DAY_MS) };
}

const latestFields = {
  latitude: agentLocationLatest.latitude,
  longitude: agentLocationLatest.longitude,
  accuracy: agentLocationLatest.accuracy,
  recordedAt: agentLocationLatest.recordedAt,
  receivedAt: agentLocationLatest.receivedAt,
  suspicious: agentLocationLatest.suspicious,
};

/** Faol agentlar: oxirgi joy, onlayn holati va bugungi marshrut. */
export async function supervisorAgents(conn: DbOrTx, tenant: TenantContext) {
  const onlineSince = Date.now() - AGENT_ONLINE_MINUTES * 60_000;
  const rows = await conn
    .select({
      id: salesReps.id,
      name: salesReps.name,
      code: salesReps.code,
      phone: salesReps.phone,
      region: salesReps.region,
      linked: salesReps.userId,
      ...latestFields,
    })
    .from(salesReps)
    .leftJoin(agentLocationLatest, eq(agentLocationLatest.salesRepId, salesReps.id))
    .where(and(eq(salesReps.companyId, tenant.company.id), eq(salesReps.isActive, true)))
    .orderBy(asc(salesReps.name));

  const date = todayIso();
  return Promise.all(
    rows.map(async ({ linked, ...row }) => ({
      ...row,
      /** Tizim foydalanuvchisiga bog'langan (agent ish joyidan foydalana oladi). */
      hasLogin: linked !== null,
      online: row.receivedAt !== null && row.receivedAt.getTime() >= onlineSince,
      todayRoutes: (await routesForAgent(conn, tenant.company.id, row.id, date)).map((route) => ({
        id: route.id,
        name: route.name,
        deliveryDate: route.deliveryDate,
      })),
    })),
  );
}

/** Agent tafsiloti (bugun): marshrut do'konlari va tashrif holati, ochiq tashrif, savdo va buyurtmalar. */
export async function supervisorAgentDetail(conn: DbOrTx, tenant: TenantContext, salesRepId: string) {
  const [agent] = await conn
    .select({
      id: salesReps.id,
      name: salesReps.name,
      code: salesReps.code,
      phone: salesReps.phone,
      region: salesReps.region,
      monthlyTarget: salesReps.monthlyTarget,
    })
    .from(salesReps)
    .where(and(eq(salesReps.id, salesRepId), eq(salesReps.companyId, tenant.company.id)))
    .limit(1);
  if (!agent) throw notFound("Savdo agenti topilmadi");

  const context: AgentContext = { ...tenant, agent };
  const plan = await agentToday(conn, context, null);
  const statuses = await storeVisitStatuses(conn, context, plan.stores.map((store) => store.id), plan.date);
  const open = await currentVisit(conn, context);
  const [sales] = await conn
    .select({
      amount: sql<string>`coalesce(sum(${salesOrders.totalAmount}), 0)::numeric(18,2)::text`,
      orders: sql<number>`count(*)::int`,
    })
    .from(agentOrders)
    .innerJoin(salesOrders, eq(salesOrders.id, agentOrders.orderId))
    .where(
      and(
        eq(agentOrders.companyId, tenant.company.id),
        eq(agentOrders.salesRepId, agent.id),
        isNotNull(agentOrders.submittedAt),
        inArray(salesOrders.status, [...SOLD_STATUSES]),
        eq(salesOrders.orderDate, plan.date),
      ),
    );
  const [company] = await conn.select({ currency: companies.currency }).from(companies).where(eq(companies.id, tenant.company.id)).limit(1);

  const stores = plan.stores.map((store) => ({
    id: store.id,
    name: store.name,
    address: store.address,
    latitude: store.latitude,
    longitude: store.longitude,
    visitStatus: statuses.get(store.id) ?? ("waiting" as const),
  }));
  const done = stores.filter((store) => store.visitStatus === "ordered" || store.visitStatus === "visited_no_order").length;
  const { monthlyTarget: _monthlyTarget, ...profile } = agent;
  return {
    agent: profile,
    currency: company?.currency ?? "UZS",
    routes: plan.routes.map((route) => ({ id: route.id, name: route.name, deliveryDate: route.deliveryDate })),
    stores,
    currentVisit: open ? { id: open.id, customerId: open.customerId, customerName: open.customerName, startedAt: open.startedAt } : null,
    today: { salesAmount: sales?.amount ?? "0.00", orderCount: sales?.orders ?? 0, visitsCompleted: done, visitsRemaining: stores.length - done },
  };
}

/** Jonli xarita: `since` dan keyin yangilangan oxirgi joylar. */
export async function supervisorLive(conn: DbOrTx, tenant: TenantContext, since: Date) {
  return conn
    .select({ salesRepId: agentLocationLatest.salesRepId, name: salesReps.name, ...latestFields })
    .from(agentLocationLatest)
    .innerJoin(salesReps, eq(salesReps.id, agentLocationLatest.salesRepId))
    .where(and(eq(agentLocationLatest.companyId, tenant.company.id), gt(agentLocationLatest.receivedAt, since)))
    .orderBy(desc(agentLocationLatest.receivedAt));
}

/** Kunlik lokatsiya tarixi (nuqtalar va hodisalar). Ko'rish audit jurnaliga yoziladi. */
export async function agentLocationHistory(
  conn: DbOrTx,
  tenant: TenantContext,
  salesRepId: string,
  date: string,
  meta: RequestMeta,
) {
  const [agent] = await conn
    .select({ id: salesReps.id, name: salesReps.name, code: salesReps.code })
    .from(salesReps)
    .where(and(eq(salesReps.id, salesRepId), eq(salesReps.companyId, tenant.company.id)))
    .limit(1);
  if (!agent) throw notFound("Savdo agenti topilmadi");

  const { from, to } = dayRange(date);
  const points = await conn
    .select({
      latitude: agentLocations.latitude,
      longitude: agentLocations.longitude,
      accuracy: agentLocations.accuracy,
      recordedAt: agentLocations.recordedAt,
      suspicious: agentLocations.suspicious,
    })
    .from(agentLocations)
    .where(
      and(
        eq(agentLocations.companyId, tenant.company.id),
        eq(agentLocations.salesRepId, agent.id),
        gte(agentLocations.recordedAt, from),
        lt(agentLocations.recordedAt, to),
      ),
    )
    .orderBy(asc(agentLocations.recordedAt))
    .limit(HISTORY_POINT_LIMIT);
  const events = await conn
    .select({
      id: agentLocationEvents.id,
      type: agentLocationEvents.type,
      latitude: agentLocationEvents.latitude,
      longitude: agentLocationEvents.longitude,
      accuracy: agentLocationEvents.accuracy,
      details: agentLocationEvents.details,
      occurredAt: agentLocationEvents.occurredAt,
    })
    .from(agentLocationEvents)
    .where(
      and(
        eq(agentLocationEvents.companyId, tenant.company.id),
        eq(agentLocationEvents.salesRepId, agent.id),
        gte(agentLocationEvents.occurredAt, from),
        lt(agentLocationEvents.occurredAt, to),
      ),
    )
    .orderBy(asc(agentLocationEvents.occurredAt))
    .limit(500);

  await writeAuditLog({
    userId: tenant.user.id,
    userName: tenant.user.name,
    companyId: tenant.company.id,
    action: "LOCATION_HISTORY_VIEWED",
    resource: "sales_reps",
    resourceId: agent.id,
    details: { date, points: points.length },
    ...meta,
  });
  return { agent, date, points, events, truncated: points.length === HISTORY_POINT_LIMIT };
}

/** Lokatsiya hodisalari (sifat rad etishlari, ruxsat, sakrash, geofence) — kun bo'yicha. */
export async function locationEvents(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { date: string; type?: LocationEventType; salesRepId?: string; limit: number },
) {
  const { from, to } = dayRange(options.date);
  return conn
    .select({
      id: agentLocationEvents.id,
      salesRepId: agentLocationEvents.salesRepId,
      salesRepName: salesReps.name,
      type: agentLocationEvents.type,
      latitude: agentLocationEvents.latitude,
      longitude: agentLocationEvents.longitude,
      accuracy: agentLocationEvents.accuracy,
      details: agentLocationEvents.details,
      occurredAt: agentLocationEvents.occurredAt,
    })
    .from(agentLocationEvents)
    .innerJoin(salesReps, eq(salesReps.id, agentLocationEvents.salesRepId))
    .where(
      and(
        eq(agentLocationEvents.companyId, tenant.company.id),
        gte(agentLocationEvents.occurredAt, from),
        lt(agentLocationEvents.occurredAt, to),
        options.type ? eq(agentLocationEvents.type, options.type) : undefined,
        options.salesRepId ? eq(agentLocationEvents.salesRepId, options.salesRepId) : undefined,
      ),
    )
    .orderBy(desc(agentLocationEvents.occurredAt))
    .limit(options.limit);
}
