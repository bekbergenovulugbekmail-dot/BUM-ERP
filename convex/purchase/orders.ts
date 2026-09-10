import { v, ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server.js";
import type { Id } from "../_generated/dataModel.d.ts";
import { getTenantId, requireTenantAccess, requireTenantAccessForWrite, requirePermission, writeAuditLog } from "../tenant.ts";
import type { QueryCtx, MutationCtx } from "../_generated/server.d.ts";
import {
  createJournalEntry, recordCashTransaction,
  buildSupplierPaymentJELines, buildGoodsReceiptJELines,
} from "../finance/journalHelper.ts";

function padNum(n: number) { return String(n).padStart(4, "0"); }

async function nextPoNumber(ctx: QueryCtx | MutationCtx, tenantId: Id<"companies">) {
  const year = new Date().getFullYear();
  const prefix = `PO-${year}-`;
  const all = await ctx.db.query("purchaseOrders")
    .withIndex("by_company", (q) => q.eq("companyId", tenantId))
    .order("desc")
    .filter((q) => q.gte(q.field("number"), prefix))
    .take(1);
  const last = all[0];
  const seq = last && last.number.startsWith(prefix)
    ? parseInt(last.number.split("-")[2] ?? "0") + 1
    : 1;
  return `PO-${year}-${padNum(seq)}`;
}

export const list = query({
  args: {
    supplierId: v.optional(v.id("suppliers")),
    status: v.optional(v.union(
      v.literal("draft"), v.literal("confirmed"), v.literal("partial"),
      v.literal("received"), v.literal("invoiced"), v.literal("paid"), v.literal("cancelled"),
    )),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];

    let orders;
    if (args.supplierId) {
      // Verify supplier belongs to this company
      const sup = await ctx.db.get(args.supplierId);
      if (!sup || sup.companyId !== tenantId) return [];

      orders = await ctx.db.query("purchaseOrders")
        .withIndex("by_supplier", (q) => q.eq("supplierId", args.supplierId!))
        .order("desc").take(args.limit ?? 100);
      // STRICT: no orphan fallback
      orders = orders.filter((o) => o.companyId === tenantId);
    } else if (args.status) {
      orders = await ctx.db.query("purchaseOrders")
        .withIndex("by_company_status", (q) => q.eq("companyId", tenantId).eq("status", args.status!))
        .order("desc").take(args.limit ?? 100);
    } else {
      orders = await ctx.db.query("purchaseOrders")
        .withIndex("by_company", (q) => q.eq("companyId", tenantId))
        .order("desc").take(args.limit ?? 100);
    }

    return Promise.all(orders.map(async (o) => {
      const supplier = await ctx.db.get(o.supplierId);
      const warehouse = await ctx.db.get(o.warehouseId);
      const itemCount = await ctx.db.query("purchaseOrderItems")
        .withIndex("by_order", (q) => q.eq("orderId", o._id)).collect().then((r) => r.length);
      return {
        ...o,
        supplierName: supplier?.name ?? "—",
        warehouseName: warehouse?.name ?? "—",
        itemCount,
        balance: o.totalAmount - o.paidAmount,
      };
    }));
  },
});

export const getById = query({
  args: { id: v.id("purchaseOrders") },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return null;
    const order = await ctx.db.get(args.id);
    if (!order || order.companyId !== tenantId) return null;

    const supplier = await ctx.db.get(order.supplierId);
    const warehouse = await ctx.db.get(order.warehouseId);
    const items = await ctx.db.query("purchaseOrderItems")
      .withIndex("by_order", (q) => q.eq("orderId", args.id)).collect();
    const enrichedItems = await Promise.all(items.map(async (item) => {
      const product = await ctx.db.get(item.productId);
      const unit = await ctx.db.get(item.unitId);
      return {
        ...item,
        productName: product?.name ?? "—", productSku: product?.sku ?? "—",
        unitName: unit?.shortName ?? "—", pendingQty: item.orderedQty - item.receivedQty,
      };
    }));
    const receipts = await ctx.db.query("purchaseReceipts")
      .withIndex("by_order", (q) => q.eq("orderId", args.id)).collect();
    const payments = await ctx.db.query("supplierPayments")
      .withIndex("by_order", (q) => q.eq("orderId", args.id)).collect();
    return {
      ...order,
      supplierName: supplier?.name ?? "—", supplierPhone: supplier?.phone,
      warehouseName: warehouse?.name ?? "—", items: enrichedItems,
      receipts, payments, balance: order.totalAmount - order.paidAmount,
    };
  },
});

export const create = mutation({
  args: {
    supplierId: v.id("suppliers"), warehouseId: v.id("warehouses"),
    orderDate: v.string(), expectedDate: v.optional(v.string()),
    currency: v.string(), exchangeRate: v.number(), notes: v.optional(v.string()),
    items: v.array(v.object({
      productId: v.id("products"), unitId: v.id("units"),
      orderedQty: v.number(), unitPrice: v.number(),
      taxRate: v.number(), discountPercent: v.number(),
    })),
  },
  handler: async (ctx, args): Promise<Id<"purchaseOrders">> => {
    await requirePermission(ctx, "purchase.create");
    const tenantId = await requireTenantAccess(ctx);

    // Verify supplier and warehouse belong to this company
    const supplier = await ctx.db.get(args.supplierId);
    if (!supplier || supplier.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Ta'minotchi topilmadi" });
    }
    const wh = await ctx.db.get(args.warehouseId);
    if (!wh || wh.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Ombor topilmadi" });
    }

    const number = await nextPoNumber(ctx, tenantId);
    let subtotal = 0, taxAmount = 0, discountAmount = 0;
    const lineItems = args.items.map((item) => {
      const gross = item.orderedQty * item.unitPrice;
      const disc = gross * (item.discountPercent / 100);
      const net = gross - disc;
      const tax = net * (item.taxRate / 100);
      subtotal += net; taxAmount += tax; discountAmount += disc;
      return { ...item, lineTotal: net + tax };
    });
    const orderId = await ctx.db.insert("purchaseOrders", {
      number, supplierId: args.supplierId, warehouseId: args.warehouseId,
      status: "draft", orderDate: args.orderDate, expectedDate: args.expectedDate,
      currency: args.currency, exchangeRate: args.exchangeRate,
      subtotal, taxAmount, discountAmount, totalAmount: subtotal + taxAmount,
      paidAmount: 0, notes: args.notes, companyId: tenantId,
    });
    for (const item of lineItems) {
      await ctx.db.insert("purchaseOrderItems", {
        orderId, productId: item.productId, unitId: item.unitId,
        orderedQty: item.orderedQty, receivedQty: 0, unitPrice: item.unitPrice,
        taxRate: item.taxRate, discountPercent: item.discountPercent,
        lineTotal: item.lineTotal, companyId: tenantId,
      });
    }
    return orderId;
  },
});

export const confirm = mutation({
  args: { id: v.id("purchaseOrders") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "purchase.approve");
    const tenantId = await requireTenantAccessForWrite(ctx);
    const order = await ctx.db.get(args.id);
    if (!order || order.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Topilmadi" });
    }
    if (order.status !== "draft") {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Faqat qoralama tasdiqlash mumkin" });
    }
    await ctx.db.patch(args.id, { status: "confirmed" });
  },
});

export const cancel = mutation({
  args: { id: v.id("purchaseOrders"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "purchase.cancel");
    const tenantId = await requireTenantAccessForWrite(ctx);
    const order = await ctx.db.get(args.id);
    if (!order || order.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Topilmadi" });
    }
    if (["received", "paid"].includes(order.status)) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Qabul qilingan yoki to'langan buyurtmani bekor qilish mumkin emas" });
    }
    await ctx.db.patch(args.id, { status: "cancelled", notes: args.reason ?? order.notes });
  },
});

export const receiveGoods = mutation({
  args: {
    orderId: v.id("purchaseOrders"), receiptDate: v.string(), notes: v.optional(v.string()),
    items: v.array(v.object({
      orderItemId: v.id("purchaseOrderItems"), productId: v.id("products"),
      unitId: v.id("units"), receivedQty: v.number(), unitPrice: v.number(),
      batchNumber: v.optional(v.string()), expiryDate: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args): Promise<Id<"purchaseReceipts">> => {
    await requirePermission(ctx, "warehouse.receive");
    const tenantId = await requireTenantAccessForWrite(ctx);

    // STRICT: ownership check before receiving
    const order = await ctx.db.get(args.orderId);
    if (!order || order.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Buyurtma topilmadi" });
    }
    if (!["confirmed", "partial"].includes(order.status)) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Faqat tasdiqlangan buyurtmalarni qabul qilish mumkin" });
    }

    const receiptId = await ctx.db.insert("purchaseReceipts", {
      orderId: args.orderId, supplierId: order.supplierId, warehouseId: order.warehouseId,
      receiptDate: args.receiptDate, notes: args.notes, companyId: tenantId,
    });
    for (const item of args.items) {
      if (item.receivedQty <= 0) continue;

      // Verify order item belongs to this company's order
      const orderItem = await ctx.db.get(item.orderItemId);
      if (!orderItem || orderItem.companyId !== tenantId) continue;

      await ctx.db.insert("purchaseReceiptItems", {
        receiptId, orderItemId: item.orderItemId, productId: item.productId,
        unitId: item.unitId, receivedQty: item.receivedQty, unitPrice: item.unitPrice,
        batchNumber: item.batchNumber, expiryDate: item.expiryDate, companyId: tenantId,
      });
      await ctx.db.patch(item.orderItemId, { receivedQty: orderItem.receivedQty + item.receivedQty });

      const stockLevel = await ctx.db.query("stockLevels")
        .withIndex("by_product_warehouse", (q) =>
          q.eq("productId", item.productId).eq("warehouseId", order.warehouseId))
        .first();
      if (stockLevel && stockLevel.companyId === tenantId) {
        const totalCost = stockLevel.quantity * stockLevel.avgCostPrice + item.receivedQty * item.unitPrice;
        const totalQty = stockLevel.quantity + item.receivedQty;
        await ctx.db.patch(stockLevel._id, {
          quantity: totalQty,
          avgCostPrice: totalQty > 0 ? totalCost / totalQty : item.unitPrice,
        });
      } else {
        await ctx.db.insert("stockLevels", {
          productId: item.productId, warehouseId: order.warehouseId,
          quantity: item.receivedQty, reservedQty: 0, avgCostPrice: item.unitPrice,
          companyId: tenantId,
        });
      }
      await ctx.db.insert("stockMovements", {
        type: "receive", productId: item.productId, warehouseId: order.warehouseId,
        quantity: item.receivedQty, unitId: item.unitId, costPrice: item.unitPrice,
        referenceId: args.orderId, referenceType: "purchase",
        notes: `Xarid: ${order.number}`, date: args.receiptDate, companyId: tenantId,
      });
      if (item.batchNumber) {
        const product = await ctx.db.get(item.productId);
        if (product?.trackBatch && product.companyId === tenantId) {
          await ctx.db.insert("batches", {
            productId: item.productId, batchNumber: item.batchNumber,
            expiryDate: item.expiryDate, quantity: item.receivedQty,
            unitId: item.unitId, costPrice: item.unitPrice,
            warehouseId: order.warehouseId, companyId: tenantId,
          });
        }
      }
    }
    const allItems = await ctx.db.query("purchaseOrderItems")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId)).collect();
    const allReceived = allItems.every((i) => i.receivedQty >= i.orderedQty);
    const anyReceived = allItems.some((i) => i.receivedQty > 0);
    await ctx.db.patch(args.orderId, {
      status: allReceived ? "received" : anyReceived ? "partial" : "confirmed",
    });
    const receiptTotal = args.items.reduce((sum, i) => sum + i.receivedQty * i.unitPrice, 0);
    const supplier = await ctx.db.get(order.supplierId);
    // SECURITY: verify supplier belongs to this company before patching
    if (supplier && supplier.companyId === tenantId) {
      await ctx.db.patch(order.supplierId, {
        totalPurchased: supplier.totalPurchased + receiptTotal,
        totalDebt: supplier.totalDebt + receiptTotal,
      });
    }

    // ── Journal entry: DR Tovar zaxirasi / CR Kreditorlar ────────────────────
    if (receiptTotal > 0) {
      const jeLines = await buildGoodsReceiptJELines(ctx, tenantId, receiptTotal);
      if (jeLines) {
        await createJournalEntry(ctx, {
          companyId: tenantId,
          date: args.receiptDate,
          description: `Tovar qabul: ${order.number}`,
          referenceType: "goods_receipt",
          referenceId: receiptId,
          lines: jeLines,
        });
      }
    }

    return receiptId;
  },
});

export const recordPayment = mutation({
  args: {
    supplierId: v.id("suppliers"), orderId: v.optional(v.id("purchaseOrders")),
    amount: v.number(), currency: v.string(), exchangeRate: v.number(),
    paymentDate: v.string(),
    method: v.union(v.literal("cash"), v.literal("bank"), v.literal("card"), v.literal("transfer")),
    reference: v.optional(v.string()), notes: v.optional(v.string()),
    cashAccountId: v.optional(v.id("cashAccounts")),
  },
  handler: async (ctx, args): Promise<Id<"supplierPayments">> => {
    await requirePermission(ctx, "purchase.create");
    const tenantId = await requireTenantAccess(ctx);

    // SECURITY: verify supplier belongs to this company
    const supplier = await ctx.db.get(args.supplierId);
    if (!supplier || supplier.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Ta'minotchi topilmadi" });
    }

    // SECURITY: verify order belongs to this company if provided
    if (args.orderId) {
      const order = await ctx.db.get(args.orderId);
      if (!order || order.companyId !== tenantId) {
        throw new ConvexError({ code: "FORBIDDEN", message: "Buyurtma topilmadi" });
      }
    }

    // ── IDEMPOTENCY: check for duplicate payment with same reference ──────────
    if (args.reference) {
      const dup = await ctx.db
        .query("supplierPayments")
        .withIndex("by_company", (q) => q.eq("companyId", tenantId))
        .filter((q) => q.eq(q.field("reference"), args.reference!))
        .first();
      if (dup) return dup._id;
    }

    // ── 1. Record supplier payment ────────────────────────────────────────────
    const paymentId = await ctx.db.insert("supplierPayments", {
      ...args,
      cashAccountId: args.cashAccountId,
      companyId: tenantId,
    });

    // ── 2. Update purchase order paid amount ──────────────────────────────────
    if (args.orderId) {
      const order = await ctx.db.get(args.orderId);
      if (order && order.companyId === tenantId) {
        const newPaid = order.paidAmount + args.amount;
        await ctx.db.patch(args.orderId, {
          paidAmount: newPaid,
          status: newPaid >= order.totalAmount ? "paid" : order.status,
        });
      }
    }

    // ── 3. Update supplier debt ───────────────────────────────────────────────
    await ctx.db.patch(args.supplierId, {
      totalDebt: Math.max(0, supplier.totalDebt - args.amount),
    });

    // ── 4. Deduct from cash/bank account ─────────────────────────────────────
    const refId = `supplier-payment-${paymentId}`;
    await recordCashTransaction(ctx, {
      companyId: tenantId,
      cashAccountId: args.cashAccountId ?? null,
      type: "out",
      amount: args.amount,
      description: `${supplier.name} ga to'lov`,
      date: args.paymentDate,
      referenceType: "supplier_payment",
      referenceId: refId,
      category: "purchase",
    });

    // ── 5. Journal entry: DR Kreditorlar / CR Cash ────────────────────────────
    const jeLines = await buildSupplierPaymentJELines(ctx, tenantId, args.amount, args.method);
    if (jeLines) {
      const jeId = await createJournalEntry(ctx, {
        companyId: tenantId,
        date: args.paymentDate,
        description: `${supplier.name} ga to'lov`,
        referenceType: "supplier_payment",
        referenceId: refId,
        lines: jeLines,
      });
      await ctx.db.patch(paymentId, { journalEntryId: jeId });
    }

    // ── 6. Audit log ──────────────────────────────────────────────────────────
    await writeAuditLog(ctx, {
      action: "purchase.payment",
      resource: "supplierPayments",
      resourceId: paymentId,
      details: JSON.stringify({ amount: args.amount, method: args.method, supplierId: args.supplierId }),
      companyId: tenantId,
    });

    return paymentId;
  },
});
