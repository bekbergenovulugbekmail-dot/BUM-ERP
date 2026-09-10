/**
 * Cash accounts & transactions — fully tenant-scoped.
 *
 * SECURITY:
 *   - list/getDashboardStats filter strictly by tenantId
 *   - recordTransaction verifies account.companyId === tenantId before any write
 *   - createAccount attaches companyId from server context, never from client
 *   - Dashboard statistics ONLY aggregate this company's data
 */
import { v, ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server.js";
import { getTenantId, requireTenantAccess, requireTenantAccessForWrite, requirePermission } from "../tenant.ts";

// ── Queries ──────────────────────────────────────────────────────────────────

export const list = query({
  args: {},
  handler: async (ctx, _args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];
    // SECURITY: strict tenant filter — no orphan fallback
    return ctx.db
      .query("cashAccounts")
      .withIndex("by_type")
      .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
      .collect();
  },
});

export const getTransactions = query({
  args: {
    cashAccountId: v.id("cashAccounts"),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];

    // SECURITY: verify account belongs to this tenant
    const account = await ctx.db.get(args.cashAccountId);
    if (!account || account.companyId !== tenantId) return [];

    let txs = await ctx.db
      .query("cashTransactions")
      .withIndex("by_account", (q) => q.eq("cashAccountId", args.cashAccountId))
      .order("desc")
      .take(args.limit ?? 100);
    if (args.dateFrom) txs = txs.filter((t) => t.date >= args.dateFrom!);
    if (args.dateTo) txs = txs.filter((t) => t.date <= args.dateTo!);
    return txs;
  },
});

export const getDashboardStats = query({
  args: {},
  handler: async (ctx, _args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) {
      return { totalCash: 0, totalBank: 0, totalBalance: 0, monthIncome: 0, monthExpense: 0, monthNetCash: 0, monthSalesTotal: 0, monthPurchaseTotal: 0, accounts: [] };
    }

    // SECURITY: only this company's accounts
    const accounts = await ctx.db
      .query("cashAccounts")
      .withIndex("by_type")
      .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
      .collect();

    const totalCash = accounts.filter((a) => a.type === "cash").reduce((s, a) => s + a.balance, 0);
    const totalBank = accounts.filter((a) => a.type === "bank").reduce((s, a) => s + a.balance, 0);

    const today = new Date().toISOString().slice(0, 10);
    const monthStart = today.slice(0, 7) + "-01";

    // SECURITY: only this company's transactions
    const allTxs = await ctx.db
      .query("cashTransactions")
      .withIndex("by_date")
      .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
      .order("desc").take(500);
    const monthTxs = allTxs.filter((t) => t.date >= monthStart);

    const monthIncome = monthTxs.filter((t) => t.type === "in").reduce((s, t) => s + t.amount, 0);
    const monthExpense = monthTxs.filter((t) => t.type === "out").reduce((s, t) => s + t.amount, 0);

    // SECURITY: only this company's sales & purchases
    const sales = await ctx.db.query("salesOrders")
      .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
      .order("desc").take(500);
    const purchases = await ctx.db.query("purchaseOrders")
      .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
      .order("desc").take(500);

    const monthSales = sales.filter((s) => s.orderDate >= monthStart && !["cancelled"].includes(s.status));
    const monthPurchases = purchases.filter((p) => p.orderDate >= monthStart && !["cancelled"].includes(p.status));

    return {
      totalCash,
      totalBank,
      totalBalance: totalCash + totalBank,
      monthIncome,
      monthExpense,
      monthNetCash: monthIncome - monthExpense,
      monthSalesTotal: monthSales.reduce((s, o) => s + o.totalAmount, 0),
      monthPurchaseTotal: monthPurchases.reduce((s, o) => s + o.totalAmount, 0),
      accounts,
    };
  },
});

// ── Mutations ────────────────────────────────────────────────────────────────

export const recordTransaction = mutation({
  args: {
    cashAccountId: v.id("cashAccounts"),
    type: v.union(v.literal("in"), v.literal("out"), v.literal("transfer")),
    amount: v.number(),
    description: v.string(),
    category: v.optional(v.string()),
    referenceType: v.optional(v.string()),
    referenceId: v.optional(v.string()),
    date: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "finance.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);

    // SECURITY: verify account belongs to this tenant
    const account = await ctx.db.get(args.cashAccountId);
    if (!account || account.companyId !== tenantId) {
      throw new ConvexError({ message: "Kassa topilmadi", code: "NOT_FOUND" });
    }

    const delta = args.type === "in" ? args.amount : -args.amount;
    const newBalance = account.balance + delta;
    if (newBalance < 0 && args.type === "out") {
      throw new ConvexError({ message: "Kassada yetarli mablag' yo'q", code: "BAD_REQUEST" });
    }

    await ctx.db.patch(args.cashAccountId, { balance: newBalance });

    return ctx.db.insert("cashTransactions", {
      cashAccountId: args.cashAccountId,
      type: args.type,
      amount: args.amount,
      currency: account.currency,
      date: args.date ?? new Date().toISOString().slice(0, 10),
      description: args.description,
      category: args.category,
      referenceType: args.referenceType,
      referenceId: args.referenceId,
      balanceAfter: newBalance,
      companyId: tenantId,
    });
  },
});

export const createAccount = mutation({
  args: {
    name: v.string(),
    type: v.union(v.literal("cash"), v.literal("bank")),
    currency: v.optional(v.string()),
    bankName: v.optional(v.string()),
    accountNumber: v.optional(v.string()),
    openingBalance: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "finance.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);
    const company = await ctx.db.get(tenantId);
    return ctx.db.insert("cashAccounts", {
      name: args.name,
      type: args.type,
      currency: args.currency ?? company?.currency ?? "UZS",
      bankName: args.bankName,
      accountNumber: args.accountNumber,
      balance: args.openingBalance ?? 0,
      isDefault: false,
      isActive: true,
      companyId: tenantId,
    });
  },
});
