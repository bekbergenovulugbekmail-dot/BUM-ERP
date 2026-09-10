/**
 * Expenses — fully tenant-scoped.
 */
import { v, ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server.js";
import type { QueryCtx, MutationCtx } from "../_generated/server.d.ts";
import { getTenantId, requireTenantAccess, requireTenantAccessForWrite, requirePermission } from "../tenant.ts";

async function nextExpNumber(ctx: QueryCtx | MutationCtx, tenantId: string) {
  const year = new Date().getFullYear();
  const prefix = `EXP-${year}-`;
  const last = await ctx.db.query("expenses")
    .withIndex("by_date")
    .filter((fq) => fq.eq(fq.field("companyId"), tenantId as never))
    .order("desc")
    .first();
  const lastNum = last && last.number.startsWith(prefix) ? parseInt(last.number.split("-")[2] ?? "0") : 0;
  return `${prefix}${String(lastNum + 1).padStart(4, "0")}`;
}

export const list = query({
  args: {
    status: v.optional(v.union(v.literal("pending"), v.literal("approved"), v.literal("paid"))),
    category: v.optional(v.string()),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];
    let expenses;
    if (args.status) {
      expenses = await ctx.db
        .query("expenses")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
        .order("desc")
        .take(args.limit ?? 100);
    } else {
      expenses = await ctx.db.query("expenses")
        .withIndex("by_date")
        .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
        .order("desc").take(args.limit ?? 100);
    }
    if (args.dateFrom) expenses = expenses.filter((e) => e.date >= args.dateFrom!);
    if (args.dateTo) expenses = expenses.filter((e) => e.date <= args.dateTo!);
    if (args.category) expenses = expenses.filter((e) => e.category === args.category);
    return expenses;
  },
});

export const getStats = query({
  args: {},
  handler: async (ctx, _args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return { totalThisMonth: 0, countThisMonth: 0, pendingCount: 0, pendingAmount: 0, byCategory: {} };
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = today.slice(0, 7) + "-01";
    const all = await ctx.db.query("expenses")
      .withIndex("by_date")
      .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
      .order("desc").take(500);
    const thisMonth = all.filter((e) => e.date >= monthStart);
    const pending = all.filter((e) => e.status === "pending");
    return {
      totalThisMonth: thisMonth.reduce((s, e) => s + e.amount, 0),
      countThisMonth: thisMonth.length,
      pendingCount: pending.length,
      pendingAmount: pending.reduce((s, e) => s + e.amount, 0),
      byCategory: thisMonth.reduce<Record<string, number>>((acc, e) => {
        acc[e.category] = (acc[e.category] ?? 0) + e.amount;
        return acc;
      }, {}),
    };
  },
});

export const create = mutation({
  args: {
    category: v.string(),
    description: v.string(),
    amount: v.number(),
    currency: v.optional(v.string()),
    date: v.string(),
    paidBy: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "finance.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);
    const number = await nextExpNumber(ctx, tenantId);
    const company = await ctx.db.get(tenantId);
    return ctx.db.insert("expenses", {
      number,
      category: args.category,
      description: args.description,
      amount: args.amount,
      currency: args.currency ?? company?.currency ?? "UZS",
      date: args.date,
      paidBy: args.paidBy,
      status: "pending",
      notes: args.notes,
      companyId: tenantId,
    });
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("expenses"),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("paid")),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "finance.approve");
    const tenantId = await requireTenantAccess(ctx);
    const expense = await ctx.db.get(args.id);
    if (!expense || expense.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Xarajat topilmadi" });
    }
    await ctx.db.patch(args.id, { status: args.status });
  },
});

export const remove = mutation({
  args: { id: v.id("expenses") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "finance.manage");
    const tenantId = await requireTenantAccess(ctx);
    const expense = await ctx.db.get(args.id);
    if (!expense || expense.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Xarajat topilmadi" });
    }
    if (expense.status === "paid") {
      throw new ConvexError({ message: "To'langan xarajat o'chirilmaydi", code: "BAD_REQUEST" });
    }
    await ctx.db.delete(args.id);
  },
});
