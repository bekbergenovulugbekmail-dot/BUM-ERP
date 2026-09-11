/**
 * Yandex Maps JavaScript API 2.1 provayderi. Skript bir marta, kerak bo'lganda yuklanadi.
 * Kalit: `VITE_YANDEX_MAPS_API_KEY` (build vaqtida). Belgilar matni `hintContent` sifatida — HTML sifatida emas.
 */
import type { LatLng, MapCircle, MapHandle, MapMarker, MapProvider } from "./types.ts";

type YGeoObject = unknown;
type YMapInstance = {
  geoObjects: {
    add(object: YGeoObject): void;
    remove(object: YGeoObject): void;
    getBounds(): number[][] | null;
  };
  setBounds(bounds: number[][], options?: Record<string, unknown>): void;
  setCenter(center: number[], zoom?: number): void;
  destroy(): void;
};
type YMaps = {
  ready(callback: () => void): void;
  Map: new (element: HTMLElement, state: Record<string, unknown>, options?: Record<string, unknown>) => YMapInstance;
  Placemark: new (coordinates: number[], properties: Record<string, unknown>, options?: Record<string, unknown>) => YGeoObject;
  Polyline: new (coordinates: number[][], properties: Record<string, unknown>, options?: Record<string, unknown>) => YGeoObject;
  Circle: new (geometry: [number[], number], properties: Record<string, unknown>, options?: Record<string, unknown>) => YGeoObject;
};

declare global {
  interface Window {
    ymaps?: YMaps;
  }
}

const API_KEY = (import.meta.env.VITE_YANDEX_MAPS_API_KEY as string | undefined)?.trim() ?? "";

const TONE_COLORS: Record<NonNullable<MapMarker["tone"]>, string> = {
  primary: "#6366f1",
  online: "#10b981",
  offline: "#94a3b8",
  warning: "#f59e0b",
  danger: "#ef4444",
};

let loading: Promise<YMaps> | null = null;

function loadYandex(language: string): Promise<YMaps> {
  if (window.ymaps) return new Promise((resolve) => window.ymaps!.ready(() => resolve(window.ymaps!)));
  loading ??= new Promise<YMaps>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(API_KEY)}&lang=${encodeURIComponent(language)}`;
    script.async = true;
    script.onload = () => {
      if (!window.ymaps) {
        reject(new Error("Yandex Maps yuklanmadi"));
        return;
      }
      window.ymaps.ready(() => resolve(window.ymaps!));
    };
    script.onerror = () => {
      loading = null;
      reject(new Error("Yandex Maps skriptini yuklab bo'lmadi"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

const toCoords = (point: LatLng) => [point.latitude, point.longitude];

/** i18n tili → Yandex tili. */
function yandexLanguage(language: string) {
  if (language.startsWith("ru")) return "ru_RU";
  if (language.startsWith("kk")) return "ru_RU";
  return "uz_UZ";
}

export const yandexProvider: MapProvider = {
  name: "yandex",
  isConfigured: () => API_KEY.length > 0,
  async createMap(element, options) {
    const ymaps = await loadYandex(yandexLanguage(options.language));
    const map = new ymaps.Map(element, { center: toCoords(options.center), zoom: options.zoom, controls: ["zoomControl"] });
    let markers: YGeoObject[] = [];
    let polyline: YGeoObject | null = null;
    let circles: YGeoObject[] = [];

    const handle: MapHandle = {
      setMarkers(next: MapMarker[]) {
        for (const marker of markers) map.geoObjects.remove(marker);
        markers = next.map((marker) =>
          new ymaps.Placemark(
            toCoords(marker),
            { hintContent: marker.description ?? marker.label ?? "", iconCaption: marker.label ?? "" },
            { preset: "islands#circleDotIcon", iconColor: TONE_COLORS[marker.tone ?? "primary"] },
          ),
        );
        for (const marker of markers) map.geoObjects.add(marker);
      },
      setPolyline(points: LatLng[]) {
        if (polyline) map.geoObjects.remove(polyline);
        polyline = points.length > 1 ? new ymaps.Polyline(points.map(toCoords), {}, { strokeColor: "#6366f1", strokeWidth: 4, strokeOpacity: 0.8 }) : null;
        if (polyline) map.geoObjects.add(polyline);
      },
      setCircles(next: MapCircle[]) {
        for (const circle of circles) map.geoObjects.remove(circle);
        circles = next.map((circle) => {
          const color = TONE_COLORS[circle.tone ?? "online"];
          return new ymaps.Circle([toCoords(circle), circle.radiusMeters], {}, {
            fillColor: `${color}22`,
            strokeColor: color,
            strokeWidth: 2,
          });
        });
        for (const circle of circles) map.geoObjects.add(circle);
      },
      fitToContent() {
        const bounds = map.geoObjects.getBounds();
        if (bounds) map.setBounds(bounds, { checkZoomRange: true, zoomMargin: 40 });
      },
      destroy() {
        map.destroy();
      },
    };
    return handle;
  },
};
