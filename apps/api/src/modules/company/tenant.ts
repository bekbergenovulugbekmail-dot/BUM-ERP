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
 *
 * Guard zanjiri: sessiya → faol a'zolik → obuna/trial → litsenziya (subscription/access.ts) → ruxsat.
 * Obuna va litsenziya shu so'rovning o'zida (bitta SELECT) bazadan o'qiladi; standart daraja — `business`.
 */
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import {
  ALL_PERMISSIONS,
  FULL_ACCESS_ROLES,
  forbidden,
  isPermission,
  type LicenseSnapshot,
  type Permission,
} from "@bum/shared";
import { companies, companyMembers, roles } from "../../db/schema/platform.js";
import { licenses, subscriptions } from "../../db/schema/subscription.js";
import type { DbOrTx } from "../../db/transaction.js";
import type { SessionUser } from "../auth/session.js";
import { assertTenantAccess, type SubscriptionSnapshot, type TenantAccess } from "../subscription/access.js";

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
  /** Kompaniya obunasi; yozuv yo'q — muddati tugagan hisoblanadi. */
  subscription: SubscriptionSnapshot | null;
  /** Foydalanuvchining shu kompaniyadagi joriy (bekor qilinmagan) litsenziyasi. */
  license: (LicenseSnapshot & { id: string }) | null;
};

export type TenantOptions = {
  /** `business` (standart) — obuna va litsenziya shart; `dashboard` — obuna tugaganda ham; `account` — faqat a'zolik. */
  access?: TenantAccess;
};

export function isFullAccessRole(role: string): boolean {
  return (FULL_ACCESS_ROLES as readonly string[]).includes(role);
}

/** Aktiv kompaniya va undagi FAOL a'zolik, so'ng obuna/litsenziya — aks holda FORBIDDEN. */
export async function requireTenant(conn: DbOrTx, user: SessionUser, options: TenantOptions = {}): Promise<TenantContext> {
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
      subscriptionStatus: subscriptions.status,
      subscriptionExpiresAt: subscriptions.expiresAt,
      licenseId: licenses.id,
      licenseType: licenses.licenseType,
      licenseStatus: licenses.status,
      licenseExpiresAt: licenses.expiresAt,
    })
    .from(companyMembers)
    .innerJoin(companies, eq(companies.id, companyMembers.companyId))
    .leftJoin(subscriptions, eq(subscriptions.companyId, companies.id))
    .leftJoin(
      licenses,
      and(eq(licenses.companyId, companyMembers.companyId), eq(licenses.userId, companyMembers.userId), ne(licenses.status, "revoked")),
    )
    .where(and(eq(companyMembers.companyId, user.activeCompanyId), eq(companyMembers.userId, user.id)))
    .limit(1);

  if (!row || !row.membershipActive) throw forbidden("Bu kompaniyaga kirishingiz cheklangan");

  const tenant: TenantContext = {
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
    subscription: row.subscriptionStatus ? { status: row.subscriptionStatus, expiresAt: row.subscriptionExpiresAt } : null,
    license:
      row.licenseId && row.licenseType && row.licenseStatus
        ? { id: row.licenseId, type: row.licenseType, status: row.licenseStatus, expiresAt: row.licenseExpiresAt }
        : null,
  };

  assertTenantAccess({
    access: options.access ?? "business",
    isOwner: row.ownerId === user.id,
    subscription: tenant.subscription,
    license: tenant.license,
  });
  return tenant;
}

/**
 * Kompaniyada yozish mumkinmi: tugatilgan yoki to'xtatilgan bo'lsa — yo'q (platforma admini qarori).
 * Sinov muddati va obuna tugashi — `requireTenant` dagi obuna tekshiruvida.
 */
export function assertCompanyWritable(company: { status: string; isActive: boolean }): void {
  if (company.status === "cancelled") throw forbidden("Kompaniya tugatilgan");
  if (company.status === "suspended" || !company.isActive) {
    throw forbidden("Kompaniya to'xtatilgan. Platforma admini bilan bog'laning.");
  }
}

/** Yozish amallari uchun: obuna va litsenziya (`business`) + `assertCompanyWritable`. */
export async function requireTenantForWrite(conn: DbOrTx, user: SessionUser): Promise<TenantContext> {
  const tenant = await requireTenant(conn, user);
  assertCompanyWritable(tenant.company);
  return tenant;
}

/** A'zoning amaldagi ruxsatlari (frontend UX uchun ham qaytariladi). */
export function effectivePermissions(conn: DbOrTx, tenant: TenantContext): Promise<Permission[]> {
  return membershipPermissions(conn, tenant.company.id, tenant.membership);
}

/** A'zolik (rol) bo'yicha ruxsatlar — kontekstsiz ro'yxatlar uchun ham (masalan, kassa qurilmasi kassirlari). */
export async function membershipPermissions(
  conn: DbOrTx,
  companyId: string,
  membership: { companyRole: string; roleId: string | null },
): Promise<Permission[]> {
  if (isFullAccessRole(membership.companyRole)) return [...ALL_PERMISSIONS];

  const match = membership.roleId
    ? eq(roles.id, membership.roleId)
    : eq(roles.name, membership.companyRole);

  // Kompaniyaning o'z roli ustun, bo'lmasa global standart rol
  const [role] = await conn
    .select({ permissions: roles.permissions, isActive: roles.isActive })
    .from(roles)
    .where(and(match, or(eq(roles.companyId, companyId), isNull(roles.companyId))))
    .orderBy(sql`${roles.companyId} is null`)
    .limit(1);

  if (!role || !role.isActive) return [];
  // Bazadagi eskirgan yoki katalogda yo'q nomlar hisobga olinmaydi
  return role.permissions.filter(isPermission);
}

export type RoleRecord = { id: string; name: string; companyId: string | null; permissions: string[]; isActive: boolean };

/**
 * `membershipPermissions` bilan aynan bir xil qoida, oldindan yuklangan rollar bo'yicha (ko'p a'zo — bitta so'rov):
 * to'liq ruxsatli rol — hammasi; kompaniyaning o'z roli global standart roldan ustun; faol bo'lmagan rol — hech narsa.
 */
export function permissionsFromRoles(
  companyId: string,
  membership: { companyRole: string; roleId: string | null },
  roleRows: RoleRecord[],
): Permission[] {
  if (isFullAccessRole(membership.companyRole)) return [...ALL_PERMISSIONS];
  const matches = roleRows.filter(
    (role) =>
      (membership.roleId ? role.id === membership.roleId : role.name === membership.companyRole) && (role.companyId === companyId || role.companyId === null),
  );
  const role = matches.find((item) => item.companyId === companyId) ?? matches[0];
  if (!role || !role.isActive) return [];
  return role.permissions.filter(isPermission);
}

/** Ruxsat bor-yo'qligi — xato tashlamay (maydonni yashirish kabi qismiy ko'rinishlar uchun). */
export async function hasPermission(conn: DbOrTx, tenant: TenantContext, permission: Permission): Promise<boolean> {
  return (await effectivePermissions(conn, tenant)).includes(permission);
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

/**
 * Sanab o'tilganlardan BIRORTASI yetarli bo'lgan amallar uchun (masalan, mijozdan to'lov qabul qilish:
 * kassirda `sales.collect_payment`, moliya xodimida `finance.manage`).
 */
export async function requireAnyPermission(
  conn: DbOrTx,
  tenant: TenantContext,
  allowed: readonly [Permission, ...Permission[]],
): Promise<void> {
  const permissions = await effectivePermissions(conn, tenant);
  if (!allowed.some((permission) => permissions.includes(permission))) {
    throw forbidden(`Bu amal uchun ruxsat yo'q: ${allowed.join(" yoki ")}`);
  }
}
