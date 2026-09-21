/**
 * Obuna va litsenziya (Subscription & License) — umumiy qoidalar.
 *
 * Employee ≠ User ≠ License:
 *  - xodim (HR) dasturdan foydalanmasligi mumkin — "bepul", login ham, litsenziya ham yo'q;
 *  - dasturdan foydalanadigan xodim — foydalanuvchi (login + parol + PIN), a'zolik, rol va litsenziya.
 * Kompaniya obunasi 3 ta "included" litsenziya beradi (egasi — 1-si); undan keyingi har foydalanuvchiga alohida
 * "additional" litsenziya (o'z muddati bilan). Hisob-kitob serverda; bu yerda sof funksiyalar (API va web bir xil).
 * Sanalar UTC da hisoblanadi (server vaqti; qurilma vaqtiga ishonilmaydi).
 */

export const TRIAL_DAYS = 25;
export const TRIAL_INCLUDED_LICENSES = 3;
/** Trial tugashiga shuncha kun qolganda ogohlantirish. */
export const TRIAL_WARNING_DAYS = [10, 5, 3, 1] as const;
/** Qo'shimcha litsenziya tugashiga shuncha kun qolganda ogohlantirish (trial bilan bir xil bosqichlar). */
export const LICENSE_WARNING_DAYS = [10, 5, 3, 1] as const;

export const SUBSCRIPTION_STATUSES = ["trial", "active", "expired", "cancelled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_PLAN_KINDS = ["main", "additional_license"] as const;
export type SubscriptionPlanKind = (typeof SUBSCRIPTION_PLAN_KINDS)[number];

export const LICENSE_TYPES = ["included", "additional"] as const;
export type LicenseType = (typeof LICENSE_TYPES)[number];

/** pending_payment — qo'shimcha litsenziya to'lovi tasdiqlanmagan (kirish yopiq). */
export const LICENSE_STATUSES = ["active", "pending_payment", "expired", "revoked"] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export const SUBSCRIPTION_PAYMENT_KINDS = ["subscription", "license"] as const;
export type SubscriptionPaymentKind = (typeof SUBSCRIPTION_PAYMENT_KINDS)[number];

export const SUBSCRIPTION_PAYMENT_STATUSES = ["pending", "paid", "cancelled"] as const;
export type SubscriptionPaymentStatus = (typeof SUBSCRIPTION_PAYMENT_STATUSES)[number];

/** Kirish rad etilganda `details.reason`. */
export const ACCESS_DENIAL_REASONS = [
  "subscription_expired",
  "subscription_cancelled",
  "license_required",
  "license_pending_payment",
  "license_expired",
  "license_revoked",
] as const;
export type AccessDenialReason = (typeof ACCESS_DENIAL_REASONS)[number];

/** Yangi dasturdan foydalanuvchi qo'shishda included litsenziyalar tugagan — qo'shimcha litsenziya tarifi tanlanadi. */
export const LICENSE_LIMIT_REACHED = "license_limit_reached";

/** PIN — 4–8 raqam (faqat ochiq sessiya qulfini ochadi, parol o'rnini bosmaydi). */
export const PIN_PATTERN = /^\d{4,8}$/;

export type PlanDefinition = {
  code: string;
  kind: SubscriptionPlanKind;
  name: string;
  price: string;
  durationMonths: number;
  bonusMonths: number;
  includedLicenses: number;
  sortOrder: number;
};

/** Boshlang'ich tariflar (migratsiya shu ro'yxat bilan to'ldiradi; keyin — faqat bazadan, UI hardcode qilmaydi). */
export const DEFAULT_SUBSCRIPTION_PLANS: readonly PlanDefinition[] = [
  { code: "main-1m", kind: "main", name: "1 oylik", price: "360000.00", durationMonths: 1, bonusMonths: 0, includedLicenses: 3, sortOrder: 1 },
  { code: "main-3m", kind: "main", name: "3 oylik", price: "900000.00", durationMonths: 3, bonusMonths: 0, includedLicenses: 3, sortOrder: 2 },
  { code: "main-6m", kind: "main", name: "6 oylik", price: "1800000.00", durationMonths: 6, bonusMonths: 1, includedLicenses: 3, sortOrder: 3 },
  { code: "main-12m", kind: "main", name: "12 oylik", price: "3600000.00", durationMonths: 12, bonusMonths: 3, includedLicenses: 3, sortOrder: 4 },
  { code: "license-1m", kind: "additional_license", name: "Qo'shimcha xodim — 1 oy", price: "100000.00", durationMonths: 1, bonusMonths: 0, includedLicenses: 0, sortOrder: 11 },
  { code: "license-3m", kind: "additional_license", name: "Qo'shimcha xodim — 3 oy", price: "300000.00", durationMonths: 3, bonusMonths: 0, includedLicenses: 0, sortOrder: 12 },
  { code: "license-6m", kind: "additional_license", name: "Qo'shimcha xodim — 6 oy", price: "600000.00", durationMonths: 6, bonusMonths: 1, includedLicenses: 0, sortOrder: 13 },
  { code: "license-12m", kind: "additional_license", name: "Qo'shimcha xodim — 12 oy", price: "1200000.00", durationMonths: 12, bonusMonths: 2, includedLicenses: 0, sortOrder: 14 },
];

const DAY_MS = 86_400_000;

export const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

/**
 * Oy qo'shish (UTC). Oyda bunday kun bo'lmasa — oyning oxirgi kuni: 31-yanvar + 1 oy = 28 (29)-fevral.
 * 01.01.2026 + 7 oy = 01.08.2026.
 */
export function addMonths(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const target = new Date(date.getTime());
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

/** Amaldagi muddat: asosiy + bonus (6 oy + 1 = 7; 12 oy + 3 = 15; qo'shimcha 12 oy + 2 = 14). */
export const effectiveMonths = (plan: { durationMonths: number; bonusMonths: number }) => plan.durationMonths + plan.bonusMonths;

/**
 * Uzaytirish oralig'i: amalda (muddati o'tmagan) bo'lsa — joriy tugash sanasidan, aks holda (tugagan yoki trial'dan
 * pullik) — hozirdan.
 */
export function renewalWindow(currentExpiresAt: Date | null, continuing: boolean, now: Date, months: number) {
  const startAt = continuing && currentExpiresAt && currentExpiresAt.getTime() > now.getTime() ? currentExpiresAt : now;
  return { startAt, expiresAt: addMonths(startAt, months) };
}

const toDate = (value: Date | string | null) => (value === null ? null : value instanceof Date ? value : new Date(value));

/** Obunaning amaldagi holati: muddati o'tgan trial/active — expired (saqlangan holat keyinroq yangilanadi). */
export function effectiveSubscriptionStatus(
  subscription: { status: SubscriptionStatus; expiresAt: Date | string | null } | null,
  now = new Date(),
): SubscriptionStatus {
  if (!subscription) return "expired";
  if (subscription.status === "cancelled" || subscription.status === "expired") return subscription.status;
  const expiresAt = toDate(subscription.expiresAt);
  return expiresAt !== null && expiresAt.getTime() <= now.getTime() ? "expired" : subscription.status;
}

export const subscriptionUsable = (status: SubscriptionStatus) => status === "trial" || status === "active";

/** Qolgan to'liq bo'lmagan kunlar (yuqoriga yaxlitlanadi); muddatsiz — null. */
export function daysLeft(expiresAt: Date | string | null, now = new Date()): number | null {
  const date = toDate(expiresAt);
  return date === null ? null : Math.ceil((date.getTime() - now.getTime()) / DAY_MS);
}

/** Qolgan kunga mos ogohlantirish chegarasi (eng kichigi) — muddatsiz yoki tugagan bo'lsa null. */
function warningThreshold(thresholds: readonly number[], expiresAt: Date | string | null, now: Date): number | null {
  const left = daysLeft(expiresAt, now);
  if (left === null || left <= 0) return null;
  return [...thresholds].sort((a, b) => a - b).find((threshold) => left <= threshold) ?? null;
}

/** Trial ogohlantirish chegarasi (10, 5, 3 yoki 1) — ogohlantirish kerak bo'lmasa null. */
export function trialWarning(status: SubscriptionStatus, expiresAt: Date | string | null, now = new Date()): number | null {
  if (status !== "trial") return null;
  return warningThreshold(TRIAL_WARNING_DAYS, expiresAt, now);
}

export type LicenseSnapshot = { type: LicenseType; status: LicenseStatus; expiresAt: Date | string | null };

/**
 * Qo'shimcha litsenziya ogohlantirish chegarasi (10, 5, 3 yoki 1) — kerak bo'lmasa null.
 * Included litsenziya kompaniya obunasi bilan ketadi, alohida ogohlantirilmaydi.
 */
export function licenseWarning(license: LicenseSnapshot, now = new Date()): number | null {
  if (license.type !== "additional" || license.status !== "active") return null;
  return warningThreshold(LICENSE_WARNING_DAYS, license.expiresAt, now);
}

/**
 * Foydalanuvchi litsenziyasi bo'yicha rad etish sababi (null — yaroqli). Included litsenziya kompaniya obunasiga
 * bog'liq — obuna alohida tekshiriladi; additional — o'z muddati bilan.
 */
export function licenseDenial(license: LicenseSnapshot | null, now = new Date()): AccessDenialReason | null {
  if (!license) return "license_required";
  if (license.status === "revoked") return "license_revoked";
  if (license.status === "pending_payment") return "license_pending_payment";
  if (license.status === "expired") return "license_expired";
  if (license.type === "additional") {
    const expiresAt = toDate(license.expiresAt);
    if (expiresAt !== null && expiresAt.getTime() <= now.getTime()) return "license_expired";
  }
  return null;
}
