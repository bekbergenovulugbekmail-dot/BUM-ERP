/**
 * Ro'yxatlar uchun umumiy CSV "Eksport" va "Import" tugmalari.
 *
 * Eksport — serverdan tayyor CSV (UTF-8 BOM bilan, Excel to'g'ri ochadi).
 *
 * "Shablon" — kutilayotgan sarlavhalar bilan CSV. Ustunlar ALOHIDA kataklarda ochilishi uchun ajratgich
 * nuqtali vergul (`;`) va UTF-8 BOM ishlatiladi (Excel'ning ruscha/o'zbekcha sozlamasi shuni kutadi).
 * Majburiy ustun sarlavhasida `*` turadi, ikkinchi qator esa `#` bilan boshlanadigan NAMUNA —
 * u import paytida o'tkazib yuboriladi, ya'ni o'chirish shart emas.
 *
 * Import uch bosqichli:
 *   1) fayl brauzerda `papaparse` bilan o'qiladi; sarlavhalar `columns` dagi nomlar bo'yicha avtomat moslanadi
 *      (o'zbekcha va inglizcha), so'ng foydalanuvchi har bir maydon uchun fayl ustunini O'ZI o'zgartira oladi;
 *   2) moslangan qatorlar serverga **`dryRun: true`** bilan yuboriladi — server hech narsa yozmasdan har qatorni
 *      tekshiradi va xato, dublikat va ogohlantirishlarni qaytaradi (preview);
 *   3) foydalanuvchi "Importni boshlash" bosgandan keyingina xuddi shu qatorlar `dryRun: false` bilan yoziladi.
 * Ya'ni moslash va preview paytida bazaga biznes ma'lumot yozilmaydi.
 *
 * "Tezda qo'shish" — fayl tayyorlamasdan, o'sha kataklarga yozib saqlash. Hujjatga xos maydonlar
 * (`shared: true` — ta'minotchi, sana, ombor) YUQORIDA bir marta kiritiladi va har bir qatorga
 * qo'shiladi; jadvalda faqat yozuvga (mahsulotga) tegishli kataklar qoladi. Har bir umumiy maydonni
 * "har qatorda" bilan jadvalga ko'chirish mumkin. Tekshiruv — import bilan bir xil endpoint.
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import Papa from "papaparse";
import { AlertTriangle, Copy, Download, FileDown, Maximize2, Minimize2, Plus, TableProperties, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation } from "@/lib/query.ts";

/** Bir so'rovda yuboriladigan qator soni (server chegarasi — 500). */
const IMPORT_BATCH = 500;
/** Oynada ko'rsatiladigan muammolar soni (qolgani "va yana N ta" bo'lib chiqadi). */
const MAX_ISSUES_SHOWN = 50;
/** Moslashda "bu maydon olinmasin" tanlovi (Radix Select bo'sh qiymatni qabul qilmaydi). */
const SKIP = "__skip__";

export type CsvColumn = {
  /** So'rov tanasidagi kalit (`name`, `phone` ...). */
  key: string;
  /** Fayldagi sarlavha variantlari — birinchi topilgani olinadi. */
  aliases: string[];
  /** Shablonda sarlavhaga `*` qo'yiladi (majburiylikni server tekshiradi). */
  required?: boolean;
  /** Shablondagi namuna qatorida shu katakda turadigan qiymat. */
  example?: string;
  /**
   * Hujjatga xos maydon: "Tezda qo'shish"da bir marta yuqorida kiritiladi va har bir qatorga qo'shiladi
   * (ta'minotchi, sana, ombor kabi). Kerak bo'lsa foydalanuvchi uni "har qatorda" ga o'tkaza oladi.
   */
  shared?: boolean;
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

/** Fayl o'qilgan, lekin hali serverga yuborilmagan holat: ustunlarni moslash bosqichi. */
type Mapping = {
  /** Fayldagi sarlavhalar. */
  fields: string[];
  /** Fayl qatorlari — sarlavha bo'yicha. */
  raw: Record<string, string>[];
  /** Maydon kaliti → fayl ustuni (yoki SKIP). */
  choice: Record<string, string>;
};

type Preview = {
  rows: Record<string, string>[];
  total: number;
  valid: number;
  errors: ImportIssue[];
  duplicates: ImportIssue[];
  warnings: ImportIssue[];
};

/** Bir saqlashdagi qatorlarni bitta hujjatga bog'laydigan tasodifiy kalit (komponentdan tashqarida — render toza). */
function newGroupKey(): string {
  return `quick-${crypto.randomUUID()}`;
}

/** Shablondagi izoh/namuna qatori — import qilinmaydi. */
const isExampleRow = (row: Record<string, string>, fields: string[]) =>
  (row[fields[0] ?? ""] ?? "").trim().startsWith("#");

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
  quickGroupField,
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
  /**
   * Hujjatli importlarda (xarid) qatorlarni BITTA hujjatga bog'laydigan maydon nomi.
   * "Tezda qo'shish"da bir saqlash = bir hujjat: barcha qatorlarga bir xil tasodifiy kalit qo'yiladi.
   */
  quickGroupField?: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"export" | "preview" | "import" | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  /** Preview'dan "Ustunlarni o'zgartirish" bilan qaytish uchun oxirgi moslama. */
  const [lastMapping, setLastMapping] = useState<Mapping | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  /** "Tezda qo'shish": fayl tayyorlamasdan, kataklarga yozib saqlash. */
  const [quickRows, setQuickRows] = useState<Record<string, string>[] | null>(null);
  /** Hujjatga xos maydonlar — bir marta kiritiladi va har qatorga qo'shiladi. */
  const [quickShared, setQuickShared] = useState<Record<string, string>>({});
  /** Foydalanuvchi umumiy maydonni qatorlarga ko'chirsa — shu ro'yxatga tushadi. */
  const [perRowKeys, setPerRowKeys] = useState<string[]>([]);
  /** Oyna butun ekranga yoyilganmi. */
  const [quickFull, setQuickFull] = useState(false);
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

  /**
   * Shablon: sarlavhalar + bitta namuna qatori. Har bir ustun Excel'da ALOHIDA katakda chiqishi uchun
   * ajratgich `;` (vergul emas) — vergulli fayl bitta katakka tushib qoladi.
   */
  const handleTemplate = () => {
    const header = columns.map((column) => `${column.aliases[0] ?? column.key}${column.required ? "*" : ""}`);
    // Namuna qatori `#` bilan boshlanadi — foydalanuvchi o'chirmasa ham import qilinmaydi
    const sample = columns.map((column, index) => (index === 0 ? `# ${column.example ?? ""}` : (column.example ?? "")));
    // UTF-8 BOM — Excel o'zbekcha harflarni to'g'ri ochadi
    const csv = "\uFEFF" + Papa.unparse([header, sample], { delimiter: ";" }) + "\r\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filename}-shablon.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("Shablon yuklab olindi");
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

  /** Fayl ustuni nomini maydon nomlari bilan solishtiradi (bo'shliq, registr va `*` ga befarq). */
  const norm = (value: string) => value.trim().replace(/\*+$/, "").trim().toLowerCase().replace(/\s+/g, " ");

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // bir xil faylni qayta tanlash mumkin bo'lsin
    if (!file) return;

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (parsed) => {
        const fields = (parsed.meta.fields ?? []).filter((field) => field.trim() !== "");
        // Shablondagi namuna qatori foydalanuvchida qolib ketsa ham import qilinmaydi
        const raw = parsed.data.filter((row) => !isExampleRow(row, fields));
        if (raw.length === 0 || fields.length === 0) {
          toast.error("Faylda qator topilmadi");
          return;
        }
        // Avtomat moslash: maydon nomlari (o'zbekcha/inglizcha) fayl sarlavhalari bilan solishtiriladi
        const byName = new Map(fields.map((field) => [norm(field), field]));
        const choice: Record<string, string> = {};
        for (const column of columns) {
          const hit = column.aliases.map((alias) => byName.get(norm(alias))).find(Boolean);
          choice[column.key] = hit ?? SKIP;
        }
        setMapping({ fields, raw, choice });
      },
      error: () => {
        toast.error("CSV faylni o'qib bo'lmadi");
      },
    });
  };

  /** Moslangan ustunlar bo'yicha qatorlarni yig'ib, serverda tekshiradi (bazaga yozilmaydi). */
  const runPreview = async (current: Mapping) => {
    const rows = current.raw.map((row) => {
      const mapped: Record<string, string> = {};
      for (const column of columns) {
        const field = current.choice[column.key];
        if (!field || field === SKIP) continue;
        const value = row[field]?.toString().trim();
        if (value) mapped[column.key] = value;
      }
      return mapped;
    });

    setBusy("preview");
    try {
      const outcome = await send(rows, true);
      setLastMapping(current);
      setMapping(null);
      setPreview({ rows, total: rows.length, ...outcome });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  /** 2-bosqich: foydalanuvchi tasdiqlagandan keyin yoziladi. */
  const handleCommit = async () => {
    if (!preview) return;
    setBusy("import");
    try {
      const outcome = await send(preview.rows, false);
      setPreview(null);
      setLastMapping(null);
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

  /** Bo'sh qator — barcha ustunlar bo'sh matn. */
  const emptyRow = () => Object.fromEntries(columns.map((column) => [column.key, ""])) as Record<string, string>;

  const label = (column: CsvColumn) => column.aliases[0] ?? column.key;
  /** Yuqorida bir marta kiritiladigan maydonlar (foydalanuvchi qatorlarga ko'chirmaganlari). */
  const sharedColumns = columns.filter((column) => column.shared && !perRowKeys.includes(column.key));
  /** Jadval ustunlari — mahsulotga (yozuvga) xos maydonlar. */
  const rowColumns = columns.filter((column) => !column.shared || perRowKeys.includes(column.key));

  const openQuick = () => {
    setQuickShared(Object.fromEntries(columns.filter((column) => column.shared).map((column) => [column.key, ""])));
    setPerRowKeys([]);
    setQuickFull(false);
    setQuickRows([emptyRow(), emptyRow(), emptyRow()]);
  };

  const closeQuick = () => {
    setQuickRows(null);
    setQuickShared({});
    setPerRowKeys([]);
  };

  /** Qatorda biror katak to'ldirilganmi (faqat jadval ustunlari bo'yicha). */
  const rowFilled = (row: Record<string, string>) => rowColumns.some((column) => (row[column.key] ?? "").trim() !== "");

  /**
   * Kataklarga yozilgan qatorlarni import endpointiga yuboradi (import bilan bir xil tekshiruv).
   * Umumiy maydonlar har bir qatorga qo'shiladi; `quickGroupField` berilgan bo'lsa barcha qatorlar
   * bitta hujjatga tushadi.
   */
  const handleQuickSave = async () => {
    if (!quickRows) return;
    const missingShared = sharedColumns.find((column) => column.required && !(quickShared[column.key] ?? "").trim());
    if (missingShared) {
      toast.error(`«${label(missingShared)}» to'ldirilmagan (umumiy maydon)`);
      return;
    }
    const sharedValues: Record<string, string> = {};
    for (const column of sharedColumns) {
      const value = (quickShared[column.key] ?? "").trim();
      if (value) sharedValues[column.key] = value;
    }

    const filled = quickRows.filter(rowFilled);
    if (filled.length === 0) {
      toast.error("Kamida bitta qatorni to'ldiring");
      return;
    }
    for (const [index, row] of filled.entries()) {
      const missing = rowColumns.find((column) => column.required && !(row[column.key] ?? "").trim());
      if (missing) {
        toast.error(`${index + 1}-qatorda «${label(missing)}» bo'sh`);
        return;
      }
    }

    // Bir saqlash = bir hujjat: qatorlarni bog'lash uchun tasodifiy kalit
    const groupKey = quickGroupField ? newGroupKey() : null;
    const payload = filled.map((row) => {
      const mapped: Record<string, string> = { ...sharedValues };
      for (const column of rowColumns) {
        const value = (row[column.key] ?? "").trim();
        if (value) mapped[column.key] = value;
      }
      if (quickGroupField && groupKey) mapped[quickGroupField] = groupKey;
      return mapped;
    });

    setBusy("import");
    try {
      const outcome = await send(payload, false);
      if (outcome.created > 0) {
        // Hujjatli bo'limda (xarid) `created` — hujjatlar soni, qatorlar esa uning ichida
        toast.success(
          quickGroupField ? `Hujjat qo'shildi (${payload.length} ta qator)` : `${outcome.created} ta qator qo'shildi`,
        );
        closeQuick();
      } else {
        toast.error("Hech narsa qo'shilmadi");
      }
      const failed = [...outcome.errors, ...outcome.duplicates];
      if (failed.length > 0) {
        toast.error(`${failed.length} ta qator o'tmadi`, {
          description: failed.slice(0, 3).map((issue) => `${issue.row}-qator: ${issue.message}`).join("; "),
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
      {/* Telefonda uchala tugma bitta qatorni bo'lib oladi, kompyuterda avvalgidek yonma-yon */}
      <div className="flex w-full items-center gap-2 sm:w-auto">
        <Button
          size="sm"
          variant="secondary"
          className="flex-1 sm:flex-none"
          disabled={busy !== null}
          onClick={() => void handleExport()}
        >
          <Download className="h-3.5 w-3.5 mr-1" /> {busy === "export" ? "..." : exportLabel}
        </Button>
        {canImport && (
          <>
            <Button
              size="sm"
              className="flex-1 sm:flex-none"
              data-testid="quick-add"
              disabled={busy !== null}
              onClick={openQuick}
            >
              <TableProperties className="h-3.5 w-3.5 mr-1" /> Tezda qo'shish
            </Button>
            <Button size="sm" variant="ghost" className="flex-1 sm:flex-none" data-testid="csv-template" onClick={handleTemplate}>
              <FileDown className="h-3.5 w-3.5 mr-1" /> Shablon
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="flex-1 sm:flex-none"
              data-testid="csv-import"
              disabled={busy !== null}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5 mr-1" /> {busy === "preview" ? "Tekshirilmoqda..." : importLabel}
            </Button>
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
          </>
        )}
      </div>

      {/* Tezda qo'shish: umumiy maydonlar bir marta yuqorida, yozuvga xos maydonlar jadvalda */}
      {quickRows && (
        <Dialog open onOpenChange={(open) => !open && busy === null && closeQuick()}>
          <DialogContent className={quickFull ? "sm:max-w-[98vw]" : "sm:max-w-5xl"}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                Tezda qo'shish
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  data-testid="quick-add-fullscreen"
                  aria-label={quickFull ? "Oynani kichraytirish" : "Butun ekranga yoyish"}
                  title={quickFull ? "Kichraytirish" : "Butun ekranga yoyish"}
                  onClick={() => setQuickFull((current) => !current)}
                >
                  {quickFull ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </Button>
              </DialogTitle>
              <DialogDescription>
                {sharedColumns.length > 0
                  ? "Umumiy ma'lumotlarni (ta'minotchi, sana kabi) bir marta yuqoriga yozing — jadvalda faqat mahsulotga tegishli kataklar qoladi."
                  : "Kataklarga to'ldiring va saqlang — fayl tayyorlash shart emas."}{" "}
                Tekshiruv importdagi bilan bir xil: xato qator qo'shilmaydi va sababi ko'rsatiladi. <b>*</b> — majburiy maydon.
              </DialogDescription>
            </DialogHeader>

            {sharedColumns.length > 0 && (
              <div className="rounded-xl border border-border bg-muted/30 p-3" data-testid="quick-add-shared">
                <p className="mb-2 text-xs font-semibold">Umumiy ma'lumotlar — bir marta kiritiladi</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {sharedColumns.map((column) => (
                    <div key={column.key} className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor={`quick-shared-${column.key}`} className="truncate text-xs">
                          {label(column)}
                          {column.required && <span className="text-destructive"> *</span>}
                        </Label>
                        <button
                          type="button"
                          className="shrink-0 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                          title="Bu maydonni har bir qatorda alohida to'ldirish"
                          onClick={() => setPerRowKeys((keys) => [...keys, column.key])}
                        >
                          har qatorda
                        </button>
                      </div>
                      <Input
                        id={`quick-shared-${column.key}`}
                        className="h-8 text-sm"
                        placeholder={column.example ?? ""}
                        value={quickShared[column.key] ?? ""}
                        onChange={(event) =>
                          setQuickShared((current) => ({ ...current, [column.key]: event.target.value }))
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className={`overflow-auto rounded-lg border border-border ${quickFull ? "max-h-[62vh]" : "max-h-[45vh]"}`}>
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                  <tr>
                    <th className="w-10 px-2 py-2 text-left text-xs text-muted-foreground">#</th>
                    {rowColumns.map((column) => (
                      <th key={column.key} className="px-2 py-2 text-left text-xs font-medium whitespace-nowrap">
                        {label(column)}
                        {column.required && <span className="text-destructive"> *</span>}
                        {column.shared && (
                          <button
                            type="button"
                            className="ml-1 text-[11px] font-normal text-muted-foreground underline-offset-2 hover:underline"
                            title="Yuqoridagi umumiy maydonga qaytarish"
                            onClick={() => setPerRowKeys((keys) => keys.filter((key) => key !== column.key))}
                          >
                            umumiy
                          </button>
                        )}
                      </th>
                    ))}
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {quickRows.map((row, index) => (
                    <tr key={index} className="border-t border-border">
                      <td className="px-2 py-1 text-xs text-muted-foreground">{index + 1}</td>
                      {rowColumns.map((column) => (
                        <td key={column.key} className="px-1 py-1">
                          <Input
                            className="h-8 min-w-32 text-sm"
                            value={row[column.key] ?? ""}
                            placeholder={column.example ?? ""}
                            onChange={(event) =>
                              setQuickRows((current) =>
                                (current ?? []).map((item, position) =>
                                  position === index ? { ...item, [column.key]: event.target.value } : item,
                                ),
                              )
                            }
                          />
                        </td>
                      ))}
                      <td className="px-1 py-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-destructive"
                          aria-label="Qatorni o'chirish"
                          onClick={() => setQuickRows((current) => (current ?? []).filter((_, position) => position !== index))}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-2">
              <Button size="sm" variant="secondary" onClick={() => setQuickRows((current) => [...(current ?? []), emptyRow()])}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Qator qo'shish
              </Button>
              <p className="text-xs text-muted-foreground">
                To'ldirilgan qatorlar: {quickRows.filter(rowFilled).length}
                {quickGroupField && sharedColumns.length > 0 && " — hammasi bitta hujjatga tushadi"}
              </p>
            </div>

            <DialogFooter>
              <Button variant="secondary" disabled={busy !== null} onClick={closeQuick}>
                Bekor
              </Button>
              <Button disabled={busy !== null} onClick={() => void handleQuickSave()}>
                {busy === "import" ? "Saqlanmoqda..." : "Saqlash"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {mapping && (
        <Dialog open onOpenChange={(open) => !open && setMapping(null)}>
          <DialogContent className="sm:max-w-xl" data-testid="csv-mapping">
            <DialogHeader>
              <DialogTitle>Ustunlarni moslash</DialogTitle>
              <DialogDescription>
                Fayl sarlavhalari avtomat topildi. Mos kelmagan bo'lsa — har bir maydon uchun fayl ustunini o'zingiz
                tanlang. Bu bosqichda bazaga hech narsa yozilmaydi.
              </DialogDescription>
              <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                Shablonda har bir ustun alohida katakda turadi (ajratgich — nuqtali vergul). Sarlavhadagi{" "}
                <b>*</b> — majburiy maydon. <b>#</b> bilan boshlangan namuna qatori import qilinmaydi.
              </p>
            </DialogHeader>

            <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
              {columns.map((column) => {
                const label = column.aliases[0] ?? column.key;
                const value = mapping.choice[column.key] ?? SKIP;
                return (
                  <div key={column.key} className="grid grid-cols-[1fr_1.2fr] items-center gap-3">
                    <div className="min-w-0">
                      <Label htmlFor={`csv-map-${column.key}`} className="truncate">{label}</Label>
                      <p className="truncate text-[11px] text-muted-foreground">
                        Qabul qilinadi: {column.aliases.join(", ")}
                      </p>
                    </div>
                    <Select
                      value={value}
                      onValueChange={(next) =>
                        setMapping((current) =>
                          current ? { ...current, choice: { ...current.choice, [column.key]: next } } : current,
                        )
                      }
                    >
                      <SelectTrigger className="w-full" id={`csv-map-${column.key}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value={SKIP}>— o'tkazib yuborish —</SelectItem>
                        {mapping.fields.map((field) => (
                          <SelectItem key={field} value={field}>{field}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>

            <p className="text-xs text-muted-foreground">
              Faylda {mapping.raw.length} ta qator, {mapping.fields.length} ta ustun topildi.
            </p>

            <DialogFooter>
              <Button variant="secondary" onClick={() => setMapping(null)} disabled={busy === "preview"}>
                Bekor
              </Button>
              <Button
                data-testid="csv-mapping-continue"
                onClick={() => { void runPreview(mapping); }}
                disabled={busy === "preview" || Object.values(mapping.choice).every((field) => field === SKIP)}
              >
                {busy === "preview" ? "Tekshirilmoqda..." : "Tekshirish"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
              {lastMapping && (
                <Button
                  variant="outline"
                  data-testid="csv-remap"
                  disabled={busy === "import"}
                  onClick={() => { setPreview(null); setMapping(lastMapping); }}
                >
                  Ustunlarni o'zgartirish
                </Button>
              )}
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
