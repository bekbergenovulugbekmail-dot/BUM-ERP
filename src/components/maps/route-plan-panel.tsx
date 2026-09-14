/**
 * Marshrut rejasi: jami masofa va vaqt, xaritada tartib raqamli do'konlar va yo'l chizig'i, tartiblangan ro'yxat va
 * navigatsiyaga o'tish (Google Maps — 9 ta oraliq nuqtadan ko'p bo'lsa bo'laklab; Yandex — bitta marshrut).
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MapPinOff, Navigation } from "lucide-react";
import MapView from "@/components/map-view.tsx";
import { Button } from "@/components/ui/button.tsx";
import { formatDistance, type MapMarker, type MapTone } from "@/lib/maps/index.ts";
import { googleDirectionsUrls, yandexRouteUrl } from "@/lib/maps/navigation.ts";
import { formatDuration, routeLine, type RoutePlan } from "@/lib/maps/route-plan.ts";
import { cn } from "@/lib/utils.ts";

export type RouteStopInfo = { id: string; title: string; subtitle?: string | null; tone?: MapTone };

type Props = {
  plan: RoutePlan;
  /** Reja nuqtalari haqida ma'lumot (id bo'yicha). */
  stops: RouteStopInfo[];
  /** Koordinatasi yo'q — xaritada emas, ro'yxat oxirida. */
  unlocated?: RouteStopInfo[];
  color?: string;
  /** Ro'yxat qatori yoki belgi bosilganda. */
  onOpen?: (id: string) => void;
  mapClassName?: string;
  /** Navigatsiya tugmalari (yetkazuvchi uchun asosiy; supervayzerda ham ko'rsatish mumkin). */
  showNavigation?: boolean;
  compactList?: boolean;
};

export default function RoutePlanPanel({ plan, stops, unlocated = [], color, onOpen, mapClassName, showNavigation = true, compactList = false }: Props) {
  const { t } = useTranslation("map");
  const info = useMemo(() => new Map(stops.map((stop) => [stop.id, stop])), [stops]);

  const markers = useMemo<MapMarker[]>(() => {
    const result: MapMarker[] = plan.stops.map((stop) => {
      const item = info.get(stop.id);
      return {
        id: stop.id,
        latitude: stop.latitude,
        longitude: stop.longitude,
        order: stop.position,
        label: item?.title,
        description: item?.subtitle ?? undefined,
        tone: item?.tone,
        color,
      };
    });
    if (plan.origin) result.push({ id: "__origin", ...plan.origin, label: t("route.origin"), tone: "online" });
    return result;
  }, [plan, info, color, t]);
  const polylines = useMemo(() => [{ id: "route", points: routeLine(plan), color, dashed: plan.source === "straight" }], [plan, color]);

  const googleUrls = googleDirectionsUrls(plan.origin, plan.stops);
  const yandexUrl = plan.stops.length > 0 ? yandexRouteUrl(plan.origin, plan.stops) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-sm">
          <span className="font-semibold tabular-nums">{formatDistance(plan.totalMeters)}</span>
          <span className="text-muted-foreground"> · {formatDuration(plan.totalSeconds, t)} · {t(plan.source === "road" ? "source_road" : "source_straight")}</span>
        </p>
        {showNavigation && plan.stops.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {googleUrls.map((url, index) => (
              <Button key={url} asChild size="sm" className="h-9">
                <a href={url} target="_blank" rel="noreferrer">
                  <Navigation className="mr-1.5 h-4 w-4" />
                  {googleUrls.length > 1 ? t("route.google_part", { part: index + 1, total: googleUrls.length }) : t("google")}
                </a>
              </Button>
            ))}
            {yandexUrl && (
              <Button asChild size="sm" variant="secondary" className="h-9">
                <a href={yandexUrl} target="_blank" rel="noreferrer">
                  <Navigation className="mr-1.5 h-4 w-4" /> {t("yandex")}
                </a>
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Belgi bosilganda — ma'lumot va navigator havolalari (popup); yetkazmani ochish — ro'yxat qatoridan
          (belgi oynani yopib, popup'dagi havolalarni to'sib qo'ymasin) */}
      <MapView markers={markers} polylines={polylines} className={cn("h-[360px] w-full", mapClassName)} />

      {(plan.stops.length > 0 || unlocated.length > 0) && (
        <ol className={cn("divide-y divide-border overflow-hidden rounded-xl border border-border bg-card", compactList && "max-h-80 overflow-y-auto")}>
          {plan.stops.map((stop) => {
            const item = info.get(stop.id);
            return (
              <li key={stop.id}>
                <button
                  type="button"
                  disabled={!onOpen}
                  onClick={() => onOpen?.(stop.id)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm enabled:hover:bg-muted/50"
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                    style={{ background: color ?? "#4f46e5" }}
                  >
                    {stop.position}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item?.title ?? stop.id}</span>
                    {item?.subtitle && <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>}
                  </span>
                  {stop.position > 1 || plan.origin ? (
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">+{formatDistance(stop.legMeters)}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
          {unlocated.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                disabled={!onOpen}
                onClick={() => onOpen?.(item.id)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm enabled:hover:bg-muted/50"
              >
                <MapPinOff className="h-5 w-5 shrink-0 text-amber-600" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{item.title}</span>
                  <span className="block truncate text-xs text-amber-700 dark:text-amber-400">{t("route.unlocated")}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
