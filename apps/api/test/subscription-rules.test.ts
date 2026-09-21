/** Obuna qoidalari — sof funksiyalar (@bum/shared) va guard (bazasiz). */
import { describe, expect, it } from "vitest";
import {
  AppError,
  DEFAULT_SUBSCRIPTION_PLANS,
  addMonths,
  daysLeft,
  effectiveMonths,
  effectiveSubscriptionStatus,
  licenseDenial,
  licenseWarning,
  renewalWindow,
  trialWarning,
} from "@bum/shared";
import { assertTenantAccess, isAccessDenial } from "../src/modules/subscription/access.js";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const DAY = 86_400_000;

describe("Muddat hisobi", () => {
  it("oy qo'shish: 01.01.2026 + 7 oy = 01.08.2026; oy oxiri va kabisa yili", () => {
    expect(addMonths(utc("2026-01-01"), 7).toISOString()).toBe(utc("2026-08-01").toISOString());
    expect(addMonths(utc("2026-01-31"), 1).toISOString()).toBe(utc("2026-02-28").toISOString());
    expect(addMonths(utc("2028-01-31"), 1).toISOString()).toBe(utc("2028-02-29").toISOString());
    expect(addMonths(utc("2026-11-15"), 3).toISOString()).toBe(utc("2027-02-15").toISOString());
  });

  it("asosiy tariflar: 1, 3, 6+1=7, 12+3=15 oy; 3 ta included litsenziya; narxlar", () => {
    const main = DEFAULT_SUBSCRIPTION_PLANS.filter((plan) => plan.kind === "main");
    expect(main.map((plan) => [plan.price, effectiveMonths(plan), plan.includedLicenses])).toEqual([
      ["360000.00", 1, 3],
      ["900000.00", 3, 3],
      ["1800000.00", 7, 3],
      ["3600000.00", 15, 3],
    ]);
  });

  it("qo'shimcha litsenziya: 1, 3, 6+1=7, 12+2=14 oy; narxlar", () => {
    const additional = DEFAULT_SUBSCRIPTION_PLANS.filter((plan) => plan.kind === "additional_license");
    expect(additional.map((plan) => [plan.price, effectiveMonths(plan)])).toEqual([
      ["100000.00", 1],
      ["300000.00", 3],
      ["600000.00", 7],
      ["1200000.00", 14],
    ]);
  });

  it("uzaytirish: amaldagi — tugash sanasidan, tugagan yoki trial — hozirdan", () => {
    const now = utc("2026-03-10");
    expect(renewalWindow(utc("2026-05-01"), true, now, 7)).toEqual({ startAt: utc("2026-05-01"), expiresAt: utc("2026-12-01") });
    expect(renewalWindow(utc("2026-03-01"), true, now, 1)).toEqual({ startAt: now, expiresAt: utc("2026-04-10") });
    expect(renewalWindow(utc("2026-05-01"), false, now, 15)).toEqual({ startAt: now, expiresAt: utc("2027-06-10") });
    expect(renewalWindow(null, true, now, 1)).toEqual({ startAt: now, expiresAt: utc("2026-04-10") });
  });

  it("amaldagi holat: muddati o'tgan trial/active — expired; muddatsiz active — active; yozuv yo'q — expired", () => {
    const now = utc("2026-03-10");
    expect(effectiveSubscriptionStatus({ status: "trial", expiresAt: utc("2026-03-11") }, now)).toBe("trial");
    expect(effectiveSubscriptionStatus({ status: "trial", expiresAt: now }, now)).toBe("expired");
    expect(effectiveSubscriptionStatus({ status: "active", expiresAt: utc("2026-03-01") }, now)).toBe("expired");
    expect(effectiveSubscriptionStatus({ status: "active", expiresAt: null }, now)).toBe("active");
    expect(effectiveSubscriptionStatus({ status: "cancelled", expiresAt: null }, now)).toBe("cancelled");
    expect(effectiveSubscriptionStatus(null, now)).toBe("expired");
  });

  it("trial ogohlantirishi 10 / 5 / 3 / 1 kun chegaralarida", () => {
    const now = utc("2026-03-10");
    const at = (days: number) => new Date(now.getTime() + days * DAY);
    expect(trialWarning("trial", at(12), now)).toBeNull();
    expect([10, 6, 5, 4, 3, 2, 1, 0.2].map((days) => trialWarning("trial", at(days), now))).toEqual([10, 10, 5, 5, 3, 3, 1, 1]);
    expect(trialWarning("active", at(3), now)).toBeNull();
    expect(trialWarning("trial", at(-1), now)).toBeNull();
    expect(daysLeft(at(0.2), now)).toBe(1);
    expect(daysLeft(null, now)).toBeNull();
  });

  it("qo'shimcha litsenziya ogohlantirishi: faqat faol additional, xuddi shu chegaralar", () => {
    const now = utc("2026-03-10");
    const at = (days: number) => new Date(now.getTime() + days * DAY);
    const additional = (expiresAt: Date | null, status: "active" | "expired" | "pending_payment" = "active") =>
      licenseWarning({ type: "additional" as const, status, expiresAt }, now);
    expect(additional(at(12))).toBeNull();
    expect([10, 6, 5, 4, 3, 2, 1, 0.2].map((days) => additional(at(days)))).toEqual([10, 10, 5, 5, 3, 3, 1, 1]);
    // Tugagan yoki to'lovi tasdiqlanmagan litsenziya ogohlantirilmaydi — u boshqa xabar beradi
    expect(additional(at(3), "expired")).toBeNull();
    expect(additional(at(3), "pending_payment")).toBeNull();
    expect(additional(at(-1))).toBeNull();
    // Included litsenziya obuna bilan ketadi — alohida ogohlantirilmaydi (muddati bo'lsa ham)
    expect(licenseWarning({ type: "included", status: "active", expiresAt: at(2) }, now)).toBeNull();
    expect(additional(null)).toBeNull();
  });
});

describe("Kirish guard'i", () => {
  const now = utc("2026-03-10");
  const active = { status: "active" as const, expiresAt: utc("2026-04-10") };
  const expired = { status: "active" as const, expiresAt: utc("2026-03-01") };
  const included = { type: "included" as const, status: "active" as const, expiresAt: null };

  const reasonOf = (fn: () => void) => {
    try {
      fn();
      return null;
    } catch (error) {
      expect(isAccessDenial(error)).toBe(true);
      return ((error as AppError).details as { reason: string }).reason;
    }
  };

  it("business: obuna tugagan — rad; dashboard va account — ochiq", () => {
    expect(reasonOf(() => assertTenantAccess({ access: "business", isOwner: true, subscription: expired, license: null, now }))).toBe("subscription_expired");
    expect(reasonOf(() => assertTenantAccess({ access: "dashboard", isOwner: true, subscription: expired, license: null, now }))).toBeNull();
    expect(reasonOf(() => assertTenantAccess({ access: "account", isOwner: false, subscription: null, license: null, now }))).toBeNull();
    expect(reasonOf(() => assertTenantAccess({ access: "business", isOwner: true, subscription: null, license: null, now }))).toBe("subscription_expired");
  });

  it("trial tugagani alohida matn bilan", () => {
    try {
      assertTenantAccess({ access: "business", isOwner: true, subscription: { status: "trial", expiresAt: utc("2026-03-01") }, license: null, now });
      expect.unreachable();
    } catch (error) {
      expect((error as AppError).message).toContain("Sinov muddati");
    }
  });

  it("litsenziya: yo'q / kutilmoqda / tugagan / bekor — rad; egasi tekshirilmaydi", () => {
    const check = (license: Parameters<typeof licenseDenial>[0]) =>
      reasonOf(() => assertTenantAccess({ access: "business", isOwner: false, subscription: active, license, now }));
    expect(check(included)).toBeNull();
    expect(check(null)).toBe("license_required");
    expect(check({ type: "additional", status: "pending_payment", expiresAt: null })).toBe("license_pending_payment");
    expect(check({ type: "additional", status: "active", expiresAt: utc("2026-03-09") })).toBe("license_expired");
    expect(check({ type: "additional", status: "active", expiresAt: utc("2026-03-11") })).toBeNull();
    expect(check({ type: "included", status: "revoked", expiresAt: null })).toBe("license_revoked");
    expect(reasonOf(() => assertTenantAccess({ access: "business", isOwner: true, subscription: active, license: null, now }))).toBeNull();
    // Bosh sahifa ham litsenziyasiz xodimga yopiq
    expect(reasonOf(() => assertTenantAccess({ access: "dashboard", isOwner: false, subscription: expired, license: null, now }))).toBe("license_required");
  });

  it("boshqa 403 xatolar obuna rad etishi hisoblanmaydi", () => {
    expect(isAccessDenial(new AppError("FORBIDDEN", "Ruxsat yo'q"))).toBe(false);
    expect(isAccessDenial(new AppError("FORBIDDEN", "x", { reason: "company_required" }))).toBe(false);
    expect(isAccessDenial(new Error("x"))).toBe(false);
  });
});
