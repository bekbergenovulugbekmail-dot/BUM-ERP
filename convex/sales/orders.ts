import { v, ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server.js";
import type { MutationCtx, QueryCtx } from "../_generated/server.d.ts";
import type { Id } from "../_generated/dataModel.d.ts";
import { getTenantId, requireTenantAccess, requireTenantAccessForWrite, requirePermission, writeAuditLog } from "../tenant.ts";
import {
  createJournalEntry, recordCashTransaction,
  buildSaleShipJELines, buildCustomerPaymentJELines,
} from "../finance/journalHelper.ts";

// ── helpers ───────────────────────────────────────────────────────────────────

async function nextSoNumber(ctx: QueryCtx | MutationCtx, tenantId: Id<"companies">) {
  const year = new Date().getFullYear();
  const prefix = `SO-${year}-`;
  const last = await ctx.db.query("salesOrders")
    .withIndex("by_number")
    .order("desc")
    .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
    .first();
  const seq = last && last.number.startsWith(prefix)
    ? parseInt(last.number.split("-")[2] ?? "0") + 1
    : 1;
  return `SO-${year}-${String(seq).padStart(4, "0")}`;
}

// Helper: load order and verify it belongs to the current tenant
async function loadOwnOrder(
  ctx: QueryCtx | MutationCtx,
  orderId: Id<"salesOrders">,
) {
  const tenantId = await requireTenantAccess(ctx);
  const order = await ctx.db.get(orderId);
  if (!order) {
    throw new ConvexError({ message: "Buyurtma topilmadi", code: "NOT_FOUND" });
  }
  if (order.companyId !== tenantId) {
    throw new ConvexError({ message: "Ruxsat etilmagan", code: "FORBIDDEN" });
  }
  return { order, tenantId };
}

// ── list / stats ──────────────────────────────────────────────────────────────

export const list = query({
  args: {
    status: v.optional(v.union(
      v.literal("draft"), v.literal("confirmed"), v.literal("shipped"),
      v.literal("delivered"), v.literal("returned"), v.literal("cancelled"),
    )),
    customerId: v.optional(v.id("customers")),
    warehouseId: v.optional(v.id("warehouses")),
    isPOS: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];

    let orders;
    if (args.customerId) {
      // Filter by customer AND tenant at DB level
      orders = await ctx.db.query("salesOrders")
        .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
        .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
        .order("desc").take(args.limit ?? 100);
    } else if (args.status) {
      orders = await ctx.db.query("salesOrders")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
        .order("desc").take(args.limit ?? 100);
    } else {
      orders = await ctx.db.query("salesOrders")
        .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
        .order("desc").take(args.limit ?? 100);
    }

    if (args.isPOS !== undefined) {
      orders = orders.filter((o) => o.isPOS === args.isPOS);
    }

    return Promise.all(
      orders.map(async (o) => {
        const customer = o.customerId ? await ctx.db.get(o.customerId) : null;
        const warehouse = await ctx.db.get(o.warehouseId);
        const itemCount = await ctx.db
          .query("salesOrderItems")
          .withIndex("by_order", (q) => q.eq("orderId", o._id))
          .collect();
        return {
          ...o,
          customerName: customer?.name ?? "Anonim",
          warehouseName: warehouse?.name ?? "—",
          itemCount: itemCount.length,
          balance: o.totalAmount - o.paidAmount,
        };
      })
    );
  },
});

export const getById = query({
  args: { id: v.id("salesOrders") },
  handler: async (ctx, args): Promise<{
    _id: Id<"salesOrders">;
    number: string;
    customerName: string;
    warehouseName: string;
    balance: number;
    items: Array<{
      _id: Id<"salesOrderItems">;
      productId: Id<"products">;
      productName: string;
      productSku: string;
      unitId: Id<"units">;
      unitName: string;
      qty: number;
      unitPrice: number;
      taxRate: number;
      discountPercent: number;
      lineTotal: number;
      costPrice: number;
      notes?: string;
    }>;
    payments: Array<{
      _id: Id<"customerPayments">;
      amount: number;
      method: string;
      paymentDate: string;
    }>;
    status: string;
    orderDate: string;
    currency: string;
    exchangeRate: number;
    subtotal: number;
    taxAmount: number;
    discountAmount: number;
    totalAmount: number;
    paidAmount: number;
    notes?: string;
    isPOS: boolean;
    customerId?: Id<"customers">;
    warehouseId: Id<"warehouses">;
    posShiftId?: Id<"posShifts">;
    deliveryDate?: string;
    createdBy?: Id<"users">;
    _creationTime: number;
  } | null> => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return null;

    const order = await ctx.db.get(args.id);
    if (!order) return null;
    // SECURITY: verify this order belongs to the current tenant
    if (order.companyId !== tenantId) return null;

    const customer = order.customerId ? await ctx.db.get(order.customerId) : null;
    const warehouse = await ctx.db.get(order.warehouseId);
    const rawItems = await ctx.db
      .query("salesOrderItems")
      .withIndex("by_order", (q) => q.eq("orderId", args.id))
      .collect();
    const items = await Promise.all(
      rawItems.map(async (item) => {
        const product = await ctx.db.get(item.productId);
        const unit = await ctx.db.get(item.unitId);
        return {
          ...item,
          productName: product?.name ?? "—",
          productSku: product?.sku ?? "—",
          unitName: unit?.shortName ?? "—",
        };
      })
    );
    const payments = await ctx.db
      .query("customerPayments")
      .withIndex("by_order", (q) => q.eq("orderId", args.id))
      .collect();
    return {
      ...order,
      customerName: customer?.name ?? "Anonim",
      warehouseName: warehouse?.name ?? "—",
      balance: order.totalAmount - order.paidAmount,
      items,
      payments,
    };
  },
});

export const getStats = query({
  args: {},
  handler: async (ctx, _args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return { totalThisMonth: 0, countThisMonth: 0, pendingPayment: 0, todayCount: 0, totalDebt: 0 };
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = today.slice(0, 7) + "-01";
    // Strict tenant filter at DB level
    const all = await ctx.db.query("salesOrders")
      .filter((fq) => fq.eq(fq.field("companyId"), tenantId))
      .order("desc").take(500);
    const thisMonth = all.filter((o) => o.orderDate >= monthStart);

    return {
      totalThisMonth: thisMonth.reduce((s, o) => s + o.totalAmount, 0),
      countThisMonth: thisMonth.length,
      pendingPayment: all.filter((o) => o.totalAmount > o.paidAmount && !["cancelled", "returned"].includes(o.status)).length,
      todayCount: all.filter((o) => o.orderDate === today).length,
      totalDebt: all.reduce((s, o) => s + Math.max(0, o.totalAmount - o.paidAmount), 0),
    };
  },
});

// ── create ────────────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    customerId: v.optional(v.id("customers")),
    warehouseId: v.id("warehouses"),
    orderDate: v.string(),
    deliveryDate: v.optional(v.string()),
    currency: v.optional(v.string()),
    exchangeRate: v.optional(v.number()),
    notes: v.optional(v.string()),
    isPOS: v.optional(v.boolean()),
    posShiftId: v.optional(v.id("posShifts")),
    items: v.array(v.object({
      productId: v.id("products"),
      unitId: v.id("units"),
      qty: v.number(),
      unitPrice: v.number(),
      taxRate: v.number(),
      discountPercent: v.number(),
    })),
  },
  handler: async (ctx, args): Promise<Id<"salesOrders">> => {
    await requirePermission(ctx, "sales.create");
    const tenantId = await requireTenantAccessForWrite(ctx);

    // SECURITY: verify the warehouse belongs to this tenant
    const warehouse = await ctx.db.get(args.warehouseId);
    if (!warehouse || warehouse.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Ombor topilmadi" });
    }

    const number = await nextSoNumber(ctx, tenantId);

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

    const orderId = await ctx.db.insert("salesOrders", {
      number,
      customerId: args.customerId,
      warehouseId: args.warehouseId,
      status: "draft",
      orderDate: args.orderDate,
      deliveryDate: args.deliveryDate,
      currency: args.currency ?? "UZS",
      exchangeRate: args.exchangeRate ?? 1,
      subtotal,
      taxAmount,
      discountAmount,
      totalAmount: subtotal + taxAmount,
      paidAmount: 0,
      notes: args.notes,
      isPOS: args.isPOS ?? false,
      posShiftId: args.posShiftId,
      companyId: tenantId,
    });

    for (const item of lineItems) {
      const stock = await ctx.db
        .query("stockLevels")
        .withIndex("by_product_warehouse", (q) =>
          q.eq("productId", item.productId).eq("warehouseId", args.warehouseId)
        )
        .unique();
      const costPrice = stock?.avgCostPrice ?? 0;

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
    }

    return orderId;
  },
});

// ── confirm + ship ─────────────────────────────────────────────────────────────

export const confirm = mutation({
  args: { id: v.id("salesOrders") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales.approve");
    const { order } = await loadOwnOrder(ctx, args.id);
    if (order.status !== "draft") {
      throw new ConvexError({ message: "Faqat qoralamani tasdiqlanadi", code: "BAD_REQUEST" });
    }
    await ctx.db.patch(args.id, { status: "confirmed" });
  },
});

export const ship = mutation({
  args: { id: v.id("salesOrders") },
  handler: async (ctx, args): Promise<void> => {
    await requirePermission(ctx, "sales.approve");
    const { order, tenantId } = await loadOwnOrder(ctx, args.id);
    if (!["confirmed"].includes(order.status)) {
      throw new ConvexError({ message: "Faqat tasdiqlangan buyurtma jo'natiladi", code: "BAD_REQUEST" });
    }

    const items = await ctx.db
      .query("salesOrderItems")
      .withIndex("by_order", (q) => q.eq("orderId", args.id))
      .collect();

    const today = new Date().toISOString().slice(0, 10);
    let totalCogs = 0;

    for (const item of items) {
      const stock = await ctx.db
        .query("stockLevels")
        .withIndex("by_product_warehouse", (q) =>
          q.eq("productId", item.productId).eq("warehouseId", order.warehouseId)
        )
        .unique();

      if (!stock) throw new ConvexError({ message: "Omborda mahsulot topilmadi", code: "BAD_REQUEST" });
      if (stock.quantity < item.qty) {
        throw new ConvexError({ message: "Omborda yetarli mahsulot yo'q", code: "BAD_REQUEST" });
      }

      await ctx.db.patch(stock._id, { quantity: stock.quantity - item.qty });

      const unit = await ctx.db
        .query("units")
        .filter((q) => q.eq(q.field("isBase"), true))
        .first();

      await ctx.db.insert("stockMovements", {
        type: "issue",
        productId: item.productId,
        warehouseId: order.warehouseId,
        quantity: -item.qty,
        unitId: item.unitId ?? (unit?._id as Id<"units">),
        costPrice: item.costPrice,
        referenceId: order._id,
        referenceType: "sale",
        date: today,
        companyId: tenantId,
      });

      totalCogs += item.costPrice * item.qty;
    }

    if (order.customerId) {
      const customer = await ctx.db.get(order.customerId);
      if (customer) {
        await ctx.db.patch(order.customerId, {
          totalPurchased: customer.totalPurchased + order.totalAmount,
          totalDebt: customer.totalDebt + (order.totalAmount - order.paidAmount),
        });
      }
    }

    await ctx.db.patch(args.id, { status: "shipped" });

    // ── Journal entry: Revenue + COGS (perpetual inventory) ─────────────────
    const jeLines = await buildSaleShipJELines(
      ctx, tenantId, order.totalAmount, totalCogs, order.isPOS,
    );
    if (jeLines) {
      await createJournalEntry(ctx, {
        companyId: tenantId,
        date: today,
        description: `Sotuv: ${order.number}`,
        referenceType: "sale_ship",
        referenceId: args.id,
        lines: jeLines,
      });
    }

    // ── For cash/POS sales: also record cash account income ───────────────────
    if (order.isPOS && order.paidAmount > 0) {
      await recordCashTransaction(ctx, {
        companyId: tenantId,
        cashAccountId: null,
        type: "in",
        amount: order.paidAmount,
        description: `POS sotuv: ${order.number}`,
        date: today,
        referenceType: "sale_payment",
        referenceId: `pos-${args.id}`,
        category: "sales",
      });
    }

    await writeAuditLog(ctx, {
      action: "sale.ship",
      resource: "salesOrders",
      resourceId: args.id,
      details: JSON.stringify({ amount: order.totalAmount, cogs: totalCogs }),
      companyId: tenantId,
    });
  },
});

export const cancel = mutation({
  args: { id: v.id("salesOrders") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales.cancel");
    const { order } = await loadOwnOrder(ctx, args.id);
    if (order.status === "shipped") {
      throw new ConvexError({ message: "Jo'natilgan buyurtma bekor qilinmaydi", code: "BAD_REQUEST" });
    }
    await ctx.db.patch(args.id, { status: "cancelled" });
  },
});

// ── payment ───────────────────────────────────────────────────────────────────

export const recordPayment = mutation({
  args: {
    orderId: v.id("salesOrders"),
    amount: v.number(),
    method: v.union(v.literal("cash"), v.literal("card"), v.literal("bank"), v.literal("transfer")),
    reference: v.optional(v.string()),
    notes: v.optional(v.string()),
    cashAccountId: v.optional(v.id("cashAccounts")),
  },
  handler: async (ctx, args): Promise<void> => {
    await requirePermission(ctx, "finance.manage");
    const { order, tenantId } = await loadOwnOrder(ctx, args.orderId);

    // IDEMPOTENCY: skip if reference already recorded for this order
    if (args.reference) {
      const dup = await ctx.db
        .query("customerPayments")
        .withIndex("by_company", (q) => q.eq("companyId", tenantId))
        .filter((q) => q.eq(q.field("reference"), args.reference!))
        .first();
      if (dup) return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const paymentId = await ctx.db.insert("customerPayments", {
      customerId: order.customerId,
      orderId: args.orderId,
      amount: args.amount,
      currency: order.currency,
      exchangeRate: order.exchangeRate,
      paymentDate: today,
      method: args.method,
      reference: args.reference,
      notes: args.notes,
      cashAccountId: args.cashAccountId,
      companyId: tenantId,
    });

    const newPaid = order.paidAmount + args.amount;
    const isFullyPaid = newPaid >= order.totalAmount;

    await ctx.db.patch(args.orderId, {
      paidAmount: newPaid,
      status: isFullyPaid && order.status === "shipped" ? "delivered" : order.status,
    });

    if (order.customerId) {
      const customer = await ctx.db.get(order.customerId);
      if (customer) {
        await ctx.db.patch(order.customerId, {
          totalDebt: Math.max(0, customer.totalDebt - args.amount),
        });
      }
    }

    // ── Cash account: record incoming payment ─────────────────────────────────
    const refId = `customer-payment-${paymentId}`;
    await recordCashTransaction(ctx, {
      companyId: tenantId,
      cashAccountId: args.cashAccountId ?? null,
      type: "in",
      amount: args.amount,
      description: `Mijoz to'lovi: ${order.number}`,
      date: today,
      referenceType: "sale_payment",
      referenceId: refId,
      category: "sales",
    });

    // ── Journal entry: DR Cash / CR Receivable (only for credit sales) ────────
    // POS sales already recorded revenue+cash at shipment; skip to avoid double entry
    if (!order.isPOS) {
      const jeLines = await buildCustomerPaymentJELines(ctx, tenantId, args.amount, args.method);
      if (jeLines) {
        const jeId = await createJournalEntry(ctx, {
          companyId: tenantId,
          date: today,
          description: `Mijoz to'lovi: ${order.number}`,
          referenceType: "sale_payment",
          referenceId: refId,
          lines: jeLines,
        });
        await ctx.db.patch(paymentId, { journalEntryId: jeId });
      }
    }

    await writeAuditLog(ctx, {
      action: "sale.payment",
      resource: "salesOrders",
      resourceId: args.orderId,
      details: JSON.stringify({ amount: args.amount, method: args.method }),
      companyId: tenantId,
    });
  },
});
