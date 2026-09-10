/**
 * Notifications backend — queries, mutations, and smart-alert generator.
 *
 * SECURITY MODEL:
 * - All notifications are tenant-scoped: companyId is always set server-side
 * - markRead/remove verify ownership before patching/deleting
 * - create requires authentication
 * - generateSmartAlerts scans per-tenant, not globally
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query, internalMutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { getTenantId, requireTenantAccessForWrite } from "./tenant.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getCurrentUserId(ctx: QueryCtx | MutationCtx): Promise<Id<"users"> | null> {
  const authUserId = await getAuthUserId(ctx);
  if (!authUserId) return null;
  const user = await ctx.db.get("users", authUserId);
  return user?._id ?? null;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/** Fetch notifications for the current user+company, newest first. */
export const list = query({
  args: {
    limit: v.optional(v.number()),
    unreadOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Array<{
    _id: Id<"notifications">;
    _creationTime: number;
    userId?: Id<"users">;
    type: string;
    title: string;
    message: string;
    severity: string;
    isRead: boolean;
    isGlobal: boolean;
    relatedId?: string;
    relatedType?: string;
    link?: string;
    createdAt: string;
    companyId?: Id<"companies">;
  }>> => {
    const tenantId = await getTenantId(ctx);
    const userId = await getCurrentUserId(ctx);
    const limit = args.limit ?? 50;

    if (!tenantId && !userId) return [];

    // Global notifications scoped to this company
    const globalNotifs = tenantId
      ? await ctx.db
          .query("notifications")
          .withIndex("by_company_global", (q) => q.eq("companyId", tenantId).eq("isGlobal", true))
          .order("desc")
          .take(limit)
      : [];

    // User-specific notifications
    let userNotifs: typeof globalNotifs = [];
    if (userId) {
      const allUserNotifs = await ctx.db
        .query("notifications")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .order("desc")
        .take(limit);
      // Only show user notifications from the current company
      userNotifs = tenantId
        ? allUserNotifs.filter((n) => n.companyId === tenantId)
        : allUserNotifs;
    }

    const all = [...globalNotifs, ...userNotifs].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt)
    );
    const filtered = args.unreadOnly ? all.filter((n) => !n.isRead) : all;
    return filtered.slice(0, limit);
  },
});

/** Count of unread notifications for the current user+company. */
export const unreadCount = query({
  args: {},
  handler: async (ctx): Promise<number> => {
    const tenantId = await getTenantId(ctx);
    const userId = await getCurrentUserId(ctx);

    if (!tenantId && !userId) return 0;

    const globalUnread = tenantId
      ? await ctx.db
          .query("notifications")
          .withIndex("by_company_global", (q) => q.eq("companyId", tenantId).eq("isGlobal", true))
          .filter((q) => q.eq(q.field("isRead"), false))
          .take(100)
      : [];

    if (!userId) return globalUnread.length;

    const userUnread = await ctx.db
      .query("notifications")
      .withIndex("by_user_read", (q) => q.eq("userId", userId).eq("isRead", false))
      .take(100);
    // Filter to current company
    const companyUserUnread = tenantId
      ? userUnread.filter((n) => n.companyId === tenantId)
      : userUnread;

    return globalUnread.length + companyUserUnread.length;
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

/** Mark a single notification as read — verify ownership. */
export const markRead = mutation({
  args: { id: v.id("notifications") },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    const tenantId = await getTenantId(ctx);
    if (!userId && !tenantId) {
      throw new ConvexError({ code: "UNAUTHENTICATED", message: "Tizimga kirish talab etiladi" });
    }

    const notif = await ctx.db.get(args.id);
    if (!notif) throw new ConvexError({ code: "NOT_FOUND", message: "Topilmadi" });

    // Ownership: must belong to this user or this company
    const belongsToUser = notif.userId && notif.userId === userId;
    const belongsToCompany = notif.isGlobal && notif.companyId && notif.companyId === tenantId;
    if (!belongsToUser && !belongsToCompany) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Ruxsat etilmagan" });
    }

    await ctx.db.patch(args.id, { isRead: true });
  },
});

/** Mark ALL notifications (global + user's own) as read. */
export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getCurrentUserId(ctx);
    const tenantId = await getTenantId(ctx);

    if (tenantId) {
      const globals = await ctx.db
        .query("notifications")
        .withIndex("by_company_global", (q) => q.eq("companyId", tenantId).eq("isGlobal", true))
        .filter((q) => q.eq(q.field("isRead"), false))
        .take(200);
      for (const n of globals) await ctx.db.patch(n._id, { isRead: true });
    }

    if (userId) {
      const userNotifs = await ctx.db
        .query("notifications")
        .withIndex("by_user_read", (q) => q.eq("userId", userId).eq("isRead", false))
        .take(200);
      for (const n of userNotifs) {
        if (!tenantId || n.companyId === tenantId) {
          await ctx.db.patch(n._id, { isRead: true });
        }
      }
    }
  },
});

/** Delete a single notification — verify ownership. */
export const remove = mutation({
  args: { id: v.id("notifications") },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    const tenantId = await getTenantId(ctx);
    if (!userId && !tenantId) {
      throw new ConvexError({ code: "UNAUTHENTICATED", message: "Tizimga kirish talab etiladi" });
    }

    const notif = await ctx.db.get(args.id);
    if (!notif) throw new ConvexError({ code: "NOT_FOUND", message: "Topilmadi" });

    const belongsToUser = notif.userId && notif.userId === userId;
    const belongsToCompany = notif.isGlobal && notif.companyId && notif.companyId === tenantId;
    if (!belongsToUser && !belongsToCompany) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Ruxsat etilmagan" });
    }

    await ctx.db.delete(args.id);
  },
});

/** Clear all read notifications (housekeeping). */
export const clearRead = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getCurrentUserId(ctx);
    const tenantId = await getTenantId(ctx);

    if (tenantId) {
      const globals = await ctx.db
        .query("notifications")
        .withIndex("by_company_global", (q) => q.eq("companyId", tenantId).eq("isGlobal", true))
        .filter((q) => q.eq(q.field("isRead"), true))
        .take(500);
      for (const n of globals) await ctx.db.delete(n._id);
    }

    if (userId) {
      const own = await ctx.db
        .query("notifications")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .filter((q) => q.eq(q.field("isRead"), true))
        .take(500);
      for (const n of own) {
        if (!tenantId || n.companyId === tenantId) await ctx.db.delete(n._id);
      }
    }
  },
});

/** Create a notification — requires authentication, companyId derived server-side. */
export const create = mutation({
  args: {
    type: v.union(
      v.literal("low_stock"), v.literal("expiring_soon"), v.literal("pending_approval"),
      v.literal("overdue_payment"), v.literal("leave_request"), v.literal("po_received"),
      v.literal("production_complete"), v.literal("system"),
    ),
    title: v.string(),
    message: v.string(),
    severity: v.union(v.literal("info"), v.literal("warning"), v.literal("error"), v.literal("success")),
    isGlobal: v.optional(v.boolean()),
    userId: v.optional(v.id("users")),
    relatedId: v.optional(v.string()),
    relatedType: v.optional(v.string()),
    link: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // SECURITY: require authentication to create notifications
    const tenantId = await requireTenantAccessForWrite(ctx);
    await ctx.db.insert("notifications", {
      type: args.type,
      title: args.title,
      message: args.message,
      severity: args.severity,
      isRead: false,
      isGlobal: args.isGlobal ?? true,
      userId: args.userId,
      relatedId: args.relatedId,
      relatedType: args.relatedType,
      link: args.link,
      createdAt: new Date().toISOString(),
      companyId: tenantId,
    });
  },
});

// ─── Smart Alert Generator (internal mutation) ────────────────────────────────

/**
 * Scans business data for the given company and creates tenant-scoped notifications.
 * Must be called with a companyId to scope all scans.
 */
export const generateSmartAlerts = internalMutation({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const tenantId = args.companyId;
    const now = new Date();
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();

    async function alreadyExists(type: string, relatedId: string) {
      const recent = await ctx.db
        .query("notifications")
        .withIndex("by_company_global", (q) => q.eq("companyId", tenantId).eq("isGlobal", true))
        .filter((q) =>
          q.and(
            q.eq(q.field("type"), type),
            q.eq(q.field("relatedId"), relatedId),
            q.gt(q.field("createdAt"), sixHoursAgo),
          )
        )
        .first();
      return !!recent;
    }

    const insertNotif = async (n: {
      type: "low_stock" | "expiring_soon" | "pending_approval" | "overdue_payment" | "leave_request" | "po_received" | "production_complete" | "system";
      title: string;
      message: string;
      severity: "info" | "warning" | "error" | "success";
      relatedId?: string;
      relatedType?: string;
      link?: string;
    }) => {
      await ctx.db.insert("notifications", {
        ...n,
        isRead: false,
        isGlobal: true,
        createdAt: new Date().toISOString(),
        companyId: tenantId,
      });
    };

    // ── 1. Low stock — scoped to this company ─────────────────────────────────
    const stockLevels = await ctx.db.query("stockLevels")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .take(500);
    for (const sl of stockLevels) {
      const product = await ctx.db.get(sl.productId);
      if (!product || !product.isActive || product.companyId !== tenantId) continue;
      if (sl.quantity <= product.minStock && sl.quantity >= 0) {
        const relatedId = sl.productId;
        if (await alreadyExists("low_stock", relatedId)) continue;
        await insertNotif({
          type: "low_stock",
          title: "Kam zaxira",
          message: `${product.name}: ${sl.quantity} (minimal: ${product.minStock})`,
          severity: sl.quantity === 0 ? "error" : "warning",
          relatedId,
          relatedType: "products",
          link: "/uz/warehouse",
        });
      }
    }

    // ── 2. Expiring batches — scoped to this company ──────────────────────────
    const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      .toISOString().split("T")[0];
    const today = now.toISOString().split("T")[0];

    const batches = await ctx.db
      .query("batches")
      .withIndex("by_expiry")
      .filter((q) =>
        q.and(
          q.neq(q.field("expiryDate"), undefined),
          q.lte(q.field("expiryDate"), thirtyDaysLater),
          q.gte(q.field("expiryDate"), today),
          q.eq(q.field("companyId"), tenantId),
        )
      )
      .take(100);

    for (const batch of batches) {
      const relatedId = batch._id;
      if (await alreadyExists("expiring_soon", relatedId)) continue;
      const product = await ctx.db.get(batch.productId);
      if (!product) continue;
      const daysLeft = Math.ceil(
        (new Date(batch.expiryDate!).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
      await insertNotif({
        type: "expiring_soon",
        title: "Muddati tugayapti",
        message: `${product.name} (Partiya: ${batch.batchNumber}) — ${daysLeft} kun qoldi`,
        severity: daysLeft <= 7 ? "error" : "warning",
        relatedId,
        relatedType: "batches",
        link: "/uz/products",
      });
    }

    // ── 3. Overdue purchase orders — scoped to this company ───────────────────
    const overduePOs = await ctx.db
      .query("purchaseOrders")
      .withIndex("by_company_status", (q) => q.eq("companyId", tenantId).eq("status", "confirmed"))
      .take(100);

    for (const po of overduePOs) {
      if (!po.expectedDate || po.expectedDate >= today) continue;
      const relatedId = po._id;
      if (await alreadyExists("overdue_payment", relatedId)) continue;
      await insertNotif({
        type: "overdue_payment",
        title: "Muddati o'tgan buyurtma",
        message: `Xarid buyurtmasi ${po.number} — kutilgan sana: ${po.expectedDate}`,
        severity: "warning",
        relatedId,
        relatedType: "purchaseOrders",
        link: "/uz/purchase",
      });
    }

    // Overdue customer payments — scoped to this company
    const overdueOrders = await ctx.db
      .query("salesOrders")
      .withIndex("by_company_status", (q) => q.eq("companyId", tenantId).eq("status", "delivered"))
      .take(200);

    for (const so of overdueOrders) {
      if (so.isPOS) continue;
      const outstanding = so.totalAmount - so.paidAmount;
      if (outstanding <= 0) continue;
      if (!so.deliveryDate || so.deliveryDate >= today) continue;
      const relatedId = so._id;
      if (await alreadyExists("overdue_payment", relatedId)) continue;
      await insertNotif({
        type: "overdue_payment",
        title: "Muddati o'tgan to'lov",
        message: `Sotuv ${so.number} — qoldiq: ${Math.round(outstanding).toLocaleString()} so'm`,
        severity: "warning",
        relatedId,
        relatedType: "salesOrders",
        link: "/uz/sales",
      });
    }

    // ── 4. Pending leave requests — scoped to this company ────────────────────
    const pendingLeaves = await ctx.db
      .query("leaves")
      .withIndex("by_company_status", (q) => q.eq("companyId", tenantId).eq("status", "pending"))
      .take(50);

    for (const leave of pendingLeaves) {
      const relatedId = leave._id;
      if (await alreadyExists("leave_request", relatedId)) continue;
      const employee = await ctx.db.get(leave.employeeId);
      await insertNotif({
        type: "leave_request",
        title: "Ta'til so'rovi",
        message: `${employee?.name ?? "Xodim"} — ${leave.startDate} dan ${leave.endDate} gacha (${leave.days} kun)`,
        severity: "info",
        relatedId,
        relatedType: "leaves",
        link: "/uz/hr",
      });
    }

    // ── 5. Pending expense approvals — scoped to this company ─────────────────
    const pendingExpenses = await ctx.db
      .query("expenses")
      .withIndex("by_company_status", (q) => q.eq("companyId", tenantId).eq("status", "pending"))
      .take(50);

    for (const exp of pendingExpenses) {
      const relatedId = exp._id;
      if (await alreadyExists("pending_approval", relatedId)) continue;
      await insertNotif({
        type: "pending_approval",
        title: "Tasdiqlash kutilmoqda",
        message: `Xarajat ${exp.number}: ${exp.description} — ${Math.round(exp.amount).toLocaleString()} so'm`,
        severity: "info",
        relatedId,
        relatedType: "expenses",
        link: "/uz/finance",
      });
    }
  },
});

/** Public trigger — passes authenticated company's tenantId to internal alert generator. */
export const triggerSmartAlerts = mutation({
  args: {},
  handler: async (ctx) => {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) return; // silently skip for unauthenticated
    const user = await ctx.db.get("users", authUserId);
    if (!user?.activeCompanyId) return;

    await ctx.scheduler.runAfter(0, internal.notifications.generateSmartAlerts, {
      companyId: user.activeCompanyId,
    });
  },
});
