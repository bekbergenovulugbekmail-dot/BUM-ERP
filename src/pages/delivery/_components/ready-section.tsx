import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, MapPin, MapPinOff, PackagePlus, Search } from "lucide-react";
import { DELIVERY_PAYMENT_TYPES, DELIVERY_PRIORITIES, type DeliveryPaymentType, type DeliveryPriority } from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { usePermissions } from "@/hooks/use-company.ts";
import { api } from "@/lib/api.ts";
import { deliveryErrorMessage } from "@/lib/delivery/errors.ts";
import type { DeliveryAgentRow, DeliveryTaskDetail, ReadyOrder } from "@/lib/delivery/types.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { todayLocal } from "@/pages/sales/_lib/types.ts";

type Money = (value: string | number) => string;
const AUTO = "auto";
const NONE = "none";

function CreateTaskDialog({ order, money, onClose, onCreated }: { order: ReadyOrder; money: Money; onClose: () => void; onCreated: (taskId: string) => void }) {
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

/** Yetkazma yaratiladigan buyurtmalar: tasdiqlangan/jo'natilgan, mijozli, kassa emas, ochiq yoki yetkazilgan yetkazmasiz. */
export default function ReadySection({ money, onOpenTask }: { money: Money; onOpenTask: (taskId: string) => void }) {
  const { t } = useTranslation("delivery");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [creating, setCreating] = useState<ReadyOrder | null>(null);
  const orders = useApiQuery<{ orders: ReadyOrder[] }>("/api/delivery/ready-orders", term ? { search: term } : undefined).data?.orders;

  return (
    <div className="space-y-4">
      <form
        className="flex max-w-xl items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setTerm(search.trim());
        }}
      >
        <div className="flex-1 space-y-1">
          <Label htmlFor="ready-search">{t("sv.filter.search")}</Label>
          <Input id="ready-search" maxLength={100} value={search} placeholder={t("ready.search_hint")} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button type="submit" variant="secondary">
          <Search className="h-4 w-4" />
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">{t("ready.hint")}</p>

      {!orders ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">{t("sv.table.order")}</th>
                <th className="px-2 py-2 font-medium">{t("ready.delivery_date")}</th>
                <th className="px-2 py-2 font-medium">{t("sv.table.customer")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("sv.table.amount")}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    {t("ready.empty")}
                  </td>
                </tr>
              ) : (
                orders.map((order) => (
                  <tr key={order.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">
                      <p className="font-medium">{order.number}</p>
                      <p className="text-xs text-muted-foreground">
                        {order.orderDate}
                        {order.deliveryRequired ? ` · ${t("ready.required")}` : ""}
                      </p>
                    </td>
                    <td className="px-2 py-2 tabular-nums">{order.deliveryDate ?? "—"}</td>
                    <td className="max-w-[260px] px-2 py-2">
                      <p className="flex items-center gap-1.5 truncate font-medium">
                        {order.hasLocation ? <MapPin className="h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <MapPinOff className="h-3.5 w-3.5 shrink-0 text-amber-600" />}
                        <span className="truncate">{order.customerName}</span>
                      </p>
                      {order.customerAddress && <p className="truncate text-xs text-muted-foreground">{order.customerAddress}</p>}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{money(order.totalAmount)}</td>
                    <td className="px-4 py-2 text-right">
                      <Button size="sm" onClick={() => setCreating(order)}>
                        <PackagePlus className="mr-1.5 h-3.5 w-3.5" /> {t("ready.create")}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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
    </div>
  );
}
