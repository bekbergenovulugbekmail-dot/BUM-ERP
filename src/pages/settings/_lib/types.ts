/**
 * `/api/company/*` javob tiplari — manba: apps/api/src/modules/company/*.service.ts,
 * users/user-admin.service.ts (listCompanyMembers), audit/audit-log.service.ts.
 */

export type CompanyRole = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  permissions: string[];
  isSystem: boolean;
  isActive: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

export type Employee = {
  id: string;
  phone: string;
  name: string | null;
  isActive: boolean;
  companyRole: string;
  branchId: string | null;
  branchName: string | null;
  allowedWarehouseIds: string[];
  /** Mas'ul kategoriyalar (ichkilari bilan); bo'sh — barcha kategoriyalar. */
  allowedCategoryIds: string[];
  membershipActive: boolean;
  joinedAt: string;
  lastSeenAt: string | null;
  /** Joriy litsenziya (bekor qilinmagan); yo'q — dasturdan foydalanmaydi. */
  licenseId: string | null;
  licenseType: "included" | "additional" | null;
  licenseStatus: "active" | "pending_payment" | "expired" | "revoked" | null;
  licenseExpiresAt: string | null;
};

export type Branch = {
  id: string;
  companyId: string;
  name: string;
  code: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AuditSeverity = "info" | "warning" | "error";

export type AuditLog = {
  id: string;
  occurredAt: string;
  action: string;
  resource: string;
  resourceId: string | null;
  severity: AuditSeverity;
  details: unknown;
  userId: string | null;
  userName: string | null;
  ipAddress: string | null;
  companyId: string | null;
  companyName: string;
};

/** Audit `details` — jsonb (obyekt); jadvalda bir qatorli matn. */
export function formatAuditDetails(details: unknown): string | null {
  if (details === null || details === undefined) return null;
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details);
  } catch {
    return null;
  }
}
