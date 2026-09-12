/**
 * Supervayzer amallari: biriktirish / boshqa agentga o'tkazish, biriktirishni olib tashlash, qayta rejalash, tahrirlash
 * (yo'lga chiqquncha summa va vaqt oynasi), OTP berish, to'lov farqini ko'rib chiqish, qaytgan mahsulotni omborga qabul
 * qilish, bekor qilish. Holat o'tishi va ruxsat — serverda.
 */
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { DELIVERY_PAYMENT_TYPES, DELIVERY_PRIORITIES, type DeliveryPaymentType, type DeliveryPriority } from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { api } from "@/lib/api.ts";
import { deliveryErrorMessage } from "@/lib/delivery/errors.ts";
import { formatDateTime } from "@/lib/delivery/format.ts";
import { num, type DeliveryAgentRow, type DeliveryTaskDetail } from "@/lib/delivery/types.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { todayLocal } from "@/pages/sales/_lib/types.ts";

export type TaskDialogKind = "assign" | "unassign" | "reschedule" | "edit" | "otp" | "review" | "return" | "cancel";
type Money = (value: string | number) => string;
type DialogProps = { task: DeliveryTaskDetail; money: Money; onClose: () => void };

const MONEY_RE = /^\d{1,13}(\.\d{1,2})?$/;
const BEFORE_ROUTE = ["ready", "assigned", "accepted"];
const REFUND_METHODS = ["balance", "cash", "card", "bank"] as const;

function useTaskAction() {
  const { t } = useTranslation("delivery");
  const mutation = useApiMutation((fn: () => Promise<unknown>) => fn(), { invalidate: ["/api/delivery"] });
  const submit = async <T,>(fn: () => Promise<T>, successKey?: string): Promise<T | null> => {
    try {
      const result = (await mutation.mutateAsync(fn)) as T;
      if (successKey) toast.success(t(successKey));
      return result;
    } catch (error) {
      toast.error(deliveryErrorMessage(error, t));
      return null;
    }
  };
  return { submit, pending: mutation.isPending };
}

function Shell({
  title,
  description,
  children,
  onClose,
  footer,
  pending,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  onClose: () => void;
  footer: ReactNode;
  pending: boolean;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        <DialogFooter className="gap-2">{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Actions({ onClose, pending, disabled, label, onSubmit, destructive }: {
  onClose: () => void;
  pending: boolean;
  disabled?: boolean;
  label: string;
  onSubmit: () => void;
  destructive?: boolean;
}) {
  const { t } = useTranslation("delivery");
  return (
    <>
      <Button variant="secondary" disabled={pending} onClick={onClose}>
        {t("common.cancel")}
      </Button>
      <Button variant={destructive ? "destructive" : "default"} disabled={pending || disabled} onClick={onSubmit}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {label}
      </Button>
    </>
  );
}

function AssignDialog({ task, onClose }: DialogProps) {
  const { t } = useTranslation("delivery");
  const today = todayLocal();
  const agents = useApiQuery<{ agents: DeliveryAgentRow[] }>("/api/delivery/agents", { activeOnly: true }).data?.agents;
  const [agentId, setAgentId] = useState(task.deliveryAgentId ?? "");
  const [date, setDate] = useState(task.scheduledDate < today ? today : task.scheduledDate);
  const [routeOrder, setRouteOrder] = useState("");
  const { submit, pending } = useTaskAction();
  const valid = agentId !== "" && date >= today && (routeOrder === "" || (/^\d{1,5}$/.test(routeOrder) && Number(routeOrder) >= 1));

  const save = async () => {
    const body = { deliveryAgentId: agentId, scheduledDate: date, ...(routeOrder ? { routeOrder: Number(routeOrder) } : {}) };
    if (await submit(() => api.post(`/api/delivery/tasks/${task.id}/assign`, body), "drawer.saved_assign")) onClose();
  };

  return (
    <Shell
      title={task.deliveryAgentId ? t("drawer.reassign") : t("drawer.assign")}
      description={t("assign.hint")}
      onClose={onClose}
      pending={pending}
      footer={<Actions onClose={onClose} pending={pending} disabled={!valid} label={t("assign.submit")} onSubmit={() => void save()} />}
    >
      <div className="space-y-3">
        <div className="space-y-1">
          <Label>{t("sv.table.agent")}</Label>
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
          {agents && agents.length === 0 && <p className="text-xs text-muted-foreground">{t("assign.no_agents")}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="assign-date">{t("sv.table.date")}</Label>
            <Input id="assign-date" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="assign-order">{t("drawer.route_order")}</Label>
            <Input id="assign-order" inputMode="numeric" placeholder={t("assign.auto")} value={routeOrder} onChange={(e) => setRouteOrder(e.target.value)} />
          </div>
        </div>
      </div>
    </Shell>
  );
}

function UnassignDialog({ task, onClose }: DialogProps) {
  const { t } = useTranslation("delivery");
  const { submit, pending } = useTaskAction();
  const save = async () => {
    if (await submit(() => api.post(`/api/delivery/tasks/${task.id}/unassign`), "drawer.saved_unassign")) onClose();
  };
  return (
    <Shell
      title={t("drawer.unassign")}
      description={t("unassign.hint", { agent: task.agent?.name ?? task.agent?.code ?? "" })}
      onClose={onClose}
      pending={pending}
      footer={<Actions onClose={onClose} pending={pending} label={t("drawer.unassign")} onSubmit={() => void save()} destructive />}
    />
  );
}

function RescheduleDialog({ task, onClose }: DialogProps) {
  const { t } = useTranslation("delivery");
  const today = todayLocal();
  const [date, setDate] = useState(task.scheduledDate < today ? today : task.scheduledDate);
  const [windowStart, setWindowStart] = useState(task.windowStart ?? "");
  const [windowEnd, setWindowEnd] = useState(task.windowEnd ?? "");
  const [reason, setReason] = useState("");
  const { submit, pending } = useTaskAction();
  const windowValid = (windowStart === "") === (windowEnd === "") && (windowStart === "" || windowStart < windowEnd);
  const valid = date >= today && windowValid;

  const save = async () => {
    const body = { scheduledDate: date, windowStart: windowStart || null, windowEnd: windowEnd || null, reason: reason.trim() || null };
    if (await submit(() => api.post(`/api/delivery/tasks/${task.id}/reschedule`, body), "drawer.saved_reschedule")) onClose();
  };

  return (
    <Shell
      title={t("drawer.reschedule")}
      description={t("reschedule.hint")}
      onClose={onClose}
      pending={pending}
      footer={<Actions onClose={onClose} pending={pending} disabled={!valid} label={t("common.save")} onSubmit={() => void save()} />}
    >
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="reschedule-date">{t("sv.table.date")}</Label>
          <Input id="reschedule-date" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="reschedule-start">{t("edit.window_start")}</Label>
            <Input id="reschedule-start" type="time" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="reschedule-end">{t("edit.window_end")}</Label>
            <Input id="reschedule-end" type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
          </div>
        </div>
        {!windowValid && <p className="text-xs text-destructive">{t("edit.window_invalid")}</p>}
        <div className="space-y-1">
          <Label htmlFor="reschedule-reason">{t("reschedule.reason")}</Label>
          <Textarea id="reschedule-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
    </Shell>
  );
}

function EditDialog({ task, onClose }: DialogProps) {
  const { t } = useTranslation("delivery");
  const planning = BEFORE_ROUTE.includes(task.status);
  const [priority, setPriority] = useState<DeliveryPriority>(task.priority);
  const [paymentType, setPaymentType] = useState<DeliveryPaymentType>(task.paymentType);
  const [expected, setExpected] = useState(String(num(task.expectedAmount)));
  const [windowStart, setWindowStart] = useState(task.windowStart ?? "");
  const [windowEnd, setWindowEnd] = useState(task.windowEnd ?? "");
  const [deliveryNote, setDeliveryNote] = useState(task.deliveryNote ?? "");
  const [supervisorNote, setSupervisorNote] = useState(task.supervisorNote ?? "");
  const { submit, pending } = useTaskAction();
  const windowValid = (windowStart === "") === (windowEnd === "") && (windowStart === "" || windowStart < windowEnd);
  const expectedValid = MONEY_RE.test(expected.trim());

  const save = async () => {
    const body: Record<string, unknown> = {};
    if (priority !== task.priority) body.priority = priority;
    if (deliveryNote.trim() !== (task.deliveryNote ?? "")) body.deliveryNote = deliveryNote.trim() || null;
    if (supervisorNote.trim() !== (task.supervisorNote ?? "")) body.supervisorNote = supervisorNote.trim() || null;
    if (planning) {
      if (paymentType !== task.paymentType) body.paymentType = paymentType;
      if (num(expected) !== num(task.expectedAmount)) body.expectedAmount = expected.trim();
      if ((windowStart || null) !== task.windowStart || (windowEnd || null) !== task.windowEnd) {
        body.windowStart = windowStart || null;
        body.windowEnd = windowEnd || null;
      }
    }
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    if (await submit(() => api.patch(`/api/delivery/tasks/${task.id}`, body), "drawer.saved")) onClose();
  };

  return (
    <Shell
      title={t("drawer.edit")}
      description={planning ? undefined : t("edit.on_route_hint")}
      onClose={onClose}
      pending={pending}
      footer={
        <Actions onClose={onClose} pending={pending} disabled={planning && (!windowValid || !expectedValid)} label={t("common.save")} onSubmit={() => void save()} />
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>{t("edit.priority")}</Label>
            <Select value={priority} onValueChange={(value) => setPriority(value as DeliveryPriority)}>
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
          {planning && (
            <div className="space-y-1">
              <Label>{t("task.payment_type")}</Label>
              <Select value={paymentType} onValueChange={(value) => setPaymentType(value as DeliveryPaymentType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DELIVERY_PAYMENT_TYPES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {t(`payment_type.${item}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        {planning && (
          <>
            <div className="space-y-1">
              <Label htmlFor="edit-expected">{t("task.expected")}</Label>
              <Input id="edit-expected" inputMode="decimal" value={expected} onChange={(e) => setExpected(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">{t("edit.expected_hint")}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="edit-start">{t("edit.window_start")}</Label>
                <Input id="edit-start" type="time" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-end">{t("edit.window_end")}</Label>
                <Input id="edit-end" type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
              </div>
            </div>
            {!windowValid && <p className="text-xs text-destructive">{t("edit.window_invalid")}</p>}
          </>
        )}
        <div className="space-y-1">
          <Label htmlFor="edit-delivery-note">{t("task.delivery_note")}</Label>
          <Textarea id="edit-delivery-note" rows={2} maxLength={1000} value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} />
          <p className="text-[11px] text-muted-foreground">{t("edit.delivery_note_hint")}</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="edit-supervisor-note">{t("drawer.supervisor_note")}</Label>
          <Textarea id="edit-supervisor-note" rows={2} maxLength={1000} value={supervisorNote} onChange={(e) => setSupervisorNote(e.target.value)} />
          <p className="text-[11px] text-muted-foreground">{t("edit.supervisor_note_hint")}</p>
        </div>
      </div>
    </Shell>
  );
}

function OtpDialog({ task, onClose }: DialogProps) {
  const { t, i18n } = useTranslation("delivery");
  const { submit, pending } = useTaskAction();
  const [otp, setOtp] = useState<{ code: string; expiresAt: string; smsSent: boolean } | null>(null);
  const issue = async () => {
    const result = await submit(() => api.post<{ otp: { code: string; expiresAt: string; smsSent: boolean } }>(`/api/delivery/tasks/${task.id}/otp`));
    if (result) setOtp(result.otp);
  };
  return (
    <Shell
      title={t("drawer.otp")}
      description={t("otp.issue_hint")}
      onClose={onClose}
      pending={pending}
      footer={
        <>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button disabled={pending} onClick={() => void issue()}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {otp ? t("otp.issue_again") : t("otp.issue")}
          </Button>
        </>
      }
    >
      {otp && (
        <div className="space-y-2 rounded-xl bg-muted/50 p-4 text-center">
          <p className="text-4xl font-bold tracking-[0.3em] tabular-nums">{otp.code}</p>
          <p className="text-xs text-muted-foreground">{t("otp.valid_until", { time: formatDateTime(otp.expiresAt, i18n.language) })}</p>
          <p className="text-sm">{otp.smsSent ? t("otp.sms_sent") : t("otp.tell_customer")}</p>
        </div>
      )}
    </Shell>
  );
}

function ReviewDialog({ task, money, onClose }: DialogProps) {
  const { t } = useTranslation("delivery");
  const [note, setNote] = useState("");
  const { submit, pending } = useTaskAction();
  const mismatch = Math.max(0, num(task.expectedAmount) - num(task.collectedAmount));
  const decide = async (decision: "approved" | "rejected") => {
    if (await submit(() => api.post(`/api/delivery/tasks/${task.id}/payment-review`, { decision, note: note.trim() }), "drawer.saved_review")) onClose();
  };
  const valid = note.trim().length >= 3;
  return (
    <Shell
      title={t("drawer.review")}
      description={t("review.hint")}
      onClose={onClose}
      pending={pending}
      footer={
        <>
          <Button variant="destructive" disabled={pending || !valid} onClick={() => void decide("rejected")}>
            {t("review.reject")}
          </Button>
          <Button disabled={pending || !valid} onClick={() => void decide("approved")}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("review.approve")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <div className="rounded-xl bg-muted/50 p-2">
            <p className="text-xs text-muted-foreground">{t("task.expected")}</p>
            <p className="font-semibold tabular-nums">{money(task.expectedAmount)}</p>
          </div>
          <div className="rounded-xl bg-muted/50 p-2">
            <p className="text-xs text-muted-foreground">{t("task.collected")}</p>
            <p className="font-semibold tabular-nums">{money(task.collectedAmount)}</p>
          </div>
          <div className="rounded-xl bg-amber-500/10 p-2">
            <p className="text-xs text-muted-foreground">{t("success.mismatch")}</p>
            <p className="font-semibold text-amber-700 tabular-nums dark:text-amber-400">{money(mismatch)}</p>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="review-note">{t("review.note")} *</Label>
          <Textarea id="review-note" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
    </Shell>
  );
}

function ReturnDialog({ task, onClose }: DialogProps) {
  const { t } = useTranslation("delivery");
  const [refundMethod, setRefundMethod] = useState<(typeof REFUND_METHODS)[number]>("balance");
  const [reason, setReason] = useState("");
  const { submit, pending } = useTaskAction();
  const remaining = task.items
    .map((item) => ({ item, qty: num(item.quantity) - num(item.deliveredQty) - num(item.returnedQty) }))
    .filter((line) => line.qty > 0);
  const save = async () => {
    if (await submit(() => api.post(`/api/delivery/tasks/${task.id}/return`, { refundMethod, reason: reason.trim() || null }), "drawer.saved_return")) onClose();
  };
  return (
    <Shell
      title={t("drawer.return")}
      description={t("return.hint")}
      onClose={onClose}
      pending={pending}
      footer={<Actions onClose={onClose} pending={pending} disabled={remaining.length === 0} label={t("return.submit")} onSubmit={() => void save()} />}
    >
      <div className="space-y-3">
        <ul className="divide-y divide-border rounded-xl border border-border text-sm">
          {remaining.length === 0 ? (
            <li className="p-3 text-muted-foreground">{t("error.nothing_to_return")}</li>
          ) : (
            remaining.map((line) => (
              <li key={line.item.id} className="flex justify-between gap-2 p-2">
                <span>{line.item.productName}</span>
                <span className="font-medium tabular-nums">
                  {Math.round(line.qty * 10_000) / 10_000} {line.item.unitName}
                </span>
              </li>
            ))
          )}
        </ul>
        <div className="space-y-1">
          <Label>{t("return.refund_method")}</Label>
          <Select value={refundMethod} onValueChange={(value) => setRefundMethod(value as (typeof REFUND_METHODS)[number])}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REFUND_METHODS.map((item) => (
                <SelectItem key={item} value={item}>
                  {t(`refund.${item}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {num(task.collectedAmount) > 0 && <p className="text-[11px] text-muted-foreground">{t("return.refund_hint")}</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="return-reason">{t("return.reason")}</Label>
          <Textarea id="return-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
    </Shell>
  );
}

function CancelDialog({ task, onClose }: DialogProps) {
  const { t } = useTranslation("delivery");
  const [reason, setReason] = useState("");
  const { submit, pending } = useTaskAction();
  const save = async () => {
    if (await submit(() => api.post(`/api/delivery/tasks/${task.id}/cancel`, { reason: reason.trim() }), "drawer.saved_cancel")) onClose();
  };
  return (
    <Shell
      title={t("drawer.cancel")}
      description={t("cancel.hint")}
      onClose={onClose}
      pending={pending}
      footer={<Actions onClose={onClose} pending={pending} disabled={reason.trim().length < 3} label={t("drawer.cancel")} onSubmit={() => void save()} destructive />}
    >
      <div className="space-y-1">
        <Label htmlFor="cancel-reason">{t("cancel.reason")} *</Label>
        <Textarea id="cancel-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Shell>
  );
}

export default function TaskDialog({ kind, ...props }: DialogProps & { kind: TaskDialogKind }) {
  switch (kind) {
    case "assign":
      return <AssignDialog {...props} />;
    case "unassign":
      return <UnassignDialog {...props} />;
    case "reschedule":
      return <RescheduleDialog {...props} />;
    case "edit":
      return <EditDialog {...props} />;
    case "otp":
      return <OtpDialog {...props} />;
    case "review":
      return <ReviewDialog {...props} />;
    case "return":
      return <ReturnDialog {...props} />;
    case "cancel":
      return <CancelDialog {...props} />;
  }
}
