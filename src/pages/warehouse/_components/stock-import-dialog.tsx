import { useRef, useState } from "react";
import { toast } from "sonner";
import { FileSpreadsheet, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation } from "@/lib/query.ts";
import { buildTemplateXlsx, downloadBlob, parseXlsx } from "@/components/csv/xlsx.ts";
import { formatQty, toNumber } from "@/pages/products/_lib/types.ts";
import { STOCK_IMPORT_COLUMNS, mapHeaders, toRequestRows, type StockImportRequestRow, type StockImportResult } from "../_lib/stock-import.ts";

type Props = { warehouseId: string; warehouseName: string; onClose: () => void };

const money = (value: string | null) => (value === null ? "—" : new Intl.NumberFormat("uz-UZ").format(toNumber(value)));

/**
 * Excel'dan qoldiq kirimi: fayl → PREVIEW (serverda hisoblanadi, hech narsa yozilmaydi) → "Import qilish".
 * Xato qatori bo'lsa import tugmasi yopiq; server ham xato bilan kelgan so'rovni to'liq rad etadi.
 */
export default function StockImportDialog({ warehouseId, warehouseName, onClose }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<StockImportRequestRow[] | null>(null);
  const [preview, setPreview] = useState<StockImportResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  // Bir import — bitta kalit: ikki marta bosish yoki tarmoq qayta urinishi ikkinchi kirim yaratmaydi
  const [importId, setImportId] = useState(() => crypto.randomUUID());

  const apply = useApiMutation(
    () => api.post<StockImportResult>("/api/inventory/stock/import", { warehouseId, rows, importId }),
    { invalidate: ["/api/inventory"] },
  );

  const loadFile = async (file: File) => {
    setBusy(true);
    setPreview(null);
    try {
      const sheet = await parseXlsx(file);
      const mapping = mapHeaders(sheet.fields);
      if (!mapping.quantity) throw new Error("\"Miqdor\" ustuni topilmadi — shablonni yuklab oling");
      if (!mapping.sku && !mapping.barcode && !mapping.name) throw new Error("Mahsulot ustuni (SKU, shtrix-kod yoki nomi) topilmadi");
      const requestRows = toRequestRows(sheet.raw, mapping);
      if (requestRows.length === 0) throw new Error("Faylda qator yo'q");
      if (requestRows.length > 2000) throw new Error("Bir faylda ko'pi bilan 2000 qator");
      setFileName(file.name);
      setRows(requestRows);
      setImportId(crypto.randomUUID());
      setPreview(await api.post<StockImportResult>("/api/inventory/stock/import", { warehouseId, rows: requestRows, dryRun: true }));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const template = async () => {
    const blob = await buildTemplateXlsx(STOCK_IMPORT_COLUMNS.map((column) => ({ ...column, aliases: [column.label, ...column.aliases] })), "Qoldiq");
    downloadBlob(blob, "ombor-qoldigi-shablon.xlsx");
  };

  const submit = async () => {
    try {
      const result = await apply.mutateAsync();
      toast.success(result.duplicate ? "Bu import allaqachon qabul qilingan" : `${result.totals?.valid ?? 0} ta qator omborga kirim qilindi`);
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const totals = preview?.totals;
  const canApply = Boolean(preview && totals && totals.invalid === 0 && totals.valid > 0) && !apply.isPending;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl" data-testid="stock-import-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-green-600" /> Excel'dan qoldiq import — {warehouseName}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Ustunlar: SKU, shtrix-kod, mahsulot, birlik, miqdor (majburiy), ombor, tannarx, sotuv narxi. Mahsulot katalogda bo'lishi kerak;
            birlik mahsulotning konversiyasi bo'yicha asosiy birlikka o'tkaziladi (masalan, 10 blok × 6 = 60 dona). Sotuv narxi o'zgartirilmaydi.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".xlsx" className="hidden" data-testid="stock-import-file" onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void loadFile(file);
            }} />
            <Button size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4 mr-1.5" /> {busy ? "Tekshirilmoqda…" : "Excel faylni tanlash"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void template()}>Shablon</Button>
            {fileName && <span className="text-muted-foreground">{fileName}</span>}
          </div>

          {preview && totals && (
            <>
              <div className="flex flex-wrap gap-2" data-testid="stock-import-totals">
                <Badge variant="secondary">Qatorlar: {totals.rows}</Badge>
                <Badge className="bg-green-600">To'g'ri: {totals.valid}</Badge>
                {totals.invalid > 0 && <Badge variant="destructive" data-testid="stock-import-invalid">Xato: {totals.invalid}</Badge>}
                <Badge variant="outline">Mahsulot: {totals.products}</Badge>
                <Badge variant="outline" data-testid="stock-import-value">Qiymat: {money(totals.value)}</Badge>
              </div>
              <div className="max-h-[50vh] overflow-auto rounded-lg border">
                <table className="w-full text-xs" data-testid="stock-import-preview">
                  <thead className="sticky top-0 bg-muted">
                    <tr className="text-left">
                      <th className="p-2">Qator</th>
                      <th className="p-2">Mahsulot</th>
                      <th className="p-2 text-right">Excel</th>
                      <th className="p-2 text-right">Asosiy birlikda</th>
                      <th className="p-2 text-right">Tannarx (1 birlik)</th>
                      <th className="p-2 text-right">Qiymat</th>
                      <th className="p-2 text-right">Hozir → keyin</th>
                      <th className="p-2">Holat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.lines.map((line) => (
                      <tr key={line.row} className={line.errors.length > 0 ? "bg-destructive/10" : "border-t"} data-testid="stock-import-line">
                        <td className="p-2">{line.row}</td>
                        <td className="p-2">
                          <div className="font-medium">{line.name ?? "—"}</div>
                          <div className="text-muted-foreground">{[line.sku, line.barcode].filter(Boolean).join(" · ")}</div>
                        </td>
                        <td className="p-2 text-right">{line.quantity} {line.unit ?? ""}</td>
                        <td className="p-2 text-right font-medium" data-testid="stock-import-base-qty">
                          {line.errors.length === 0 ? `${formatQty(toNumber(line.baseQuantity))} ${line.baseUnit ?? ""}` : "—"}
                          {toNumber(line.factor) !== 1 && line.errors.length === 0 && <div className="text-muted-foreground">×{formatQty(toNumber(line.factor))}</div>}
                        </td>
                        <td className="p-2 text-right">{money(line.baseCostPrice)}</td>
                        <td className="p-2 text-right">{line.errors.length === 0 ? money(line.value) : "—"}</td>
                        <td className="p-2 text-right">{formatQty(toNumber(line.currentQuantity))} → {formatQty(toNumber(line.quantityAfter))}</td>
                        <td className="p-2">
                          {line.errors.map((error) => <div key={error} className="text-destructive">{error}</div>)}
                          {line.warnings.map((warning) => <div key={warning} className="text-amber-600">{warning}</div>)}
                          {line.errors.length === 0 && line.warnings.length === 0 && <span className="text-green-600">OK</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totals.invalid > 0 && <p className="text-destructive">Xato qatorlarni Excel'da tuzatib, faylni qayta tanlang — xato bo'lsa hech narsa yozilmaydi.</p>}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Yopish</Button>
          <Button disabled={!canApply} data-testid="stock-import-apply" onClick={() => void submit()}>
            {apply.isPending ? "Import qilinmoqda…" : `Import qilish${totals ? ` (${totals.valid})` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
