/**
 * Shared tenant resolution and authorization helpers.
 *
 * SECURITY MODEL:
 * - Every query/mutation that touches business data must call requireTenantAccess()
 * - companyId is NEVER accepted from the frontend as an arg — always resolved server-side
 * - Platform admins (isPlatformAdmin=true) see ALL companies; use carefully
 * - Suspended companies: users see a suspension screen, all mutations throw FORBIDDEN
 * - Backend permissions are enforced via requirePermission() — frontend checks are UX only
 */
import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// ─── User resolution ─────────────────────────────────────────────────────────

export async function getCurrentUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

export async function requireAuth(ctx: QueryCtx | MutationCtx) {
  const user = await getCurrentUser(ctx);
  if (!user) {
    throw new ConvexError({ code: "UNAUTHENTICATED", message: "Tizimga kirish talab etiladi" });
  }
  return user;
}

// ─── Tenant resolution ───────────────────────────────────────────────────────

/**
 * Returns the companyId that the current user has access to.
 * Throws if:
 *   - Not authenticated
 *   - No active company
 *   - Not an active member of that company
 */
export async function requireTenantAccess(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"companies">> {
  const user = await requireAuth(ctx);

  if (!user.activeCompanyId) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Kompaniya tanlanmagan. Iltimos, avval kompaniya yarating yoki tanlang.",
    });
  }

  // Verify membership is still active
  const membership = await ctx.db
    .query("companyMembers")
    .withIndex("by_company_user", (q) =>
      q.eq("companyId", user.activeCompanyId!).eq("userId", user._id),
    )
    .first();

  if (!membership || !membership.isActive) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Bu kompaniyaga kirishingiz cheklangan.",
    });
  }

  return user.activeCompanyId;
}

/**
 * Like requireTenantAccess, but ALSO throws if the company is suspended/cancelled.
 * Use this in all mutations that modify business data.
 */
export async function requireTenantAccessForWrite(
  ctx: MutationCtx,
): Promise<Id<"companies">> {
  const tenantId = await requireTenantAccess(ctx);
  const company = await ctx.db.get(tenantId);
  if (company?.status === "suspended") {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Kompaniya to'xtatilgan. Iltimos, platforma admini bilan bog'laning.",
    });
  }
  if (company?.status === "cancelled") {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Kompaniya tugatilgan.",
    });
  }
  return tenantId;
}

/**
 * Like requireTenantAccess but returns null instead of throwing.
 * Use in queries that should degrade gracefully for unauthenticated users.
 */
export async function getTenantId(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"companies"> | null> {
  try {
    return await requireTenantAccess(ctx);
  } catch {
    return null;
  }
}

/**
 * Returns current user's company membership details.
 */
export async function getCurrentMembership(ctx: QueryCtx | MutationCtx) {
  const user = await getCurrentUser(ctx);
  if (!user || !user.activeCompanyId) return null;
  return ctx.db
    .query("companyMembers")
    .withIndex("by_company_user", (q) =>
      q.eq("companyId", user.activeCompanyId!).eq("userId", user._id),
    )
    .first();
}

/**
 * Checks if the current user is a platform administrator.
 */
export async function isPlatformAdmin(ctx: QueryCtx | MutationCtx): Promise<boolean> {
  const user = await getCurrentUser(ctx);
  return user?.isPlatformAdmin === true;
}

/**
 * Requires platform admin access.
 */
export async function requirePlatformAdmin(ctx: QueryCtx | MutationCtx) {
  const user = await requireAuth(ctx);
  if (!user.isPlatformAdmin) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Platforma administratori huquqlari talab etiladi.",
    });
  }
  return user;
}

// ─── Ownership checks ────────────────────────────────────────────────────────

/**
 * Verifies that a given companyId record belongs to the current user's company.
 * Call this before reading/mutating any cross-company-ID reference.
 *
 * NOTE: Unlike the old version, this does NOT allow null/undefined companyId
 * records (orphaned legacy data). Orphaned records are invisible to tenants.
 */
export async function assertSameTenant(
  ctx: QueryCtx | MutationCtx,
  recordCompanyId: Id<"companies"> | undefined | null,
): Promise<void> {
  if (!recordCompanyId) {
    // Orphaned / unscoped record — deny access to tenant users
    throw new ConvexError({ code: "FORBIDDEN", message: "Ruxsat etilmagan" });
  }
  const tenantId = await requireTenantAccess(ctx);
  if (recordCompanyId !== tenantId) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Ruxsat etilmagan" });
  }
}

// ─── Backend permission enforcement ──────────────────────────────────────────

/**
 * Verifies the current user holds a specific permission within their active company.
 *
 * Algorithm:
 *   1. Resolve authenticated user
 *   2. Resolve active company membership → get companyRole string
 *   3. Business Owner always passes (full access)
 *   4. Look up role document by name + companyId
 *   5. Check role.permissions includes the required permission
 *
 * Throws FORBIDDEN if permission is missing.
 */
export async function requirePermission(
  ctx: QueryCtx | MutationCtx,
  permission: string,
): Promise<void> {
  const user = await requireAuth(ctx);

  if (!user.activeCompanyId) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Kompaniya tanlanmagan" });
  }

  const membership = await ctx.db
    .query("companyMembers")
    .withIndex("by_company_user", (q) =>
      q.eq("companyId", user.activeCompanyId!).eq("userId", user._id),
    )
    .first();

  if (!membership || !membership.isActive) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Kompaniya a'zoligi faol emas" });
  }

  // Business Owner and Superadmin always have every permission
  if (
    membership.companyRole === "Business Owner" ||
    membership.companyRole === "Superadmin"
  ) {
    return;
  }

  // Look up the role record to get its permissions list
  const roleDoc = await ctx.db
    .query("roles")
    .withIndex("by_company_name", (q) =>
      q.eq("companyId", user.activeCompanyId!).eq("name", membership.companyRole),
    )
    .first();

  if (!roleDoc) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: `Rol "${membership.companyRole}" topilmadi`,
    });
  }

  if (!roleDoc.permissions.includes(permission)) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: `Bu amal uchun ruxsat yo'q: ${permission}`,
    });
  }
}

// ─── Audit logging helper ─────────────────────────────────────────────────────

export async function writeAuditLog(
  ctx: MutationCtx,
  opts: {
    userId?: Id<"users">;
    userName?: string;
    action: string;
    resource: string;
    resourceId?: string;
    details?: string;
    severity?: "info" | "warning" | "error";
    companyId?: Id<"companies">;
  },
) {
  await ctx.db.insert("auditLogs", {
    userId: opts.userId,
    userName: opts.userName,
    action: opts.action,
    resource: opts.resource,
    resourceId: opts.resourceId,
    details: opts.details,
    timestamp: new Date().toISOString(),
    severity: opts.severity ?? "info",
    companyId: opts.companyId,
  });
}
