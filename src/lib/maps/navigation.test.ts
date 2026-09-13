import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDistance } from "./index.ts";
import { GOOGLE_MAX_WAYPOINTS, googleDirectionsUrls, navigateToUrl, yandexRouteUrl } from "./navigation.ts";
import { routeLine, type RoutePlan } from "./route-plan.ts";

const point = (i: number) => ({ latitude: 41.5 + i / 100, longitude: 60.6 + i / 100 });

afterEach(() => vi.unstubAllGlobals());

describe("navigatsiya havolalari", () => {
  it("Google Maps: joriy joydan, oraliq nuqtalar tartibda, 9 tadan ko'p bo'lsa — bo'laklar zanjiri", () => {
    const [single] = googleDirectionsUrls(null, [point(1), point(2), point(3)]);
    const url = new URL(single!);
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(url.searchParams.get("origin")).toBeNull();
    expect(url.searchParams.get("destination")).toBe("41.530000,60.630000");
    expect(url.searchParams.get("waypoints")).toBe("41.510000,60.610000|41.520000,60.620000");
    expect(url.searchParams.get("travelmode")).toBe("driving");

    const stops = Array.from({ length: 23 }, (_, i) => point(i));
    const urls = googleDirectionsUrls(point(-1), stops).map((item) => new URL(item));
    expect(urls).toHaveLength(3);
    expect(urls[0]!.searchParams.get("origin")).toBe("41.490000,60.590000");
    expect(urls[0]!.searchParams.get("waypoints")!.split("|")).toHaveLength(GOOGLE_MAX_WAYPOINTS);
    // Keyingi bo'lak oldingisi tugagan nuqtadan boshlanadi; hamma nuqtalar bir martadan
    expect(urls[1]!.searchParams.get("origin")).toBe(urls[0]!.searchParams.get("destination"));
    const visited = urls.flatMap((item) => [...(item.searchParams.get("waypoints")?.split("|") ?? []), item.searchParams.get("destination")!]);
    expect(visited).toEqual(stops.map((stop) => `${stop.latitude.toFixed(6)},${stop.longitude.toFixed(6)}`));
  });

  it("Yandex: bitta marshrut, boshlanish berilmasa — joriy joydan", () => {
    expect(yandexRouteUrl(null, [point(1), point(2)])).toBe("https://yandex.uz/maps/?rtext=~41.510000,60.610000~41.520000,60.620000&rtt=auto");
    expect(yandexRouteUrl(point(0), [point(1)])).toBe("https://yandex.uz/maps/?rtext=41.500000,60.600000~41.510000,60.610000&rtt=auto");
  });

  it("bitta manzil: Android — geo: (navigator tanlanadi), kompyuter — Google yo'nalishi", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Linux; Android 14)" });
    expect(navigateToUrl(point(1), "Magazin 1")).toBe("geo:41.510000,60.610000?q=41.510000,60.610000(Magazin%201)");
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0)" });
    expect(navigateToUrl(point(1))).toContain("https://www.google.com/maps/dir/?");
  });

  it("marshrut chizig'i: yo'l geometriyasi, bo'lmasa boshlanish va nuqtalar; masofa formati", () => {
    const plan: RoutePlan = {
      source: "straight",
      origin: point(0),
      stops: [{ id: "a", ...point(1), position: 1, legMeters: 1300, legSeconds: 160 }],
      totalMeters: 1300,
      totalSeconds: 160,
      geometry: null,
    };
    expect(routeLine(plan)).toEqual([point(0), { id: "a", ...point(1), position: 1, legMeters: 1300, legSeconds: 160 }]);
    expect(routeLine({ ...plan, source: "road", geometry: [[41.5, 60.6], [41.6, 60.7]] })).toEqual([
      { latitude: 41.5, longitude: 60.6 },
      { latitude: 41.6, longitude: 60.7 },
    ]);
    expect(formatDistance(950)).toBe("950 m");
    expect(formatDistance(1300)).toBe("1.3 km");
    expect(formatDistance(12_400)).toBe("12 km");
  });
});
