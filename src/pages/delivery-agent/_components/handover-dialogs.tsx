/**
 * Topshirish oynalari: to'lov qabul qilish, yetkazishni tasdiqlash (qabul qilingan miqdor, OTP, talablar, to'lov farqi)
 * va "yetkazib bo'lmadi". Narx va buyurtma miqdori o'zgartirilmaydi; hisob-kitob va tekshiruv — serverda.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, CircleAlert, Loader2, Minus, Plus, RefreshCw } from "lucide-react";
import {
  DELIVERY_COLLECTION_METHODS,
  DELIVERY_FAILURE_REASONS,
  type DeliveryCollectionMethod,
  type DeliveryFailureReason,
  type DeliveryPolicy,
} from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import {
  SplitPaymentPanel,
  hasDuplicateParts,
  newSplitRow,
  splitPaidMinor,
  splitParts,
  type PaymentTerminalOption,
  type SplitPart,
  type SplitRow,
} from "@/components/payments/split-payment-panel.tsx";
import { num, type DeliveryTaskDetail } from "@/lib/delivery/types.ts";
import { useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";

const QTY_RE = /^\d{1,11}(\.\d{1,4})?$/;
const round2 = (value: number) => Math.round(value * 100) / 100;

type Money = (value: string | number) => string;

type PaymentOptions = { methods: DeliveryCollectionMethod[]; terminals: PaymentTerminalOption[] };

/**
 * To'lov qabul qilish: bitta yoki bir nechta usulda (naqd + karta terminali + bank) — faqat siyosatda ruxsat etilganlar.
 * Oflayn ro'yxat kelmasa — hamma usullar, terminalsiz; server siyosat va summani baribir tekshiradi.
 */
export function PaymentDialog({
  remaining,
  money,
  busy,
  onClose,
  onSubmit,
}: {
  remaining: number;
  money: Money;
  busy: boolean;
  onClose: () => void;
  onSubmit: (parts: SplitPart[]) => void;
}) {
  const { t } = useTranslation("delivery");
  const options = useApiQuery<PaymentOptions>("/api/delivery/agent/payment-options", undefined, { staleTime: 5 * 60_000 }).data;
  const methods = options?.methods ?? DELIVERY_COLLECTION_METHODS;
  const remainingMinor = BigInt(Math.round(Math.max(0, remaining) * 100));
  const [storedRows, setRows] = useState<SplitRow[]>(() => [newSplitRow("cash", null, remaining > 0 ? String(round2(remaining)) : "")]);
  // Siyosatda ruxsat etilmagan usul (masalan, naqd yo'q) — ruxsat etilgan birinchi usul ko'rsatiladi va yuboriladi
  const rows = storedRows.map((row) => (methods.includes(row.method) ? row : { ...row, method: methods[0] ?? row.method, terminalId: null }));
  const paid = splitPaidMinor(rows);
  const over = remainingMinor > 0n && paid > remainingMinor;
  const valid = paid > 0n && !over && !hasDuplicateParts(rows);

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("payment.title")}</DialogTitle>
          <DialogDescription>{t("payment.remaining", { amount: money(remaining) })}</DialogDescription>
        </DialogHeader>
        <SplitPaymentPanel
          dueMinor={remainingMinor}
          rows={rows}
          onChange={setRows}
          terminals={options?.terminals ?? []}
          methods={methods}
          format={(minor) => money(Number(minor) / 100)}
          idPrefix="delivery-payment"
          labels={{
            total: t("payment.total"),
            paid: t("payment.paid"),
            remaining: t("payment.left"),
            overpaid: t("payment.overpaid"),
            add: t("payment.add"),
            fill: t("payment.fill"),
            duplicate: t("payment.duplicate"),
            cash: t("method.cash"),
            card: t("method.card"),
            bank: t("method.bank"),
          }}
        />
        <p className="text-xs text-muted-foreground">{rows.some((row) => row.terminalId) ? t("payment.not_confirmed") : t("payment.split_hint")}</p>
        <DialogFooter className="gap-2">
          <Button variant="secondary" className="h-12" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button className="h-12" disabled={!valid || busy} onClick={() => onSubmit(splitParts(rows))}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("payment.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type ConfirmInput = { items: { taskItemId: string; deliveredQty: string }[] | undefined; otp?: string; partial: boolean };

function Requirement({ done, label }: { done: boolean; label: string }) {
  return (
    <li className={cn("flex items-center gap-2 text-sm", done ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>
      {done ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <CircleAlert className="h-4 w-4 shrink-0" />}
      {label}
    </li>
  );
}

export function ConfirmDialog({
  task,
  policy,
  collected,
  photos,
  signatures,
  money,
  busy,
  otpBusy,
  onResendOtp,
  onClose,
  onSubmit,
}: {
  task: DeliveryTaskDetail;
  policy: DeliveryPolicy;
  collected: number;
  photos: number;
  signatures: number;
  money: Money;
  busy: boolean;
  otpBusy: boolean;
  onResendOtp: () => void;
  onClose: () => void;
  onSubmit: (input: ConfirmInput) => void;
}) {
  const { t } = useTranslation("delivery");
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(task.items.map((item) => [item.id, String(Number(item.quantity))])),
  );
  const [otp, setOtp] = useState("");

  const lines = task.items.map((item) => {
    const raw = (quantities[item.id] ?? "").replace(",", ".").trim();
    const max = Number(item.quantity);
    const qty = Number(raw);
    return { item, raw, max, qty, valid: QTY_RE.test(raw) && qty >= 0 && qty <= max };
  });
  const allValid = lines.every((line) => line.valid);
  const partial = allValid && lines.some((line) => line.qty < line.max);
  const nothing = allValid && lines.every((line) => line.qty === 0);
  const fullValue = lines.reduce((sum, line) => sum + num(line.item.value), 0);
  const deliveredValue = lines.reduce((sum, line) => sum + (line.max > 0 && line.valid ? (num(line.item.value) * line.qty) / line.max : 0), 0);
  const expected = partial && fullValue > 0 ? (num(task.expectedAmount) * deliveredValue) / fullValue : num(task.expectedAmount);
  const mismatch = round2(Math.max(0, expected - collected));

  const needOtp = policy.confirmation.otp && !task.otpVerified;
  const missingPhoto = policy.confirmation.photo && photos === 0;
  const missingSignature = policy.confirmation.signature && signatures === 0;
  const blocked =
    !allValid || nothing || (needOtp && !/^\d{6}$/.test(otp)) || missingPhoto || missingSignature || (mismatch > 0 && policy.mismatchPolicy === "block");

  const setQty = (id: string, value: string) => setQuantities((current) => ({ ...current, [id]: value }));
  const step = (id: string, max: number, delta: number) => {
    const current = Number((quantities[id] ?? "0").replace(",", ".")) || 0;
    setQty(id, String(Math.min(max, Math.max(0, Math.round((current + delta) * 10_000) / 10_000))));
  };

  const submit = () =>
    onSubmit({
      items: partial ? lines.map((line) => ({ taskItemId: line.item.id, deliveredQty: line.raw })) : undefined,
      otp: needOtp ? otp : undefined,
      partial,
    });

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("confirm.title")}</DialogTitle>
          <DialogDescription>{t("confirm.items_hint")}</DialogDescription>
        </DialogHeader>

        <ul className="space-y-2">
          {lines.map((line) => (
            <li key={line.item.id} className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{line.item.productName}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("confirm.planned", { qty: line.max, unit: line.item.unitName })}
                  </p>
                </div>
                {line.valid && line.qty < line.max && (
                  <span className="rounded-full bg-lime-500/15 px-2 py-0.5 text-[11px] font-semibold text-lime-700 dark:text-lime-400">
                    {t("confirm.partial_badge")}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="secondary" size="icon" className="h-12 w-12" onClick={() => step(line.item.id, line.max, -1)}>
                  <Minus className="h-5 w-5" />
                </Button>
                <Input
                  aria-label={t("confirm.delivered_qty")}
                  inputMode="decimal"
                  className={cn("h-12 text-center text-lg font-semibold tabular-nums", !line.valid && "border-destructive")}
                  value={quantities[line.item.id] ?? ""}
                  onChange={(e) => setQty(line.item.id, e.target.value)}
                />
                <Button type="button" variant="secondary" size="icon" className="h-12 w-12" onClick={() => step(line.item.id, line.max, 1)}>
                  <Plus className="h-5 w-5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {nothing && <p className="text-sm text-destructive">{t("error.nothing_delivered")}</p>}

        {needOtp && (
          <div className="space-y-1">
            <Label htmlFor="confirm-otp">{t("confirm.otp")}</Label>
            <Input
              id="confirm-otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="h-14 text-center text-2xl font-semibold tracking-[0.4em] tabular-nums"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{task.otpIssued ? t("confirm.otp_hint") : t("error.otp_missing")}</p>
              <Button type="button" variant="ghost" size="sm" disabled={otpBusy} onClick={onResendOtp}>
                {otpBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                {t("confirm.otp_resend")}
              </Button>
            </div>
          </div>
        )}

        <ul className="space-y-1 rounded-xl bg-muted/40 p-3">
          {policy.confirmation.photo && <Requirement done={!missingPhoto} label={t("confirm.need_photo")} />}
          {policy.confirmation.signature && <Requirement done={!missingSignature} label={t("confirm.need_signature")} />}
          {needOtp && <Requirement done={/^\d{6}$/.test(otp)} label={t("confirm.need_otp")} />}
          <li className="flex justify-between pt-1 text-sm">
            <span className="text-muted-foreground">{t("confirm.expected")}</span>
            <span className="font-semibold tabular-nums">{money(round2(expected))}</span>
          </li>
          <li className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t("confirm.collected")}</span>
            <span className="font-semibold tabular-nums">{money(collected)}</span>
          </li>
        </ul>

        {mismatch > 0 && (
          <div
            className={cn(
              "flex items-start gap-2 rounded-xl px-3 py-2 text-sm",
              policy.mismatchPolicy === "block" ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-700 dark:text-amber-400",
            )}
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {t("confirm.mismatch_warning", { amount: money(mismatch) })} {t(`confirm.mismatch.${policy.mismatchPolicy}`)}
            </span>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="secondary" className="h-12" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button className="h-12 bg-emerald-600 text-white hover:bg-emerald-600/90" disabled={blocked || busy} onClick={submit}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {partial ? t("confirm.submit_partial") : t("confirm.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FailDialog({
  collected,
  money,
  busy,
  onClose,
  onSubmit,
}: {
  collected: number;
  money: Money;
  busy: boolean;
  onClose: () => void;
  onSubmit: (reason: DeliveryFailureReason, comment: string) => void;
}) {
  const { t } = useTranslation("delivery");
  const [reason, setReason] = useState<DeliveryFailureReason | null>(null);
  const [comment, setComment] = useState("");
  const commentRequired = reason === "other";
  const valid = reason !== null && (!commentRequired || comment.trim().length >= 3);

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("fail.title")}</DialogTitle>
          <DialogDescription>{t("fail.hint")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2" role="radiogroup" aria-label={t("fail.reason")}>
          {DELIVERY_FAILURE_REASONS.map((item) => (
            <button
              key={item}
              type="button"
              role="radio"
              aria-checked={reason === item}
              onClick={() => setReason(item)}
              className={cn(
                "flex min-h-12 items-center rounded-xl border px-3 text-left text-sm font-medium transition-colors",
                reason === item ? "border-destructive bg-destructive/10 text-destructive" : "border-border bg-card",
              )}
            >
              {t(`failure.${item}`)}
            </button>
          ))}
        </div>
        <div className="space-y-1">
          <Label htmlFor="fail-comment">
            {t("fail.comment")}
            {commentRequired ? " *" : ""}
          </Label>
          <Textarea id="fail-comment" maxLength={500} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
          {commentRequired && comment.trim().length < 3 && <p className="text-xs text-muted-foreground">{t("error.comment_required")}</p>}
        </div>
        {collected > 0 && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {t("fail.collected_warning", { amount: money(collected) })}
          </p>
        )}
        <DialogFooter className="gap-2">
          <Button variant="secondary" className="h-12" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" className="h-12" disabled={!valid || busy} onClick={() => reason && onSubmit(reason, comment.trim())}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("fail.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
