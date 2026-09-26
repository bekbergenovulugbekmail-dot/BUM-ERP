/**
 * Tahlil hisobotlari (convex/analytics/reports.ts).
 *
 * Convex'dan farqlar:
 *  - hamma so'rov butun jadvallarni `.collect()` bilan xotiraga yuklardi — endi SQL yig'indilari
 *  - ruxsat tekshirilmasdi — `analytics.view`
 *  - sotuv tushumi qoralama va tasdiqlangan (jo'natilmagan) buyurtmalarni ham qo'shardi — endi
 *    jo'natilgan/yetkazilgan; umumiy ko'rinishdagi xarajatlar kutilayotganlarni ham qo'shardi — endi tasdiqlangan/to'langan
 *  - ABC tahlilida yagona (yoki eng qimmat) mahsulot "C" chiqardi (jami ulushi 100%) — endi
 *    mahsulotdan OLDINGI jamg'arma ulushi bo'yicha
 *  - aylanma tezligi "2 donadan kam — sekin" edi (davrga bog'liq emas) — endi zaxira necha kunga
 *    yetishi bo'yicha: 30 kungacha — tez, undan ko'p — sekin, sotuv yo'q — o'lik
 */
import { and, asc, desc, eq, gte, inArray, ne, notInArray, sql } from "drizzle-orm";
import { products } from "../../db/schema/catalog.js";
import { expenses } from "../../db/schema/finance.js";
import { employees } from "../../db/schema/hr.js";
import { stockLevels, stockMovements } from "../../db/schema/inventory.js";
import { purchaseOrders } from "../../db/schema/purchase.js";
import { customers, salesOrderItems, salesOrders } from "../../db/schema/sales.js";
import type { DbOrTx } from "../../db/transaction.js";
import { fromMinor, mulDivRound, toMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { todayIso } from "../finance/cash.service.js";
import { REALIZED_STATUSES } from "./dashboard.service.js";
import { shiftDate } from "./dates.js";

const sinceDate = (days: number) => shiftDate(todayIso(), -days);
const realized = inArray(salesOrders.status, [...REALIZED_STATUSES]);

function percent(part: bigint, whole: bigint): string {
  if (whole === 0n) return "0.00";
  const negative = part < 0n;
  const value = mulDivRound(negative ? -part : part, 10000n, whole);
  return fromMinor(negative ? -value : value);
}

export async function salesSummary(conn: DbOrTx, tenant: TenantContext, days: number) {
  const companyId = tenant.company.id;
  const since = sinceDate(days);

  const [totals] = await conn
    .select({
      totalOrders: sql<number>`count(*)::int`,
      totalRevenue: sql<string>`coalesce(sum(${salesOrders.totalAmount}), 0)::numeric(18,2)`,
      paidRevenue: sql<string>`coalesce(sum(${salesOrders.paidAmount}), 0)::numeric(18,2)`,
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.companyId, companyId), realized, gte(salesOrders.orderDate, since)));

  const topProducts = await conn
    .select({
      productId: products.id,
      name: products.name,
      quantity: sql<string>`sum(${salesOrderItems.quantity})::numeric(18,4)`,
      revenue: sql<string>`sum(${salesOrderItems.lineTotal})::numeric(18,2)`,
    })
    .from(salesOrderItems)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.orderId))
    .innerJoin(products, eq(products.id, salesOrderItems.productId))
    .where(and(eq(salesOrders.companyId, companyId), realized, gte(salesOrders.orderDate, since)))
    .groupBy(products.id, products.name)
    .orderBy(desc(sql`sum(${salesOrderItems.quantity})`))
    .limit(5);

  const byStatus = await conn
    .select({ status: salesOrders.status, count: sql<number>`count(*)::int` })
    .from(salesOrders)
    .where(and(eq(salesOrders.companyId, companyId), gte(salesOrders.orderDate, since)))
    .groupBy(salesOrders.status);

  const dailyRevenue = await conn
    .select({ date: salesOrders.orderDate, amount: sql<string>`sum(${salesOrders.totalAmount})::numeric(18,2)` })
    .from(salesOrders)
    .where(and(eq(salesOrders.companyId, companyId), realized, gte(salesOrders.orderDate, since)))
    .groupBy(salesOrders.orderDate)
    .orderBy(asc(salesOrders.orderDate));

  return { ...totals!, topProducts, byStatus, dailyRevenue };
}

async function stockByProduct(conn: DbOrTx, companyId: string) {
  return conn
    .select({
      productId: products.id,
      name: products.name,
      sku: products.sku,
      minStock: products.minStock,
      quantity: sql<string>`sum(${stockLevels.quantity})::numeric(18,4)`,
      value: sql<string>`sum(${stockLevels.quantity} * ${stockLevels.avgCostPrice})::numeric(18,2)`,
    })
    .from(stockLevels)
    .innerJoin(products, eq(products.id, stockLevels.productId))
    .where(and(eq(stockLevels.companyId, companyId), eq(products.isActive, true)))
    .groupBy(products.id, products.name, products.sku, products.minStock);
}

export async function stockSummary(conn: DbOrTx, tenant: TenantContext) {
  const rows = await stockByProduct(conn, tenant.company.id);

  let totalValue = 0n;
  let lowStock = 0;
  let outOfStock = 0;
  for (const row of rows) {
    const quantity = toMinor(row.quantity, 4);
    totalValue += toMinor(row.value);
    if (quantity === 0n) outOfStock++;
    else if (toMinor(row.minStock, 4) > 0n && quantity <= toMinor(row.minStock, 4)) lowStock++;
  }

  // ABC: mahsulotdan oldingi jamg'arma ulushi < 80% — A, < 95% — B, qolgani — C
  const sorted = [...rows].sort((a, b) => (toMinor(b.value) > toMinor(a.value) ? 1 : toMinor(b.value) < toMinor(a.value) ? -1 : 0));
  let cumulative = 0n;
  const abcData = sorted.map((row) => {
    const before = totalValue > 0n ? mulDivRound(cumulative, 10000n, totalValue) : 10000n;
    cumulative += toMinor(row.value);
    return {
      productId: row.productId,
      name: row.name,
      quantity: row.quantity,
      value: row.value,
      abc: before < 8000n ? "A" : before < 9500n ? "B" : "C",
    };
  });

  return { totalProducts: rows.length, totalValue: fromMinor(totalValue), lowStock, outOfStock, abcData: abcData.slice(0, 50) };
}

export async function expenseSummary(conn: DbOrTx, tenant: TenantContext, days: number) {
  const condition = and(
    eq(expenses.companyId, tenant.company.id),
    ne(expenses.status, "pending"),
    // Bekor qilingan xarajat (AUD-013) hisobotga kirmaydi — puli qaytgan
    ne(expenses.status, "reversed"),
    gte(expenses.expenseDate, sinceDate(days)),
  );
  const [totals] = await conn
    .select({ total: sql<string>`coalesce(sum(${expenses.amount}), 0)::numeric(18,2)` })
    .from(expenses)
    .where(condition);
  const byCategory = await conn
    .select({ category: expenses.category, amount: sql<string>`sum(${expenses.amount})::numeric(18,2)` })
    .from(expenses)
    .where(condition)
    .groupBy(expenses.category)
    .orderBy(desc(sql`sum(${expenses.amount})`));
  return { total: totals!.total, byCategory };
}

export async function purchaseSummary(conn: DbOrTx, tenant: TenantContext, days: number) {
  const [totals] = await conn
    .select({
      totalOrders: sql<number>`count(*)::int`,
      totalAmount: sql<string>`coalesce(sum(${purchaseOrders.totalAmount}), 0)::numeric(18,2)`,
      paidAmount: sql<string>`coalesce(sum(${purchaseOrders.paidAmount}), 0)::numeric(18,2)`,
    })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.companyId, tenant.company.id),
        notInArray(purchaseOrders.status, ["draft", "cancelled"]),
        gte(purchaseOrders.orderDate, sinceDate(days)),
      ),
    );
  return { ...totals!, debtAmount: fromMinor(toMinor(totals!.totalAmount) - toMinor(totals!.paidAmount)) };
}

export async function biOverview(conn: DbOrTx, tenant: TenantContext, days: number) {
  const companyId = tenant.company.id;
  const since = sinceDate(days);

  const [sales] = await conn
    .select({
      orderCount: sql<number>`count(*)::int`,
      revenue: sql<string>`coalesce(sum(${salesOrders.totalAmount}), 0)::numeric(18,2)`,
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.companyId, companyId), realized, gte(salesOrders.orderDate, since)));
  const [cogs] = await conn
    .select({ value: sql<string>`coalesce(sum(round(${salesOrderItems.quantity} * ${salesOrderItems.costPrice}, 2)), 0)::numeric(18,2)` })
    .from(salesOrderItems)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.orderId))
    .where(and(eq(salesOrders.companyId, companyId), realized, gte(salesOrders.orderDate, since)));
  const { total: expenseTotal } = await expenseSummary(conn, tenant, days);

  const [counts] = await conn
    .select({
      customerCount: sql<number>`(select count(*)::int from ${customers} where ${customers.companyId} = ${companyId} and ${customers.isActive})`,
      employeeCount: sql<number>`(select count(*)::int from ${employees} where ${employees.companyId} = ${companyId} and ${employees.status} = 'active')`,
      stockValue: sql<string>`(select coalesce(sum(${stockLevels.quantity} * ${stockLevels.avgCostPrice}), 0)::numeric(18,2) from ${stockLevels} where ${stockLevels.companyId} = ${companyId})`,
    })
    .from(sql`(select 1) as probe`);

  const revenue = toMinor(sales!.revenue);
  const grossProfit = revenue - toMinor(cogs!.value);
  const netProfit = grossProfit - toMinor(expenseTotal);
  return {
    revenue: sales!.revenue,
    cogs: cogs!.value,
    grossProfit: fromMinor(grossProfit),
    expenses: expenseTotal,
    netProfit: fromMinor(netProfit),
    grossMargin: percent(grossProfit, revenue),
    orderCount: sales!.orderCount,
    customerCount: counts!.customerCount,
    employeeCount: counts!.employeeCount,
    stockValue: counts!.stockValue,
  };
}

export async function topCustomers(conn: DbOrTx, tenant: TenantContext, days: number, limit: number) {
  return conn
    .select({
      customerId: customers.id,
      name: customers.name,
      amount: sql<string>`sum(${salesOrders.totalAmount})::numeric(18,2)`,
      orders: sql<number>`count(*)::int`,
    })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(and(eq(salesOrders.companyId, tenant.company.id), realized, gte(salesOrders.orderDate, sinceDate(days))))
    .groupBy(customers.id, customers.name)
    .orderBy(desc(sql`sum(${salesOrders.totalAmount})`))
    .limit(limit);
}

export async function stockVelocity(conn: DbOrTx, tenant: TenantContext, days: number) {
  const companyId = tenant.company.id;
  const sold = await conn
    .select({ productId: stockMovements.productId, quantity: sql<string>`sum(-${stockMovements.quantity})::numeric(18,4)` })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.companyId, companyId),
        eq(stockMovements.type, "issue"),
        inArray(stockMovements.referenceType, ["sales_order", "pos_sale"]),
        gte(stockMovements.occurredAt, new Date(`${sinceDate(days)}T00:00:00Z`)),
      ),
    )
    .groupBy(stockMovements.productId);
  const soldByProduct = new Map(sold.map((s) => [s.productId, toMinor(s.quantity, 4)]));

  const rows = await stockByProduct(conn, companyId);
  return rows
    .map((row) => {
      const soldQty = soldByProduct.get(row.productId) ?? 0n;
      const daysOfStock = soldQty > 0n ? Number(mulDivRound(toMinor(row.quantity, 4), BigInt(days), soldQty)) : null;
      const velocity = soldQty === 0n ? "dead" : daysOfStock !== null && daysOfStock <= 30 ? "fast" : "slow";
      return {
        productId: row.productId,
        name: row.name,
        sku: row.sku,
        stock: row.quantity,
        soldQty: fromMinor(soldQty, 4),
        daysOfStock,
        velocity,
        value: row.value,
      };
    })
    .sort((a, b) => (toMinor(b.soldQty, 4) > toMinor(a.soldQty, 4) ? 1 : toMinor(b.soldQty, 4) < toMinor(a.soldQty, 4) ? -1 : 0));
}
