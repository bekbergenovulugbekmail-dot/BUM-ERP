import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Loader2, RotateCcw, Search } from "lucide-react";
import { DELIVERY_STATUSES } from "@bum/shared";
import { LateBadge, PriorityBadge, StatusBadge } from "@/components/delivery/badges.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { api } from "@/lib/api.ts";
import { deliveryErrorMessage } from "@/lib/delivery/errors.ts";
import { timeWindow } from "@/lib/delivery/format.ts";
import { useLiveInterval } from "@/lib/delivery/realtime.ts";
import type { DeliveryAgentRow, DeliveryTaskRow } from "@/lib/delivery/types.ts";
import { useApiQuery } from "@/lib/query.ts";
import { EMPTY_FILTERS, STATUS_GROUPS, filtersToQuery, type StatusFilter, type TaskFilters } from "../_lib/filters.ts";

type TaskPage = { tasks: DeliveryTaskRow[]; nextCursor: string | null };
const ALL = "all";
const PAGE_SIZE = 50;

type Props = {
  filters: TaskFilters;
  onFiltersChange: (filters: TaskFilters) => void;
  money: (value: string | number) => string;
  onOpenTask: (taskId: string) => void;
};

/** Yetkazmalar ro'yxati: sana, holat, agent, biriktirilmagan, kechikkan, to'lov farqi, qidiruv — hammasi serverda; kursor bilan sahifalash. */
export default function TasksSection({ filters, onFiltersChange, money, onOpenTask }: Props) {
  const { t } = useTranslation("delivery");
  const [search, setSearch] = useState(filters.search);
  const agents = useApiQuery<{ agents: DeliveryAgentRow[] }>("/api/delivery/agents").data?.agents;
  const params = filtersToQuery(filters);
  const interval = useLiveInterval(60_000);
  const query = useInfiniteQuery({
    queryKey: ["/api/delivery/tasks", params],
    queryFn: ({ pageParam, signal }) => api.get<TaskPage>("/api/delivery/tasks", { ...params, cursor: pageParam, limit: PAGE_SIZE }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: interval,
  });
  const rows = query.data?.pages.flatMap((page) => page.tasks);
  const set = (patch: Partial<TaskFilters>) => onFiltersChange({ ...filters, ...patch });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-2xl border border-border bg-card p-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="tasks-from">{t("sv.filter.date_from")}</Label>
          <Input id="tasks-from" type="date" value={filters.dateFrom} max={filters.dateTo || undefined} onChange={(e) => set({ dateFrom: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tasks-to">{t("sv.filter.date_to")}</Label>
          <Input id="tasks-to" type="date" value={filters.dateTo} min={filters.dateFrom || undefined} onChange={(e) => set({ dateTo: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label>{t("sv.filter.status")}</Label>
          <Select value={filters.status || ALL} onValueChange={(value) => set({ status: value === ALL ? "" : (value as StatusFilter) })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("sv.filter.all")}</SelectItem>
              {(Object.keys(STATUS_GROUPS) as (keyof typeof STATUS_GROUPS)[]).map((group) => (
                <SelectItem key={group} value={group}>
                  {t(`sv.filter.group.${group}`)}
                </SelectItem>
              ))}
              {DELIVERY_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {t(`status.${status}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>{t("sv.table.agent")}</Label>
          <Select value={filters.agentId || ALL} onValueChange={(value) => set({ agentId: value === ALL ? "" : value, unassigned: false })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("sv.filter.all_agents")}</SelectItem>
              {agents?.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.name ?? agent.phone} · {agent.code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <form
          className="flex items-end gap-2 md:col-span-2"
          onSubmit={(e) => {
            e.preventDefault();
            set({ search });
          }}
        >
          <div className="flex-1 space-y-1">
            <Label htmlFor="tasks-search">{t("sv.filter.search")}</Label>
            <Input id="tasks-search" maxLength={100} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("sv.filter.search_hint")} />
          </div>
          <Button type="submit" variant="secondary">
            <Search className="h-4 w-4" />
          </Button>
        </form>
        <div className="flex flex-wrap items-center gap-4 md:col-span-2">
          {(
            [
              ["unassigned", "sv.filter.unassigned"],
              ["overdue", "sv.filter.overdue"],
              ["reviewPending", "sv.filter.review_pending"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} htmlFor={`tasks-${key}`} className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                id={`tasks-${key}`}
                checked={filters[key]}
                onCheckedChange={(checked) => set({ [key]: checked === true, ...(key === "unassigned" && checked === true ? { agentId: "" } : {}) })}
              />
              {t(label)}
            </label>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => {
              setSearch("");
              onFiltersChange(EMPTY_FILTERS);
            }}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> {t("sv.filter.reset")}
          </Button>
        </div>
      </div>

      {query.isError ? (
        <p className="rounded-2xl border border-border bg-card p-4 text-sm text-destructive">{deliveryErrorMessage(query.error, t)}</p>
      ) : !rows ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">{t("sv.table.number")}</th>
                <th className="px-2 py-2 font-medium">{t("sv.table.date")}</th>
                <th className="px-2 py-2 font-medium">{t("sv.table.customer")}</th>
                <th className="px-2 py-2 font-medium">{t("sv.table.order")}</th>
                <th className="px-2 py-2 font-medium">{t("sv.table.agent")}</th>
                <th className="px-2 py-2 font-medium">{t("sv.table.status")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("sv.table.amount")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    {t("sv.empty")}
                  </td>
                </tr>
              ) : (
                rows.map((task) => {
                  const slot = timeWindow(task.windowStart, task.windowEnd);
                  return (
                    <tr key={task.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-accent/50" onClick={() => onOpenTask(task.id)}>
                      <td className="px-4 py-2">
                        <p className="font-medium">{task.number}</p>
                        <div className="flex flex-wrap gap-1">
                          {task.overdue && <LateBadge />}
                          <PriorityBadge priority={task.priority} />
                        </div>
                      </td>
                      <td className="px-2 py-2 tabular-nums">
                        <p>{task.scheduledDate}</p>
                        {slot && <p className="text-xs text-muted-foreground">{slot}</p>}
                      </td>
                      <td className="max-w-[220px] px-2 py-2">
                        <p className="truncate font-medium">{task.customerName}</p>
                        {task.customerAddress && <p className="truncate text-xs text-muted-foreground">{task.customerAddress}</p>}
                      </td>
                      <td className="px-2 py-2">{task.orderNumber}</td>
                      <td className="px-2 py-2">
                        {task.deliveryAgentId ? (
                          <>
                            <p>{task.agentName ?? task.agentCode}</p>
                            {task.routeOrder !== null && <p className="text-xs text-muted-foreground">№{task.routeOrder}</p>}
                          </>
                        ) : (
                          <span className="text-amber-600">{t("sv.unassigned_agent")}</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex flex-col items-start gap-1">
                          <StatusBadge status={task.status} />
                          {task.paymentReview === "pending" && <span className="text-[11px] font-medium text-amber-600">{t("review.pending")}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        <p className="font-medium">{money(task.expectedAmount)}</p>
                        <p className="text-xs text-muted-foreground">{money(task.collectedAmount)}</p>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {query.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            {query.isFetchingNextPage && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("sv.load_more")}
          </Button>
        </div>
      )}
    </div>
  );
}
