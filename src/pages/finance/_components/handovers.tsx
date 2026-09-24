/**
 * PUL TOPSHIRISHLAR — topshirish va qabul qilish/rad etish.
 *
 * Ikki tomoni bor:
 *  1. O'ZI topshiradi — agent/yetkazuvchi profili bo'lgan xodimda "Pulni topshirish" bloki.
 *  2. MAS'UL qabul qiladi yoki rad etadi (`finance.manage`).
 *
 * Muhim: topshirishda pul KO'CHMAYDI — bu faqat hujjat. Pul qabul qilinganda ko'chadi,
 * shuning uchun rad etilganda hech narsa qaytarilmaydi: summa o'z-o'zidan agentda qoladi.
 * Karta tushumi allaqachon bank hisobida bo'lgani uchun ikkinchi marta ko'chirilmaydi —
 * u faqat solishtirish raqami.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Banknote, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import { formatMoney } from "@/hooks/use-currencies.ts";

type Summary = {
  cashOnHand: string;
  submittedCash: string;
  submittedCard: string;
  acceptedCash: string;
  acceptedCard: string;
  outstandingCash: string;
};
type Mine = { holder: { kind: "sales_rep" | "delivery_agent" }; summary: Summary };

type Handover = {
  id: string;
  number: string;
  status: "submitted" | "accepted" | "rejected" | "cancelled";
  cashAmount: string;
  cardAmount: string;
  totalAmount: string;
  acceptedCashAmount: string | null;
  notes: string | null;
  rejectReason: string | null;
  submittedAt: string;
  repName: string | null;
  agentCode: string | null;
  agentName: string | null;
};

const INVALIDATE = [
  "/api/finance/handovers",
  "/api/finance/handovers/mine",
  "/api/finance/agent-cash",
  "/api/finance/cash-accounts",
  "/api/finance/dashboard",
];

const STATUS_LABEL: Record<Handover["status"], string> = {
  submitted: "Ko'rib chiqilmoqda",
  accepted: "Qabul qilindi",
  rejected: "Rad etildi",
  cancelled: "Bekor qilindi",
};

const holderName = (row: Handover) => row.repName ?? row.agentName ?? row.agentCode ?? "—";

/** O'zining pulini topshirish. */
function SubmitDialog({ mine, onClose }: { mine: Mine; onClose: () => void }) {
  const onHand = Number(mine.summary.outstandingCash);
  const [cash, setCash] = useState(String(onHand));
  const [card, setCard] = useState("0");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = useApiMutation((body: object) => api.post("/api/finance/handovers", body), { invalidate: INVALIDATE });

  const cashValue = Number(cash.replace(",", "."));
  const cardValue = Number(card.replace(",", ".")) || 0;
  const tooMuch = cashValue > onHand;
  const valid = Number.isFinite(cashValue) && cashValue >= 0 && cashValue + cardValue > 0 && !tooMuch;

  const handleSubmit = async () => {
    setError(null);
    if (!valid) {
      setError(tooMuch ? `Sizda ${formatMoney(onHand, "UZS")} naqd bor` : "Summani kiriting");
      return;
    }
    try {
      await submit.mutateAsync({
        kind: mine.holder.kind,
        cashAmount: String(cashValue),
        cardAmount: String(cardValue),
        notes: notes.trim() || null,
      });
      toast.success("Topshirish yuborildi — mas'ul shaxs qabul qilishi kerak");
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Pulni topshirish</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex justify-between rounded-lg border border-border px-3 py-2 text-sm">
            <span className="text-muted-foreground">Sizdagi naqd</span>
            <span className="font-semibold tabular-nums">{formatMoney(onHand, "UZS")}</span>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="handover-cash">Naqd</Label>
            <Input id="handover-cash" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="handover-card">Karta / terminal</Label>
            <Input id="handover-card" inputMode="decimal" value={card} onChange={(e) => setCard(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">
              Karta puli allaqachon bank hisobida — bu raqam faqat solishtirish uchun.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="handover-notes">Izoh</Label>
            <Textarea id="handover-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Bekor</Button>
          <Button disabled={!valid || submit.isPending} onClick={() => void handleSubmit()}>Topshirish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Qabul qilish — sanoqda farq bo'lsa kamroq qabul qilinadi. */
function AcceptDialog({ row, onClose }: { row: Handover; onClose: () => void }) {
  const [amount, setAmount] = useState(String(Number(row.cashAmount)));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const accept = useApiMutation(
    (body: object) => api.post(`/api/finance/handovers/${row.id}/accept`, body),
    { invalidate: INVALIDATE },
  );

  const value = Number(amount.replace(",", "."));
  const valid = Number.isFinite(value) && value >= 0 && value <= Number(row.cashAmount);

  const handleAccept = async () => {
    setError(null);
    if (!valid) {
      setError("Qabul qilinadigan naqd topshirilganidan oshmasin");
      return;
    }
    try {
      await accept.mutateAsync({ acceptedCashAmount: String(value), notes: notes.trim() || null });
      toast.success("Qabul qilindi");
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const difference = Number(row.cashAmount) - value;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{holderName(row)} — qabul qilish</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="divide-y divide-border rounded-lg border border-border text-sm">
            <div className="flex justify-between px-3 py-2">
              <span className="text-muted-foreground">Topshirilgan naqd</span>
              <span className="font-semibold tabular-nums">{formatMoney(row.cashAmount, "UZS")}</span>
            </div>
            <div className="flex justify-between px-3 py-2">
              <span className="text-muted-foreground">Karta (solishtirish)</span>
              <span className="tabular-nums">{formatMoney(row.cardAmount, "UZS")}</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="accept-amount">Haqiqatda qabul qilingan naqd</Label>
            <Input id="accept-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            {valid && difference > 0 && (
              <p className="text-[11px] text-amber-600">
                {formatMoney(difference, "UZS")} farq — bu summa agentda qoladi.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="accept-notes">Izoh</Label>
            <Textarea id="accept-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Bekor</Button>
          <Button disabled={!valid || accept.isPending} onClick={() => void handleAccept()}>Qabul qilish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({ row, onClose }: { row: Handover; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reject = useApiMutation(
    (body: object) => api.post(`/api/finance/handovers/${row.id}/reject`, body),
    { invalidate: INVALIDATE },
  );

  const handleReject = async () => {
    setError(null);
    if (reason.trim().length < 3) {
      setError("Rad etish sababini yozing");
      return;
    }
    try {
      await reject.mutateAsync({ reason: reason.trim() });
      toast.success("Rad etildi — summa agentda qoldi");
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{holderName(row)} — rad etish</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">Sabab</Label>
            <Textarea
              id="reject-reason"
              rows={3}
              autoFocus
              placeholder="Masalan: kassada 280 000 chiqdi"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Pul hali ko&apos;chmagan — rad etilganda summa agentda qoladi va u qayta topshira oladi.
            Hujjat tarixda qoladi.
          </p>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Bekor</Button>
          <Button variant="destructive" disabled={reject.isPending} onClick={() => void handleReject()}>Rad etish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Handovers() {
  const { can } = usePermissions();
  const canReview = can("finance.manage");
  const canViewList = can("finance.view");

  const mine = useApiQuery<{ summaries: Mine[] }>("/api/finance/handovers/mine").data?.summaries;
  const list = useApiQuery<{ handovers: Handover[] }>(canViewList ? "/api/finance/handovers" : null).data?.handovers;

  const [submitting, setSubmitting] = useState<Mine | null>(null);
  const [accepting, setAccepting] = useState<Handover | null>(null);
  const [rejecting, setRejecting] = useState<Handover | null>(null);

  const pending = (list ?? []).filter((row) => row.status === "submitted");
  const history = (list ?? []).filter((row) => row.status !== "submitted").slice(0, 10);
  const own = (mine ?? []).filter((row) => Number(row.summary.outstandingCash) > 0 || Number(row.summary.submittedCash) > 0);

  // Topshiradigan puli ham, ko'riladigan topshirishi ham yo'q bo'lsa — bo'limni ko'rsatmaymiz
  if (own.length === 0 && pending.length === 0 && history.length === 0) return null;

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Banknote className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-semibold">Pul topshirishlar</p>
      </div>

      {own.map((row) => (
        <div key={row.holder.kind} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
          <div>
            <p className="text-xs text-muted-foreground">Sizdagi topshirilmagan naqd</p>
            <p className="font-semibold tabular-nums">{formatMoney(row.summary.outstandingCash, "UZS")}</p>
            {Number(row.summary.submittedCash) > 0 && (
              <p className="text-[11px] text-amber-600">
                {formatMoney(row.summary.submittedCash, "UZS")} ko&apos;rib chiqilmoqda
              </p>
            )}
          </div>
          <Button
            size="sm"
            disabled={Number(row.summary.outstandingCash) <= 0}
            onClick={() => setSubmitting(row)}
          >
            Pulni topshirish
          </Button>
        </div>
      ))}

      {list === undefined && canViewList ? (
        <Skeleton className="h-12 w-full" />
      ) : (
        <>
          {pending.length > 0 && (
            <div className="divide-y divide-border rounded-lg border border-border">
              {pending.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{holderName(row)}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {row.number} · naqd {formatMoney(row.cashAmount, "UZS")}
                      {Number(row.cardAmount) > 0 ? ` · karta ${formatMoney(row.cardAmount, "UZS")}` : ""}
                    </p>
                  </div>
                  {canReview && (
                    <div className="flex shrink-0 gap-1">
                      <Button size="sm" variant="secondary" onClick={() => setAccepting(row)}>
                        <Check className="mr-1 h-3.5 w-3.5 text-emerald-600" /> Qabul
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRejecting(row)}>
                        <X className="mr-1 h-3.5 w-3.5 text-destructive" /> Rad
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {history.length > 0 && (
            <div className="divide-y divide-border rounded-lg border border-border text-xs">
              {history.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="truncate">
                    {holderName(row)} · {row.number}
                    {row.rejectReason && <span className="text-muted-foreground"> — {row.rejectReason}</span>}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatMoney(row.acceptedCashAmount ?? row.totalAmount, "UZS")} · {STATUS_LABEL[row.status]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {submitting && <SubmitDialog mine={submitting} onClose={() => setSubmitting(null)} />}
      {accepting && <AcceptDialog row={accepting} onClose={() => setAccepting(null)} />}
      {rejecting && <RejectDialog row={rejecting} onClose={() => setRejecting(null)} />}
    </div>
  );
}
