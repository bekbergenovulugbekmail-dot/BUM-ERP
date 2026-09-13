/**
 * Xarita: OpenStreetMap + Leaflet (bepul, kalit va to'lov talab qilinmaydi).
 *  - ichki ko'rinish: `MapView` — do'konlar, agentlar, marshrut chiziqlari, geofence va hududlar
 *  - navigatsiya: `navigation.ts` — marshrutni Google Maps / Yandex / Android navigatorida ochish
 *  - `mapAppUrl` — bitta nuqtani telefondagi xarita ilovasida ochish
 */
export type { LatLng, MapCircle, MapMarker, MapPolygon, MapPolyline, MapTone } from "./types.ts";

/** Toshkent markazi — obyekt bo'lmaganda boshlang'ich nuqta. */
export const DEFAULT_MAP_CENTER = { latitude: 41.311081, longitude: 69.240562 };

/**
 * Qurilmaning xarita ilovasida ochish havolasi: Android — `geo:` (tizim ilova tanlashni taklif qiladi),
 * iOS — Apple Maps havolasi, kompyuter — OpenStreetMap sahifasi. Hech qanday API chaqirilmaydi.
 */
export function mapAppUrl(latitude: number | string, longitude: number | string, label?: string): string {
  const lat = Number(latitude).toFixed(6);
  const lng = Number(longitude).toFixed(6);
  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/android/i.test(agent)) {
    return `geo:${lat},${lng}?q=${lat},${lng}${label ? `(${encodeURIComponent(label)})` : ""}`;
  }
  if (/iphone|ipad|ipod/i.test(agent)) {
    return `https://maps.apple.com/?ll=${lat},${lng}&q=${encodeURIComponent(label ?? `${lat},${lng}`)}`;
  }
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
}

/** Telefon (Android/iOS) — tashqi ilova; kompyuterda nuqta ilova ichidagi xaritada ko'rsatiladi. */
export function isMobileDevice(): boolean {
  return typeof navigator !== "undefined" && /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

/** Masofa: 950 m, 12.4 km. */
export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}
