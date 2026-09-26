/**
 * Sotuv agentiga biriktirilgan do'konlar (mijozlar) — faqat o'z hududi.
 *
 *  - Bugungi marshrut: shu kunga agentga biriktirilgan (`route_assignments`), bo'lmasa hafta kuni mos
 *    keladigan agentning o'z faol marshrutlari (shu kunga boshqa agentga berilganlaridan tashqari).
 *  - Do'kon profili va qarzdorlar: agentning o'z faol marshrutlari va bugungi biriktirishlaridagi do'konlar.
 *    Boshqa do'kon so'ralsa — 404 (mavjudligi ham oshkor qilinmaydi).
 *  - Sana har doim server sanasi: agent boshqa kunning hududiga o'ta olmaydi.
 *  - Masofa serverda, agent yuborgan koordinatadan hisoblanadi.
 */
import { and, asc, desc, eq, gte, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { notFound } from "@bum/shared";
import { distributionRoutes, routeAssignments, routeCustomers } from "../../db/schema/crm.js";
import { customers, salesOrders } from "../../db/schema/sales.js";
import type { DbOrTx } from "../../db/transaction.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import { distanceMeters, pointOf, type GeoPoint } from "../../shared/geo.js";
import { todayIso } from "../finance/cash.service.js";
import type { AgentContext } from "./agent-context.js";

const DAY_MS = 86_400_000;
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const dayNumber = (date: string) => Math.round(new Date(`${date}T00:00:00Z`).getTime() / DAY_MS);
const shiftDate = (date: string, days: number) => new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10);

/** "Tez orada" — muddatiga shuncha kun yoki kamroq qolgan qarz. */
export const DUE_SOON_DAYS = 3;

export type TodayRoute = { id: string; name: string; color: string | null; days: number[]; deliveryDate: string | null };

/** Agentning shu kungi marshrutlari (agent ish joyi va supervayzer ko'rinishi uchun). */
export async function todayRoutes(conn: DbOrTx, context: AgentContext, date = todayIso()): Promise<TodayRoute[]> {
  const own = await routesForAgent(conn, context.company.id, context.agent.id, date);
  if (!context.supervisorRoutes) return own;
  // Supervayzer: o'z marshrutlari + jamoasining shu hafta kunidagi marshrutlari
  const team = await conn
    .select({ id: distributionRoutes.id, name: distributionRoutes.name, color: distributionRoutes.color, days: distributionRoutes.days })
    .from(distributionRoutes)
    .where(
      and(
        eq(distributionRoutes.companyId, context.company.id),
        eq(distributionRoutes.isActive, true),
        sql`${weekday(date)} = any("distribution_routes"."days")`,
        teamRouteCondition(context.supervisorRoutes),
      ),
    )
    .orderBy(asc(distributionRoutes.name));
  const seen = new Set(own.map((route) => route.id));
  return [...own, ...team.filter((route) => !seen.has(route.id)).map((route) => ({ ...route, deliveryDate: null }))];
}

/** Supervayzer jamoasi marshrutlari sharti (`null` — kompaniyaning barcha faol marshrutlari). */
function teamRouteCondition(scope: { salesRepIds: string[] | null }) {
  if (!scope.salesRepIds) return undefined;
  return scope.salesRepIds.length > 0 ? inArray(distributionRoutes.salesRepId, scope.salesRepIds) : sql`false`;
}

/** Shu kunga biriktirish ustun, bo'lmasa hafta kuni bo'yicha agentning o'z marshrutlari. */
export async function routesForAgent(conn: DbOrTx, companyId: string, salesRepId: string, date = todayIso()): Promise<TodayRoute[]> {
  const assigned = await conn
    .select({
      id: distributionRoutes.id,
      name: distributionRoutes.name,
      color: distributionRoutes.color,
      days: distributionRoutes.days,
      deliveryDate: routeAssignments.deliveryDate,
    })
    .from(routeAssignments)
    .innerJoin(distributionRoutes, eq(distributionRoutes.id, routeAssignments.routeId))
    .where(
      and(
        eq(routeAssignments.companyId, companyId),
        eq(routeAssignments.salesRepId, salesRepId),
        eq(routeAssignments.assignDate, date),
        eq(distributionRoutes.isActive, true),
      ),
    )
    .orderBy(asc(distributionRoutes.name));
  if (assigned.length > 0) return assigned;

  const own = await conn
    .select({ id: distributionRoutes.id, name: distributionRoutes.name, color: distributionRoutes.color, days: distributionRoutes.days })
    .from(distributionRoutes)
    .where(
      and(
        eq(distributionRoutes.companyId, companyId),
        eq(distributionRoutes.salesRepId, salesRepId),
        eq(distributionRoutes.isActive, true),
        sql`${weekday(date)} = any("distribution_routes"."days")`,
        sql`not exists (select 1 from "route_assignments" ra where ra."route_id" = "distribution_routes"."id" and ra."assign_date" = ${date})`,
      ),
    )
    .orderBy(asc(distributionRoutes.name));
  return own.map((route) => ({ ...route, deliveryDate: null }));
}

/** Agentga ochiq marshrutlar: o'z faol marshrutlari va bugun unga biriktirilganlari. */
async function assignedRouteIds(conn: DbOrTx, context: AgentContext, date = todayIso()): Promise<string[]> {
  const rows = await conn
    .select({ id: distributionRoutes.id })
    .from(distributionRoutes)
    .where(
      and(
        eq(distributionRoutes.companyId, context.company.id),
        eq(distributionRoutes.isActive, true),
        or(
          eq(distributionRoutes.salesRepId, context.agent.id),
          sql`exists (select 1 from "route_assignments" ra where ra."route_id" = "distribution_routes"."id" and ra."sales_rep_id" = ${context.agent.id} and ra."assign_date" = ${date})`,
          // Supervayzer o'zi savdo qilganda — jamoasi marshrutlaridagi do'konlar ham
          context.supervisorRoutes ? (teamRouteCondition(context.supervisorRoutes) ?? sql`true`) : undefined,
        ),
      ),
    );
  return rows.map((row) => row.id);
}

export type AgentStore = {
  id: string;
  name: string;
  code: string;
  phone: string | null;
  address: string | null;
  contactName: string | null;
  latitude: string | null;
  longitude: string | null;
  totalDebt: string;
  creditLimit: string;
  routeId: string;
  routeName: string;
  sortOrder: number;
  lastOrderDate: string | null;
  /** Agent yuborgan joydan, metr; koordinata bo'lmasa null. */
  distanceMeters: number | null;
};

const likePattern = (value: string) => `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

async function storesOnRoutes(
  conn: DbOrTx,
  context: AgentContext,
  routeIds: string[],
  options: { search?: string; customerId?: string; origin?: GeoPoint | null; limit?: number },
): Promise<AgentStore[]> {
  if (routeIds.length === 0) return [];
  const digits = options.search?.replace(/\D/g, "") ?? "";
  const rows = await conn
    .select({
      id: customers.id,
      name: customers.name,
      code: customers.code,
      phone: customers.phone,
      address: customers.address,
      contactName: customers.contactName,
      latitude: customers.latitude,
      longitude: customers.longitude,
      totalDebt: customers.totalDebt,
      creditLimit: customers.creditLimit,
      routeId: routeCustomers.routeId,
      routeName: distributionRoutes.name,
      sortOrder: routeCustomers.sortOrder,
      lastOrderDate: sql<string | null>`(select max(so."order_date")::text from "sales_orders" so where so."customer_id" = "customers"."id" and so."status" <> 'cancelled')`,
    })
    .from(routeCustomers)
    .innerJoin(customers, eq(customers.id, routeCustomers.customerId))
    .innerJoin(distributionRoutes, eq(distributionRoutes.id, routeCustomers.routeId))
    .where(
      and(
        eq(routeCustomers.companyId, context.company.id),
        inArray(routeCustomers.routeId, routeIds),
        eq(customers.isActive, true),
        options.customerId ? eq(customers.id, options.customerId) : undefined,
        options.search
          ? or(
              ilike(customers.name, likePattern(options.search)),
              ilike(customers.address, likePattern(options.search)),
              ilike(customers.phone, likePattern(options.search)),
              digits.length >= 3
                ? sql`regexp_replace(coalesce(${customers.phone}, ''), '[^0-9]', '', 'g') like ${`%${digits}%`}`
                : undefined,
            )
          : undefined,
      ),
    )
    .orderBy(asc(distributionRoutes.name), asc(routeCustomers.sortOrder))
    .limit(options.limit ?? 500);

  // Bir do'kon bir necha marshrutda bo'lsa — birinchisi
  const seen = new Set<string>();
  const stores: AgentStore[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const point = pointOf(row.latitude, row.longitude);
    stores.push({
      ...row,
      distanceMeters: point && options.origin ? Math.round(distanceMeters(options.origin, point)) : null,
    });
  }
  return stores;
}

/** Bugungi marshrut va uning do'konlari (marshrut tartibida). */
export async function agentToday(conn: DbOrTx, context: AgentContext, origin: GeoPoint | null) {
  const date = todayIso();
  const routes = await todayRoutes(conn, context, date);
  const stores = await storesOnRoutes(conn, context, routes.map((route) => route.id), { origin });
  return { date, routes, stores };
}

/** Do'konlar ro'yxati: bugungi marshrut (standart) yoki agentga ochiq barcha do'konlar; joy berilsa — yaqinidan. */
export async function agentStores(
  conn: DbOrTx,
  context: AgentContext,
  options: { scope: "today" | "all"; search?: string; origin: GeoPoint | null; limit: number },
) {
  const date = todayIso();
  const routeIds =
    options.scope === "today"
      ? (await todayRoutes(conn, context, date)).map((route) => route.id)
      : await assignedRouteIds(conn, context, date);
  const stores = await storesOnRoutes(conn, context, routeIds, options);
  if (options.origin) {
    stores.sort((a, b) => (a.distanceMeters ?? Number.POSITIVE_INFINITY) - (b.distanceMeters ?? Number.POSITIVE_INFINITY));
  }
  return stores;
}

/** Agentga ochiq do'kon (boshqasi — 404): tashrif va buyurtma shu tekshiruvdan o'tadi. */
export async function accessibleStore(conn: DbOrTx, context: AgentContext, customerId: string): Promise<AgentStore> {
  const [store] = await storesOnRoutes(conn, context, await assignedRouteIds(conn, context), { customerId });
  if (!store) throw notFound("Do'kon topilmadi");
  return store;
}

/** Do'kon profili — faqat agentga ochiq bo'lsa. */
export async function agentStore(conn: DbOrTx, context: AgentContext, customerId: string, origin: GeoPoint | null) {
  const routeIds = await assignedRouteIds(conn, context);
  const [store] = await storesOnRoutes(conn, context, routeIds, { customerId, origin });
  if (!store) throw notFound("Do'kon topilmadi");

  const routes = await conn
    .select({ id: distributionRoutes.id, name: distributionRoutes.name, days: distributionRoutes.days })
    .from(routeCustomers)
    .innerJoin(distributionRoutes, eq(distributionRoutes.id, routeCustomers.routeId))
    .where(and(eq(routeCustomers.customerId, customerId), inArray(routeCustomers.routeId, routeIds)));

  const [details] = await conn
    .select({ balance: customers.balance, paymentTermDays: customers.paymentTermDays, notes: customers.notes })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  const since = shiftDate(todayIso(), -90);
  const [summary] = await conn
    .select({
      count: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${salesOrders.totalAmount}), 0)::numeric(18,2)`,
    })
    .from(salesOrders)
    .where(
      and(
        eq(salesOrders.companyId, context.company.id),
        eq(salesOrders.customerId, customerId),
        ne(salesOrders.status, "cancelled"),
        gte(salesOrders.orderDate, since),
      ),
    );
  const recentOrders = await conn
    .select({
      id: salesOrders.id,
      number: salesOrders.number,
      orderDate: salesOrders.orderDate,
      status: salesOrders.status,
      totalAmount: salesOrders.totalAmount,
      paidAmount: salesOrders.paidAmount,
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.companyId, context.company.id), eq(salesOrders.customerId, customerId), ne(salesOrders.status, "cancelled")))
    .orderBy(desc(salesOrders.orderDate), desc(salesOrders.createdAt))
    .limit(5);

  const debt = toMinor(store.totalDebt);
  const limit = toMinor(store.creditLimit);
  return {
    ...store,
    balance: details!.balance,
    paymentTermDays: details!.paymentTermDays,
    notes: details!.notes,
    /** Qolgan kredit (manfiy — limitdan oshgan); limit 0 — cheklanmagan (null). */
    availableCredit: limit > 0n ? fromMinor(limit - (debt > 0n ? debt : 0n)) : null,
    routes: routes.map((route) => ({ id: route.id, name: route.name })),
    /** Tashrif kunlari: 0 = yakshanba … 6 = shanba. */
    visitDays: [...new Set(routes.flatMap((route) => route.days))].sort(),
    ordersLast90Days: { count: summary!.count, total: summary!.total },
    recentOrders,
  };
}

export type DebtorStatus = "overdue" | "today" | "soon" | "later" | "unscheduled";

/** Qarzdorlar: agentga ochiq do'konlardan qarzi borlari, eng eski to'lanmagan buyurtma muddati bo'yicha. */
export async function agentDebtors(
  conn: DbOrTx,
  context: AgentContext,
  options: { filter: "overdue" | "today" | "soon" | "all"; origin: GeoPoint | null },
) {
  const today = todayIso();
  const stores = (await storesOnRoutes(conn, context, await assignedRouteIds(conn, context, today), { origin: options.origin })).filter(
    (store) => toMinor(store.totalDebt) > 0n,
  );
  if (stores.length === 0) return [];

  const dueRows = await conn
    .select({
      customerId: salesOrders.customerId,
      dueDate: sql<string>`min(${salesOrders.orderDate} + ${customers.paymentTermDays})::text`,
    })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(
      and(
        eq(salesOrders.companyId, context.company.id),
        inArray(salesOrders.customerId, stores.map((store) => store.id)),
        inArray(salesOrders.status, ["completed", "shipped", "delivered"]),
        sql`${salesOrders.paidAmount} < ${salesOrders.totalAmount}`,
      ),
    )
    .groupBy(salesOrders.customerId);
  const dueOf = new Map(dueRows.map((row) => [row.customerId, row.dueDate]));

  const debtors = stores.map((store) => {
    const dueDate = dueOf.get(store.id) ?? null;
    const daysOverdue = dueDate ? dayNumber(today) - dayNumber(dueDate) : null;
    const status: DebtorStatus =
      daysOverdue === null
        ? "unscheduled"
        : daysOverdue > 0
          ? "overdue"
          : daysOverdue === 0
            ? "today"
            : daysOverdue >= -DUE_SOON_DAYS
              ? "soon"
              : "later";
    return { ...store, dueDate, daysOverdue, status };
  });

  return debtors
    .filter((debtor) => options.filter === "all" || debtor.status === options.filter)
    .sort(
      (a, b) =>
        (b.daysOverdue ?? Number.NEGATIVE_INFINITY) - (a.daysOverdue ?? Number.NEGATIVE_INFINITY) ||
        Number(toMinor(b.totalDebt) - toMinor(a.totalDebt)),
    );
}
