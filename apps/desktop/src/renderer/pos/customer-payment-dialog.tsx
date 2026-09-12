import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import type { LocalCustomerPayment, PosCustomer } from "../../shared/kassa-api.js";
import { decimalInput, fmtMoney, num, trimDecimal } from "../format.ts";
import { call, errorText } from "../kassa.ts";

/** Kassada mijoz qarzini to'lash yoki balansini to'ldirish (naqd/karta), offline ham. */
export default function CustomerPaymentDialog({
  open,
  baseCurrency,
  onClose,
  onDone,
}: {
  open: boolean;
  baseCurrency: string;
  onClose: () => void;
  onDone: (payment: LocalCustomerPayment) => void;
}) {
  const [query, setQuery] = useState("");
  const [list, setList] = useState<PosCustomer[]>([]);
  const [customer, setCustomer] = useState<PosCustomer | null>(null);
  const [purpose, setPurpose] = useState<"debt" | "deposit">("debt");
  const [method, setMethod] = useState<"cash" | "card">("cash");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || customer) return;
    const timer = setTimeout(() => {
      call("pos:customers", { query }).then(setList, (err: unknown) => setError(errorText(err)));
    }, 150);
    return () => clearTimeout(timer);
  }, [open, query, customer]);

  const close = () => {
    setQuery("");
    setCustomer(null);
    setPurpose("debt");
    setMethod("cash");
    setAmount("");
    setError(null);
    onClose();
  };

  const submit = async () => {
    if (!customer) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await call("cash:customer-payment", { customerId: customer.id, purpose, amount, method }));
      close();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const debt = customer ? Math.max(0, num(customer.totalDebt)) : 0;

  return (
    <Dialog open={open} onOpenChange={(value) => !value && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Mijoz to'lovi</DialogTitle>
          <DialogDescription>Qarzni to'lash yoki balansni to'ldirish. Qarzdan ortig'i balansga yoziladi.</DialogDescription>
        </DialogHeader>
        {!customer ? (
          <div className="space-y-2">
            <Input id="payment-customer-search" autoFocus placeholder="Mijoz: ism, telefon, kod" value={query} onChange={(e) => setQuery(e.target.value)} />
            <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {list.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted"
                    onClick={() => {
                      setCustomer(row);
                      setPurpose(num(row.totalDebt) > 0 ? "debt" : "deposit");
                    }}
                  >
                    <span className="min-w-0 truncate font-medium">{row.name}</span>
                    <span className="text-right text-xs tabular-nums">
                      {num(row.totalDebt) > 0 && <span className="block text-pos-warning">qarz {fmtMoney(row.totalDebt, baseCurrency)}</span>}
                      <span className="block text-muted-foreground">balans {fmtMoney(row.balance, baseCurrency)}</span>
                    </span>
                  </button>
                </li>
              ))}
              {list.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Mijoz topilmadi</li>}
            </ul>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
              <div>
                <p className="font-medium">{customer.name}</p>
                <p className="text-xs text-muted-foreground">
                  qarz {fmtMoney(debt, baseCurrency)} · balans {fmtMoney(customer.balance, baseCurrency)}
                </p>
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={() => setCustomer(null)}>
                Almashtirish
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex gap-1">
                <Button type="button" size="sm" variant={purpose === "debt" ? "default" : "secondary"} onClick={() => setPurpose("debt")}>
                  Qarz to'lovi
                </Button>
                <Button type="button" size="sm" variant={purpose === "deposit" ? "default" : "secondary"} onClick={() => setPurpose("deposit")}>
                  Balansga
                </Button>
              </div>
              <div className="flex justify-end gap-1">
                <Button type="button" size="sm" variant={method === "cash" ? "default" : "secondary"} onClick={() => setMethod("cash")}>
                  Naqd
                </Button>
                <Button type="button" size="sm" variant={method === "card" ? "default" : "secondary"} onClick={() => setMethod("card")}>
                  Karta
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="payment-amount">Summa</Label>
              <div className="flex gap-2">
                <Input id="payment-amount" autoFocus inputMode="decimal" className="h-11 text-right text-lg" value={amount} onChange={(e) => setAmount(decimalInput(e.target.value))} />
                {purpose === "debt" && debt > 0 && (
                  <Button type="button" variant="secondary" onClick={() => setAmount(trimDecimal(String(debt)))}>
                    To'liq qarz
                  </Button>
                )}
              </div>
              {purpose === "debt" && num(amount) > debt && (
                <p className="text-xs text-pos-warning">Qarzdan ortig'i {fmtMoney(num(amount) - debt, baseCurrency)} balansga yoziladi</p>
              )}
            </div>
            <Button type="submit" className="h-11 w-full" disabled={busy || amount === "" || num(amount) <= 0}>
              Qabul qilish
            </Button>
          </form>
        )}
        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
