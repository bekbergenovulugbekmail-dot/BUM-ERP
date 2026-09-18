import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ListOrdered, Loader2, Pencil, Plus, Power, Wallet } from "lucide-react";
import { isOpenDeliveryStatus } from "@bum/shared";
import DeliveryAgentDialog from "@/components/delivery/delivery-agent-dialog.tsx";
import NewEmployeeDialog from "@/components/company/new-employee-dialog.tsx";
import { StatusBadge } from "@/components/delivery/badges.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { usePermissions } from "@/hooks/use-company.ts";
import { api } from "@/lib/api.ts";
import { deliveryErrorMessage } from "@/lib/delivery/errors.ts";
import { timeWindow } from "@/lib/delivery/format.ts";
import type { DeliveryAgentRow, DeliveryTaskRow } from "@/lib/delivery/types.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import { todayLocal } from "@/pages/sales/_lib/types.ts";
import { STATUS_GROUPS } from "../_lib/filters.ts";

function ToggleDialog({ agent, onClose }: { agent: DeliveryAgentRow; onClose: () => void }) {
  const { t } = useTranslation("delivery");
  const toggle = useApiMutation(() => api.patch(`/api/delivery/agents/${agent.id}`, { isActive: !agent.isActive }), { invalidate: ["/api/delivery", "/api/hr"] });
  const submit = async () => {
    try {
      await toggle.mutateAsync();
      toast.success(agent.isActive ? t("agents.deactivated") : t("agents.activated"));
      onClose();
    } catch (error) {
      toast.error(deliveryErrorMessage(error, t));
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !toggle.isPending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{agent.isActive ? t("agents.deactivate") : t("agents.activate")}</DialogTitle>
          <DialogDescription>{agent.isActive ? t("agents.deactivate_hint") : t("agents.activate_hint")}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="secondary" disabled={toggle.isPending} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant={agent.isActive ? "destructive" : "default"} disabled={toggle.isPending} onClick={() => void submit()}>
            {toggle.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {agent.isActive ? t("agents.deactivate") : t("agents.activate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RouteList({ agent, date, tasks, onClose }: { agent: DeliveryAgentRow; date: string; tasks: DeliveryTaskRow[]; onClose: () => void }) {
  const { t } = useTranslation("delivery");
  const [order, setOrder] = useState(() =>
    [...tasks].sort((a, b) => (a.routeOrder ?? Number.MAX_SAFE_INTEGER) - (b.routeOrder ?? Number.MAX_SAFE_INTEGER)).map((task) => task.id),
  );
  const save = useApiMutation((taskIds: string[]) => api.put("/api/delivery/route-order", { deliveryAgentId: agent.id, date, taskIds }), {
    invalidate: ["/api/delivery"],
  });
  const move = (index: number, delta: number) =>
    setOrder((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  const submit = async () => {
    try {
      await save.mutateAsync(order);
      toast.success(t("agents.route_saved"));
      onClose();
    } catch (error) {
      toast.error(deliveryErrorMessage(error, t));
    }
  };
  const byId = new Map(tasks.map((task) => [task.id, task]));

  if (tasks.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{t("agents.route_empty")}</p>;
  return (
    <>
      <ol className="space-y-2">
        {order.map((id, index) => {
          const task = byId.get(id)!;
          const slot = timeWindow(task.windowStart, task.windowEnd);
          return (
            <li key={id} className="flex items-center gap-2 rounded-xl border border-border p-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary tabular-nums">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{task.customerName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {task.number}
                  {slot ? ` · ${slot}` : ""}
                  {task.customerAddress ? ` · ${task.customerAddress}` : ""}
                </p>
              </div>
              <StatusBadge status={task.status} />
              <Button size="icon" variant="ghost" className="h-8 w-8" disabled={index === 0} aria-label={t("agents.move_up")} onClick={() => move(index, -1)}>
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                disabled={index === order.length - 1}
                aria-label={t("agents.move_down")}
                onClick={() => move(index, 1)}
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
            </li>
          );
        })}
      </ol>
      <DialogFooter className="gap-2">
        <Button variant="secondary" disabled={save.isPending} onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button disabled={save.isPending} onClick={() => void submit()}>
          {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t("common.save")}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Kunlik yetkazish tartibi: agentning shu kundagi ochiq yetkazmalari (1, 2, 3 …). Avtomatik optimallashtirish yo'q. */
function RouteOrderDialog({ agent, onClose }: { agent: DeliveryAgentRow; onClose: () => void }) {
  const { t } = useTranslation("delivery");
  const [date, setDate] = useState(todayLocal);
  const query = useApiQuery<{ tasks: DeliveryTaskRow[] }>("/api/delivery/tasks", {
    agentId: agent.id,
    dateFrom: date,
    dateTo: date,
    status: STATUS_GROUPS.open.join(","),
    limit: 200,
  });
  const tasks = query.data?.tasks.filter((task) => isOpenDeliveryStatus(task.status));
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("agents.route_title", { name: agent.name ?? agent.code })}</DialogTitle>
          <DialogDescription>{t("agents.route_hint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="route-date">{t("sv.table.date")}</Label>
          <Input id="route-date" type="date" className="w-44" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </div>
        {!tasks ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : (
          <RouteList key={`${date}:${query.dataUpdatedAt}`} agent={agent} date={date} tasks={tasks} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

type AgentCash = {
  balance: string;
  currency: string;
  cashAccountId: string | null;
  handovers: { id: string; amount: string; txDate: string; description: string | null }[];
};

/** Yetkazuvchidagi (dostavkada yig'ilgan, kassaga topshirilmagan) naqd va kassaga topshirish. */
function CashDialog({ agent, onClose }: { agent: DeliveryAgentRow; onClose: () => void }) {
  const { t } = useTranslation("delivery");
  const { can } = usePermissions();
  const cash = useApiQuery<{ cash: AgentCash }>(`/api/delivery/agents/${agent.id}/cash`).data?.cash;
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const handover = useApiMutation(
    (body: { amount: string; notes: string | null }) => api.post(`/api/delivery/agents/${agent.id}/cash-handover`, body),
    { invalidate: ["/api/delivery", "/api/finance"] },
  );
  const balance = Number(cash?.balance ?? 0);
  const money = (value: number) => `${new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 2 }).format(value)} ${cash?.currency ?? ""}`;
  const canHandover = can("delivery.manage") && balance > 0;

  const submit = async () => {
    try {
      await handover.mutateAsync({ amount: amount.trim() || String(balance), notes: notes.trim() || null });
      toast.success(t("agents.cash_handed"));
      setAmount("");
      setNotes("");
    } catch (error) {
      toast.error(deliveryErrorMessage(error, t));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !handover.isPending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("agents.cash_title", { name: agent.name ?? agent.code })}</DialogTitle>
          <DialogDescription>{t("agents.cash_hint")}</DialogDescription>
        </DialogHeader>
        {!cash ? (
          <Skeleton className="h-32 rounded-xl" />
        ) : (
          <div className="space-y-3">
            <div className="flex items-baseline justify-between rounded-xl bg-muted/40 px-4 py-3">
              <span className="text-sm text-muted-foreground">{t("agents.cash_balance")}</span>
              <span className="text-lg font-bold tabular-nums">{money(balance)}</span>
            </div>
            {canHandover ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="cash-handover-amount">{t("agents.cash_amount")}</Label>
                  <Input id="cash-handover-amount" type="number" min={0} step="any" placeholder={String(balance)} value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cash-handover-notes">{t("agents.cash_notes")}</Label>
                  <Input id="cash-handover-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
              </div>
            ) : (
              balance <= 0 && <p className="text-sm text-muted-foreground">{t("agents.cash_empty")}</p>
            )}
            {cash.handovers.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">{t("agents.cash_history")}</p>
                <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
                  {cash.handovers.map((row) => (
                    <li key={row.id} className="flex justify-between gap-2">
                      <span className="truncate text-muted-foreground">{row.txDate}</span>
                      <span className="tabular-nums">{money(Number(row.amount))}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="secondary" disabled={handover.isPending} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          {canHandover && (
            <Button disabled={handover.isPending} onClick={() => void submit()}>
              {handover.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("agents.cash_handover")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Yetkazuvchilar: profil (filial, hudud, zona, transport, yuk, jadval, supervayzer), faollik va kunlik yetkazish tartibi. */
export default function AgentsSection() {
  const { t } = useTranslation("delivery");
  const { can } = usePermissions();
  const manage = can("delivery.manage");
  const agents = useApiQuery<{ agents: DeliveryAgentRow[] }>("/api/delivery/agents").data?.agents;
  const [editing, setEditing] = useState<DeliveryAgentRow | null>(null);
  const [toggling, setToggling] = useState<DeliveryAgentRow | null>(null);
  const [routing, setRouting] = useState<DeliveryAgentRow | null>(null);
  const [cashFor, setCashFor] = useState<DeliveryAgentRow | null>(null);
  /** Yagona "Xodim qo'shish" oynasi. */
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t("agents.subtitle")}</p>
        {/* Yetkazuvchi yagona "Xodim qo'shish" formasidan: rol "Dostavka agenti" bo'lsa profil ham yaratiladi */}
        {manage && (
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> {t("agents.add")}
          </Button>
        )}
      </div>

      {!agents ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">{t("agents.name")}</th>
                <th className="px-2 py-2 font-medium">{t("agents.territory")}</th>
                <th className="px-2 py-2 font-medium">{t("agents.vehicle_type")}</th>
                <th className="px-2 py-2 font-medium">{t("agents.supervisor")}</th>
                <th className="px-2 py-2 font-medium">{t("agents.schedule")}</th>
                <th className="px-2 py-2 font-medium">{t("agents.status")}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {agents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    {t("agents.empty")}
                  </td>
                </tr>
              ) : (
                agents.map((agent) => (
                  <tr key={agent.id} className={cn("border-b border-border last:border-0", !agent.isActive && "opacity-60")}>
                    <td className="px-4 py-2">
                      <p className="font-medium">{agent.name ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        {agent.code} · {agent.phone}
                      </p>
                    </td>
                    <td className="px-2 py-2">
                      <p>{agent.territory ?? "—"}</p>
                      {(agent.deliveryZone || agent.branchName) && (
                        <p className="text-xs text-muted-foreground">{[agent.branchName, agent.deliveryZone].filter(Boolean).join(" · ")}</p>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <p>{agent.vehicleType ? t(`vehicle.${agent.vehicleType}`) : "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        {[agent.vehicleNumber, agent.maxLoadKg ? `${Number(agent.maxLoadKg)} kg` : null].filter(Boolean).join(" · ")}
                      </p>
                    </td>
                    <td className="px-2 py-2">{agent.supervisorName ?? "—"}</td>
                    <td className="px-2 py-2 text-xs">
                      {agent.workingSchedule
                        ? `${[1, 2, 3, 4, 5, 6, 0]
                            .filter((day) => agent.workingSchedule!.days.includes(day))
                            .map((day) => t(`agents.day_short.${day}`))
                            .join(", ")} · ${agent.workingSchedule.start}–${agent.workingSchedule.end}`
                        : "—"}
                    </td>
                    <td className="px-2 py-2">
                      <span className={cn("text-xs font-semibold", agent.isActive ? "text-emerald-600" : "text-muted-foreground")}>
                        {agent.isActive ? t("agents.active") : t("agents.inactive")}
                      </span>
                      {agent.isActive && !agent.loginActive && <p className="text-[11px] text-destructive">{t("agents.login_blocked")}</p>}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-8 w-8" title={t("agents.cash")} onClick={() => setCashFor(agent)}>
                          <Wallet className="h-4 w-4" />
                        </Button>
                        {can("delivery.manage_routes") && agent.isActive && (
                          <Button size="icon" variant="ghost" className="h-8 w-8" title={t("agents.route")} onClick={() => setRouting(agent)}>
                            <ListOrdered className="h-4 w-4" />
                          </Button>
                        )}
                        {manage && (
                          <>
                            <Button size="icon" variant="ghost" className="h-8 w-8" title={t("agents.edit")} onClick={() => setEditing(agent)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className={cn("h-8 w-8", agent.isActive && "text-destructive")}
                              title={agent.isActive ? t("agents.deactivate") : t("agents.activate")}
                              onClick={() => setToggling(agent)}
                            >
                              <Power className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <NewEmployeeDialog open={addOpen} onClose={() => setAddOpen(false)} />
      {editing && <DeliveryAgentDialog agent={editing} onClose={() => setEditing(null)} />}
      {toggling && <ToggleDialog agent={toggling} onClose={() => setToggling(null)} />}
      {routing && <RouteOrderDialog agent={routing} onClose={() => setRouting(null)} />}
      {cashFor && <CashDialog agent={cashFor} onClose={() => setCashFor(null)} />}
    </div>
  );
}
