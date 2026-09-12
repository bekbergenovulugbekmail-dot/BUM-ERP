import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { formatClock, formatDistance, promotionRule } from "./types.ts";

const t = ((key: string, options?: Record<string, unknown>) => `${key}:${JSON.stringify(options ?? {})}`) as unknown as TFunction<"agent">;

describe("agent formatlari", () => {
  it("taymer", () => {
    expect(formatClock(245)).toBe("4:05");
    expect(formatClock(3729)).toBe("1:02:09");
    expect(formatClock(-5)).toBe("0:00");
  });

  it("masofa: metr va kilometr, noma'lum", () => {
    expect(formatDistance(null, t)).toBeNull();
    expect(formatDistance(87.4, t)).toBe('distance.m:{"value":87}');
    expect(formatDistance(1700, t)).toContain("distance.km");
  });

  it("aksiya qoidasi matni", () => {
    expect(promotionRule({ type: "buy_x_get_y", minQuantity: "10.0000", freeQuantity: "1.0000", discountPercent: null }, t)).toBe(
      'promo.rule.bxgy:{"min":10,"free":1}',
    );
    expect(promotionRule({ type: "percent_discount", minQuantity: "5.0000", freeQuantity: null, discountPercent: "10.00" }, t)).toBe(
      'promo.rule.percent:{"min":5,"percent":10}',
    );
  });
});
