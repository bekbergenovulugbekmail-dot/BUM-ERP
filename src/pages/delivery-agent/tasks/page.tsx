import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PackageOpen, RefreshCw, Route } from "lucide-react";
import { isOpenDeliveryStatus, type DeliveryStatus } from "@bum/shared";
import RoutePlanPanel from "@/components/maps/route-plan-panel.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { deliveryErrorMessage } from "@/lib/delivery/errors.ts";
import { coordsOf } from "@/lib/delivery/format.ts";
import { useLiveInterval } from "@/lib/delivery/realtime.ts";
import type { DeliveryTaskRow } from "@/lib/delivery/types.ts";
import type { AgentDayRoute } from "@/lib/maps/route-plan.ts";
import { useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import TaskCard from "../_components/task-card.tsx";
import { useDeliveryAgent } from "../_lib/context.ts";
import { projectedStatus } from "../_lib/offline-queue.ts";
import { roughMeters } from "../_lib/use-delivery-tracking.ts";

const SCOPES = ["today", "upcoming", "history"] as const;
type Scope = (typeof SCOPES)[number];

/** Joy ~100 m aniqlikda — har GPS o'zgarishida marshrut qayta so'ralmasin. */
const roundCoord = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Yetkazmalar: bugun (bugungi va oldingi kunlardan qolgan ochiqlari — yetkazish tartibida), keyingi kunlar, tarix.
 * "Optimal marshrut" — ochiq yetkazmalar hozirgi joydan eng qisqa yo'l tartibida (xarita, navigatorga o'tish).
 * So'rov manzili barqaror (oflayn keshdan ochiladi); masofa qurilmada taxminan ko'rsatiladi — geofence faqat serverda.
 */
export default function DeliveryTasksPage() {
  const { t } = useTranslation("delivery");
  const [params, setParams] = useSearchParams();
  const raw = params.get("scope");
  const scope: Scope = SCOPES.includes(raw as Scope) ? (raw as Scope) : "today";
  const routeMode = scope === "today" && params.get("view") === "route";
  const { money, queue, location } = useDeliveryAgent();
  const interval = useLiveInterval(60_000);
  const query = useApiQuery<{ tasks: DeliveryTaskRow[] }>("/api/delivery/agent/tasks", { scope }, {
    refetchInterval: scope === "today" ? interval : undefined,
  });
  const tasks = query.data?.tasks;

  const origin = location.point ? { lat: roundCoord(location.point.latitude), lng: roundCoord(location.point.longitude) } : {};
  const route = useApiQuery<AgentDayRoute<DeliveryTaskRow>>(routeMode ? "/api/delivery/agent/route" : null, origin, {
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });

  const rows = (tasks ?? []).map((task) => {
    const queued = queue.items.filter((item) => item.taskId === task.id);
    const target = coordsOf(task.customerLatitude, task.customerLongitude);
    return {
      task,
      status: projectedStatus(task.status, queued) as DeliveryStatus,
      queued: queued.some((item) => item.state === "pending"),
      distance: location.point && target ? roughMeters(location.point, target) : null,
    };
  });
  const open = rows.filter((row) => isOpenDeliveryStatus(row.status)).length;

  // Marshrut rejimida — reja tartibi (rejada yo'qlar — oxirida)
  const planned = route.data ? new Map(route.data.taskIds.map((id, index) => [id, index])) : null;
  const ordered = planned ? [...rows].sort((a, b) => (planned.get(a.task.id) ?? Infinity) - (planned.get(b.task.id) ?? Infinity)) : rows;

  const setView = (next: "route" | null) => setParams(next ? { view: next } : {}, { replace: true });
  const info = (id: string) => {
    const task = route.data?.tasks.find((item) => item.id === id);
    return { id, title: task?.customerName ?? id, subtitle: task ? [task.number, task.customerAddress].filter(Boolean).join(" · ") : null };
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t("tasks.title")}</h1>
        <Button variant="ghost" size="icon" className="h-10 w-10" aria-label={t("common.refresh")} onClick={() => void query.refetch()}>
          <RefreshCw className={cn("h-5 w-5", query.isFetching && "animate-spin")} />
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-muted p-1">
        {SCOPES.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setParams(item === "today" ? {} : { scope: item }, { replace: true })}
            className={cn(
              "h-11 rounded-xl text-sm font-medium transition-colors",
              scope === item ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            {t(`tasks.scope.${item}`)}
          </button>
        ))}
      </div>

      {scope === "today" && tasks && tasks.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">{t("tasks.summary", { open, total: tasks.length })}</p>
          {open > 0 && (
            <Button size="sm" variant={routeMode ? "secondary" : "default"} className="h-10" onClick={() => setView(routeMode ? null : "route")}>
              <Route className="mr-1.5 h-4 w-4" /> {routeMode ? t("tasks.route.close") : t("tasks.route.button")}
            </Button>
          )}
        </div>
      )}

      {routeMode && (
        <div className="space-y-2 rounded-2xl border border-border bg-card p-3">
          <div>
            <p className="font-semibold">{t("tasks.route.title")}</p>
            <p className="text-xs text-muted-foreground">{t("tasks.route.hint")}</p>
          </div>
          {route.isError ? (
            <div className="space-y-2">
              <p className="text-sm text-destructive">{t("tasks.route.error")}</p>
              <Button variant="secondary" className="h-10" onClick={() => void route.refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" /> {t("error.retry")}
              </Button>
            </div>
          ) : !route.data ? (
            <Skeleton className="h-72 rounded-xl" />
          ) : route.data.taskIds.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("tasks.route.empty")}</p>
          ) : (
            <RoutePlanPanel
              plan={route.data.route}
              stops={route.data.route.stops.map((stop) => info(stop.id))}
              unlocated={route.data.unlocatedTaskIds.map(info)}
              mapClassName="h-[300px]"
            />
          )}
        </div>
      )}

      {query.isError && !tasks ? (
        <div className="space-y-3 rounded-2xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">{deliveryErrorMessage(query.error, t)}</p>
          <Button variant="secondary" className="h-11" onClick={() => void query.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" /> {t("error.retry")}
          </Button>
        </div>
      ) : !tasks ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border p-10 text-center">
          <PackageOpen className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t(`tasks.empty.${scope}`)}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {ordered.map((row) => (
            <TaskCard key={row.task.id} task={row.task} money={money} status={row.status} queued={row.queued} distanceMeters={row.distance} />
          ))}
        </div>
      )}
    </div>
  );
}
