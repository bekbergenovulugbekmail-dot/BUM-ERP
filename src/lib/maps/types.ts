/**
 * Xarita ma'lumot turlari. Xarita — OpenStreetMap (bepul, kalitsiz) ustida Leaflet (`MapView`); pullik xarita API'si
 * ishlatilmaydi. Navigatsiya — telefondagi navigator ilovasiga havola (`navigation.ts`).
 */

export type LatLng = { latitude: number; longitude: number };

export type MapTone = "primary" | "online" | "offline" | "warning" | "danger";

export type MapMarker = LatLng & {
  id: string;
  /** Belgi yonidagi qisqa yozuv. */
  label?: string;
  /** Tanlanganda ko'rinadigan matn (oddiy matn — HTML emas). */
  description?: string;
  tone?: MapTone;
  /** Rang (#rrggbb) — masalan, marshrut rangi; `tone` dan ustun. */
  color?: string;
  /** Tartib raqami (marshrutdagi o'rni) — belgi ichida yoziladi. */
  order?: number;
};

export type MapCircle = LatLng & { id: string; radiusMeters: number; tone?: MapTone };

/** Chiziq: marshrut (yo'l bo'yicha) yoki kunlik iz. */
export type MapPolyline = { id: string; points: LatLng[]; color?: string; dashed?: boolean; weight?: number };

/** Hudud (territoriya) chegarasi. */
export type MapPolygon = { id: string; points: LatLng[]; color?: string; label?: string };
