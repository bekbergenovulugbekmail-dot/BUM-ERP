/**
 * Mijozdan to'lov qabul qilish (savdo agenti): `POST /api/sales-agent/payments`.
 *
 * Naqd pul agentning "yo'ldagi naqd" hisobiga tushadi — kassaga topshirilguncha shu yerda ko'rinadi
 * (`GET /api/sales-agent/cash`). To'lov yozilgach mijozning Telegram botiga xabar ketadi.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Banknote, CreditCard, Landmark, Loader2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { api } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { formatMoney } from "@/hooks/use-currencies.ts";
import { cn } from "@/lib/utils.ts";
import { num, type StoreProfile } from "../_lib/types.ts";
import { visitErrorMessage } from "../_lib/visit-api.ts";

const CASH_PATH = "/api/sales-agent/cash";
const INVALIDATE = [CASH_PATH, "/api/sales-agent/stores", "/api/sales-agent/debtors", "/api/sales-agent/today"];

type Method = "cash" | "card" | "bank";

const METHODS: { key: Method; labelKey: string; icon: typeof Banknote }[] = [
  { key: "cash", labelKey: "payment.cash", icon: Banknote },
  { key: "card", labelKey: "payment.card", icon: CreditCard },
  { key: "bank", labelKey: "payment.bank", icon: Landmark },
];

export type AgentCash = {
  agent: { id: string; code: string; name: string | null };
  balance: string;
  currency: string;
  cashAccountId: string | null;
  handovers: { id: string; amount: string; txDate: string; description: string | null }[];
};

/** Agentdagi topshirilmagan naqd — boshqaruv panelida va to'lov oynasida ko'rsatiladi. */
export function AgentCashCard({ currency }: { currency: string }) {
  const { t } = useTranslation("agent");
  const cash = useApiQuery<AgentCash>(CASH_PATH).data;
  const balance = num(cash?.balance ?? 0);
  return (
    <div className={cn("rounded-2xl border p-4", balance > 0 ? "border-emerald-500/40 bg-emerald-500/5" : "border-border bg-card")}>
      <div className="flex items-center gap-2">
        <Wallet className="h-4 w-4 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">{t("payment.on_hand")}</p>
      </div>
      <p className="text-lg font-bold mt-1 tabular-nums">{formatMoney(balance, currency)}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5">{t("payment.on_hand_hint")}</p>
    </div>
  );
}

export default function PaymentPanel({ store, currency }: { store: StoreProfile; currency: string }) {
  const { t } = useTranslation("agent");
  const [open, setOpen] = useState(false);
  const debt = num(store.totalDebt);

  return (
    <>
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">{t("payment.title")}</p>
            <p className="text-xs text-muted-foreground">{t("payment.hint")}</p>
          </div>
        </div>
        <Button className="h-12 w-full" disabled={debt <= 0} onClick={() => setOpen(true)}>
          <Banknote className="h-5 w-5 mr-2" />
          {debt > 0 ? t("payment.collect", { amount: formatMoney(debt, currency) }) : t("payment.no_debt")}
        </Button>
      </div>
      {open && <PaymentDialog store={store} currency={currency} onClose={() => setOpen(false)} />}
    </>
  );
}

function PaymentDialog({ store, currency, onClose }: { store: StoreProfile; currency: string; onClose: () => void }) {
  const { t } = useTranslation("agent");
  const debt = num(store.totalDebt);
  const [method, setMethod] = useState<Method>("cash");
  const [amount, setAmount] = useState(debt > 0 ? String(debt) : "");
  const [requestId] = useState(() => crypto.randomUUID());

  const pay = useApiMutation(
    (body: { customerId: string; clientRequestId: string; parts: { method: Method; amount: string }[] }) =>
      api.post(`/api/sales-agent/payments`, body),
    { invalidate: INVALIDATE },
  );

  const value = Number(amount.replace(",", "."));
  const invalid = !Number.isFinite(value) || value <= 0 || value > debt;

  const submit = async () => {
    if (invalid) {
      toast.error(t("payment.invalid_amount", { max: formatMoney(debt, currency) }));
      return;
    }
    try {
      await pay.mutateAsync({
        customerId: store.id,
        clientRequestId: requestId,
        parts: [{ method, amount: value.toFixed(2) }],
      });
      toast.success(t("payment.saved"));
      onClose();
    } catch (err) {
      toast.error(visitErrorMessage(err, t));
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("payment.title")}</DialogTitle>
          <DialogDescription>{store.name} · {t("store.debt")}: {formatMoney(debt, currency)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {METHODS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setMethod(item.key)}
                className={cn(
                  "h-12 rounded-xl border text-xs font-semibold transition-colors cursor-pointer flex flex-col items-center justify-center gap-0.5",
                  method === item.key ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                {t(item.labelKey)}
              </button>
            ))}
          </div>
          <div className="space-y-1">
            <Label htmlFor="agent-payment-amount">{t("payment.amount")}</Label>
            <Input
              id="agent-payment-amount"
              className="h-12 text-base"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">{t("payment.max", { amount: formatMoney(debt, currency) })}</p>
          </div>
          {method === "cash" && <AgentCashCard currency={currency} />}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="secondary" className="h-12" onClick={onClose}>{t("customer.cancel")}</Button>
          <Button className="h-12" disabled={pay.isPending || invalid} onClick={() => void submit()}>
            {pay.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t("payment.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
