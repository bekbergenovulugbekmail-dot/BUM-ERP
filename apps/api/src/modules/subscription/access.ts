/**
 * Obuna va litsenziya bo'yicha kirish qoidasi — server guard zanjiri:
 *   Request → Auth (sessiya) → Company (faol a'zolik) → Subscription/Trial → License → Role/Permission → amal.
 *
 * Kirish darajalari (`requireTenant(..., { access })`):
 *   business  — oddiy biznes amallari (standart): obuna (trial/active) va foydalanuvchi litsenziyasi shart;
 *   dashboard — bosh sahifa: obuna tugagan bo'lsa ham ochiq (ekranda "obuna tugagan" xabari), litsenziya shart;
 *   account   — kompaniya konteksti va obuna sahifasi: faqat faol a'zolik (obunani uzaytirish uchun ochiq bo'lishi kerak).
 *
 * Ma'lumot hech qachon o'chirilmaydi — faqat kirish yopiladi; uzaytirilgach avvalgidek ochiladi.
 * Obuna holati va litsenziya faqat bazadan olinadi — so'rovdagi hech qanday maydonga ishonilmaydi.
 */
import {
  ACCESS_DENIAL_REASONS,
  AppError,
  effectiveSubscriptionStatus,
  licenseDenial,
  subscriptionUsable,
  type AccessDenialReason,
  type LicenseSnapshot,
  type SubscriptionStatus,
} from "@bum/shared";

export type TenantAccess = "business" | "dashboard" | "account";

export type SubscriptionSnapshot = { status: SubscriptionStatus; expiresAt: Date | null };

const MESSAGES: Record<AccessDenialReason, string> = {
  subscription_expired: "BUM ERP obunangiz muddati tugagan. Obunani uzaytiring.",
  subscription_cancelled: "BUM ERP obunasi bekor qilingan. Obunani qayta faollashtiring.",
  license_required: "Sizda BUM ERP litsenziyasi yo'q. Kompaniya egasiga murojaat qiling.",
  license_pending_payment: "Litsenziyangiz to'lovi hali tasdiqlanmagan. Kompaniya egasiga murojaat qiling.",
  license_expired: "Litsenziyangiz muddati tugagan. Kompaniya egasiga murojaat qiling.",
  license_revoked: "Litsenziyangiz bekor qilingan. Kompaniya egasiga murojaat qiling.",
};

const TRIAL_EXPIRED = "Sinov muddati tugagan. BUM ERP obunasini faollashtiring.";

export function accessDenied(reason: AccessDenialReason, subscription?: SubscriptionSnapshot | null): AppError {
  const message = reason === "subscription_expired" && subscription?.status === "trial" ? TRIAL_EXPIRED : MESSAGES[reason];
  return new AppError("FORBIDDEN", message, {
    reason,
    ...(subscription ? { expiresAt: subscription.expiresAt?.toISOString() ?? null } : {}),
  });
}

/** Obuna yaroqsiz bo'lsa — sabab (yozuv yo'q ham "tugagan" hisoblanadi). */
export function subscriptionDenial(subscription: SubscriptionSnapshot | null, now = new Date()): AccessDenialReason | null {
  const status = effectiveSubscriptionStatus(subscription, now);
  if (subscriptionUsable(status)) return null;
  return status === "cancelled" ? "subscription_cancelled" : "subscription_expired";
}

export function assertTenantAccess(input: {
  access: TenantAccess;
  isOwner: boolean;
  subscription: SubscriptionSnapshot | null;
  license: LicenseSnapshot | null;
  now?: Date;
}): void {
  if (input.access === "account") return;
  const now = input.now ?? new Date();
  if (input.access === "business") {
    const denial = subscriptionDenial(input.subscription, now);
    if (denial) throw accessDenied(denial, input.subscription);
  }
  // Egasi litsenziyasiz qolmaydi: kompaniya yaratilganda included litsenziya beriladi va uni bo'shatib bo'lmaydi
  if (input.isOwner) return;
  const denial = licenseDenial(input.license, now);
  if (denial) throw accessDenied(denial);
}

/** Obuna/litsenziya sababli rad etishmi (kassa sinxronida amal saqlanib, keyin qayta yuborilishi uchun). */
export function isAccessDenial(error: unknown): error is AppError {
  if (!(error instanceof AppError) || error.code !== "FORBIDDEN") return false;
  const reason = (error.details as { reason?: unknown } | undefined)?.reason;
  return typeof reason === "string" && (ACCESS_DENIAL_REASONS as readonly string[]).includes(reason);
}
