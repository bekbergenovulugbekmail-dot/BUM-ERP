import { v, ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server";
import { getTenantId, requireTenantAccessForWrite, requirePermission } from "../tenant.ts";

// ── BOMs ──────────────────────────────────────────────────────────────────────

export const listBOMs = query({
  args: { productId: v.optional(v.id("products")) },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];

    let boms;
    if (args.productId) {
      // Filter by product AND company
      boms = await ctx.db.query("boms")
        .withIndex("by_product", (q) => q.eq("productId", args.productId!))
        .collect();
      boms = boms.filter((b) => b.companyId === tenantId);
    } else {
      boms = await ctx.db.query("boms")
        .withIndex("by_company", (q) => q.eq("companyId", tenantId))
        .collect();
    }

    return Promise.all(boms.map(async (bom) => {
      const product = await ctx.db.get(bom.productId);
      const unit = await ctx.db.get(bom.unitId);
      const items = await ctx.db.query("bomItems")
        .withIndex("by_bom", (q) => q.eq("bomId", bom._id)).collect();
      return { ...bom, productName: product?.name, unitName: unit?.shortName, itemCount: items.length };
    }));
  },
});

export const getBOM = query({
  args: { id: v.id("boms") },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return null;
    const bom = await ctx.db.get(args.id);
    if (!bom || bom.companyId !== tenantId) return null;

    const product = await ctx.db.get(bom.productId);
    const unit = await ctx.db.get(bom.unitId);
    const items = await ctx.db.query("bomItems")
      .withIndex("by_bom", (q) => q.eq("bomId", args.id)).collect();
    const enrichedItems = await Promise.all(items.map(async (item) => {
      const comp = await ctx.db.get(item.productId);
      const compUnit = await ctx.db.get(item.unitId);
      return {
        ...item,
        componentName: comp?.name,
        componentSku: comp?.sku,
        unitName: compUnit?.shortName,
        unitCost: comp?.purchasePrice ?? 0,
      };
    }));
    return { ...bom, productName: product?.name, unitName: unit?.shortName, items: enrichedItems };
  },
});

export const createBOM = mutation({
  args: {
    productId: v.id("products"),
    name: v.string(),
    version: v.string(),
    quantity: v.number(),
    unitId: v.id("units"),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "production.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);

    // Verify product belongs to this company
    const product = await ctx.db.get(args.productId);
    if (!product || product.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Mahsulot topilmadi" });
    }

    return ctx.db.insert("boms", { ...args, isActive: true, companyId: tenantId });
  },
});

export const updateBOM = mutation({
  args: {
    id: v.id("boms"),
    name: v.optional(v.string()),
    version: v.optional(v.string()),
    quantity: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "production.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);
    const bom = await ctx.db.get(args.id);
    if (!bom || bom.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "BOM topilmadi" });
    }
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});

export const deleteBOM = mutation({
  args: { id: v.id("boms") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "production.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);
    const bom = await ctx.db.get(args.id);
    if (!bom || bom.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "BOM topilmadi" });
    }
    const items = await ctx.db.query("bomItems")
      .withIndex("by_bom", (q) => q.eq("bomId", args.id)).collect();
    for (const item of items) await ctx.db.delete(item._id);
    await ctx.db.delete(args.id);
  },
});

// ── BOM Items ─────────────────────────────────────────────────────────────────

export const addBOMItem = mutation({
  args: {
    bomId: v.id("boms"),
    productId: v.id("products"),
    quantity: v.number(),
    unitId: v.id("units"),
    scrapPercent: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "production.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);

    // Verify BOM belongs to this company
    const bom = await ctx.db.get(args.bomId);
    if (!bom || bom.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "BOM topilmadi" });
    }

    // Verify component product belongs to this company
    const product = await ctx.db.get(args.productId);
    if (!product || product.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Mahsulot topilmadi" });
    }

    return ctx.db.insert("bomItems", { ...args, companyId: tenantId });
  },
});

export const updateBOMItem = mutation({
  args: {
    id: v.id("bomItems"),
    quantity: v.optional(v.number()),
    scrapPercent: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "production.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);
    const item = await ctx.db.get(args.id);
    if (!item || item.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Topilmadi" });
    }
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});

export const deleteBOMItem = mutation({
  args: { id: v.id("bomItems") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "production.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);
    const item = await ctx.db.get(args.id);
    if (!item || item.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Topilmadi" });
    }
    await ctx.db.delete(args.id);
  },
});
