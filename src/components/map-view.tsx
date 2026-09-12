/**
 * Sxematik xarita (tashqi xarita xizmatisiz): belgilar, chiziq (kunlik yo'l) va doiralar (geofence) koordinatalardan
 * teng masofali proyeksiyada chiziladi, pastda masshtab chizig'i. Belgi tanlansa — ma'lumot va qurilmaning xarita
 * ilovasida ochish havolasi. Tile/API yuklanmaydi, kalit talab qilinmaydi.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, MapPinOff, X } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { mapAppUrl, type LatLng, type MapCircle, type MapMarker } from "@/lib/maps/index.ts";

type Props = {
  markers?: MapMarker[];
  polyline?: LatLng[];
  circles?: MapCircle[];
  className?: string;
};

const WIDTH = 1000;
const HEIGHT = 600;
const PADDING = 60;
const METERS_PER_DEGREE = 111_320;
/** Bitta nuqta bo'lsa ham ko'rinadigan eng kichik hudud, metr. */
const MIN_SPAN_METERS = 400;
const SCALE_STEPS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000, 200_000];

const TONE_FILL: Record<NonNullable<MapMarker["tone"]>, string> = {
  primary: "fill-primary",
  online: "fill-emerald-500",
  offline: "fill-muted-foreground",
  warning: "fill-amber-500",
  danger: "fill-destructive",
};
const TONE_STROKE: Record<NonNullable<MapMarker["tone"]>, string> = {
  primary: "stroke-primary",
  online: "stroke-emerald-500",
  offline: "stroke-muted-foreground",
  warning: "stroke-amber-500",
  danger: "stroke-destructive",
};

function projection(points: LatLng[]) {
  const lats = points.map((point) => point.latitude);
  const lngs = points.map((point) => point.longitude);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const lngFactor = Math.cos((centerLat * Math.PI) / 180) * METERS_PER_DEGREE;
  const spanX = Math.max((Math.max(...lngs) - Math.min(...lngs)) * lngFactor, MIN_SPAN_METERS);
  const spanY = Math.max((Math.max(...lats) - Math.min(...lats)) * METERS_PER_DEGREE, MIN_SPAN_METERS);
  const scale = Math.min((WIDTH - PADDING * 2) / spanX, (HEIGHT - PADDING * 2) / spanY);
  return {
    x: (point: LatLng) => WIDTH / 2 + (point.longitude - centerLng) * lngFactor * scale,
    y: (point: LatLng) => HEIGHT / 2 - (point.latitude - centerLat) * METERS_PER_DEGREE * scale,
    px: (meters: number) => meters * scale,
  };
}

export default function MapView({ markers = [], polyline = [], circles = [], className }: Props) {
  const { t } = useTranslation("map");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const view = useMemo(() => {
    const points = [...markers, ...polyline, ...circles];
    if (points.length === 0) return null;
    const project = projection(points);
    const scaleMeters = [...SCALE_STEPS].reverse().find((meters) => project.px(meters) <= 220) ?? SCALE_STEPS[0]!;
    return { project, scaleMeters };
  }, [markers, polyline, circles]);

  const selected = markers.find((marker) => marker.id === selectedId) ?? null;

  if (!view) {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted/30 p-6 text-center", className)}>
        <MapPinOff className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      </div>
    );
  }

  const { project, scaleMeters } = view;
  const path = polyline.map((point, i) => `${i === 0 ? "M" : "L"}${project.x(point).toFixed(1)},${project.y(point).toFixed(1)}`).join(" ");

  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-border bg-muted/20", className)}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="xMidYMid meet" className="h-full w-full" role="img" aria-label={t("schematic")}>
        <defs>
          <pattern id="map-grid" width="50" height="50" patternUnits="userSpaceOnUse">
            <path d="M 50 0 L 0 0 0 50" className="fill-none stroke-border" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={WIDTH} height={HEIGHT} fill="url(#map-grid)" />

        {circles.map((circle) => (
          <circle
            key={circle.id}
            cx={project.x(circle)}
            cy={project.y(circle)}
            r={Math.max(project.px(circle.radiusMeters), 4)}
            className={cn("fill-primary/10", TONE_STROKE[circle.tone ?? "primary"])}
            strokeWidth="2"
            strokeDasharray="6 4"
          />
        ))}

        {path && <path d={path} className="fill-none stroke-primary" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />}

        {markers.map((marker) => {
          const cx = project.x(marker);
          const cy = project.y(marker);
          const active = marker.id === selectedId;
          return (
            <g
              key={marker.id}
              role="button"
              tabIndex={0}
              aria-label={marker.label ?? marker.id}
              className="cursor-pointer focus:outline-none"
              onClick={() => setSelectedId(active ? null : marker.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setSelectedId(active ? null : marker.id);
              }}
            >
              <circle cx={cx} cy={cy} r={active ? 13 : 10} className={cn(TONE_FILL[marker.tone ?? "primary"], "stroke-background")} strokeWidth="3" />
              {marker.label && (
                <text x={cx + 16} y={cy + 5} className="fill-foreground text-[20px] font-medium" paintOrder="stroke" stroke="var(--background, #fff)" strokeWidth="4">
                  {marker.label}
                </text>
              )}
            </g>
          );
        })}

        <g transform={`translate(${PADDING / 2}, ${HEIGHT - PADDING / 2})`}>
          <line x1="0" y1="0" x2={project.px(scaleMeters)} y2="0" className="stroke-foreground" strokeWidth="3" />
          <line x1="0" y1="-6" x2="0" y2="6" className="stroke-foreground" strokeWidth="3" />
          <line x1={project.px(scaleMeters)} y1="-6" x2={project.px(scaleMeters)} y2="6" className="stroke-foreground" strokeWidth="3" />
          <text x={project.px(scaleMeters) + 10} y="7" className="fill-foreground text-[20px]">
            {scaleMeters >= 1000 ? t("scale_km", { value: scaleMeters / 1000 }) : t("scale_m", { value: scaleMeters })}
          </text>
        </g>
      </svg>

      <span className="pointer-events-none absolute right-3 top-2 rounded bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground">
        {t("schematic")}
      </span>

      {selected && (
        <div className="absolute inset-x-3 bottom-3 flex items-start gap-3 rounded-xl border border-border bg-card p-3 text-sm shadow-sm">
          <div className="min-w-0 flex-1">
            <p className="font-semibold truncate">{selected.label ?? t("point")}</p>
            {selected.description && <p className="text-xs text-muted-foreground">{selected.description}</p>}
            <a
              className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              href={mapAppUrl(selected.latitude, selected.longitude, selected.label)}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="h-3.5 w-3.5" /> {t("open")}
            </a>
          </div>
          <button type="button" aria-label={t("close")} className="text-muted-foreground hover:text-foreground" onClick={() => setSelectedId(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
