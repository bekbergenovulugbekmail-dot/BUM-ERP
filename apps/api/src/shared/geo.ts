/**
 * Geografik hisob: masofa (haversine) va koordinata tekshiruvi.
 * Masofa va geofence faqat serverda hisoblanadi — mijoz yuborgan "masofa" yoki "ichida" qiymatiga ishonilmaydi.
 */

export type GeoPoint = { latitude: number; longitude: number };

/** WGS-84 o'rtacha radiusi (IUGG), metr. */
const EARTH_RADIUS_M = 6_371_008.8;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Ikki nuqta orasidagi masofa, metr (haversine; shahar masofalarida xato < 0,5%). */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Haqiqiy koordinata: chegaralar ichida va "0, 0" emas (GPS xatosida tez-tez keladi). */
export function isValidCoordinate(point: GeoPoint): boolean {
  const { latitude, longitude } = point;
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    !(latitude === 0 && longitude === 0)
  );
}

/** Bazadagi numeric satr juftligi → nuqta (bo'lmasa null). */
export function pointOf(latitude: string | null, longitude: string | null): GeoPoint | null {
  if (latitude === null || longitude === null) return null;
  const point = { latitude: Number(latitude), longitude: Number(longitude) };
  return isValidCoordinate(point) ? point : null;
}
