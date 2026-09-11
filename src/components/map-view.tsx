/**
 * Xarita komponenti (provayderdan mustaqil): belgilar, chiziq (marshrut/tarix) va doiralar (geofence).
 * Kalit sozlanmagan yoki skript yuklanmasa — tushuntirish (sahifa ro'yxat bilan ishlashda davom etadi).
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MapPinOff } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { DEFAULT_MAP_CENTER, mapProvider, type LatLng, type MapCircle, type MapHandle, type MapMarker } from "@/lib/maps/index.ts";

type Props = {
  markers?: MapMarker[];
  polyline?: LatLng[];
  circles?: MapCircle[];
  className?: string;
};

export default function MapView({ markers = [], polyline = [], circles = [], className }: Props) {
  const { t, i18n } = useTranslation("map");
  const container = useRef<HTMLDivElement>(null);
  const handle = useRef<MapHandle | null>(null);
  const [error, setError] = useState<string | null>(mapProvider.isConfigured() ? null : "not_configured");
  const [ready, setReady] = useState(false);

  // Xarita bir marta yaratiladi
  useEffect(() => {
    if (!mapProvider.isConfigured() || !container.current) return;
    let cancelled = false;
    mapProvider
      .createMap(container.current, { center: DEFAULT_MAP_CENTER, zoom: 11, language: i18n.language })
      .then((created) => {
        if (cancelled) {
          created.destroy();
          return;
        }
        handle.current = created;
        setReady(true);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      handle.current?.destroy();
      handle.current = null;
    };
  }, [i18n.language]);

  // Obyektlar o'zgarsa — yangilanadi va masshtab moslanadi
  useEffect(() => {
    if (!ready || !handle.current) return;
    handle.current.setCircles(circles);
    handle.current.setPolyline(polyline);
    handle.current.setMarkers(markers);
    if (markers.length > 0 || polyline.length > 0) handle.current.fitToContent();
  }, [ready, markers, polyline, circles]);

  if (error) {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted/30 p-6 text-center", className)}>
        <MapPinOff className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">
          {error === "not_configured" ? t("not_configured.title") : t("load_failed")}
        </p>
        <p className="text-xs text-muted-foreground max-w-sm">
          {error === "not_configured" ? t("not_configured.message") : error}
        </p>
      </div>
    );
  }

  return <div ref={container} className={cn("rounded-2xl overflow-hidden border border-border bg-muted/30", className)} />;
}
