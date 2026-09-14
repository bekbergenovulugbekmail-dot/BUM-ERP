/**
 * Yetkazma — agentning asosiy oqimi: qabul → yo'lga chiqish → xaritada ochish (qurilma ilovasi) → mijozga yetdim
 * (server: ish sessiyasi, GPS yangiligi va aniqligi, geofence) → topshirish (rasm, imzo, OTP, to'lov) → tasdiqlash
 * (to'liq yoki qisman) → natija → keyingi yetkazma. Yoki "yetkazib bo'lmadi" (sabab bilan).
 * Summa va buyurtma miqdorini agent o'zgartira olmaydi. Internet yo'q bo'lsa (siyosat ruxsat bersa) amal navbatga tushadi.
 */
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, Camera, CheckCircle2, ChevronDown, Circle, CircleAlert, Hand, Loader2, MapPin, MapPinOff, Navigation, PackageCheck,
  PenLine, Phone, RefreshCw, Truck, Wallet, XCircle, type LucideIcon,
} from "lucide-react";
import { canDeliveryTransition, isOpenDeliveryStatus, type DeliveryFailureReason, type DeliveryStatus } from "@bum/shared";
import type { SplitPart } from "@/components/payments/split-payment-panel.tsx";
import { LateBadge, PriorityBadge, QueuedBadge, StatusBadge } from "@/components/delivery/badges.tsx";
import SignatureDialog from "@/components/delivery/signature-dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { ApiError, api, apiUrl } from "@/lib/api.ts";
import { deliveryErrorMessage } from "@/lib/delivery/errors.ts";
import { coordsOf, formatDateTime, formatDistance, timeWindow } from "@/lib/delivery/format.ts";
import { num, type ConfirmSummary, type DeliveryTaskDetail, type DeliveryTaskRow } from "@/lib/delivery/types.ts";
import { useLiveInterval } from "@/lib/delivery/realtime.ts";
import { mapAppUrl } from "@/lib/maps/index.ts";
import { useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import { base64Of, compressImage, freshPosition } from "@/pages/sales-agent/_lib/visit-api.ts";
import DeliveryWorkSessionCard from "../_components/work-session-card.tsx";
import { ConfirmDialog, FailDialog, PaymentDialog, type ConfirmInput } from "../_components/handover-dialogs.tsx";
import { invalidateDelivery, performAction, type ActionOutcome } from "../_lib/actions.ts";
import { useDeliveryAgent } from "../_lib/context.ts";
import { newRequestBody, projectedStatus } from "../_lib/offline-queue.ts";
import { roughMeters } from "../_lib/use-delivery-tracking.ts";

type DialogKind = "payment" | "confirm" | "fail" | "signature" | null;
type Success = { summary: ConfirmSummary | null; partial: boolean };

const STEPS: DeliveryStatus[] = ["accepted", "out_for_delivery", "arrived", "delivering", "delivered"];
const WORKING: DeliveryStatus[] = ["accepted", "out_for_delivery", "arrived", "delivering"];

function BigButton({
  icon: Icon,
  label,
  onClick,
  busy,
  disabled,
  variant = "default",
  className,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  variant?: "default" | "secondary" | "destructive" | "outline";
  className?: string;
}) {
  return (
    <Button variant={variant} className={cn("h-16 w-full text-base font-semibold tracking-wide", className)} disabled={disabled || busy} onClick={onClick}>
      {busy ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Icon className="mr-2 h-5 w-5" />}
      {label}
    </Button>
  );
}

function Row({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("text-right font-medium tabular-nums", tone)}>{value}</span>
    </div>
  );
}

function CheckRow({ done, required, label, action }: { done: boolean; required: boolean; label: string; action?: ReactNode }) {
  const Icon = done ? CheckCircle2 : required ? CircleAlert : Circle;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border px-3 py-2">
      <Icon className={cn("h-5 w-5 shrink-0", done ? "text-emerald-600" : required ? "text-amber-600" : "text-muted-foreground")} />
      <span className="min-w-0 flex-1 text-sm">{label}</span>
      {action}
    </div>
  );
}

function Stepper({ status }: { status: DeliveryStatus }) {
  const { t } = useTranslation("delivery");
  const current = status === "assigned" ? -1 : STEPS.indexOf(status);
  return (
    <ol className="grid grid-cols-5 gap-1">
      {STEPS.map((step, index) => (
        <li key={step} className="space-y-1 text-center">
          <div className={cn("h-1.5 rounded-full", index <= current ? "bg-primary" : "bg-muted")} />
          <p className={cn("truncate text-[10px]", index === current ? "font-semibold text-foreground" : "text-muted-foreground")}>{t(`step.${step}`)}</p>
        </li>
      ))}
    </ol>
  );
}

function SuccessScreen({ taskId, success }: { taskId: string; success: Success }) {
  const { t } = useTranslation("delivery");
  const { lng = "uz" } = useParams<{ lng: string }>();
  const navigate = useNavigate();
  const { queue, money } = useDeliveryAgent();
  const tasks = useApiQuery<{ tasks: DeliveryTaskRow[] }>("/api/delivery/agent/tasks", { scope: "today" }).data?.tasks;
  const next = tasks?.find(
    (task) => task.id !== taskId && isOpenDeliveryStatus(projectedStatus(task.status, queue.items.filter((item) => item.taskId === task.id)) as DeliveryStatus),
  );
  const summary = success.summary;
  const list = `/${lng}/delivery-agent/tasks`;

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-col items-center gap-2 pt-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/15">
          <CheckCircle2 className="h-12 w-12 text-emerald-600" />
        </div>
        <h1 className="text-2xl font-bold">{success.partial ? t("success.partial_title") : t("success.title")}</h1>
        {!summary && <p className="max-w-xs text-sm text-muted-foreground">{t("success.queued")}</p>}
      </div>
      {summary && (
        <div className="space-y-2 rounded-2xl border border-border bg-card p-4">
          <Row label={t("success.order")} value={summary.orderNumber} />
          <Row label={t("success.delivered_value")} value={money(summary.deliveredValue)} />
          <Row label={t("success.collected")} value={money(summary.collectedAmount)} />
          <Row label={t("success.payment_status")} value={t(`payment_status.${summary.paymentStatus}`)} />
          {num(summary.mismatchAmount) > 0 && (
            <Row label={t("success.mismatch")} value={money(summary.mismatchAmount)} tone="text-amber-700 dark:text-amber-400" />
          )}
          {summary.paymentReview === "pending" && <p className="text-xs text-amber-700 dark:text-amber-400">{t("success.review_pending")}</p>}
          <Row label={t("success.order_balance")} value={money(summary.orderBalance)} />
          {summary.customerDebt !== undefined && <Row label={t("success.customer_debt")} value={money(summary.customerDebt)} />}
        </div>
      )}
      <Button className="h-16 w-full text-base font-semibold" onClick={() => navigate(next ? `${list}/${next.id}` : list)}>
        <Truck className="mr-2 h-5 w-5" /> {next ? t("success.next") : t("success.back")}
      </Button>
      {next && (
        <Button variant="secondary" className="h-12 w-full" onClick={() => navigate(list)}>
          {t("success.back")}
        </Button>
      )}
    </div>
  );
}

function TaskView({ taskId }: { taskId: string }) {
  const { t, i18n } = useTranslation("delivery");
  const { lng = "uz" } = useParams<{ lng: string }>();
  const queryClient = useQueryClient();
  const { policy, location, queue, onDuty, can, money } = useDeliveryAgent();
  const interval = useLiveInterval(60_000);
  const query = useApiQuery<{ task: DeliveryTaskDetail }>(`/api/delivery/agent/tasks/${taskId}`, undefined, { refetchInterval: interval });
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [success, setSuccess] = useState<Success | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const queued = useMemo(() => queue.items.filter((item) => item.taskId === taskId), [queue.items, taskId]);
  const task = query.data?.task;

  if (success) return <SuccessScreen taskId={taskId} success={success} />;

  if (!task) {
    if (query.isError) {
      const missing = query.error instanceof ApiError && query.error.status === 404;
      return (
        <div className="space-y-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">{missing ? t("task.not_found") : deliveryErrorMessage(query.error, t)}</p>
          <div className="flex justify-center gap-2">
            <Button asChild variant="secondary" className="h-11">
              <Link to={`/${lng}/delivery-agent/tasks`}>{t("common.back")}</Link>
            </Button>
            {!missing && (
              <Button variant="secondary" className="h-11" onClick={() => void query.refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" /> {t("error.retry")}
              </Button>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-16 rounded-2xl" />
      </div>
    );
  }

  const pending = queued.filter((item) => item.state === "pending");
  const status = projectedStatus(task.status, queued) as DeliveryStatus;
  const final = !isOpenDeliveryStatus(status);
  const target = coordsOf(task.customer.latitude, task.customer.longitude);
  const distance = location.point && target ? roughMeters(location.point, target) : null;
  const photos = task.proofs.filter((proof) => proof.kind === "photo").length + pending.filter((item) => item.action === "proofs" && item.body.kind === "photo").length;
  const signatures =
    task.proofs.filter((proof) => proof.kind === "signature").length + pending.filter((item) => item.action === "proofs" && item.body.kind === "signature").length;
  const collected = num(task.collectedAmount) + pending.filter((item) => item.action === "payments").reduce((sum, item) => sum + num(String(item.body.amount)), 0);
  const expected = num(task.expectedAmount);
  const remaining = Math.max(0, Math.round((expected - collected) * 100) / 100);
  const slot = timeWindow(task.windowStart, task.windowEnd);
  const options = { offlineAllowed: policy.offlineActionsAllowed };
  const navigateUrl = target ? mapAppUrl(target.latitude, target.longitude, task.customer.name) : null;
  const canFail = can("delivery.fail") && canDeliveryTransition(status, "failed") && status !== "assigned";

  const run = async <T,>(name: string, action: () => Promise<ActionOutcome<T>>, doneKey?: string): Promise<ActionOutcome<T> | null> => {
    if (busy) return null;
    setBusy(name);
    try {
      const outcome = await action();
      if (outcome.queued) toast.info(t("action.queued"));
      else if (doneKey) toast.success(t(doneKey));
      void invalidateDelivery(queryClient);
      return outcome;
    } catch (error) {
      toast.error(error instanceof Error && error.message === "QUEUE_FULL" ? t("queue.full") : deliveryErrorMessage(error, t));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const accept = () => void run("accept", () => performAction(taskId, "accept", newRequestBody({}), options), "action.done_accept");

  const start = () =>
    void run(
      "start",
      async () => {
        const place = await freshPosition().catch(() => null);
        return performAction(taskId, "start", newRequestBody(place ?? {}), options);
      },
      "action.done_start",
    );

  const arrive = () =>
    void run(
      "arrive",
      async () => {
        const place = await freshPosition();
        const outcome = await performAction<{ otpIssued: boolean; smsSent: boolean }>(taskId, "arrive", newRequestBody(place), options);
        if (!outcome.queued && outcome.data.otpIssued) toast.info(t(outcome.data.smsSent ? "otp.sms_sent" : "otp.ask_supervisor"));
        return outcome;
      },
      "action.done_arrive",
    );

  const beginHandover = () => void run("delivering", () => performAction(taskId, "delivering", newRequestBody({}), options), "action.done_delivering");

  const takePhoto = (file: File | undefined) => {
    if (!file) return;
    void run(
      "photo",
      async () => {
        const place = await freshPosition();
        const small = await compressImage(file, 1280, 0.72);
        const body = newRequestBody({ kind: "photo", contentType: small.type || "image/jpeg", data: await base64Of(small), ...place });
        return performAction(taskId, "proofs", body, options);
      },
      "photo.saved",
    );
  };

  const saveSignature = (signerName: string, data: string) =>
    void run(
      "signature",
      async () => {
        const place = await freshPosition().catch(() => null);
        const outcome = await performAction(taskId, "proofs", newRequestBody({ kind: "signature", contentType: "image/png", data, signerName, ...(place ?? {}) }), options);
        setDialog(null);
        return outcome;
      },
      "signature.saved",
    );

  // Bitta qism — avvalgi ko'rinish (method, amount, terminalId); aralash — `parts`. Oflayn navbatda ham shu tana va kalit
  const collect = (parts: SplitPart[]) =>
    void run(
      "payment",
      async () => {
        const outcome = await performAction(taskId, "payments", newRequestBody(parts.length === 1 ? { ...parts[0]! } : { parts }), options);
        setDialog(null);
        return outcome;
      },
      "payment.saved",
    );

  const resendOtp = () =>
    void run("otp", async () => {
      const data = await api.post<{ smsSent: boolean; expiresAt: string }>(`/api/delivery/agent/tasks/${taskId}/otp/resend`);
      toast.success(t("otp.resent"));
      return { queued: false as const, data };
    });

  const confirm = (input: ConfirmInput) =>
    void run("confirm", async () => {
      const place = await freshPosition();
      const body = newRequestBody({ ...place, ...(input.items ? { items: input.items } : {}), ...(input.otp ? { otp: input.otp } : {}) });
      const outcome = await performAction<{ summary: ConfirmSummary }>(taskId, "confirm", body, { ...options, meta: { partial: input.partial } });
      setDialog(null);
      setSuccess({ summary: outcome.queued ? null : outcome.data.summary, partial: input.partial });
      return outcome;
    });

  const fail = (reason: DeliveryFailureReason, comment: string) =>
    void run(
      "fail",
      async () => {
        const place = await freshPosition().catch(() => null);
        const outcome = await performAction(taskId, "fail", newRequestBody({ reason, ...(comment ? { comment } : {}), ...(place ?? {}) }), options);
        setDialog(null);
        return outcome;
      },
      "action.done_fail",
    );

  const navigateButton = navigateUrl && (
    <Button asChild variant={status === "out_for_delivery" ? "default" : "secondary"} className="h-16 w-full text-base font-semibold tracking-wide">
      <a href={navigateUrl} target="_blank" rel="noreferrer">
        <Navigation className="mr-2 h-5 w-5" /> {t("action.navigate")}
      </a>
    </Button>
  );

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" className="h-10 w-10 shrink-0">
          <Link to={`/${lng}/delivery-agent/tasks`} aria-label={t("common.back")}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold">{task.number}</p>
          <p className="text-xs text-muted-foreground">
            {task.scheduledDate}
            {slot ? ` · ${slot}` : ""}
            {task.routeOrder !== null ? ` · №${task.routeOrder}` : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusBadge status={status} />
          {pending.length > 0 && <QueuedBadge />}
        </div>
      </div>

      {(task.overdue || task.priority !== "normal") && (
        <div className="flex flex-wrap gap-1.5">
          {task.overdue && <LateBadge />}
          <PriorityBadge priority={task.priority} />
        </div>
      )}

      {!final && <Stepper status={status} />}
      {!onDuty && WORKING.includes(status) && <DeliveryWorkSessionCard variant="compact" />}

      <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <div>
          <p className="text-xs text-muted-foreground">{t("task.customer")}</p>
          <p className="text-lg font-semibold">{task.customer.name}</p>
          {task.customer.address && <p className="text-sm text-muted-foreground">{task.customer.address}</p>}
          {task.customer.contactName && (
            <p className="text-sm">
              {t("task.contact")}: {task.customer.contactName}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {task.customer.phone && (
            <Button asChild variant="secondary" className="h-12 flex-1">
              <a href={`tel:${task.customer.phone}`}>
                <Phone className="mr-2 h-4 w-4" /> {t("task.call")}
              </a>
            </Button>
          )}
          {navigateUrl && (
            <Button asChild variant="secondary" className="h-12 flex-1">
              <a href={navigateUrl} target="_blank" rel="noreferrer">
                <MapPin className="mr-2 h-4 w-4" /> {t("task.map")}
              </a>
            </Button>
          )}
        </div>
        {!target && (
          <p className="flex items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
            <MapPinOff className="h-4 w-4 shrink-0" /> {t("task.no_location")}
          </p>
        )}
        {distance !== null && !final && (
          <p className={cn("flex items-center gap-2 text-sm", distance <= policy.geofenceRadiusMeters ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
            <MapPin className="h-4 w-4 shrink-0" />
            {t("geofence.approx", { distance: formatDistance(distance), radius: policy.geofenceRadiusMeters })}
            {location.accuracy !== null ? ` · ±${Math.round(location.accuracy)} m` : ""}
          </p>
        )}
        {task.customer.totalDebt !== undefined && num(task.customer.totalDebt) > 0 && (
          <Row label={t("task.customer_debt")} value={money(task.customer.totalDebt)} tone="text-amber-700 dark:text-amber-400" />
        )}
      </section>

      {!final && (
        <section className="space-y-3">
          {status === "assigned" && can("delivery.accept") && <BigButton icon={Hand} label={t("action.accept")} busy={busy === "accept"} onClick={accept} />}
          {status === "accepted" && (
            <>
              {can("delivery.start") && <BigButton icon={Truck} label={t("action.start")} busy={busy === "start"} disabled={!onDuty} onClick={start} />}
              {navigateButton}
            </>
          )}
          {status === "out_for_delivery" && (
            <>
              {navigateButton}
              {can("delivery.arrive") && (
                <BigButton
                  icon={MapPin}
                  label={t("action.arrive")}
                  variant={navigateUrl ? "secondary" : "default"}
                  busy={busy === "arrive"}
                  disabled={!onDuty}
                  onClick={arrive}
                />
              )}
            </>
          )}
          {status === "arrived" && can("delivery.confirm") && (
            <BigButton icon={PackageCheck} label={t("action.delivering")} busy={busy === "delivering"} disabled={!onDuty} onClick={beginHandover} />
          )}
          {status === "delivering" && (
            <>
              <div className="space-y-2 rounded-2xl border border-border bg-card p-4">
                <p className="text-sm font-semibold">{t("handover.title")}</p>
                {can("delivery.confirm") && (
                  <CheckRow
                    done={photos > 0}
                    required={policy.confirmation.photo}
                    label={t("handover.photo", { count: photos })}
                    action={
                      <Button size="sm" variant="secondary" className="h-10" disabled={busy !== null || !onDuty} onClick={() => photoInput.current?.click()}>
                        {busy === "photo" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Camera className="mr-1.5 h-4 w-4" />}
                        {t("action.photo")}
                      </Button>
                    }
                  />
                )}
                {can("delivery.confirm") && (
                  <CheckRow
                    done={signatures > 0}
                    required={policy.confirmation.signature}
                    label={t("handover.signature")}
                    action={
                      <Button size="sm" variant="secondary" className="h-10" disabled={busy !== null || !onDuty} onClick={() => setDialog("signature")}>
                        <PenLine className="mr-1.5 h-4 w-4" /> {t("action.signature")}
                      </Button>
                    }
                  />
                )}
                {(expected > 0 || collected > 0) && (
                  <CheckRow
                    done={remaining === 0}
                    required={false}
                    label={t("handover.payment", { collected: money(collected), expected: money(expected) })}
                    action={
                      can("delivery.collect_payment") && remaining > 0 ? (
                        <Button size="sm" variant="secondary" className="h-10" disabled={busy !== null || !onDuty} onClick={() => setDialog("payment")}>
                          <Wallet className="mr-1.5 h-4 w-4" /> {t("action.payment")}
                        </Button>
                      ) : null
                    }
                  />
                )}
                {policy.confirmation.otp && (
                  <CheckRow done={task.otpVerified} required label={task.otpIssued ? t("handover.otp_issued") : t("handover.otp_missing")} />
                )}
                <input
                  ref={photoInput}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    takePhoto(file);
                  }}
                />
              </div>
              {can("delivery.confirm") && (
                <BigButton
                  icon={CheckCircle2}
                  label={t("action.confirm")}
                  className="bg-emerald-600 text-white hover:bg-emerald-600/90"
                  busy={busy === "confirm"}
                  disabled={!onDuty || busy !== null}
                  onClick={() => setDialog("confirm")}
                />
              )}
            </>
          )}
          {canFail && (
            <Button
              variant="outline"
              className="h-12 w-full border-destructive/40 text-destructive hover:text-destructive"
              disabled={!onDuty || busy !== null}
              onClick={() => setDialog("fail")}
            >
              <XCircle className="mr-2 h-4 w-4" /> {t("action.fail")}
            </Button>
          )}
        </section>
      )}

      {final && (
        <section className="space-y-2 rounded-2xl border border-border bg-card p-4">
          <StatusBadge status={status} className="text-xs" />
          {task.deliveredAt && <Row label={t("task.delivered_at")} value={formatDateTime(task.deliveredAt, i18n.language)} />}
          {task.failureReason && <Row label={t("task.failure")} value={t(`failure.${task.failureReason}`)} />}
          {task.failureComment && <p className="text-sm text-muted-foreground">{task.failureComment}</p>}
          {task.cancelReason && <Row label={t("task.cancel_reason")} value={task.cancelReason} />}
          {task.paymentReview !== "none" && <Row label={t("task.payment_review")} value={t(`review.${task.paymentReview}`)} />}
        </section>
      )}

      <section className="space-y-2 rounded-2xl border border-border bg-card p-4">
        <p className="text-sm font-semibold">
          {t("task.order")} {task.order.number}
        </p>
        <ul className="divide-y divide-border">
          {task.items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{item.productName}</p>
                <p className="text-xs text-muted-foreground">
                  {Number(item.quantity)} {item.unitName}
                  {item.deliveredQty !== null ? ` · ${t("task.delivered_qty", { qty: Number(item.deliveredQty) })}` : ""}
                  {num(item.returnedQty) > 0 ? ` · ${t("task.returned_qty", { qty: Number(item.returnedQty) })}` : ""}
                </p>
              </div>
              <span className="shrink-0 font-semibold tabular-nums">{money(item.value)}</span>
            </li>
          ))}
        </ul>
        {task.customerNote && <Row label={t("task.customer_note")} value={task.customerNote} />}
        {task.deliveryNote && <Row label={t("task.delivery_note")} value={task.deliveryNote} />}
      </section>

      <section className="space-y-2 rounded-2xl border border-border bg-card p-4">
        <Row label={t("task.payment_type")} value={t(`payment_type.${task.paymentType}`)} />
        <Row label={t("task.expected")} value={money(expected)} />
        <Row label={t("task.collected")} value={money(collected)} />
        {remaining > 0 && <Row label={t("task.remaining")} value={money(remaining)} tone="text-amber-700 dark:text-amber-400" />}
        <Row label={t("task.payment_status")} value={t(`payment_status.${task.paymentStatus}`)} />
        {task.payments.length > 0 && (
          <ul className="space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
            {task.payments.map((payment) => (
              <li key={payment.id} className="flex justify-between gap-2">
                <span>
                  {formatDateTime(payment.collectedAt, i18n.language)} · {t(`method.${payment.method}`)}
                </span>
                <span className="font-medium text-foreground tabular-nums">{money(payment.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {task.proofs.length > 0 && (
        <section className="space-y-2 rounded-2xl border border-border bg-card p-4">
          <p className="text-sm font-semibold">{t("task.proofs")}</p>
          <div className="grid grid-cols-3 gap-2">
            {task.proofs.map((proof) => (
              <a
                key={proof.id}
                href={apiUrl(`/api/delivery/agent/tasks/${task.id}/proofs/${proof.id}`)}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded-xl border border-border bg-white"
              >
                <img
                  src={apiUrl(`/api/delivery/agent/tasks/${task.id}/proofs/${proof.id}`)}
                  alt={t(`proof.${proof.kind}`)}
                  loading="lazy"
                  className="aspect-square w-full object-cover"
                />
              </a>
            ))}
          </div>
        </section>
      )}

      {task.events.length > 0 && (
        <section className="rounded-2xl border border-border bg-card">
          <button type="button" className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold" onClick={() => setHistoryOpen(!historyOpen)}>
            {t("task.history")}
            <ChevronDown className={cn("h-4 w-4 transition-transform", historyOpen && "rotate-180")} />
          </button>
          {historyOpen && (
            <ol className="space-y-2 px-4 pb-4">
              {task.events.map((event) => (
                <li key={event.id} className="flex gap-3 text-xs">
                  <span className="w-20 shrink-0 text-muted-foreground tabular-nums">{formatDateTime(event.occurredAt, i18n.language)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{t(`event.${event.action}`, { defaultValue: event.action })}</span>
                    {event.distanceMeters !== null ? ` · ${formatDistance(event.distanceMeters)}` : ""}
                    {event.offline ? ` · ${t("task.offline_event")}` : ""}
                    {event.note ? <span className="block text-muted-foreground">{event.note}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {dialog === "payment" && <PaymentDialog remaining={remaining} money={money} busy={busy === "payment"} onClose={() => setDialog(null)} onSubmit={collect} />}
      {dialog === "confirm" && (
        <ConfirmDialog
          task={task}
          policy={policy}
          collected={collected}
          photos={photos}
          signatures={signatures}
          money={money}
          busy={busy === "confirm"}
          otpBusy={busy === "otp"}
          onResendOtp={resendOtp}
          onClose={() => setDialog(null)}
          onSubmit={confirm}
        />
      )}
      {dialog === "fail" && <FailDialog collected={collected} money={money} busy={busy === "fail"} onClose={() => setDialog(null)} onSubmit={fail} />}
      {dialog === "signature" && <SignatureDialog busy={busy === "signature"} onClose={() => setDialog(null)} onSubmit={saveSignature} />}
    </div>
  );
}

/** Boshqa yetkazmaga o'tilganda holat (natija ekrani, oynalar) yangidan boshlanadi. */
export default function DeliveryTaskPage() {
  const { taskId = "" } = useParams<{ taskId: string }>();
  return <TaskView key={taskId} taskId={taskId} />;
}
