/**
 * Shared tenant resolution and authorization helpers.
 *
 * SECURITY MODEL:
 * - Every query/mutation that touches business data must call requireTenantAccess()
 * - companyId is NEVER accepted from the frontend as an arg — always resolved server-side
 * - Platform admins (isPlatformAdmin=true) see ALL companies; use carefully
 * - Suspended companies: users see a suspension screen, all mutations throw FORBIDDEN
 * - Backend permissions are enforced via requirePermission() — frontend checks are UX only
 * - Role/user management uses requireAccessForWrite() + assertCanGrant(): nobody can
 *   grant a permission they do not hold themselves (no self-escalation)
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { ALL_PERMISSIONS, type Permission } from "../src/lib/permissions.ts";

// ─── User resolution ─────────────────────────────────────────────────────────

export async function getCurrentUser(ctx: QueryCtx | MutationCtx) {
  const authUserId = await getAuthUserId(ctx);
  if (!authUserId) return null;
  return ctx.db.get("users", authUserId);
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

/** These roles hold every permission — requirePermission bypasses them by NAME. */
export const FULL_ACCESS_ROLES = ["Business Owner", "Superadmin"] as const;

export function isFullAccessRole(name: string | undefined): boolean {
  return name !== undefined && (FULL_ACCESS_ROLES as readonly string[]).includes(name);
}

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
  if (isFullAccessRole(membership.companyRole)) {
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

export type TenantAccess = {
  user: Doc<"users">;
  tenantId: Id<"companies">;
  membership: Doc<"companyMembers">;
  /** Business Owner / Superadmin. */
  fullAccess: boolean;
  /** Caller's effective permissions — used to block granting what they don't hold. */
  permissions: string[];
};

/**
 * requirePermission for WRITE operations that also returns the caller's full
 * permission set. Rejects suspended/cancelled companies.
 */
export async function requireAccessForWrite(
  ctx: MutationCtx,
  permission: Permission,
): Promise<TenantAccess> {
  const tenantId = await requireTenantAccessForWrite(ctx);
  const user = await requireAuth(ctx);

  const membership = await ctx.db
    .query("companyMembers")
    .withIndex("by_company_user", (q) => q.eq("companyId", tenantId).eq("userId", user._id))
    .first();
  if (!membership || !membership.isActive) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Kompaniya a'zoligi faol emas" });
  }

  if (isFullAccessRole(membership.companyRole)) {
    return { user, tenantId, membership, fullAccess: true, permissions: [...ALL_PERMISSIONS] };
  }

  const roleDoc = await ctx.db
    .query("roles")
    .withIndex("by_company_name", (q) =>
      q.eq("companyId", tenantId).eq("name", membership.companyRole),
    )
    .first();
  const permissions = roleDoc && roleDoc.isActive ? roleDoc.permissions : [];

  if (!permissions.includes(permission)) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: `Bu amal uchun ruxsat yo'q: ${permission}`,
    });
  }
  return { user, tenantId, membership, fullAccess: false, permissions };
}

/** Nobody can grant a permission they do not hold themselves. */
export function assertCanGrant(access: TenantAccess, requested: readonly string[]): void {
  if (access.fullAccess) return;
  const missing = requested.filter((p) => !access.permissions.includes(p));
  if (missing.length > 0) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: `O'zingizda yo'q ruxsatni bera olmaysiz: ${missing.join(", ")}`,
    });
  }
}

/** Only permission names from the catalog are accepted. */
export function assertKnownPermissions(requested: readonly string[]): void {
  const unknown = requested.filter((p) => !(ALL_PERMISSIONS as readonly string[]).includes(p));
  if (unknown.length > 0) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `Noma'lum ruxsat: ${unknown.join(", ")}`,
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
