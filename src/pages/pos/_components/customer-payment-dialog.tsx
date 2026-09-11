/**
 * POS: mijoz balansini to'ldirish yoki qarzini to'lash. Naqd va karta smena yig'indisiga qo'shiladi;
 * qarzni balansdan yopishda kassaga pul tushmaydi.
 */
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Banknote, CreditCard, HandCoins, Loader2, Smartphone, Wallet } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { cn } from "@/lib/utils.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation } from "@/lib/query.ts";
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
  const [error, setError] = useState<string | null>(null);

  const pay = useApiMutation((body: object) =>
    api.post<{ customer: PosCustomerSummary }>(`/api/sales/pos/customers/${customer.id}/payments`, body),
  );

  // Balansdan faqat qarz yopiladi
  const methods = METHODS.filter((m) => m.key !== "balance" || (purpose === "debt" && balance > 0));
  const activeMethod: Method = methods.some((m) => m.key === method) ? method : "cash";

  const value = num(amount);
  const overBalance = activeMethod === "balance" && value > balance;
  const overDebt = purpose === "debt" && value > debt;
  const afterDebt = purpose === "debt" ? Math.max(0, debt - value) : debt;
  const afterBalance = purpose === "deposit" ? balance + value : activeMethod === "balance" ? balance - value : balance;

  const switchPurpose = (next: CustomerPaymentPurpose) => {
    setPurpose(next);
    setAmount(next === "debt" && debt > 0 ? String(debt) : "");
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (value <= 0 || overBalance || overDebt || pay.isPending) return;
    setError(null);
    try {
      const result = await pay.mutateAsync({ shiftId, purpose, amount: amount.trim(), method: activeMethod });
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

  const warning = error ?? (overBalance ? "Balansda yetarli mablag' yo'q" : overDebt ? "Summa qarzdan ortiq" : null);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
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
            <Button type="submit" disabled={pay.isPending || value <= 0 || overBalance || overDebt}>
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
