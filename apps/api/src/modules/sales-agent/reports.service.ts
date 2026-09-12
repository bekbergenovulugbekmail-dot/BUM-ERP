/**
 * Agent hisobotlari (FROM/TO, 93 kungacha) — faqat agentning o'z ma'lumoti, hammasi serverda:
 *  - sotuv: agent yuborgan va tasdiqlangan/jo'natilgan/yetkazilgan buyurtmalar (bosh sahifa bilan bir xil qoida), to'lov
 *    turi bo'yicha, kunlar, top mahsulot va mijozlar
 *  - tashriflar: natija, bekor bo'lganlar, o'rtacha davomiylik, buyurtmasiz sabablar
 *  - plan: oylik reja davrga kunlar ulushi bo'yicha
 *  - qarz: agentga ochiq mijozlarning joriy qarzi (holat — bugungi) va davrda agent buyurtmalariga yig'ilgan to'lov
 *  - aksiyalar: agent buyurtmalarida qo'llangan aksiyalar va chegirma summasi
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { badRequest } from "@bum/shared";
import { products } from "../../db/schema/catalog.js";
import { companies } from "../../db/schema/platform.js";
import { customerPayments, customers, salesOrderItems, salesOrders } from "../../db/schema/sales.js";
import { agentOrders, agentVisits, orderPromotions, promotions } from "../../db/schema/sales-agent.js";
import type { DbOrTx } from "../../db/transaction.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import type { AgentContext } from "./agent-context.js";
import type { NoOrderReason } from "./visits.service.js";
import { SOLD_STATUSES } from "./dashboard.service.js";
import { agentDebtors } from "./stores.service.js";

export const REPORT_MAX_DAYS = 93;

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
const isoOfDay = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
const daysInMonth = (date: string) => new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
const moneySum = (column: unknown) => sql<string>`coalesce(sum(${column}), 0)::numeric(18,2)::text`;

/** Oylik reja davrga: har oy uchun (davrdagi kunlar / oy kunlari) ulushi. */
export function proratedTarget(monthlyTarget: bigint, from: string, to: string): bigint {
  if (monthlyTarget <= 0n) return 0n;
  let total = 0n;
  let day = dayNumber(from);
  const end = dayNumber(to);
  while (day <= end) {
    const date = isoOfDay(day);
    const monthDays = daysInMonth(date);
    const last = Math.min(end, day + monthDays - Number(date.slice(8, 10)));
    total += (monthlyTarget * BigInt(last - day + 1)) / BigInt(monthDays);
    day = last + 1;
  }
  return total;
}

export async function agentReport(conn: DbOrTx, context: AgentContext, range: { from: string; to: string }) {
  const span = dayNumber(range.to) - dayNumber(range.from) + 1;
  if (span < 1) throw badRequest("Davr noto'g'ri: boshlanish sanasi tugashidan keyin", { reason: "range_invalid" });
  if (span > REPORT_MAX_DAYS) throw badRequest(`Davr ${REPORT_MAX_DAYS} kundan oshmasin`, { reason: "range_too_long", maxDays: REPORT_MAX_DAYS });

  const companyId = context.company.id;
  const salesRepId = context.agent.id;
  const sold = and(
    eq(agentOrders.companyId, companyId),
    eq(agentOrders.salesRepId, salesRepId),
    isNotNull(agentOrders.submittedAt),
    inArray(salesOrders.status, [...SOLD_STATUSES]),
    gte(salesOrders.orderDate, range.from),
    lte(salesOrders.orderDate, range.to),
  );

  const [company] = await conn.select({ currency: companies.currency }).from(companies).where(eq(companies.id, companyId)).limit(1);

  const [totals] = await conn
    .select({
      orders: sql<number>`count(*)::int`,
      total: moneySum(salesOrders.totalAmount),
      cash: sql<string>`coalesce(sum(${salesOrders.totalAmount}) filter (where ${agentOrders.paymentType} = 'cash'), 0)::numeric(18,2)::text`,
      card: sql<string>`coalesce(sum(${salesOrders.totalAmount}) filter (where ${agentOrders.paymentType} = 'card'), 0)::numeric(18,2)::text`,
      credit: sql<string>`coalesce(sum(${salesOrders.totalAmount}) filter (where ${agentOrders.paymentType} = 'credit'), 0)::numeric(18,2)::text`,
      customers: sql<number>`count(distinct ${agentOrders.customerId})::int`,
    })
    .from(agentOrders)
    .innerJoin(salesOrders, eq(salesOrders.id, agentOrders.orderId))
    .where(sold);

  const byDay = await conn
    .select({ date: salesOrders.orderDate, amount: moneySum(salesOrders.totalAmount), orders: sql<number>`count(*)::int` })
    .from(agentOrders)
    .innerJoin(salesOrders, eq(salesOrders.id, agentOrders.orderId))
    .where(sold)
    .groupBy(salesOrders.orderDate)
    .orderBy(asc(salesOrders.orderDate));

  const topProducts = await conn
    .select({
      productId: salesOrderItems.productId,
      name: products.name,
      quantity: sql<string>`sum(${salesOrderItems.quantity})::numeric(18,4)::text`,
      amount: moneySum(salesOrderItems.lineTotal),
    })
    .from(salesOrderItems)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.orderId))
    .innerJoin(agentOrders, eq(agentOrders.orderId, salesOrders.id))
    .innerJoin(products, eq(products.id, salesOrderItems.productId))
    .where(sold)
    .groupBy(salesOrderItems.productId, products.name)
    .orderBy(desc(sql`sum(${salesOrderItems.lineTotal})`), desc(sql`sum(${salesOrderItems.quantity})`))
    .limit(10);

  const topCustomers = await conn
    .select({ customerId: customers.id, name: customers.name, amount: moneySum(salesOrders.totalAmount), orders: sql<number>`count(*)::int` })
    .from(agentOrders)
    .innerJoin(salesOrders, eq(salesOrders.id, agentOrders.orderId))
    .innerJoin(customers, eq(customers.id, agentOrders.customerId))
    .where(sold)
    .groupBy(customers.id, customers.name)
    .orderBy(desc(sql`sum(${salesOrders.totalAmount})`))
    .limit(10);

  const visitScope = and(
    eq(agentVisits.companyId, companyId),
    eq(agentVisits.salesRepId, salesRepId),
    gte(agentVisits.visitDate, range.from),
    lte(agentVisits.visitDate, range.to),
  );
  const [visitTotals] = await conn
    .select({
      total: sql<number>`count(*)::int`,
      ordered: sql<number>`(count(*) filter (where ${agentVisits.result} = 'ordered'))::int`,
      noOrder: sql<number>`(count(*) filter (where ${agentVisits.result} = 'no_order'))::int`,
      invalid: sql<number>`(count(*) filter (where ${agentVisits.invalidatedAt} is not null))::int`,
      averageSeconds: sql<number | null>`round(avg(${agentVisits.durationSeconds}) filter (where ${agentVisits.status} = 'completed'))::int`,
    })
    .from(agentVisits)
    .where(visitScope);
  const reasonRows = await conn
    .select({ reason: agentVisits.noOrderReason, count: sql<number>`count(*)::int` })
    .from(agentVisits)
    .where(and(visitScope, eq(agentVisits.result, "no_order")))
    .groupBy(agentVisits.noOrderReason);
  const reasons: Partial<Record<NoOrderReason, number>> = {};
  for (const row of reasonRows) if (row.reason) reasons[row.reason] = row.count;

  const [collected] = await conn
    .select({ amount: moneySum(customerPayments.amount) })
    .from(customerPayments)
    .innerJoin(agentOrders, eq(agentOrders.orderId, customerPayments.orderId))
    .where(
      and(
        eq(customerPayments.companyId, companyId),
        eq(agentOrders.salesRepId, salesRepId),
        gte(customerPayments.paymentDate, range.from),
        lte(customerPayments.paymentDate, range.to),
      ),
    );
  const debtors = await agentDebtors(conn, context, { filter: "all", origin: null });

  const promotionRows = await conn
    .select({
      promotionId: promotions.id,
      name: promotions.name,
      count: sql<number>`count(*)::int`,
      discountAmount: moneySum(orderPromotions.discountAmount),
    })
    .from(orderPromotions)
    .innerJoin(agentOrders, eq(agentOrders.orderId, orderPromotions.orderId))
    .innerJoin(salesOrders, eq(salesOrders.id, orderPromotions.orderId))
    .innerJoin(promotions, eq(promotions.id, orderPromotions.promotionId))
    .where(sold)
    .groupBy(promotions.id, promotions.name)
    .orderBy(desc(sql`count(*)`));

  const total = toMinor(totals!.total);
  const target = proratedTarget(toMinor(context.agent.monthlyTarget), range.from, range.to);
  return {
    from: range.from,
    to: range.to,
    currency: company?.currency ?? "UZS",
    sales: {
      orderCount: totals!.orders,
      total: totals!.total,
      cash: totals!.cash,
      card: totals!.card,
      credit: totals!.credit,
      averageOrder: totals!.orders > 0 ? fromMinor(total / BigInt(totals!.orders)) : "0.00",
      customerCount: totals!.customers,
      byDay,
      topProducts,
      topCustomers,
    },
    visits: {
      total: visitTotals!.total,
      ordered: visitTotals!.ordered,
      noOrder: visitTotals!.noOrder,
      invalid: visitTotals!.invalid,
      averageMinutes: visitTotals!.averageSeconds === null ? null : Math.round(visitTotals!.averageSeconds / 60),
      reasons,
    },
    plan: { target: fromMinor(target), achieved: totals!.total, percent: target > 0n ? Number((total * 100n) / target) : 0 },
    debt: {
      customers: debtors.length,
      total: fromMinor(debtors.reduce((sum, debtor) => sum + toMinor(debtor.totalDebt), 0n)),
      overdueCustomers: debtors.filter((debtor) => debtor.status === "overdue").length,
      collected: collected!.amount,
    },
    promotions: {
      applied: promotionRows.reduce((sum, row) => sum + row.count, 0),
      discountTotal: fromMinor(promotionRows.reduce((sum, row) => sum + toMinor(row.discountAmount), 0n)),
      items: promotionRows,
    },
  };
}
