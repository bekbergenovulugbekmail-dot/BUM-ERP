/** Marshrut rejasi: OSRM javobi (yo'l masofasi, chiziq), OSRM ishlamasa — to'g'ri chiziq bo'yicha taxmin. Tarmoqsiz. */
import { afterEach, describe, expect, it } from "vitest";
import { distanceMeters } from "../src/shared/geo.js";
import { planRoute, routingProvider } from "../src/modules/routing/routing.service.js";

const original = { ...routingProvider };
afterEach(() => Object.assign(routingProvider, original));

// Urganch atrofida: ombor va 4 do'kon (shimol-janub chizig'ida aralash tartibda)
const origin = { latitude: 41.55, longitude: 60.63 };
const stops = [
  { id: "c", latitude: 41.58, longitude: 60.63 },
  { id: "a", latitude: 41.56, longitude: 60.63 },
  { id: "d", latitude: 41.59, longitude: 60.63 },
  { id: "b", latitude: 41.57, longitude: 60.63 },
];

describe("Marshrut rejasi", () => {
  it("OSRM o'chiq — to'g'ri chiziq bo'yicha eng qisqa tartib, masofa × koeffitsient, chiziq yo'q", async () => {
    routingProvider.osrmUrl = null;
    const plan = await planRoute(origin, stops);
    expect(plan.source).toBe("straight");
    expect(plan.stops.map((stop) => stop.id)).toEqual(["a", "b", "c", "d"]);
    expect(plan.stops.map((stop) => stop.position)).toEqual([1, 2, 3, 4]);
    const straight = distanceMeters(origin, stops[2]!);
    expect(plan.totalMeters).toBeGreaterThan(straight * 1.2);
    expect(plan.totalMeters).toBeLessThan(straight * 1.4);
    expect(plan.totalSeconds).toBeGreaterThan(0);
    expect(plan.geometry).toBeNull();
  });

  it("OSRM bor — jadval masofasi bo'yicha tartib, oraliqlar va chiziq yo'l javobidan; faqat koordinata yuboriladi", async () => {
    const urls: string[] = [];
    routingProvider.osrmUrl = "https://osrm.test";
    routingProvider.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/table/v1/driving/")) {
        // Yo'l bo'yicha: b do'koniga to'g'ridan-to'g'ri yo'l yo'q (aylanib o'tiladi) — a→c→b→d arzonroq
        const ids = ["origin", "c", "a", "d", "b"];
        const km: Record<string, number> = { "origin-a": 1, "a-c": 2, "c-b": 1, "b-d": 2, "a-b": 9, "b-c": 1, "c-d": 5 };
        const cost = (x: string, y: string) => (x === y ? 0 : (km[`${x}-${y}`] ?? km[`${y}-${x}`] ?? 20) * 1000);
        return Response.json({ code: "Ok", distances: ids.map((x) => ids.map((y) => cost(x, y))) });
      }
      return Response.json({
        code: "Ok",
        routes: [{
          distance: 6000,
          duration: 700,
          geometry: { coordinates: [[60.63, 41.55], [60.631, 41.56], [60.63, 41.59]] },
          legs: [{ distance: 1000, duration: 100 }, { distance: 2000, duration: 200 }, { distance: 1000, duration: 150 }, { distance: 2000, duration: 250 }],
        }],
      });
    }) as typeof fetch;

    const plan = await planRoute(origin, stops);
    expect(plan.source).toBe("road");
    expect(plan.stops.map((stop) => stop.id)).toEqual(["a", "c", "b", "d"]);
    expect(plan.stops.map((stop) => stop.legMeters)).toEqual([1000, 2000, 1000, 2000]);
    expect(plan.totalMeters).toBe(6000);
    expect(plan.totalSeconds).toBe(700);
    expect(plan.geometry).toEqual([[41.55, 60.63], [41.56, 60.631], [41.59, 60.63]]);
    expect(urls).toHaveLength(2);
    // Tartib bo'yicha: ombor, a, c, b, d (uzunlik,kenglik)
    expect(urls[1]).toContain("60.630000,41.550000;60.630000,41.560000;60.630000,41.580000;60.630000,41.570000;60.630000,41.590000");
  });

  it("OSRM xato qaytarsa yoki javob bermasa — taxminiy rejaga o'tadi (xato tashlamaydi)", async () => {
    routingProvider.osrmUrl = "https://osrm.test";
    routingProvider.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const plan = await planRoute(null, stops);
    expect(plan.source).toBe("straight");
    expect(plan.stops).toHaveLength(4);
    const order = plan.stops.map((stop) => stop.id).join("");
    expect(["abcd", "dcba"]).toContain(order);

    routingProvider.fetch = (async () => new Response("bad gateway", { status: 502 })) as typeof fetch;
    expect((await planRoute(origin, stops)).source).toBe("straight");
  });

  it("tartibni saqlash (optimize: false) va bo'sh ro'yxat", async () => {
    routingProvider.osrmUrl = null;
    const plan = await planRoute(origin, stops, { optimize: false });
    expect(plan.stops.map((stop) => stop.id)).toEqual(["c", "a", "d", "b"]);
    expect(await planRoute(origin, [])).toMatchObject({ stops: [], totalMeters: 0 });
  });
});
