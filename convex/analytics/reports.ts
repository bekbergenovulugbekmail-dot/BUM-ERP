import { v } from "convex/values";
import { query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel.d.ts";
import { getTenantId } from "../tenant.ts";

// ─── SALES SUMMARY ──────────────────────────────────────────────────────────

export const getSalesSummary = query({
  args: { days: v.number() },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return {
      totalOrders: 0, totalRevenue: 0, paidRevenue: 0,
      topProducts: [], byStatus: {}, dailyRevenue: [],
    };

    const since = new Date();
    since.setDate(since.getDate() - args.days);
    const sinceStr = since.toISOString().slice(0, 10);

    // Scope to tenant
    const orders = await ctx.db.query("salesOrders")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .collect();
    const recent = orders.filter((o) => o.orderDate >= sinceStr && o.status !== "cancelled");

    const totalOrders = recent.length;
    const totalRevenue = recent.reduce((s, o) => s + o.totalAmount, 0);
    const paidRevenue = recent.reduce((s, o) => s + o.paidAmount, 0);

    // Top products (only from this tenant's orders)
    const recentOrderIds = new Set(recent.map((o) => o._id));
    const allItems = await ctx.db.query("salesOrderItems")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .collect();
    const recentItems = allItems.filter((i) => recentOrderIds.has(i.orderId));

    const productQtys: Record<string, number> = {};
    for (const item of recentItems) {
      productQtys[item.productId] = (productQtys[item.productId] ?? 0) + item.qty;
    }
    const sortedProducts = Object.entries(productQtys)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const topProducts = await Promise.all(
      sortedProducts.map(async ([id, qty]) => {
        const p = await ctx.db.get(id as Doc<"salesOrderItems">["productId"]);
        return { name: p?.name ?? "?", qty };
      })
    );

    const byStatus: Record<string, number> = {};
    for (const o of recent) {
      byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
    }

    const daily: Record<string, number> = {};
    for (const o of recent) {
      daily[o.orderDate] = (daily[o.orderDate] ?? 0) + o.totalAmount;
    }
    const dailyRevenue = Object.entries(daily)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, amount]) => ({ date, amount }));

    return { totalOrders, totalRevenue, paidRevenue, topProducts, byStatus, dailyRevenue };
  },
});

// ─── STOCK SUMMARY ──────────────────────────────────────────────────────────

export const getStockSummary = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return { totalProducts: 0, totalValue: 0, lowStock: 0, outOfStock: 0, abcData: [] };

    // Scope to tenant's stock levels
    const stocks = await ctx.db.query("stockLevels")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .collect();

    // Scope to tenant's products
    const products = await ctx.db.query("products")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .collect();
    const productMap = new Map(products.map((p) => [p._id, p]));

    let totalValue = 0;
    let lowStock = 0;
    let outOfStock = 0;

    for (const s of stocks) {
      const p = productMap.get(s.productId);
      if (!p) continue;
      totalValue += s.quantity * s.avgCostPrice;
      if (s.quantity === 0) outOfStock++;
      else if (p.minStock > 0 && s.quantity <= p.minStock) lowStock++;
    }

    const productValues = stocks
      .map((s) => {
        const p = productMap.get(s.productId);
        return { productId: s.productId, name: p?.name ?? "?", value: s.quantity * s.avgCostPrice, qty: s.quantity };
      })
      .sort((a, b) => b.value - a.value);

    const total = productValues.reduce((s, p) => s + p.value, 0);
    let cumulative = 0;
    const abcData = productValues.map((p) => {
      cumulative += p.value;
      const pct = total > 0 ? cumulative / total : 0;
      return { ...p, abc: pct <= 0.8 ? "A" : pct <= 0.95 ? "B" : "C" };
    });

    return {
      totalProducts: stocks.length,
      totalValue,
      lowStock,
      outOfStock,
      abcData: abcData.slice(0, 50),
    };
  },
});

// ─── EXPENSE SUMMARY ────────────────────────────────────────────────────────

export const getExpenseSummary = query({
  args: { days: v.number() },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return { total: 0, byCategory: [] };

    const since = new Date();
    since.setDate(since.getDate() - args.days);
    const sinceStr = since.toISOString().slice(0, 10);

    const expenses = await ctx.db.query("expenses")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .collect();
    const recent = expenses.filter((e) => e.date >= sinceStr && e.status !== "pending");

    const total = recent.reduce((s, e) => s + e.amount, 0);
    const byCategory: Record<string, number> = {};
    for (const e of recent) {
      byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount;
    }
    const byCategoryArr = Object.entries(byCategory)
      .sort((a, b) => b[1] - a[1])
      .map(([category, amount]) => ({ category, amount }));

    return { total, byCategory: byCategoryArr };
  },
});

// ─── PURCHASE SUMMARY ───────────────────────────────────────────────────────

export const getPurchaseSummary = query({
  args: { days: v.number() },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return { totalOrders: 0, totalAmount: 0, paidAmount: 0, debtAmount: 0 };

    const since = new Date();
    since.setDate(since.getDate() - args.days);
    const sinceStr = since.toISOString().slice(0, 10);

    const orders = await ctx.db.query("purchaseOrders")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .collect();
    const recent = orders.filter((o) => o.orderDate >= sinceStr && o.status !== "cancelled");

    const total = recent.reduce((s, o) => s + o.totalAmount, 0);
    const paid = recent.reduce((s, o) => s + o.paidAmount, 0);
    const debt = total - paid;

    return {
      totalOrders: recent.length,
      totalAmount: total,
      paidAmount: paid,
      debtAmount: debt,
    };
  },
});

// ─── FULL BI OVERVIEW ────────────────────────────────────────────────────────

export const getBIOverview = query({
  args: { days: v.number() },
  handler: async (ctx, args): Promise<{
    revenue: number;
    expenses: number;
    profit: number;
    grossMargin: number;
    orderCount: number;
    customerCount: number;
    employeeCount: number;
    stockValue: number;
  }> => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return {
      revenue: 0, expenses: 0, profit: 0, grossMargin: 0,
      orderCount: 0, customerCount: 0, employeeCount: 0, stockValue: 0,
    };

    const since = new Date();
    since.setDate(since.getDate() - args.days);
    const sinceStr = since.toISOString().slice(0, 10);

    // All scoped to tenant
    const [orders, expenseRows, customers, employees, stocks] = await Promise.all([
      ctx.db.query("salesOrders").withIndex("by_company", (q) => q.eq("companyId", tenantId)).collect(),
      ctx.db.query("expenses").withIndex("by_company", (q) => q.eq("companyId", tenantId)).collect(),
      ctx.db.query("customers").withIndex("by_company", (q) => q.eq("companyId", tenantId)).collect(),
      ctx.db.query("employees").withIndex("by_company", (q) => q.eq("companyId", tenantId)).collect(),
      ctx.db.query("stockLevels").withIndex("by_company", (q) => q.eq("companyId", tenantId)).collect(),
    ]);

    const recentOrders = orders.filter((o) => o.orderDate >= sinceStr && o.status !== "cancelled");
    const recentExpenses = expenseRows.filter((e) => e.date >= sinceStr);

    const revenue = recentOrders.reduce((s, o) => s + o.totalAmount, 0);
    const expenseTotal = recentExpenses.reduce((s, e) => s + e.amount, 0);

    // COGS from tenant's sales order items
    const recentOrderIds = new Set(recentOrders.map((o) => o._id));
    const items = await ctx.db.query("salesOrderItems")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId)).collect();
    const recentItems = items.filter((i) => recentOrderIds.has(i.orderId));
    const cogs = recentItems.reduce((s, i) => s + i.costPrice * i.qty, 0);

    const grossProfit = revenue - cogs;
    const netProfit = grossProfit - expenseTotal;
    const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
    const stockValue = stocks.reduce((s, sl) => s + sl.quantity * sl.avgCostPrice, 0);

    return {
      revenue,
      expenses: expenseTotal,
      profit: netProfit,
      grossMargin,
      orderCount: recentOrders.length,
      customerCount: customers.filter((c) => c.isActive).length,
      employeeCount: employees.filter((e) => e.status === "active").length,
      stockValue,
    };
  },
});

// ─── SALES BY CUSTOMER ───────────────────────────────────────────────────────

export const getTopCustomers = query({
  args: { days: v.number(), limit: v.number() },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];

    const since = new Date();
    since.setDate(since.getDate() - args.days);
    const sinceStr = since.toISOString().slice(0, 10);

    const orders = await ctx.db.query("salesOrders")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .collect();
    const recent = orders.filter((o) => o.orderDate >= sinceStr && o.status !== "cancelled" && o.customerId);

    const byCustomer: Record<string, { amount: number; orders: number }> = {};
    for (const o of recent) {
      if (!o.customerId) continue;
      const id = o.customerId;
      if (!byCustomer[id]) byCustomer[id] = { amount: 0, orders: 0 };
      byCustomer[id].amount += o.totalAmount;
      byCustomer[id].orders += 1;
    }

    const sorted = Object.entries(byCustomer)
      .sort((a, b) => b[1].amount - a[1].amount)
      .slice(0, args.limit);

    return Promise.all(
      sorted.map(async ([id, stats]) => {
        const c = await ctx.db.get(id as Doc<"salesOrders">["customerId"] & string);
        return { name: c?.name ?? "Noma'lum", ...stats };
      })
    );
  },
});

// ─── SLOW/FAST/DEAD STOCK ───────────────────────────────────────────────────

export const getStockVelocity = query({
  args: { days: v.number() },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];

    const since = new Date();
    since.setDate(since.getDate() - args.days);
    const sinceStr = since.toISOString().slice(0, 10);

    // Scope movements to tenant
    const movements = await ctx.db.query("stockMovements")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .collect();
    const recentIssues = movements.filter(
      (m) => m.date >= sinceStr && (m.type === "issue" || m.type === "return_out")
    );

    const soldQty: Record<string, number> = {};
    for (const m of recentIssues) {
      soldQty[m.productId] = (soldQty[m.productId] ?? 0) + Math.abs(m.quantity);
    }

    // Scope stock levels to tenant
    const stocks = await ctx.db.query("stockLevels")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .collect();

    const results = await Promise.all(
      stocks.map(async (s) => {
        const p = await ctx.db.get(s.productId);
        const sold = soldQty[s.productId] ?? 0;
        const daysOfStock = sold > 0 ? (s.quantity / (sold / args.days)) : Infinity;
        const velocity: "fast" | "slow" | "dead" =
          sold === 0 ? "dead" : sold < 2 ? "slow" : "fast";
        return {
          productId: s.productId,
          name: p?.name ?? "?",
          sku: p?.sku ?? "?",
          stock: s.quantity,
          soldQty: sold,
          daysOfStock: isFinite(daysOfStock) ? Math.round(daysOfStock) : 999,
          velocity,
          value: s.quantity * s.avgCostPrice,
        };
      })
    );

    return results.sort((a, b) => b.soldQty - a.soldQty);
  },
});
