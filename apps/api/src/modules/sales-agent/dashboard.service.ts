/**
 * Agent bosh sahifasi (hammasi serverda, agentning o'z ma'lumotidan):
 *  - savdo — agent yuborgan va tasdiqlangan/jo'natilgan/yetkazilgan buyurtmalar (buyurtma sanasi bo'yicha, asosiy valyutada)
 *  - yig'ilgan to'lov — bugun agent buyurtmalariga yozilgan to'lovlar
 *  - tashriflar — bugungi marshrut do'konlari va yakunlangan tashriflar
 *  - oylik plan — agentning oylik rejasi, bajarilgani, qolgan kunlar (bugun bilan) va kuniga kerak; bugungi plan —
 *    kun boshidagi qoldiqni qolgan kunlarga bo'lish
 *  - o'rin — kompaniyaning faol agentlari orasida oylik savdo bo'yicha
 */
import { and, count, countDistinct, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { salesReps } from "../../db/schema/crm.js";
import { companies } from "../../db/schema/platform.js";
import { customerPayments, salesOrders } from "../../db/schema/sales.js";
import { agentOrders, agentProspects, agentVisits } from "../../db/schema/sales-agent.js";
import type { DbOrTx } from "../../db/transaction.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import { todayIso } from "../finance/cash.service.js";
import type { AgentContext } from "./agent-context.js";
import { agentToday } from "./stores.service.js";

/** Savdo hisoblanadigan holatlar (qoralama, tasdiq kutayotgan, bekor va qaytarilgan — yo'q). */
export const SOLD_STATUSES = ["confirmed", "shipped", "delivered"] as const;

const daysInMonth = (date: string) => new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
const positive = (value: bigint) => (value > 0n ? value : 0n);

export async function agentDashboard(conn: DbOrTx, context: AgentContext) {
  const companyId = context.company.id;
  const salesRepId = context.agent.id;
  const today = todayIso();
  const monthStart = `${today.slice(0, 7)}-01`;

  const [company] = await conn.select({ currency: companies.currency }).from(companies).where(eq(companies.id, companyId)).limit(1);

  const daily = await conn
    .select({
      date: salesOrders.orderDate,
      amount: sql<string>`coalesce(sum(${salesOrders.totalAmount}), 0)::numeric(18,2)::text`,
      credit: sql<string>`coalesce(sum(${salesOrders.totalAmount}) filter (where ${agentOrders.paymentType} = 'credit'), 0)::numeric(18,2)::text`,
      orders: sql<number>`count(*)::int`,
      stores: sql<number>`count(distinct ${agentOrders.customerId})::int`,
    })
    .from(agentOrders)
    .innerJoin(salesOrders, eq(salesOrders.id, agentOrders.orderId))
    .where(
      and(
        eq(agentOrders.companyId, companyId),
        eq(agentOrders.salesRepId, salesRepId),
        isNotNull(agentOrders.submittedAt),
        inArray(salesOrders.status, [...SOLD_STATUSES]),
        gte(salesOrders.orderDate, monthStart),
      ),
    )
    .groupBy(salesOrders.orderDate);

  const todayRow = daily.find((row) => row.date === today);
  const todaySales = toMinor(todayRow?.amount ?? "0");
  const achieved = daily.reduce((sum, row) => sum + toMinor(row.amount), 0n);
  const monthOrders = daily.reduce((sum, row) => sum + row.orders, 0);
  const best = daily.reduce<(typeof daily)[number] | null>((top, row) => (!top || toMinor(row.amount) > toMinor(top.amount) ? row : top), null);

  const [collected] = await conn
    .select({ amount: sql<string>`coalesce(sum(${customerPayments.amount}), 0)::numeric(18,2)::text` })
    .from(customerPayments)
    .innerJoin(agentOrders, eq(agentOrders.orderId, customerPayments.orderId))
    .where(and(eq(customerPayments.companyId, companyId), eq(agentOrders.salesRepId, salesRepId), eq(customerPayments.paymentDate, today)));

  const plan = await agentToday(conn, context, null);
  const planned = new Set(plan.stores.map((store) => store.id));
  const visitedRows = await conn
    .selectDistinct({ customerId: agentVisits.customerId })
    .from(agentVisits)
    .where(
      and(
        eq(agentVisits.companyId, companyId),
        eq(agentVisits.salesRepId, salesRepId),
        eq(agentVisits.visitDate, today),
        eq(agentVisits.status, "completed"),
      ),
    );
  const visited = new Set(visitedRows.map((row) => row.customerId));
  const remainingStores = [...planned].filter((id) => !visited.has(id)).length;

  const target = toMinor(context.agent.monthlyTarget);
  const remaining = positive(target - achieved);
  const remainingDays = daysInMonth(today) - Number(today.slice(8, 10)) + 1;
  const dailyTarget = target > 0n ? positive(target - (achieved - todaySales)) / BigInt(remainingDays) : 0n;

  // O'rin: faol agentlar orasida oylik savdo bo'yicha
  const ranking = await conn
    .select({
      salesRepId: agentOrders.salesRepId,
      amount: sql<string>`coalesce(sum(${salesOrders.totalAmount}), 0)::numeric(18,2)::text`,
    })
    .from(agentOrders)
    .innerJoin(salesOrders, eq(salesOrders.id, agentOrders.orderId))
    .where(
      and(
        eq(agentOrders.companyId, companyId),
        isNotNull(agentOrders.submittedAt),
        inArray(salesOrders.status, [...SOLD_STATUSES]),
        gte(salesOrders.orderDate, monthStart),
      ),
    )
    .groupBy(agentOrders.salesRepId);
  const [activeReps] = await conn
    .select({ value: count() })
    .from(salesReps)
    .where(and(eq(salesReps.companyId, companyId), eq(salesReps.isActive, true)));
  const ahead = ranking.filter((row) => row.salesRepId !== salesRepId && toMinor(row.amount) > achieved).length;

  const [prospects] = await conn
    .select({ value: countDistinct(agentProspects.id) })
    .from(agentProspects)
    .where(
      and(
        eq(agentProspects.companyId, companyId),
        eq(agentProspects.salesRepId, salesRepId),
        gte(agentProspects.createdAt, new Date(`${monthStart}T00:00:00+05:00`)),
      ),
    );

  return {
    date: today,
    currency: company?.currency ?? "UZS",
    today: {
      salesAmount: fromMinor(todaySales),
      orderCount: todayRow?.orders ?? 0,
      creditSalesAmount: todayRow?.credit ?? "0.00",
      collectedAmount: collected?.amount ?? "0.00",
      plannedStores: planned.size,
      visitedStores: visited.size,
      orderedStores: todayRow?.stores ?? 0,
      remainingStores,
      dailyTarget: fromMinor(dailyTarget),
      remainingToday: fromMinor(positive(dailyTarget - todaySales)),
    },
    month: {
      target: fromMinor(target),
      achieved: fromMinor(achieved),
      percent: target > 0n ? Number((achieved * 100n) / target) : 0,
      remaining: fromMinor(remaining),
      remainingDays,
      requiredDaily: fromMinor(remaining / BigInt(remainingDays)),
      orderCount: monthOrders,
      bestDay: best ? { date: best.date, amount: best.amount } : null,
    },
    rank: (activeReps?.value ?? 0) > 1 ? { position: ahead + 1, total: activeReps!.value } : null,
    prospectsThisMonth: prospects?.value ?? 0,
  };
}
