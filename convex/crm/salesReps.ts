/**
 * Sales Reps — fully tenant-scoped with ownership checks.
 */
import { v, ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server.js";
import type { QueryCtx } from "../_generated/server.d.ts";
import type { Id } from "../_generated/dataModel.d.ts";
import { getTenantId, requireTenantAccess, requireTenantAccessForWrite, requirePermission } from "../tenant.ts";

async function nextCode(ctx: QueryCtx, tenantId: Id<"companies">) {
  const existing = await ctx.db.query("salesReps")
    .withIndex("by_company", (q) => q.eq("companyId", tenantId))
    .collect();
  return `SR-${String(existing.length + 1).padStart(3, "0")}`;
}

export const list = query({
  args: { onlyActive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];
    const reps = await ctx.db.query("salesReps")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .collect();
    return args.onlyActive ? reps.filter((r) => r.isActive) : reps;
  },
});

export const getStats = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];
    const reps = await ctx.db.query("salesReps")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .filter((fq) => fq.eq(fq.field("isActive"), true))
      .collect();
    // Scoped: only this company's sales orders
    const thisMonth = new Date().toISOString().slice(0, 7);
    const orders = await ctx.db.query("salesOrders")
      .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
      .take(500);
    const thisMonthOrders = orders.filter(
      (o) => o.orderDate.startsWith(thisMonth) && o.status !== "cancelled"
    );
    return reps.map((rep) => ({ ...rep, thisMonthSales: 0, ordersCount: thisMonthOrders.length }));
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    region: v.optional(v.string()),
    monthlyTarget: v.number(),
    commission: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "crm.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);
    const code = await nextCode(ctx, tenantId);
    return ctx.db.insert("salesReps", { ...args, code, isActive: true, companyId: tenantId });
  },
});

export const update = mutation({
  args: {
    id: v.id("salesReps"),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    region: v.optional(v.string()),
    monthlyTarget: v.optional(v.number()),
    commission: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "crm.manage");
    const tenantId = await requireTenantAccess(ctx);
    const rep = await ctx.db.get(args.id);
    if (!rep || rep.companyId !== tenantId) {
      throw new ConvexError({ message: "Sotuvchi topilmadi", code: "NOT_FOUND" });
    }
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});

export const remove = mutation({
  args: { id: v.id("salesReps") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "crm.manage");
    const tenantId = await requireTenantAccess(ctx);
    const rep = await ctx.db.get(args.id);
    if (!rep || rep.companyId !== tenantId) {
      throw new ConvexError({ message: "Sotuvchi topilmadi", code: "NOT_FOUND" });
    }
    await ctx.db.delete(args.id);
  },
});
