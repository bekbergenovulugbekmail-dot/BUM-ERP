import { v, ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server.js";
import { getTenantId, requireTenantAccessForWrite, requirePermission } from "../tenant.ts";

// List inventory count sessions
export const list = query({
  args: {
    warehouseId: v.optional(v.id("warehouses")),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];

    let counts;
    if (args.warehouseId) {
      // Verify warehouse belongs to this company
      const wh = await ctx.db.get(args.warehouseId);
      if (!wh || wh.companyId !== tenantId) return [];

      counts = await ctx.db
        .query("inventoryCounts")
        .withIndex("by_warehouse", (q) => q.eq("warehouseId", args.warehouseId!))
        .order("desc")
        .take(50);
      counts = counts.filter((c) => c.companyId === tenantId);
    } else {
      counts = await ctx.db
        .query("inventoryCounts")
        .withIndex("by_company", (q) => q.eq("companyId", tenantId))
        .order("desc")
        .take(50);
    }

    if (args.status) {
      counts = counts.filter((c) => c.status === args.status);
    }

    return Promise.all(
      counts.map(async (c) => {
        const warehouse = await ctx.db.get(c.warehouseId);
        const items = await ctx.db
          .query("inventoryCountItems")
          .withIndex("by_count", (q) => q.eq("countId", c._id))
          .collect();
        return {
          ...c,
          warehouseName: warehouse?.name ?? "—",
          itemCount: items.length,
          countedItems: items.filter((i) => i.countedQty !== undefined).length,
        };
      })
    );
  },
});

// Get count session with all items
export const getById = query({
  args: { id: v.id("inventoryCounts") },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return null;

    const count = await ctx.db.get(args.id);
    if (!count || count.companyId !== tenantId) return null;

    const warehouse = await ctx.db.get(count.warehouseId);
    const items = await ctx.db
      .query("inventoryCountItems")
      .withIndex("by_count", (q) => q.eq("countId", args.id))
      .collect();

    const enriched = await Promise.all(
      items.map(async (item) => {
        const product = await ctx.db.get(item.productId);
        const unit = await ctx.db.get(product?.baseUnitId ?? ("" as never));
        return {
          ...item,
          productName: product?.name ?? "—",
          productSku: product?.sku ?? "—",
          unitName: unit?.shortName ?? "—",
        };
      })
    );

    return { ...count, warehouseName: warehouse?.name ?? "—", items: enriched };
  },
});

// Create a new inventory count session
export const create = mutation({
  args: {
    warehouseId: v.id("warehouses"),
    name: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "warehouse.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);

    // Verify warehouse belongs to this company
    const wh = await ctx.db.get(args.warehouseId);
    if (!wh || wh.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Ombor topilmadi" });
    }

    const countId = await ctx.db.insert("inventoryCounts", {
      warehouseId: args.warehouseId,
      name: args.name,
      status: "draft",
      notes: args.notes,
      adjustmentsMade: false,
      companyId: tenantId,
    });

    // Load current stock levels for THIS company's warehouse
    const levels = await ctx.db
      .query("stockLevels")
      .withIndex("by_warehouse", (q) => q.eq("warehouseId", args.warehouseId))
      .collect();
    // Only include stock levels owned by this company
    const ownedLevels = levels.filter((l) => l.companyId === tenantId);

    for (const level of ownedLevels) {
      await ctx.db.insert("inventoryCountItems", {
        countId,
        productId: level.productId,
        expectedQty: level.quantity,
        companyId: tenantId,
      });
    }

    return countId;
  },
});

// Update a count item (set the physically counted qty)
export const updateItem = mutation({
  args: {
    itemId: v.id("inventoryCountItems"),
    countedQty: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "warehouse.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);

    const item = await ctx.db.get(args.itemId);
    if (!item || item.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Topilmadi" });
    }

    const diff = args.countedQty - item.expectedQty;
    await ctx.db.patch(args.itemId, {
      countedQty: args.countedQty,
      difference: diff,
      notes: args.notes,
    });
  },
});

// Start / complete / cancel a session
export const updateStatus = mutation({
  args: {
    id: v.id("inventoryCounts"),
    status: v.union(
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "warehouse.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);

    const count = await ctx.db.get(args.id);
    if (!count || count.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Topilmadi" });
    }

    const patch: Record<string, unknown> = { status: args.status };
    if (args.status === "in_progress") patch.startedAt = new Date().toISOString();
    if (args.status === "completed") patch.completedAt = new Date().toISOString();
    await ctx.db.patch(args.id, patch);
  },
});

// Apply adjustments to stock levels based on count results
export const applyAdjustments = mutation({
  args: { id: v.id("inventoryCounts") },
  handler: async (ctx, args): Promise<void> => {
    await requirePermission(ctx, "warehouse.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);

    const count = await ctx.db.get(args.id);
    if (!count || count.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Topilmadi" });
    }
    if (count.adjustmentsMade) {
      throw new ConvexError({ code: "CONFLICT", message: "Tuzatmalar allaqachon amalga oshirilgan" });
    }

    const items = await ctx.db
      .query("inventoryCountItems")
      .withIndex("by_count", (q) => q.eq("countId", args.id))
      .collect();

    const today = new Date().toISOString().slice(0, 10);

    for (const item of items) {
      if (item.countedQty === undefined || item.difference === 0) continue;
      // Verify item ownership
      if (item.companyId !== tenantId) continue;

      const level = await ctx.db
        .query("stockLevels")
        .withIndex("by_product_warehouse", (q) =>
          q.eq("productId", item.productId).eq("warehouseId", count.warehouseId)
        )
        .first();

      if (!level || level.companyId !== tenantId) continue;

      const product = await ctx.db.get(item.productId);
      if (!product || product.companyId !== tenantId) continue;

      await ctx.db.insert("stockMovements", {
        type: "count",
        productId: item.productId,
        warehouseId: count.warehouseId,
        quantity: item.difference!,
        unitId: product.baseUnitId,
        costPrice: level.avgCostPrice,
        referenceId: args.id,
        referenceType: "inventory_count",
        notes: `Inventarizatsiya: ${count.name}`,
        date: today,
        companyId: tenantId,
      });

      await ctx.db.patch(level._id, { quantity: item.countedQty! });
    }

    await ctx.db.patch(args.id, {
      adjustmentsMade: true,
      status: "completed",
      completedAt: new Date().toISOString(),
    });
  },
});
