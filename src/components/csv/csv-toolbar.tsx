/**
 * Ro'yxatlar uchun umumiy CSV "Eksport" va "Import" tugmalari.
 *
 * Eksport — serverdan tayyor CSV (UTF-8 BOM bilan, Excel to'g'ri ochadi).
 *
 * Import ikki bosqichli:
 *   1) fayl brauzerda `papaparse` bilan o'qiladi, sarlavhalar `columns` bo'yicha moslanadi (o'zbekcha va inglizcha);
 *   2) qatorlar serverga **`dryRun: true`** bilan yuboriladi — server hech narsa yozmasdan har qatorni tekshiradi va
 *      xato, dublikat va ogohlantirishlarni qaytaradi (preview);
 *   3) foydalanuvchi "Importni boshlash" bosgandan keyingina xuddi shu qatorlar `dryRun: false` bilan yoziladi.
 * Ya'ni preview paytida bazaga biznes ma'lumot yozilmaydi.
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import Papa from "papaparse";
import { AlertTriangle, Copy, Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation } from "@/lib/query.ts";

/** Bir so'rovda yuboriladigan qator soni (server chegarasi — 500). */
const IMPORT_BATCH = 500;
/** Oynada ko'rsatiladigan muammolar soni (qolgani "va yana N ta" bo'lib chiqadi). */
const MAX_ISSUES_SHOWN = 50;

export type CsvColumn = {
  /** So'rov tanasidagi kalit (`name`, `phone` ...). */
  key: string;
  /** Fayldagi sarlavha variantlari — birinchi topilgani olinadi. */
  aliases: string[];
};

type ImportIssue = { row: number; key?: string | null; sku?: string | null; message: string };

type ImportOutcome = {
  created: number;
  valid?: number;
  errors: ImportIssue[];
  duplicates?: ImportIssue[];
  warnings?: ImportIssue[];
  dryRun?: boolean;
};

type Preview = {
  rows: Record<string, string>[];
  total: number;
  valid: number;
  errors: ImportIssue[];
  duplicates: ImportIssue[];
  warnings: ImportIssue[];
};

/** Fayldagi qator raqami: sarlavha 1-qator, ma'lumot 2-qatordan; `offset` — bo'lak boshlanishi. */
const fileLine = (offset: number, issue: ImportIssue) => offset + issue.row + 1;
const issueKey = (issue: ImportIssue) => issue.key ?? issue.sku ?? null;

function IssueTable({ title, tone, issues }: { title: string; tone: string; issues: ImportIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className={`text-xs font-semibold ${tone}`}>
        {title} — {issues.length} ta
      </p>
      <div className="max-h-40 overflow-y-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <tbody className="divide-y divide-border">
            {issues.slice(0, MAX_ISSUES_SHOWN).map((issue, index) => (
              <tr key={`${issue.row}-${index}`}>
                <td className="w-20 px-2 py-1 text-muted-foreground tabular-nums">{issue.row}-qator</td>
                <td className="w-28 truncate px-2 py-1 font-mono text-muted-foreground">{issueKey(issue) ?? ""}</td>
                <td className="px-2 py-1">{issue.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {issues.length > MAX_ISSUES_SHOWN && (
        <p className="text-[11px] text-muted-foreground">va yana {issues.length - MAX_ISSUES_SHOWN} ta</p>
      )}
    </div>
  );
}

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
  const [busy, setBusy] = useState<"export" | "preview" | "import" | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const importRows = useApiMutation(
    ({ rows, dryRun }: { rows: Record<string, string>[]; dryRun: boolean }) =>
      api.post<ImportOutcome>(importUrl, { rows, dryRun }),
    { invalidate },
  );

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

  /** Qatorlarni bo'laklab yuborish; natijalar yig'iladi (qator raqamlari fayl bo'yicha to'g'rilanadi). */
  const send = async (rows: Record<string, string>[], dryRun: boolean) => {
    const errors: ImportIssue[] = [];
    const duplicates: ImportIssue[] = [];
    const warnings: ImportIssue[] = [];
    let created = 0;
    let valid = 0;

    for (let offset = 0; offset < rows.length; offset += IMPORT_BATCH) {
      const result = await importRows.mutateAsync({ rows: rows.slice(offset, offset + IMPORT_BATCH), dryRun });
      created += result.created;
      valid += result.valid ?? result.created;
      for (const issue of result.errors) errors.push({ ...issue, row: fileLine(offset, issue) });
      for (const issue of result.duplicates ?? []) duplicates.push({ ...issue, row: fileLine(offset, issue) });
      for (const issue of result.warnings ?? []) warnings.push({ ...issue, row: fileLine(offset, issue) });
    }
    return { created, valid, errors, duplicates, warnings };
  };

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // bir xil faylni qayta tanlash mumkin bo'lsin
    if (!file) return;

    setBusy("preview");
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

          try {
            // 1-bosqich: faqat tekshirish — bazaga yozilmaydi
            const outcome = await send(rows, true);
            setPreview({ rows, total: rows.length, ...outcome });
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setBusy(null);
          }
        })();
      },
      error: () => {
        setBusy(null);
        toast.error("CSV faylni o'qib bo'lmadi");
      },
    });
  };

  /** 2-bosqich: foydalanuvchi tasdiqlagandan keyin yoziladi. */
  const handleCommit = async () => {
    if (!preview) return;
    setBusy("import");
    try {
      const outcome = await send(preview.rows, false);
      setPreview(null);
      if (outcome.created > 0) toast.success(`${outcome.created} ta qator import qilindi`);
      else toast.error("Hech qanday qator import qilinmadi");
      if (outcome.errors.length + outcome.duplicates.length > 0) {
        toast.error(`${outcome.errors.length + outcome.duplicates.length} ta qator o'tmadi`, {
          description: [...outcome.errors, ...outcome.duplicates]
            .slice(0, 3)
            .map((issue) => `${issue.row}-qator: ${issue.message}`)
            .join("; "),
          duration: 8000,
        });
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void handleExport()}>
        <Download className="h-3.5 w-3.5 mr-1" /> {busy === "export" ? "..." : exportLabel}
      </Button>
      {canImport && (
        <>
          <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5 mr-1" /> {busy === "preview" ? "Tekshirilmoqda..." : importLabel}
          </Button>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
        </>
      )}

      {preview && (
        <Dialog open onOpenChange={(open) => !open && setPreview(null)}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Importni tekshirish</DialogTitle>
              <DialogDescription>
                Bu bosqichda bazaga hech narsa yozilmagan. "Importni boshlash" bosilsa — faqat to'g'ri qatorlar yoziladi.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: "Jami qator", value: preview.total, tone: "" },
                  { label: "To'g'ri", value: preview.valid, tone: "text-emerald-600 dark:text-emerald-400" },
                  { label: "Xato", value: preview.errors.length, tone: "text-destructive" },
                  { label: "Dublikat", value: preview.duplicates.length, tone: "text-amber-600 dark:text-amber-400" },
                ].map((cell) => (
                  <div key={cell.label} className="rounded-lg border border-border p-2 text-center">
                    <p className="text-[11px] text-muted-foreground">{cell.label}</p>
                    <p className={`text-lg font-bold tabular-nums ${cell.tone}`}>{cell.value}</p>
                  </div>
                ))}
              </div>

              <IssueTable title="Xato qatorlar" tone="text-destructive" issues={preview.errors} />
              <IssueTable title="Dublikatlar (yozilmaydi)" tone="text-amber-600 dark:text-amber-400" issues={preview.duplicates} />
              <IssueTable title="Ogohlantirishlar" tone="text-muted-foreground" issues={preview.warnings} />

              {preview.valid === 0 && (
                <p className="flex items-center gap-1.5 text-xs text-destructive">
                  <AlertTriangle className="size-3.5" /> Yoziladigan to'g'ri qator yo'q
                </p>
              )}
              {preview.duplicates.length > 0 && (
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Copy className="size-3.5" /> Dublikat qatorlar mavjud yozuvni o'zgartirmaydi — ular o'tkazib yuboriladi
                </p>
              )}
            </div>

            <DialogFooter>
              <Button variant="secondary" onClick={() => setPreview(null)} disabled={busy === "import"}>
                Bekor
              </Button>
              <Button onClick={() => void handleCommit()} disabled={preview.valid === 0 || busy === "import"}>
                {busy === "import" ? "..." : `Importni boshlash (${preview.valid})`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
