import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import type { LocalPurchaseReturn, ReturnablePurchase } from "../../shared/kassa-api.js";
import { fromMinor, toMinor } from "../../shared/money.js";
import { decimalInput, fmtMoney, fmtQty, fmtTime, num, trimDecimal } from "../format.ts";
import { call, errorText } from "../kassa.ts";

const QTY = /^\d{1,14}(\.\d{1,4})?$/;

/** Ta'minotchiga qaytarish: xarid raqami (shu kassa — offline, boshqasi — internet bilan), miqdor, qaytgan pul. */
export default function PurchaseReturnDialog({
  open,
  baseCurrency,
  canReturn,
  hasShift,
  onClose,
  onDone,
}: {
  open: boolean;
  baseCurrency: string;
  canReturn: boolean;
  hasShift: boolean;
  onClose: () => void;
  onDone: (result: LocalPurchaseReturn) => void;
}) {
  const [number, setNumber] = useState("");
  const [purchase, setPurchase] = useState<ReturnablePurchase | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [refundAmount, setRefundAmount] = useState("");
  const [refundMethod, setRefundMethod] = useState<"cash" | "card">("cash");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<LocalPurchaseReturn | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setNumber("");
    setPurchase(null);
    setQuantities({});
    setRefundAmount("");
    setRefundMethod("cash");
    setReason("");
    setResult(null);
    setError(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const find = async () => {
    setBusy(true);
    setError(null);
    try {
      setPurchase(await call("purchase:find", { number }));
      setQuantities({});
    } catch (err) {
      setPurchase(null);
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const remaining = (line: ReturnablePurchase["lines"][number]) => toMinor(line.quantity, 4) - toMinor(line.returned, 4);
  const selected = purchase ? purchase.lines.filter((line) => QTY.test(quantities[line.id] ?? "") && toMinor(quantities[line.id]!, 4) > 0n) : [];
  const invalid = purchase?.lines.find((line) => {
    const value = quantities[line.id];
    return value && QTY.test(value) && toMinor(value, 4) > remaining(line);
  });

  const submit = async () => {
    if (!purchase) return;
    setBusy(true);
    setError(null);
    try {
      const done = await call("purchase:return", {
        number: purchase.number,
        items: selected.map((line) => ({ orderItemId: line.id, quantity: quantities[line.id]! })),
        reason: reason.trim() || null,
        refund: refundAmount !== "" && num(refundAmount) > 0 ? { amount: refundAmount, method: refundMethod } : null,
      });
      setResult(done);
      onDone(done);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && close()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Ta'minotchiga qaytarish</DialogTitle>
          <DialogDescription>Xarid raqamini kiriting (masalan, K01-P000012 yoki PO-2026-0031).</DialogDescription>
        </DialogHeader>
        {!canReturn ? (
          <p className="rounded-md bg-pos-warning/10 px-3 py-2 text-sm text-pos-warning">Qaytarish uchun ruxsat kerak: purchase.return</p>
        ) : result ? (
          <div className="space-y-3">
            <p className="text-lg font-semibold">Qaytarish {result.number} yozildi</p>
            <p className="text-sm text-muted-foreground">
              Xarid {result.orderNumber} · {result.supplier.name} · taxminan {fmtMoney(result.total, baseCurrency)}
            </p>
            {result.refund && (
              <p className="rounded-lg bg-pos-success/10 px-3 py-2 font-medium text-pos-success">
                Kassaga qaytgan pul: {fmtMoney(result.refund.amount, baseCurrency)} ({result.refund.method === "cash" ? "naqd" : "karta"})
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={reset}>
                Yana qaytarish
              </Button>
              <Button autoFocus onClick={close}>
                Yopish
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void find();
              }}
            >
              <Input id="purchase-return-number" autoFocus placeholder="Xarid raqami" value={number} onChange={(e) => setNumber(e.target.value.toUpperCase())} />
              <Button type="submit" disabled={busy || number.trim() === ""}>
                Topish
              </Button>
            </form>
            {purchase && (
              <>
                <div className="flex flex-wrap gap-x-4 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{purchase.number}</span>
                  <span>{fmtTime(purchase.createdAt)}</span>
                  <span>{purchase.supplier.name}</span>
                  <span>{purchase.source === "local" ? "shu kassa" : "server"}</span>
                </div>
                <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Mahsulot</th>
                        <th className="px-3 py-2 text-right">Qabul qilingan</th>
                        <th className="px-3 py-2 text-right">Qaytgan</th>
                        <th className="px-3 py-2 text-right">Summa</th>
                        <th className="w-40 px-3 py-2 text-right">Qaytariladi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchase.lines.map((line) => {
                        const left = remaining(line);
                        return (
                          <tr key={line.id} className="border-t border-border">
                            <td className="px-3 py-2">{line.name}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {fmtQty(line.quantity)} {line.unitName}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtQty(line.returned)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(line.lineTotal, line.currency ?? baseCurrency)}</td>
                            <td className="px-3 py-2">
                              {left > 0n ? (
                                <div className="flex items-center justify-end gap-1">
                                  <Input
                                    id={`purchase-return-qty-${line.id}`}
                                    className="h-8 w-20 text-right"
                                    inputMode="decimal"
                                    value={quantities[line.id] ?? ""}
                                    onChange={(e) => setQuantities((current) => ({ ...current, [line.id]: decimalInput(e.target.value, 4) }))}
                                  />
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 px-2"
                                    onClick={() => setQuantities((current) => ({ ...current, [line.id]: trimDecimal(fromMinor(left, 4)) }))}
                                  >
                                    hammasi
                                  </Button>
                                </div>
                              ) : (
                                <span className="block text-right text-xs text-muted-foreground">qaytgan</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="purchase-refund">Ta'minotchi qaytargan pul (ixtiyoriy)</Label>
                    <div className="flex gap-1">
                      <Input
                        id="purchase-refund"
                        inputMode="decimal"
                        disabled={!hasShift}
                        placeholder={hasShift ? "0" : "Smena yopiq"}
                        value={refundAmount}
                        onChange={(e) => setRefundAmount(decimalInput(e.target.value))}
                      />
                      {(["cash", "card"] as const).map((method) => (
                        <Button key={method} size="sm" variant={refundMethod === method ? "default" : "secondary"} onClick={() => setRefundMethod(method)}>
                          {method === "cash" ? "Naqd" : "Karta"}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="purchase-return-reason">Sabab</Label>
                    <Input id="purchase-return-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
                  </div>
                </div>
                {invalid && <p className="text-sm text-destructive">{invalid.name}: qaytarish miqdori qolganidan ko'p</p>}
                <Button className="h-11 w-full" disabled={busy || selected.length === 0 || !!invalid} onClick={() => void submit()}>
                  Qaytarishni yozish
                </Button>
              </>
            )}
          </div>
        )}
        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
