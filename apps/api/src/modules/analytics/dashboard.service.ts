/**
 * Bosh sahifa ko'rsatkichlari (convex/dashboard.ts `getKPIs`).
 *
 * Convex'dan farqlar:
 *  - ruxsat tekshirilmasdi — kassir ham foyda, kassa qoldig'i va qarzlarni ko'rardi; endi `analytics.view`
 *  - oxirgi 200 buyurtma / 500 qatordan hisoblanardi — ko'p savdoli kompaniyada oylik tushum va
 *    tannarx kam chiqardi; endi SQL yig'indilari
 *  - tushum qoralama va tasdiqlangan (jo'natilmagan) buyurtmalarni ham qo'shardi — endi faqat
 *    jo'natilgan/yetkazilgan; "bugungi tushum" — bugun kelgan mijoz to'lovlari
 *  - mijoz qarzi buyurtmalar farqidan (tasdiqlanganlar ham) — endi mijozlar qarzi (manfiy — avans — hisobga olinmaydi)
 *  - kam zaxira birligi doim "dona" edi
 */
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { products, units } from "../../db/schema/catalog.js";
import { cashAccounts } from "../../db/schema/finance.js";
import { stockLevels, warehouses } from "../../db/schema/inventory.js";
import { purchaseOrders, suppliers } from "../../db/schema/purchase.js";
import { customerPayments, customers, salesOrderItems, salesOrders } from "../../db/schema/sales.js";
import type { DbOrTx } from "../../db/transaction.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { todayIso } from "../finance/cash.service.js";
import { shiftDate } from "./dates.js";

/** Tushum tan olingan holatlar (`shipped`/`delivered` — eski yozuvlar, `completed` bilan bir ma'noda). */
export const REALIZED_STATUSES = ["completed", "shipped", "delivered"] as const;

export async function getDashboard(conn: DbOrTx, tenant: TenantContext) {
  const companyId = tenant.company.id;
  const today = todayIso();
  const monthStart = `${today.slice(0, 7)}-01`;
  const weekStart = shiftDate(today, -6);
  const realized = inArray(salesOrders.status, [...REALIZED_STATUSES]);

  const [sales] = await conn
    .select({
      todaySalesCount: sql<number>`(count(*) filter (where ${salesOrders.orderDate} = ${today}))::int`,
      todaySalesTotal: sql<string>`coalesce(sum(${salesOrders.totalAmount}) filter (where ${salesOrders.orderDate} = ${today}), 0)::numeric(18,2)`,
      monthRevenue: sql<string>`coalesce(sum(${salesOrders.totalAmount}), 0)::numeric(18,2)`,
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.companyId, companyId), realized, gte(salesOrders.orderDate, monthStart)));

  const [cogs] = await conn
    .select({ value: sql<string>`coalesce(sum(round(${salesOrderItems.quantity} * ${salesOrderItems.costPrice}, 2)), 0)::numeric(18,2)` })
    .from(salesOrderItems)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.orderId))
    .where(and(eq(salesOrders.companyId, companyId), realized, gte(salesOrders.orderDate, monthStart)));

  const [receipts] = await conn
    .select({ value: sql<string>`coalesce(sum(${customerPayments.amount}), 0)::numeric(18,2)` })
    .from(customerPayments)
    .where(and(eq(customerPayments.companyId, companyId), eq(customerPayments.paymentDate, today), eq(customerPayments.status, "posted")));

  const lowStockCondition = sql`${products.minStock} > 0 and ${stockLevels.quantity} <= ${products.minStock}`;
  const [stock] = await conn
    .select({
      stockValue: sql<string>`coalesce(sum(${stockLevels.quantity} * ${stockLevels.avgCostPrice}), 0)::numeric(18,2)`,
      lowStockCount: sql<number>`(count(*) filter (where ${lowStockCondition}))::int`,
    })
    .from(stockLevels)
    .innerJoin(products, eq(products.id, stockLevels.productId))
    .where(and(eq(stockLevels.companyId, companyId), eq(products.isActive, true)));

  const lowStockItems = await conn
    .select({
      productId: products.id,
      productName: products.name,
      warehouseName: warehouses.name,
      quantity: stockLevels.quantity,
      minStock: products.minStock,
      unit: units.shortName,
    })
    .from(stockLevels)
    .innerJoin(products, eq(products.id, stockLevels.productId))
    .innerJoin(warehouses, eq(warehouses.id, stockLevels.warehouseId))
    .innerJoin(units, eq(units.id, products.baseUnitId))
    .where(and(eq(stockLevels.companyId, companyId), eq(products.isActive, true), lowStockCondition))
    .orderBy(sql`${stockLevels.quantity} / ${products.minStock}`)
    .limit(5);

  const [supplierDebt] = await conn
    .select({ value: sql<string>`coalesce(sum(greatest(${suppliers.totalDebt}, 0)), 0)::numeric(18,2)` })
    .from(suppliers)
    .where(eq(suppliers.companyId, companyId));
  const [customerDebt] = await conn
    .select({ value: sql<string>`coalesce(sum(greatest(${customers.totalDebt}, 0)), 0)::numeric(18,2)` })
    .from(customers)
    .where(eq(customers.companyId, companyId));

  const accounts = await conn
    .select({ type: cashAccounts.type, balance: cashAccounts.balance })
    .from(cashAccounts)
    .where(and(eq(cashAccounts.companyId, companyId), eq(cashAccounts.isActive, true)));
  const balanceOf = (type: "cash" | "bank") =>
    fromMinor(accounts.filter((a) => a.type === type).reduce((s, a) => s + toMinor(a.balance), 0n));

  const recentSales = await conn
    .select({
      id: salesOrders.id,
      number: salesOrders.number,
      customerName: customers.name,
      amount: salesOrders.totalAmount,
      paidAmount: salesOrders.paidAmount,
      status: salesOrders.status,
      orderDate: salesOrders.orderDate,
      isPos: salesOrders.isPos,
    })
    .from(salesOrders)
    .leftJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(eq(salesOrders.companyId, companyId))
    .orderBy(desc(salesOrders.createdAt), desc(salesOrders.id))
    .limit(10);

  const recentPurchases = await conn
    .select({
      id: purchaseOrders.id,
      number: purchaseOrders.number,
      supplierName: suppliers.name,
      amount: purchaseOrders.totalAmount,
      status: purchaseOrders.status,
      orderDate: purchaseOrders.orderDate,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(eq(purchaseOrders.companyId, companyId))
    .orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrders.id))
    .limit(5);

  const daily = await conn
    .select({ date: salesOrders.orderDate, revenue: sql<string>`sum(${salesOrders.totalAmount})::numeric(18,2)` })
    .from(salesOrders)
    .where(and(eq(salesOrders.companyId, companyId), realized, gte(salesOrders.orderDate, weekStart), lte(salesOrders.orderDate, today)))
    .groupBy(salesOrders.orderDate);
  const revenueByDate = new Map(daily.map((d) => [d.date, d.revenue]));
  const weeklyRevenue = Array.from({ length: 7 }, (_, i) => {
    const date = shiftDate(weekStart, i);
    return { date, revenue: revenueByDate.get(date) ?? "0.00" };
  });

  return {
    todaySalesCount: sales!.todaySalesCount,
    todaySalesTotal: sales!.todaySalesTotal,
    todayReceipts: receipts!.value,
    monthRevenue: sales!.monthRevenue,
    cogs: cogs!.value,
    grossProfit: fromMinor(toMinor(sales!.monthRevenue) - toMinor(cogs!.value)),
    stockValue: stock!.stockValue,
    lowStockCount: stock!.lowStockCount,
    supplierDebt: supplierDebt!.value,
    customerDebt: customerDebt!.value,
    cashBalance: balanceOf("cash"),
    bankBalance: balanceOf("bank"),
    recentSales,
    recentPurchases,
    lowStockItems,
    weeklyRevenue,
  };
}
