import { describe, expect, it } from "vitest";
import { todayIso } from "../src/modules/finance/cash.service.js";

/**
 * Biznes kuni — O'zbekiston vaqti (UTC+5), server UTC da ishlasa ham.
 *
 * Bu ilgari xato edi: `new Date().toISOString()` UTC sanasini berardi, shuning uchun mahalliy
 * vaqt bilan yarim tundan soat 5 gacha kassa harakati, agent marshruti va tashrif KECHAGI
 * kunga tushardi. Chegara aynan shu yerda qulflangan.
 */
describe("biznes kuni (UTC+5)", () => {
  it("mahalliy yarim tundan keyin YANGI kun boshlanadi", () => {
    // 2026-09-24 00:30 Toshkent = 2026-09-23 19:30 UTC
    expect(todayIso(new Date("2026-09-23T19:30:00Z"))).toBe("2026-09-24");
  });

  it("mahalliy yarim tunga bir daqiqa qolganda hali ESKI kun", () => {
    // 2026-09-23 23:59 Toshkent = 2026-09-23 18:59 UTC
    expect(todayIso(new Date("2026-09-23T18:59:00Z"))).toBe("2026-09-23");
  });

  it("kunduzi UTC sanasi bilan bir xil", () => {
    // 2026-09-24 13:00 Toshkent = 2026-09-24 08:00 UTC
    expect(todayIso(new Date("2026-09-24T08:00:00Z"))).toBe("2026-09-24");
  });

  it("marshrut hafta kuni ham shu chegaradan olinadi", () => {
    // Payshanba 00:30 Toshkent — agent payshanba marshrutini ko'rishi kerak (chorshanbanikini emas)
    const iso = todayIso(new Date("2026-09-23T19:30:00Z"));
    expect(new Date(`${iso}T00:00:00Z`).getUTCDay()).toBe(4);
  });
});
