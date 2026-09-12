import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import type { DevicePrefs, LocalSale, PosContext } from "../../shared/kassa-api.js";
import { PAYMENT_LABELS, fmtMoney, num } from "../format.ts";
import { errorText } from "../kassa.ts";
import { printSale } from "./receipt.ts";

/** Chek yakunlandi: qaytim katta ko'rinadi; Enter — yangi chek. */
export default function ReceiptDialog({
  sale,
  context,
  prefs,
  onClose,
}: {
  sale: LocalSale | null;
  context: PosContext | null;
  prefs: DevicePrefs | null;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const base = context?.baseCurrency ?? "UZS";

  const reprint = async () => {
    if (!sale || !prefs) return;
    setError(null);
    try {
      await printSale(sale, context, prefs);
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Dialog open={sale !== null} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="sm:max-w-md">
        {sale && (
          <>
            <DialogHeader>
              <DialogTitle>Chek {sale.number}</DialogTitle>
              <DialogDescription>
                {sale.lines.length} qator · {PAYMENT_LABELS[sale.paymentMethod]}
                {sale.customer ? ` · ${sale.customer.name}` : ""}
              </DialogDescription>
            </DialogHeader>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between text-base font-semibold">
                <dt>Jami</dt>
                <dd className="tabular-nums">{fmtMoney(sale.total, base)}</dd>
              </div>
              {sale.currencyTotals
                .filter((part) => part.currency !== base)
                .map((part) => (
                  <div key={part.currency} className="flex justify-between">
                    <dt>
                      {part.currency}: to'landi {fmtMoney(part.paid, part.currency)}
                    </dt>
                    <dd className="tabular-nums">{num(part.change) > 0 ? `qaytim ${fmtMoney(part.change, part.currency)}` : ""}</dd>
                  </div>
                ))}
              {num(sale.balanceUsed) > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <dt>Balansdan</dt>
                  <dd className="tabular-nums">{fmtMoney(sale.balanceUsed, base)}</dd>
                </div>
              )}
              {num(sale.cashbackUsed) > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <dt>Keshbekdan</dt>
                  <dd className="tabular-nums">{fmtMoney(sale.cashbackUsed, base)}</dd>
                </div>
              )}
              {(sale.payments?.length ? sale.payments : [{ method: sale.paymentMethod, tendered: sale.tendered, paid: sale.paid }]).map((part) => (
                <div key={part.method} className="flex justify-between text-muted-foreground">
                  <dt>{PAYMENT_LABELS[part.method] ?? part.method}</dt>
                  <dd className="tabular-nums">{fmtMoney(part.tendered, base)}</dd>
                </div>
              ))}
              {num(sale.debt) > 0 && (
                <div className="flex justify-between font-medium text-amber-600">
                  <dt>Qarzga</dt>
                  <dd className="tabular-nums">{fmtMoney(sale.debt, base)}</dd>
                </div>
              )}
              {num(sale.changeToBalance) > 0 && (
                <div className="flex justify-between font-medium text-emerald-600">
                  <dt>Qaytim balansga</dt>
                  <dd className="tabular-nums">{fmtMoney(sale.changeToBalance, base)}</dd>
                </div>
              )}
            </dl>
            <div className="rounded-xl bg-emerald-500/10 px-4 py-3 text-center">
              <p className="text-xs uppercase tracking-wide text-emerald-700">Qaytim</p>
              <p className="text-3xl font-bold tabular-nums text-emerald-700">{fmtMoney(sale.change, base)}</p>
            </div>
            <p className="text-center text-xs text-muted-foreground">
              {sale.sync.state === "applied" ? "Serverga yozildi" : "Internet bo'lganda serverga yuboriladi"}
            </p>
            {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => void reprint()} disabled={!prefs}>
                Chop etish
              </Button>
              <Button autoFocus onClick={onClose}>
                Yangi chek (Enter)
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
