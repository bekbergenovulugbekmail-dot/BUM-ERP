/**
 * Dashboard KPI query — fully tenant-scoped.
 * Returns all real-time business metrics needed by the dashboard page.
 * Never returns data from another company.
 */
import { v } from "convex/values";
import { query } from "./_generated/server.js";
import { getTenantId } from "./tenant.ts";

export const getKPIs = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) {
      return {
        todaySalesCount: 0, todaySalesTotal: 0,
        todayRevenue: 0, monthRevenue: 0,
        grossProfit: 0, cogs: 0,
        stockValue: 0, lowStockCount: 0,
        supplierDebt: 0, customerDebt: 0,
        cashBalance: 0, bankBalance: 0,
        recentSales: [], recentPurchases: [], lowStockItems: [],
        weeklyRevenue: [],
      };
    }

    const today = new Date().toISOString().slice(0, 10);
    const monthStart = today.slice(0, 7) + "-01";

    // Build last 7 days list
    const days7: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days7.push(d.toISOString().slice(0, 10));
    }
    const weekStart = days7[0];

    // ── Parallel data fetches ─────────────────────────────────────────────────
    const [salesOrders, purchaseOrders, stockLevels, products, suppliers, cashAccounts, salesItems] =
      await Promise.all([
        ctx.db.query("salesOrders")
          .withIndex("by_company", (q) => q.eq("companyId", tenantId))
          .order("desc").take(200),
        ctx.db.query("purchaseOrders")
          .withIndex("by_company", (q) => q.eq("companyId", tenantId))
          .order("desc").take(200),
        ctx.db.query("stockLevels")
          .withIndex("by_company", (q) => q.eq("companyId", tenantId))
          .collect(),
        ctx.db.query("products")
          .withIndex("by_company", (q) => q.eq("companyId", tenantId))
          .collect(),
        ctx.db.query("suppliers")
          .withIndex("by_company", (q) => q.eq("companyId", tenantId))
          .collect(),
        ctx.db.query("cashAccounts")
          .withIndex("by_company", (q) => q.eq("companyId", tenantId))
          .collect(),
        ctx.db.query("salesOrderItems")
          .withIndex("by_company", (q) => q.eq("companyId", tenantId))
          .order("desc").take(500),
      ]);

    // ── Today / Month Sales ───────────────────────────────────────────────────
    const activeSales = salesOrders.filter((o) => !["cancelled", "returned"].includes(o.status));
    const todaySales = activeSales.filter((o) => o.orderDate === today);
    const monthSales = activeSales.filter((o) => o.orderDate >= monthStart);

    const todaySalesCount = todaySales.length;
    const todaySalesTotal = todaySales.reduce((s, o) => s + o.totalAmount, 0);
    const todayRevenue = todaySales.reduce((s, o) => s + o.paidAmount, 0);
    const monthRevenue = monthSales.reduce((s, o) => s + o.totalAmount, 0);

    // ── COGS & Gross Profit ───────────────────────────────────────────────────
    const monthOrderIds = new Set(monthSales.map((o) => o._id));
    const monthItems = salesItems.filter((i) => monthOrderIds.has(i.orderId));
    const cogs = monthItems.reduce((s, i) => s + i.costPrice * i.qty, 0);
    const grossProfit = monthRevenue - cogs;

    // ── Stock ─────────────────────────────────────────────────────────────────
    const productMap = new Map(products.map((p) => [p._id, p]));
    let stockValue = 0;
    const lowStockItems: Array<{ name: string; qty: number; minStock: number; unit: string }> = [];

    for (const sl of stockLevels) {
      const p = productMap.get(sl.productId);
      if (!p) continue;
      stockValue += sl.quantity * sl.avgCostPrice;
      if (p.minStock > 0 && sl.quantity <= p.minStock) {
        lowStockItems.push({ name: p.name, qty: sl.quantity, minStock: p.minStock, unit: "dona" });
      }
    }
    const lowStockCount = lowStockItems.length;

    // ── Supplier & Customer debt ──────────────────────────────────────────────
    const supplierDebt = suppliers.reduce((s, sup) => s + sup.totalDebt, 0);
    const customerDebt = activeSales
      .filter((o) => o.totalAmount > o.paidAmount)
      .reduce((s, o) => s + (o.totalAmount - o.paidAmount), 0);

    // ── Cash & Bank balance ───────────────────────────────────────────────────
    const cashBalance = cashAccounts
      .filter((a) => a.type === "cash" && a.isActive)
      .reduce((s, a) => s + a.balance, 0);
    const bankBalance = cashAccounts
      .filter((a) => a.type === "bank" && a.isActive)
      .reduce((s, a) => s + a.balance, 0);

    // ── Recent sales (last 10) ────────────────────────────────────────────────
    const recentSales = await Promise.all(
      salesOrders.slice(0, 10).map(async (o) => {
        const customer = o.customerId ? await ctx.db.get(o.customerId) : null;
        return {
          _id: o._id,
          number: o.number,
          customerName: customer?.name ?? "Anonim",
          amount: o.totalAmount,
          paidAmount: o.paidAmount,
          status: o.status,
          orderDate: o.orderDate,
          isPOS: o.isPOS,
        };
      })
    );

    // ── Recent purchases (last 5) ─────────────────────────────────────────────
    const recentPurchases = await Promise.all(
      purchaseOrders.slice(0, 5).map(async (o) => {
        const sup = await ctx.db.get(o.supplierId);
        return {
          _id: o._id,
          number: o.number,
          supplierName: sup?.name ?? "—",
          amount: o.totalAmount,
          status: o.status,
          orderDate: o.orderDate,
        };
      })
    );

    // ── Weekly revenue chart (last 7 days) ────────────────────────────────────
    const dailyMap: Record<string, number> = {};
    for (const d of days7) dailyMap[d] = 0;
    for (const o of activeSales) {
      if (o.orderDate >= weekStart && o.orderDate <= today) {
        dailyMap[o.orderDate] = (dailyMap[o.orderDate] ?? 0) + o.totalAmount;
      }
    }
    const weeklyRevenue = days7.map((d) => ({
      date: d,
      day: new Date(d).toLocaleDateString("uz-UZ", { weekday: "short" }),
      revenue: dailyMap[d] ?? 0,
    }));

    return {
      todaySalesCount, todaySalesTotal,
      todayRevenue, monthRevenue,
      grossProfit, cogs,
      stockValue, lowStockCount,
      supplierDebt, customerDebt,
      cashBalance, bankBalance,
      recentSales, recentPurchases,
      lowStockItems: lowStockItems.slice(0, 5),
      weeklyRevenue,
    };
  },
});
