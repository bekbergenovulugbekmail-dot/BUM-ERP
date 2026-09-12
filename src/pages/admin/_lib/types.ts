/**
 * `/api/platform/*` javob tiplari — manba: apps/api/src/modules/platform/{company,platform}.service.ts,
 * audit/audit-log.service.ts.
 */

export type CompanyStatus = "active" | "trial" | "pending" | "suspended" | "cancelled";

export const COMPANY_STATUSES: CompanyStatus[] = ["active", "trial", "pending", "suspended", "cancelled"];

export type PlatformCompany = {
  id: string;
  name: string;
  slug: string | null;
  status: CompanyStatus;
  isActive: boolean;
  trialEndsAt: string | null;
  createdAt: string;
  memberCount: number;
  owner: { id: string; phone: string; name: string | null; isActive: boolean } | null;
};

export type PlatformCompanyDetails = {
  company: {
    id: string;
    name: string;
    legalName: string | null;
    taxId: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    address: string | null;
    city: string | null;
    region: string | null;
    country: string;
    currency: string;
    language: string;
    slug: string | null;
    status: CompanyStatus;
    isActive: boolean;
    suspendedAt: string | null;
    suspendReason: string | null;
    trialEndsAt: string | null;
    createdAt: string;
  };
  owner: { id: string; phone: string; name: string | null; isActive: boolean } | null;
  members: {
    userId: string;
    phone: string;
    name: string | null;
    userActive: boolean;
    companyRole: string;
    branchId: string | null;
    membershipActive: boolean;
    joinedAt: string;
  }[];
  branches: {
    id: string;
    name: string;
    code: string;
    city: string | null;
    isDefault: boolean;
    isActive: boolean;
  }[];
};

export type PlatformStats = {
  totalCompanies: number;
  totalUsers: number;
  totalMembers: number;
  byStatus: Record<CompanyStatus, number>;
};

export type PlatformUser = {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  isActive: boolean;
  isPlatformAdmin: boolean;
  isBootstrapAdmin: boolean;
  activeCompanyId: string | null;
  activeCompanyName: string | null;
  lastSeenAt: string | null;
  createdAt: string;
};

export type PlatformAuditLog = {
  id: string;
  occurredAt: string;
  action: string;
  resource: string;
  resourceId: string | null;
  severity: "info" | "warning" | "error";
  details: unknown;
  userId: string | null;
  userName: string | null;
  ipAddress: string | null;
  companyId: string | null;
  companyName: string;
};

export type PlatformSettings = {
  registrationEnabled: boolean;
  defaultTrialDays: number;
  platformName: string;
  supportEmail: string;
};

/** `GET /api/platform/desktop-releases` — desktop kassa o'rnatuvchisi. */
export type DesktopRelease = {
  id: string;
  version: string;
  fileName: string;
  size: number;
  sha256: string;
  notes: string | null;
  minVersion: string | null;
  /** uploading — qisman (davom ettirish mumkin); failed — SHA-256 mos kelmadi. */
  status: "uploading" | "draft" | "published" | "archived" | "failed";
  chunkSize: number;
  expectedSize: number | null;
  expectedSha256: string | null;
  error: string | null;
  /** Serverdagi bo'laklar hajmi (yuklanayotganda — qancha qabul qilingan). */
  receivedBytes?: number;
  publishedAt: string | null;
  createdAt: string;
  uploadedByName?: string | null;
};

/** `POST /api/platform/desktop-releases/uploads` — bo'laklab yuklash sessiyasi. */
export type ReleaseUpload = DesktopRelease & { totalChunks: number; receivedChunks: number[]; receivedBytes: number };

/** Audit `details` — jsonb; ro'yxatda bir qatorli matn. */
export function formatDetails(details: unknown): string | null {
  if (details === null || details === undefined) return null;
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details);
  } catch {
    return null;
  }
}
