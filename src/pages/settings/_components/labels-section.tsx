/**
 * Etiketka shablonlari — `PUT /api/company/print-settings/labels` (`settings.manage`).
 * Har xil o'lcham: termal etiketka printeri (rulon) yoki A4 varaq (ustunlar); jonli ko'rinish.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Copy, Plus, Printer, RotateCcw, Save, Star, Tag, Trash2 } from "lucide-react";
import { LABEL_LIMITS, LABEL_PRESETS, type LabelSettings, type LabelTemplate } from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { cn } from "@/lib/utils.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { useActiveCompany, usePermissions } from "@/hooks/use-company.ts";
import { PRINT_SETTINGS_PATH, type PrintSettings } from "@/hooks/use-print-settings.ts";
import { printHtml } from "@/lib/print/receipt-html.ts";
import { SAMPLE_LABEL_PRODUCT, buildLabelsHtml } from "@/lib/print/label-html.ts";
import { SettingsGroup, ToggleRow } from "./form-controls.tsx";

type LabelBooleanKey = {
  [K in keyof LabelTemplate]: LabelTemplate[K] extends boolean ? K : never;
}[keyof LabelTemplate];

const FIELD_TOGGLES: { key: LabelBooleanKey; label: string }[] = [
  { key: "showCompanyName", label: "Kompaniya nomi" },
  { key: "showName", label: "Mahsulot nomi" },
  { key: "showPrice", label: "Narx" },
  { key: "showCodeText", label: "Kod raqami" },
  { key: "showSku", label: "SKU" },
  { key: "showBorder", label: "Qirqish chizig'i" },
];

const CODE_TYPES: { value: LabelTemplate["codeType"]; label: string }[] = [
  { value: "barcode", label: "Shtrix-kod" },
  { value: "qr", label: "QR kod" },
  { value: "none", label: "Kodsiz" },
];

const FONT_SIZES: { value: LabelTemplate["fontSize"]; label: string }[] = [
  { value: "sm", label: "Kichik" },
  { value: "md", label: "O'rta" },
  { value: "lg", label: "Katta" },
];

const inRange = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;

function templateError(t: LabelTemplate): string | null {
  if (!t.name.trim()) return "Shablon nomi bo'sh";
  if (!inRange(t.widthMm, LABEL_LIMITS.minMm, LABEL_LIMITS.maxMm) || !inRange(t.heightMm, LABEL_LIMITS.minMm, LABEL_LIMITS.maxMm)) {
    return `${t.name}: o'lcham ${LABEL_LIMITS.minMm}–${LABEL_LIMITS.maxMm} mm oralig'ida bo'lishi kerak`;
  }
  if (t.layout === "a4") {
    if (!Number.isInteger(t.columns) || !inRange(t.columns, 1, LABEL_LIMITS.maxColumns)) {
      return `${t.name}: ustunlar soni 1–${LABEL_LIMITS.maxColumns}`;
    }
    if (!inRange(t.gapMm, 0, LABEL_LIMITS.maxGapMm)) return `${t.name}: oraliq 0–${LABEL_LIMITS.maxGapMm} mm`;
  }
  return null;
}

/** Yangi shablon id'si: mavjudlari bilan to'qnashmaydigan `lbl-N`. */
function nextTemplateId(templates: LabelTemplate[]) {
  const used = new Set(templates.map((t) => t.id));
  let n = templates.length + 1;
  while (used.has(`lbl-${n}`)) n += 1;
  return `lbl-${n}`;
}

const sampleItems = (t: LabelTemplate) => [{ product: SAMPLE_LABEL_PRODUCT, quantity: t.layout === "a4" ? t.columns : 1 }];

export default function LabelsSection() {
  const { can } = usePermissions();
  const canManage = can("settings.manage");
  const company = useActiveCompany().data?.company;
  const saved = useApiQuery<PrintSettings>(PRINT_SETTINGS_PATH).data?.labels;
  const [draft, setDraft] = useState<LabelSettings | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const save = useApiMutation(
    (body: LabelSettings) => api.put<{ labels: LabelSettings }>("/api/company/print-settings/labels", body),
    { invalidate: [PRINT_SETTINGS_PATH] },
  );

  const settings = draft ?? saved;
  if (!settings || !company) return <Skeleton className="h-[600px] rounded-2xl" />;

  const selected =
    settings.templates.find((t) => t.id === selectedId) ??
    settings.templates.find((t) => t.id === settings.defaultTemplateId) ??
    settings.templates[0]!;
  const selectedError = templateError(selected);
  const firstError = settings.templates.map(templateError).find((error) => error !== null) ?? null;

  const updateTemplate = (patch: Partial<LabelTemplate>) =>
    setDraft({ ...settings, templates: settings.templates.map((t) => (t.id === selected.id ? { ...t, ...patch } : t)) });

  const addTemplate = (source: LabelTemplate, name: string) => {
    if (settings.templates.length >= LABEL_LIMITS.maxTemplates) {
      toast.error(`Ko'pi bilan ${LABEL_LIMITS.maxTemplates} ta shablon`);
      return;
    }
    const id = nextTemplateId(settings.templates);
    setDraft({ ...settings, templates: [...settings.templates, { ...source, id, name }] });
    setSelectedId(id);
  };

  const removeTemplate = () => {
    if (settings.templates.length <= 1) return;
    const templates = settings.templates.filter((t) => t.id !== selected.id);
    setDraft({
      defaultTemplateId: settings.defaultTemplateId === selected.id ? templates[0]!.id : settings.defaultTemplateId,
      templates,
    });
    setSelectedId(null);
  };

  const handleSave = async () => {
    try {
      await save.mutateAsync(settings);
      setDraft(null);
      toast.success("Etiketka shablonlari saqlandi");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const numberField = (key: "widthMm" | "heightMm" | "columns" | "gapMm", label: string, step: number) => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        type="number"
        step={step}
        value={Number.isFinite(selected[key]) ? selected[key] : ""}
        onChange={(e) => updateTemplate({ [key]: e.target.value === "" ? Number.NaN : Number(e.target.value) })}
      />
    </div>
  );

  const previewHtml = buildLabelsHtml(sampleItems(selected), selected, { companyName: company.name, previewWidthPx: 360 });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 pb-2 border-b border-border">
        <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
          <Tag className="h-5 w-5 text-amber-500" />
        </div>
        <div>
          <p className="font-semibold">Etiketka shablonlari</p>
          <p className="text-xs text-muted-foreground">
            {canManage
              ? "Etiketka o'lchami va tarkibi; mahsulotlar sahifasidan shu shablonlar bilan chop etiladi"
              : "Faqat ko'rish — o'zgartirish uchun ruxsat yo'q"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_380px] gap-5">
        {/* Shablonlar ro'yxati */}
        <div className="space-y-2">
          {settings.templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelectedId(t.id)}
              className={cn(
                "w-full text-left rounded-xl border px-3 py-2.5 transition-colors cursor-pointer",
                t.id === selected.id ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-accent",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium truncate">{t.name || "Nomsiz"}</span>
                {t.id === settings.defaultTemplateId && (
                  <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {t.widthMm} × {t.heightMm} mm · {t.layout === "roll" ? "rulon" : `A4, ${t.columns} ustun`}
              </p>
            </button>
          ))}
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" className="w-full" disabled={settings.templates.length >= LABEL_LIMITS.maxTemplates}>
                  <Plus className="h-4 w-4 mr-1.5" /> Shablon qo'shish
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-60">
                {LABEL_PRESETS.map((preset) => (
                  <DropdownMenuItem key={preset.id} className="cursor-pointer" onClick={() => addTemplate(preset, preset.name)}>
                    {preset.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Tanlangan shablon */}
        <fieldset disabled={!canManage} className="space-y-4 min-w-0">
          <SettingsGroup title="O'lcham va kod">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Shablon nomi</Label>
                <Input value={selected.name} maxLength={60} onChange={(e) => updateTemplate({ name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Printer / qog'oz</Label>
                <Select
                  value={selected.layout}
                  onValueChange={(v) => updateTemplate({ layout: v === "a4" ? "a4" : "roll" })}
                  disabled={!canManage}
                >
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="roll">Termal etiketka (rulon)</SelectItem>
                    <SelectItem value="a4">A4 varaq (ustunlar)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Kod turi</Label>
                <Select
                  value={selected.codeType}
                  onValueChange={(v) => updateTemplate({ codeType: v as LabelTemplate["codeType"] })}
                  disabled={!canManage}
                >
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent position="popper">
                    {CODE_TYPES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {numberField("widthMm", "Kengligi, mm", 0.5)}
              {numberField("heightMm", "Balandligi, mm", 0.5)}
              {selected.layout === "a4" && numberField("columns", "Ustunlar soni", 1)}
              {selected.layout === "a4" && numberField("gapMm", "Oraliq, mm", 0.5)}
              <div className="space-y-1.5">
                <Label>Shrift</Label>
                <Select
                  value={selected.fontSize}
                  onValueChange={(v) => updateTemplate({ fontSize: v as LabelTemplate["fontSize"] })}
                  disabled={!canManage}
                >
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent position="popper">
                    {FONT_SIZES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {selectedError && <p className="text-xs text-destructive">{selectedError}</p>}
          </SettingsGroup>

          <SettingsGroup title="Etiketkada" description="Kod mahsulot shtrix-kodidan, u bo'lmasa SKU'dan olinadi">
            {FIELD_TOGGLES.map((toggle) => (
              <ToggleRow
                key={toggle.key}
                label={toggle.label}
                checked={selected[toggle.key]}
                onChange={(value) => updateTemplate({ [toggle.key]: value })}
              />
            ))}
          </SettingsGroup>

          {canManage && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={selected.id === settings.defaultTemplateId}
                onClick={() => setDraft({ ...settings, defaultTemplateId: selected.id })}
              >
                <Star className="h-4 w-4 mr-1.5" /> Standart qilish
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => addTemplate(selected, `${selected.name} (nusxa)`.slice(0, 60))}>
                <Copy className="h-4 w-4 mr-1.5" /> Nusxa olish
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-destructive"
                disabled={settings.templates.length <= 1}
                onClick={removeTemplate}
              >
                <Trash2 className="h-4 w-4 mr-1.5" /> O'chirish
              </Button>
            </div>
          )}
        </fieldset>

        {/* Ko'rinish */}
        <div className="lg:col-span-2 xl:col-span-1 xl:sticky xl:top-4 self-start space-y-2">
          <p className="text-sm font-medium">
            Ko'rinish {draft && <span className="text-xs font-normal text-amber-600 dark:text-amber-400">— saqlanmagan</span>}
          </p>
          <iframe
            title="Etiketka ko'rinishi"
            sandbox=""
            srcDoc={previewHtml}
            className="w-full h-[380px] rounded-2xl border border-border bg-muted/40"
          />
          <Button
            variant="secondary"
            className="w-full"
            disabled={selectedError !== null}
            onClick={() => printHtml(buildLabelsHtml(sampleItems(selected), selected, { companyName: company.name }))}
          >
            <Printer className="h-4 w-4 mr-2" /> Sinov etiketkasini chop etish
          </Button>
        </div>
      </div>

      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => { void handleSave(); }} disabled={save.isPending || !draft || firstError !== null}>
            <Save className="h-4 w-4 mr-2" />
            {save.isPending ? "Saqlanmoqda..." : "Saqlash"}
          </Button>
          {draft && (
            <Button variant="secondary" onClick={() => { setDraft(null); setSelectedId(null); }}>
              <RotateCcw className="h-4 w-4 mr-2" /> Bekor qilish
            </Button>
          )}
          {draft && firstError && <p className="text-xs text-destructive">{firstError}</p>}
        </div>
      )}
    </div>
  );
}
