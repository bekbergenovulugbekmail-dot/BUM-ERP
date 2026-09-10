import { v, ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server.js";
import type { Id } from "../_generated/dataModel.d.ts";
import { getTenantId, requireTenantAccessForWrite } from "../tenant.ts";

export const getWarehouseStock = query({
  args: {
    warehouseId: v.id("warehouses"),
    searchQuery: v.optional(v.string()),
    lowStockOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];

    // Verify warehouse belongs to this company
    const wh = await ctx.db.get(args.warehouseId);
    if (!wh || wh.companyId !== tenantId) return [];

    const levels = await ctx.db.query("stockLevels")
      .withIndex("by_warehouse", (q) => q.eq("warehouseId", args.warehouseId))
      .collect();
    // STRICT: no orphan fallback
    const scoped = levels.filter((l) => l.companyId === tenantId);

    const result = await Promise.all(scoped.map(async (sl) => {
      const product = await ctx.db.get(sl.productId);
      if (!product || !product.isActive || product.companyId !== tenantId) return null;
      const unit = await ctx.db.get(product.baseUnitId);
      return {
        ...sl, productName: product.name, productSku: product.sku,
        productBarcode: product.barcode, productImage: product.imageUrl,
        minStock: product.minStock, maxStock: product.maxStock,
        unitName: unit?.shortName ?? "", availableQty: sl.quantity - sl.reservedQty,
        isLow: sl.quantity <= product.minStock,
        isOverstock: product.maxStock ? sl.quantity > product.maxStock : false,
      };
    }));

    let filtered = result.filter(Boolean) as NonNullable<typeof result[number]>[];
    if (args.lowStockOnly) filtered = filtered.filter((r) => r.isLow);
    if (args.searchQuery) {
      const q = args.searchQuery.toLowerCase();
      filtered = filtered.filter((r) =>
        r.productName.toLowerCase().includes(q) ||
        r.productSku.toLowerCase().includes(q) ||
        (r.productBarcode ?? "").toLowerCase().includes(q)
      );
    }
    return filtered.sort((a, b) => a.productName.localeCompare(b.productName));
  },
});

export const getProductStock = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];

    // Verify product belongs to this company
    const product = await ctx.db.get(args.productId);
    if (!product || product.companyId !== tenantId) return [];

    const levels = await ctx.db.query("stockLevels")
      .withIndex("by_product", (q) => q.eq("productId", args.productId)).collect();
    // STRICT: only this company's stock levels
    const scoped = levels.filter((l) => l.companyId === tenantId);

    return Promise.all(scoped.map(async (sl) => {
      const warehouse = await ctx.db.get(sl.warehouseId);
      return { ...sl, warehouseName: warehouse?.name ?? "—" };
    }));
  },
});

export const getWarehouseStats = query({
  args: { warehouseId: v.id("warehouses") },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return { totalValue: 0, totalItems: 0, lowStockCount: 0, zeroStockCount: 0 };

    // Verify warehouse belongs to this company
    const wh = await ctx.db.get(args.warehouseId);
    if (!wh || wh.companyId !== tenantId) return { totalValue: 0, totalItems: 0, lowStockCount: 0, zeroStockCount: 0 };

    const levels = await ctx.db.query("stockLevels")
      .withIndex("by_warehouse", (q) => q.eq("warehouseId", args.warehouseId)).collect();
    // STRICT: only this company's levels
    const scoped = levels.filter((l) => l.companyId === tenantId);

    let totalValue = 0, totalItems = 0, lowStockCount = 0, zeroStockCount = 0;
    for (const sl of scoped) {
      const product = await ctx.db.get(sl.productId);
      if (!product || !product.isActive || product.companyId !== tenantId) continue;
      totalValue += sl.quantity * sl.avgCostPrice;
      totalItems++;
      if (sl.quantity === 0) zeroStockCount++;
      else if (sl.quantity <= product.minStock) lowStockCount++;
    }
    return { totalValue, totalItems, lowStockCount, zeroStockCount };
  },
});

export const recordMovement = mutation({
  args: {
    type: v.union(
      v.literal("receive"), v.literal("issue"), v.literal("transfer_out"),
      v.literal("transfer_in"), v.literal("adjust"), v.literal("writeoff"),
      v.literal("return_in"), v.literal("return_out"), v.literal("count"),
    ),
    productId: v.id("products"), warehouseId: v.id("warehouses"),
    quantity: v.number(), unitId: v.id("units"), costPrice: v.number(),
    batchId: v.optional(v.id("batches")), zoneId: v.optional(v.id("warehouseZones")),
    referenceId: v.optional(v.string()), referenceType: v.optional(v.string()),
    notes: v.optional(v.string()), date: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"stockMovements">> => {
    const tenantId = await requireTenantAccessForWrite(ctx);

    // Verify product and warehouse belong to this company
    const product = await ctx.db.get(args.productId);
    if (!product || product.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Mahsulot topilmadi" });
    }
    const wh = await ctx.db.get(args.warehouseId);
    if (!wh || wh.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Ombor topilmadi" });
    }

    const inTypes = ["receive", "transfer_in", "return_in", "count"];
    const isIn = inTypes.includes(args.type);
    const qty = isIn ? Math.abs(args.quantity) : -Math.abs(args.quantity);
    const movId = await ctx.db.insert("stockMovements", { ...args, quantity: qty, companyId: tenantId });

    const existing = await ctx.db.query("stockLevels")
      .withIndex("by_product_warehouse", (q) =>
        q.eq("productId", args.productId).eq("warehouseId", args.warehouseId))
      .first();

    if (existing) {
      // Strict ownership check
      if (existing.companyId !== tenantId) {
        throw new ConvexError({ code: "FORBIDDEN", message: "Zaxira topilmadi" });
      }
      const newQty = existing.quantity + qty;
      if (newQty < 0) throw new ConvexError({ code: "BAD_REQUEST", message: "Yetarli zaxira mavjud emas" });
      let newAvgCost = existing.avgCostPrice;
      if (isIn && args.costPrice > 0) {
        const totalCost = existing.quantity * existing.avgCostPrice + Math.abs(qty) * args.costPrice;
        const totalQty = existing.quantity + Math.abs(qty);
        newAvgCost = totalQty > 0 ? totalCost / totalQty : args.costPrice;
      }
      await ctx.db.patch(existing._id, { quantity: newQty, avgCostPrice: newAvgCost });
    } else {
      if (!isIn) throw new ConvexError({ code: "BAD_REQUEST", message: "Bu mahsulot omborda mavjud emas" });
      await ctx.db.insert("stockLevels", {
        productId: args.productId, warehouseId: args.warehouseId,
        quantity: Math.abs(qty), reservedQty: 0, avgCostPrice: args.costPrice,
        companyId: tenantId,
      });
    }
    return movId;
  },
});

export const transferStock = mutation({
  args: {
    productId: v.id("products"), fromWarehouseId: v.id("warehouses"),
    toWarehouseId: v.id("warehouses"), quantity: v.number(),
    unitId: v.id("units"), costPrice: v.number(),
    notes: v.optional(v.string()), date: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const tenantId = await requireTenantAccessForWrite(ctx);

    if (args.fromWarehouseId === args.toWarehouseId) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Bir xil ombor tanlandi" });
    }

    // Verify product and both warehouses belong to this company
    const product = await ctx.db.get(args.productId);
    if (!product || product.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Mahsulot topilmadi" });
    }
    const fromWh = await ctx.db.get(args.fromWarehouseId);
    if (!fromWh || fromWh.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Manba ombor topilmadi" });
    }
    const toWh = await ctx.db.get(args.toWarehouseId);
    if (!toWh || toWh.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Maqsad ombor topilmadi" });
    }

    const srcLevel = await ctx.db.query("stockLevels")
      .withIndex("by_product_warehouse", (q) =>
        q.eq("productId", args.productId).eq("warehouseId", args.fromWarehouseId))
      .first();
    if (!srcLevel || srcLevel.companyId !== tenantId || srcLevel.quantity < args.quantity) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Yetarli zaxira mavjud emas" });
    }

    const ref = `TRF-${Date.now()}`;
    await ctx.db.insert("stockMovements", {
      type: "transfer_out", productId: args.productId, warehouseId: args.fromWarehouseId,
      quantity: -args.quantity, unitId: args.unitId, costPrice: args.costPrice,
      referenceId: ref, referenceType: "transfer", notes: args.notes, date: args.date,
      companyId: tenantId,
    });
    await ctx.db.patch(srcLevel._id, { quantity: srcLevel.quantity - args.quantity });

    const dstLevel = await ctx.db.query("stockLevels")
      .withIndex("by_product_warehouse", (q) =>
        q.eq("productId", args.productId).eq("warehouseId", args.toWarehouseId))
      .first();
    await ctx.db.insert("stockMovements", {
      type: "transfer_in", productId: args.productId, warehouseId: args.toWarehouseId,
      quantity: args.quantity, unitId: args.unitId, costPrice: args.costPrice,
      referenceId: ref, referenceType: "transfer", notes: args.notes, date: args.date,
      companyId: tenantId,
    });
    if (dstLevel && dstLevel.companyId === tenantId) {
      const totalCost = dstLevel.quantity * dstLevel.avgCostPrice + args.quantity * args.costPrice;
      const totalQty = dstLevel.quantity + args.quantity;
      await ctx.db.patch(dstLevel._id, {
        quantity: dstLevel.quantity + args.quantity,
        avgCostPrice: totalQty > 0 ? totalCost / totalQty : args.costPrice,
      });
    } else {
      await ctx.db.insert("stockLevels", {
        productId: args.productId, warehouseId: args.toWarehouseId,
        quantity: args.quantity, reservedQty: 0, avgCostPrice: args.costPrice,
        companyId: tenantId,
      });
    }
  },
});

export const getMovements = query({
  args: {
    warehouseId: v.optional(v.id("warehouses")), productId: v.optional(v.id("products")),
    type: v.optional(v.string()), limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];

    let movements;
    if (args.warehouseId) {
      // Verify warehouse belongs to this company
      const wh = await ctx.db.get(args.warehouseId);
      if (!wh || wh.companyId !== tenantId) return [];

      movements = await ctx.db.query("stockMovements")
        .withIndex("by_warehouse", (q) => q.eq("warehouseId", args.warehouseId!))
        .order("desc").take(args.limit ?? 50);
      // STRICT: no orphan fallback
      movements = movements.filter((m) => m.companyId === tenantId);
    } else if (args.productId) {
      // Verify product belongs to this company
      const product = await ctx.db.get(args.productId);
      if (!product || product.companyId !== tenantId) return [];

      movements = await ctx.db.query("stockMovements")
        .withIndex("by_product", (q) => q.eq("productId", args.productId!))
        .order("desc").take(args.limit ?? 50);
      movements = movements.filter((m) => m.companyId === tenantId);
    } else {
      movements = await ctx.db.query("stockMovements")
        .withIndex("by_company", (q) => q.eq("companyId", tenantId))
        .order("desc").take(args.limit ?? 50);
    }

    const typed = args.type ? movements.filter((m) => m.type === args.type) : movements;

    return Promise.all(typed.map(async (m) => {
      const product = await ctx.db.get(m.productId);
      const warehouse = await ctx.db.get(m.warehouseId);
      const unit = await ctx.db.get(m.unitId);
      return {
        ...m,
        productName: product?.name ?? "—", productSku: product?.sku ?? "—",
        warehouseName: warehouse?.name ?? "—", unitName: unit?.shortName ?? "—",
      };
    }));
  },
});
