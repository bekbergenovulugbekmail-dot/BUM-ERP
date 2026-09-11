/** Joriy xarita provayderi — almashtirish faqat shu yerda. */
import { yandexProvider } from "./yandex.ts";
import type { MapProvider } from "./types.ts";

export const mapProvider: MapProvider = yandexProvider;

export type { LatLng, MapCircle, MapHandle, MapMarker, MapProvider } from "./types.ts";

/** Toshkent markazi — obyekt bo'lmaganda boshlang'ich ko'rinish. */
export const DEFAULT_MAP_CENTER = { latitude: 41.311081, longitude: 69.240562 };
