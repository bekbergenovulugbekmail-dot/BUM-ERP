/**
 * Tenant (kompaniya) konteksti va RBAC.
 *
 * Convex'dagi convex/tenant.ts muqobili:
 *   requireTenantAccess         → requireTenant
 *   requireTenantAccessForWrite → requireTenantForWrite
 *   requirePermission           → requirePermission
 *
 * companyId hech qachon so'rovdan olinmaydi — har doim foydalanuvchining aktiv
 * kompaniyasi. `requirePermission` faqat `Permission` tipini qabul qiladi:
 * katalogda yo'q nom yozilsa kompilyatsiya xatosi (Convex'da oddiy string edi).
 */
import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  ALL_PERMISSIONS,
  FULL_ACCESS_ROLES,
  forbidden,
  isPermission,
  type Permission,
} from "@bum/shared";
import { companies, companyMembers, roles } from "../../db/schema/platform.js";
import type { DbOrTx } from "../../db/transaction.js";
import type { SessionUser } from "../auth/session.js";

export type TenantContext = {
  user: SessionUser;
  company: {
    id: string;
    name: string;
    status: string;
    isActive: boolean;
    ownerId: string | null;
    trialEndsAt: Date | null;
  };
  membership: {
    id: string;
    companyRole: string;
    roleId: string | null;
    branchId: string | null;
    allowedWarehouseIds: string[];
    /** Mas'ul kategoriyalar; bo'sh — cheklov yo'q (catalog/category-scope.ts). */
    allowedCategoryIds: string[];
  };
};

export function isFullAccessRole(role: string): boolean {
  return (FULL_ACCESS_ROLES as readonly string[]).includes(role);
}

/** Aktiv kompaniya va undagi FAOL a'zolik — aks holda FORBIDDEN. */
export async function requireTenant(conn: DbOrTx, user: SessionUser): Promise<TenantContext> {
  if (!user.activeCompanyId) {
    throw forbidden("Kompaniya tanlanmagan. Avval kompaniyani tanlang.");
  }

  const [row] = await conn
    .select({
      companyId: companies.id,
      name: companies.name,
      status: companies.status,
      isActive: companies.isActive,
      ownerId: companies.ownerId,
      trialEndsAt: companies.trialEndsAt,
      membershipId: companyMembers.id,
      companyRole: companyMembers.companyRole,
      roleId: companyMembers.roleId,
      branchId: companyMembers.branchId,
      allowedWarehouseIds: companyMembers.allowedWarehouseIds,
      allowedCategoryIds: companyMembers.allowedCategoryIds,
      membershipActive: companyMembers.isActive,
    })
    .from(companyMembers)
    .innerJoin(companies, eq(companies.id, companyMembers.companyId))
    .where(and(eq(companyMembers.companyId, user.activeCompanyId), eq(companyMembers.userId, user.id)))
    .limit(1);

  if (!row || !row.membershipActive) throw forbidden("Bu kompaniyaga kirishingiz cheklangan");

  return {
    user,
    company: {
      id: row.companyId,
      name: row.name,
      status: row.status,
      isActive: row.isActive,
      ownerId: row.ownerId,
      trialEndsAt: row.trialEndsAt,
    },
    membership: {
      id: row.membershipId,
      companyRole: row.companyRole,
      roleId: row.roleId,
      branchId: row.branchId,
      allowedWarehouseIds: row.allowedWarehouseIds,
      allowedCategoryIds: row.allowedCategoryIds,
    },
  };
}

/**
 * Kompaniyada yozish mumkinmi: tugatilgan, to'xtatilgan yoki sinov muddati
 * o'tgan bo'lsa — yo'q. Kompaniya egasining xodim amallari ham shuni ishlatadi.
 */
export function assertCompanyWritable(company: {
  status: string;
  isActive: boolean;
  trialEndsAt: Date | null;
}): void {
  if (company.status === "cancelled") throw forbidden("Kompaniya tugatilgan");
  if (company.status === "suspended" || !company.isActive) {
    throw forbidden("Kompaniya to'xtatilgan. Platforma admini bilan bog'laning.");
  }
  if (company.status === "trial" && company.trialEndsAt && company.trialEndsAt.getTime() < Date.now()) {
    throw forbidden("Sinov muddati tugagan. Platforma admini bilan bog'laning.");
  }
}

/** Yozish amallari uchun: `assertCompanyWritable` bilan. */
export async function requireTenantForWrite(conn: DbOrTx, user: SessionUser): Promise<TenantContext> {
  const tenant = await requireTenant(conn, user);
  assertCompanyWritable(tenant.company);
  return tenant;
}

/** A'zoning amaldagi ruxsatlari (frontend UX uchun ham qaytariladi). */
export async function effectivePermissions(conn: DbOrTx, tenant: TenantContext): Promise<Permission[]> {
  const { membership, company } = tenant;
  if (isFullAccessRole(membership.companyRole)) return [...ALL_PERMISSIONS];

  const match = membership.roleId
    ? eq(roles.id, membership.roleId)
    : eq(roles.name, membership.companyRole);

  // Kompaniyaning o'z roli ustun, bo'lmasa global standart rol
  const [role] = await conn
    .select({ permissions: roles.permissions, isActive: roles.isActive })
    .from(roles)
    .where(and(match, or(eq(roles.companyId, company.id), isNull(roles.companyId))))
    .orderBy(sql`${roles.companyId} is null`)
    .limit(1);

  if (!role || !role.isActive) return [];
  // Bazadagi eskirgan yoki katalogda yo'q nomlar hisobga olinmaydi
  return role.permissions.filter(isPermission);
}

export async function requirePermission(
  conn: DbOrTx,
  tenant: TenantContext,
  permission: Permission,
): Promise<void> {
  const permissions = await effectivePermissions(conn, tenant);
  if (!permissions.includes(permission)) {
    throw forbidden(`Bu amal uchun ruxsat yo'q: ${permission}`);
  }
}
