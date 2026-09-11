/**
 * Xarita provayderi abstraksiyasi: ilova faqat shu interfeys bilan ishlaydi — provayder (Yandex, keyin boshqasi)
 * almashsa sahifalar o'zgarmaydi. API kalit faqat env'dan (`VITE_YANDEX_MAPS_API_KEY`), kodda yo'q.
 */

export type LatLng = { latitude: number; longitude: number };

export type MapMarker = LatLng & {
  id: string;
  /** Belgi yonidagi qisqa yozuv. */
  label?: string;
  /** Bosilganda ko'rinadigan matn (oddiy matn — HTML emas). */
  description?: string;
  tone?: "primary" | "online" | "offline" | "warning" | "danger";
};

export type MapCircle = LatLng & { id: string; radiusMeters: number; tone?: MapMarker["tone"] };

export interface MapHandle {
  setMarkers(markers: MapMarker[]): void;
  setPolyline(points: LatLng[]): void;
  setCircles(circles: MapCircle[]): void;
  /** Hamma obyektlarni ko'rsatadigan masshtab. */
  fitToContent(): void;
  destroy(): void;
}

export interface MapProvider {
  readonly name: string;
  /** Kalit sozlanganmi — yo'q bo'lsa xarita o'rniga ro'yxat ko'rsatiladi. */
  isConfigured(): boolean;
  createMap(element: HTMLElement, options: { center: LatLng; zoom: number; language: string }): Promise<MapHandle>;
}
