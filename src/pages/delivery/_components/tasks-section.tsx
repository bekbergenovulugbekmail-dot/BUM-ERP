import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useInfiniteQuery } from "@tanstack/react-query";
import { FileDown, Loader2, RotateCcw, Search } from "lucide-react";
import { DELIVERY_STATUSES, isOpenDeliveryStatus } from "@bum/shared";
import { LateBadge, PriorityBadge, ReturnPendingBadge, StatusBadge } from "@/components/delivery/badges.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api.ts";
import { deliveryErrorMessage } from "@/lib/delivery/errors.ts";
import { timeWindow } from "@/lib/delivery/format.ts";
import { useLiveInterval } from "@/lib/delivery/realtime.ts";
import type { DeliveryAgentRow, DeliveryTaskRow } from "@/lib/delivery/types.ts";
import { useApiQuery } from "@/lib/query.ts";
import { useActiveCompany } from "@/hooks/use-company.ts";
import { useCurrentUser } from "@/hooks/use-auth.ts";
import {
  generateBulkDeliveryWaybillsPDF,
  generateDeliveryWaybillPDF,
  type SingleDeliveryWaybill,
  type WaybillTask,
} from "@/lib/pdf/delivery-waybill-pdf.ts";
import WaybillDialog, { type WaybillSettings } from "./waybill-dialog.tsx";
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
  const company = useActiveCompany().data?.company;
  const me = useCurrentUser();
  const [printing, setPrinting] = useState(false);
  /** Nakladnoy chiqarish uchun belgilangan yetkazmalar (faqat yo'lga chiqayotganlari). */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Serverdan yuklangan nakladnoy ma'lumoti — oyna ochiq turgani shu qiymat bilan bilinadi. */
  const [waybill, setWaybill] = useState<{
    agentCode: string;
    agentPhone: string | null;
    defaults: Omit<WaybillSettings, "columns" | "notes">;
    tasks: WaybillTask[];
  } | null>(null);
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

  // Nakladnoy faqat YO'LGA CHIQAYOTGAN yetkazmalar uchun chiqadi: yakunlangan, bekor qilingan
  // va qaytarilganlari tanlanmaydi (server ham shu ro'yxatni qayta filtrlaydi).
  const printable = (rows ?? []).filter((task) => isOpenDeliveryStatus(task.status));
  const selectedPrintable = printable.filter((task) => selected.has(task.id));
  const allSelected = printable.length > 0 && selectedPrintable.length === printable.length;

  const toggleTask = (taskId: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  /** "Hammasini belgilash" — faqat joriy ro'yxatdagi yaroqli yetkazmalar. */
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(printable.map((task) => task.id)));

  const handleBulkPrint = async () => {
    if (selectedPrintable.length === 0) return;
    setPrinting(true);
    try {
      const data = await api.post<{ tasks: SingleDeliveryWaybill[] }>("/api/delivery/waybills/bulk", {
        taskIds: selectedPrintable.map((task) => task.id),
      });
      if (data.tasks.length === 0) {
        toast.error("Tanlanganlar orasida chiqariladigan yetkazma yo'q");
        return;
      }
      generateBulkDeliveryWaybillsPDF({
        company: {
          name: company?.name ?? "BUM ERP",
          legalName: company?.legalName ?? undefined,
          taxId: company?.taxId ?? undefined,
          address: company?.address ?? undefined,
          phone: company?.phone ?? undefined,
          email: company?.email ?? undefined,
          website: company?.website ?? undefined,
        },
        currency: company?.currency ?? "UZS",
        responsibleName: me?.name ?? "—",
        deliveries: data.tasks.map((task) => ({
          ...task,
          orderTotal: Number(task.orderTotal),
          customerDebt: task.customerDebt === null ? null : Number(task.customerDebt),
        })),
      });
      if (data.tasks.length < selectedPrintable.length) {
        toast.info(`${data.tasks.length} ta nakladnoy chiqdi (qolganlari holati bo'yicha chiqmaydi)`);
      }
      setSelected(new Set());
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPrinting(false);
    }
  };

  /** Nakladnoy bitta agentning bitta kunidagi yetkazmalari uchun — shuning uchun ikkalasi tanlangan bo'lishi kerak. */
  const waybillDate = filters.dateFrom && filters.dateFrom === filters.dateTo ? filters.dateFrom : null;
  const canPrintWaybill = Boolean(filters.agentId && waybillDate);

  /**
   * Qog'oz TO'G'RIDAN-TO'G'RI chiqmaydi: avval ma'lumot yuklanadi va oynada ko'rsatiladi, chunki
   * mas'ul shaxs, agent nomi va ustunlar har bir biznesda boshqacha bo'lishi mumkin.
   */
  const handleWaybill = async () => {
    if (!filters.agentId || !waybillDate) return;
    setPrinting(true);
    try {
      const data = await api.get<{
        agent: { code: string; name: string | null; phone: string | null };
        warehouseName: string | null;
        tasks: (WaybillTask & { orderTotal: string; customerDebt: string | null })[];
      }>("/api/delivery/waybill", { agentId: filters.agentId, date: waybillDate });
      if (data.tasks.length === 0) {
        toast.error("Bu kunga biriktirilgan yetkazma yo'q");
        return;
      }
      setWaybill({
        agentCode: data.agent.code,
        agentPhone: data.agent.phone,
        defaults: {
          number: `${data.agent.code}-${waybillDate}`,
          // Mas'ul shaxs — hujjatni chop etayotgan xodim; oynada o'zgartirsa bo'ladi
          responsibleName: me?.name ?? "",
          agentName: data.agent.name ?? data.agent.code,
          warehouseName: data.warehouseName ?? "",
        },
        tasks: data.tasks.map((task) => ({
          ...task,
          orderTotal: Number(task.orderTotal),
          customerDebt: task.customerDebt === null ? null : Number(task.customerDebt),
        })),
      });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPrinting(false);
    }
  };

  const handlePrintWaybill = (settings: WaybillSettings) => {
    if (!waybill || !waybillDate) return;
    generateDeliveryWaybillPDF({
      company: {
        name: company?.name ?? "BUM ERP",
        legalName: company?.legalName ?? undefined,
        taxId: company?.taxId ?? undefined,
        address: company?.address ?? undefined,
        phone: company?.phone ?? undefined,
        email: company?.email ?? undefined,
        website: company?.website ?? undefined,
      },
      number: settings.number,
      date: waybillDate,
      agentName: settings.agentName,
      agentCode: waybill.agentCode,
      agentPhone: waybill.agentPhone,
      responsibleName: settings.responsibleName.trim() || "—",
      warehouseName: settings.warehouseName.trim() || null,
      currency: company?.currency ?? "UZS",
      notes: settings.notes.trim() || null,
      columns: settings.columns,
      tasks: waybill.tasks,
    });
    setWaybill(null);
  };

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
              ["returnPending", "sv.filter.return_pending"],
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
          {/* Nakladnoy — agent va BITTA kun tanlanganda: qog'oz aynan shu ro'yxat bo'yicha chiqadi */}
          <Button
            variant="secondary"
            size="sm"
            disabled={!canPrintWaybill || printing}
            title={canPrintWaybill ? "Nakladnoyni PDF qilib chiqarish" : "Avval agentni va bitta kunni tanlang"}
            onClick={() => void handleWaybill()}
          >
            <FileDown className="mr-1.5 h-3.5 w-3.5" /> Nakladnoy
          </Button>
          {/* Belgilanganlar uchun — har biri alohida A4 sahifada, bitta faylda */}
          <Button
            variant="secondary"
            size="sm"
            disabled={selectedPrintable.length === 0 || printing}
            title={
              selectedPrintable.length > 0
                ? `${selectedPrintable.length} ta yetkazma uchun nakladnoy`
                : "Avval yetkazmalarni belgilang"
            }
            onClick={() => void handleBulkPrint()}
          >
            <FileDown className="mr-1.5 h-3.5 w-3.5" />
            Belgilanganlar ({selectedPrintable.length})
          </Button>
        </div>
      </div>

      {waybill && waybillDate && (
        <WaybillDialog
          open
          onOpenChange={(next) => !next && setWaybill(null)}
          date={waybillDate}
          currency={company?.currency ?? "UZS"}
          tasks={waybill.tasks}
          defaults={waybill.defaults}
          debtAvailable={waybill.tasks.some((task) => task.customerDebt !== null)}
          storageKey={`bum:waybill:${company?.id ?? "default"}`}
          printing={printing}
          onPrint={handlePrintWaybill}
        />
      )}

      {query.isError ? (
        <p className="rounded-2xl border border-border bg-card p-4 text-sm text-destructive">{deliveryErrorMessage(query.error, t)}</p>
      ) : !rows ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="w-10 px-2 py-2">
                  <Checkbox
                    checked={allSelected}
                    disabled={printable.length === 0}
                    aria-label="Hammasini belgilash"
                    onCheckedChange={toggleAll}
                  />
                </th>
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
                  <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                    {t("sv.empty")}
                  </td>
                </tr>
              ) : (
                rows.map((task) => {
                  const slot = timeWindow(task.windowStart, task.windowEnd);
                  return (
                    <tr key={task.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-accent/50" onClick={() => onOpenTask(task.id)}>
                      {/* Belgilash qatorni ochmasin */}
                      <td className="px-2 py-2" onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(task.id)}
                          disabled={!isOpenDeliveryStatus(task.status)}
                          aria-label={`${task.number} — nakladnoy uchun belgilash`}
                          onCheckedChange={() => toggleTask(task.id)}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <p className="font-medium">{task.number}</p>
                        <div className="flex flex-wrap gap-1">
                          {task.overdue && <LateBadge />}
                          {task.returnPending && <ReturnPendingBadge />}
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
