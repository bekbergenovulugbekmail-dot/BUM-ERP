import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { DEFAULT_ROLES } from "../src/lib/permissions.ts";

export const updateCurrentUser = mutation({
  args: {},
  handler: async (ctx) => {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) {
      throw new ConvexError({ code: "UNAUTHENTICATED", message: "User not logged in" });
    }

    // Convex Auth foydalanuvchi yozuvini signUp paytida o'zi yaratadi.
    // Bu mutatsiya uni ERP maydonlari bilan to'ldiradi (rol, platforma admini).
    const existing = await ctx.db.get("users", authUserId);
    if (!existing) {
      throw new ConvexError({ code: "UNAUTHENTICATED", message: "User not found" });
    }

    const alreadyProvisioned = existing.isActive !== undefined;

    // Rol allaqachon berilgan bo'lsa — faqat lastSeen yangilanadi
    if (alreadyProvisioned && existing.roleId !== undefined) {
      await ctx.db.patch(existing._id, { lastSeen: new Date().toISOString() });
      return existing._id;
    }

    // Birinchi foydalanuvchi → Platform Admin + global rollarni seed qilish.
    // O'zi allaqachon jadvalda bo'lgani uchun chegara 1 ta.
    const allUsers = await ctx.db.query("users").collect();
    const isFirstUser = allUsers.length <= 1 || existing.isPlatformAdmin === true;

    // Seed global (non-company) default roles if none exist
    const rolesExist = await ctx.db.query("roles")
      .filter((q) => q.eq(q.field("companyId"), undefined))
      .first();

    if (!rolesExist) {
      for (const role of DEFAULT_ROLES) {
        await ctx.db.insert("roles", {
          name: role.name,
          description: role.description,
          color: role.color,
          permissions: [...role.permissions],
          isSystem: role.isSystem,
          isActive: true,
          memberCount: 0,
        });
      }
    }

    let roleId = undefined;
    let roleName = undefined;
    if (isFirstUser) {
      // MUHIM: by_name indeksi kompaniyaga tegishli rollarni ham qaytaradi.
      // Global (companyId yo'q) rolni aniq tanlash kerak, aks holda birinchi
      // foydalanuvchi rolsiz qolib ketadi.
      const superadminRole = await ctx.db
        .query("roles")
        .withIndex("by_name", (q) => q.eq("name", "Superadmin"))
        .filter((q) => q.eq(q.field("companyId"), undefined))
        .first();
      if (superadminRole) {
        roleId = superadminRole._id;
        roleName = "Superadmin";
        await ctx.db.patch(superadminRole._id, { memberCount: superadminRole.memberCount + 1 });
      }
    }

    await ctx.db.patch(existing._id, {
      ...(roleName !== undefined ? { role: roleName } : {}),
      ...(roleId !== undefined ? { roleId } : {}),
      isActive: true,
      lastSeen: new Date().toISOString(),
      // First ever user is Platform Admin
      isPlatformAdmin: isFirstUser,
    });
    return existing._id;
  },
});

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) return null;
    const user = await ctx.db.get("users", authUserId);
    if (!user) return null;

    // Enrich with active company info
    const company = user.activeCompanyId ? await ctx.db.get(user.activeCompanyId) : null;
    const membership = user.activeCompanyId
      ? await ctx.db
          .query("companyMembers")
          .withIndex("by_company_user", (q) =>
            q.eq("companyId", user.activeCompanyId!).eq("userId", user._id),
          )
          .first()
      : null;

    return {
      ...user,
      companyName: company?.name,
      companyCurrency: company?.currency,
      companyRole: membership?.companyRole,
      hasCompany: !!user.activeCompanyId,
      companySlug: company?.slug,
    };
  },
});

// Helper: get user's permissions (for legacy RBAC checks)
export async function getUserPermissions(ctx: QueryCtx | MutationCtx, userId: string) {
  const user = await ctx.db.get(userId as Parameters<typeof ctx.db.get>[0]);
  if (!user || !("roleId" in user) || !user.roleId) return [] as string[];
  const roleDoc = await ctx.db.get(user.roleId as Parameters<typeof ctx.db.get>[0]);
  if (!roleDoc || !("permissions" in roleDoc)) return [] as string[];
  return (roleDoc as { permissions: string[] }).permissions;
}
