/**
 * MIJOZ HISOBIGA PUL QO'SHISH / HISOBIDAN PUL AYIRISH.
 *
 * Nega "balansni to'g'rilash" dan alohida: to'g'rilash — raqamni tuzatish (kamdan-kam, `finance.approve`),
 * bu esa HAQIQIY PUL HARAKATI: kassaga tushadi yoki kassadan chiqadi, jurnalga yoziladi va
 * mijoz kartochkasidagi tarixda qoladi. Balans maydoni to'g'ridan-to'g'ri tahrirlanmaydi —
 * server har harakatni tranzaksiya qatori sifatida yozadi.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation } from "@/lib/query.ts";

type Direction = "deposit" | "withdraw";

const METHODS = [
  { key: "cash", label: "Naqd" },
  { key: "card", label: "Karta" },
  { key: "bank", label: "Bank" },
  { key: "transfer", label: "O'tkazma" },
];

const fmt = (value: string | number) => new Intl.NumberFormat("uz-UZ").format(Math.round(Number(value)));

export default function CustomerMoneyDialog({
  customer,
  direction,
  onClose,
}: {
  customer: { id: string; name: string; balance: string };
  direction: Direction;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const adding = direction === "deposit";
  const endpoint = `/api/sales/customers/${customer.id}/balance-${adding ? "deposit" : "withdraw"}`;
  const save = useApiMutation((body: object) => api.post(endpoint, body), {
    invalidate: ["/api/sales/customers", `/api/sales/customers/${customer.id}/balance`],
  });

  const value = Number(amount.replace(",", "."));
  const balance = Number(customer.balance);
  const tooMuch = !adding && Number.isFinite(value) && value > balance;
  const valid = Number.isFinite(value) && value > 0 && !tooMuch;

  const submit = async () => {
    setError(null);
    if (!valid) {
      setError(tooMuch ? `Balansda ${fmt(balance)} so'm bor — undan ortiq ayirib bo'lmaydi` : "Summani kiriting");
      return;
    }
    try {
      await save.mutateAsync({ amount: String(value), method, notes: notes.trim() || null });
      toast.success(adding ? "Hisobga pul qo'shildi" : "Hisobdan pul qaytarildi");
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {customer.name} — {adding ? "hisobiga pul qo'shish" : "hisobidan pul ayirish"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex justify-between rounded-lg border border-border px-3 py-2 text-sm">
            <span className="text-muted-foreground">Joriy balans</span>
            <span className="font-semibold tabular-nums">{fmt(customer.balance)} so&apos;m</span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="money-amount">Summa (so&apos;m)</Label>
            <Input
              id="money-amount"
              autoFocus
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="money-method">{adding ? "Qanday olindi" : "Qanday qaytarildi"}</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger id="money-method" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent position="popper">
                {METHODS.map((item) => (
                  <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="money-notes">Sabab / izoh</Label>
            <Textarea
              id="money-notes"
              rows={2}
              placeholder={adding ? "Masalan: oldindan to'lov" : "Masalan: ortiqcha to'lov qaytarildi"}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          <p className="text-[11px] text-muted-foreground">
            {adding
              ? "Pul kassaga/bankka tushadi va mijoz hisobiga avans bo'lib yoziladi."
              : "Pul kassadan/bankdan chiqadi va mijoz avansidan yechiladi."}{" "}
            Harakat tarixda qoladi — balans qo&apos;lda tahrirlanmaydi.
          </p>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Bekor</Button>
          <Button disabled={!valid || save.isPending} onClick={() => void submit()}>
            {adding ? "Qo'shish" : "Ayirish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
