import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CheckSquare, Layers, List, Loader2, MapPin, MapPinOff, PackagePlus, Route, Search, Truck } from "lucide-react";
import { DELIVERY_PAYMENT_TYPES, DELIVERY_PRIORITIES, type DeliveryPaymentType, type DeliveryPriority } from "@bum/shared";
import RoutePlanPanel from "@/components/maps/route-plan-panel.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { usePermissions } from "@/hooks/use-company.ts";
import { api } from "@/lib/api.ts";
import { deliveryErrorMessage } from "@/lib/delivery/errors.ts";
import type { DeliveryAgentRow, DeliveryTaskDetail, DeliveryTaskRow, DispatchAssignResult, DispatchBoard, DispatchItem } from "@/lib/delivery/types.ts";
import { num } from "@/lib/delivery/types.ts";
import { formatDistance } from "@/lib/maps/index.ts";
import { formatDuration, type AgentDayRoute } from "@/lib/maps/route-plan.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import { todayLocal } from "@/pages/sales/_lib/types.ts";

type Money = (value: string | number) => string;
type View = "region" | "route" | "list";
const AUTO = "auto";
const NONE = "none";

/** Bitta buyurtmadan yetkazma yaratish oynasi uchun kerakli maydonlar. */
type OrderSummary = { id: string; number: string; deliveryDate: string | null; customerName: string; totalAmount: string; hasLocation: boolean };

function CreateTaskDialog({ order, money, onClose, onCreated }: { order: OrderSummary; money: Money; onClose: () => void; onCreated: (taskId: string) => void }) {
  const { t } = useTranslation("delivery");
  const { can } = usePermissions();
  const today = todayLocal();
  const [form, setForm] = useState({
    scheduledDate: order.deliveryDate && order.deliveryDate > today ? order.deliveryDate : today,
    priority: "normal" as DeliveryPriority,
    paymentType: AUTO as DeliveryPaymentType | typeof AUTO,
    agentId: NONE,
    windowStart: "",
    windowEnd: "",
    deliveryNote: "",
    supervisorNote: "",
  });
  const agents = useApiQuery<{ agents: DeliveryAgentRow[] }>(can("delivery.assign") ? "/api/delivery/agents" : null, { activeOnly: true }).data?.agents;
  const create = useApiMutation((body: Record<string, unknown>) => api.post<{ task: DeliveryTaskDetail }>("/api/delivery/tasks", body), {
    invalidate: ["/api/delivery"],
  });
  const windowValid = (form.windowStart === "") === (form.windowEnd === "") && (form.windowStart === "" || form.windowStart < form.windowEnd);
  const valid = form.scheduledDate >= today && windowValid;

  const submit = async () => {
    try {
      const { task } = await create.mutateAsync({
        orderId: order.id,
        scheduledDate: form.scheduledDate,
        priority: form.priority,
        ...(form.paymentType !== AUTO ? { paymentType: form.paymentType } : {}),
        ...(form.agentId !== NONE ? { deliveryAgentId: form.agentId } : {}),
        ...(form.windowStart ? { windowStart: form.windowStart, windowEnd: form.windowEnd } : {}),
        deliveryNote: form.deliveryNote.trim() || null,
        supervisorNote: form.supervisorNote.trim() || null,
      });
      toast.success(t("ready.created", { number: task.number }));
      onCreated(task.id);
    } catch (error) {
      toast.error(deliveryErrorMessage(error, t));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !create.isPending && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("ready.create_title", { number: order.number })}</DialogTitle>
          <DialogDescription>
            {order.customerName} · {money(order.totalAmount)}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="create-date">{t("sv.table.date")}</Label>
            <Input id="create-date" type="date" min={today} value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>{t("edit.priority")}</Label>
            <Select value={form.priority} onValueChange={(value) => setForm({ ...form, priority: value as DeliveryPriority })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DELIVERY_PRIORITIES.map((item) => (
                  <SelectItem key={item} value={item}>
                    {t(`priority.${item}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t("task.payment_type")}</Label>
            <Select value={form.paymentType} onValueChange={(value) => setForm({ ...form, paymentType: value as DeliveryPaymentType | typeof AUTO })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>{t("ready.payment_auto")}</SelectItem>
                {DELIVERY_PAYMENT_TYPES.map((item) => (
                  <SelectItem key={item} value={item}>
                    {t(`payment_type.${item}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {can("delivery.assign") && (
            <div className="space-y-1">
              <Label>{t("sv.table.agent")}</Label>
              <Select value={form.agentId} onValueChange={(value) => setForm({ ...form, agentId: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("ready.agent_later")}</SelectItem>
                  {agents?.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name ?? agent.phone} · {agent.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="create-start">{t("edit.window_start")}</Label>
            <Input id="create-start" type="time" value={form.windowStart} onChange={(e) => setForm({ ...form, windowStart: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="create-end">{t("edit.window_end")}</Label>
            <Input id="create-end" type="time" value={form.windowEnd} onChange={(e) => setForm({ ...form, windowEnd: e.target.value })} />
          </div>
          {!windowValid && <p className="text-xs text-destructive sm:col-span-2">{t("edit.window_invalid")}</p>}
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="create-delivery-note">{t("task.delivery_note")}</Label>
            <Textarea id="create-delivery-note" rows={2} maxLength={1000} value={form.deliveryNote} onChange={(e) => setForm({ ...form, deliveryNote: e.target.value })} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="create-supervisor-note">{t("drawer.supervisor_note")}</Label>
            <Textarea
              id="create-supervisor-note"
              rows={2}
              maxLength={1000}
              value={form.supervisorNote}
              onChange={(e) => setForm({ ...form, supervisorNote: e.target.value })}
            />
          </div>
          {!order.hasLocation && (
            <p className="flex items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-700 sm:col-span-2 dark:text-amber-400">
              <MapPinOff className="h-4 w-4 shrink-0" /> {t("ready.no_location_hint")}
            </p>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="secondary" disabled={create.isPending} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!valid || create.isPending} onClick={() => void submit()}>
            {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("ready.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Barchasini dostavshikka biriktirish": dostavshik, ixtiyoriy sana va eng qisqa tartib → bitta so'rov. Tartib saqlansa —
 * marshrut xaritada va navigatsiya havolalari bilan ko'rsatiladi.
 */
function BulkAssignDialog({
  items,
  place,
  onClose,
  onAssigned,
  onOpenTask,
}: {
  items: DispatchItem[];
  place: string;
  onClose: () => void;
  onAssigned: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const { t } = useTranslation("delivery");
  const { t: tMap } = useTranslation("map");
  const { can } = usePermissions();
  const today = todayLocal();
  const canRoutes = can("delivery.manage_routes");
  const agents = useApiQuery<{ agents: DeliveryAgentRow[] }>("/api/delivery/agents", { activeOnly: true }).data?.agents;
  const [agentId, setAgentId] = useState("");
  const [date, setDate] = useState("");
  const [optimize, setOptimize] = useState(true);
  const [plan, setPlan] = useState<AgentDayRoute<DeliveryTaskRow> | null>(null);
  const assign = useApiMutation((body: Record<string, unknown>) => api.post<DispatchAssignResult>("/api/delivery/dispatch/assign", body), {
    invalidate: ["/api/delivery"],
  });

  const submit = async () => {
    try {
      const result = await assign.mutateAsync({
        orderIds: items.filter((item) => item.kind === "order").map((item) => item.orderId),
        taskIds: items.filter((item) => item.kind === "task").map((item) => item.taskId),
        deliveryAgentId: agentId,
        ...(date ? { scheduledDate: date } : {}),
        optimize: optimize && canRoutes,
      });
      onAssigned();
      const agent = agents?.find((item) => item.id === agentId);
      toast.success(t("bulk.done", { count: result.taskIds.length, agent: agent?.name ?? agent?.code ?? "" }));
      if (result.optimizeError) toast.warning(t("bulk.optimize_failed", { message: result.optimizeError }));
      const first = result.routes[0];
      const route = first
        ? await api.post<AgentDayRoute<DeliveryTaskRow>>("/api/delivery/route-plan", { deliveryAgentId: agentId, date: first.date }).catch(() => null)
        : null;
      if (route && route.route.stops.length > 0) setPlan(route);
      else onClose();
    } catch (error) {
      toast.error(deliveryErrorMessage(error, t));
    }
  };

  if (plan) {
    const byId = new Map(plan.tasks.map((task) => [task.id, task]));
    const info = (id: string) => {
      const task = byId.get(id);
      return { id, title: task?.customerName ?? id, subtitle: task ? [task.number, task.customerAddress].filter(Boolean).join(" · ") : null };
    };
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[94vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("bulk.result_title")}</DialogTitle>
            <DialogDescription>
              {t("bulk.route_saved", { distance: formatDistance(plan.route.totalMeters), duration: formatDuration(plan.route.totalSeconds, tMap) })}
            </DialogDescription>
          </DialogHeader>
          <RoutePlanPanel
            plan={plan.route}
            stops={plan.route.stops.map((stop) => info(stop.id))}
            unlocated={plan.unlocatedTaskIds.map(info)}
            onOpen={(id) => {
              onClose();
              onOpenTask(id);
            }}
            mapClassName="h-[320px]"
            compactList
          />
          <DialogFooter>
            <Button onClick={onClose}>{t("common.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !assign.isPending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("bulk.title")}</DialogTitle>
          <DialogDescription>{t("bulk.description", { count: items.length, place })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>{t("bulk.agent")}</Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger>
                <SelectValue placeholder={t("assign.choose")} />
              </SelectTrigger>
              <SelectContent>
                {agents?.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name ?? agent.phone} · {agent.code}
                    {agent.territory ? ` · ${agent.territory}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="bulk-date">{t("bulk.date")}</Label>
            <Input id="bulk-date" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t("bulk.date_keep")}</p>
          </div>
          <div className="flex items-start gap-2 text-sm">
            <Checkbox id="bulk-optimize" className="mt-0.5" checked={optimize && canRoutes} disabled={!canRoutes} onCheckedChange={(value) => setOptimize(value === true)} />
            <label htmlFor="bulk-optimize" className="leading-snug">
              {t("bulk.optimize")}
              {!canRoutes && <span className="block text-xs text-muted-foreground">{t("bulk.optimize_no_permission")}</span>}
            </label>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="secondary" disabled={assign.isPending} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!agentId || assign.isPending} onClick={() => void submit()}>
            {assign.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Truck className="mr-2 h-4 w-4" />}
            {t("bulk.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Group = { key: string; title: string; color: string | null; items: DispatchItem[]; last: boolean };

function buildGroups(items: DispatchItem[], view: View, labels: { noRegion: string; noRoute: string; all: string }): Group[] {
  if (view === "list") {
    const sorted = [...items].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.customerName.localeCompare(b.customerName));
    return sorted.length ? [{ key: "all", title: labels.all, color: null, items: sorted, last: false }] : [];
  }
  const groups = new Map<string, Group>();
  const push = (key: string, title: string, item: DispatchItem, color: string | null, last: boolean) => {
    const group = groups.get(key) ?? { key, title, color, items: [], last };
    group.items.push(item);
    groups.set(key, group);
  };
  for (const item of items) {
    if (view === "region") {
      const city = item.city?.trim() || "";
      const district = item.district?.trim() || "";
      const title = city || district ? [city, district].filter(Boolean).join(" → ") : labels.noRegion;
      push(`region:${city.toLowerCase()}|${district.toLowerCase()}`, title, item, null, !city && !district);
    } else if (item.routes.length === 0) {
      push("route:none", labels.noRoute, item, null, true);
    } else {
      for (const route of item.routes) push(`route:${route.id}`, route.name, item, route.color, false);
    }
  }
  const position = (group: Group, item: DispatchItem) => item.routes.find((route) => `route:${route.id}` === group.key)?.position ?? 0;
  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) => (view === "route" ? position(group, a) - position(group, b) : 0) || a.customerName.localeCompare(b.customerName)),
    }))
    .sort((a, b) => Number(a.last) - Number(b.last) || a.title.localeCompare(b.title));
}

/** Guruh ichida do'konlar (mijoz) — har do'konda uning zakazlari. */
function shopsOf(items: DispatchItem[]) {
  const shops = new Map<string, DispatchItem[]>();
  for (const item of items) shops.set(item.customerId, [...(shops.get(item.customerId) ?? []), item]);
  return [...shops.values()];
}

/**
 * Yetkazish kerak bo'lganlar (buyurtma → yetkazma): hudud (shahar → mahalla) yoki distribyutsiya marshruti bo'yicha
 * guruhlangan do'konlar; "Barchasini dostavshikka biriktirish" — guruhdagi hamma zakaz bitta dostavshikka, eng qisqa
 * yo'l tartibida. Alohida tanlab biriktirish va bitta zakazdan yetkazma yaratish ham mumkin.
 */
export default function ReadySection({ money, onOpenTask }: { money: Money; onOpenTask: (taskId: string) => void }) {
  const { t } = useTranslation("delivery");
  const { can } = usePermissions();
  const canAssign = can("delivery.assign");
  const [view, setView] = useState<View>("region");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [creating, setCreating] = useState<OrderSummary | null>(null);
  const [bulk, setBulk] = useState<{ items: DispatchItem[]; place: string } | null>(null);
  const board = useApiQuery<DispatchBoard>("/api/delivery/dispatch");

  const items = useMemo(() => {
    const all = board.data?.items ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return all;
    return all.filter((item) =>
      [item.orderNumber, item.taskNumber, item.customerName, item.customerAddress, item.city, item.district].some((value) => value?.toLowerCase().includes(term)),
    );
  }, [board.data, search]);
  const groups = useMemo(
    () => buildGroups(items, view, { noRegion: t("ready.no_region"), noRoute: t("ready.no_route"), all: t("ready.all") }),
    [items, view, t],
  );
  const byKey = useMemo(() => new Map((board.data?.items ?? []).map((item) => [item.key, item])), [board.data]);
  const selectedItems = [...selected].map((key) => byKey.get(key)).filter((item): item is DispatchItem => item !== undefined);

  const toggle = (keys: string[], on: boolean) =>
    setSelected((previous) => {
      const next = new Set(previous);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });

  const VIEWS: { key: View; icon: typeof Layers }[] = [
    { key: "region", icon: Layers },
    { key: "route", icon: Route },
    { key: "list", icon: List },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex w-max gap-1 rounded-xl bg-muted p-1">
          {VIEWS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setView(item.key)}
              className={cn(
                "flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors",
                view === item.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <item.icon className="h-4 w-4" /> {t(`ready.view.${item.key}`)}
            </button>
          ))}
        </div>
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label={t("sv.filter.search")} className="pl-9" maxLength={100} value={search} placeholder={t("ready.search_hint")} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("ready.dispatch_hint")} {view === "region" && t("ready.region_hint")}
      </p>
      {board.data?.truncated && <p className="text-xs text-amber-700 dark:text-amber-400">{t("ready.truncated")}</p>}

      {canAssign && selectedItems.length > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-primary/30 bg-card px-4 py-2 shadow-sm">
          <CheckSquare className="h-4 w-4 text-primary" />
          <Button size="sm" onClick={() => setBulk({ items: selectedItems, place: t("ready.selected_place") })}>
            <Truck className="mr-1.5 h-4 w-4" /> {t("ready.assign_selected", { count: selectedItems.length })}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            {t("ready.clear")}
          </Button>
        </div>
      )}

      {board.isError ? (
        <p className="rounded-2xl border border-border bg-card p-4 text-sm text-destructive">{deliveryErrorMessage(board.error, t)}</p>
      ) : !board.data ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : groups.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">{t("ready.empty")}</p>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => {
            const keys = group.items.map((item) => item.key);
            const chosen = keys.filter((key) => selected.has(key)).length;
            const shops = shopsOf(group.items);
            const total = group.items.reduce((sum, item) => sum + num(item.totalAmount), 0);
            return (
              <section key={group.key} className="overflow-hidden rounded-2xl border border-border bg-card">
                <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
                  {canAssign && (
                    <Checkbox
                      aria-label={t("ready.select_group")}
                      checked={chosen === 0 ? false : chosen === keys.length ? true : "indeterminate"}
                      onCheckedChange={() => toggle(keys, chosen !== keys.length)}
                    />
                  )}
                  {group.color && <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: group.color }} />}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{group.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("ready.shops", { count: shops.length })} · {t("ready.orders_count", { count: group.items.length })} · {money(total)}
                    </p>
                  </div>
                  {canAssign && (
                    <Button size="sm" onClick={() => setBulk({ items: group.items, place: group.title })}>
                      <Truck className="mr-1.5 h-4 w-4" /> {t("ready.assign_all")}
                    </Button>
                  )}
                </header>
                <ol className="divide-y divide-border">
                  {shops.map((shopItems, index) => {
                    const first = shopItems[0]!;
                    const located = first.latitude !== null && first.longitude !== null;
                    return (
                      <li key={first.customerId} className="flex items-start gap-3 px-4 py-2.5">
                        <span className="w-6 pt-0.5 text-right text-xs font-bold tabular-nums text-muted-foreground">{index + 1}</span>
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                            {located ? <MapPin className="h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <MapPinOff className="h-3.5 w-3.5 shrink-0 text-amber-600" />}
                            <span className="truncate">{first.customerName}</span>
                            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                              {t("ready.has_order")}
                            </span>
                          </p>
                          {(first.customerAddress || (view !== "region" && (first.city || first.district))) && (
                            <p className="truncate text-xs text-muted-foreground">
                              {[view !== "region" ? [first.city, first.district].filter(Boolean).join(" → ") : null, first.customerAddress].filter(Boolean).join(" · ")}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-2">
                            {shopItems.map((item) => (
                              <div key={item.key} className="flex items-center gap-2 rounded-lg border border-border px-2 py-1 text-xs">
                                {canAssign && (
                                  <Checkbox aria-label={t("ready.select_item")} checked={selected.has(item.key)} onCheckedChange={(value) => toggle([item.key], value === true)} />
                                )}
                                <span className="font-medium">{item.taskNumber ?? item.orderNumber}</span>
                                <span className="tabular-nums text-muted-foreground">
                                  {item.date ?? "—"} · {money(item.totalAmount)}
                                </span>
                                {item.kind === "task" ? (
                                  <button type="button" className="font-medium text-primary hover:underline" onClick={() => onOpenTask(item.taskId!)}>
                                    {t("ready.open_task")}
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="flex items-center gap-1 font-medium text-primary hover:underline"
                                    onClick={() =>
                                      setCreating({
                                        id: item.orderId,
                                        number: item.orderNumber,
                                        deliveryDate: item.date,
                                        customerName: item.customerName,
                                        totalAmount: item.totalAmount,
                                        hasLocation: located,
                                      })
                                    }
                                  >
                                    <PackagePlus className="h-3.5 w-3.5" /> {t("ready.create")}
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            );
          })}
        </div>
      )}

      {creating && (
        <CreateTaskDialog
          order={creating}
          money={money}
          onClose={() => setCreating(null)}
          onCreated={(taskId) => {
            setCreating(null);
            onOpenTask(taskId);
          }}
        />
      )}
      {bulk && (
        <BulkAssignDialog
          items={bulk.items}
          place={bulk.place}
          onClose={() => setBulk(null)}
          onAssigned={() => toggle(bulk.items.map((item) => item.key), false)}
          onOpenTask={onOpenTask}
        />
      )}
    </div>
  );
}
