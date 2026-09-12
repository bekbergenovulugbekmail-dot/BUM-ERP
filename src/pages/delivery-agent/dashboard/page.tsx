import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowRight, HandCoins, PackageCheck, Truck, Wallet } from "lucide-react";
import { isOpenDeliveryStatus, type DeliveryStatus } from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { coordsOf } from "@/lib/delivery/format.ts";
import { num, type AgentDashboard, type DeliveryTaskRow } from "@/lib/delivery/types.ts";
import { useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import DeliveryWorkSessionCard from "../_components/work-session-card.tsx";
import TaskCard from "../_components/task-card.tsx";
import { useDeliveryAgent } from "../_lib/context.ts";
import { projectedStatus } from "../_lib/offline-queue.ts";
import { roughMeters } from "../_lib/use-delivery-tracking.ts";

/**
 * Yetkazuvchi bosh sahifasi — faqat o'z ma'lumoti (serverda hisoblanadi): bugungi yetkazmalar holati, kechikkanlar,
 * yo'l progressi, yig'ilgan pul (naqd/karta/bank), yig'ilishi kutilayotgan to'lov, to'lov farqi, mijozlar qarzi (ruxsat bilan)
 * va keyingi yetkazma.
 */
export default function DeliveryDashboardPage() {
  const { t } = useTranslation("delivery");
  const { lng = "uz" } = useParams<{ lng: string }>();
  const { me, money, queue, location } = useDeliveryAgent();
  const dashboard = useApiQuery<{ dashboard: AgentDashboard }>("/api/delivery/agent/dashboard", undefined, { refetchInterval: 60_000 }).data
    ?.dashboard;
  const tasks = useApiQuery<{ tasks: DeliveryTaskRow[] }>("/api/delivery/agent/tasks", { scope: "today" }, { refetchInterval: 60_000 }).data?.tasks;

  const next = tasks
    ?.map((task) => ({ task, status: projectedStatus(task.status, queue.items.filter((item) => item.taskId === task.id)) as DeliveryStatus }))
    .find((entry) => isOpenDeliveryStatus(entry.status));
  const nextTarget = next ? coordsOf(next.task.customerLatitude, next.task.customerLongitude) : null;

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-xl font-bold">{t("greeting", { name: me.agent.name ?? "" })}</h1>
        <p className="text-xs text-muted-foreground">
          {me.agent.code}
          {me.agent.vehicleType ? ` · ${t(`vehicle.${me.agent.vehicleType}`)}` : ""}
          {me.agent.vehicleNumber ? ` ${me.agent.vehicleNumber}` : ""}
          {me.agent.deliveryZone ? ` · ${me.agent.deliveryZone}` : ""}
        </p>
      </div>

      <DeliveryWorkSessionCard />

      {!dashboard ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="space-y-3 rounded-2xl bg-primary p-4 text-primary-foreground">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs opacity-80">{t("dash.route_progress")}</p>
                <p className="text-3xl font-bold tabular-nums">
                  {dashboard.tasks.done} / {dashboard.tasks.total}
                </p>
              </div>
              <p className="text-2xl font-bold tabular-nums">{dashboard.progressPercent}%</p>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-primary-foreground/25">
              <div className="h-full rounded-full bg-primary-foreground transition-all" style={{ width: `${dashboard.progressPercent}%` }} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              { label: t("dash.remaining"), value: dashboard.tasks.remaining, tone: "" },
              { label: t("dash.on_route"), value: dashboard.tasks.onRoute, tone: "text-amber-700 dark:text-amber-400" },
              { label: t("dash.late"), value: dashboard.tasks.late, tone: dashboard.tasks.late > 0 ? "text-destructive" : "" },
            ].map((tile) => (
              <div key={tile.label} className="rounded-2xl border border-border bg-card p-3 text-center">
                <p className={cn("text-2xl font-bold tabular-nums", tile.tone)}>{tile.value}</p>
                <p className="text-[11px] text-muted-foreground">{tile.label}</p>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Truck className="h-4 w-4" /> {t("dash.next_task")}
            </p>
            {next ? (
              <TaskCard
                task={next.task}
                money={money}
                status={next.status}
                queued={queue.items.some((item) => item.taskId === next.task.id && item.state === "pending")}
                distanceMeters={location.point && nextTarget ? roughMeters(location.point, nextTarget) : null}
              />
            ) : (
              <p className="rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                {dashboard.tasks.total > 0 ? t("dash.all_done") : t("dash.no_tasks")}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {[
              { label: t("status.delivered"), value: dashboard.tasks.delivered, tone: "text-emerald-700 dark:text-emerald-400" },
              { label: t("status.partially_delivered"), value: dashboard.tasks.partiallyDelivered, tone: "text-lime-700 dark:text-lime-400" },
              { label: t("status.failed"), value: dashboard.tasks.failed, tone: "text-destructive" },
              { label: t("status.returned"), value: dashboard.tasks.returned, tone: "text-orange-700 dark:text-orange-400" },
            ].map((tile) => (
              <div key={tile.label} className="flex items-center justify-between rounded-2xl border border-border bg-card px-3 py-2.5">
                <span className="text-xs text-muted-foreground">{tile.label}</span>
                <span className={cn("text-lg font-bold tabular-nums", tile.tone)}>{tile.value}</span>
              </div>
            ))}
          </div>

          <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <HandCoins className="h-4 w-4" /> {t("dash.collected")}
            </p>
            <p className="text-2xl font-bold tabular-nums">{money(dashboard.collected.total)}</p>
            <div className="grid grid-cols-3 gap-2 text-xs">
              {(["cash", "card", "bank"] as const).map((method) => (
                <div key={method} className="rounded-xl bg-muted/50 px-2 py-1.5">
                  <p className="text-muted-foreground">{t(`method.${method}`)}</p>
                  <p className="font-semibold tabular-nums">{money(dashboard.collected[method])}</p>
                </div>
              ))}
            </div>
            <div className="flex justify-between border-t border-border pt-2 text-sm">
              <span className="text-muted-foreground">{t("dash.expected_pending")}</span>
              <span className="font-semibold tabular-nums">{money(dashboard.expectedPending)}</span>
            </div>
            {num(dashboard.mismatchAmount) > 0 && (
              <div className="flex items-center justify-between rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                <span className="flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4" /> {t("dash.mismatch")}
                </span>
                <span className="font-semibold tabular-nums">{money(dashboard.mismatchAmount)}</span>
              </div>
            )}
          </div>

          {dashboard.customersDebt !== null && (
            <Link
              to={`/${lng}/delivery-agent/debts`}
              className="flex items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-card px-4 py-3 text-sm active:bg-accent"
            >
              <span className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-amber-600" /> {t("dash.customers_debt")}
              </span>
              <span className="font-semibold tabular-nums">{money(dashboard.customersDebt)}</span>
            </Link>
          )}

          <Button asChild variant="secondary" className="h-14 w-full text-base">
            <Link to={`/${lng}/delivery-agent/tasks`}>
              <PackageCheck className="mr-2 h-5 w-5" /> {t("dash.open_tasks")} <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </>
      )}
    </div>
  );
}
