/**
 * Navigatsiyaga o'tkazish: tayyor marshrut (tartiblangan nuqtalar) telefondagi navigator ilovasida ochiladi.
 * Faqat havola (deep link) — hech qanday xarita API'si chaqirilmaydi, kalit va to'lov kerak emas.
 *  - Google Maps: bitta havolada 9 tagacha oraliq nuqta (mobil ilova cheklovi) — ko'p bo'lsa bir necha bo'lak
 *  - Yandex Xaritalar / Navigator: hamma nuqtalar bitta marshrutda
 *  - Android `geo:` — tizim navigator tanlashni taklif qiladi (bitta manzil)
 */
import type { LatLng } from "./types.ts";

export const GOOGLE_MAX_WAYPOINTS = 9;

const coord = (point: LatLng) => `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`;

/**
 * Google Maps yo'nalish havolalari. `origin` berilmasa — ilova joriy joydan boshlaydi. Har bo'lak oldingisi tugagan
 * nuqtadan davom etadi.
 */
export function googleDirectionsUrls(origin: LatLng | null, stops: LatLng[]): string[] {
  const urls: string[] = [];
  let from = origin;
  for (let i = 0; i < stops.length; i += GOOGLE_MAX_WAYPOINTS + 1) {
    const chunk = stops.slice(i, i + GOOGLE_MAX_WAYPOINTS + 1);
    const destination = chunk[chunk.length - 1]!;
    const params = new URLSearchParams({ api: "1", travelmode: "driving", destination: coord(destination) });
    if (from) params.set("origin", coord(from));
    if (chunk.length > 1) params.set("waypoints", chunk.slice(0, -1).map(coord).join("|"));
    urls.push(`https://www.google.com/maps/dir/?${params.toString()}`);
    from = destination;
  }
  return urls;
}

/** Yandex Xaritalar marshruti (ilova o'rnatilgan bo'lsa unda ochiladi). `origin` berilmasa — joriy joydan. */
export function yandexRouteUrl(origin: LatLng | null, stops: LatLng[]): string {
  const points = [origin ? coord(origin) : "", ...stops.map(coord)].join("~");
  return `https://yandex.uz/maps/?rtext=${points}&rtt=auto`;
}

/** Bitta manzilga: Android — `geo:` (tizim navigatorni tanlaydi), boshqalarida — Google Maps yo'nalishi. */
export function navigateToUrl(point: LatLng, label?: string): string {
  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/android/i.test(agent)) {
    return `geo:${coord(point)}?q=${coord(point)}${label ? `(${encodeURIComponent(label)})` : ""}`;
  }
  return googleDirectionsUrls(null, [point])[0]!;
}
