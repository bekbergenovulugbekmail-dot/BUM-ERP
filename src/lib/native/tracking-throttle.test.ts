import { describe, expect, it } from "vitest";
import { sampleIntervalMs } from "./geolocation.ts";
import { flushDelayMs } from "@/pages/delivery-agent/_lib/use-delivery-tracking.ts";
import { locationDue } from "@/pages/sales-agent/_lib/use-location-tracking.ts";

describe("GPS zaryad tejash", () => {
  it("GPS o'lchov oralig'i siyosatning uchdan biri, 10–30 s", () => {
    expect(sampleIntervalMs(15)).toBe(10_000);
    expect(sampleIntervalMs(60)).toBe(20_000);
    expect(sampleIntervalMs(3600)).toBe(30_000);
  });

  it("dostavka: paket 30–120 s da bir marta, bufer to'lsa darhol", () => {
    const now = 1_000_000;
    expect(flushDelayMs(now, 0, 60, 1)).toBe(0);
    expect(flushDelayMs(now, now - 10_000, 60, 3)).toBe(50_000);
    expect(flushDelayMs(now, now - 10_000, 15, 3)).toBe(20_000);
    expect(flushDelayMs(now, now - 10_000, 3600, 3)).toBe(110_000);
    expect(flushDelayMs(now, now - 10_000, 60, 20)).toBe(0);
  });

  it("savdo agenti: oraliq o'tsa yoki 50 m siljisa, lekin 15 s dan tez emas", () => {
    const point = { latitude: 41.3, longitude: 69.24 };
    const far = { latitude: 41.301, longitude: 69.24 }; // ~111 m
    const now = 1_000_000;
    expect(locationDue(null, now, point, 60)).toBe(true);
    expect(locationDue({ at: now - 5_000, point }, now, far, 60)).toBe(false);
    expect(locationDue({ at: now - 16_000, point }, now, far, 60)).toBe(true);
    expect(locationDue({ at: now - 30_000, point }, now, point, 60)).toBe(false);
    expect(locationDue({ at: now - 61_000, point }, now, point, 60)).toBe(true);
  });
});
