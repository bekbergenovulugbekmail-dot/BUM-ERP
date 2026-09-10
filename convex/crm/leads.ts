/**
 * Leads — fully tenant-scoped with ownership checks.
 */
import { v, ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server.js";
import { getTenantId, requireTenantAccess, requireTenantAccessForWrite, requirePermission } from "../tenant.ts";

export const list = query({
  args: {
    stage: v.optional(v.union(
      v.literal("new"), v.literal("contacted"), v.literal("qualified"),
      v.literal("proposal"), v.literal("won"), v.literal("lost"),
    )),
    salesRepId: v.optional(v.id("salesReps")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];
    if (args.stage) {
      return ctx.db.query("leads")
        .withIndex("by_stage", (q) => q.eq("stage", args.stage!))
        .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
        .collect()
        .then((r) => r.slice(0, args.limit ?? 200));
    }
    const all = await ctx.db.query("leads")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .take(args.limit ?? 200);
    return args.salesRepId
      ? all.filter((l) => l.salesRepId === args.salesRepId)
      : all;
  },
});

export const getStats = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return { total: 0, byStage: {}, totalValue: 0 };
    const all = await ctx.db.query("leads")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .collect();
    const byStage: Record<string, number> = {};
    let totalValue = 0;
    for (const l of all) {
      byStage[l.stage] = (byStage[l.stage] ?? 0) + 1;
      if (l.estimatedValue) totalValue += l.estimatedValue;
    }
    return { total: all.length, byStage, totalValue };
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    company: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    source: v.union(
      v.literal("website"), v.literal("referral"), v.literal("social"),
      v.literal("cold_call"), v.literal("exhibition"), v.literal("other"),
    ),
    estimatedValue: v.optional(v.number()),
    salesRepId: v.optional(v.id("salesReps")),
    expectedCloseDate: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "crm.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);
    // If salesRepId given, verify it belongs to this tenant
    if (args.salesRepId) {
      const rep = await ctx.db.get(args.salesRepId);
      if (!rep || rep.companyId !== tenantId) {
        throw new ConvexError({ message: "Sotuvchi topilmadi", code: "NOT_FOUND" });
      }
    }
    return ctx.db.insert("leads", { ...args, stage: "new", companyId: tenantId });
  },
});

export const updateStage = mutation({
  args: {
    id: v.id("leads"),
    stage: v.union(
      v.literal("new"), v.literal("contacted"), v.literal("qualified"),
      v.literal("proposal"), v.literal("won"), v.literal("lost"),
    ),
    lostReason: v.optional(v.string()),
    customerId: v.optional(v.id("customers")),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "crm.manage");
    const tenantId = await requireTenantAccess(ctx);
    const lead = await ctx.db.get(args.id);
    if (!lead || lead.companyId !== tenantId) {
      throw new ConvexError({ message: "Lead topilmadi", code: "NOT_FOUND" });
    }
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});

export const update = mutation({
  args: {
    id: v.id("leads"),
    name: v.optional(v.string()),
    company: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    estimatedValue: v.optional(v.number()),
    salesRepId: v.optional(v.id("salesReps")),
    expectedCloseDate: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "crm.manage");
    const tenantId = await requireTenantAccess(ctx);
    const lead = await ctx.db.get(args.id);
    if (!lead || lead.companyId !== tenantId) {
      throw new ConvexError({ message: "Lead topilmadi", code: "NOT_FOUND" });
    }
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});

export const remove = mutation({
  args: { id: v.id("leads") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "crm.manage");
    const tenantId = await requireTenantAccess(ctx);
    const lead = await ctx.db.get(args.id);
    if (!lead || lead.companyId !== tenantId) {
      throw new ConvexError({ message: "Lead topilmadi", code: "NOT_FOUND" });
    }
    await ctx.db.delete(args.id);
  },
});
