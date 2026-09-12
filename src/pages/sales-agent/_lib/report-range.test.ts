import { describe, expect, it } from "vitest";
import { presetRange } from "./report-range.ts";

describe("hisobot davri", () => {
  const now = new Date(2026, 2, 3, 15, 30); // 3-mart 2026

  it("bugun, 7 kun va joriy oy", () => {
    expect(presetRange("today", now)).toEqual({ from: "2026-03-03", to: "2026-03-03" });
    expect(presetRange("week", now)).toEqual({ from: "2026-02-25", to: "2026-03-03" });
    expect(presetRange("month", now)).toEqual({ from: "2026-03-01", to: "2026-03-03" });
  });

  it("o'tgan oy — oyning oxirgi kunigacha (kabisa bo'lmagan fevral)", () => {
    expect(presetRange("last_month", now)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(presetRange("last_month", new Date(2026, 0, 10))).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });
});
