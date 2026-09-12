import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import type { AppStatus, CountDraft, LocalStockDocument, PosProduct } from "../../shared/kassa-api.js";
import { decimalInput, fmtMoney, fmtQty, fmtTime, trimDecimal } from "../format.ts";
import { call, errorText } from "../kassa.ts";
import ProductPicker from "../stock/product-picker.tsx";

/**
 * Inventarizatsiya (offline): skaner har o'qishda +1, miqdorni qo'lda ham kiritish mumkin; kutilgan qoldiq va farq
 * darhol ko'rinadi. Qoralama qurilmada saqlanadi (ilova yopilsa ham). Yakunlanganda — `stock.count` hujjati.
 */
export default function CountScreen({ status, onStatus, onExit }: { status: AppStatus; onStatus: (status: AppStatus) => void; onExit: () => void }) {
  const [draft, setDraft] = useState<CountDraft | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [zeroMissing, setZeroMissing] = useState(false);
  const [confirm, setConfirm] = useState<"complete" | "cancel" | null>(null);
  const [completed, setCompleted] = useState<LocalStockDocument | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const permissions = status.cashier?.permissions ?? [];
  const canCount = permissions.includes("warehouse.view") && permissions.includes("warehouse.count");
  const canApply = canCount && permissions.includes("warehouse.manage");
  const base = status.company?.currency ?? "UZS";
  const lastSyncAt = status.sync.lastSyncAt;

  useEffect(() => {
    if (!canCount) return;
    call("count:draft").then(setDraft, (err: unknown) => setNotice(errorText(err)));
  }, [canCount, lastSyncAt]);

  const run = async (action: () => Promise<CountDraft | null>) => {
    setNotice(null);
    try {
      setDraft(await action());
    } catch (err) {
      setNotice(errorText(err));
    }
  };

  const pick = (product: PosProduct) => {
    setCompleted(null);
    void run(() => call("count:set", { productId: product.id, counted: "1", mode: "add" }));
  };

  const commit = (productId: string) => {
    const value = edits[productId];
    if (value === undefined) return;
    setEdits((current) => {
      const next = { ...current };
      delete next[productId];
      return next;
    });
    void run(() => call("count:set", { productId, counted: value === "" ? "0" : value, mode: "set" }));
  };

  const complete = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const doc = await call("count:complete", { notes: notes.trim() || null, zeroMissing });
      setCompleted(doc);
      setDraft(null);
      setNotes("");
      setZeroMissing(false);
      setConfirm(null);
      call("app:status").then(onStatus, () => undefined);
    } catch (err) {
      setNotice(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const lines = draft?.lines ?? [];
  const surplus = lines.filter((line) => !line.difference.startsWith("-") && line.difference !== "0.0000").length;
  const shortage = lines.filter((line) => line.difference.startsWith("-")).length;

  return (
    <main className="grid h-full grid-rows-[auto_1fr] bg-muted/40">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2">
        <Button size="sm" variant="secondary" onClick={onExit}>
          ← Bosh sahifa
        </Button>
        <h1 className="font-semibold">Inventarizatsiya</h1>
        <span className="text-sm text-muted-foreground">
          {status.device?.code} · {status.device?.warehouseName}
          {draft && ` · boshlangan ${fmtTime(draft.startedAt)}`}
        </span>
      </header>

      {!canCount ? (
        <p className="m-6 rounded-lg bg-pos-warning/10 px-4 py-3 text-pos-warning">Inventarizatsiya uchun ruxsat kerak: warehouse.view va warehouse.count.</p>
      ) : (
        <div className="grid min-h-0 grid-cols-[minmax(0,360px)_minmax(0,1fr)] gap-3 p-3">
          <ProductPicker onPick={pick} placeholder="Skanerlang yoki qidiring — har biri +1" refreshKey={lastSyncAt} />

          <section className="flex min-h-0 flex-col rounded-xl border border-border bg-card">
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/80 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Mahsulot</th>
                    <th className="px-3 py-2 text-right">Hisobda</th>
                    <th className="px-3 py-2 text-right">Sanalgan</th>
                    <th className="px-3 py-2 text-right">Farq</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.productId} className="border-t border-border">
                      <td className="px-3 py-1.5">
                        <p className="font-medium leading-tight">{line.name}</p>
                        <p className="text-xs text-muted-foreground">{line.sku}</p>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                        {fmtQty(line.expected)} {line.unitName}
                      </td>
                      <td className="px-3 py-1.5">
                        <Input
                          id={`count-qty-${line.productId}`}
                          className="ml-auto h-8 w-24 text-right"
                          inputMode="decimal"
                          value={edits[line.productId] ?? trimDecimal(line.counted)}
                          onChange={(e) => setEdits((current) => ({ ...current, [line.productId]: decimalInput(e.target.value, 4) }))}
                          onBlur={() => commit(line.productId)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commit(line.productId);
                          }}
                        />
                      </td>
                      <td
                        className={`px-3 py-1.5 text-right font-semibold tabular-nums ${
                          line.difference.startsWith("-") ? "text-destructive" : line.difference === "0.0000" ? "text-muted-foreground" : "text-pos-success"
                        }`}
                      >
                        {line.difference.startsWith("-") || line.difference === "0.0000" ? "" : "+"}
                        {fmtQty(line.difference)}
                      </td>
                      <td className="px-2 py-1.5">
                        <button
                          type="button"
                          aria-label={`${line.name} qatorini o'chirish`}
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => void run(() => call("count:remove", { productId: line.productId }))}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-12 text-center text-muted-foreground">
                        {completed ? `${completed.number} yakunlandi — yangi sanashni boshlash uchun mahsulotni skanerlang` : "Mahsulotlarni skanerlang: har o'qish +1"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="space-y-2 border-t border-border p-3">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <span>
                  Sanalgan: <span className="font-semibold tabular-nums">{lines.length}</span>
                </span>
                <span className="text-pos-success">
                  Ortiqcha: <span className="font-semibold tabular-nums">{surplus}</span>
                </span>
                <span className="text-destructive">
                  Kamomad: <span className="font-semibold tabular-nums">{shortage}</span>
                </span>
              </div>
              <label htmlFor="count-zero-missing" className="flex items-start gap-2 text-sm">
                <input id="count-zero-missing" type="checkbox" className="mt-1" checked={zeroMissing} onChange={(e) => setZeroMissing(e.target.checked)} />
                <span>
                  To'liq inventarizatsiya — sanalmagan, lekin hisobda qoldig'i bor mahsulotlar <b>0</b> deb yoziladi
                </span>
              </label>
              <Input id="count-notes" maxLength={500} placeholder="Izoh (masalan: oylik inventarizatsiya, javobgar)" value={notes} onChange={(e) => setNotes(e.target.value)} />
              {completed && (
                <p className="rounded-lg bg-pos-success/10 px-3 py-2 text-sm text-pos-success">
                  {completed.number}: {completed.lines.length} mahsulot yozildi
                  {completed.value ? ` · farq qiymati ${fmtMoney(completed.value, base)}` : ""}
                </p>
              )}
              {notice && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{notice}</p>}
              {!canApply && <p className="text-xs text-muted-foreground">Yakunlash uchun warehouse.manage ruxsati kerak — sanashni saqlab, rahbar yakunlaydi.</p>}

              {confirm === "complete" ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-primary/5 p-2">
                  <p className="min-w-0 flex-1 text-sm">
                    Qoldiq sanalgan miqdorga tenglashtiriladi{zeroMissing ? ", sanalmaganlari 0 bo'ladi" : ""}. Davom etasizmi?
                  </p>
                  <Button disabled={busy} onClick={() => void complete()}>
                    Ha, yakunlash
                  </Button>
                  <Button variant="secondary" onClick={() => setConfirm(null)}>
                    Yo'q
                  </Button>
                </div>
              ) : confirm === "cancel" ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-destructive/5 p-2">
                  <p className="min-w-0 flex-1 text-sm">Sanalgan miqdorlar o'chiriladi. Davom etasizmi?</p>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setConfirm(null);
                      void run(async () => {
                        await call("count:cancel");
                        return null;
                      });
                    }}
                  >
                    Ha, bekor qilish
                  </Button>
                  <Button variant="secondary" onClick={() => setConfirm(null)}>
                    Yo'q
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button className="h-12 flex-1 text-base font-bold" disabled={busy || !canApply || (lines.length === 0 && !zeroMissing)} onClick={() => setConfirm("complete")}>
                    Inventarizatsiyani yakunlash
                  </Button>
                  <Button className="h-12" variant="secondary" disabled={!draft} onClick={() => setConfirm("cancel")}>
                    Bekor qilish
                  </Button>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
