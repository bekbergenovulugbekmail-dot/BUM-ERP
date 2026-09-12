import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlarmClock, RotateCcw, Scale } from "lucide-react";
import { LateBadge, StatusBadge } from "@/components/delivery/badges.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { usePermissions } from "@/hooks/use-company.ts";
import { num, type DeliveryTaskRow } from "@/lib/delivery/types.ts";
import { useApiQuery } from "@/lib/query.ts";

type Money = (value: string | number) => string;
type TaskPage = { tasks: DeliveryTaskRow[]; nextCursor: string | null };

function Panel({ title, icon, tasks, empty, render, onOpenTask }: {
  title: string;
  icon: ReactNode;
  tasks: DeliveryTaskRow[] | undefined;
  empty: string;
  render: (task: DeliveryTaskRow) => ReactNode;
  onOpenTask: (taskId: string) => void;
}) {
  return (
    <section className="space-y-2 rounded-2xl border border-border bg-card p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        {icon} {title}
        {tasks && <span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">{tasks.length}</span>}
      </p>
      {!tasks ? (
        <Skeleton className="h-24 rounded-xl" />
      ) : tasks.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="max-h-[480px] divide-y divide-border overflow-y-auto">
          {tasks.map((task) => (
            <li key={task.id}>
              <button type="button" className="flex w-full items-center gap-3 py-2 text-left text-sm hover:bg-accent/40" onClick={() => onOpenTask(task.id)}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {task.number} · {task.customerName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {task.scheduledDate} · {task.agentName ?? task.agentCode ?? "—"}
                  </p>
                </div>
                {render(task)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Nazorat: to'lov farqi ko'rib chiqilishi kerak, qaytgan mahsulot omborga qabul qilinishi kerak, kechikkan yetkazmalar. */
export default function ControlSection({ money, onOpenTask }: { money: Money; onOpenTask: (taskId: string) => void }) {
  const { t } = useTranslation("delivery");
  const { can } = usePermissions();
  const reviews = useApiQuery<TaskPage>(can("delivery.manage") ? "/api/delivery/tasks" : null, { reviewPending: true, limit: 200 }, { refetchInterval: 60_000 }).data
    ?.tasks;
  const returns = useApiQuery<TaskPage>(can("delivery.return") ? "/api/delivery/tasks" : null, { status: "failed,partially_delivered", limit: 200 }, {
    refetchInterval: 60_000,
  }).data?.tasks.filter((task) => task.status === "failed" || task.returnedAt === null);
  const overdue = useApiQuery<TaskPage>("/api/delivery/tasks", { overdue: true, limit: 200 }, { refetchInterval: 60_000 }).data?.tasks;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {can("delivery.manage") && (
        <Panel
          title={t("sv.control.reviews")}
          icon={<Scale className="h-4 w-4 text-amber-600" />}
          tasks={reviews}
          empty={t("sv.control.empty_reviews")}
          onOpenTask={onOpenTask}
          render={(task) => (
            <span className="shrink-0 text-right text-xs">
              <span className="block font-semibold text-amber-700 tabular-nums dark:text-amber-400">
                {money(Math.max(0, num(task.expectedAmount) - num(task.collectedAmount)))}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {money(task.collectedAmount)} / {money(task.expectedAmount)}
              </span>
            </span>
          )}
        />
      )}
      {can("delivery.return") && (
        <Panel
          title={t("sv.control.returns")}
          icon={<RotateCcw className="h-4 w-4 text-orange-600" />}
          tasks={returns}
          empty={t("sv.control.empty_returns")}
          onOpenTask={onOpenTask}
          render={(task) => (
            <span className="flex shrink-0 flex-col items-end gap-1">
              <StatusBadge status={task.status} />
              {task.failureReason && <span className="text-[11px] text-muted-foreground">{t(`failure.${task.failureReason}`)}</span>}
            </span>
          )}
        />
      )}
      <Panel
        title={t("sv.control.overdue")}
        icon={<AlarmClock className="h-4 w-4 text-destructive" />}
        tasks={overdue}
        empty={t("sv.control.empty_overdue")}
        onOpenTask={onOpenTask}
        render={(task) => (
          <span className="flex shrink-0 flex-col items-end gap-1">
            <LateBadge />
            <StatusBadge status={task.status} />
          </span>
        )}
      />
    </div>
  );
}
