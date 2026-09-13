import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, Route, Sparkles } from "lucide-react";
import MapView from "@/components/map-view.tsx";
import RoutePlanPanel from "@/components/maps/route-plan-panel.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { usePermissions } from "@/hooks/use-company.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { formatDistance, type LatLng, type MapMarker, type MapPolyline } from "@/lib/maps/index.ts";
import type { RoutePlan } from "@/lib/maps/route-plan.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import type { DistributionMapData, RouteDetail } from "../_lib/types.ts";

const FALLBACK_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#3b82f6", "#ec4899", "#14b8a6"];
const ALL = "all";

const pointOf = (latitude: string | null, longitude: string | null): LatLng | null =>
  latitude !== null && longitude !== null ? { latitude: Number(latitude), longitude: Number(longitude) } : null;

/**
 * Distribyutsiya xaritasi (OpenStreetMap): marshrutlar o'z rangida, do'konlar tashrif tartibi raqami bilan, marshrutsiz
 * koordinatali do'konlar kulrang. Marshrut tanlansa — "Optimal tartib": do'konlar eng qisqa yo'l tartibiga qo'yiladi.
 */
export default function StoresMapSection() {
  const { t } = useTranslation("distribution");
  const { can } = usePermissions();
  const data = useApiQuery<DistributionMapData>("/api/distribution/map").data;
  const [routeId, setRouteId] = useState<string>(ALL);
  const [showUnrouted, setShowUnrouted] = useState(true);
  const [plan, setPlan] = useState<{ routeId: string; plan: RoutePlan; route: RouteDetail } | null>(null);
  const optimize = useApiMutation(
    (id: string) => api.post<{ route: RouteDetail; plan: RoutePlan; applied: boolean }>(`/api/distribution/routes/${id}/optimize`, { apply: true }),
    { invalidate: ["/api/distribution"] },
  );

  const colored = useMemo(
    () => (data?.routes ?? []).map((route, index) => ({ ...route, color: route.color ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length]! })),
    [data],
  );
  const visible = routeId === ALL ? colored : colored.filter((route) => route.id === routeId);

  const { markers, polylines } = useMemo(() => {
    const markers: MapMarker[] = [];
    const polylines: MapPolyline[] = [];
    for (const route of visible) {
      const line: LatLng[] = [];
      let position = 0;
      for (const store of route.customers) {
        position += 1;
        const point = pointOf(store.latitude, store.longitude);
        if (!point) continue;
        line.push(point);
        markers.push({
          id: `${route.id}:${store.memberId}`,
          ...point,
          order: position,
          color: route.color,
          label: store.name,
          description: [route.name, [store.city, store.district].filter(Boolean).join(" → "), store.address, store.phone].filter(Boolean).join(" · "),
        });
      }
      if (line.length > 1) polylines.push({ id: route.id, points: line, color: route.color, dashed: true, weight: 3 });
    }
    if (showUnrouted && routeId === ALL) {
      for (const store of data?.unrouted ?? []) {
        const point = pointOf(store.latitude, store.longitude);
        if (point) {
          markers.push({
            id: `free:${store.customerId}`,
            ...point,
            tone: "offline",
            label: store.name,
            description: [[store.city, store.district].filter(Boolean).join(" → "), store.address, store.phone].filter(Boolean).join(" · "),
          });
        }
      }
    }
    return { markers, polylines };
  }, [visible, showUnrouted, routeId, data]);

  const runOptimize = async (id: string) => {
    try {
      const result = await optimize.mutateAsync(id);
      setPlan({ routeId: id, plan: result.plan, route: result.route });
      toast.success(t("map.optimized", { distance: formatDistance(result.plan.totalMeters) }));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (!data) return <Skeleton className="h-[560px] rounded-2xl" />;

  const selected = routeId === ALL ? null : colored.find((route) => route.id === routeId) ?? null;
  const shownPlan = plan && selected && plan.routeId === selected.id ? plan : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <aside className="space-y-3">
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <p className="border-b border-border px-4 py-3 text-sm font-semibold">{t("map.routes")}</p>
          {colored.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{t("map.empty")}</p>
          ) : (
            <ul className="max-h-[440px] divide-y divide-border overflow-y-auto">
              <li>
                <button
                  type="button"
                  onClick={() => setRouteId(ALL)}
                  className={cn("w-full px-4 py-2.5 text-left text-sm font-medium hover:bg-muted/50", routeId === ALL && "bg-primary/5")}
                >
                  {t("map.all")}
                </button>
              </li>
              {colored.map((route) => {
                const missing = route.customers.filter((store) => store.latitude === null || store.longitude === null).length;
                return (
                  <li key={route.id}>
                    <button
                      type="button"
                      onClick={() => setRouteId(route.id)}
                      className={cn("flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-muted/50", routeId === route.id && "bg-primary/5")}
                    >
                      <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: route.color }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{route.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {route.salesRepName ?? t("map.no_agent")} · {t("map.store_count", { count: route.customers.length })}
                          {missing > 0 && <span className="text-amber-700 dark:text-amber-400"> · {t("map.no_coords", { count: missing })}</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm">
          <Checkbox id="map-unrouted" checked={showUnrouted} disabled={routeId !== ALL} onCheckedChange={(value) => setShowUnrouted(value === true)} />
          <label htmlFor="map-unrouted">{t("map.unrouted", { count: data.unrouted.length })}</label>
        </div>
        {selected && can("distribution.manage") && (
          <div className="space-y-2 rounded-2xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{t("map.optimize_hint")}</p>
            <Button className="w-full" disabled={optimize.isPending || selected.customers.length < 2} onClick={() => void runOptimize(selected.id)}>
              {optimize.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {t("map.optimize")}
            </Button>
          </div>
        )}
      </aside>

      <div className="space-y-3">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Route className="h-3.5 w-3.5" /> {t("map.hint")}
        </p>
        {shownPlan ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold">
              {t("map.plan_title")}: {shownPlan.route.name}
            </p>
            <RoutePlanPanel
              plan={shownPlan.plan}
              color={selected?.color}
              stops={shownPlan.route.customers.map((member) => ({
                id: member.id,
                title: member.customerName,
                subtitle: [[member.city, member.district].filter(Boolean).join(" → "), member.address].filter(Boolean).join(" · ") || null,
              }))}
              unlocated={shownPlan.route.customers
                .filter((member) => !shownPlan.plan.stops.some((stop) => stop.id === member.id))
                .map((member) => ({ id: member.id, title: member.customerName }))}
              mapClassName="h-[460px]"
              compactList
            />
          </div>
        ) : (
          <MapView markers={markers} polylines={polylines} className="h-[560px] w-full" />
        )}
      </div>
    </div>
  );
}
