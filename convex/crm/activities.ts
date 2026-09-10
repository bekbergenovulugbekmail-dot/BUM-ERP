/**
 * CRM Activities — fully tenant-scoped with ownership checks.
 */
import { v, ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server.js";
import { getTenantId, requireTenantAccess, requireTenantAccessForWrite, requirePermission } from "../tenant.ts";

export const listByCustomer = query({
  args: { customerId: v.id("customers"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];
    // Verify the customer belongs to this tenant before returning its activities
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.companyId !== tenantId) return [];
    return ctx.db.query("activities")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
      .order("desc")
      .take(args.limit ?? 50);
  },
});

export const listByLead = query({
  args: { leadId: v.id("leads"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];
    // Verify the lead belongs to this tenant
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.companyId !== tenantId) return [];
    return ctx.db.query("activities")
      .withIndex("by_lead", (q) => q.eq("leadId", args.leadId))
      .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
      .order("desc")
      .take(args.limit ?? 50);
  },
});

export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];
    // SECURITY: scoped to this tenant only
    return ctx.db.query("activities")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .order("desc")
      .take(args.limit ?? 20);
  },
});

export const create = mutation({
  args: {
    type: v.union(
      v.literal("call"), v.literal("meeting"), v.literal("email"),
      v.literal("note"), v.literal("task"),
    ),
    title: v.string(),
    description: v.optional(v.string()),
    customerId: v.optional(v.id("customers")),
    leadId: v.optional(v.id("leads")),
    date: v.string(),
    dueDate: v.optional(v.string()),
    outcome: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "crm.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);
    // Verify referenced customer/lead belong to this tenant
    if (args.customerId) {
      const c = await ctx.db.get(args.customerId);
      if (!c || c.companyId !== tenantId) {
        throw new ConvexError({ message: "Mijoz topilmadi", code: "NOT_FOUND" });
      }
    }
    if (args.leadId) {
      const l = await ctx.db.get(args.leadId);
      if (!l || l.companyId !== tenantId) {
        throw new ConvexError({ message: "Lead topilmadi", code: "NOT_FOUND" });
      }
    }
    return ctx.db.insert("activities", { ...args, status: "done", companyId: tenantId });
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("activities"),
    status: v.union(v.literal("planned"), v.literal("done"), v.literal("cancelled")),
    outcome: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "crm.manage");
    const tenantId = await requireTenantAccess(ctx);
    const activity = await ctx.db.get(args.id);
    if (!activity || activity.companyId !== tenantId) {
      throw new ConvexError({ message: "Faoliyat topilmadi", code: "NOT_FOUND" });
    }
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});

export const remove = mutation({
  args: { id: v.id("activities") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "crm.manage");
    const tenantId = await requireTenantAccess(ctx);
    const activity = await ctx.db.get(args.id);
    if (!activity || activity.companyId !== tenantId) {
      throw new ConvexError({ message: "Faoliyat topilmadi", code: "NOT_FOUND" });
    }
    await ctx.db.delete(args.id);
  },
});
