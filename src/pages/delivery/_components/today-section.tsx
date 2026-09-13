import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useLiveInterval } from "@/lib/delivery/realtime.ts";
import type { SupervisorDashboard } from "@/lib/delivery/types.ts";
import { useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import { todayLocal } from "@/pages/sales/_lib/types.ts";
import type { TaskFilters } from "../_lib/filters.ts";

type Props = {
  money: (value: string | number) => string;
  onOpenTasks: (filters: Partial<TaskFilters>) => void;
  onOpenControl: () => void;
};

/** Kunlik holat: har ko'rsatkich bosilganda yetkazmalar ro'yxati shu filtr bilan ochiladi. */
export default function TodaySection({ money, onOpenTasks, onOpenControl }: Props) {
  const { t } = useTranslation("delivery");
  const [date, setDate] = useState(todayLocal);
  const interval = useLiveInterval(60_000);
  const dashboard = useApiQuery<{ dashboard: SupervisorDashboard }>("/api/delivery/dashboard", { date }, { refetchInterval: interval }).data?.dashboard;
  const day = { dateFrom: date, dateTo: date };

  const tiles = dashboard
    ? [
        { key: "total", value: dashboard.total, tone: "", open: () => onOpenTasks(day) },
        { key: "unassigned", value: dashboard.unassigned, tone: dashboard.unassigned > 0 ? "text-amber-600" : "", open: () => onOpenTasks({ ...day, unassigned: true }) },
        { key: "waiting", value: dashboard.waiting, tone: "text-blue-600", open: () => onOpenTasks({ ...day, status: "waiting" }) },
        { key: "on_route", value: dashboard.onRoute, tone: "text-amber-600", open: () => onOpenTasks({ ...day, status: "on_route" }) },
        { key: "delivered", value: dashboard.delivered, tone: "text-emerald-600", open: () => onOpenTasks({ ...day, status: "delivered" }) },
        { key: "partial", value: dashboard.partiallyDelivered, tone: "text-lime-600", open: () => onOpenTasks({ ...day, status: "partially_delivered" }) },
        { key: "failed", value: dashboard.failed, tone: dashboard.failed > 0 ? "text-destructive" : "", open: () => onOpenTasks({ ...day, status: "failed" }) },
        { key: "returned", value: dashboard.returned, tone: "text-orange-600", open: () => onOpenTasks({ ...day, status: "returned" }) },
        { key: "cancelled", value: dashboard.cancelled, tone: "text-muted-foreground", open: () => onOpenTasks({ ...day, status: "cancelled" }) },
        { key: "overdue", value: dashboard.overdue, tone: dashboard.overdue > 0 ? "text-destructive" : "", open: () => onOpenTasks({ overdue: true }) },
        { key: "pending_reviews", value: dashboard.pendingReviews, tone: dashboard.pendingReviews > 0 ? "text-amber-600" : "", open: () => onOpenTasks({ reviewPending: true }) },
        { key: "pending_returns", value: dashboard.pendingReturns, tone: dashboard.pendingReturns > 0 ? "text-orange-600" : "", open: onOpenControl },
      ]
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="today-date">{t("sv.today.date")}</Label>
          <Input id="today-date" type="date" className="w-44" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </div>
        <p className="pb-2 text-xs text-muted-foreground">{t("sv.today.hint")}</p>
      </div>

      {!dashboard ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {tiles.map((tile) => (
              <button
                key={tile.key}
                type="button"
                onClick={tile.open}
                className="rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:bg-accent"
              >
                <p className={cn("text-2xl font-bold tabular-nums", tile.tone)}>{tile.value}</p>
                <p className="text-xs text-muted-foreground">{t(`sv.today.${tile.key}`)}</p>
              </button>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-2 rounded-2xl border border-border bg-card p-4">
              <p className="text-sm font-semibold">{t("sv.today.collected")}</p>
              <p className="text-2xl font-bold tabular-nums">{money(dashboard.collected.total)}</p>
              <div className="grid grid-cols-3 gap-2 text-xs">
                {(["cash", "card", "bank"] as const).map((method) => (
                  <div key={method} className="rounded-xl bg-muted/50 px-2 py-1.5">
                    <p className="text-muted-foreground">{t(`method.${method}`)}</p>
                    <p className="font-semibold tabular-nums">{money(dashboard.collected[method])}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-border bg-card lg:col-span-2">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2 font-medium">{t("sv.table.agent")}</th>
                    <th className="px-2 py-2 font-medium">{t("sv.today.progress")}</th>
                    <th className="px-2 py-2 text-right font-medium">{t("sv.today.on_route")}</th>
                    <th className="px-2 py-2 text-right font-medium">{t("sv.today.failed")}</th>
                    <th className="px-4 py-2 text-right font-medium">{t("sv.today.collected")}</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.agents.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                        {t("sv.today.no_tasks")}
                      </td>
                    </tr>
                  ) : (
                    dashboard.agents.map((agent) => {
                      const percent = agent.total > 0 ? Math.round((agent.done / agent.total) * 100) : 0;
                      return (
                        <tr
                          key={agent.deliveryAgentId}
                          className="cursor-pointer border-b border-border last:border-0 hover:bg-accent/50"
                          onClick={() => onOpenTasks({ ...day, agentId: agent.deliveryAgentId })}
                        >
                          <td className="px-4 py-2">
                            <p className="font-medium">{agent.name ?? agent.code}</p>
                            <p className="text-xs text-muted-foreground">{agent.code}</p>
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex items-center gap-2">
                              <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                                <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
                              </div>
                              <span className="text-xs tabular-nums">
                                {agent.done}/{agent.total}
                              </span>
                            </div>
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">{agent.onRoute}</td>
                          <td className={cn("px-2 py-2 text-right tabular-nums", agent.failed > 0 && "text-destructive")}>{agent.failed}</td>
                          <td className="px-4 py-2 text-right font-medium tabular-nums">{money(agent.collected.total)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
