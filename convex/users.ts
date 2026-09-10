import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { DEFAULT_ROLES } from "../src/lib/permissions.ts";

export const updateCurrentUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({ code: "UNAUTHENTICATED", message: "User not logged in" });
    }

    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { lastSeen: new Date().toISOString() });
      return existing._id;
    }

    // First user ever → Platform Admin + seed global roles
    const allUsers = await ctx.db.query("users").collect();
    const isFirstUser = allUsers.length === 0;

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
      const superadminRole = await ctx.db
        .query("roles")
        .withIndex("by_name", (q) => q.eq("name", "Superadmin"))
        .first();
      if (superadminRole && !superadminRole.companyId) {
        roleId = superadminRole._id;
        roleName = "Superadmin";
        await ctx.db.patch(superadminRole._id, { memberCount: superadminRole.memberCount + 1 });
      }
    }

    return ctx.db.insert("users", {
      name: identity.name,
      email: identity.email,
      tokenIdentifier: identity.tokenIdentifier,
      role: roleName,
      roleId,
      isActive: true,
      lastSeen: new Date().toISOString(),
      // First ever user is Platform Admin
      isPlatformAdmin: isFirstUser,
    });
  },
});

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
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
