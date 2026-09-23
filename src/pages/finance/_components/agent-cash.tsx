/**
 * AGENTLARDAGI NAQD — "kimda kompaniya puli bor va uni qayerda topshiriladi" degan savolga javob.
 *
 * Nega Moliya bo'limida: sotuv agentining puli "Distribyutsiya → Sotuv agentlari" da, dostavka
 * agentiniki esa "Dostavka → Agentlar" da edi — pulni qabul qiladigan odam ikkalasini alohida
 * qidirishi kerak edi. Bu yerda ikkalasi bitta ro'yxatda va shu yerdan topshirish qayd etiladi.
 *
 * Ruxsatlar O'ZGARMAGAN: topshirishni avvalgidek `distribution.manage` (sotuv agenti) yoki
 * `delivery.manage` (dostavka agenti) bor xodim qayd etadi — pulni QABUL QILUVCHI qayd etadi,
 * ya'ni ikki tomonlama nazorat saqlanadi. Ruxsati yo'q xodim faqat ko'radi.
 */
import { useState } from "react";
import { toast } from "sonner";
import { HandCoins, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import { formatMoney } from "@/hooks/use-currencies.ts";
import { toNum } from "../_lib/types.ts";

type Holder = {
  kind: "sales_rep" | "delivery_agent";
  holderId: string;
  name: string;
  code: string;
  cashAccountId: string;
  balance: string;
  currency: string;
};

const KIND_LABEL: Record<Holder["kind"], string> = {
  sales_rep: "Sotuv agenti",
  delivery_agent: "Dostavka agenti",
};

/** Har bir tur o'z bo'limining endpointiga topshiradi — audit va qoidalar o'sha yerda qoladi. */
const handoverUrl = (holder: Holder) =>
  holder.kind === "sales_rep"
    ? `/api/distribution/sales-reps/${holder.holderId}/cash-handover`
    : `/api/delivery/agents/${holder.holderId}/cash-handover`;

const INVALIDATE = ["/api/finance/agent-cash", "/api/finance/cash-accounts", "/api/finance/dashboard"];

function HandoverDialog({ holder, onClose }: { holder: Holder; onClose: () => void }) {
  const balance = toNum(holder.balance);
  const [amount, setAmount] = useState(String(balance));
  const [notes, setNotes] = useState("");
  const handover = useApiMutation(
    (body: { amount: string; notes: string | null }) => api.post(handoverUrl(holder), body),
    { invalidate: INVALIDATE },
  );

  const value = toNum(amount);
  const valid = value > 0 && value <= balance;

  const handleSubmit = async () => {
    if (!valid) {
      toast.error(`Summa 0 dan katta va ${formatMoney(balance, holder.currency)} dan oshmasligi kerak`);
      return;
    }
    try {
      await handover.mutateAsync({ amount: String(value), notes: notes.trim() || null });
      toast.success("Naqd kassaga qabul qilindi");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {holder.name} — naqdni qabul qilish
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex justify-between rounded-lg border border-border px-3 py-2 text-sm">
            <span className="text-muted-foreground">Agentdagi naqd</span>
            <span className="font-semibold">{formatMoney(balance, holder.currency)}</span>
          </div>
          <div className="space-y-1">
            <Label htmlFor="agent-cash-amount">Topshirilayotgan summa</Label>
            <Input
              id="agent-cash-amount"
              type="number"
              min="0"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="agent-cash-notes">Izoh</Label>
            <Textarea id="agent-cash-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Pul kompaniyaning asosiy naqd kassasiga o&apos;tkaziladi. Sotuv jurnali o&apos;zgarmaydi — bu
            kassalar orasidagi o&apos;tkazma.
          </p>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Bekor</Button>
          <Button disabled={!valid || handover.isPending} onClick={() => void handleSubmit()}>
            Qabul qilish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AgentCash() {
  const { can } = usePermissions();
  const query = useApiQuery<{ holders: Holder[] }>("/api/finance/agent-cash");
  const holders = query.data?.holders;
  const [active, setActive] = useState<Holder | null>(null);

  const canAccept = (holder: Holder) =>
    holder.kind === "sales_rep" ? can("distribution.manage") : can("delivery.manage");

  // Hech kimda topshirilmagan pul bo'lmasa — bo'limni umuman ko'rsatmaymiz (ekran shovqini kamaysin)
  if (holders !== undefined && holders.length === 0) return null;

  return (
    <div className="space-y-2 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <HandCoins className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-semibold">Agentlardagi naqd (topshirilmagan)</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Mijozlardan yig&apos;ilgan, lekin kassaga topshirilmagan pul. Qabul qilinganda kassa qoldig&apos;i oshadi.
      </p>

      {holders === undefined ? (
        <div className="space-y-2 pt-1">
          {Array.from({ length: 2 }).map((_, index) => <Skeleton key={index} className="h-12 w-full" />)}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {holders.map((holder) => (
            <div key={holder.cashAccountId} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{holder.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {KIND_LABEL[holder.kind]} · {holder.code}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <p className="font-semibold tabular-nums">{formatMoney(holder.balance, holder.currency)}</p>
                {canAccept(holder) ? (
                  <Button size="sm" variant="secondary" onClick={() => setActive(holder)}>
                    <Wallet className="mr-1.5 h-3.5 w-3.5" /> Qabul qilish
                  </Button>
                ) : (
                  <span className="text-[11px] text-muted-foreground">
                    {holder.kind === "sales_rep" ? "distribution.manage" : "delivery.manage"} kerak
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {active && <HandoverDialog holder={active} onClose={() => setActive(null)} />}
    </div>
  );
}
