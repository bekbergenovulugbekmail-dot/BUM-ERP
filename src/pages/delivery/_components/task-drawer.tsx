import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Ban, CalendarClock, KeyRound, MapPin, Pencil, Phone, RotateCcw, Scale, UserMinus, UserPlus,
  type LucideIcon,
} from "lucide-react";
import { canDeliveryTransition, isOpenDeliveryStatus } from "@bum/shared";
import { LateBadge, PriorityBadge, StatusBadge } from "@/components/delivery/badges.tsx";
import LocationLink from "@/components/maps/location-link.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { usePermissions } from "@/hooks/use-company.ts";
import { apiUrl } from "@/lib/api.ts";
import { deliveryErrorMessage } from "@/lib/delivery/errors.ts";
import { coordsOf, formatDateTime, formatDistance, timeWindow } from "@/lib/delivery/format.ts";
import { num, type DeliveryTaskDetail } from "@/lib/delivery/types.ts";
import { useLiveInterval } from "@/lib/delivery/realtime.ts";
import { useApiQuery } from "@/lib/query.ts";
import TaskDialog, { type TaskDialogKind } from "./task-dialogs.tsx";

type Money = (value: string | number) => string;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1 rounded-xl border border-border p-3">
      <p className="pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </section>
  );
}

const RESCHEDULABLE = ["ready", "assigned", "accepted", "failed"];
const ON_ROUTE = ["out_for_delivery", "arrived", "delivering"];

function DrawerBody({ taskId, money }: { taskId: string; money: Money }) {
  const { t, i18n } = useTranslation("delivery");
  const { can } = usePermissions();
  const [dialog, setDialog] = useState<TaskDialogKind | null>(null);
  const interval = useLiveInterval(30_000);
  const query = useApiQuery<{ task: DeliveryTaskDetail }>(`/api/delivery/tasks/${taskId}`, undefined, { refetchInterval: interval });
  const task = query.data?.task;

  if (!task) {
    return query.isError ? (
      <p className="p-4 text-sm text-destructive">{deliveryErrorMessage(query.error, t)}</p>
    ) : (
      <div className="space-y-3 p-4">
        <Skeleton className="h-10 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  const hasAgent = task.deliveryAgentId !== null;
  const actions: { kind: TaskDialogKind; label: string; icon: LucideIcon; visible: boolean; destructive?: boolean }[] = [
    { kind: "assign", label: hasAgent ? t("drawer.reassign") : t("drawer.assign"), icon: UserPlus, visible: can("delivery.assign") && canDeliveryTransition(task.status, "assigned") },
    { kind: "unassign", label: t("drawer.unassign"), icon: UserMinus, visible: hasAgent && can("delivery.reassign") && canDeliveryTransition(task.status, "ready") },
    { kind: "reschedule", label: t("drawer.reschedule"), icon: CalendarClock, visible: can("delivery.manage") && RESCHEDULABLE.includes(task.status) },
    { kind: "edit", label: t("drawer.edit"), icon: Pencil, visible: can("delivery.manage") && isOpenDeliveryStatus(task.status) },
    { kind: "otp", label: t("drawer.otp"), icon: KeyRound, visible: can("delivery.manage") && ON_ROUTE.includes(task.status) },
    { kind: "review", label: t("drawer.review"), icon: Scale, visible: can("delivery.manage") && task.paymentReview === "pending" },
    {
      kind: "return",
      label: t("drawer.return"),
      icon: RotateCcw,
      visible: can("delivery.return") && (task.status === "failed" || (task.status === "partially_delivered" && task.returnedAt === null)),
    },
    { kind: "cancel", label: t("drawer.cancel"), icon: Ban, visible: can("delivery.manage") && canDeliveryTransition(task.status, "cancelled"), destructive: true },
  ];
  const visible = actions.filter((action) => action.visible);
  const target = coordsOf(task.customer.latitude, task.customer.longitude);
  const slot = timeWindow(task.windowStart, task.windowEnd);
  const mismatch = Math.max(0, num(task.expectedAmount) - num(task.collectedAmount));

  return (
    <div className="space-y-3 px-4 pb-6">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={task.status} />
        {task.overdue && <LateBadge />}
        <PriorityBadge priority={task.priority} />
        {task.paymentReview !== "none" && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
            {t(`review.${task.paymentReview}`)}
          </span>
        )}
      </div>

      {visible.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {visible.map((action) => (
            <Button key={action.kind} size="sm" variant={action.destructive ? "destructive" : "secondary"} onClick={() => setDialog(action.kind)}>
              <action.icon className="mr-1.5 h-3.5 w-3.5" /> {action.label}
            </Button>
          ))}
        </div>
      )}

      <Block title={t("drawer.planning")}>
        <Field label={t("sv.table.agent")}>
          {task.agent ? `${task.agent.name ?? task.agent.phone} · ${task.agent.code}` : <span className="text-amber-600">{t("sv.unassigned_agent")}</span>}
        </Field>
        <Field label={t("sv.table.date")}>
          {task.scheduledDate}
          {slot ? ` · ${slot}` : ""}
        </Field>
        {task.routeOrder !== null && <Field label={t("drawer.route_order")}>№{task.routeOrder}</Field>}
        {task.assignedAt && <Field label={t("drawer.assigned_at")}>{formatDateTime(task.assignedAt, i18n.language)}</Field>}
        {task.acceptedAt && <Field label={t("step.accepted")}>{formatDateTime(task.acceptedAt, i18n.language)}</Field>}
        {task.startedAt && <Field label={t("step.out_for_delivery")}>{formatDateTime(task.startedAt, i18n.language)}</Field>}
        {task.arrivedAt && (
          <Field label={t("step.arrived")}>
            {formatDateTime(task.arrivedAt, i18n.language)}
            {task.arrivalDistanceMeters !== null ? ` · ${formatDistance(task.arrivalDistanceMeters)}` : ""}
          </Field>
        )}
        {task.deliveredAt && (
          <Field label={t("step.delivered")}>
            {formatDateTime(task.deliveredAt, i18n.language)}
            {task.confirmDistanceMeters !== null ? ` · ${formatDistance(task.confirmDistanceMeters)}` : ""}
          </Field>
        )}
        {task.failedAt && <Field label={t("status.failed")}>{formatDateTime(task.failedAt, i18n.language)}</Field>}
        {task.returnedAt && <Field label={t("status.returned")}>{formatDateTime(task.returnedAt, i18n.language)}</Field>}
        {task.failureReason && <Field label={t("task.failure")}>{t(`failure.${task.failureReason}`)}</Field>}
        {task.failureComment && <p className="text-sm text-muted-foreground">{task.failureComment}</p>}
        {task.cancelReason && <Field label={t("task.cancel_reason")}>{task.cancelReason}</Field>}
      </Block>

      <Block title={t("task.customer")}>
        <p className="font-medium">{task.customer.name}</p>
        {task.customer.address && <p className="text-sm text-muted-foreground">{task.customer.address}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          {task.customer.phone && (
            <Button asChild size="sm" variant="ghost">
              <a href={`tel:${task.customer.phone}`}>
                <Phone className="mr-1.5 h-3.5 w-3.5" /> {task.customer.phone}
              </a>
            </Button>
          )}
          {target ? (
            <LocationLink latitude={target.latitude} longitude={target.longitude} label={task.customer.name}>
              <MapPin className="mr-1.5 h-3.5 w-3.5" /> {t("task.map")}
            </LocationLink>
          ) : (
            <span className="text-xs text-amber-600">{t("task.no_location")}</span>
          )}
        </div>
        {task.customer.totalDebt !== undefined && <Field label={t("task.customer_debt")}>{money(task.customer.totalDebt)}</Field>}
      </Block>

      <Block title={`${t("task.order")} ${task.order.number}`}>
        <ul className="divide-y divide-border">
          {task.items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 py-1.5 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{item.productName}</p>
                <p className="text-xs text-muted-foreground">
                  {Number(item.quantity)} {item.unitName}
                  {item.deliveredQty !== null ? ` · ${t("task.delivered_qty", { qty: Number(item.deliveredQty) })}` : ""}
                  {num(item.returnedQty) > 0 ? ` · ${t("task.returned_qty", { qty: Number(item.returnedQty) })}` : ""}
                </p>
              </div>
              <span className="shrink-0 tabular-nums">{money(item.value)}</span>
            </li>
          ))}
        </ul>
        <Field label={t("drawer.order_total")}>{money(task.order.totalAmount)}</Field>
        <Field label={t("drawer.order_paid")}>{money(task.order.paidAmount)}</Field>
      </Block>

      <Block title={t("drawer.payment")}>
        <Field label={t("task.payment_type")}>{t(`payment_type.${task.paymentType}`)}</Field>
        <Field label={t("task.expected")}>{money(task.expectedAmount)}</Field>
        <Field label={t("task.collected")}>{money(task.collectedAmount)}</Field>
        {mismatch > 0 && !isOpenDeliveryStatus(task.status) && (
          <Field label={t("success.mismatch")}>
            <span className="text-amber-600">{money(mismatch)}</span>
          </Field>
        )}
        <Field label={t("task.payment_status")}>{t(`payment_status.${task.paymentStatus}`)}</Field>
        {task.paymentReviewNote && <Field label={t("drawer.review_note")}>{task.paymentReviewNote}</Field>}
        {task.payments.map((payment) => (
          <Field key={payment.id} label={`${formatDateTime(payment.collectedAt, i18n.language)} · ${t(`method.${payment.method}`)}`}>
            {money(payment.amount)}
            {payment.offline ? ` · ${t("task.offline_event")}` : ""}
          </Field>
        ))}
      </Block>

      {(task.customerNote || task.deliveryNote || task.supervisorNote) && (
        <Block title={t("drawer.notes")}>
          {task.customerNote && <Field label={t("task.customer_note")}>{task.customerNote}</Field>}
          {task.deliveryNote && <Field label={t("task.delivery_note")}>{task.deliveryNote}</Field>}
          {task.supervisorNote && <Field label={t("drawer.supervisor_note")}>{task.supervisorNote}</Field>}
        </Block>
      )}

      <Block title={t("drawer.confirmation")}>
        <Field label="OTP">
          {task.otpVerified ? t("drawer.otp_verified") : task.otpIssued ? t("drawer.otp_issued", { attempts: task.otpAttempts }) : "—"}
        </Field>
        {task.signerName && <Field label={t("signature.signer")}>{task.signerName}</Field>}
        {task.proofs.length > 0 && (
          <div className="grid grid-cols-3 gap-2 pt-1 sm:grid-cols-4">
            {task.proofs.map((proof) => {
              const url = apiUrl(`/api/delivery/tasks/${task.id}/proofs/${proof.id}`);
              return (
                <a key={proof.id} href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-border bg-white">
                  <img src={url} alt={t(`proof.${proof.kind}`)} loading="lazy" className="aspect-square w-full object-cover" />
                  <span className="block bg-card px-1 py-0.5 text-[10px] text-muted-foreground">
                    {t(`proof.${proof.kind}`)}
                    {proof.distanceMeters !== null ? ` · ${formatDistance(proof.distanceMeters)}` : ""}
                  </span>
                </a>
              );
            })}
          </div>
        )}
      </Block>

      <Block title={t("task.history")}>
        <ol className="space-y-1.5">
          {task.events.map((event) => (
            <li key={event.id} className="flex gap-3 text-xs">
              <span className="w-24 shrink-0 text-muted-foreground tabular-nums">{formatDateTime(event.occurredAt, i18n.language)}</span>
              <span className="min-w-0 flex-1">
                <span className={event.action === "GEOFENCE_BLOCK" || event.action === "OTP_FAILED" ? "font-medium text-destructive" : "font-medium"}>
                  {t(`event.${event.action}`, { defaultValue: event.action })}
                </span>
                {event.details?.auto ? ` · ${t("drawer.auto_assigned")}` : ""}
                {event.actorName ? ` · ${event.actorName}` : ""}
                {event.distanceMeters !== null ? ` · ${formatDistance(event.distanceMeters)}` : ""}
                {event.offline ? ` · ${t("task.offline_event")}` : ""}
                {event.note && <span className="block text-muted-foreground">{event.note}</span>}
              </span>
            </li>
          ))}
        </ol>
      </Block>

      {dialog && <TaskDialog kind={dialog} task={task} money={money} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** Yetkazma tafsiloti va boshqaruv amallari (ruxsat va holatga qarab). */
export default function TaskDrawer({ taskId, money, onClose }: { taskId: string | null; money: Money; onClose: () => void }) {
  const { t } = useTranslation("delivery");
  return (
    <Sheet open={taskId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{t("drawer.title")}</SheetTitle>
          <SheetDescription>{t("drawer.subtitle")}</SheetDescription>
        </SheetHeader>
        {taskId && <DrawerBody key={taskId} taskId={taskId} money={money} />}
      </SheetContent>
    </Sheet>
  );
}
