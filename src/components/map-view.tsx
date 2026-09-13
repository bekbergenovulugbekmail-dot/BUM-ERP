/**
 * Xarita: OpenStreetMap (bepul, kalitsiz) ustida Leaflet. Belgilar (do'kon, agent; marshrutdagi tartib raqami bilan),
 * chiziqlar (yo'l bo'yicha marshrut, kunlik iz), doiralar (geofence) va hududlar. Belgi bosilganda — ma'lumot va
 * navigatsiya havolalari (Google Maps, Yandex, Android navigator). Xarita qatlami yuklanmasa (internet yo'q) ham
 * belgilar va chiziqlar koordinatalar bo'yicha chiziladi. Pullik xarita API'si ishlatilmaydi.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPinOff, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { DEFAULT_MAP_CENTER } from "@/lib/maps/index.ts";
import { googleDirectionsUrls, navigateToUrl, yandexRouteUrl } from "@/lib/maps/navigation.ts";
import type { LatLng, MapCircle, MapMarker, MapPolygon, MapPolyline, MapTone } from "@/lib/maps/types.ts";

type Props = {
  markers?: MapMarker[];
  /** Asosiy chiziq (bitta). */
  polyline?: LatLng[];
  /** Bir nechta chiziq (masalan, har marshrut o'z rangida). */
  polylines?: MapPolyline[];
  circles?: MapCircle[];
  polygons?: MapPolygon[];
  className?: string;
  /** Belgi bosilganda (masalan, yetkazmani ochish). */
  onMarkerClick?: (id: string) => void;
};

/** Xarita qatlami: standart — OpenStreetMap; o'z tile serveringiz bo'lsa `VITE_MAP_TILE_URL`. */
const TILE_URL = (import.meta.env.VITE_MAP_TILE_URL as string | undefined) || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

const TONE_COLORS: Record<MapTone, string> = {
  primary: "#4f46e5",
  online: "#10b981",
  offline: "#94a3b8",
  warning: "#f59e0b",
  danger: "#ef4444",
};
/** Shundan ko'p belgida nomlar doimiy emas — faqat ustiga kelganda. */
const PERMANENT_LABELS_LIMIT = 40;
/** Shuncha xato tile ketma-ket bo'lsa — "qatlam yuklanmadi" ogohlantirishi. */
const TILE_ERROR_THRESHOLD = 4;

const safeColor = (value: string | undefined) => (value && /^#[0-9a-f]{3,8}$/i.test(value) ? value : null);
const toLatLng = (point: LatLng): L.LatLngTuple => [point.latitude, point.longitude];

function numberIcon(order: number, color: string) {
  return L.divIcon({
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
    tooltipAnchor: [14, 0],
    html: `<span class="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-[11px] font-bold text-white shadow-md" style="background:${color}">${Math.trunc(order)}</span>`,
  });
}

/** Belgi ma'lumoti — DOM orqali (matn HTML sifatida talqin qilinmaydi). */
function popupContent(marker: MapMarker, t: TFunction<"map">): HTMLElement {
  const root = document.createElement("div");
  root.className = "min-w-40 space-y-1";
  const title = document.createElement("p");
  title.className = "m-0! text-sm font-semibold";
  title.textContent = marker.label ?? t("point");
  root.append(title);
  if (marker.description) {
    const text = document.createElement("p");
    text.className = "m-0! text-xs text-slate-600";
    text.textContent = marker.description;
    root.append(text);
  }
  const links = document.createElement("div");
  links.className = "flex flex-wrap gap-x-3 gap-y-1 pt-1 text-xs font-medium";
  const add = (href: string, label: string) => {
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = label;
    links.append(link);
  };
  add(googleDirectionsUrls(null, [marker])[0]!, t("google"));
  add(yandexRouteUrl(null, [marker]), t("yandex"));
  if (typeof navigator !== "undefined" && /android/i.test(navigator.userAgent)) add(navigateToUrl(marker, marker.label), t("navigator"));
  root.append(links);
  return root;
}

function fitTo(map: L.Map, bounds: L.LatLngBounds | null) {
  if (!bounds?.isValid()) return;
  map.fitBounds(bounds.pad(0.15), { maxZoom: 16, animate: false });
}

export default function MapView({ markers = [], polyline = [], polylines = [], circles = [], polygons = [], className, onMarkerClick }: Props) {
  const { t } = useTranslation("map");
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const boundsRef = useRef<L.LatLngBounds | null>(null);
  const fittedKeyRef = useRef("");
  const clickRef = useRef(onMarkerClick);
  const [tilesFailed, setTilesFailed] = useState(false);

  const hasPoints = markers.length + polyline.length + polylines.length + circles.length + polygons.length > 0;

  useEffect(() => {
    clickRef.current = onMarkerClick;
  });

  // Xarita bir marta yaratiladi; o'lcham o'zgarsa (tab, oyna) qayta hisoblanadi
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasPoints) return;
    const map = L.map(container, { worldCopyJump: true }).setView(toLatLng(DEFAULT_MAP_CENTER), 12);
    const tiles = L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION });
    let errors = 0;
    tiles.on("tileerror", () => {
      errors += 1;
      if (errors >= TILE_ERROR_THRESHOLD) setTilesFailed(true);
    });
    tiles.on("tileload", () => {
      errors = 0;
      setTilesFailed(false);
    });
    tiles.addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      fittedKeyRef.current = "";
    };
  }, [hasPoints]);

  // Ma'lumot o'zgarsa qatlamlar qayta chiziladi; ko'rinish faqat nuqtalar to'plami o'zgarganda moslanadi
  // (jonli yangilanish foydalanuvchi surgan joyni buzmaydi)
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const bounds = L.latLngBounds([]);
    const extend = (point: LatLng) => bounds.extend(toLatLng(point));

    for (const polygon of polygons) {
      if (polygon.points.length < 3) continue;
      const color = safeColor(polygon.color) ?? TONE_COLORS.primary;
      const shape = L.polygon(polygon.points.map(toLatLng), { color, weight: 2, dashArray: "6 4", fillOpacity: 0.08 }).addTo(layer);
      if (polygon.label) shape.bindTooltip(polygon.label, { sticky: true });
      polygon.points.forEach(extend);
    }
    for (const circle of circles) {
      L.circle(toLatLng(circle), { radius: circle.radiusMeters, color: TONE_COLORS[circle.tone ?? "primary"], weight: 2, dashArray: "6 4", fillOpacity: 0.08 }).addTo(layer);
      extend(circle);
    }
    const lines: MapPolyline[] = [...(polyline.length > 1 ? [{ id: "__main", points: polyline }] : []), ...polylines];
    for (const line of lines) {
      if (line.points.length < 2) continue;
      L.polyline(line.points.map(toLatLng), {
        color: safeColor(line.color) ?? TONE_COLORS.primary,
        weight: line.weight ?? 4,
        opacity: 0.85,
        lineJoin: "round",
        ...(line.dashed ? { dashArray: "8 6" } : {}),
      }).addTo(layer);
      line.points.forEach(extend);
    }
    const permanent = markers.length <= PERMANENT_LABELS_LIMIT;
    for (const marker of markers) {
      const color = safeColor(marker.color) ?? TONE_COLORS[marker.tone ?? "primary"];
      const item: L.Layer =
        marker.order !== undefined
          ? L.marker(toLatLng(marker), { icon: numberIcon(marker.order, color), title: marker.label ?? "", riseOnHover: true })
          : L.circleMarker(toLatLng(marker), { radius: 8, color: "#ffffff", weight: 2, fillColor: color, fillOpacity: 1 });
      if (marker.label) item.bindTooltip(marker.label, { permanent, direction: "right", offset: [marker.order !== undefined ? 4 : 10, 0], opacity: 0.9 });
      item.bindPopup(() => popupContent(marker, t));
      item.on("click", () => clickRef.current?.(marker.id));
      item.addTo(layer);
      extend(marker);
    }

    boundsRef.current = bounds.isValid() ? bounds : null;
    const key = [
      markers.map((marker) => marker.id).join(","),
      polyline.length,
      polylines.map((line) => `${line.id}:${line.points.length}`).join(","),
      circles.map((circle) => circle.id).join(","),
      polygons.map((polygon) => polygon.id).join(","),
    ].join("|");
    if (key !== fittedKeyRef.current) {
      fittedKeyRef.current = key;
      fitTo(map, boundsRef.current);
    }
  }, [markers, polyline, polylines, circles, polygons, t, hasPoints]);

  if (!hasPoints) {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted/30 p-6 text-center", className)}>
        <MapPinOff className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      </div>
    );
  }

  return (
    <div className={cn("relative isolate overflow-hidden rounded-2xl border border-border bg-muted/20", className)}>
      <div ref={containerRef} className="h-full min-h-60 w-full" role="region" aria-label={t("title")} />
      <button
        type="button"
        title={t("fit")}
        aria-label={t("fit")}
        className="absolute right-3 top-3 z-[1000] flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-foreground shadow-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
        onClick={() => mapRef.current && fitTo(mapRef.current, boundsRef.current)}
      >
        <Maximize2 className="h-4 w-4" />
      </button>
      {tilesFailed && (
        <span className="pointer-events-none absolute bottom-3 left-3 right-14 z-[1000] rounded-lg bg-card/95 px-2 py-1 text-[11px] text-amber-700 shadow-sm dark:text-amber-400">
          {t("tiles_offline")}
        </span>
      )}
    </div>
  );
}
