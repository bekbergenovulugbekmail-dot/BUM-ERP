import { describe, expect, it } from "vitest";
import { fromApiDay, toApiDay } from "./types.ts";

/**
 * Hafta kuni ikki tartibda yuritiladi va ular ARALASHIB KETSA agent boshqa kunning
 * marshrutini ko'radi (payshanba o'rniga juma). Shuning uchun konvensiya shu yerda qulflangan:
 *
 *  - UI (tugmalar "Du Se Ch Pa Ju Sh Ya"): 0 = dushanba … 6 = yakshanba
 *  - API va baza (`distribution_routes.days`): 0 = yakshanba … 6 = shanba, ya'ni `Date#getDay()`
 *
 * Server agentga marshrutni `getUTCDay()` bilan beradi (`sales-agent/stores.service.ts`),
 * shuning uchun UI dan saqlangan qiymat AYNAN `getDay()` bilan bir xil bo'lishi shart.
 */
const UI_DAYS = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];

/** 2026-yil sentabr: 21 — dushanba … 27 — yakshanba. */
const WEEK = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"];

describe("hafta kuni: UI ↔ API", () => {
  it("UI tugmasi saqlangach o'sha kunning `getDay()` qiymatiga aylanadi", () => {
    for (const [uiDay, iso] of WEEK.entries()) {
      const realWeekday = new Date(`${iso}T00:00:00Z`).getUTCDay();
      expect(toApiDay(uiDay), `${UI_DAYS[uiDay]} (${iso})`).toBe(realWeekday);
    }
  });

  it("payshanba 4, juma 5 — eng ko'p adashtiradigan juftlik", () => {
    expect(toApiDay(UI_DAYS.indexOf("Pa"))).toBe(4);
    expect(toApiDay(UI_DAYS.indexOf("Ju"))).toBe(5);
    expect(toApiDay(UI_DAYS.indexOf("Ya"))).toBe(0);
  });

  it("orqaga o'girish — aynan o'sha tugma", () => {
    for (let uiDay = 0; uiDay < 7; uiDay += 1) {
      expect(fromApiDay(toApiDay(uiDay))).toBe(uiDay);
    }
    for (let apiDay = 0; apiDay < 7; apiDay += 1) {
      expect(toApiDay(fromApiDay(apiDay))).toBe(apiDay);
    }
  });
});
