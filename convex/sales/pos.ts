import { v, ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server.js";
import type { Id } from "../_generated/dataModel.d.ts";
import { getTenantId, requireTenantAccessForWrite, requirePermission } from "../tenant.ts";
import { createJournalEntry, recordCashTransaction, buildSaleShipJELines } from "../finance/journalHelper.ts";

export const getOpenShift = query({
  args: { warehouseId: v.id("warehouses") },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return null;

    // Verify warehouse belongs to this company
    const wh = await ctx.db.get(args.warehouseId);
    if (!wh || wh.companyId !== tenantId) return null;

    return ctx.db
      .query("posShifts")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .filter((q) => q.and(
        q.eq(q.field("warehouseId"), args.warehouseId),
        q.eq(q.field("companyId"), tenantId),
      ))
      .first();
  },
});

export const openShift = mutation({
  args: {
    warehouseId: v.id("warehouses"),
    cashierName: v.optional(v.string()),
    openingCash: v.number(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales.create");
    const tenantId = await requireTenantAccessForWrite(ctx);

    // Verify warehouse belongs to this company
    const wh = await ctx.db.get(args.warehouseId);
    if (!wh || wh.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Ombor topilmadi" });
    }

    // Check for existing open shift in this company's warehouse
    const existing = await ctx.db
      .query("posShifts")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .filter((q) => q.and(
        q.eq(q.field("warehouseId"), args.warehouseId),
        q.eq(q.field("companyId"), tenantId),
      ))
      .first();
    if (existing) throw new ConvexError({ message: "Smena allaqachon ochiq", code: "CONFLICT" });

    return ctx.db.insert("posShifts", {
      warehouseId: args.warehouseId,
      cashierName: args.cashierName,
      status: "open",
      openedAt: new Date().toISOString(),
      openingCash: args.openingCash,
      totalSales: 0,
      totalCash: 0,
      totalCard: 0,
      receiptCount: 0,
      companyId: tenantId,
    });
  },
});

export const closeShift = mutation({
  args: {
    shiftId: v.id("posShifts"),
    closingCash: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales.create");
    const tenantId = await requireTenantAccessForWrite(ctx);

    const shift = await ctx.db.get(args.shiftId);
    if (!shift || shift.companyId !== tenantId) {
      throw new ConvexError({ message: "Smena topilmadi", code: "NOT_FOUND" });
    }
    await ctx.db.patch(args.shiftId, {
      status: "closed",
      closedAt: new Date().toISOString(),
      closingCash: args.closingCash,
      notes: args.notes,
    });
  },
});

export const completePOSSale = mutation({
  args: {
    shiftId: v.id("posShifts"),
    warehouseId: v.id("warehouses"),
    customerId: v.optional(v.id("customers")),
    items: v.array(v.object({
      productId: v.id("products"),
      unitId: v.id("units"),
      qty: v.number(),
      unitPrice: v.number(),
      taxRate: v.number(),
      discountPercent: v.number(),
    })),
    paymentMethod: v.union(v.literal("cash"), v.literal("card"), v.literal("bank"), v.literal("transfer")),
    amountPaid: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ orderId: Id<"salesOrders">; change: number }> => {
    await requirePermission(ctx, "sales.create");
    const tenantId = await requireTenantAccessForWrite(ctx);

    // Verify shift belongs to this company
    const shift = await ctx.db.get(args.shiftId);
    if (!shift || shift.status !== "open" || shift.companyId !== tenantId) {
      throw new ConvexError({ message: "Faol smena topilmadi", code: "BAD_REQUEST" });
    }

    // Verify warehouse belongs to this company
    const wh = await ctx.db.get(args.warehouseId);
    if (!wh || wh.companyId !== tenantId) {
      throw new ConvexError({ message: "Ombor topilmadi", code: "FORBIDDEN" });
    }

    // Verify customer belongs to this company if provided
    if (args.customerId) {
      const customer = await ctx.db.get(args.customerId);
      if (!customer || customer.companyId !== tenantId) {
        throw new ConvexError({ message: "Mijoz topilmadi", code: "FORBIDDEN" });
      }
    }

    // Verify all products belong to this company
    for (const item of args.items) {
      const product = await ctx.db.get(item.productId);
      if (!product || product.companyId !== tenantId) {
        throw new ConvexError({ message: "Mahsulot topilmadi", code: "FORBIDDEN" });
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const year = new Date().getFullYear();
    const lastOrder = await ctx.db.query("salesOrders")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .order("desc").first();
    const prefix = `SO-${year}-`;
    const seq = lastOrder && lastOrder.number.startsWith(prefix)
      ? parseInt(lastOrder.number.split("-")[2] ?? "0") + 1
      : 1;
    const number = `SO-${year}-${String(seq).padStart(4, "0")}`;

    let subtotal = 0;
    let taxAmount = 0;
    let discountAmount = 0;
    const lineItems = args.items.map((item) => {
      const gross = item.qty * item.unitPrice;
      const disc = gross * (item.discountPercent / 100);
      const net = gross - disc;
      const tax = net * (item.taxRate / 100);
      subtotal += net;
      taxAmount += tax;
      discountAmount += disc;
      return { ...item, lineTotal: net + tax };
    });

    const totalAmount = subtotal + taxAmount;
    const paidAmount = Math.min(args.amountPaid, totalAmount);
    const change = Math.max(0, args.amountPaid - totalAmount);

    const orderId = await ctx.db.insert("salesOrders", {
      number,
      customerId: args.customerId,
      warehouseId: args.warehouseId,
      status: "delivered",
      orderDate: today,
      currency: "UZS",
      exchangeRate: 1,
      subtotal,
      taxAmount,
      discountAmount,
      totalAmount,
      paidAmount,
      notes: args.notes,
      isPOS: true,
      posShiftId: args.shiftId,
      companyId: tenantId,  // SECURITY: always from server
    });

    for (const item of lineItems) {
      const stock = await ctx.db
        .query("stockLevels")
        .withIndex("by_product_warehouse", (q) =>
          q.eq("productId", item.productId).eq("warehouseId", args.warehouseId)
        )
        .unique();

      // Only use stock if it belongs to this company
      const ownedStock = stock && stock.companyId === tenantId ? stock : null;
      const costPrice = ownedStock?.avgCostPrice ?? 0;

      if (ownedStock) {
        await ctx.db.patch(ownedStock._id, {
          quantity: Math.max(0, ownedStock.quantity - item.qty),
        });
      }

      await ctx.db.insert("salesOrderItems", {
        orderId,
        productId: item.productId,
        unitId: item.unitId,
        qty: item.qty,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate,
        discountPercent: item.discountPercent,
        lineTotal: item.lineTotal,
        costPrice,
        companyId: tenantId,
      });

      await ctx.db.insert("stockMovements", {
        type: "issue",
        productId: item.productId,
        warehouseId: args.warehouseId,
        quantity: -item.qty,
        unitId: item.unitId,
        costPrice,
        referenceId: orderId,
        referenceType: "pos",
        date: today,
        companyId: tenantId,
      });
    }

    await ctx.db.insert("customerPayments", {
      customerId: args.customerId,
      orderId,
      amount: paidAmount,
      currency: "UZS",
      exchangeRate: 1,
      paymentDate: today,
      method: args.paymentMethod,
      companyId: tenantId,
    });

    await ctx.db.patch(args.shiftId, {
      totalSales: shift.totalSales + totalAmount,
      totalCash: shift.totalCash + (args.paymentMethod === "cash" ? paidAmount : 0),
      totalCard: shift.totalCard + (args.paymentMethod === "card" ? paidAmount : 0),
      receiptCount: shift.receiptCount + 1,
    });

    // ── Cash account: record POS income ──────────────────────────────────────
    const totalCogs = lineItems.reduce((s, item) => {
      const stock = null; // costPrice already captured per item below
      return s;
    }, 0);
    // Calculate actual COGS from items (costPrice captured at order creation)
    // We re-read items to get costPrice
    const savedItems = await ctx.db
      .query("salesOrderItems")
      .withIndex("by_order", (q) => q.eq("orderId", orderId))
      .collect();
    const cogsTotal = savedItems.reduce((s, i) => s + i.costPrice * i.qty, 0);

    await recordCashTransaction(ctx, {
      companyId: tenantId,
      cashAccountId: null,
      type: "in",
      amount: paidAmount,
      description: `POS sotuv: ${number}`,
      date: today,
      referenceType: "pos_sale",
      referenceId: orderId,
      category: "sales",
    });

    // ── Journal entry: DR Cash / CR Revenue + DR COGS / CR Inventory ─────────
    const jeLines = await buildSaleShipJELines(ctx, tenantId, totalAmount, cogsTotal, true);
    if (jeLines) {
      await createJournalEntry(ctx, {
        companyId: tenantId,
        date: today,
        description: `POS sotuv: ${number}`,
        referenceType: "pos_sale",
        referenceId: orderId,
        lines: jeLines,
      });
    }

    return { orderId, change };
  },
});

export const getShifts = query({
  args: { warehouseId: v.optional(v.id("warehouses")), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];

    let shifts;
    if (args.warehouseId) {
      // Verify warehouse belongs to this company
      const wh = await ctx.db.get(args.warehouseId);
      if (!wh || wh.companyId !== tenantId) return [];

      shifts = await ctx.db
        .query("posShifts")
        .withIndex("by_warehouse", (q) => q.eq("warehouseId", args.warehouseId!))
        .order("desc")
        .take(args.limit ?? 20);
      shifts = shifts.filter((s) => s.companyId === tenantId);
    } else {
      shifts = await ctx.db
        .query("posShifts")
        .withIndex("by_company", (q) => q.eq("companyId", tenantId))
        .order("desc")
        .take(args.limit ?? 20);
    }

    return Promise.all(
      shifts.map(async (s) => {
        const wh = await ctx.db.get(s.warehouseId);
        return { ...s, warehouseName: wh?.name ?? "—" };
      })
    );
  },
});
