import { v, ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server";
import { paginationOptsValidator } from "convex/server";
import type { Doc } from "../_generated/dataModel.d.ts";
import { getTenantId, requireTenantAccess, requireTenantAccessForWrite, requirePermission } from "../tenant.ts";

export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
    categoryId: v.optional(v.id("categories")),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{
    page: (Doc<"products"> & { categoryName?: string; brandName?: string; baseUnitName?: string })[];
    isDone: boolean;
    continueCursor: string;
  }> => {
    const tenantId = await getTenantId(ctx);
    // If no tenant resolved, return empty — never return cross-company data
    if (!tenantId) return { page: [], isDone: true, continueCursor: "" };

    let q;
    if (args.search) {
      q = ctx.db.query("products").withSearchIndex("search_name", (sq) => {
        let s = sq.search("name", args.search!);
        if (args.isActive !== undefined) s = s.eq("isActive", args.isActive!);
        if (args.categoryId) s = s.eq("categoryId", args.categoryId!);
        s = s.eq("companyId", tenantId);
        return s;
      });
    } else if (args.categoryId) {
      q = ctx.db.query("products")
        .withIndex("by_category", (iq) => iq.eq("categoryId", args.categoryId!))
        .filter((fq) => fq.eq(fq.field("companyId"), tenantId));
    } else {
      q = ctx.db.query("products")
        .filter((fq) => fq.eq(fq.field("companyId"), tenantId));
    }

    if (args.isActive !== undefined && !args.search) {
      q = q.filter((fq) => fq.eq(fq.field("isActive"), args.isActive!));
    }

    // Guard against cursor-from-different-query errors (search ↔ regular index switch)
    let result;
    try {
      result = await q.paginate(args.paginationOpts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("InvalidCursor") || msg.includes("cursor")) {
        result = await q.paginate({ numItems: args.paginationOpts.numItems, cursor: null });
      } else {
        throw err;
      }
    }
    const page = await Promise.all(
      result.page.map(async (p) => {
        const [category, brand, unit] = await Promise.all([
          p.categoryId ? ctx.db.get(p.categoryId) : null,
          p.brandId ? ctx.db.get(p.brandId) : null,
          ctx.db.get(p.baseUnitId),
        ]);
        return { ...p, categoryName: category?.name, brandName: brand?.name, baseUnitName: unit?.shortName };
      })
    );
    return { ...result, page };
  },
});

export const getById = query({
  args: { id: v.id("products") },
  handler: async (ctx, args): Promise<Doc<"products"> & {
    categoryName?: string; brandName?: string; baseUnitName?: string;
    purchaseUnitName?: string; salesUnitName?: string; batches: Doc<"batches">[];
  } | null> => {
    const tenantId = await getTenantId(ctx);
    const p = await ctx.db.get(args.id);
    if (!p) return null;
    // SECURITY: strictly verify ownership — never return another company's product
    if (p.companyId !== tenantId) return null;

    const [category, brand, baseUnit, purchaseUnit, salesUnit, batches] = await Promise.all([
      p.categoryId ? ctx.db.get(p.categoryId) : null,
      p.brandId ? ctx.db.get(p.brandId) : null,
      ctx.db.get(p.baseUnitId),
      p.purchaseUnitId ? ctx.db.get(p.purchaseUnitId) : null,
      p.salesUnitId ? ctx.db.get(p.salesUnitId) : null,
      ctx.db.query("batches").withIndex("by_product", (q) => q.eq("productId", args.id)).collect(),
    ]);
    return {
      ...p,
      categoryName: category?.name, brandName: brand?.name,
      baseUnitName: baseUnit?.shortName, purchaseUnitName: purchaseUnit?.shortName,
      salesUnitName: salesUnit?.shortName, batches,
    };
  },
});

export const getByBarcode = query({
  args: { barcode: v.string() },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    const product = await ctx.db.query("products")
      .withIndex("by_barcode", (q) => q.eq("barcode", args.barcode))
      .first();
    if (!product) return null;
    // Strict check — no orphan fallback
    if (product.companyId !== tenantId) return null;
    return product;
  },
});

export const create = mutation({
  args: {
    name: v.string(), sku: v.string(), barcode: v.optional(v.string()),
    description: v.optional(v.string()), imageUrl: v.optional(v.string()),
    categoryId: v.optional(v.id("categories")), brandId: v.optional(v.id("brands")),
    manufacturer: v.optional(v.string()), baseUnitId: v.id("units"),
    purchaseUnitId: v.optional(v.id("units")), salesUnitId: v.optional(v.id("units")),
    purchasePrice: v.number(), salesPrice: v.number(),
    wholesalePrice: v.optional(v.number()), retailPrice: v.optional(v.number()),
    promoPrice: v.optional(v.number()), taxRate: v.number(), taxIncluded: v.boolean(),
    minStock: v.number(), maxStock: v.optional(v.number()),
    trackBatch: v.boolean(), trackExpiry: v.boolean(),
    shelfLifeDays: v.optional(v.number()),
    costingMethod: v.union(v.literal("fifo"), v.literal("fefo"), v.literal("average"), v.literal("manual")),
    isSaleable: v.boolean(), isPurchaseable: v.boolean(), isManufactured: v.boolean(),
    weight: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "products.create");
    const tenantId = await requireTenantAccessForWrite(ctx);
    const existing = await ctx.db.query("products")
      .withIndex("by_sku", (q) => q.eq("sku", args.sku))
      .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
      .first();
    if (existing) throw new ConvexError({ code: "CONFLICT", message: "Bu SKU allaqachon mavjud" });
    return ctx.db.insert("products", { ...args, isActive: true, companyId: tenantId });
  },
});

export const update = mutation({
  args: {
    id: v.id("products"), name: v.optional(v.string()), sku: v.optional(v.string()),
    barcode: v.optional(v.string()), description: v.optional(v.string()),
    imageUrl: v.optional(v.string()), categoryId: v.optional(v.id("categories")),
    brandId: v.optional(v.id("brands")), manufacturer: v.optional(v.string()),
    baseUnitId: v.optional(v.id("units")), purchaseUnitId: v.optional(v.id("units")),
    salesUnitId: v.optional(v.id("units")), purchasePrice: v.optional(v.number()),
    salesPrice: v.optional(v.number()), wholesalePrice: v.optional(v.number()),
    retailPrice: v.optional(v.number()), promoPrice: v.optional(v.number()),
    taxRate: v.optional(v.number()), taxIncluded: v.optional(v.boolean()),
    minStock: v.optional(v.number()), maxStock: v.optional(v.number()),
    trackBatch: v.optional(v.boolean()), trackExpiry: v.optional(v.boolean()),
    shelfLifeDays: v.optional(v.number()),
    costingMethod: v.optional(v.union(v.literal("fifo"), v.literal("fefo"), v.literal("average"), v.literal("manual"))),
    isSaleable: v.optional(v.boolean()), isPurchaseable: v.optional(v.boolean()),
    isManufactured: v.optional(v.boolean()), isActive: v.optional(v.boolean()),
    weight: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "products.edit");
    const tenantId = await requireTenantAccessForWrite(ctx);
    const { id, ...fields } = args;
    // SECURITY: verify product belongs to this tenant before patching
    const product = await ctx.db.get(id);
    if (!product || product.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Mahsulot topilmadi" });
    }
    await ctx.db.patch(id, fields);
  },
});

export const remove = mutation({
  args: { id: v.id("products") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "products.delete");
    const tenantId = await requireTenantAccessForWrite(ctx);
    // SECURITY: verify ownership before deactivating
    const product = await ctx.db.get(args.id);
    if (!product || product.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Mahsulot topilmadi" });
    }
    await ctx.db.patch(args.id, { isActive: false });
  },
});

export const addBatch = mutation({
  args: {
    productId: v.id("products"), batchNumber: v.string(),
    supplierId: v.optional(v.string()), manufacturedDate: v.optional(v.string()),
    expiryDate: v.optional(v.string()), quantity: v.number(),
    unitId: v.id("units"), costPrice: v.number(), notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "warehouse.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);
    // Verify the product belongs to this tenant
    const product = await ctx.db.get(args.productId);
    if (!product || product.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Mahsulot topilmadi" });
    }
    return ctx.db.insert("batches", { ...args, companyId: tenantId });
  },
});

export const getExpiringBatches = query({
  args: { daysAhead: v.number() },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + args.daysAhead);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const batches = await ctx.db.query("batches")
      .withIndex("by_expiry", (q) => q.gte("expiryDate", today).lte("expiryDate", cutoffStr))
      .collect();
    // Strict tenant filter — no orphan fallback
    const filtered = batches.filter((b) => b.companyId === tenantId);
    return Promise.all(filtered.map(async (b) => {
      const product = await ctx.db.get(b.productId);
      return { ...b, productName: product?.name };
    }));
  },
});
