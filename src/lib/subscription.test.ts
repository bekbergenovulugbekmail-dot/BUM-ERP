import { describe, expect, it } from "vitest";
import { ApiError } from "./api.ts";
import { durationText, formatDay, formatUzs, licenseLimitOf, subscriptionBlocked } from "./subscription.ts";
import { PIN_REGEX, pinFailureText } from "./session-lock.ts";

describe("obuna UI yordamchilari", () => {
  it("muddat matni bonus bilan", () => {
    expect(durationText({ durationMonths: 6, bonusMonths: 1, effectiveMonths: 7 })).toBe("6 oy + 1 oy bonus = 7 oy");
    expect(durationText({ durationMonths: 12, bonusMonths: 2, effectiveMonths: 14 })).toBe("12 oy + 2 oy bonus = 14 oy");
    expect(durationText({ durationMonths: 1, bonusMonths: 0, effectiveMonths: 1 })).toBe("1 oy");
  });

  it("sana va summa", () => {
    expect(formatDay("2026-08-01T10:00:00")).toBe("01.08.2026");
    expect(formatDay(null)).toBe("—");
    expect(formatUzs("600000.00").replace(/\s/g, "")).toBe("600000so'm");
  });

  it("faqat tugagan yoki bekor qilingan obuna bo'limlarni yopadi", () => {
    expect(subscriptionBlocked({ status: "expired" })).toBe(true);
    expect(subscriptionBlocked({ status: "cancelled" })).toBe(true);
    expect(subscriptionBlocked({ status: "trial" })).toBe(false);
    expect(subscriptionBlocked({ status: "active" })).toBe(false);
    expect(subscriptionBlocked(null)).toBe(false);
  });

  it("litsenziya limiti xatosi taniladi", () => {
    const counts = { includedTotal: 3, includedUsed: 3, includedAvailable: 0, additionalActive: 0, additionalPending: 0, additionalExpired: 0, totalActive: 3 };
    const limit = new ApiError(403, "FORBIDDEN", "3 ta included foydalanuvchi litsenziyasi ishlatilgan.", { reason: "license_limit_reached", counts });
    expect(licenseLimitOf(limit)).toEqual({ message: limit.message, counts });
    expect(licenseLimitOf(new ApiError(403, "FORBIDDEN", "x", { reason: "subscription_expired" }))).toBeNull();
    expect(licenseLimitOf(new ApiError(400, "BAD_REQUEST", "x", { reason: "license_limit_reached" }))).toBeNull();
    expect(licenseLimitOf(new Error("x"))).toBeNull();
  });
});

describe("ekran qulfi", () => {
  it("PIN formati va server sabablari", () => {
    expect(PIN_REGEX.test("1234")).toBe(true);
    expect(PIN_REGEX.test("12345678")).toBe(true);
    expect(PIN_REGEX.test("123")).toBe(false);
    expect(PIN_REGEX.test("12a4")).toBe(false);
    expect(pinFailureText("WRONG_PIN:3")).toBe("PIN noto'g'ri. Yana 3 ta urinish qoldi.");
    expect(pinFailureText("PIN_LOCKED:300")).toContain("5 daqiqa");
    expect(pinFailureText("PIN_NOT_SET")).toContain("PIN o'rnatilmagan");
    expect(pinFailureText("SESSION_MISMATCH")).toBe("Qulfni ochib bo'lmadi");
  });
});
