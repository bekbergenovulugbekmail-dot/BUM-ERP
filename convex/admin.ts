import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { DEFAULT_ROLES } from "../src/lib/permissions.ts";
import { requireTenantAccess, getTenantId, requireAuth } from "./tenant.ts";

// ─── ROLES ────────────────────────────────────────────────────────────────────

export const listRoles = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await getTenantId(ctx);
    const all = await ctx.db.query("roles").collect();
    // Return company-specific roles + global system roles
    return all.filter((r) => !r.companyId || r.companyId === tenantId);
  },
});

export const seedDefaultRoles = mutation({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenantAccess(ctx);
    const existing = await ctx.db.query("roles")
      .filter((q) => q.eq(q.field("companyId"), tenantId))
      .collect();
    if (existing.length > 0) return { seeded: false };
    for (const role of DEFAULT_ROLES) {
      await ctx.db.insert("roles", {
        name: role.name,
        description: role.description,
        color: role.color,
        permissions: [...role.permissions],
        isSystem: role.isSystem,
        isActive: true,
        memberCount: 0,
        companyId: tenantId,
      });
    }
    return { seeded: true };
  },
});

export const createRole = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    permissions: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenantAccess(ctx);
    const existing = await ctx.db
      .query("roles")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .first();
    if (existing && existing.companyId === tenantId) {
      throw new ConvexError({ code: "CONFLICT", message: "Bu nomda rol mavjud" });
    }
    return ctx.db.insert("roles", {
      ...args,
      isSystem: false,
      isActive: true,
      memberCount: 0,
      companyId: tenantId,
    });
  },
});

export const updateRole = mutation({
  args: {
    id: v.id("roles"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    permissions: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenantAccess(ctx);
    const role = await ctx.db.get(args.id);
    if (!role) throw new ConvexError({ code: "NOT_FOUND", message: "Rol topilmadi" });
    if (role.companyId && role.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Ruxsat etilmagan" });
    }
    const { id, ...rest } = args;
    await ctx.db.patch(id, rest);
  },
});

export const deleteRole = mutation({
  args: { id: v.id("roles") },
  handler: async (ctx, args) => {
    const tenantId = await requireTenantAccess(ctx);
    const role = await ctx.db.get(args.id);
    if (!role) throw new ConvexError({ code: "NOT_FOUND", message: "Rol topilmadi" });
    if (role.companyId && role.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Ruxsat etilmagan" });
    }
    if (role.isSystem) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Tizim rollarini o'chirish mumkin emas" });
    }
    await ctx.db.delete(args.id);
  },
});

// ─── USERS MANAGEMENT ─────────────────────────────────────────────────────────

export const listUsers = query({
  args: {
    search: v.optional(v.string()),
    roleId: v.optional(v.id("roles")),
  },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];

    // Only list members of this company
    const memberships = await ctx.db
      .query("companyMembers")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .collect();

    const memberUserIds = new Set(memberships.map((m) => m.userId));

    const allUsers = await ctx.db.query("users").collect();
    let result = allUsers.filter((u) => memberUserIds.has(u._id));

    if (args.search) {
      const s = args.search.toLowerCase();
      result = result.filter(
        (u) => u.name?.toLowerCase().includes(s) || u.email?.toLowerCase().includes(s),
      );
    }
    if (args.roleId) {
      result = result.filter((u) => u.roleId === args.roleId);
    }

    return Promise.all(
      result.map(async (u) => {
        const role = u.roleId ? await ctx.db.get(u.roleId) : null;
        const membership = memberships.find((m) => m.userId === u._id);
        return {
          ...u,
          roleName: role?.name,
          roleColor: role?.color,
          companyRole: membership?.companyRole,
        };
      }),
    );
  },
});

export const updateUserRole = mutation({
  args: {
    userId: v.id("users"),
    roleId: v.id("roles"),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenantAccess(ctx);

    // Verify user is a member of this company
    const membership = await ctx.db
      .query("companyMembers")
      .withIndex("by_company_user", (q) =>
        q.eq("companyId", tenantId).eq("userId", args.userId),
      )
      .first();
    if (!membership) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Foydalanuvchi bu kompaniyada emas" });
    }

    const user = await ctx.db.get(args.userId);
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "Foydalanuvchi topilmadi" });
    const role = await ctx.db.get(args.roleId);
    if (!role) throw new ConvexError({ code: "NOT_FOUND", message: "Rol topilmadi" });

    if (user.roleId) {
      const oldRole = await ctx.db.get(user.roleId);
      if (oldRole) await ctx.db.patch(user.roleId, { memberCount: Math.max(0, oldRole.memberCount - 1) });
    }
    await ctx.db.patch(args.roleId, { memberCount: role.memberCount + 1 });
    await ctx.db.patch(args.userId, { roleId: args.roleId, role: role.name });
  },
});

export const toggleUserActive = mutation({
  args: { userId: v.id("users"), isActive: v.boolean() },
  handler: async (ctx, args) => {
    const tenantId = await requireTenantAccess(ctx);

    // Verify user is a member of this company
    const membership = await ctx.db
      .query("companyMembers")
      .withIndex("by_company_user", (q) =>
        q.eq("companyId", tenantId).eq("userId", args.userId),
      )
      .first();
    if (!membership) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Foydalanuvchi bu kompaniyada emas" });
    }

    await ctx.db.patch(args.userId, { isActive: args.isActive });
  },
});

// ─── AUDIT LOG ────────────────────────────────────────────────────────────────

export const listAuditLogs = query({
  args: {
    resource: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];

    const logs = await ctx.db
      .query("auditLogs")
      .withIndex("by_timestamp")
      .order("desc")
      .take(args.limit ?? 100);

    // STRICT: no orphan fallback — only this company's logs
    return logs.filter((l) => l.companyId === tenantId);
  },
});

export const createAuditLog = mutation({
  args: {
    action: v.string(),
    resource: v.string(),
    resourceId: v.optional(v.string()),
    details: v.optional(v.string()),
    severity: v.union(v.literal("info"), v.literal("warning"), v.literal("error")),
  },
  handler: async (ctx, args) => {
    const authUserId = await getAuthUserId(ctx);
    let userId = undefined;
    let userName = undefined;
    if (authUserId) {
      const user = await ctx.db.get("users", authUserId);
      userId = user?._id;
      userName = user?.name;
    }
    const tenantId = await getTenantId(ctx);
    await ctx.db.insert("auditLogs", {
      ...args,
      userId,
      userName,
      timestamp: new Date().toISOString(),
      companyId: tenantId ?? undefined,
    });
  },
});

// ─── COMPANY SETTINGS (legacy — now delegated to companies.ts) ────────────────

/** Legacy compat — returns the active user's company */
export const getCompany = query({
  args: {},
  handler: async (ctx) => {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) return null;
    const user = await ctx.db.get("users", authUserId);
    if (!user?.activeCompanyId) {
      // Fall back to default company (pre-migration)
      return ctx.db.query("companies").withIndex("by_default", (q) => q.eq("isDefault", true)).first();
    }
    return ctx.db.get(user.activeCompanyId);
  },
});

export const upsertCompany = mutation({
  args: {
    name: v.string(),
    legalName: v.optional(v.string()),
    taxId: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    website: v.optional(v.string()),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    country: v.string(),
    currency: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    if (user.activeCompanyId) {
      await ctx.db.patch(user.activeCompanyId, args);
      return user.activeCompanyId;
    }

    const existing = await ctx.db
      .query("companies")
      .withIndex("by_default", (q) => q.eq("isDefault", true))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return ctx.db.insert("companies", { ...args, isDefault: true, isActive: true });
  },
});

// ─── SYSTEM SETTINGS ──────────────────────────────────────────────────────────

export const getSettings = query({
  args: { group: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];

    if (args.group) {
      return ctx.db
        .query("settings")
        .withIndex("by_company_group", (q) => q.eq("companyId", tenantId).eq("group", args.group!))
        .collect();
    }
    return ctx.db
      .query("settings")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .collect();
  },
});

export const upsertSetting = mutation({
  args: {
    key: v.string(),
    value: v.string(),
    group: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenantAccess(ctx);
    const authUserId = await getAuthUserId(ctx);
    let userId = undefined;
    if (authUserId) {
      const user = await ctx.db.get("users", authUserId);
      userId = user?._id;
    }
    // Find existing setting scoped to this company
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_company_key", (q) => q.eq("companyId", tenantId).eq("key", args.key))
      .unique();
    const data = { ...args, updatedBy: userId, updatedAt: new Date().toISOString(), companyId: tenantId };
    if (existing) {
      await ctx.db.patch(existing._id, data);
      return existing._id;
    }
    return ctx.db.insert("settings", data);
  },
});
