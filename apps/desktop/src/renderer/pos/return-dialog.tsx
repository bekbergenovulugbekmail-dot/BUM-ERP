import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import type { LocalReturn, ReturnableReceipt } from "../../shared/kassa-api.js";
import { fromMinor, mulDivRound, toMinor } from "../../shared/money.js";
import type { RefundMethod } from "../../shared/sync-types.js";
import { PAYMENT_LABELS, decimalInput, fmtMoney, fmtQty, fmtTime, trimDecimal } from "../format.ts";
import { call, errorText } from "../kassa.ts";

const QTY = /^\d{1,14}(\.\d{1,4})?$/;
const MONEY = /^\d{1,16}(\.\d{1,2})?$/;
const REFUND_KEYS: RefundMethod[] = ["cash", "card", "bank", "balance"];

/**
 * Mahsulotni qaytarish: chek raqami (shu kassa — offline; boshqa kassa yoki web — internet bilan), qator bo'yicha
 * miqdor, pul qaytarish usuli yoki usullar bo'yicha taqsimot (aralash to'lovli chek: chekda qaysi usulda qancha
 * to'langani ko'rinadi). Pul summasi taxminiy — mijoz qarzi bo'lsa server avval qarzni yopadi.
 */
export default function ReturnDialog({
  open,
  initialNumber = "",
  baseCurrency,
  canRefund,
  onClose,
  onDone,
}: {
  open: boolean;
  /** Sotuv tarixidan ochilganda — chek raqami tayyor (Topish tugmasi bilan). */
  initialNumber?: string;
  baseCurrency: string;
  canRefund: boolean;
  onClose: () => void;
  onDone: (result: LocalReturn) => void;
}) {
  const [number, setNumber] = useState(initialNumber);
  const [receipt, setReceipt] = useState<ReturnableReceipt | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [method, setMethod] = useState<RefundMethod>("cash");
  /** null — bitta usul; aks holda usul → summa. */
  const [split, setSplit] = useState<Partial<Record<RefundMethod, string>> | null>(null);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<LocalReturn | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setNumber("");
    setReceipt(null);
    setQuantities({});
    setMethod("cash");
    setSplit(null);
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
      const found = await call("pos:find-receipt", { number });
      setReceipt(found);
      setQuantities({});
      setSplit(null);
    } catch (err) {
      setReceipt(null);
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const remaining = (line: ReturnableReceipt["lines"][number]) => toMinor(line.quantity, 4) - toMinor(line.returned, 4);
  const selected = receipt
    ? receipt.lines.filter((line) => QTY.test(quantities[line.id] ?? "") && toMinor(quantities[line.id]!, 4) > 0n)
    : [];
  const invalid = receipt?.lines.find((line) => {
    const value = quantities[line.id];
    return value && QTY.test(value) && toMinor(value, 4) > remaining(line);
  });

  // Taxminiy qaytadigan pul (main jarayondagi hisob bilan bir xil): to'langani qaytarishdan keyingi chek summasidan oshgan qismi
  const selectedTotal = selected.reduce((sum, line) => sum + mulDivRound(toMinor(line.lineTotal), toMinor(quantities[line.id]!, 4), toMinor(line.quantity, 4)), 0n);
  const returnedBefore = receipt
    ? receipt.lines.reduce((sum, line) => sum + mulDivRound(toMinor(line.lineTotal), toMinor(line.returned, 4), toMinor(line.quantity, 4)), 0n)
    : 0n;
  const netAfter = receipt ? toMinor(receipt.total) - returnedBefore - selectedTotal : 0n;
  const paid = receipt ? toMinor(receipt.paid) : 0n;
  const estimate = selectedTotal < (paid > netAfter ? paid - netAfter : 0n) ? selectedTotal : paid > netAfter ? paid - netAfter : 0n;
  const available = (key: RefundMethod) => {
    const row = receipt?.refundable.find((item) => item.method === key);
    return row ? toMinor(row.amount) : null;
  };
  const paidMethods = receipt?.refundable.filter((row) => toMinor(row.amount) > 0n) ?? [];
  const splitSum = split ? Object.values(split).reduce((sum, value) => sum + (value && MONEY.test(value) ? toMinor(value) : 0n), 0n) : 0n;

  /** Taqsimot standarti: chekdagi usullar tartibida (naqd, karta, bank) — har biriga shu usulda to'langanigacha. */
  const startSplit = () => {
    let left = estimate;
    const next: Partial<Record<RefundMethod, string>> = {};
    for (const key of ["cash", "card", "bank"] as const) {
      const cap = available(key) ?? 0n;
      const take = left < cap ? left : cap;
      if (take > 0n) next[key] = trimDecimal(fromMinor(take));
      left -= take;
    }
    if (left > 0n) next.cash = trimDecimal(fromMinor(toMinor(next.cash ?? "0") + left));
    setSplit(next);
  };

  const submit = async () => {
    if (!receipt) return;
    setBusy(true);
    setError(null);
    try {
      const refunds = split
        ? REFUND_KEYS.flatMap((key) => {
            const value = split[key];
            return value && MONEY.test(value) && toMinor(value) > 0n ? [{ method: key, amount: value }] : [];
          })
        : [];
      const done = await call("pos:return", {
        number: receipt.number,
        items: selected.map((line) => ({ orderItemId: line.id, quantity: quantities[line.id]! })),
        refundMethod: method,
        ...(refunds.length > 0 ? { refunds } : {}),
        reason: reason.trim() || null,
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
          <DialogTitle>Mahsulotni qaytarish</DialogTitle>
          <DialogDescription>Chek raqamini kiriting yoki skanerlang (masalan, K01-000123).</DialogDescription>
        </DialogHeader>

        {!canRefund ? (
          <p className="rounded-md bg-pos-warning/10 px-3 py-2 text-sm text-pos-warning">Qaytarish uchun ruxsat kerak: sales.refund — rahbar kassir sifatida kirsin.</p>
        ) : result ? (
          <div className="space-y-3">
            <p className="text-lg font-semibold">Qaytarish {result.number} yozildi</p>
            <p className="text-sm text-muted-foreground">
              Chek {result.orderNumber} · {result.lines.length} qator · {fmtMoney(result.total, baseCurrency)}
            </p>
            <div className="rounded-lg bg-pos-success/10 px-3 py-2 font-medium text-pos-success">
              {(result.refunds?.length ? result.refunds : [{ method: result.refundMethod, amount: result.refundEstimate }]).map((part) => (
                <p key={part.method}>
                  {PAYMENT_LABELS[part.method]}: {fmtMoney(part.amount, baseCurrency)}
                </p>
              ))}
              <p className="text-xs font-normal">taxminiy — yakuniysi serverda</p>
            </div>
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
              <Input id="return-number" autoFocus placeholder="Chek raqami" value={number} onChange={(e) => setNumber(e.target.value.toUpperCase())} />
              <Button type="submit" disabled={busy || number.trim() === ""}>
                Topish
              </Button>
            </form>

            {receipt && (
              <>
                <div className="flex flex-wrap gap-x-4 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{receipt.number}</span>
                  <span>{fmtTime(receipt.createdAt)}</span>
                  <span>{receipt.source === "local" ? "shu kassa" : "server"}</span>
                  {receipt.customer && <span>Mijoz: {receipt.customer.name}</span>}
                  <span>Jami {fmtMoney(receipt.total, baseCurrency)}</span>
                  {paidMethods.length > 0 && (
                    <span>
                      To'lov:{" "}
                      {paidMethods.map((row) => `${PAYMENT_LABELS[row.method]} ${fmtMoney(row.amount, baseCurrency)}`).join(" · ")}
                    </span>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Mahsulot</th>
                        <th className="px-3 py-2 text-right">Sotilgan</th>
                        <th className="px-3 py-2 text-right">Qaytgan</th>
                        <th className="px-3 py-2 text-right">Summa</th>
                        <th className="w-40 px-3 py-2 text-right">Qaytariladi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receipt.lines.map((line) => {
                        const left = remaining(line);
                        return (
                          <tr key={line.id} className="border-t border-border">
                            <td className="px-3 py-2">{line.name}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {fmtQty(line.quantity)} {line.unitName}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtQty(line.returned)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(line.lineTotal, baseCurrency)}</td>
                            <td className="px-3 py-2">
                              {left > 0n ? (
                                <div className="flex items-center justify-end gap-1">
                                  <Input
                                    id={`return-qty-${line.id}`}
                                    className="h-8 w-20 text-right"
                                    inputMode="decimal"
                                    value={quantities[line.id] ?? ""}
                                    onChange={(e) => {
                                      setQuantities((current) => ({ ...current, [line.id]: decimalInput(e.target.value, 4) }));
                                      setSplit(null);
                                    }}
                                  />
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 px-2"
                                    onClick={() => {
                                      setQuantities((current) => ({ ...current, [line.id]: trimDecimal(fromMinor(left, 4)) }));
                                      setSplit(null);
                                    }}
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

                <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
                  <div className="space-y-1">
                    <Label>
                      Pul qaytarish
                      {estimate > 0n && <span className="ml-1 font-normal text-muted-foreground">— {fmtMoney(fromMinor(estimate), baseCurrency)} (taxminiy)</span>}
                    </Label>
                    {!split ? (
                      <div className="flex flex-wrap gap-1">
                        {REFUND_KEYS.map((key) => (
                          <Button key={key} size="sm" variant={method === key ? "default" : "secondary"} disabled={key === "balance" && !receipt.customer} onClick={() => setMethod(key)}>
                            {PAYMENT_LABELS[key]}
                          </Button>
                        ))}
                        {estimate > 0n && (
                          <Button size="sm" variant="ghost" onClick={startSplit}>
                            Usullarga taqsimlash
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {REFUND_KEYS.map((key) => {
                          const cap = available(key);
                          return (
                            <div key={key} className="flex items-center gap-2">
                              <span className="w-28 text-sm">{PAYMENT_LABELS[key]}</span>
                              <Input
                                id={`refund-${key}`}
                                className="h-8 w-32 text-right"
                                inputMode="decimal"
                                disabled={key === "balance" && !receipt.customer}
                                value={split[key] ?? ""}
                                onChange={(e) => setSplit((current) => ({ ...current, [key]: decimalInput(e.target.value) }))}
                              />
                              {cap !== null && key !== "balance" && <span className="text-xs text-muted-foreground">chekda {fmtMoney(fromMinor(cap), baseCurrency)}</span>}
                            </div>
                          );
                        })}
                        <p className={`text-xs ${splitSum === estimate ? "text-pos-success" : "text-pos-warning"}`}>
                          Taqsimot: {fmtMoney(fromMinor(splitSum), baseCurrency)} / {fmtMoney(fromMinor(estimate), baseCurrency)}
                        </p>
                        <Button size="sm" variant="ghost" onClick={() => setSplit(null)}>
                          Bitta usulda
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="return-reason">Sabab</Label>
                    <Input id="return-reason" value={reason} maxLength={500} placeholder="Sifatsiz, xato mahsulot…" onChange={(e) => setReason(e.target.value)} />
                  </div>
                </div>
                {invalid && <p className="text-sm text-destructive">{invalid.name}: qaytarish miqdori qolganidan ko'p</p>}
                <Button className="h-11 w-full" disabled={busy || selected.length === 0 || !!invalid || (split !== null && splitSum !== estimate)} onClick={() => void submit()}>
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
