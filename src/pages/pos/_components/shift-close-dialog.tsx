import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { cn } from "@/lib/utils.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation } from "@/lib/query.ts";
import { formatMoney } from "@/hooks/use-currencies.ts";
import { num, type PosShift } from "@/pages/sales/_lib/types.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

type Props = {
  shift: PosShift;
  onClose: () => void;
};

type ForeignCount = { currency: string; expected: string; counted: string; difference: string };
type CloseResult = { shift: PosShift; expectedCash: string; difference: string; foreignCash: ForeignCount[]; review?: "pending" | null };

function DifferenceBadge({ difference, format }: { difference: number; format: (n: number) => string }) {
  return (
    <div className={cn(
      "rounded-xl px-4 py-2.5 text-sm font-semibold flex justify-between",
      difference === 0 && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      difference > 0 && "bg-blue-500/10 text-blue-600 dark:text-blue-400",
      difference < 0 && "bg-destructive/10 text-destructive",
    )}>
      <span>{difference === 0 ? "Kassa mos keldi" : difference > 0 ? "Ortiqcha" : "Kamomad"}</span>
      {difference !== 0 && <span>{format(Math.abs(difference))}</span>}
    </div>
  );
}

export default function ShiftCloseDialog({ shift, onClose }: Props) {
  const [closingCash, setClosingCash] = useState("");
  const [foreignCounted, setForeignCounted] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<CloseResult | null>(null);
  const closeShift = useApiMutation((body: object) =>
    api.post<CloseResult>(`/api/sales/pos/shifts/${shift.id}/close`, body),
  );

  // Kutilgan naqd = boshlang'ich naqd + naqd tushum (server bilan bir xil qoida), har valyutada alohida
  const expected = num(shift.expectedCash);
  const counted = closingCash.trim() === "" ? null : num(closingCash);
  const previewDifference = counted === null ? null : counted - expected;

  const foreignCodes = [...new Set([...Object.keys(shift.openingForeignCash ?? {}), ...Object.keys(shift.foreignCash ?? {})])].sort();
  const foreignExpected = (code: string) => num(shift.openingForeignCash?.[code]) + num(shift.foreignCash?.[code]);

  const handleClose = async () => {
    if (counted === null) { toast.error("Kassadagi naqd pulni kiriting"); return; }
    const missing = foreignCodes.find((code) => (foreignCounted[code] ?? "").trim() === "");
    if (missing) { toast.error(`Kassadagi ${missing} naqdini kiriting`); return; }
    try {
      const closed = await closeShift.mutateAsync({
        closingCash: closingCash.trim(),
        ...(foreignCodes.length > 0
          ? { closingForeignCash: foreignCodes.map((currency) => ({ currency, amount: foreignCounted[currency]!.trim() })) }
          : {}),
        notes: notes.trim() || null,
      });
      setResult(closed);
      toast.success("Smena yopildi");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const difference = result ? num(result.difference) : previewDifference;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{result ? "Smena yopildi" : "Smenani yopish"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {/* Stats */}
          <div className="bg-muted/40 rounded-xl p-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Jami sotuv</p>
              <p className="font-bold">{fmt(num(shift.totalSales))} so'm</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Cheklar soni</p>
              <p className="font-bold">{shift.receiptCount} ta</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Naqd sotuv</p>
              <p className="font-bold">{fmt(num(shift.totalCash))} so'm</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Karta sotuv</p>
              <p className="font-bold">{fmt(num(shift.totalCard))} so'm</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Boshlang'ich naqd</p>
              <p className="font-bold">{fmt(num(shift.openingCash))} so'm</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Kassada bo'lishi kerak</p>
              <p className="font-bold">{fmt(result ? num(result.expectedCash) : expected)} so'm</p>
            </div>
            {foreignCodes.map((code) => (
              <div key={code} className="col-span-2 grid grid-cols-2 gap-3 pt-2 border-t border-border">
                <div>
                  <p className="text-xs text-muted-foreground">{code}: naqd / karta tushum</p>
                  <p className="font-bold">
                    {formatMoney(num(shift.foreignCash?.[code]), code)} / {formatMoney(num(shift.foreignCard?.[code]), code)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{code}: kassada bo'lishi kerak</p>
                  <p className="font-bold">{formatMoney(foreignExpected(code), code)}</p>
                </div>
              </div>
            ))}
          </div>

          {difference !== null && <DifferenceBadge difference={difference} format={(n) => `${fmt(n)} so'm`} />}
          {result?.review === "pending" && (
            <p className="rounded-xl bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-400">
              Farq ruxsat etilgan chegaradan oshdi — rahbarga ko'rib chiqish uchun yuborildi
            </p>
          )}
          {result?.foreignCash.map((row) => (
            <div key={row.currency} className="space-y-1">
              <p className="text-xs text-muted-foreground">{row.currency}</p>
              <DifferenceBadge difference={num(row.difference)} format={(n) => formatMoney(n, row.currency)} />
            </div>
          ))}

          {!result && (
            <>
              <Separator />
              <div>
                <Label>Kassadagi naqd pul (so'm)</Label>
                <Input type="number" min="0" value={closingCash}
                  onChange={(e) => setClosingCash(e.target.value)} placeholder="0" />
              </div>
              {foreignCodes.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  {foreignCodes.map((code) => {
                    const text = foreignCounted[code] ?? "";
                    const diff = text.trim() === "" ? null : num(text) - foreignExpected(code);
                    return (
                      <div key={code}>
                        <Label>Kassadagi naqd ({code})</Label>
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          value={text}
                          onChange={(e) => setForeignCounted((prev) => ({ ...prev, [code]: e.target.value }))}
                          placeholder={String(foreignExpected(code))}
                        />
                        {diff !== null && diff !== 0 && (
                          <p className={cn("text-xs mt-1 font-medium", diff > 0 ? "text-blue-600" : "text-destructive")}>
                            {diff > 0 ? "Ortiqcha" : "Kamomad"}: {formatMoney(Math.abs(diff), code)}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <div>
                <Label>Izoh</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ixtiyoriy..." />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          {result ? (
            <Button onClick={onClose}>Yopish</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={onClose}>Bekor</Button>
              <Button variant="destructive" onClick={handleClose} disabled={closeShift.isPending}>
                {closeShift.isPending ? "..." : "Smena yopish"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
