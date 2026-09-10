/**
 * Company & branch management.
 *
 * A "company" is a tenant. Each company may have:
 *   - one or more branches
 *   - one or more members (employees / users)
 *
 * Registration flow:
 *   1. User signs in via the OIDC provider
 *   2. No activeCompanyId → redirect to /onboarding
 *   3. Onboarding calls registerCompany → creates company + branch + membership
 *   4. Users.updateCurrentUser is patched with activeCompanyId
 *   5. Redirect to /:lng/dashboard
 */
import { v, ConvexError } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { DEFAULT_ROLES } from "../src/lib/permissions.ts";
import {
  requireAuth,
  requireTenantAccess,
  getTenantId,
  requirePlatformAdmin,
  writeAuditLog,
} from "./tenant.ts";

// ─── Reserved slugs (cannot be used as company slugs) ────────────────────────
const RESERVED_SLUGS = new Set([
  "admin", "app", "auth", "www", "api", "mail", "ftp",
  "support", "billing", "status", "dev", "staging",
  "help", "docs", "blog", "t", "tenant", "platform",
]);

/**
 * Convert a company name to a URL-safe slug.
 * "ALKON MCHJ"  → "alkon"
 * "Mega Trade"  → "mega-trade"
 */
function nameToSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32) || "company"
  );
}

/**
 * Generate a unique slug. Falls back to slug-2, slug-3, ... if taken.
 * Accepts MutationCtx whose db is read-capable.
 */
async function generateUniqueSlug(
  db: MutationCtx["db"],
  baseName: string,
): Promise<string> {
  const base = nameToSlug(baseName);
  const candidate = RESERVED_SLUGS.has(base) ? `${base}-co` : base;

  const existing = await db
    .query("companies")
    .withIndex("by_slug", (q) => q.eq("slug", candidate))
    .first();
  if (!existing) return candidate;

  for (let i = 2; i <= 99; i++) {
    const numbered = `${candidate}-${i}`;
    const ex2 = await db
      .query("companies")
      .withIndex("by_slug", (q) => q.eq("slug", numbered))
      .first();
    if (!ex2) return numbered;
  }
  return `${candidate}-${Date.now()}`;
}

// ─── Company queries ──────────────────────────────────────────────────────────

/** Get the company the current user is active in */
export const getActiveCompany = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return null;
    return ctx.db.get(tenantId);
  },
});

/** List all companies this user is a member of */
export const listMyCompanies = query({
  args: {},
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) return [];
    const dbUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", user.tokenIdentifier))
      .unique();
    if (!dbUser) return [];

    const memberships = await ctx.db
      .query("companyMembers")
      .withIndex("by_user", (q) => q.eq("userId", dbUser._id))
      .collect();

    const companies = await Promise.all(
      memberships.map(async (m) => {
        const company = await ctx.db.get(m.companyId);
        return company ? { ...company, companyRole: m.companyRole } : null;
      }),
    );
    return companies.filter(Boolean);
  },
});

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * Onboarding: Creates a new company, first branch, and sets caller as Business Owner.
 * Safe to call multiple times (idempotent if company already exists for user).
 */
export const registerCompany = mutation({
  args: {
    companyName: v.string(),
    legalName:   v.optional(v.string()),
    taxId:       v.optional(v.string()),
    phone:       v.optional(v.string()),
    email:       v.optional(v.string()),
    website:     v.optional(v.string()),
    address:     v.optional(v.string()),
    city:        v.optional(v.string()),
    region:      v.optional(v.string()),
    country:     v.string(),
    currency:    v.string(),
    language:    v.optional(v.string()),
    // First branch
    branchName:  v.string(),
    branchAddress: v.optional(v.string()),
    branchPhone: v.optional(v.string()),
    branchCity:  v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Prevent creating duplicate company for this user
    const existingMemberships = await ctx.db
      .query("companyMembers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    if (existingMemberships.length > 0 && user.activeCompanyId) {
      // User already has a company — allow multi-company by not throwing
    }

    // Create company
    const slug = await generateUniqueSlug(ctx.db, args.companyName);

    // Read platform setting for default trial days (default: 14)
    const trialRows = await ctx.db
      .query("settings")
      .withIndex("by_group", (q) => q.eq("group", "platform"))
      .collect();
    const trialDaysSetting = trialRows.find((r) => r.key === "defaultTrialDays" && !r.companyId);
    const trialDays = trialDaysSetting ? parseInt(trialDaysSetting.value, 10) : 14;
    const trialEndsAt = trialDays > 0
      ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString()
      : undefined;

    const companyId = await ctx.db.insert("companies", {
      name:      args.companyName,
      legalName: args.legalName,
      taxId:     args.taxId,
      phone:     args.phone,
      email:     args.email,
      website:   args.website,
      address:   args.address,
      city:      args.city,
      region:    args.region,
      country:   args.country,
      currency:  args.currency,
      language:  args.language ?? "uz",
      isDefault: existingMemberships.length === 0,
      isActive:  true,
      ownerId:   user._id,
      status:    trialDays > 0 ? "trial" : "active",
      slug,
      trialEndsAt,
    });

    // Create first branch
    const branchId = await ctx.db.insert("branches", {
      companyId,
      name:     args.branchName,
      code:     "BR-001",
      address:  args.branchAddress,
      city:     args.branchCity ?? args.city,
      phone:    args.branchPhone,
      isDefault: true,
      isActive:  true,
    });

    // Seed company-scoped default roles
    const existingRoles = await ctx.db.query("roles")
      .filter((q) => q.eq(q.field("companyId"), companyId))
      .collect();
    if (existingRoles.length === 0) {
      for (const role of DEFAULT_ROLES) {
        await ctx.db.insert("roles", {
          name:        role.name,
          description: role.description,
          color:       role.color,
          permissions: [...role.permissions],
          isSystem:    role.isSystem,
          isActive:    true,
          memberCount: 0,
          companyId,
        });
      }
    }

    // Create default warehouse for the branch
    const existingWh = await ctx.db.query("warehouses")
      .filter((q) => q.eq(q.field("companyId"), companyId))
      .first();
    if (!existingWh) {
      await ctx.db.insert("warehouses", {
        name:      "Asosiy ombor",
        code:      "WH-001",
        address:   args.address,
        isActive:  true,
        isDefault: true,
        companyId,
      });
    }

    // Create membership as Business Owner
    const existingMembership = await ctx.db
      .query("companyMembers")
      .withIndex("by_company_user", (q) =>
        q.eq("companyId", companyId).eq("userId", user._id),
      )
      .first();

    if (!existingMembership) {
      await ctx.db.insert("companyMembers", {
        companyId,
        userId:      user._id,
        companyRole: "Business Owner",
        branchId,
        isActive:    true,
        joinedAt:    new Date().toISOString(),
      });
    }

    // Set active company on user
    await ctx.db.patch(user._id, { activeCompanyId: companyId });

    // Audit log
    await writeAuditLog(ctx, {
      userId:     user._id,
      userName:   user.name,
      action:     "COMPANY_REGISTERED",
      resource:   "companies",
      resourceId: companyId,
      details:    `Company "${args.companyName}" registered`,
      severity:   "info",
      companyId,
    });

    return { companyId, branchId, slug };
  },
});

// ─── Switch active company ────────────────────────────────────────────────────

export const switchCompany = mutation({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Verify user is a member
    const membership = await ctx.db
      .query("companyMembers")
      .withIndex("by_company_user", (q) =>
        q.eq("companyId", args.companyId).eq("userId", user._id),
      )
      .first();

    if (!membership || !membership.isActive) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Bu kompaniyaga kirishingiz yo'q" });
    }

    await ctx.db.patch(user._id, { activeCompanyId: args.companyId });
  },
});

// ─── Company CRUD ─────────────────────────────────────────────────────────────

export const updateCompany = mutation({
  args: {
    name:      v.optional(v.string()),
    legalName: v.optional(v.string()),
    taxId:     v.optional(v.string()),
    phone:     v.optional(v.string()),
    email:     v.optional(v.string()),
    website:   v.optional(v.string()),
    address:   v.optional(v.string()),
    city:      v.optional(v.string()),
    region:    v.optional(v.string()),
    country:   v.optional(v.string()),
    currency:  v.optional(v.string()),
    language:  v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenantAccess(ctx);
    const user = await requireAuth(ctx);
    await ctx.db.patch(tenantId, args);
    await writeAuditLog(ctx, {
      userId:     user._id,
      userName:   user.name,
      action:     "COMPANY_UPDATED",
      resource:   "companies",
      resourceId: tenantId,
      severity:   "info",
      companyId:  tenantId,
    });
    return tenantId;
  },
});

// ─── Branches ────────────────────────────────────────────────────────────────

export const listBranches = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];
    return ctx.db
      .query("branches")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .collect();
  },
});

export const createBranch = mutation({
  args: {
    name:      v.string(),
    code:      v.string(),
    address:   v.optional(v.string()),
    city:      v.optional(v.string()),
    phone:     v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenantAccess(ctx);
    if (args.isDefault) {
      const defaults = await ctx.db
        .query("branches")
        .withIndex("by_company_default", (q) =>
          q.eq("companyId", tenantId).eq("isDefault", true),
        )
        .collect();
      for (const b of defaults) await ctx.db.patch(b._id, { isDefault: false });
    }
    return ctx.db.insert("branches", {
      companyId: tenantId,
      name:      args.name,
      code:      args.code,
      address:   args.address,
      city:      args.city,
      phone:     args.phone,
      isDefault: args.isDefault ?? false,
      isActive:  true,
    });
  },
});

export const updateBranch = mutation({
  args: {
    id:        v.id("branches"),
    name:      v.optional(v.string()),
    address:   v.optional(v.string()),
    city:      v.optional(v.string()),
    phone:     v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
    isActive:  v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenantAccess(ctx);
    const branch = await ctx.db.get(args.id);
    if (!branch || branch.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Filial topilmadi" });
    }
    const { id, ...rest } = args;
    await ctx.db.patch(id, rest);
  },
});

// ─── Company members ─────────────────────────────────────────────────────────

export const listMembers = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];
    const members = await ctx.db
      .query("companyMembers")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .collect();
    return Promise.all(
      members.map(async (m) => {
        const user   = await ctx.db.get(m.userId);
        const branch = m.branchId ? await ctx.db.get(m.branchId) : null;
        return {
          ...m,
          userName:   user?.name,
          userEmail:  user?.email,
          userAvatar: user?.avatar,
          userPhone:  user?.phone,
          branchName: branch?.name,
        };
      }),
    );
  },
});

export const inviteMember = mutation({
  args: {
    userId:      v.id("users"),
    companyRole: v.string(),
    branchId:    v.optional(v.id("branches")),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenantAccess(ctx);
    const inviter  = await requireAuth(ctx);

    const existing = await ctx.db
      .query("companyMembers")
      .withIndex("by_company_user", (q) =>
        q.eq("companyId", tenantId).eq("userId", args.userId),
      )
      .first();
    if (existing) {
      throw new ConvexError({ code: "CONFLICT", message: "Foydalanuvchi allaqachon a'zo" });
    }

    const membershipId = await ctx.db.insert("companyMembers", {
      companyId:   tenantId,
      userId:      args.userId,
      companyRole: args.companyRole,
      branchId:    args.branchId,
      isActive:    true,
      joinedAt:    new Date().toISOString(),
    });

    const invitedUser = await ctx.db.get(args.userId);
    if (invitedUser && !invitedUser.activeCompanyId) {
      await ctx.db.patch(args.userId, { activeCompanyId: tenantId });
    }

    await writeAuditLog(ctx, {
      userId:     inviter._id,
      userName:   inviter.name,
      action:     "MEMBER_INVITED",
      resource:   "companyMembers",
      resourceId: membershipId,
      details:    `User ${invitedUser?.name ?? args.userId} added as ${args.companyRole}`,
      severity:   "info",
      companyId:  tenantId,
    });

    return membershipId;
  },
});

export const updateMember = mutation({
  args: {
    id:          v.id("companyMembers"),
    companyRole: v.optional(v.string()),
    branchId:    v.optional(v.id("branches")),
    isActive:    v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenantAccess(ctx);
    const member = await ctx.db.get(args.id);
    if (!member || member.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "A'zo topilmadi" });
    }
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});

// ─── Invitation system ────────────────────────────────────────────────────────

/** Create a token-based invitation for an employee */
export const createInvitation = mutation({
  args: {
    email:       v.string(),
    phone:       v.optional(v.string()),
    companyRole: v.string(),
    branchId:    v.optional(v.id("branches")),
    message:     v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenantAccess(ctx);
    const inviter  = await requireAuth(ctx);

    // Check for existing pending invitation for this email in this company
    const existing = await ctx.db
      .query("invitations")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .filter((q) => q.eq(q.field("companyId"), tenantId))
      .first();

    if (existing && existing.status === "pending" && existing.expiresAt > new Date().toISOString()) {
      throw new ConvexError({
        code: "CONFLICT",
        message: "Bu email uchun kutilayotgan taklif mavjud",
      });
    }

    // Generate a random token
    const token = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Expires in 7 days
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const invitationId = await ctx.db.insert("invitations", {
      companyId:   tenantId,
      invitedBy:   inviter._id,
      email:       args.email,
      phone:       args.phone,
      companyRole: args.companyRole,
      branchId:    args.branchId,
      token,
      status:      "pending",
      expiresAt,
      message:     args.message,
    });

    await writeAuditLog(ctx, {
      userId:     inviter._id,
      userName:   inviter.name,
      action:     "INVITATION_SENT",
      resource:   "invitations",
      resourceId: invitationId,
      details:    `Invitation sent to ${args.email} for role ${args.companyRole}`,
      severity:   "info",
      companyId:  tenantId,
    });

    return { invitationId, token };
  },
});

/** List invitations for the current company */
export const listInvitations = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await getTenantId(ctx);
    if (!tenantId) return [];

    const invitations = await ctx.db
      .query("invitations")
      .withIndex("by_company", (q) => q.eq("companyId", tenantId))
      .collect();

    return Promise.all(
      invitations.map(async (inv) => {
        const invitedBy = await ctx.db.get(inv.invitedBy);
        return { ...inv, invitedByName: invitedBy?.name };
      }),
    );
  },
});

/** Cancel an invitation */
export const cancelInvitation = mutation({
  args: { id: v.id("invitations") },
  handler: async (ctx, args) => {
    const tenantId = await requireTenantAccess(ctx);
    const inv = await ctx.db.get(args.id);
    if (!inv || inv.companyId !== tenantId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Taklif topilmadi" });
    }
    await ctx.db.patch(args.id, { status: "cancelled" });
  },
});

/** Accept an invitation — called when the invited user signs in and clicks the link */
export const acceptInvitation = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const inv = await ctx.db
      .query("invitations")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!inv) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Taklif topilmadi" });
    }
    if (inv.status !== "pending") {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Taklif allaqachon ishlatilgan" });
    }
    if (inv.expiresAt < new Date().toISOString()) {
      await ctx.db.patch(inv._id, { status: "expired" });
      throw new ConvexError({ code: "BAD_REQUEST", message: "Taklif muddati o'tgan" });
    }

    // Check not already a member
    const existing = await ctx.db
      .query("companyMembers")
      .withIndex("by_company_user", (q) =>
        q.eq("companyId", inv.companyId).eq("userId", user._id),
      )
      .first();

    if (!existing) {
      await ctx.db.insert("companyMembers", {
        companyId:   inv.companyId,
        userId:      user._id,
        companyRole: inv.companyRole,
        branchId:    inv.branchId,
        isActive:    true,
        joinedAt:    new Date().toISOString(),
      });
    }

    // Set active company if none
    if (!user.activeCompanyId) {
      await ctx.db.patch(user._id, { activeCompanyId: inv.companyId });
    }

    // Mark invitation as accepted
    await ctx.db.patch(inv._id, {
      status:      "accepted",
      acceptedAt:  new Date().toISOString(),
      acceptedBy:  user._id,
    });

    await writeAuditLog(ctx, {
      userId:     user._id,
      userName:   user.name,
      action:     "INVITATION_ACCEPTED",
      resource:   "invitations",
      resourceId: inv._id,
      details:    `User ${user.name ?? user.email} joined as ${inv.companyRole}`,
      severity:   "info",
      companyId:  inv.companyId,
    });

    return { companyId: inv.companyId };
  },
});

// ─── Platform Admin queries ───────────────────────────────────────────────────

export const platformListCompanies = query({
  args: { status: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const admin = await ctx.auth.getUserIdentity();
    if (!admin) return [];
    const dbUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", admin.tokenIdentifier))
      .unique();
    if (!dbUser?.isPlatformAdmin) return [];

    const companies = await ctx.db.query("companies").collect();
    const filtered = args.status
      ? companies.filter((c) => c.status === args.status)
      : companies;

    return Promise.all(
      filtered.map(async (c) => {
        const memberCount = await ctx.db
          .query("companyMembers")
          .withIndex("by_company", (q) => q.eq("companyId", c._id))
          .collect()
          .then((m) => m.length);
        const owner = c.ownerId ? await ctx.db.get(c.ownerId) : null;
        return { ...c, memberCount, ownerName: owner?.name, ownerEmail: owner?.email };
      }),
    );
  },
});

export const platformUpdateCompanyStatus = mutation({
  args: {
    companyId:     v.id("companies"),
    status:        v.union(
      v.literal("active"), v.literal("trial"), v.literal("pending"),
      v.literal("suspended"), v.literal("cancelled"),
    ),
    suspendReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requirePlatformAdmin(ctx);
    const patch: Record<string, unknown> = { status: args.status };
    if (args.status === "suspended") {
      patch.suspendedAt    = new Date().toISOString();
      patch.suspendReason  = args.suspendReason;
    }
    await ctx.db.patch(args.companyId, patch as never);

    await writeAuditLog(ctx, {
      userId:     admin._id,
      userName:   admin.name,
      action:     "COMPANY_STATUS_CHANGED",
      resource:   "companies",
      resourceId: args.companyId,
      details:    `Status changed to ${args.status}${args.suspendReason ? ": " + args.suspendReason : ""}`,
      severity:   args.status === "suspended" ? "warning" : "info",
    });
  },
});

export const platformGetStats = query({
  args: {},
  handler: async (ctx) => {
    const admin = await ctx.auth.getUserIdentity();
    if (!admin) return null;
    const dbUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", admin.tokenIdentifier))
      .unique();
    if (!dbUser?.isPlatformAdmin) return null;

    const companies = await ctx.db.query("companies").collect();
    const users     = await ctx.db.query("users").collect();
    const members   = await ctx.db.query("companyMembers").collect();

    const byStatus = {
      active:    companies.filter((c) => c.status === "active").length,
      trial:     companies.filter((c) => c.status === "trial").length,
      pending:   companies.filter((c) => c.status === "pending").length,
      suspended: companies.filter((c) => c.status === "suspended").length,
      cancelled: companies.filter((c) => c.status === "cancelled").length,
    };

    return { totalCompanies: companies.length, totalUsers: users.length, totalMembers: members.length, byStatus };
  },
});

export const platformListAuditLogs = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const admin = await ctx.auth.getUserIdentity();
    if (!admin) return [];
    const dbUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", admin.tokenIdentifier))
      .unique();
    if (!dbUser?.isPlatformAdmin) return [];

    const logs = await ctx.db
      .query("auditLogs")
      .withIndex("by_timestamp")
      .order("desc")
      .take(args.limit ?? 100);

    return Promise.all(
      logs.map(async (l) => {
        const company = l.companyId ? await ctx.db.get(l.companyId) : null;
        return { ...l, companyName: company?.name ?? "Platform" };
      }),
    );
  },
});

export const platformGetCompany = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const admin = await ctx.auth.getUserIdentity();
    if (!admin) return null;
    const dbUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", admin.tokenIdentifier))
      .unique();
    if (!dbUser?.isPlatformAdmin) return null;

    const company = await ctx.db.get(args.companyId);
    if (!company) return null;

    const members = await ctx.db
      .query("companyMembers")
      .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
      .collect();

    const branches = await ctx.db
      .query("branches")
      .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
      .collect();

    const memberDetails = await Promise.all(
      members.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        return { ...m, userName: user?.name, userEmail: user?.email };
      }),
    );

    const owner = company.ownerId ? await ctx.db.get(company.ownerId) : null;

    return {
      ...company,
      ownerName:  owner?.name,
      ownerEmail: owner?.email,
      members:    memberDetails,
      branches,
    };
  },
});

export const platformListAllUsers = query({
  args: {},
  handler: async (ctx) => {
    const admin = await ctx.auth.getUserIdentity();
    if (!admin) return [];
    const dbUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", admin.tokenIdentifier))
      .unique();
    if (!dbUser?.isPlatformAdmin) return [];

    const users = await ctx.db.query("users").collect();
    return Promise.all(
      users.map(async (u) => {
        const company = u.activeCompanyId ? await ctx.db.get(u.activeCompanyId) : null;
        return { ...u, activeCompanyName: company?.name };
      }),
    );
  },
});

// ─── Data migration (run once) ────────────────────────────────────────────────

export const migrateExistingDataToTenant = mutation({
  args: {},
  handler: async (ctx): Promise<{ migrated: number; companyId: string | null }> => {
    const user = await requireAuth(ctx);

    let company = await ctx.db.query("companies")
      .withIndex("by_default", (q) => q.eq("isDefault", true))
      .first();

    if (!company) {
      return { migrated: 0, companyId: null };
    }

    const cid = company._id;
    let migrated = 0;

    const tables = [
      "categories", "brands", "products", "batches",
      "warehouses", "warehouseZones", "stockLevels", "stockMovements",
      "inventoryCounts", "inventoryCountItems",
      "suppliers", "purchaseOrders", "purchaseOrderItems",
      "purchaseReceipts", "purchaseReceiptItems", "supplierPayments",
      "customers", "salesOrders", "salesOrderItems", "customerPayments", "posShifts",
      "salesReps", "leads", "activities", "customerSegments",
      "customerSegmentMembers", "distributionRoutes", "routeCustomers", "routeVisits",
      "boms", "bomItems", "productionOrders", "productionMaterials",
      "workCenters", "productionTimeLines",
      "departments", "positions", "employees", "attendances", "leaves", "salaryPayments",
      "accounts", "journalEntries", "journalLines", "expenses", "cashAccounts", "cashTransactions",
      "notifications", "auditLogs",
    ];

    for (const tableName of tables) {
      const docs = await (ctx.db.query as unknown as (t: string) => { collect: () => Promise<Array<{ _id: string; companyId?: string }>> })(tableName as unknown as never).collect();
      for (const doc of docs) {
        if (!doc.companyId) {
          await ctx.db.patch(doc._id as Parameters<typeof ctx.db.patch>[0], { companyId: cid } as never);
          migrated++;
        }
      }
    }

    const existingMembership = await ctx.db
      .query("companyMembers")
      .withIndex("by_company_user", (q) => q.eq("companyId", cid).eq("userId", user._id))
      .first();

    if (!existingMembership) {
      await ctx.db.insert("companyMembers", {
        companyId:   cid,
        userId:      user._id,
        companyRole: "Business Owner",
        isActive:    true,
        joinedAt:    new Date().toISOString(),
      });
    }

    if (!user.activeCompanyId) {
      await ctx.db.patch(user._id, { activeCompanyId: cid });
    }

    return { migrated, companyId: cid };
  },
});

// ─── Platform Admin: purge orphaned legacy seed data ─────────────────────────
// These are records created before multi-tenancy with no companyId.
// We cannot delete them safely, but we mark them with a special platform
// sentinel company so the strict tenant filter never exposes them to real tenants.
// Call once from the admin dashboard after the platform is fully set up.
export const platformMarkOrphanedDataAsLegacy = mutation({
  args: {},
  handler: async (ctx): Promise<{ marked: number }> => {
    await requirePlatformAdmin(ctx);

    // Find or create a platform-sentinel company (invisible to tenants)
    let sentinel = await ctx.db.query("companies")
      .filter((q) => q.eq(q.field("isPlatformTenant"), true))
      .first();

    if (!sentinel) {
      const sentinelId = await ctx.db.insert("companies", {
        name: "__PLATFORM_LEGACY__",
        country: "UZ",
        currency: "UZS",
        isDefault: false,
        isActive: false,
        isPlatformTenant: true,
        status: "cancelled",
      });
      sentinel = await ctx.db.get(sentinelId);
    }

    if (!sentinel) return { marked: 0 };
    const cid = sentinel._id;
    let marked = 0;

    const legacyTables = [
      "warehouses", "accounts", "cashAccounts", "cashTransactions",
      "products", "categories", "brands",
    ] as const;

    for (const tableName of legacyTables) {
      const docs = await (ctx.db.query as unknown as (t: string) => { collect: () => Promise<Array<{ _id: string; companyId?: string }>> })(tableName as unknown as never).collect();
      for (const doc of docs) {
        if (!doc.companyId) {
          await ctx.db.patch(doc._id as Parameters<typeof ctx.db.patch>[0], { companyId: cid } as never);
          marked++;
        }
      }
    }

    return { marked };
  },
});

// ─── Platform Admin: manage platform admins ──────────────────────────────────

/** Grant platform admin rights to a user */
export const platformGrantAdmin = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const admin = await requirePlatformAdmin(ctx);

    const target = await ctx.db.get(args.userId);
    if (!target) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Foydalanuvchi topilmadi" });
    }

    await ctx.db.patch(args.userId, { isPlatformAdmin: true });

    await writeAuditLog(ctx, {
      userId:     admin._id,
      userName:   admin.name,
      action:     "PLATFORM_ADMIN_GRANTED",
      resource:   "users",
      resourceId: args.userId,
      details:    `Admin granted to ${target.name ?? target.email ?? args.userId}`,
      severity:   "warning",
    });

    return { success: true };
  },
});

/** Revoke platform admin rights from a user (cannot revoke your own) */
export const platformRevokeAdmin = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const admin = await requirePlatformAdmin(ctx);

    if (args.userId === admin._id) {
      throw new ConvexError({ code: "FORBIDDEN", message: "O'zingizdan adminlikni olmaysiz" });
    }

    const target = await ctx.db.get(args.userId);
    if (!target) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Foydalanuvchi topilmadi" });
    }

    await ctx.db.patch(args.userId, { isPlatformAdmin: false });

    await writeAuditLog(ctx, {
      userId:     admin._id,
      userName:   admin.name,
      action:     "PLATFORM_ADMIN_REVOKED",
      resource:   "users",
      resourceId: args.userId,
      details:    `Admin revoked from ${target.name ?? target.email ?? args.userId}`,
      severity:   "warning",
    });

    return { success: true };
  },
});

// ─── Platform Admin: create a company on behalf of a tenant ──────────────────

export const platformCreateCompany = mutation({
  args: {
    companyName: v.string(),
    legalName:   v.optional(v.string()),
    taxId:       v.optional(v.string()),
    phone:       v.optional(v.string()),
    email:       v.optional(v.string()),
    website:     v.optional(v.string()),
    address:     v.optional(v.string()),
    city:        v.optional(v.string()),
    region:      v.optional(v.string()),
    country:     v.string(),
    currency:    v.string(),
    language:    v.optional(v.string()),
    branchName:  v.optional(v.string()),
    ownerUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args): Promise<{ companyId: Id<"companies">; branchId: Id<"branches">; slug: string }> => {
    const admin = await requirePlatformAdmin(ctx);

    // Create company (active, not trial)
    const slug = await generateUniqueSlug(ctx.db, args.companyName);
    const companyId = await ctx.db.insert("companies", {
      name:      args.companyName,
      legalName: args.legalName,
      taxId:     args.taxId,
      phone:     args.phone,
      email:     args.email,
      website:   args.website,
      address:   args.address,
      city:      args.city,
      region:    args.region,
      country:   args.country,
      currency:  args.currency,
      language:  args.language ?? "uz",
      isDefault: false,
      isActive:  true,
      ownerId:   args.ownerUserId,
      status:    "active",
      slug,
    });

    // Create first branch
    const branchId = await ctx.db.insert("branches", {
      companyId,
      name:      args.branchName ?? "Asosiy filial",
      code:      "BR-001",
      address:   args.address,
      city:      args.city,
      phone:     args.phone,
      isDefault: true,
      isActive:  true,
    });

    // Seed company-scoped default roles
    const existingRoles = await ctx.db.query("roles")
      .filter((q) => q.eq(q.field("companyId"), companyId))
      .collect();
    if (existingRoles.length === 0) {
      for (const role of DEFAULT_ROLES) {
        await ctx.db.insert("roles", {
          name:        role.name,
          description: role.description,
          color:       role.color,
          permissions: [...role.permissions],
          isSystem:    role.isSystem,
          isActive:    true,
          memberCount: 0,
          companyId,
        });
      }
    }

    // Create default warehouse
    await ctx.db.insert("warehouses", {
      name:      "Asosiy ombor",
      code:      "WH-001",
      address:   args.address,
      isActive:  true,
      isDefault: true,
      companyId,
    });

    // Assign owner if provided
    if (args.ownerUserId) {
      const existingMembership = await ctx.db
        .query("companyMembers")
        .withIndex("by_company_user", (q) =>
          q.eq("companyId", companyId).eq("userId", args.ownerUserId!),
        )
        .first();
      if (!existingMembership) {
        await ctx.db.insert("companyMembers", {
          companyId,
          userId:      args.ownerUserId,
          companyRole: "Business Owner",
          branchId,
          isActive:    true,
          joinedAt:    new Date().toISOString(),
        });
      }
      await ctx.db.patch(args.ownerUserId, { activeCompanyId: companyId });
    }

    await writeAuditLog(ctx, {
      userId:     admin._id,
      userName:   admin.name,
      action:     "PLATFORM_COMPANY_CREATED",
      resource:   "companies",
      resourceId: companyId,
      details:    JSON.stringify({ companyName: args.companyName, ownerUserId: args.ownerUserId }),
      severity:   "info",
      companyId,
    });

    return { companyId, branchId, slug };
  },
});

// ─── Bootstrap: grant the very first platform admin by email ─────────────────
// No auth required — protected by PLATFORM_BOOTSTRAP_KEY secret.
// Used once to grant the first admin (e.g. bekbergenovulugbekmail@gmail.com).
export const platformSetAdminByEmail = mutation({
  args: { email: v.string(), secretKey: v.string() },
  handler: async (ctx, args): Promise<{ userId: Id<"users">; email: string | undefined }> => {
    const bootstrapKey = process.env.PLATFORM_BOOTSTRAP_KEY;
    if (!bootstrapKey || args.secretKey !== bootstrapKey) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Noto'g'ri maxfiy kalit" });
    }

    const normalizedEmail = args.email.trim().toLowerCase();
    const users = await ctx.db.query("users").collect();
    const user = users.find((u) => (u.email ?? "").trim().toLowerCase() === normalizedEmail);

    if (!user) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Foydalanuvchi topilmadi. Avval login qiling.",
      });
    }

    await ctx.db.patch(user._id, { isPlatformAdmin: true });

    await writeAuditLog(ctx, {
      userId:     user._id,
      userName:   user.name,
      action:     "PLATFORM_ADMIN_BOOTSTRAP",
      resource:   "users",
      resourceId: user._id,
      details:    `Bootstrap admin granted to ${user.email ?? user._id}`,
      severity:   "warning",
    });

    return { userId: user._id, email: user.email };
  },
});

// ─── Public: count existing platform admins (used for bootstrap detection) ───
// No auth required — only returns a number, not any PII.
export const platformAdminCount = query({
  args: {},
  handler: async (ctx): Promise<number> => {
    const allUsers = await ctx.db.query("users").collect();
    return allUsers.filter((u) => u.isPlatformAdmin === true).length;
  },
});

// ─── Public: resolve company by slug ─────────────────────────────────────────
// Used by the tenant portal page (/t/:slug).
// Returns only safe public fields — no financials, no member data.
export const getCompanyBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    if (!args.slug || args.slug.length < 2) return null;
    const company = await ctx.db
      .query("companies")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (!company) return null;
    // Return public-safe fields only
    return {
      _id:       company._id,
      name:      company.name,
      legalName: company.legalName,
      logoUrl:   company.logoUrl,
      country:   company.country,
      currency:  company.currency,
      language:  company.language,
      slug:      company.slug,
      status:    company.status,
      city:      company.city,
    };
  },
});

// ─── Auth: verify slug belongs to authenticated user's company ────────────────
// Returns whether current user is a member of the slug-identified company.
// Used for cross-tenant access control in the tenant portal.
export const verifyTenantAccess = query({
  args: { slug: v.string() },
  handler: async (ctx, args): Promise<{ allowed: boolean; companyId: string | null; reason: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { allowed: false, companyId: null, reason: "unauthenticated" };

    const dbUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!dbUser) return { allowed: false, companyId: null, reason: "user_not_found" };

    // Platform admin can access any company
    if (dbUser.isPlatformAdmin) {
      const company = await ctx.db
        .query("companies")
        .withIndex("by_slug", (q) => q.eq("slug", args.slug))
        .first();
      return { allowed: true, companyId: company?._id ?? null, reason: "platform_admin" };
    }

    const company = await ctx.db
      .query("companies")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (!company) return { allowed: false, companyId: null, reason: "company_not_found" };

    if (company.status === "suspended" || company.status === "cancelled") {
      return { allowed: false, companyId: company._id, reason: "company_inactive" };
    }

    const membership = await ctx.db
      .query("companyMembers")
      .withIndex("by_company_user", (q) =>
        q.eq("companyId", company._id).eq("userId", dbUser._id),
      )
      .first();

    if (!membership || !membership.isActive) {
      return { allowed: false, companyId: company._id, reason: "not_member" };
    }

    return { allowed: true, companyId: company._id, reason: "ok" };
  },
});

// ─── Platform: get/set global settings ───────────────────────────────────────
// Keys stored in `settings` table with companyId=null and group="platform"

export const platformGetSettings = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("settings")
      .withIndex("by_group", (q) => q.eq("group", "platform"))
      .collect();
    // Return settings as a typed object
    const get = (key: string, fallback: string) =>
      rows.find((r) => r.key === key && !r.companyId)?.value ?? fallback;

    return {
      registrationEnabled: get("registrationEnabled", "true") === "true",
      defaultTrialDays: parseInt(get("defaultTrialDays", "14"), 10),
      platformName: get("platformName", "BUM ERP"),
      supportEmail: get("supportEmail", ""),
    };
  },
});

export const platformSaveSettings = mutation({
  args: {
    registrationEnabled: v.boolean(),
    defaultTrialDays: v.number(),
    platformName: v.optional(v.string()),
    supportEmail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);

    const upsert = async (key: string, value: string, description: string) => {
      const existing = await ctx.db
        .query("settings")
        .withIndex("by_company_key", (q) =>
          q.eq("companyId", undefined).eq("key", key),
        )
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, { value, updatedAt: new Date().toISOString() });
      } else {
        await ctx.db.insert("settings", {
          key,
          value,
          description,
          group: "platform",
          updatedAt: new Date().toISOString(),
        });
      }
    };

    await upsert("registrationEnabled", String(args.registrationEnabled), "Yangi kompaniya ro'yxatdan o'tishini yoqish/o'chirish");
    await upsert("defaultTrialDays", String(Math.max(0, Math.round(args.defaultTrialDays))), "Yangi kompaniya uchun sinov muddati (kun)");
    if (args.platformName !== undefined) {
      await upsert("platformName", args.platformName, "Platforma nomi");
    }
    if (args.supportEmail !== undefined) {
      await upsert("supportEmail", args.supportEmail, "Qo'llab-quvvatlash email");
    }

    return { ok: true };
  },
});

// ─── Public: check if registration is open ────────────────────────────────────
export const isRegistrationEnabled = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_group", (q) => q.eq("group", "platform"))
      .collect();
    const setting = row.find((r) => r.key === "registrationEnabled" && !r.companyId);
    // Default: enabled
    return setting ? setting.value === "true" : true;
  },
});
