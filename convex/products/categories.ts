import { v, ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server";
import { getTenantId, requireTenantAccessForWrite, requirePermission } from "../tenant.ts";

export const list = query({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];
    const all = await ctx.db.query("categories")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .collect();
    if (args.includeInactive) return all;
    return all.filter((c) => c.isActive);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    parentId: v.optional(v.id("categories")),
    description: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "products.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);

    // If a parent is provided, verify it belongs to this company
    if (args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (!parent || parent.companyId !== tenantId) {
        throw new ConvexError({ code: "FORBIDDEN", message: "Asosiy kategoriya topilmadi" });
      }
    }

    return ctx.db.insert("categories", {
      name: args.name,
      parentId: args.parentId,
      description: args.description,
      isActive: true,
      sortOrder: args.sortOrder ?? 0,
      companyId: tenantId,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("categories"),
    name: v.optional(v.string()),
    parentId: v.optional(v.id("categories")),
    description: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "products.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);
    const cat = await ctx.db.get(args.id);
    if (!cat || cat.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Kategoriya topilmadi" });
    }
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});

export const remove = mutation({
  args: { id: v.id("categories") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "products.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);
    const cat = await ctx.db.get(args.id);
    if (!cat || cat.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Kategoriya topilmadi" });
    }
    const products = await ctx.db
      .query("products")
      .withIndex("by_category", (q) => q.eq("categoryId", args.id))
      .first();
    if (products) {
      throw new ConvexError({ code: "CONFLICT", message: "Bu kategoriyada mahsulotlar mavjud" });
    }
    await ctx.db.delete(args.id);
  },
});
