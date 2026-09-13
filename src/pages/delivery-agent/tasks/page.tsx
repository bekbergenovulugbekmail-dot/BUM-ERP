import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PackageOpen, RefreshCw } from "lucide-react";
import { isOpenDeliveryStatus, type DeliveryStatus } from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { deliveryErrorMessage } from "@/lib/delivery/errors.ts";
import { coordsOf } from "@/lib/delivery/format.ts";
import { useLiveInterval } from "@/lib/delivery/realtime.ts";
import type { DeliveryTaskRow } from "@/lib/delivery/types.ts";
import { useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import TaskCard from "../_components/task-card.tsx";
import { useDeliveryAgent } from "../_lib/context.ts";
import { projectedStatus } from "../_lib/offline-queue.ts";
import { roughMeters } from "../_lib/use-delivery-tracking.ts";

const SCOPES = ["today", "upcoming", "history"] as const;
type Scope = (typeof SCOPES)[number];

/**
 * Yetkazmalar: bugun (bugungi va oldingi kunlardan qolgan ochiqlari — yetkazish tartibida), keyingi kunlar, tarix.
 * So'rov manzili barqaror (oflayn keshdan ochiladi); masofa qurilmada taxminan ko'rsatiladi — geofence faqat serverda.
 */
export default function DeliveryTasksPage() {
  const { t } = useTranslation("delivery");
  const [params, setParams] = useSearchParams();
  const raw = params.get("scope");
  const scope: Scope = SCOPES.includes(raw as Scope) ? (raw as Scope) : "today";
  const { money, queue, location } = useDeliveryAgent();
  const interval = useLiveInterval(60_000);
  const query = useApiQuery<{ tasks: DeliveryTaskRow[] }>("/api/delivery/agent/tasks", { scope }, {
    refetchInterval: scope === "today" ? interval : undefined,
  });
  const tasks = query.data?.tasks;

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
        <p className="text-sm text-muted-foreground">{t("tasks.summary", { open, total: tasks.length })}</p>
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
          {rows.map((row) => (
            <TaskCard key={row.task.id} task={row.task} money={money} status={row.status} queued={row.queued} distanceMeters={row.distance} />
          ))}
        </div>
      )}
    </div>
  );
}
