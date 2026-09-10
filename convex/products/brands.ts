import { v, ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server";
import { getTenantId, requireTenantAccessForWrite, requirePermission } from "../tenant.ts";

export const list = query({
  args: { isActive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];
    const all = await ctx.db.query("brands")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .collect();
    if (args.isActive !== undefined) return all.filter((b) => b.isActive === args.isActive);
    return all;
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "products.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);
    return ctx.db.insert("brands", { ...args, isActive: true, companyId: tenantId });
  },
});

export const update = mutation({
  args: {
    id: v.id("brands"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "products.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);
    const brand = await ctx.db.get(args.id);
    if (!brand || brand.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Brend topilmadi" });
    }
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});
