/**
 * Xarita: tashqi xarita API yo'q (kalit, to'lov, tashqi skript talab qilinmaydi).
 *  - ichki ko'rinish: `MapView` — koordinatalar sxemasi (masshtab chizig'i bilan)
 *  - navigatsiya: `mapAppUrl` — telefondagi mavjud xarita ilovasini ochadi (Yandex, Google, Apple va boshqalar)
 */
export type { LatLng, MapCircle, MapMarker } from "./types.ts";

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
