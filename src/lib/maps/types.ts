/**
 * Xarita ma'lumot turlari. BUM ERP hech qanday tashqi (pullik) xarita API'siga bog'lanmaydi: ichki ko'rinish —
 * koordinatalardan chiziladigan sxema (`MapView`), navigatsiya — qurilmadagi xarita ilovasini ochish (`mapAppUrl`).
 */

export type LatLng = { latitude: number; longitude: number };

export type MapMarker = LatLng & {
  id: string;
  /** Belgi yonidagi qisqa yozuv. */
  label?: string;
  /** Tanlanganda ko'rinadigan matn (oddiy matn — HTML emas). */
  description?: string;
  tone?: "primary" | "online" | "offline" | "warning" | "danger";
};

export type MapCircle = LatLng & { id: string; radiusMeters: number; tone?: MapMarker["tone"] };
