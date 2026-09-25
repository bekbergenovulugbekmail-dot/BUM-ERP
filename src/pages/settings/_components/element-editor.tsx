/**
 * Tanlangan element sozlamalari — dizaynerning o'ng ustuni.
 *
 * Bu yerda faqat KO'RINISH boshqariladi: chiziq, rang, kenglik, tekislash. Summalar va
 * miqdorlar hujjatdan keladi, shablon ularga tegmaydi (server ham shablonni oq ro'yxat
 * bo'yicha qayta quradi).
 */
import { useRef } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ImageUp, Trash2 } from "lucide-react";
import {
  BORDER_STYLES, IMAGE_FITS, QR_LEVELS, QR_SOURCES, VALIGNMENTS,
  type BoxStyle, type DocumentElement, type TableStyle,
} from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { errorMessage } from "@/lib/api.ts";
import { boxOf } from "@/lib/pdf/template-free.ts";
import { ELEMENT_LABELS, GROUP_LABELS, type ColumnRow, type FieldCatalog } from "../_lib/document-designer.ts";

const BORDER_STYLE_LABELS: Record<string, string> = {
  solid: "To'liq", dashed: "Uzuq", dotted: "Nuqtali", double: "Qo'sh",
};
const VALIGN_LABELS: Record<string, string> = { top: "Yuqorida", middle: "O'rtada", bottom: "Pastda" };
const ALIGN_LABELS: Record<string, string> = { left: "Chapga", center: "Markazga", right: "O'ngga" };
const QR_SOURCE_LABELS: Record<string, string> = {
  documentNumber: "Hujjat raqami", orderNumber: "Buyurtma raqami", customerPhone: "Mijoz telefoni",
};
const FIT_LABELS: Record<string, string> = { contain: "Sig'diriladi (nisbat saqlanadi)", fill: "Cho'ziladi" };

/** Bitta son maydoni — bo'sh qoldirilsa standart qiymat ishlatiladi. */
function Num({
  label, value, onChange, min = 0, max = 400, step = 0.5, placeholder, disabled, testId,
}: {
  label: string; value: number | undefined; onChange: (value: number | undefined) => void;
  min?: number; max?: number; step?: number; placeholder?: string; disabled?: boolean; testId?: string;
}) {
  return (
    <div className="min-w-0 flex-1">
      <Label className="text-[11px]">{label}</Label>
      <Input
        type="number" className="h-8 text-xs" min={min} max={max} step={step} disabled={disabled}
        placeholder={placeholder} data-testid={testId}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Math.min(max, Math.max(min, e.target.valueAsNumber)))}
      />
    </div>
  );
}

function Pick<T extends string>({
  label, value, options, labels, onChange, disabled, testId,
}: {
  label: string; value: T | undefined; options: readonly T[]; labels: Record<string, string>;
  onChange: (value: T) => void; disabled?: boolean; testId?: string;
}) {
  return (
    <div className="min-w-0 flex-1">
      <Label className="text-[11px]">{label}</Label>
      <Select value={value ?? ""} disabled={disabled} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger className="h-8 text-xs" data-testid={testId}><SelectValue placeholder="Standart" /></SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>{labels[option] ?? option}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Toggle({
  label, checked, onChange, disabled, testId,
}: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; testId?: string }) {
  return (
    <label className="flex items-center gap-1.5 text-xs">
      <Checkbox checked={checked} disabled={disabled} data-testid={testId}
        onCheckedChange={(value) => onChange(value === true)} />
      {label}
    </label>
  );
}

function Color({
  label, value, fallback, onChange, disabled,
}: { label: string; value: string | undefined; fallback: string; onChange: (value: string) => void; disabled?: boolean }) {
  return (
    <div className="min-w-0 flex-1">
      <Label className="text-[11px]">{label}</Label>
      <Input type="color" className="h-8 w-full p-1" disabled={disabled}
        value={value ?? fallback} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** Ramka sozlamalari — rasm, chiziq va to'rtburchak uchun umumiy. */
function BoxEditor({
  box, onChange, disabled, withFill,
}: { box: BoxStyle | undefined; onChange: (patch: BoxStyle) => void; disabled: boolean; withFill: boolean }) {
  const patch = (next: Partial<BoxStyle>) => onChange({ ...box, ...next });
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Pick label="Chiziq turi" value={box?.borderStyle} options={BORDER_STYLES} labels={BORDER_STYLE_LABELS}
          disabled={disabled} onChange={(value) => patch({ borderStyle: value })} testId="box-border-style" />
        <Num label="Qalinlik (mm)" value={box?.borderWidth} min={0} max={3} step={0.1} placeholder="0.2"
          disabled={disabled} onChange={(value) => patch({ borderWidth: value })} testId="box-border-width" />
      </div>
      <div className="flex gap-2">
        <Color label="Chiziq rangi" value={box?.borderColor} fallback="#dcdceb" disabled={disabled}
          onChange={(value) => patch({ borderColor: value })} />
        {withFill && (
          <Color label="Fon" value={box?.fill} fallback="#ffffff" disabled={disabled}
            onChange={(value) => patch({ fill: value })} />
        )}
      </div>
      {withFill && (
        <Num label="Burchak radiusi (mm)" value={box?.radius} min={0} max={20} step={0.5} placeholder="0"
          disabled={disabled} onChange={(value) => patch({ radius: value })} />
      )}
    </div>
  );
}

/**
 * Jadval chiziqlari — HAR TOMON ALOHIDA.
 *
 * "Tashqi ramka" to'rt tomonni birdan yoqadi; kerak bo'lsa har tomonni alohida o'chirish mumkin.
 * Belgilanmagan qiymat = hozirgi standart ko'rinish, shuning uchun eski shablon o'zgarmaydi.
 */
function TableEditor({
  element, columns, onChange, disabled,
}: {
  element: DocumentElement;
  columns: ColumnRow[];
  onChange: (patch: Partial<DocumentElement>) => void;
  disabled: boolean;
}) {
  const table: TableStyle = element.table ?? {};
  const patch = (next: Partial<TableStyle>) => onChange({ table: { ...table, ...next } });
  const selected = element.columns ?? [];
  const outer = table.outer ?? true;

  const setColumns = (next: NonNullable<DocumentElement["columns"]>) => onChange({ columns: next });
  const patchColumn = (key: string, next: Partial<NonNullable<DocumentElement["columns"]>[number]>) =>
    setColumns(selected.map((column) => (column.key === key ? { ...column, ...next } : column)));
  const moveColumn = (key: string, direction: -1 | 1) => {
    const index = selected.findIndex((column) => column.key === key);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= selected.length) return;
    const next = [...selected];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item!);
    setColumns(next);
  };
  const toggleColumn = (key: string, checked: boolean) =>
    setColumns(checked ? [...selected, { key }] : selected.filter((column) => column.key !== key));

  const unused = columns.filter((column) => !selected.some((item) => item.key === column.key));

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-[11px]">Ustunlar — tartibi va kengligi</Label>
        <div className="mt-1 space-y-1.5">
          {selected.map((column, index) => (
            <div key={column.key} className="rounded-lg border border-border p-1.5" data-testid={`column-${column.key}`}>
              <div className="flex items-center gap-1">
                <span className="flex-1 truncate text-xs">
                  {columns.find((item) => item.key === column.key)?.label ?? column.key}
                </span>
                <button type="button" aria-label="Yuqoriga" disabled={disabled || index === 0}
                  onClick={() => moveColumn(column.key, -1)}><ArrowUp className="h-3 w-3" /></button>
                <button type="button" aria-label="Pastga" disabled={disabled || index === selected.length - 1}
                  onClick={() => moveColumn(column.key, 1)}><ArrowDown className="h-3 w-3" /></button>
                <button type="button" aria-label="Ustunni olib tashlash" disabled={disabled}
                  data-testid={`column-remove-${column.key}`}
                  onClick={() => toggleColumn(column.key, false)}><Trash2 className="h-3 w-3 text-destructive" /></button>
              </div>
              <div className="mt-1 flex gap-1.5">
                <Input className="h-7 min-w-0 flex-1 text-[11px]" disabled={disabled} placeholder="Nomi"
                  data-testid={`column-label-${column.key}`}
                  value={column.label ?? ""}
                  onChange={(e) => patchColumn(column.key, { label: e.target.value || undefined })} />
                <Input type="number" className="h-7 w-16 text-[11px]" min={5} max={180} step={1} placeholder="auto"
                  disabled={disabled} data-testid={`column-width-${column.key}`}
                  value={column.width ?? ""}
                  onChange={(e) => patchColumn(column.key, { width: e.target.value === "" ? undefined : e.target.valueAsNumber })} />
                <Select value={column.align ?? "left"} disabled={disabled}
                  onValueChange={(value) => patchColumn(column.key, { align: value as "left" | "center" | "right" })}>
                  <SelectTrigger className="h-7 w-20 text-[11px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(["left", "center", "right"] as const).map((value) => (
                      <SelectItem key={value} value={value}>{ALIGN_LABELS[value]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))}
        </div>
        {unused.length > 0 && (
          <div className="mt-2">
            <p className="text-[10px] text-muted-foreground">Qo'shish uchun bosing</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {unused.map((column) => (
                <button key={column.key} type="button" disabled={disabled}
                  data-testid={`column-add-${column.key}`}
                  className="rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-accent"
                  onClick={() => toggleColumn(column.key, true)}>+ {column.label}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      <Separator />
      <p className="text-[11px] font-semibold">Jadval chiziqlari</p>
      <div className="flex gap-2">
        <Pick label="Chiziq turi" value={table.borderStyle} options={BORDER_STYLES} labels={BORDER_STYLE_LABELS}
          disabled={disabled} onChange={(value) => patch({ borderStyle: value })} testId="table-border-style" />
        <Num label="Qalinlik (mm)" value={table.borderWidth} min={0} max={3} step={0.1} placeholder="0.2"
          disabled={disabled} onChange={(value) => patch({ borderWidth: value })} testId="table-border-width" />
      </div>
      <div className="grid grid-cols-2 gap-1">
        <Toggle label="Tashqi ramka" checked={outer} disabled={disabled} testId="table-outer"
          onChange={(value) => patch({ outer: value, top: value, bottom: value, left: value, right: value })} />
        <Toggle label="Gorizontal" checked={table.horizontal ?? true} disabled={disabled} testId="table-horizontal"
          onChange={(value) => patch({ horizontal: value })} />
        <Toggle label="Vertikal" checked={table.vertical ?? true} disabled={disabled} testId="table-vertical"
          onChange={(value) => patch({ vertical: value })} />
        <Toggle label="Sarlavha chizig'i" checked={table.headerBorder ?? true} disabled={disabled} testId="table-header-border"
          onChange={(value) => patch({ headerBorder: value })} />
        <Toggle label="Yuqori" checked={table.top ?? outer} disabled={disabled} testId="table-top"
          onChange={(value) => patch({ top: value })} />
        <Toggle label="Past" checked={table.bottom ?? outer} disabled={disabled} testId="table-bottom"
          onChange={(value) => patch({ bottom: value })} />
        <Toggle label="Chap" checked={table.left ?? outer} disabled={disabled} testId="table-left"
          onChange={(value) => patch({ left: value })} />
        <Toggle label="O'ng" checked={table.right ?? outer} disabled={disabled} testId="table-right"
          onChange={(value) => patch({ right: value })} />
      </div>
      <Color label="Chiziq rangi" value={table.borderColor} fallback="#dcdceb" disabled={disabled}
        onChange={(value) => patch({ borderColor: value })} />

      <Separator />
      <p className="text-[11px] font-semibold">Kataklar</p>
      <div className="flex gap-2">
        <Num label="Bo'shliq X (mm)" value={table.paddingX} min={0} max={10} step={0.2} placeholder="1.8"
          disabled={disabled} onChange={(value) => patch({ paddingX: value })} testId="table-padding-x" />
        <Num label="Bo'shliq Y (mm)" value={table.paddingY} min={0} max={10} step={0.2} placeholder="1.8"
          disabled={disabled} onChange={(value) => patch({ paddingY: value })} testId="table-padding-y" />
      </div>
      <div className="flex gap-2">
        <Num label="Qator balandligi" value={table.rowHeight} min={0} max={40} step={0.5} placeholder="auto"
          disabled={disabled} onChange={(value) => patch({ rowHeight: value })} testId="table-row-height" />
        <Num label="Shrift (pt)" value={table.fontSize} min={5} max={20} step={0.5} placeholder="8.5"
          disabled={disabled} onChange={(value) => patch({ fontSize: value })} testId="table-font-size" />
      </div>
      <div className="flex gap-2">
        <Pick label="Vertikal tekislash" value={table.valign} options={VALIGNMENTS} labels={VALIGN_LABELS}
          disabled={disabled} onChange={(value) => patch({ valign: value })} />
        <div className="flex flex-1 items-end pb-1.5">
          <Toggle label="Navbatma-navbat fon" checked={table.zebra ?? true} disabled={disabled}
            onChange={(value) => patch({ zebra: value })} testId="table-zebra" />
        </div>
      </div>
      <div className="flex gap-2">
        <Color label="Sarlavha foni" value={table.headerFill} fallback="#1e2850" disabled={disabled}
          onChange={(value) => patch({ headerFill: value })} />
        <Color label="Sarlavha matni" value={table.headerText} fallback="#ffffff" disabled={disabled}
          onChange={(value) => patch({ headerText: value })} />
      </div>
    </div>
  );
}

/**
 * ANIQ JOYLASHUV — sichqonchaga qo'shimcha. Asosiy usul varaqda surish va burchakdan tortish;
 * bu maydonlar esa millimetr aniqligida qo'yish uchun (masalan, ikki elementni bir chiziqqa).
 */
function GeometryEditor({
  element, onChange, disabled,
}: { element: DocumentElement; onChange: (patch: Partial<DocumentElement>) => void; disabled: boolean }) {
  const box = boxOf(element);
  const ratio = box.h > 0 ? box.w / box.h : 1;
  const locked = element.type === "qr" || (element.type === "image" && element.lockRatio !== false);
  return (
    <div className="space-y-2" data-testid="geometry-editor">
      <p className="text-[11px] font-semibold">Joylashuv (mm)</p>
      <div className="flex gap-2">
        <Num label="X" value={box.x} min={0} max={420} step={0.5} disabled={disabled} testId="geom-x"
          onChange={(value) => onChange({ x: value ?? 0 })} />
        <Num label="Y" value={box.y} min={0} max={420} step={0.5} disabled={disabled} testId="geom-y"
          onChange={(value) => onChange({ y: value ?? 0 })} />
      </div>
      <div className="flex gap-2">
        <Num label="Eni" value={box.w} min={1} max={420} step={0.5} disabled={disabled} testId="geom-w"
          onChange={(value) => value && onChange(locked ? { width: value, height: Math.round((value / ratio) * 10) / 10 } : { width: value })} />
        <Num label="Bo'yi" value={box.h} min={1} max={420} step={0.5} disabled={disabled} testId="geom-h"
          onChange={(value) => value && onChange(locked ? { height: value, width: Math.round(value * ratio * 10) / 10 } : { height: value })} />
      </div>
      {element.type === "image" && (
        <Toggle label="Nisbatni saqlash (burchakdan tortganda cho'zilmaydi)" checked={element.lockRatio !== false} disabled={disabled}
          testId="image-lock-ratio" onChange={(value) => onChange({ lockRatio: value })} />
      )}
    </div>
  );
}

/**
 * Rasmni shablonga sig'adigan holga keltiradi: kengligi 384 px gacha kichraytiriladi va
 * data URL bo'lib saqlanadi. Server ham aynan shu formatni kutadi (tashqi URL emas —
 * hujjat chiqarilganda begona manzilga so'rov ketmasin).
 */
async function imageToDataUrl(file: Blob, maxLength: number): Promise<{ dataUrl: string; ratio: number }> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("PNG, JPEG yoki WebP rasm tanlang");
  const bitmap = await createImageBitmap(file);
  const ratio = bitmap.height / bitmap.width;
  const scale = Math.min(1, 384 / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Rasmni o'qib bo'lmadi");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let dataUrl = canvas.toDataURL("image/png");
  if (dataUrl.length > maxLength) dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  if (dataUrl.length > maxLength) throw new Error("Rasm juda katta — kichikroq fayl tanlang");
  return { dataUrl, ratio };
}

function ImageEditor({
  element, onChange, disabled, maxLength, companyLogoUrl,
}: {
  element: DocumentElement;
  onChange: (patch: Partial<DocumentElement>) => void;
  disabled: boolean;
  maxLength: number;
  /** Kompaniya sozlamalarida saqlangan logotip havolasi (bo'lsa). */
  companyLogoUrl?: string | null;
}) {
  const input = useRef<HTMLInputElement>(null);

  /** Yangi rasm — qutining eni saqlanadi, bo'yi rasm nisbatidan (logotip cho'zilmasin). */
  const apply = (dataUrl: string, aspect: number) => {
    const width = element.width ?? 40;
    onChange({ imageData: dataUrl, width, height: Math.round(width * aspect * 10) / 10 });
    toast.success("Rasm qo'shildi");
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { dataUrl, ratio: next } = await imageToDataUrl(file, maxLength);
      apply(dataUrl, next);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  /**
   * Kompaniya sozlamalaridagi logotip — TASHQI HAVOLA bo'lgani uchun PDF ichiga to'g'ridan-to'g'ri
   * qo'yib bo'lmaydi (hujjat chiqarilganda begona manzilga so'rov ketardi). Shuning uchun rasm
   * brauzerda yuklab olinib, shablon ichiga data URL bo'lib ko'chiriladi. Tashqi sayt ruxsat
   * bermasa (CORS) — foydalanuvchiga aniq aytamiz, jimgina ishlamay qolmasin.
   */
  const takeCompanyLogo = async () => {
    if (!companyLogoUrl) return;
    try {
      const response = await fetch(companyLogoUrl, { mode: "cors" });
      if (!response.ok) throw new Error(`Logotip yuklanmadi (${response.status})`);
      const { dataUrl, ratio: next } = await imageToDataUrl(await response.blob(), maxLength);
      apply(dataUrl, next);
    } catch {
      toast.error("Kompaniya logotipini olib bo'lmadi — faylni qurilmangizdan yuklang");
    }
  };

  return (
    <div className="space-y-2">
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
        data-testid="image-file"
        onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
      {element.imageData ? (
        <div className="flex items-center gap-2">
          <img src={element.imageData} alt="Tanlangan rasm" className="h-12 w-12 rounded border border-border object-contain" />
          <Button size="sm" variant="secondary" disabled={disabled} onClick={() => input.current?.click()}>
            <ImageUp className="mr-1.5 h-3.5 w-3.5" /> Almashtirish
          </Button>
          <Button size="sm" variant="ghost" disabled={disabled} aria-label="Rasmni o'chirish"
            onClick={() => onChange({ imageData: undefined })}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="secondary" disabled={disabled} className="w-full"
          data-testid="image-upload" onClick={() => input.current?.click()}>
          <ImageUp className="mr-1.5 h-3.5 w-3.5" /> Rasm yuklash (PNG, JPEG, WebP)
        </Button>
      )}
      {companyLogoUrl && (
        <Button size="sm" variant="ghost" disabled={disabled} className="w-full"
          data-testid="image-company-logo" onClick={() => void takeCompanyLogo()}>
          Kompaniya logotipini olish
        </Button>
      )}
      <Pick label="Katakka joylashuvi" value={element.fit} options={IMAGE_FITS} labels={FIT_LABELS}
        disabled={disabled} onChange={(value) => onChange({ fit: value })} />
      <BoxEditor box={element.box} disabled={disabled} withFill onChange={(box) => onChange({ box })} />
    </div>
  );
}

export default function ElementEditor({
  element, catalog, disabled, maxImageLength, companyLogoUrl, onChange,
}: {
  element: DocumentElement;
  catalog: FieldCatalog | undefined;
  disabled: boolean;
  maxImageLength: number;
  companyLogoUrl?: string | null;
  onChange: (patch: Partial<DocumentElement>) => void;
}) {
  const grouped = (() => {
    const map = new Map<string, FieldCatalog["fields"]>();
    for (const field of catalog?.fields ?? []) {
      const list = map.get(field.group) ?? [];
      list.push(field);
      map.set(field.group, list);
    }
    return [...map.entries()];
  })();

  const toggleRow = (row: string, checked: boolean) => {
    const rows = element.rows ?? [];
    onChange({ rows: checked ? [...rows, row] : rows.filter((item) => item !== row) });
  };

  const hasText = element.type === "text" || element.type === "field";
  const sized = ["text", "field", "pageNumber", "rect", "qr", "barcode", "signatures", "totals", "payments"].includes(element.type);
  // Erkin joylashuvda joy — `x/y`; tekislash faqat matnning O'Z qutisi ichida
  const aligned = ["text", "field", "pageNumber"].includes(element.type);

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold" data-testid="element-editor-title">{ELEMENT_LABELS[element.type]}</p>

      <GeometryEditor element={element} disabled={disabled} onChange={onChange} />
      <Separator />

      {(hasText || element.type === "signatures" || element.type === "qr"
        || element.type === "barcode" || element.type === "rect") && (
        <div>
          <Label className="text-[11px]">
            {element.type === "signatures" ? "Imzo yorliqlari (| bilan ajratiladi)"
              : element.type === "qr" || element.type === "barcode" ? "Kod ostidagi yozuv (ixtiyoriy)"
                : "Matn / yorliq"}
          </Label>
          <Input className="h-8 text-xs" disabled={disabled} value={element.label ?? ""} data-testid="element-label"
            onChange={(e) => onChange({ label: e.target.value })} />
        </div>
      )}

      {element.type === "field" && (
        <div>
          <Label className="text-[11px]">Qiymat</Label>
          <Select value={element.field ?? ""} disabled={disabled} onValueChange={(value) => onChange({ field: value })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Maydon" /></SelectTrigger>
            <SelectContent>
              {grouped.map(([group, fields]) => (
                <div key={group}>
                  <p className="px-2 py-1 text-[10px] font-semibold text-muted-foreground">{GROUP_LABELS[group] ?? group}</p>
                  {fields.map((field) => (
                    <SelectItem key={field.path} value={field.path}>{field.label}</SelectItem>
                  ))}
                </div>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {element.type === "itemsTable" && (
        <TableEditor element={element} columns={catalog?.columns ?? []} disabled={disabled} onChange={onChange} />
      )}

      {element.type === "image" && (
        <ImageEditor element={element} disabled={disabled} maxLength={maxImageLength}
          companyLogoUrl={companyLogoUrl} onChange={onChange} />
      )}

      {(element.type === "qr" || element.type === "barcode") && (
        <div className="space-y-2">
          <Pick label="Nima kodlanadi" value={element.qrSource} options={QR_SOURCES} labels={QR_SOURCE_LABELS}
            disabled={disabled} onChange={(value) => onChange({ qrSource: value })} testId="qr-source" />
          {element.type === "qr" && (
            <div className="flex gap-2">
              <Pick label="Xatolikka chidamlilik" value={element.qrLevel} options={QR_LEVELS}
                labels={{ L: "L — 7%", M: "M — 15%", Q: "Q — 25%", H: "H — 30%" }}
                disabled={disabled} onChange={(value) => onChange({ qrLevel: value })} testId="qr-level" />
              <Num label="Chekka (modul)" value={element.qrMargin} min={0} max={8} step={1} placeholder="0"
                disabled={disabled} onChange={(value) => onChange({ qrMargin: value })} />
            </div>
          )}
          <p className="rounded-lg bg-muted/50 p-2 text-[10px] text-muted-foreground">
            Kod ichiga faqat shu ro'yxatdagi qiymat tushadi. Ixtiyoriy havola yoki matn yozib bo'lmaydi —
            skanerlanganda begona manzilga olib bormaydi.
          </p>
        </div>
      )}

      {(element.type === "line" || element.type === "rect") && (
        <div className="space-y-2">
          <BoxEditor box={element.box} disabled={disabled} withFill={element.type === "rect"}
            onChange={(box) => onChange({ box })} />
        </div>
      )}


      {(element.type === "totals" || element.type === "payments") && (
        <div>
          <Label className="text-[11px]">Qatorlar</Label>
          <div className="mt-1 space-y-1">
            {((element.type === "totals" ? catalog?.totalRows : catalog?.paymentRows) ?? []).map((row) => (
              <Toggle key={row} label={row} disabled={disabled}
                checked={(element.rows ?? []).includes(row)}
                onChange={(value) => toggleRow(row, value)} />
            ))}
          </div>
        </div>
      )}

      {(sized || aligned) && (
        <div className="space-y-2">
          <Separator />
          {sized && (
            <div className="flex items-end gap-2">
              <Num label="Shrift (pt)" value={element.style?.fontSize} min={5} max={48} step={0.5} placeholder="10"
                disabled={disabled} testId="font-size"
                onChange={(value) => onChange({ style: { ...element.style, fontSize: value } })} />
              <label className="flex items-center gap-1.5 pb-1.5 text-xs">
                <Checkbox checked={element.style?.bold === true} disabled={disabled}
                  onCheckedChange={(value) => onChange({ style: { ...element.style, bold: value === true } })} />
                Qalin
              </label>
              {hasText && (
                <label className="flex items-center gap-1.5 pb-1.5 text-xs">
                  <Checkbox checked={element.style?.italic === true} disabled={disabled}
                    onCheckedChange={(value) => onChange({ style: { ...element.style, italic: value === true } })} />
                  Qiya
                </label>
              )}
            </div>
          )}
          {aligned && (
            <div className="flex gap-2">
              <Pick label="Qutida tekislash" value={element.style?.align} options={["left", "center", "right"] as const}
                labels={ALIGN_LABELS} disabled={disabled} testId="element-align"
                onChange={(value) => onChange({ style: { ...element.style, align: value } })} />
              {hasText && (
                <Color label="Matn rangi" value={element.style?.color} fallback="#141428" disabled={disabled}
                  onChange={(value) => onChange({ style: { ...element.style, color: value } })} />
              )}
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg bg-muted/50 p-2 text-[10px] text-muted-foreground">
        Shablon faqat KO'RINISHni belgilaydi. Summa va miqdor hujjatdan keladi — bu yerdan o'zgartirilmaydi.
      </div>
    </div>
  );
}
