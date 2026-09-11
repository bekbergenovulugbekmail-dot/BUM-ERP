import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { DEFAULT_ROLES } from "../src/lib/permissions.ts";
import {
  requireTenantAccess,
  getTenantId,
  requireAuth,
  requireAccessForWrite,
  assertCanGrant,
  assertKnownPermissions,
  isFullAccessRole,
  writeAuditLog,
} from "./tenant.ts";

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
    // SECURITY: previously any member could create roles with arbitrary permissions
    const access = await requireAccessForWrite(ctx, "roles.manage");

    // Full access is granted by role NAME — such names cannot be created
    if (isFullAccessRole(args.name)) {
      throw new ConvexError({ code: "FORBIDDEN", message: `"${args.name}" nomli rol yaratib bo'lmaydi` });
    }
    assertKnownPermissions(args.permissions);
    assertCanGrant(access, args.permissions);

    const existing = await ctx.db
      .query("roles")
      .withIndex("by_company_name", (q) => q.eq("companyId", access.tenantId).eq("name", args.name))
      .first();
    if (existing) {
      throw new ConvexError({ code: "CONFLICT", message: "Bu nomda rol mavjud" });
    }

    const roleId = await ctx.db.insert("roles", {
      ...args,
      isSystem: false,
      isActive: true,
      memberCount: 0,
      companyId: access.tenantId,
    });

    await writeAuditLog(ctx, {
      userId: access.user._id,
      userName: access.user.name,
      action: "ROLE_CREATED",
      resource: "roles",
      resourceId: roleId,
      details: JSON.stringify({ name: args.name, permissions: args.permissions }),
      severity: "info",
      companyId: access.tenantId,
    });
    return roleId;
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
    const access = await requireAccessForWrite(ctx, "roles.manage");
    const role = await ctx.db.get(args.id);
    if (!role) throw new ConvexError({ code: "NOT_FOUND", message: "Rol topilmadi" });

    // SECURITY: a GLOBAL role (no companyId) used to be editable by any member,
    // which changed permissions for EVERY company. Only this company's roles now.
    if (role.companyId !== access.tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Ruxsat etilmagan" });
    }
    if (isFullAccessRole(role.name)) {
      throw new ConvexError({ code: "FORBIDDEN", message: "To'liq huquqli rolni o'zgartirib bo'lmaydi" });
    }

    const renaming = args.name !== undefined && args.name !== role.name;
    if (renaming) {
      if (role.isSystem) {
        throw new ConvexError({ code: "FORBIDDEN", message: "Tizim rolining nomini o'zgartirib bo'lmaydi" });
      }
      if (isFullAccessRole(args.name)) {
        throw new ConvexError({ code: "FORBIDDEN", message: `"${args.name}" nomli rol yaratib bo'lmaydi` });
      }
      const clash = await ctx.db
        .query("roles")
        .withIndex("by_company_name", (q) => q.eq("companyId", access.tenantId).eq("name", args.name!))
        .first();
      if (clash) throw new ConvexError({ code: "CONFLICT", message: "Bu nomda rol mavjud" });
    }

    let added: string[] = [];
    if (args.permissions) {
      assertKnownPermissions(args.permissions);
      added = args.permissions.filter((p) => !role.permissions.includes(p));
      // No self-escalation: cannot add permissions the caller doesn't hold
      assertCanGrant(access, added);
    }

    const { id, ...rest } = args;
    await ctx.db.patch(id, rest);

    // Memberships reference roles by NAME — keep them in sync on rename
    if (renaming) {
      const members = await ctx.db
        .query("companyMembers")
        .withIndex("by_company", (q) => q.eq("companyId", access.tenantId))
        .collect();
      for (const m of members) {
        if (m.companyRole === role.name) await ctx.db.patch(m._id, { companyRole: args.name! });
      }
    }

    await writeAuditLog(ctx, {
      userId: access.user._id,
      userName: access.user.name,
      action: "ROLE_UPDATED",
      resource: "roles",
      resourceId: id,
      details: JSON.stringify({ name: args.name ?? role.name, added, permissions: args.permissions }),
      severity: "warning",
      companyId: access.tenantId,
    });
  },
});

export const deleteRole = mutation({
  args: { id: v.id("roles") },
  handler: async (ctx, args) => {
    const access = await requireAccessForWrite(ctx, "roles.manage");
    const role = await ctx.db.get(args.id);
    if (!role) throw new ConvexError({ code: "NOT_FOUND", message: "Rol topilmadi" });
    // SECURITY: global roles (no companyId) used to be deletable by any member
    if (role.companyId !== access.tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Ruxsat etilmagan" });
    }
    if (role.isSystem) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Tizim rollarini o'chirish mumkin emas" });
    }

    const members = await ctx.db
      .query("companyMembers")
      .withIndex("by_company", (q) => q.eq("companyId", access.tenantId))
      .collect();
    const inUse = members.filter((m) => m.companyRole === role.name).length;
    if (inUse > 0) {
      throw new ConvexError({
        code: "CONFLICT",
        message: `Bu rolda ${inUse} ta xodim bor — avval ularning rolini o'zgartiring`,
      });
    }

    await ctx.db.delete(args.id);
    await writeAuditLog(ctx, {
      userId: access.user._id,
      userName: access.user.name,
      action: "ROLE_DELETED",
      resource: "roles",
      resourceId: args.id,
      details: JSON.stringify({ name: role.name }),
      severity: "warning",
      companyId: access.tenantId,
    });
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
    // SECURITY: previously any member could give themselves any role (Superadmin too)
    const access = await requireAccessForWrite(ctx, "users.manage");
    if (args.userId === access.user._id) {
      throw new ConvexError({ code: "FORBIDDEN", message: "O'z rolingizni o'zgartira olmaysiz" });
    }

    // Verify user is a member of this company
    const membership = await ctx.db
      .query("companyMembers")
      .withIndex("by_company_user", (q) =>
        q.eq("companyId", access.tenantId).eq("userId", args.userId),
      )
      .first();
    if (!membership) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Foydalanuvchi bu kompaniyada emas" });
    }
    if (isFullAccessRole(membership.companyRole)) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Kompaniya egasining rolini o'zgartirib bo'lmaydi" });
    }

    const user = await ctx.db.get(args.userId);
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "Foydalanuvchi topilmadi" });
    const role = await ctx.db.get(args.roleId);
    if (!role) throw new ConvexError({ code: "NOT_FOUND", message: "Rol topilmadi" });

    if (role.companyId && role.companyId !== access.tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Ruxsat etilmagan" });
    }
    if (isFullAccessRole(role.name)) {
      throw new ConvexError({ code: "FORBIDDEN", message: `"${role.name}" rolini berib bo'lmaydi` });
    }
    assertCanGrant(access, role.permissions);

    if (user.roleId) {
      const oldRole = await ctx.db.get(user.roleId);
      if (oldRole) await ctx.db.patch(user.roleId, { memberCount: Math.max(0, oldRole.memberCount - 1) });
    }
    await ctx.db.patch(args.roleId, { memberCount: role.memberCount + 1 });
    await ctx.db.patch(args.userId, { roleId: args.roleId, role: role.name });

    await writeAuditLog(ctx, {
      userId: access.user._id,
      userName: access.user.name,
      action: "USER_ROLE_CHANGED",
      resource: "users",
      resourceId: args.userId,
      details: JSON.stringify({ role: role.name }),
      severity: "warning",
      companyId: access.tenantId,
    });
  },
});

export const toggleUserActive = mutation({
  args: { userId: v.id("users"), isActive: v.boolean() },
  handler: async (ctx, args) => {
    // SECURITY: previously any member could block anyone in the company, the owner too
    const access = await requireAccessForWrite(ctx, "users.manage");
    if (args.userId === access.user._id) {
      throw new ConvexError({ code: "FORBIDDEN", message: "O'z hisobingizni bloklay olmaysiz" });
    }

    // Verify user is a member of this company
    const membership = await ctx.db
      .query("companyMembers")
      .withIndex("by_company_user", (q) =>
        q.eq("companyId", access.tenantId).eq("userId", args.userId),
      )
      .first();
    if (!membership) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Foydalanuvchi bu kompaniyada emas" });
    }
    if (isFullAccessRole(membership.companyRole)) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Kompaniya egasini bloklab bo'lmaydi" });
    }
    const target = await ctx.db.get(args.userId);
    if (target?.isPlatformAdmin) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Platforma adminini bloklab bo'lmaydi" });
    }

    await ctx.db.patch(args.userId, { isActive: args.isActive });
    await writeAuditLog(ctx, {
      userId: access.user._id,
      userName: access.user.name,
      action: args.isActive ? "USER_ACTIVATED" : "USER_BLOCKED",
      resource: "users",
      resourceId: args.userId,
      severity: "warning",
      companyId: access.tenantId,
    });
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

/**
 * SECURITY: was a public mutation — any signed-in user could forge audit entries.
 * The frontend never called it; now internal-only.
 */
export const createAuditLog = internalMutation({
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
