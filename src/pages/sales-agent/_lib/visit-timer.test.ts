import { describe, expect, it } from "vitest";
import { effectiveVisitSeconds, remainingVisitSeconds } from "./visit-timer.ts";

const start = Date.parse("2026-09-12T08:00:00Z");
const at = (minutes: number) => start + minutes * 60_000;
const iso = (minutes: number) => new Date(at(minutes)).toISOString();

describe("tashrif taymeri", () => {
  it("vitrina rasmisiz taymer boshlanmaydi", () => {
    const visit = { timerStartedAt: null, pausedSeconds: 0, outsideSince: null };
    expect(effectiveVisitSeconds(visit, at(30), "pause")).toBe(0);
    expect(remainingVisitSeconds(visit, at(30), "pause", 10)).toBe(600);
  });

  it("to'xtatilgan vaqt va hozir hududdan tashqaridagi vaqt ('pause') hisoblanmaydi", () => {
    const visit = { timerStartedAt: iso(0), pausedSeconds: 120, outsideSince: iso(6) };
    // 8 daqiqa − 2 daqiqa pauza − 2 daqiqa hozir tashqarida = 4 daqiqa
    expect(effectiveVisitSeconds(visit, at(8), "pause")).toBe(240);
    expect(remainingVisitSeconds(visit, at(8), "pause", 10)).toBe(360);
    // "flag" siyosatida tashqaridagi joriy vaqt ham hisoblanadi
    expect(effectiveVisitSeconds(visit, at(8), "flag")).toBe(360);
  });

  it("minimal vaqt o'tgach qolgan vaqt 0", () => {
    const visit = { timerStartedAt: iso(0), pausedSeconds: 0, outsideSince: null };
    expect(remainingVisitSeconds(visit, at(12), "pause", 10)).toBe(0);
  });
});
