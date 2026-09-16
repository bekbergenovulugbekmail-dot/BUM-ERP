/**
 * Ro'yxatlar uchun umumiy CSV "Eksport" va "Import" tugmalari (mahsulotlar sahifasidagi oqimning umumlashtirilgani).
 *
 * Eksport — serverdan tayyor CSV (UTF-8 BOM bilan, Excel to'g'ri ochadi). Import — fayl brauzerda `papaparse` bilan
 * o'qiladi, sarlavhalar `columns` dagi nomlar bo'yicha moslanadi (o'zbekcha va inglizcha sarlavha ham ishlaydi),
 * qatorlar bo'laklarga bo'lib serverga yuboriladi. Tekshiruv serverda: xato qatorlar `errors` bo'lib qaytadi va
 * foydalanuvchiga qator raqami bilan ko'rsatiladi — to'g'ri qatorlar yozilaveradi.
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import Papa from "papaparse";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation } from "@/lib/query.ts";

/** Bir so'rovda yuboriladigan qator soni (server chegarasi — 500). */
const IMPORT_BATCH = 200;

export type CsvColumn = {
  /** So'rov tanasidagi kalit (`name`, `phone` ...). */
  key: string;
  /** Fayldagi sarlavha variantlari — birinchi topilgani olinadi. */
  aliases: string[];
};

type ImportResult = {
  created: number;
  errors: { row: number; key?: string | null; sku?: string | null; message: string }[];
};

export default function CsvToolbar({
  exportUrl,
  exportParams,
  filename,
  importUrl,
  columns,
  invalidate,
  canImport,
  importLabel = "Import",
  exportLabel = "Eksport",
}: {
  exportUrl: string;
  exportParams?: Record<string, string | number | boolean | undefined>;
  /** Yuklab olinadigan fayl nomi (sanasiz — sana o'zi qo'shiladi). */
  filename: string;
  importUrl: string;
  columns: CsvColumn[];
  invalidate: string[];
  canImport: boolean;
  importLabel?: string;
  exportLabel?: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const importRows = useApiMutation((rows: Record<string, string>[]) => api.post<ImportResult>(importUrl, { rows }), {
    invalidate,
  });

  const handleExport = async () => {
    setBusy("export");
    try {
      const blob = await api.blob(exportUrl, exportParams);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success("Fayl yuklab olindi");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // bir xil faylni qayta tanlash mumkin bo'lsin
    if (!file) return;

    setBusy("import");
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (parsed) => {
        void (async () => {
          const pick = (row: Record<string, string>, aliases: string[]) => {
            for (const alias of aliases) {
              const value = row[alias]?.toString().trim();
              if (value) return value;
            }
            return undefined;
          };
          const rows = parsed.data.map((row) => {
            const mapped: Record<string, string> = {};
            for (const column of columns) {
              const value = pick(row, column.aliases);
              if (value !== undefined) mapped[column.key] = value;
            }
            return mapped;
          });

          if (rows.length === 0) {
            setBusy(null);
            toast.error("Faylda qator topilmadi");
            return;
          }

          let created = 0;
          const errors: string[] = [];
          try {
            for (let offset = 0; offset < rows.length; offset += IMPORT_BATCH) {
              const result = await importRows.mutateAsync(rows.slice(offset, offset + IMPORT_BATCH));
              created += result.created;
              for (const error of result.errors) {
                // Faylda: sarlavha 1-qator, ma'lumot 2-qatordan
                const line = offset + error.row + 1;
                const key = error.key ?? error.sku;
                errors.push(`${line}-qator${key ? ` (${key})` : ""}: ${error.message}`);
              }
            }
          } catch (err) {
            errors.push(errorMessage(err));
          }

          setBusy(null);
          if (created > 0) toast.success(`${created} ta qator import qilindi`);
          if (errors.length > 0) {
            toast.error(`${errors.length} ta qator o'tmadi`, { description: errors.slice(0, 3).join("; "), duration: 8000 });
          }
        })();
      },
      error: () => {
        setBusy(null);
        toast.error("CSV faylni o'qib bo'lmadi");
      },
    });
  };

  return (
    <>
      <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void handleExport()}>
        <Download className="h-3.5 w-3.5 mr-1" /> {busy === "export" ? "..." : exportLabel}
      </Button>
      {canImport && (
        <>
          <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5 mr-1" /> {busy === "import" ? "..." : importLabel}
          </Button>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
        </>
      )}
    </>
  );
}
