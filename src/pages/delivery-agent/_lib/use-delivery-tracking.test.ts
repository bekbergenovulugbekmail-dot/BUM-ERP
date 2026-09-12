import { beforeEach, describe, expect, it } from "vitest";
import { LOCATION_BUFFER_KEY, readBuffer, roughMeters, shouldBuffer, writeBuffer, type BufferedPoint } from "./use-delivery-tracking.ts";

const point = (latitude: number, longitude: number, recordedAt: string): BufferedPoint => ({ latitude, longitude, accuracy: 10, recordedAt });

describe("yetkazuvchi lokatsiya buferi", () => {
  beforeEach(() => localStorage.clear());

  it("taxminiy masofa: 0.001° kenglik ≈ 111 m", () => {
    expect(Math.round(roughMeters({ latitude: 41.3, longitude: 69.24 }, { latitude: 41.301, longitude: 69.24 }))).toBe(111);
  });

  it("oraliq o'tganda yoki siljish chegarasidan ko'p yurilganda buferga olinadi", () => {
    const first = point(41.3, 69.24, "2026-09-13T08:00:00Z");
    expect(shouldBuffer(null, first, 60, 50)).toBe(true);
    expect(shouldBuffer(first, point(41.3001, 69.24, "2026-09-13T08:00:20Z"), 60, 50)).toBe(false);
    expect(shouldBuffer(first, point(41.3001, 69.24, "2026-09-13T08:01:00Z"), 60, 50)).toBe(true);
    expect(shouldBuffer(first, point(41.3006, 69.24, "2026-09-13T08:00:20Z"), 60, 50)).toBe(true);
  });

  it("bufer 200 nuqtagacha saqlanadi (eng eskilari tushib qoladi)", () => {
    writeBuffer(Array.from({ length: 205 }, (_, i) => point(41.3, 69.24, new Date(Date.UTC(2026, 8, 13, 8, 0, i)).toISOString())));
    const buffer = readBuffer();
    expect(buffer).toHaveLength(200);
    expect(buffer[0]!.recordedAt).toBe("2026-09-13T08:00:05.000Z");
    localStorage.setItem(LOCATION_BUFFER_KEY, "buzilgan");
    expect(readBuffer()).toEqual([]);
  });
});
