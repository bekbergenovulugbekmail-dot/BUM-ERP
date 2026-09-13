/**
 * Yetkazuvchining kunlik marshruti: ochiq yetkazmalar eng qisqa yo'l tartibida (modules/routing). Yo'lda bo'lganlari
 * (yo'lga chiqqan, yetib kelgan, topshirilayotgan) — oldinda, joriy tartibida; qolgani ulardan keyin optimallashtiriladi.
 * Koordinatasiz mijozlar — oxirida. Tartibni saqlash — `setDeliveryRouteOrder` (egasi, kuni va holati qayta tekshiriladi).
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { ON_ROUTE_DELIVERY_STATUSES, OPEN_DELIVERY_STATUSES, type DeliveryStatus } from "@bum/shared";
import { deliveryLocationLatest, deliveryTasks } from "../../db/schema/delivery.js";
import { customers } from "../../db/schema/sales.js";
import type { DbOrTx } from "../../db/transaction.js";
import { pointOf, type GeoPoint } from "../../shared/geo.js";
import { planRoute, type RoutePlan, type RouteStop } from "../routing/routing.service.js";
import { presentTask, taskListQuery } from "./tasks.service.js";

/** Yetkazuvchi joyi shu vaqtdan eski bo'lsa boshlang'ich nuqta sifatida olinmaydi. */
const AGENT_LOCATION_MAX_AGE_MS = 2 * 60 * 60_000;
const ON_ROUTE: readonly DeliveryStatus[] = ON_ROUTE_DELIVERY_STATUSES;

export type OriginSource = "given" | "agent_location" | "none";

export type AgentDayRoute = {
  route: RoutePlan;
  /** Tavsiya etilgan tartib: koordinatali (reja bo'yicha), keyin koordinatasizlar. */
  taskIds: string[];
  unlocatedTaskIds: string[];
  originSource: OriginSource;
};

/**
 * `dates: "exact"` — faqat shu kun (supervayzer rejasi va saqlash); `"until"` — shu kungacha qolgan ochiqlari ham
 * (yetkazuvchining "bugun" ro'yxati kabi).
 */
export async function planAgentDay(
  conn: DbOrTx,
  companyId: string,
  deliveryAgentId: string,
  date: string,
  options: { origin: GeoPoint | null; useAgentLocation: boolean; dates: "exact" | "until"; now?: Date },
): Promise<AgentDayRoute> {
  const rows = await conn
    .select({
      id: deliveryTasks.id,
      status: deliveryTasks.status,
      latitude: customers.latitude,
      longitude: customers.longitude,
    })
    .from(deliveryTasks)
    .innerJoin(customers, eq(customers.id, deliveryTasks.customerId))
    .where(
      and(
        eq(deliveryTasks.companyId, companyId),
        eq(deliveryTasks.deliveryAgentId, deliveryAgentId),
        options.dates === "exact" ? eq(deliveryTasks.scheduledDate, date) : sql`${deliveryTasks.scheduledDate} <= ${date}::date`,
        inArray(deliveryTasks.status, [...OPEN_DELIVERY_STATUSES]),
      ),
    )
    .orderBy(asc(deliveryTasks.scheduledDate), sql`${deliveryTasks.routeOrder} asc nulls last`, asc(deliveryTasks.createdAt))
    .limit(500);

  let origin = options.origin;
  let originSource: OriginSource = origin ? "given" : "none";
  if (!origin && options.useAgentLocation) {
    const [latest] = await conn
      .select({ latitude: deliveryLocationLatest.latitude, longitude: deliveryLocationLatest.longitude, recordedAt: deliveryLocationLatest.recordedAt, suspicious: deliveryLocationLatest.suspicious })
      .from(deliveryLocationLatest)
      .where(and(eq(deliveryLocationLatest.deliveryAgentId, deliveryAgentId), eq(deliveryLocationLatest.companyId, companyId)))
      .limit(1);
    const point = latest && !latest.suspicious ? pointOf(latest.latitude, latest.longitude) : null;
    if (point && (options.now ?? new Date()).getTime() - latest!.recordedAt.getTime() <= AGENT_LOCATION_MAX_AGE_MS) {
      origin = point;
      originSource = "agent_location";
    }
  }

  const stopOf = (row: (typeof rows)[number]): RouteStop | null => {
    const point = pointOf(row.latitude, row.longitude);
    return point ? { id: row.id, ...point } : null;
  };
  const pinned = rows.filter((row) => ON_ROUTE.includes(row.status)).map(stopOf).filter((stop): stop is RouteStop => stop !== null);
  const rest = rows.filter((row) => !ON_ROUTE.includes(row.status)).map(stopOf).filter((stop): stop is RouteStop => stop !== null);
  const unlocatedTaskIds = rows.filter((row) => stopOf(row) === null).map((row) => row.id);

  let route: RoutePlan;
  if (pinned.length === 0) {
    route = await planRoute(origin, rest);
  } else {
    // Yo'ldagilar tartibi saqlanadi; qolganlari oxirgi yo'ldagi mijozdan boshlab eng qisqa tartibda
    const tail = rest.length > 0 ? await planRoute(pinned[pinned.length - 1]!, rest) : null;
    const restOrdered = tail ? tail.stops.map((stop) => rest.find((item) => item.id === stop.id)!) : [];
    route = await planRoute(origin, [...pinned, ...restOrdered], { optimize: false });
  }

  return { route, taskIds: [...route.stops.map((stop) => stop.id), ...unlocatedTaskIds], unlocatedTaskIds, originSource };
}

/** Reja tartibidagi yetkazmalar (ro'yxat ko'rinishi). */
export async function tasksInOrder(conn: DbOrTx, companyId: string, taskIds: string[]) {
  if (taskIds.length === 0) return [];
  const rows = await taskListQuery(conn).where(and(eq(deliveryTasks.companyId, companyId), inArray(deliveryTasks.id, taskIds)));
  const position = new Map(taskIds.map((id, index) => [id, index]));
  return rows.sort((a, b) => position.get(a.id)! - position.get(b.id)!).map(presentTask);
}
