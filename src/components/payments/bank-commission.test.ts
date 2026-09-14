import { describe, expect, it } from "vitest";
import { bankCommissionPreview } from "./bank-commission.ts";

describe("bank komissiyasini oldindan ko'rsatish", () => {
  it("1% — 1 000 000 dan 10 000, hisobdan jami 1 010 000; 0.25% — 100 000 dan 250; tiyinda yarmidan yuqoriga", () => {
    expect(bankCommissionPreview("1000000", "1.00")).toEqual({ fee: 10000, total: 1010000, percent: 1 });
    expect(bankCommissionPreview(100000, "0.25")).toEqual({ fee: 250, total: 100250, percent: 0.25 });
    expect(bankCommissionPreview("333.33", "0.5")?.fee).toBe(1.67);
    expect(bankCommissionPreview("1 000 000", "2")).toEqual({ fee: 20000, total: 1020000, percent: 2 });
  });

  it("komissiya yo'q yoki summa noto'g'ri — ko'rsatilmaydi", () => {
    expect(bankCommissionPreview("1000", "0")).toBeNull();
    expect(bankCommissionPreview("", "1")).toBeNull();
    expect(bankCommissionPreview("abc", "1")).toBeNull();
    expect(bankCommissionPreview(null, "1")).toBeNull();
  });
});
