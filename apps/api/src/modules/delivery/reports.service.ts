/**
 * Dostavka ko'rsatkichlari va hisobotlari — hammasi serverda.
 *  - Agent: bugungi yetkazmalar ro'yxati va bosh sahifa, o'z mijozlari, qarz/to'lovlar, hisobot — faqat o'z ma'lumoti
 *    (so'rovdagi agent/kompaniya ID'si e'tiborsiz; kontekst sessiyadan).
 *  - Boshqaruvchi: kunlik holat (biriktirilgan/biriktirilmagan, yo'lda, yetkazilgan, muvaffaqiyatsiz, qaytgan, kechikkan),
 *    agentlar kesimida progress va yig'ilgan pul, davr hisoboti.
 */
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { OPEN_DELIVERY_STATUSES, badRequest, notFound, type DeliveryStatus } from "@bum/shared";
import { deliveryAgents, deliveryPayments, deliveryTasks } from "../../db/schema/delivery.js";
import { users } from "../../db/schema/platform.js";
import { customers } from "../../db/schema/sales.js";
import type { DbOrTx } from "../../db/transaction.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import { distanceMeters, pointOf, type GeoPoint } from "../../shared/geo.js";
import type { TenantContext } from "../company/tenant.js";
import type { DeliveryAgentContext } from "./agent-context.js";
import { hhmm, localDate, localDayStart } from "./task.repo.js";
import { isOverdue, overdueCondition, presentTask, returnPendingCondition, taskListQuery } from "./tasks.service.js";
import { currentDeliverySession } from "./tracking.service.js";

const OPEN = [...OPEN_DELIVERY_STATUSES] as DeliveryStatus[];
const FINAL: DeliveryStatus[] = ["delivered", "partially_delivered", "failed", "returned", "cancelled"];
const DONE: DeliveryStatus[] = ["delivered", "partially_delivered", "failed", "returned"];
const DAY_MS = 86_400_000;
const MAX_REPORT_DAYS = 93;
const likePattern = (value: string) => `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const positive = (value: bigint) => (value > 0n ? value : 0n);

function agentScope(context: DeliveryAgentContext) {
  return and(eq(deliveryTasks.companyId, context.company.id), eq(deliveryTasks.deliveryAgentId, context.deliveryAgent.id))!;
}

/** Bugungi ish: bugunga rejalangan va oldingi kunlardan qolgan ochiq yetkazmalar. */
function todayScope(today: string) {
  return or(eq(deliveryTasks.scheduledDate, today), and(inArray(deliveryTasks.status, OPEN), lt(deliveryTasks.scheduledDate, today)))!;
}

export async function agentTaskList(conn: DbOrTx, context: DeliveryAgentContext, options: { scope: "today" | "upcoming" | "history"; origin: GeoPoint | null }) {
  const today = localDate();
  const where =
    options.scope === "today"
      ? and(agentScope(context), todayScope(today))
      : options.scope === "upcoming"
        ? and(agentScope(context), sql`${deliveryTasks.scheduledDate} > ${today}::date`, inArray(deliveryTasks.status, OPEN))
        : and(agentScope(context), inArray(deliveryTasks.status, FINAL), gte(deliveryTasks.updatedAt, new Date(Date.now() - 30 * DAY_MS)));
  const query = taskListQuery(conn).where(where);
  const rows =
    options.scope === "history"
      ? await query.orderBy(desc(deliveryTasks.updatedAt)).limit(100)
      : await query
          .orderBy(asc(deliveryTasks.scheduledDate), sql`${deliveryTasks.routeOrder} asc nulls last`, sql`${deliveryTasks.windowStart} asc nulls last`, asc(deliveryTasks.createdAt))
          .limit(500);
  return rows.map((row) => {
    const target = pointOf(row.customerLatitude, row.customerLongitude);
    return {
      ...presentTask(row),
      distanceMeters: options.origin && target ? Math.round(distanceMeters(options.origin, target)) : null,
    };
  });
}

export async function agentDashboard(conn: DbOrTx, context: DeliveryAgentContext, canViewDebt: boolean) {
  const today = localDate();
  const dayStart = localDayStart(today);
  const tasks = await conn
    .select({
      status: deliveryTasks.status,
      scheduledDate: deliveryTasks.scheduledDate,
      windowEnd: deliveryTasks.windowEnd,
      expectedAmount: deliveryTasks.expectedAmount,
      collectedAmount: deliveryTasks.collectedAmount,
      customerId: deliveryTasks.customerId,
    })
    .from(deliveryTasks)
    .where(and(agentScope(context), todayScope(today), ne(deliveryTasks.status, "cancelled")));
  const count = (statuses: DeliveryStatus[]) => tasks.filter((task) => statuses.includes(task.status)).length;
  const done = count(DONE);
  let expectedPending = 0n;
  let mismatch = 0n;
  for (const task of tasks) {
    const gap = positive(toMinor(task.expectedAmount) - toMinor(task.collectedAmount));
    if (OPEN.includes(task.status)) expectedPending += gap;
    else if (task.status === "delivered" || task.status === "partially_delivered") mismatch += gap;
  }

  const collectedRows = await conn
    .select({ method: deliveryPayments.method, total: sql<string>`coalesce(sum(${deliveryPayments.amount}), 0)::numeric(18,2)` })
    .from(deliveryPayments)
    .innerJoin(deliveryTasks, eq(deliveryTasks.id, deliveryPayments.taskId))
    .where(and(agentScope(context), gte(deliveryPayments.collectedAt, dayStart)))
    .groupBy(deliveryPayments.method);
  const collected = { cash: "0.00", card: "0.00", bank: "0.00", total: "0.00" };
  let totalCollected = 0n;
  for (const row of collectedRows) {
    collected[row.method] = row.total;
    totalCollected += toMinor(row.total);
  }
  collected.total = fromMinor(totalCollected);

  let customersDebt: string | null = null;
  const customerIds = [...new Set(tasks.map((task) => task.customerId))];
  if (canViewDebt) {
    const [debt] =
      customerIds.length > 0
        ? await conn
            .select({ total: sql<string>`coalesce(sum(${customers.totalDebt}) filter (where ${customers.totalDebt} > 0), 0)::numeric(18,2)` })
            .from(customers)
            .where(inArray(customers.id, customerIds))
        : [{ total: "0.00" }];
    customersDebt = debt!.total;
  }
  return {
    date: today,
    tasks: {
      total: tasks.length,
      done,
      remaining: count(OPEN),
      onRoute: count(["out_for_delivery", "arrived", "delivering"]),
      delivered: count(["delivered"]),
      partiallyDelivered: count(["partially_delivered"]),
      failed: count(["failed"]),
      returned: count(["returned"]),
      late: tasks.filter((task) => isOverdue(task)).length,
    },
    progressPercent: tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100),
    collected,
    expectedPending: fromMinor(expectedPending),
    mismatchAmount: fromMinor(mismatch),
    customersDebt,
    workSession: await currentDeliverySession(conn, context.deliveryAgent.id),
  };
}

/** Agent mijozlari: yakunlanmagan yoki so'nggi 90 kundagi yetkazmalaridagi mijozlar. */
export async function agentCustomers(conn: DbOrTx, context: DeliveryAgentContext, options: { search?: string; canViewDebt: boolean }) {
  const since = new Date(Date.now() - 90 * DAY_MS);
  const conditions: (SQL | undefined)[] = [agentScope(context), or(inArray(deliveryTasks.status, OPEN), gte(deliveryTasks.updatedAt, since))];
  if (options.search) {
    const pattern = likePattern(options.search);
    conditions.push(or(ilike(customers.name, pattern), ilike(customers.phone, pattern), ilike(customers.address, pattern)));
  }
  const rows = await conn
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      address: customers.address,
      contactName: customers.contactName,
      latitude: customers.latitude,
      longitude: customers.longitude,
      totalDebt: customers.totalDebt,
      openTasks: sql<number>`count(*) filter (where ${deliveryTasks.status} in ('ready', 'assigned', 'accepted', 'out_for_delivery', 'arrived', 'delivering'))::int`,
      deliveries: sql<number>`count(*) filter (where ${deliveryTasks.status} in ('delivered', 'partially_delivered'))::int`,
      lastDeliveredAt: sql<Date | null>`max(${deliveryTasks.deliveredAt})`,
      pendingPayments: sql<number>`count(*) filter (where ${deliveryTasks.paymentStatus} in ('pending', 'mismatch', 'partial'))::int`,
    })
    .from(deliveryTasks)
    .innerJoin(customers, eq(customers.id, deliveryTasks.customerId))
    .where(and(...conditions))
    .groupBy(customers.id)
    .orderBy(asc(customers.name))
    .limit(300);
  return rows.map(({ totalDebt, lastDeliveredAt, ...row }) => ({
    ...row,
    lastDeliveredAt: lastDeliveredAt ? new Date(lastDeliveredAt) : null,
    ...(options.canViewDebt ? { totalDebt } : {}),
  }));
}

export async function agentCustomer(conn: DbOrTx, context: DeliveryAgentContext, customerId: string, canViewDebt: boolean) {
  const tasks = await taskListQuery(conn)
    .where(and(agentScope(context), eq(deliveryTasks.customerId, customerId)))
    .orderBy(desc(deliveryTasks.scheduledDate), desc(deliveryTasks.createdAt))
    .limit(20);
  // Agentga biriktirilgan yetkazmasi yo'q mijoz — ko'rinmaydi
  if (tasks.length === 0) throw notFound("Mijoz topilmadi");
  const [customer] = await conn
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      address: customers.address,
      contactName: customers.contactName,
      latitude: customers.latitude,
      longitude: customers.longitude,
      totalDebt: customers.totalDebt,
      balance: customers.balance,
    })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  const { totalDebt, balance, ...publicCustomer } = customer!;
  return {
    customer: canViewDebt ? { ...publicCustomer, totalDebt, balance } : publicCustomer,
    tasks: tasks.map(presentTask),
  };
}

/** Qarz va to'lovlar: mijozlar qarzi, to'lov farqi qolgan yetkazmalar, bugungi yig'imlar. */
export async function agentDebts(conn: DbOrTx, context: DeliveryAgentContext) {
  const since = new Date(Date.now() - 30 * DAY_MS);
  const debtors = await conn
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      address: customers.address,
      totalDebt: customers.totalDebt,
      lastDeliveredAt: sql<Date | null>`max(${deliveryTasks.deliveredAt})`,
    })
    .from(deliveryTasks)
    .innerJoin(customers, eq(customers.id, deliveryTasks.customerId))
    .where(and(agentScope(context), or(inArray(deliveryTasks.status, OPEN), gte(deliveryTasks.updatedAt, since)), sql`${customers.totalDebt} > 0`))
    .groupBy(customers.id)
    .orderBy(desc(customers.totalDebt))
    .limit(200);
  const shortfalls = await taskListQuery(conn)
    .where(and(agentScope(context), inArray(deliveryTasks.paymentStatus, ["mismatch", "partial"]), gte(deliveryTasks.updatedAt, since)))
    .orderBy(desc(deliveryTasks.deliveredAt))
    .limit(100);
  const today = localDate();
  const collections = await conn
    .select({
      id: deliveryPayments.id,
      taskId: deliveryPayments.taskId,
      number: deliveryTasks.number,
      customerName: customers.name,
      method: deliveryPayments.method,
      amount: deliveryPayments.amount,
      collectedAt: deliveryPayments.collectedAt,
      offline: deliveryPayments.offline,
    })
    .from(deliveryPayments)
    .innerJoin(deliveryTasks, eq(deliveryTasks.id, deliveryPayments.taskId))
    .innerJoin(customers, eq(customers.id, deliveryTasks.customerId))
    .where(and(agentScope(context), gte(deliveryPayments.collectedAt, localDayStart(today))))
    .orderBy(desc(deliveryPayments.collectedAt));
  return {
    debtors: debtors.map((row) => ({ ...row, lastDeliveredAt: row.lastDeliveredAt ? new Date(row.lastDeliveredAt) : null })),
    shortfalls: shortfalls.map((row) => ({ ...presentTask(row), mismatchAmount: fromMinor(positive(toMinor(row.expectedAmount) - toMinor(row.collectedAmount))) })),
    collections,
  };
}

export function reportRange(from?: string, to?: string) {
  const today = localDate();
  const end = to ?? today;
  const start = from ?? `${end.slice(0, 7)}-01`;
  if (start > end) throw badRequest("Davr boshi oxiridan keyin bo'lmasin");
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS) + 1;
  if (days > MAX_REPORT_DAYS) throw badRequest(`Hisobot davri ${MAX_REPORT_DAYS} kundan oshmasin`);
  return { from: start, to: end, start: localDayStart(start), end: new Date(localDayStart(end).getTime() + DAY_MS) };
}

/** Davr bo'yicha agentlar kesimi (bitta agent yoki hammasi). */
async function periodRows(conn: DbOrTx, companyId: string, range: ReturnType<typeof reportRange>, deliveryAgentId?: string) {
  const agentCondition = deliveryAgentId ? eq(deliveryTasks.deliveryAgentId, deliveryAgentId) : isNotNull(deliveryTasks.deliveryAgentId);
  const tasks = await conn
    .select({
      deliveryAgentId: deliveryTasks.deliveryAgentId,
      total: sql<number>`count(*) filter (where ${deliveryTasks.status} <> 'cancelled')::int`,
      delivered: sql<number>`count(*) filter (where ${deliveryTasks.status} = 'delivered')::int`,
      partiallyDelivered: sql<number>`count(*) filter (where ${deliveryTasks.status} = 'partially_delivered')::int`,
      failed: sql<number>`count(*) filter (where ${deliveryTasks.status} = 'failed')::int`,
      returned: sql<number>`count(*) filter (where ${deliveryTasks.status} = 'returned')::int`,
      cancelled: sql<number>`count(*) filter (where ${deliveryTasks.status} = 'cancelled')::int`,
      open: sql<number>`count(*) filter (where ${deliveryTasks.status} in ('ready', 'assigned', 'accepted', 'out_for_delivery', 'arrived', 'delivering'))::int`,
      mismatch: sql<string>`coalesce(sum(greatest(${deliveryTasks.expectedAmount} - ${deliveryTasks.collectedAmount}, 0)) filter (where ${deliveryTasks.status} in ('delivered', 'partially_delivered')), 0)::numeric(18,2)`,
      averageMinutes: sql<number | null>`round(avg(extract(epoch from (${deliveryTasks.deliveredAt} - ${deliveryTasks.startedAt})) / 60) filter (where ${deliveryTasks.deliveredAt} is not null and ${deliveryTasks.startedAt} is not null))::int`,
      late: sql<number>`count(*) filter (where ${deliveryTasks.status} in ('delivered', 'partially_delivered') and (
        (${deliveryTasks.deliveredAt} at time zone 'Asia/Tashkent')::date > ${deliveryTasks.scheduledDate}
        or (${deliveryTasks.windowEnd} is not null and (${deliveryTasks.deliveredAt} at time zone 'Asia/Tashkent')::date = ${deliveryTasks.scheduledDate}
            and (${deliveryTasks.deliveredAt} at time zone 'Asia/Tashkent')::time > ${deliveryTasks.windowEnd})))::int`,
    })
    .from(deliveryTasks)
    .where(
      and(
        eq(deliveryTasks.companyId, companyId),
        agentCondition,
        sql`${deliveryTasks.scheduledDate} >= ${range.from}::date`,
        sql`${deliveryTasks.scheduledDate} <= ${range.to}::date`,
      ),
    )
    .groupBy(deliveryTasks.deliveryAgentId);
  const payments = await conn
    .select({
      deliveryAgentId: deliveryTasks.deliveryAgentId,
      method: deliveryPayments.method,
      total: sql<string>`coalesce(sum(${deliveryPayments.amount}), 0)::numeric(18,2)`,
    })
    .from(deliveryPayments)
    .innerJoin(deliveryTasks, eq(deliveryTasks.id, deliveryPayments.taskId))
    .where(and(eq(deliveryTasks.companyId, companyId), agentCondition, gte(deliveryPayments.collectedAt, range.start), lt(deliveryPayments.collectedAt, range.end)))
    .groupBy(deliveryTasks.deliveryAgentId, deliveryPayments.method);
  const failures = await conn
    .select({ reason: deliveryTasks.failureReason, count: sql<number>`count(*)::int` })
    .from(deliveryTasks)
    .where(
      and(
        eq(deliveryTasks.companyId, companyId),
        agentCondition,
        isNotNull(deliveryTasks.failureReason),
        sql`${deliveryTasks.scheduledDate} >= ${range.from}::date`,
        sql`${deliveryTasks.scheduledDate} <= ${range.to}::date`,
      ),
    )
    .groupBy(deliveryTasks.failureReason);
  return { tasks, payments, failures };
}

async function routeDistanceMeters(conn: DbOrTx, companyId: string, deliveryAgentId: string, start: Date, end: Date) {
  const result = await conn.execute<{ meters: string | null }>(sql`
    with pts as (
      select latitude::float8 as lat, longitude::float8 as lng, recorded_at,
             lag(latitude::float8) over w as plat, lag(longitude::float8) over w as plng, lag(recorded_at) over w as pat
        from delivery_locations
       where company_id = ${companyId} and delivery_agent_id = ${deliveryAgentId} and not suspicious
         and recorded_at >= ${start.toISOString()}::timestamptz and recorded_at < ${end.toISOString()}::timestamptz
      window w as (order by recorded_at)
    )
    select coalesce(sum(2 * 6371008.8 * asin(least(1, sqrt(
             power(sin(radians(lat - plat) / 2), 2) + cos(radians(plat)) * cos(radians(lat)) * power(sin(radians(lng - plng) / 2), 2))))), 0)::bigint as meters
      from pts where plat is not null and recorded_at - pat < interval '30 minutes'`);
  return Number(result.rows[0]?.meters ?? 0);
}

function collectedBy(rows: { method: "cash" | "card" | "bank"; total: string }[]) {
  const collected = { cash: 0n, card: 0n, bank: 0n };
  for (const row of rows) collected[row.method] += toMinor(row.total);
  return {
    cash: fromMinor(collected.cash),
    card: fromMinor(collected.card),
    bank: fromMinor(collected.bank),
    total: fromMinor(collected.cash + collected.card + collected.bank),
  };
}

const EMPTY_TASKS = { total: 0, delivered: 0, partiallyDelivered: 0, failed: 0, returned: 0, cancelled: 0, open: 0, mismatch: "0.00", averageMinutes: null, late: 0 };

export async function agentReport(conn: DbOrTx, context: DeliveryAgentContext, from?: string, to?: string) {
  const range = reportRange(from, to);
  const { tasks, payments, failures } = await periodRows(conn, context.company.id, range, context.deliveryAgent.id);
  const { deliveryAgentId: _agentId, ...summary } = tasks[0] ?? { deliveryAgentId: null, ...EMPTY_TASKS };
  return {
    from: range.from,
    to: range.to,
    deliveries: summary,
    collected: collectedBy(payments),
    failureReasons: failures,
    routeDistanceMeters: await routeDistanceMeters(conn, context.company.id, context.deliveryAgent.id, range.start, range.end),
  };
}

export async function supervisorReport(conn: DbOrTx, tenant: TenantContext, options: { from?: string; to?: string; deliveryAgentId?: string }) {
  const range = reportRange(options.from, options.to);
  const { tasks, payments, failures } = await periodRows(conn, tenant.company.id, range, options.deliveryAgentId);
  const agents = await conn
    .select({ id: deliveryAgents.id, code: deliveryAgents.code, name: users.name, territory: deliveryAgents.territory, branchId: deliveryAgents.branchId })
    .from(deliveryAgents)
    .innerJoin(users, eq(users.id, deliveryAgents.userId))
    .where(and(eq(deliveryAgents.companyId, tenant.company.id), options.deliveryAgentId ? eq(deliveryAgents.id, options.deliveryAgentId) : undefined))
    .orderBy(asc(users.name));
  const rows = agents
    .map((agent) => {
      const row = tasks.find((item) => item.deliveryAgentId === agent.id);
      const { deliveryAgentId: _agentId, ...summary } = row ?? { deliveryAgentId: null, ...EMPTY_TASKS };
      return { agent, ...summary, collected: collectedBy(payments.filter((payment) => payment.deliveryAgentId === agent.id)) };
    })
    .filter((row) => row.total > 0 || row.cancelled > 0 || toMinor(row.collected.total) > 0n);
  return { from: range.from, to: range.to, agents: rows, collected: collectedBy(payments), failureReasons: failures };
}

export async function supervisorDashboard(conn: DbOrTx, tenant: TenantContext, date = localDate()) {
  const companyId = tenant.company.id;
  const statuses = await conn
    .select({ status: deliveryTasks.status, count: sql<number>`count(*)::int` })
    .from(deliveryTasks)
    .where(and(eq(deliveryTasks.companyId, companyId), eq(deliveryTasks.scheduledDate, date)))
    .groupBy(deliveryTasks.status);
  const byStatus = (list: DeliveryStatus[]) => statuses.filter((row) => list.includes(row.status)).reduce((sum, row) => sum + row.count, 0);
  const [overdue] = await conn.select({ count: sql<number>`count(*)::int` }).from(deliveryTasks).where(and(eq(deliveryTasks.companyId, companyId), overdueCondition()));
  const [reviews] = await conn
    .select({ count: sql<number>`count(*)::int` })
    .from(deliveryTasks)
    .where(and(eq(deliveryTasks.companyId, companyId), eq(deliveryTasks.paymentReview, "pending")));
  const [returnsPending] = await conn
    .select({ count: sql<number>`count(*)::int` })
    .from(deliveryTasks)
    .where(and(eq(deliveryTasks.companyId, companyId), returnPendingCondition()));
  const dayStart = localDayStart(date);
  const payments = await conn
    .select({ deliveryAgentId: deliveryTasks.deliveryAgentId, method: deliveryPayments.method, total: sql<string>`coalesce(sum(${deliveryPayments.amount}), 0)::numeric(18,2)` })
    .from(deliveryPayments)
    .innerJoin(deliveryTasks, eq(deliveryTasks.id, deliveryPayments.taskId))
    .where(and(eq(deliveryTasks.companyId, companyId), gte(deliveryPayments.collectedAt, dayStart), lt(deliveryPayments.collectedAt, new Date(dayStart.getTime() + DAY_MS))))
    .groupBy(deliveryTasks.deliveryAgentId, deliveryPayments.method);
  const perAgent = await conn
    .select({
      deliveryAgentId: deliveryTasks.deliveryAgentId,
      name: users.name,
      code: deliveryAgents.code,
      total: sql<number>`count(*) filter (where ${deliveryTasks.status} <> 'cancelled')::int`,
      done: sql<number>`count(*) filter (where ${deliveryTasks.status} in ('delivered', 'partially_delivered', 'failed', 'returned'))::int`,
      onRoute: sql<number>`count(*) filter (where ${deliveryTasks.status} in ('out_for_delivery', 'arrived', 'delivering'))::int`,
      failed: sql<number>`count(*) filter (where ${deliveryTasks.status} = 'failed')::int`,
    })
    .from(deliveryTasks)
    .innerJoin(deliveryAgents, eq(deliveryAgents.id, deliveryTasks.deliveryAgentId))
    .innerJoin(users, eq(users.id, deliveryAgents.userId))
    .where(and(eq(deliveryTasks.companyId, companyId), eq(deliveryTasks.scheduledDate, date)))
    .groupBy(deliveryTasks.deliveryAgentId, users.name, deliveryAgents.code)
    .orderBy(asc(users.name));
  return {
    date,
    total: byStatus(["ready", "assigned", "accepted", "out_for_delivery", "arrived", "delivering", "delivered", "partially_delivered", "failed", "returned"]),
    unassigned: byStatus(["ready"]),
    assigned: byStatus(["assigned", "accepted", "out_for_delivery", "arrived", "delivering", "delivered", "partially_delivered", "failed", "returned"]),
    waiting: byStatus(["assigned", "accepted"]),
    onRoute: byStatus(["out_for_delivery", "arrived", "delivering"]),
    delivered: byStatus(["delivered"]),
    partiallyDelivered: byStatus(["partially_delivered"]),
    failed: byStatus(["failed"]),
    returned: byStatus(["returned"]),
    cancelled: byStatus(["cancelled"]),
    overdue: overdue!.count,
    pendingReviews: reviews!.count,
    pendingReturns: returnsPending!.count,
    collected: collectedBy(payments),
    agents: perAgent.map((row) => ({ ...row, collected: collectedBy(payments.filter((payment) => payment.deliveryAgentId === row.deliveryAgentId)) })),
  };
}

export { hhmm };
