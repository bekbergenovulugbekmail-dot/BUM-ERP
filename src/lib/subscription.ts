/**
 * Obuna va litsenziya — `/api/subscription` javob tiplari va UI yordamchilari.
 * Qoidalar (muddat, holat) serverda; bu yerda faqat ko'rsatish. Manba: apps/api/src/modules/subscription/*.
 */
import type { AccessDenialReason, LicenseStatus, LicenseType, SubscriptionStatus } from "@bum/shared";
import { LICENSE_LIMIT_REACHED } from "@bum/shared";
import { ApiError } from "@/lib/api.ts";

export type SubscriptionPlan = {
  id: string;
  code: string;
  kind: "main" | "additional_license";
  name: string;
  price: string;
  currency: string;
  durationMonths: number;
  bonusMonths: number;
  effectiveMonths: number;
  includedLicenses: number;
};

export type PlansResponse = { main: SubscriptionPlan[]; additional: SubscriptionPlan[] };

export type LicenseCounts = {
  includedTotal: number;
  includedUsed: number;
  includedAvailable: number;
  additionalActive: number;
  additionalPending: number;
  additionalExpired: number;
  totalActive: number;
};

export type SubscriptionPayment = {
  id: string;
  companyId: string;
  kind: "subscription" | "license";
  planId: string;
  planName: string;
  planCode: string;
  licenseId: string | null;
  amount: string;
  currency: string;
  status: "pending" | "paid" | "cancelled";
  reference: string | null;
  note: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  licenseUserName: string | null;
  licenseUserPhone: string | null;
  companyName?: string;
};

export type SubscriptionOverview = {
  subscription: {
    id: string;
    status: SubscriptionStatus;
    isTrial: boolean;
    planId: string | null;
    planCode: string | null;
    planName: string | null;
    startAt: string;
    expiresAt: string | null;
    baseDurationMonths: number;
    bonusMonths: number;
    effectiveMonths: number;
    includedLicenses: number;
    daysLeft: number | null;
    trialWarning: number | null;
  } | null;
  licenses: LicenseCounts | null;
  pendingPayments: SubscriptionPayment[];
};

export type CompanyLicense = {
  id: string;
  userId: string;
  employeeId: string | null;
  licenseType: LicenseType;
  status: LicenseStatus;
  price: string;
  startAt: string | null;
  expiresAt: string | null;
  assignedAt: string;
  planId: string | null;
  planName: string | null;
  userName: string | null;
  userPhone: string;
  companyRole: string | null;
  memberActive: boolean | null;
  employeeName: string | null;
  employeeCode: string | null;
  pendingPaymentId: string | null;
  isOwner: boolean;
};

export type SubscriptionHistory = {
  subscriptions: {
    id: string;
    event: string;
    status: SubscriptionStatus;
    planName: string | null;
    price: string;
    durationMonths: number;
    bonusMonths: number;
    effectiveMonths: number;
    startAt: string | null;
    expiresAt: string | null;
    includedLicenses: number | null;
    paymentReference: string | null;
    createdAt: string;
    createdByName: string | null;
  }[];
  licenses: {
    id: string;
    licenseId: string;
    event: string;
    licenseType: LicenseType;
    status: LicenseStatus;
    planName: string | null;
    price: string;
    startAt: string | null;
    expiresAt: string | null;
    createdAt: string;
    userName: string | null;
    userPhone: string | null;
    employeeName: string | null;
    actorName: string | null;
  }[];
};

export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  trial: "Sinov (trial)",
  active: "Faol",
  expired: "Muddati tugagan",
  cancelled: "Bekor qilingan",
};

export const LICENSE_TYPE_LABEL: Record<LicenseType, string> = { included: "Included", additional: "Qo'shimcha" };

export const LICENSE_STATUS_LABEL: Record<LicenseStatus, string> = {
  active: "Faol",
  pending_payment: "To'lov kutilmoqda",
  expired: "Muddati tugagan",
  revoked: "Bekor qilingan",
};

export const ACCESS_DENIAL_LABEL: Record<AccessDenialReason, string> = {
  subscription_expired: "BUM ERP obunangiz muddati tugagan.",
  subscription_cancelled: "BUM ERP obunasi bekor qilingan.",
  license_required: "Sizda BUM ERP litsenziyasi yo'q.",
  license_pending_payment: "Litsenziyangiz to'lovi hali tasdiqlanmagan.",
  license_expired: "Litsenziyangiz muddati tugagan.",
  license_revoked: "Litsenziyangiz bekor qilingan.",
};

export const HISTORY_EVENT_LABEL: Record<string, string> = {
  trial_started: "Trial boshlandi",
  activated: "Faollashtirildi",
  renewed: "Uzaytirildi",
  expired: "Muddati tugadi",
  cancelled: "Bekor qilindi",
  licenses_changed: "Litsenziyalar soni o'zgardi",
  legacy_migrated: "Tizimga ko'chirildi",
  assigned: "Berildi",
  pending_payment: "To'lov kutilmoqda",
  revoked: "Bekor qilindi",
};

export const formatUzs = (value: string | number) =>
  `${new Intl.NumberFormat("uz-UZ").format(Math.round(Number(value) || 0))} so'm`;

/** 01.08.2026 */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

/** "6 oy + 1 oy bonus = 7 oy" */
export function durationText(plan: Pick<SubscriptionPlan, "durationMonths" | "bonusMonths" | "effectiveMonths">): string {
  return plan.bonusMonths > 0
    ? `${plan.durationMonths} oy + ${plan.bonusMonths} oy bonus = ${plan.effectiveMonths} oy`
    : `${plan.durationMonths} oy`;
}

/** Tugagan yoki bekor qilingan obuna — faqat Bosh sahifa va Obuna ochiq. */
export function subscriptionBlocked(subscription: { status: SubscriptionStatus } | null | undefined): boolean {
  return subscription?.status === "expired" || subscription?.status === "cancelled";
}

/** Har bosishda yangi kalit — takroriy yuborish serverda ikkinchi so'rov yaratmaydi. */
export const newIdempotencyKey = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

/** Yangi dasturdan foydalanuvchi uchun included litsenziya tugagan (server `license_limit_reached`). */
export function licenseLimitOf(error: unknown): { message: string; counts: LicenseCounts | null } | null {
  if (!(error instanceof ApiError) || error.status !== 403) return null;
  const details = error.details as { reason?: string; counts?: LicenseCounts } | undefined;
  if (details?.reason !== LICENSE_LIMIT_REACHED) return null;
  return { message: error.message, counts: details.counts ?? null };
}
