import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import type { LocalStockDocument, PosProduct, StockWarehouse } from "../../shared/kassa-api.js";
import { fromMinor, toMinor } from "../../shared/money.js";
import { decimalInput, fmtMoney, fmtQty, trimDecimal } from "../format.ts";
import { call, errorText } from "../kassa.ts";
import ProductPicker from "./product-picker.tsx";

type Line = { productId: string; name: string; sku: string; unitName: string; stock: string; quantity: string };

const QTY = /^\d{1,14}(\.\d{1,4})?$/;

/**
 * Hisobdan chiqarish yoki boshqa omborga ko'chirish hujjati: mahsulotlar (skaner ham), miqdor, sabab/izoh, ko'chirishda —
 * qabul qiluvchi ombor. Internet shart emas; qoldiqdan ko'p bo'lsa ogohlantiriladi (server nomuvofiqlik sifatida belgilaydi).
 */
export default function StockDocumentForm({
  kind,
  baseCurrency,
  onDone,
}: {
  kind: "writeoff" | "transfer";
  baseCurrency: string;
  onDone: (doc: LocalStockDocument) => void;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [warehouses, setWarehouses] = useState<StockWarehouse[]>([]);
  const [target, setTarget] = useState("");
  const [notes, setNotes] = useState("");
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (kind !== "transfer") return;
    call("stock:warehouses").then(setWarehouses, (err: unknown) => setNotice({ tone: "error", text: errorText(err) }));
  }, [kind]);

  const add = (product: PosProduct) => {
    setNotice(null);
    setLines((current) => {
      const index = current.findIndex((line) => line.productId === product.id);
      if (index < 0) return [{ productId: product.id, name: product.name, sku: product.sku, unitName: product.unitName, stock: product.stock, quantity: "1" }, ...current];
      return current.map((line, i) =>
        i === index ? { ...line, quantity: trimDecimal(fromMinor((QTY.test(line.quantity) ? toMinor(line.quantity, 4) : 0n) + 10_000n, 4)) } : line,
      );
    });
  };

  const setQuantity = (index: number, quantity: string) => setLines((current) => current.map((line, i) => (i === index ? { ...line, quantity } : line)));

  const invalid = lines.some((line) => !QTY.test(line.quantity) || toMinor(line.quantity, 4) <= 0n);
  const over = lines.filter((line) => QTY.test(line.quantity) && toMinor(line.quantity, 4) > toMinor(line.stock, 4));
  const ready = lines.length > 0 && !invalid && (kind === "writeoff" || target !== "") && (kind === "transfer" || notes.trim() !== "");

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const payload = lines.map((line) => ({ productId: line.productId, quantity: line.quantity }));
      const doc =
        kind === "writeoff"
          ? await call("stock:writeoff", { lines: payload, reason: notes.trim() || null })
          : await call("stock:transfer", { toWarehouseId: target, lines: payload, notes: notes.trim() || null });
      setLines([]);
      setNotes("");
      setVersion((value) => value + 1);
      setNotice({
        tone: "info",
        text: `${doc.number} yozildi${doc.toWarehouse ? ` → ${doc.toWarehouse.name}` : ""}${doc.value ? ` · ${fmtMoney(doc.value, baseCurrency)}` : ""}`,
      });
      onDone(doc);
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-0 grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-3 p-3">
      <ProductPicker onPick={add} refreshKey={version} />

      <section className="flex min-h-0 flex-col rounded-xl border border-border bg-card">
        {kind === "transfer" && (
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Label htmlFor="transfer-target" className="shrink-0">
              Qaysi omborga
            </Label>
            <select
              id="transfer-target"
              className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">— tanlang —</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name} ({warehouse.code})
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Mahsulot</th>
                <th className="px-3 py-2 text-right">Qoldiq</th>
                <th className="px-3 py-2 text-right">{kind === "writeoff" ? "Chiqariladi" : "Ko'chiriladi"}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const exceeds = QTY.test(line.quantity) && toMinor(line.quantity, 4) > toMinor(line.stock, 4);
                return (
                  <tr key={line.productId} className="border-t border-border">
                    <td className="px-3 py-1.5">
                      <p className="font-medium leading-tight">{line.name}</p>
                      <p className="text-xs text-muted-foreground">{line.sku}</p>
                    </td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${line.stock.startsWith("-") ? "text-destructive" : "text-muted-foreground"}`}>
                      {fmtQty(line.stock)} {line.unitName}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center justify-end gap-1">
                        <Input
                          id={`stock-doc-qty-${index}`}
                          className={`h-8 w-24 text-right ${exceeds ? "border-pos-warning" : ""}`}
                          inputMode="decimal"
                          value={line.quantity}
                          onChange={(e) => setQuantity(index, decimalInput(e.target.value, 4))}
                        />
                        <span className="w-8 text-xs text-muted-foreground">{line.unitName}</span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <button
                        type="button"
                        aria-label={`${line.name} qatorini o'chirish`}
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-12 text-center text-muted-foreground">
                    Mahsulotni chapdan tanlang yoki skanerlang
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="space-y-2 border-t border-border p-3">
          <div className="space-y-1">
            <Label htmlFor="stock-doc-notes">{kind === "writeoff" ? "Sabab (majburiy)" : "Izoh"}</Label>
            <Input
              id="stock-doc-notes"
              maxLength={500}
              placeholder={kind === "writeoff" ? "Masalan: muddati o'tgan, singan, yo'qolgan" : "Masalan: filialga jo'natildi, haydovchi"}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          {over.length > 0 && (
            <p className="rounded-lg bg-pos-warning/10 px-3 py-2 text-sm text-pos-warning">
              {over.length} ta mahsulot qoldiqdan ko'p — hujjat yoziladi, serverda nomuvofiqlik sifatida belgilanadi
            </p>
          )}
          {notice && (
            <p className={`rounded-lg px-3 py-2 text-sm ${notice.tone === "error" ? "bg-destructive/10 text-destructive" : "bg-pos-success/10 text-pos-success"}`}>{notice.text}</p>
          )}
          <Button className="h-12 w-full text-base font-bold" disabled={!ready || busy} onClick={() => void submit()}>
            {kind === "writeoff" ? "Hisobdan chiqarish" : "Ko'chirishni yozish (tovar jo'natildi)"}
          </Button>
        </div>
      </section>
    </div>
  );
}
