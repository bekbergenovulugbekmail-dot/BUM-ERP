/**
 * POS: mijoz balansini to'ldirish yoki qarzini to'lash. Naqd, karta va bank smena yig'indisiga qo'shiladi;
 * qarzni balansdan yopishda kassaga pul tushmaydi. Qarz aralash to'lanishi mumkin (naqd + karta terminali + bank) —
 * jami qarzdan oshmaydi, takroriy yuborish ikkinchi to'lov yaratmaydi.
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Banknote, CreditCard, HandCoins, Loader2, Smartphone, Wallet } from "lucide-react";
import { TERMINAL_NETWORK_LABELS } from "@bum/shared";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  SplitPaymentPanel,
  hasDuplicateParts,
  newSplitRow,
  splitPaidMinor,
  splitParts,
  type PaymentTerminalOption,
  type SplitRow,
} from "@/components/payments/split-payment-panel.tsx";
import { cn } from "@/lib/utils.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { num, type Customer, type PosCustomerSummary } from "@/pages/sales/_lib/types.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

export type CustomerPaymentPurpose = "deposit" | "debt";
type Method = "cash" | "card" | "bank" | "balance";

const PURPOSES: { key: CustomerPaymentPurpose; label: string; icon: React.ElementType }[] = [
  { key: "deposit", label: "Balansga kirim", icon: Wallet },
  { key: "debt", label: "Qarzni to'lash", icon: HandCoins },
];

const METHODS: { key: Method; label: string; icon: React.ElementType }[] = [
  { key: "cash", label: "Naqd", icon: Banknote },
  { key: "card", label: "Karta", icon: CreditCard },
  { key: "bank", label: "Bank", icon: Smartphone },
  { key: "balance", label: "Balansdan", icon: Wallet },
];

type Props = {
  shiftId: string;
  customer: Customer;
  purpose: CustomerPaymentPurpose;
  onClose: () => void;
};

export default function CustomerPaymentDialog({ shiftId, customer, purpose: initialPurpose, onClose }: Props) {
  const debt = Math.max(0, num(customer.totalDebt));
  const balance = num(customer.balance);
  const [purpose, setPurpose] = useState<CustomerPaymentPurpose>(initialPurpose);
  const [amount, setAmount] = useState(initialPurpose === "debt" && debt > 0 ? String(debt) : "");
  const [method, setMethod] = useState<Method>("cash");
  const [split, setSplit] = useState(false);
  const [rows, setRows] = useState<SplitRow[]>(() => [newSplitRow("cash", null, debt > 0 ? String(debt) : "")]);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Oyna ochilganda bitta kalit — xato bo'lib qayta yuborilsa ham server bitta to'lov yozadi
  const requestId = useRef(crypto.randomUUID());

  const terminals = useApiQuery<{ terminals: PaymentTerminalOption[] }>("/api/sales/pos/payment-options", undefined, { staleTime: 60_000 })
    .data?.terminals ?? [];
  const pay = useApiMutation((body: object) =>
    api.post<{ customer: PosCustomerSummary }>(`/api/sales/pos/customers/${customer.id}/payments`, body),
  );

  // Balansdan faqat qarz yopiladi
  const methods = METHODS.filter((m) => m.key !== "balance" || (purpose === "debt" && balance > 0));
  const activeMethod: Method = methods.some((m) => m.key === method) ? method : "cash";

  const debtMinor = BigInt(Math.round(debt * 100));
  const splitActive = split && purpose === "debt";
  const splitPaid = splitPaidMinor(rows);
  const splitOver = splitActive && splitPaid > debtMinor;
  const splitDuplicate = splitActive && hasDuplicateParts(rows);
  // Qarzni karta bilan to'lash — terminal orqali (pul terminal bog'langan bank hisobiga)
  const activeTerminal = !splitActive && purpose === "debt" && activeMethod === "card" && terminals.length > 0
    ? terminals.find((terminal) => terminal.id === terminalId) ?? terminals[0]!
    : null;

  const value = splitActive ? Number(splitPaid) / 100 : num(amount);
  const overBalance = !splitActive && activeMethod === "balance" && value > balance;
  const overDebt = purpose === "debt" && (splitActive ? splitOver : value > debt);
  const afterDebt = purpose === "debt" ? Math.max(0, debt - value) : debt;
  const afterBalance = purpose === "deposit" ? balance + value : activeMethod === "balance" && !splitActive ? balance - value : balance;
  const blocked = value <= 0 || overBalance || overDebt || splitDuplicate;

  const switchPurpose = (next: CustomerPaymentPurpose) => {
    setPurpose(next);
    setAmount(next === "debt" && debt > 0 ? String(debt) : "");
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (blocked || pay.isPending) return;
    setError(null);
    const body = splitActive
      ? { shiftId, purpose, parts: splitParts(rows), clientRequestId: requestId.current }
      : activeTerminal
        ? { shiftId, purpose, parts: [{ method: "card", amount: amount.trim(), terminalId: activeTerminal.id }], clientRequestId: requestId.current }
        : { shiftId, purpose, amount: amount.trim(), method: activeMethod };
    try {
      const result = await pay.mutateAsync(body);
      toast.success(
        purpose === "deposit"
          ? `Balans to'ldirildi. Joriy balans: ${fmt(num(result.customer.balance))} so'm`
          : `Qarz to'landi. Qolgan qarz: ${fmt(Math.max(0, num(result.customer.totalDebt)))} so'm`,
      );
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const warning =
    error ??
    (overBalance
      ? "Balansda yetarli mablag' yo'q"
      : overDebt
        ? "Summa qarzdan ortiq"
        : splitDuplicate
          ? "Bir xil to'lov usuli ikki marta kiritilgan"
          : null);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{customer.name}</DialogTitle>
          <DialogDescription>
            Qarz: {fmt(debt)} so'm · Balans: {fmt(balance)} so'm
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {PURPOSES.map((p) => (
              <button
                key={p.key}
                type="button"
                disabled={p.key === "debt" && debt <= 0}
                onClick={() => switchPurpose(p.key)}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-xl border h-10 text-sm font-medium transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
                  purpose === p.key
                    ? "bg-primary/10 text-primary border-primary/40"
                    : "bg-muted/30 text-muted-foreground border-border hover:bg-accent",
                )}
              >
                <p.icon className="h-4 w-4" /> {p.label}
              </button>
            ))}
          </div>

          {purpose === "debt" && (
            <div className="flex justify-end">
              <button
                type="button"
                className="text-xs font-semibold text-primary hover:underline cursor-pointer"
                onClick={() => { setSplit((current) => !current); setError(null); }}
              >
                {split ? "Bitta usulda" : "Aralash to'lov"}
              </button>
            </div>
          )}

          {splitActive ? (
            <SplitPaymentPanel
              dueMinor={debtMinor}
              rows={rows}
              onChange={(next) => { setRows(next); setError(null); }}
              terminals={terminals}
              format={(minor) => `${fmt(Number(minor) / 100)} so'm`}
              shortfallLabel="Qolgan qarz"
              labels={{ total: "Qarz" }}
              idPrefix="customer-payment-split"
            />
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="customer-payment-amount">Summa</Label>
                <Input
                  id="customer-payment-amount"
                  type="number"
                  min="0"
                  step="any"
                  autoFocus
                  className="text-right text-lg font-bold h-11"
                  value={amount}
                  onChange={(e) => { setAmount(e.target.value); setError(null); }}
                  placeholder="0"
                />
              </div>

              <div className={cn("grid gap-2", methods.length === 4 ? "grid-cols-4" : "grid-cols-3")}>
                {methods.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setMethod(m.key)}
                    className={cn(
                      "flex flex-col items-center gap-1 py-2 px-1 rounded-xl border text-xs font-medium transition-all cursor-pointer",
                      activeMethod === m.key
                        ? "bg-primary/10 text-primary border-primary/40"
                        : "bg-muted/30 text-muted-foreground border-border hover:bg-accent",
                    )}
                  >
                    <m.icon className="h-4 w-4" />
                    {m.label}
                  </button>
                ))}
              </div>

              {activeTerminal && (
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Karta terminali">
                  {terminals.map((terminal) => (
                    <button
                      key={terminal.id}
                      type="button"
                      role="radio"
                      aria-checked={activeTerminal.id === terminal.id}
                      title={terminal.name}
                      onClick={() => setTerminalId(terminal.id)}
                      className={cn(
                        "h-8 rounded-lg border px-3 text-xs font-bold tracking-wide cursor-pointer",
                        activeTerminal.id === terminal.id
                          ? "border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300"
                          : "border-border bg-muted/30 text-muted-foreground hover:bg-accent",
                      )}
                    >
                      {TERMINAL_NETWORK_LABELS[terminal.network]}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Qarz (keyin)</span>
              <span className="font-semibold">{fmt(afterDebt)} so'm</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Balans (keyin)</span>
              <span className="font-semibold">{fmt(afterBalance)} so'm</span>
            </div>
          </div>

          {warning && (
            <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {warning}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Bekor</Button>
            <Button type="submit" disabled={pay.isPending || blocked}>
              {pay.isPending
                ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Saqlanmoqda</>
                : purpose === "deposit" ? "Kirim qilish" : "To'lash"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
