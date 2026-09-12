import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import type { LocalSupplierPayment, PosSupplier } from "../../shared/kassa-api.js";
import { decimalInput, fmtMoney, num, trimDecimal } from "../format.ts";
import { call, errorText } from "../kassa.ts";

/** Kassa smenasidan ta'minotchi qarzini to'lash (naqd yoki karta). */
export default function SupplierPaymentDialog({
  open,
  baseCurrency,
  onClose,
  onDone,
}: {
  open: boolean;
  baseCurrency: string;
  onClose: () => void;
  onDone: (payment: LocalSupplierPayment) => void;
}) {
  const [query, setQuery] = useState("");
  const [list, setList] = useState<PosSupplier[]>([]);
  const [supplier, setSupplier] = useState<PosSupplier | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "card">("cash");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || supplier) return;
    const timer = setTimeout(() => {
      call("purchase:suppliers", { query }).then(setList, (err: unknown) => setError(errorText(err)));
    }, 150);
    return () => clearTimeout(timer);
  }, [open, query, supplier]);

  const close = () => {
    setQuery("");
    setSupplier(null);
    setAmount("");
    setMethod("cash");
    setNotes("");
    setError(null);
    onClose();
  };

  const submit = async () => {
    if (!supplier) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await call("purchase:supplier-payment", { supplierId: supplier.id, amount, method, notes: notes.trim() || null }));
      close();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const debt = supplier ? num(supplier.totalDebt) : 0;

  return (
    <Dialog open={open} onOpenChange={(value) => !value && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ta'minotchiga to'lov</DialogTitle>
          <DialogDescription>Smena naqdidan yoki kartadan. Qarzdan ortig'i avans bo'lib yoziladi.</DialogDescription>
        </DialogHeader>
        {!supplier ? (
          <div className="space-y-2">
            <Input id="supplier-payment-search" autoFocus placeholder="Ta'minotchi" value={query} onChange={(e) => setQuery(e.target.value)} />
            <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {list.map((row) => (
                <li key={row.id}>
                  <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted" onClick={() => setSupplier(row)}>
                    <span className="min-w-0 truncate font-medium">{row.name}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">qarzimiz {fmtMoney(row.totalDebt, baseCurrency)}</span>
                  </button>
                </li>
              ))}
              {list.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Ta'minotchi topilmadi</li>}
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
                <p className="font-medium">{supplier.name}</p>
                <p className="text-xs text-muted-foreground">qarzimiz {fmtMoney(debt, baseCurrency)}</p>
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={() => setSupplier(null)}>
                Almashtirish
              </Button>
            </div>
            <div className="space-y-1">
              <Label htmlFor="supplier-payment-amount">Summa</Label>
              <div className="flex gap-2">
                <Input id="supplier-payment-amount" autoFocus inputMode="decimal" className="h-11 text-right text-lg" value={amount} onChange={(e) => setAmount(decimalInput(e.target.value))} />
                {debt > 0 && (
                  <Button type="button" variant="secondary" onClick={() => setAmount(trimDecimal(String(debt)))}>
                    To'liq qarz
                  </Button>
                )}
              </div>
            </div>
            <div className="flex gap-1">
              {(["cash", "card"] as const).map((key) => (
                <Button key={key} type="button" size="sm" variant={method === key ? "default" : "secondary"} onClick={() => setMethod(key)}>
                  {key === "cash" ? "Naqd (smenadan)" : "Karta"}
                </Button>
              ))}
            </div>
            <div className="space-y-1">
              <Label htmlFor="supplier-payment-notes">Izoh</Label>
              <Input id="supplier-payment-notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <Button type="submit" className="h-11 w-full" disabled={busy || amount === "" || num(amount) <= 0}>
              To'lash
            </Button>
          </form>
        )}
        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
