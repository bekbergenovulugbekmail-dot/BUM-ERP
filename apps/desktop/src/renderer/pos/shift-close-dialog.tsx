import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import type { AppStatus, LocalShift } from "../../shared/kassa-api.js";
import { decimalInput, fmtMoney, fmtTime, num } from "../format.ts";
import { call, errorText } from "../kassa.ts";

/** Smenani yopish: qurilmadagi yig'indilar va kutilgan naqd; sanalgan naqd bilan farq serverda hisoblanadi. */
export default function ShiftCloseDialog({
  open,
  shift,
  baseCurrency,
  expectedCash,
  onClose,
  onClosed,
}: {
  open: boolean;
  shift: LocalShift | null;
  baseCurrency: string;
  /** Kassa bo'limidan — hujjatlardan hisoblangan X-hisobot qiymati. */
  expectedCash?: string;
  onClose: () => void;
  onClosed: (status: AppStatus) => void;
}) {
  const [counted, setCounted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const totals = shift?.totals;
  const expected =
    expectedCash !== undefined ? num(expectedCash) : num(shift?.openingCash) + num(totals?.cash) + num(totals?.cashIn) - num(totals?.cashOut);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const status = await call("shift:close", { closingCash: counted });
      setCounted("");
      onClosed(status);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const rows: [string, string][] = [
    ["Boshlang'ich naqd", fmtMoney(shift?.openingCash, baseCurrency)],
    ["Savdo", fmtMoney(totals?.sales, baseCurrency)],
    ["Naqd tushum", fmtMoney(totals?.cash, baseCurrency)],
    ["Karta", fmtMoney(totals?.card, baseCurrency)],
    ["Qaytarishlar", fmtMoney(totals?.returns, baseCurrency)],
    ["Kassaga kirim", fmtMoney(totals?.cashIn, baseCurrency)],
    ["Kassadan chiqim", fmtMoney(totals?.cashOut, baseCurrency)],
    ["Cheklar soni", String(totals?.receipts ?? 0)],
  ];

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Smenani yopish</DialogTitle>
          <DialogDescription>{shift ? `${shift.cashierName ?? ""} · ochilgan ${fmtTime(shift.openedAt)}` : "Ochiq smena yo'q"}</DialogDescription>
        </DialogHeader>
        <dl className="divide-y divide-border rounded-lg border border-border text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between px-3 py-1.5">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="tabular-nums">{value}</dd>
            </div>
          ))}
          <div className="flex justify-between bg-muted/50 px-3 py-2 font-semibold">
            <dt>Kassada bo'lishi kerak</dt>
            <dd className="tabular-nums">{fmtMoney(expected, baseCurrency)}</dd>
          </div>
        </dl>
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Label htmlFor="closing-cash">Kassadagi naqd (sanalgan)</Label>
          <Input id="closing-cash" autoFocus inputMode="decimal" value={counted} onChange={(e) => setCounted(decimalInput(e.target.value))} />
          {counted !== "" && (
            <p className={`text-sm ${num(counted) - expected === 0 ? "text-pos-success" : "text-pos-warning"}`}>
              Farq: {fmtMoney(num(counted) - expected, baseCurrency)}
            </p>
          )}
          <Button type="submit" className="h-11 w-full" disabled={busy || counted === "" || !shift}>
            Smenani yopish
          </Button>
        </form>
        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
