import { v, ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel.d.ts";
import {
  getTenantId,
  requireTenantAccessForWrite,
  requirePermission,
} from "../tenant.ts";
import type { MutationCtx, QueryCtx } from "../_generated/server.d.ts";

// ── Work Centers ──────────────────────────────────────────────────────────────

export const listWorkCenters = query({
  args: {},
  handler: async (ctx): Promise<Array<{
    _id: Id<"workCenters">; _creationTime: number;
    name: string; code: string;
    type: "machine" | "labor" | "subcontract";
    costPerHour: number; isActive: boolean;
    companyId?: Id<"companies">;
  }>> => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];
    return ctx.db.query("workCenters")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .collect();
  },
});

export const createWorkCenter = mutation({
  args: {
    name: v.string(),
    type: v.union(v.literal("machine"), v.literal("labor"), v.literal("subcontract")),
    costPerHour: v.number(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "production.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);
    const existing = await ctx.db.query("workCenters")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .collect();
    const code = `WC-${String(existing.length + 1).padStart(3, "0")}`;
    return ctx.db.insert("workCenters", { ...args, code, isActive: true, companyId: tenantId });
  },
});

export const deleteWorkCenter = mutation({
  args: { id: v.id("workCenters") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "production.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);
    const wc = await ctx.db.get(args.id);
    if (!wc || wc.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Topilmadi" });
    }
    await ctx.db.delete(args.id);
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function nextMoNumber(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"companies">,
): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `MO-${year}-`;
  const all = await ctx.db.query("productionOrders")
    .withIndex("by_company", (q) => q.eq("companyId", tenantId))
    .filter((q) => q.gte(q.field("number"), prefix))
    .order("desc")
    .take(1);
  const last = all[0];
  const seq = last && last.number.startsWith(prefix)
    ? parseInt(last.number.split("-")[2] ?? "0") + 1
    : 1;
  return `MO-${year}-${String(seq).padStart(4, "0")}`;
}

// ── Production Orders ─────────────────────────────────────────────────────────

export const listOrders = query({
  args: {
    status: v.optional(v.union(
      v.literal("draft"), v.literal("confirmed"), v.literal("in_progress"),
      v.literal("completed"), v.literal("cancelled"),
    )),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];

    const all = await ctx.db.query("productionOrders")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .order("desc")
      .take(args.limit ?? 100);

    const orders = args.status ? all.filter((o) => o.status === args.status) : all;

    return Promise.all(orders.map(async (o) => {
      const product = await ctx.db.get(o.productId);
      const warehouse = await ctx.db.get(o.warehouseId);
      const bom = await ctx.db.get(o.bomId);
      return { ...o, productName: product?.name, warehouseName: warehouse?.name, bomName: bom?.name };
    }));
  },
});

export const getOrder = query({
  args: { id: v.id("productionOrders") },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return null;
    const order = await ctx.db.get(args.id);
    if (!order || order.companyId !== tenantId) return null;

    const product = await ctx.db.get(order.productId);
    const warehouse = await ctx.db.get(order.warehouseId);
    const bom = await ctx.db.get(order.bomId);

    const materials = await ctx.db.query("productionMaterials")
      .withIndex("by_order", (q) => q.eq("orderId", args.id)).collect();
    const enrichedMaterials = await Promise.all(materials.map(async (m) => {
      const comp = await ctx.db.get(m.productId);
      const unit = await ctx.db.get(m.unitId);
      return { ...m, componentName: comp?.name, unitName: unit?.shortName };
    }));

    const timeLines = await ctx.db.query("productionTimeLines")
      .withIndex("by_order", (q) => q.eq("orderId", args.id)).collect();
    const enrichedTimeLines = await Promise.all(timeLines.map(async (tl) => {
      const wc = await ctx.db.get(tl.workCenterId);
      return { ...tl, workCenterName: wc?.name };
    }));

    return {
      ...order,
      productName: product?.name,
      productSku: product?.sku,
      warehouseName: warehouse?.name,
      bomName: bom?.name,
      materials: enrichedMaterials,
      timeLines: enrichedTimeLines,
    };
  },
});

export const getStats = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return { total: 0, byStatus: {}, totalCost: 0 };

    const all = await ctx.db.query("productionOrders")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .collect();

    const byStatus: Record<string, number> = {};
    let totalCost = 0;
    for (const o of all) {
      byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
      if (o.status === "completed") totalCost += o.totalCost;
    }
    return { total: all.length, byStatus, totalCost };
  },
});

export const createOrder = mutation({
  args: {
    bomId: v.id("boms"),
    warehouseId: v.id("warehouses"),
    plannedQty: v.number(),
    plannedDate: v.string(),
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

    // Verify warehouse belongs to this company
    const warehouse = await ctx.db.get(args.warehouseId);
    if (!warehouse || warehouse.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Ombor topilmadi" });
    }

    const number = await nextMoNumber(ctx, tenantId);

    // Get BOM items to compute material costs
    const bomItems = await ctx.db.query("bomItems")
      .withIndex("by_bom", (q) => q.eq("bomId", args.bomId)).collect();
    let totalMaterialCost = 0;

    const orderId = await ctx.db.insert("productionOrders", {
      number,
      bomId: args.bomId,
      productId: bom.productId,
      warehouseId: args.warehouseId,
      plannedQty: args.plannedQty,
      producedQty: 0,
      status: "draft",
      plannedDate: args.plannedDate,
      totalMaterialCost: 0,
      totalLaborCost: 0,
      totalCost: 0,
      unitCost: 0,
      notes: args.notes,
      companyId: tenantId,
    });

    // Create material lines from BOM items
    const multiplier = args.plannedQty / bom.quantity;
    for (const item of bomItems) {
      const component = await ctx.db.get(item.productId);
      const unitCost = component?.purchasePrice ?? 0;
      const plannedQty = item.quantity * multiplier * (1 + item.scrapPercent / 100);
      const lineCost = plannedQty * unitCost;
      totalMaterialCost += lineCost;

      await ctx.db.insert("productionMaterials", {
        orderId,
        productId: item.productId,
        plannedQty,
        actualQty: 0,
        unitId: item.unitId,
        unitCost,
        totalCost: lineCost,
        companyId: tenantId,
      });
    }

    await ctx.db.patch(orderId, {
      totalMaterialCost,
      totalCost: totalMaterialCost,
      unitCost: args.plannedQty > 0 ? totalMaterialCost / args.plannedQty : 0,
    });

    return orderId;
  },
});

export const confirmOrder = mutation({
  args: { id: v.id("productionOrders") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "production.approve");
    const tenantId = await requireTenantAccessForWrite(ctx);
    const order = await ctx.db.get(args.id);
    if (!order || order.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Topilmadi" });
    }
    if (order.status !== "draft") {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Faqat draft holatdagi buyurtmani tasdiqlash mumkin" });
    }
    await ctx.db.patch(args.id, { status: "confirmed" });
  },
});

export const startOrder = mutation({
  args: { id: v.id("productionOrders") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "production.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);
    const order = await ctx.db.get(args.id);
    if (!order || order.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Topilmadi" });
    }
    if (order.status !== "confirmed") {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Faqat tasdiqlangan buyurtmani boshlash mumkin" });
    }
    await ctx.db.patch(args.id, { status: "in_progress", startedAt: new Date().toISOString() });
  },
});

export const completeOrder = mutation({
  args: {
    id: v.id("productionOrders"),
    producedQty: v.number(),
    actualMaterials: v.optional(v.array(v.object({
      materialId: v.id("productionMaterials"),
      actualQty: v.number(),
    }))),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "production.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);
    const order = await ctx.db.get(args.id);
    if (!order || order.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Topilmadi" });
    }
    if (order.status !== "in_progress") {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Faqat jarayondagi buyurtmani yakunlash mumkin" });
    }

    // Update actual material consumption
    let totalActualMaterialCost = 0;
    if (args.actualMaterials) {
      for (const am of args.actualMaterials) {
        const mat = await ctx.db.get(am.materialId);
        if (!mat || mat.companyId !== tenantId) continue;
        const totalCost = am.actualQty * mat.unitCost;
        totalActualMaterialCost += totalCost;
        await ctx.db.patch(am.materialId, { actualQty: am.actualQty, totalCost });
      }
    } else {
      const materials = await ctx.db.query("productionMaterials")
        .withIndex("by_order", (q) => q.eq("orderId", args.id)).collect();
      for (const mat of materials) {
        if (mat.companyId !== tenantId) continue;
        totalActualMaterialCost += mat.plannedQty * mat.unitCost;
        await ctx.db.patch(mat._id, { actualQty: mat.plannedQty });
      }
    }

    // Get labor cost from time lines
    const timeLines = await ctx.db.query("productionTimeLines")
      .withIndex("by_order", (q) => q.eq("orderId", args.id)).collect();
    const totalLaborCost = timeLines.reduce((s, tl) => s + tl.actualHours * tl.costPerHour, 0);
    const totalCost = totalActualMaterialCost + totalLaborCost;
    const unitCost = args.producedQty > 0 ? totalCost / args.producedQty : 0;

    // Deduct raw materials from stock
    const materials = await ctx.db.query("productionMaterials")
      .withIndex("by_order", (q) => q.eq("orderId", args.id)).collect();
    for (const mat of materials) {
      const qty = mat.actualQty > 0 ? mat.actualQty : mat.plannedQty;
      if (qty <= 0) continue;
      const sl = await ctx.db.query("stockLevels")
        .withIndex("by_product_warehouse", (q) =>
          q.eq("productId", mat.productId).eq("warehouseId", order.warehouseId))
        .first();
      if (sl && sl.companyId === tenantId) {
        await ctx.db.patch(sl._id, { quantity: Math.max(0, sl.quantity - qty) });
      }
      const product = await ctx.db.get(mat.productId);
      if (product && product.companyId === tenantId) {
        await ctx.db.insert("stockMovements", {
          type: "issue",
          productId: mat.productId,
          warehouseId: order.warehouseId,
          quantity: -qty,
          unitId: mat.unitId,
          costPrice: mat.unitCost,
          referenceId: order.number,
          referenceType: "manufacturing",
          date: new Date().toISOString().slice(0, 10),
          notes: `Ishlab chiqarish: ${order.number}`,
          companyId: tenantId,
        });
      }
    }

    // Add finished goods to stock
    const product = await ctx.db.get(order.productId);
    if (product && product.companyId === tenantId) {
      const sl = await ctx.db.query("stockLevels")
        .withIndex("by_product_warehouse", (q) =>
          q.eq("productId", order.productId).eq("warehouseId", order.warehouseId))
        .first();
      if (sl && sl.companyId === tenantId) {
        const currentTotal = sl.quantity * sl.avgCostPrice;
        const newTotal = currentTotal + args.producedQty * unitCost;
        const newQty = sl.quantity + args.producedQty;
        const newAvg = newQty > 0 ? newTotal / newQty : unitCost;
        await ctx.db.patch(sl._id, { quantity: newQty, avgCostPrice: newAvg });
      } else {
        await ctx.db.insert("stockLevels", {
          productId: order.productId,
          warehouseId: order.warehouseId,
          quantity: args.producedQty,
          reservedQty: 0,
          avgCostPrice: unitCost,
          companyId: tenantId,
        });
      }
      await ctx.db.insert("stockMovements", {
        type: "receive",
        productId: order.productId,
        warehouseId: order.warehouseId,
        quantity: args.producedQty,
        unitId: product.baseUnitId,
        costPrice: unitCost,
        referenceId: order.number,
        referenceType: "manufacturing",
        date: new Date().toISOString().slice(0, 10),
        notes: `Tayyor mahsulot: ${order.number}`,
        companyId: tenantId,
      });
    }

    await ctx.db.patch(args.id, {
      status: "completed",
      producedQty: args.producedQty,
      completedAt: new Date().toISOString(),
      totalMaterialCost: totalActualMaterialCost,
      totalLaborCost,
      totalCost,
      unitCost,
    });
  },
});

export const cancelOrder = mutation({
  args: { id: v.id("productionOrders") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "production.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);
    const order = await ctx.db.get(args.id);
    if (!order || order.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Topilmadi" });
    }
    if (order.status === "completed") {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Yakunlangan buyurtmani bekor qilib bo'lmaydi" });
    }
    await ctx.db.patch(args.id, { status: "cancelled" });
  },
});

export const addTimeLine = mutation({
  args: {
    orderId: v.id("productionOrders"),
    workCenterId: v.id("workCenters"),
    plannedHours: v.number(),
    actualHours: v.number(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "production.manage");
    const tenantId = await requireTenantAccessForWrite(ctx);

    // Verify order belongs to this company
    const order = await ctx.db.get(args.orderId);
    if (!order || order.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Buyurtma topilmadi" });
    }

    // Verify work center belongs to this company
    const wc = await ctx.db.get(args.workCenterId);
    if (!wc || wc.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Ish markazi topilmadi" });
    }

    const totalCost = args.actualHours * wc.costPerHour;
    const tlId = await ctx.db.insert("productionTimeLines", {
      orderId: args.orderId,
      workCenterId: args.workCenterId,
      plannedHours: args.plannedHours,
      actualHours: args.actualHours,
      costPerHour: wc.costPerHour,
      totalCost,
      companyId: tenantId,
    });

    // Update order labor cost
    const timeLines = await ctx.db.query("productionTimeLines")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId)).collect();
    const totalLaborCost = timeLines.reduce((s, tl) => s + tl.totalCost, 0);
    const totalCostNew = order.totalMaterialCost + totalLaborCost;
    await ctx.db.patch(args.orderId, {
      totalLaborCost,
      totalCost: totalCostNew,
      unitCost: order.plannedQty > 0 ? totalCostNew / order.plannedQty : 0,
    });

    return tlId;
  },
});
