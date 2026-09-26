import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { exportColumns } from "../_lib/stock-export.ts";

const STORAGE_KEY = "bum:stock-export-columns";

/** Oldingi tanlov (shu qurilmada); yo'q bo'lsa — hammasi. */
function savedExportColumns(): string[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const value = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
  } catch {
    return null;
  }
}

function saveExportColumns(keys: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // saqlab bo'lmasa — keyingi safar hammasi belgilangan bo'ladi
  }
}

/**
 * "Ombordagi miqdori bilan eksport": qaysi ustunlar Excel'ga chiqishini tanlash. Tanlov shu qurilmada eslab qolinadi.
 * Tannarx faqat ruxsat bo'lsa ro'yxatda (ruxsatsiz server uni umuman bermaydi).
 */
export default function ExportColumnsDialog({
  costVisible,
  busy,
  onExport,
  onClose,
}: {
  costVisible: boolean;
  busy: boolean;
  onExport: (columns: string[]) => void;
  onClose: () => void;
}) {
  const columns = exportColumns("quantities", costVisible);
  const [selected, setSelected] = useState<string[]>(() => {
    const saved = savedExportColumns()?.filter((key) => columns.some((column) => column.key === key));
    return saved && saved.length > 0 ? saved : columns.map((column) => column.key);
  });
  const toggle = (key: string, on: boolean) =>
    setSelected((current) => (on ? columns.map((column) => column.key).filter((item) => item === key || current.includes(item)) : current.filter((item) => item !== key)));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md" data-testid="export-columns-dialog">
        <DialogHeader>
          <DialogTitle>Excel'ga chiqadigan ustunlar</DialogTitle>
          <DialogDescription>Keraklisini belgilang — keraksizi chiqmaydi. Tanlov shu qurilmada eslab qolinadi.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setSelected(columns.map((column) => column.key))}>
            Hammasi
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSelected([])}>
            Tozalash
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {columns.map((column) => (
            <label key={column.key} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent" data-testid={`export-column-${column.key}`}>
              <Checkbox checked={selected.includes(column.key)} onCheckedChange={(value) => toggle(column.key, value === true)} />
              {column.header}
            </label>
          ))}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="secondary" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button
            disabled={busy || selected.length === 0}
            data-testid="export-columns-confirm"
            onClick={() => {
              saveExportColumns(selected);
              onExport(selected);
            }}
          >
            <FileSpreadsheet className="mr-1.5 h-4 w-4" /> {busy ? "Tayyorlanmoqda…" : `Eksport (${selected.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
