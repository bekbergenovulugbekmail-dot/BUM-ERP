/**
 * Hujjat dizayneri: nakladnoy va boshqa qog'ozlarning ko'rinishini foydalanuvchi o'zi tuzadi.
 *
 * Asosiy qaror — OLDINDAN KO'RISH HAQIQIY PDF: o'ng tomondagi A4 varaq shablon bilan chizilgan
 * chinakam hujjat (namuna ma'lumotda). Shuning uchun "ko'rgani" va "bosib chiqqani" bir xil
 * bo'ladi; alohida HTML maketi yo'q, ya'ni ikki xil ko'rinish muammosi ham yo'q.
 *
 * MOLIYAVIY YAXLITLIK: bu yerda faqat KO'RINISH tahrirlanadi. Summalar serverdan keladi va
 * shablon orqali o'zgartirilmaydi (server ham shablonni oq ro'yxat bo'yicha qayta quradi).
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDown, ArrowUp, Copy, CopyPlus, FileText, History, Plus, RotateCcw, Save, Star, Trash2,
} from "lucide-react";
import {
  DOCUMENT_TYPE_LABELS, DOCUMENT_TYPES, MAX_IMAGE_DATA_LENGTH,
  type DocumentElement, type DocumentTemplateSchema, type DocumentType, type SectionKey,
} from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { useActiveCompany, usePermissions } from "@/hooks/use-company.ts";
import { cn } from "@/lib/utils.ts";
import {
  ELEMENT_LABELS, SECTION_LABELS, sampleData,
  type FieldCatalog, type TemplateRow, type VersionRow,
} from "../_lib/document-designer.ts";
import ElementEditor from "./element-editor.tsx";

const SECTION_ORDER: SectionKey[] = ["header", "body", "footer"];

/**
 * Yangi jadval qaysi ustunlar bilan ochiladi — HUJJAT TURIGA mos.
 *
 * Ilgari katalogning birinchi to'rttasi olinardi (index, name, sku, barcode) — yetkazma
 * nakladnoyida bu ustunlar bo'sh chiqar, foydalanuvchi esa nega bo'shligini bilmasdi.
 */
const DEFAULT_TABLE_COLUMNS: Record<DocumentType, string[]> = {
  delivery_waybill: ["index", "name", "unit", "quantity", "total"],
  sales_invoice: ["index", "name", "unit", "quantity", "price", "total"],
  purchase_order: ["index", "name", "unit", "quantity", "price", "total"],
  payslip: ["index", "name", "total"],
};

/** Yangi element — turiga qarab eng kerakli standart qiymat bilan. */
function newElement(
  type: DocumentElement["type"],
  catalog: FieldCatalog | undefined,
  documentType: DocumentType,
): DocumentElement {
  const id = crypto.randomUUID();
  if (type === "field") return { id, type, field: catalog?.fields[0]?.path ?? "document.number", label: catalog?.fields[0]?.label };
  if (type === "itemsTable") {
    const allowed = new Set((catalog?.columns ?? []).map((column) => column.key));
    const keys = DEFAULT_TABLE_COLUMNS[documentType].filter((key) => allowed.has(key)).map((key) => ({ key }));
    return { id, type, columns: keys.length > 0 ? keys : [{ key: "name" }] };
  }
  if (type === "totals") return { id, type, rows: ["total"] };
  if (type === "payments") return { id, type, rows: ["cash", "card"] };
  if (type === "signatures") return { id, type, label: "Topshirdi|Qabul qildi" };
  if (type === "text") return { id, type, label: "Yangi matn" };
  if (type === "qr") return { id, type, qrSource: "documentNumber", width: 22 };
  if (type === "barcode") return { id, type, qrSource: "documentNumber", width: 50, height: 14 };
  if (type === "image") return { id, type, width: 40, height: 20, fit: "contain" };
  if (type === "rect") return { id, type, width: 80, height: 20, box: { borderWidth: 0.3, borderStyle: "solid" } };
  return { id, type };
}

export default function DocumentsSection() {
  const { can } = usePermissions();
  const canManage = can("settings.manage");
  const activeCompany = useActiveCompany().data?.company;
  const companyName = activeCompany?.name ?? "BUM ERP";

  const [documentType, setDocumentType] = useState<DocumentType>("delivery_waybill");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [schema, setSchema] = useState<DocumentTemplateSchema | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Sxema qaysi shablon uchun yuklangani — qayta yuklashni bir marta qilish uchun. */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  /** Ochiq nom kiritish formasi: yangi shablon yoki nusxa. */
  const [creating, setCreating] = useState<"new" | "duplicate" | null>(null);
  const [newName, setNewName] = useState("");
  /** Arxivlash ikki bosqichda — tasodifan bosilmasin (brauzer dialogisiz). */
  const [confirmArchive, setConfirmArchive] = useState(false);

  const templatesQuery = useApiQuery<{ templates: TemplateRow[] }>("/api/documents/templates", { documentType });
  const templates = templatesQuery.data?.templates ?? [];
  const catalog = useApiQuery<FieldCatalog>("/api/documents/fields", { documentType }).data;
  /**
   * Tanlangan shablon. Foydalanuvchi (yoki hozirgina yaratish) tanlagan bo'lsa — O'SHA.
   *
   * Ro'yxatda bor-yo'qligi TEKSHIRILMAYDI: yangi shablon yaratilganda ro'yxat bir zumga eski
   * bo'lib turadi va tekshiruv uni "yo'q" deb hisoblab, standart shablonga sakrab ketardi —
   * shu payt saqlanmagan tahrir yo'qolardi.
   */
  const activeId = templateId ?? (templates.find((template) => template.isDefault)?.id ?? templates[0]?.id ?? null);

  const detail = useApiQuery<{ schema: DocumentTemplateSchema }>(activeId ? `/api/documents/templates/${activeId}` : null);
  const versions = useApiQuery<{ versions: VersionRow[] }>(
    showVersions && activeId ? `/api/documents/templates/${activeId}/versions` : null,
  ).data?.versions;

  const createTemplate = useApiMutation((body: object) => api.post<{ template: TemplateRow }>("/api/documents/templates", body));
  const invalidate = () => void templatesQuery.refetch();

  // Serverdan kelgan sxemani tahrir holatiga BIR MARTA yuklaymiz (saqlanmagan o'zgarish ustiga yozilmasin).
  // Render paytida sinxronlash — loyihaning boshqa oynalaridagidek (effekt emas, cascading render yo'q).
  // `dirty` bo'lsa HECH QACHON ustiga yozilmaydi: fonda ketgan qayta so'rov (mutatsiyadan keyin
  // hamma so'rov yangilanadi) saqlanmagan tahrirni o'chirib yuborardi.
  const serverSchema = detail.data?.schema;
  if (serverSchema && loadedFor !== activeId && !dirty) {
    setLoadedFor(activeId);
    setSchema(serverSchema);
    setDirty(false);
  }
  if (!activeId && schema !== null && loadedFor !== null) {
    setLoadedFor(null);
    setSchema(null);
  }

  const elements = useMemo(() => {
    const map = new Map<SectionKey, DocumentElement[]>();
    for (const key of SECTION_ORDER) map.set(key, schema?.sections.find((section) => section.key === key)?.elements ?? []);
    return map;
  }, [schema]);

  const selected = useMemo(() => {
    for (const list of elements.values()) {
      const found = list.find((element) => element.id === selectedId);
      if (found) return found;
    }
    return null;
  }, [elements, selectedId]);

  /** Sxemani o'zgartirish — har doim yangi obyekt (React qayta chizsin). */
  const patchSchema = (updater: (current: DocumentTemplateSchema) => DocumentTemplateSchema) => {
    setSchema((current) => (current ? updater(structuredClone(current)) : current));
    setDirty(true);
  };

  const updateElement = (id: string, patch: Partial<DocumentElement>) =>
    patchSchema((current) => {
      for (const section of current.sections) {
        const index = section.elements.findIndex((element) => element.id === id);
        if (index < 0) continue;
        const previous = section.elements[index]!;
        const next = { ...previous, ...patch };
        /**
         * Maydon almashtirilganda yorliq ham ergashadi — AGAR foydalanuvchi uni o'zi
         * yozmagan bo'lsa. Aks holda "Kompaniya nomi: Test Market" kabi chalkash juftlik
         * qog'ozga tushib ketardi (yorliq eski maydonniki, qiymat yangisiniki).
         */
        if (patch.field && patch.field !== previous.field) {
          const wasAuto = !previous.label || previous.label === catalog?.fields.find((f) => f.path === previous.field)?.label;
          if (wasAuto) next.label = catalog?.fields.find((f) => f.path === patch.field)?.label;
        }
        section.elements[index] = next;
      }
      return current;
    });

  const addElement = (section: SectionKey, type: DocumentElement["type"]) =>
    patchSchema((current) => {
      const target = current.sections.find((item) => item.key === section);
      if (target) target.elements.push(newElement(type, catalog, documentType));
      return current;
    });

  const removeElement = (id: string) =>
    patchSchema((current) => {
      for (const section of current.sections) section.elements = section.elements.filter((element) => element.id !== id);
      return current;
    });

  /** Nusxalash — yonidagi joyga aynan shunday element qo'shadi (yangi id bilan). */
  const duplicateElement = (id: string) =>
    patchSchema((current) => {
      for (const section of current.sections) {
        const index = section.elements.findIndex((element) => element.id === id);
        if (index < 0) continue;
        section.elements.splice(index + 1, 0, { ...structuredClone(section.elements[index]!), id: crypto.randomUUID() });
      }
      return current;
    });

  const moveElement = (id: string, direction: -1 | 1) =>
    patchSchema((current) => {
      for (const section of current.sections) {
        const index = section.elements.findIndex((element) => element.id === id);
        if (index < 0) continue;
        const next = index + direction;
        if (next < 0 || next >= section.elements.length) return current;
        const [item] = section.elements.splice(index, 1);
        section.elements.splice(next, 0, item!);
      }
      return current;
    });

  // ── Oldindan ko'rish: HAQIQIY PDF ──
  useEffect(() => {
    if (!schema) return;
    let cancelled = false;
    let url: string | null = null;
    void (async () => {
      try {
        const { renderTemplate } = await import("@/lib/pdf/template-renderer.ts");
        const doc = await renderTemplate(schema, sampleData(documentType, companyName));
        if (cancelled) return;
        url = doc.output("bloburl") as unknown as string;
        setPreviewUrl(url);
      } catch (error) {
        if (!cancelled) toast.error(`Ko'rish xatosi: ${errorMessage(error)}`);
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [schema, documentType, companyName]);

  /** Nom kiritish ichki formada — brauzer dialogi ilovani bloklaydi va sinovga ham to'siq. */
  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const created = await createTemplate.mutateAsync({
        documentType,
        name,
        ...(creating === "duplicate" && schema ? { schema } : {}),
      });
      toast.success("Shablon yaratildi");
      setCreating(null);
      setNewName("");
      setTemplateId(created.template.id);
      setLoadedFor(null);
      invalidate();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const handleSave = async () => {
    if (!activeId || !schema) return;
    setSaving(true);
    try {
      const result = await api.post<{ version: { version: number }; warnings: string[] }>(
        `/api/documents/templates/${activeId}/versions`,
        { schema },
      );
      setDirty(false);
      void detail.refetch();
      toast.success(`${result.version.version}-versiya saqlandi`);
      for (const warning of result.warnings.slice(0, 3)) toast.warning(warning);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const templateAction = async (path: string, message: string, body?: object) => {
    if (!activeId) return;
    try {
      await api.post(`/api/documents/templates/${activeId}/${path}`, body ?? {});
      toast.success(message);
      invalidate();
      void detail.refetch();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const handleArchive = async () => {
    if (!activeId) return;
    try {
      await api.delete(`/api/documents/templates/${activeId}`);
      toast.success("Arxivlandi");
      setTemplateId(null);
      setSchema(null);
      invalidate();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48">
          <Label className="text-xs">Hujjat turi</Label>
          <Select value={documentType} onValueChange={(value) => { setDocumentType(value as DocumentType); setTemplateId(null); setLoadedFor(null); setDirty(false); }}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DOCUMENT_TYPES.map((type) => (
                <SelectItem key={type} value={type}>{DOCUMENT_TYPE_LABELS[type]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-56">
          <Label className="text-xs">Shablon</Label>
          <Select value={activeId ?? ""} onValueChange={(value) => { setTemplateId(value); setDirty(false); }}>
            <SelectTrigger className="h-9" data-testid="template-select">
              <SelectValue placeholder={templates.length === 0 ? "Shablon yo'q" : "Tanlang"} />
            </SelectTrigger>
            <SelectContent>
              {templates.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  {template.name}{template.isDefault ? " · standart" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => { setCreating("new"); setNewName("Mening shablonim"); }} data-testid="template-create">
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Yangi
            </Button>
            <Button size="sm" variant="secondary" disabled={!schema}
              onClick={() => { setCreating("duplicate"); setNewName(`${templates.find((t) => t.id === activeId)?.name ?? "Shablon"} nusxasi`); }}>
              <Copy className="mr-1.5 h-3.5 w-3.5" /> Nusxa
            </Button>
            <Button size="sm" disabled={!dirty || saving} onClick={() => void handleSave()} data-testid="template-save">
              <Save className="mr-1.5 h-3.5 w-3.5" /> Saqlash
            </Button>
            <Button size="sm" variant="secondary" disabled={!activeId} onClick={() => void templateAction("default", "Standart qilindi")}>
              <Star className="mr-1.5 h-3.5 w-3.5" /> Standart
            </Button>
            <Button size="sm" variant="secondary" disabled={!activeId} onClick={() => setShowVersions((value) => !value)}>
              <History className="mr-1.5 h-3.5 w-3.5" /> Versiyalar
            </Button>
            {confirmArchive ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => { setConfirmArchive(false); void handleArchive(); }} data-testid="template-archive-confirm">
                  <Trash2 className="mr-1.5 h-3.5 w-3.5 text-destructive" /> Arxivlash — tasdiqlang
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmArchive(false)}>Bekor</Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" disabled={!activeId} onClick={() => setConfirmArchive(true)} data-testid="template-archive">
                <Trash2 className="mr-1.5 h-3.5 w-3.5 text-destructive" /> Arxiv
              </Button>
            )}
          </div>
        )}
      </div>

      {creating && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border p-3">
          <div className="min-w-56">
            <Label className="text-xs">{creating === "duplicate" ? "Nusxa nomi" : "Yangi shablon nomi"}</Label>
            <Input className="h-9" value={newName} data-testid="template-name"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleCreate(); }} />
          </div>
          <Button size="sm" disabled={!newName.trim()} onClick={() => void handleCreate()} data-testid="template-create-confirm">Yaratish</Button>
          <Button size="sm" variant="ghost" onClick={() => setCreating(null)}>Bekor</Button>
        </div>
      )}

      {templates.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          Bu hujjat turida shablon yo'q — hujjat tizim standarti bilan chiqadi. "Yangi" tugmasi standart
          ko'rinishdan nusxa ochadi va uni istagancha o'zgartirasiz.
        </p>
      )}

      {showVersions && versions && (
        <div className="rounded-xl border border-border p-3">
          <p className="mb-2 text-xs font-semibold">Versiyalar tarixi</p>
          <div className="space-y-1">
            {versions.map((version) => (
              <div key={version.id} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs hover:bg-accent/40">
                <span>
                  <span className="font-mono">v{version.version}</span>
                  {version.note ? ` · ${version.note}` : ""}
                  <span className="ml-2 text-muted-foreground">{new Date(version.createdAt).toLocaleString("uz-UZ")}</span>
                </span>
                {canManage && (
                  <Button size="sm" variant="ghost" className="h-7"
                    onClick={() => void templateAction("restore", `v${version.version} qaytarildi`, { versionId: version.id })}>
                    <RotateCcw className="mr-1 h-3 w-3" /> Qaytarish
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/*
        `minmax(0,1fr)` — `1fr` ning o'zi `minmax(auto,1fr)` degani, ya'ni ustun ichidagi
        eng tor kenglikdan pastga tushmaydi. Shu sababli A4 ko'rinishi butun sahifani
        cho'zib, o'ng tomondagi sozlamalar paneli ekrandan chiqib ketardi.
      */}
      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_308px]">
        {/* Elementlar daraxti */}
        <div className="min-w-0 space-y-3 rounded-xl border border-border p-3">
          {SECTION_ORDER.map((section) => (
            <div key={section}>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-xs font-semibold">{SECTION_LABELS[section]}</p>
                {canManage && schema && (
                  <div className="flex flex-wrap justify-end gap-1">
                    {/* Bir bosishda qo'shiladi — ko'p qadamli menyu tez ishlashga xalaqit beradi */}
                    {(["text", "field", "itemsTable", "totals", "signatures", "image", "qr", "barcode", "pageNumber", "line", "rect", "spacer"] as const).map((type) => (
                      <button
                        key={type}
                        type="button"
                        data-testid={`add-${section}-${type}`}
                        className="rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-accent"
                        onClick={() => addElement(section, type)}
                      >
                        + {ELEMENT_LABELS[type]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-1">
                {(elements.get(section) ?? []).map((element) => (
                  <div
                    key={element.id}
                    className={cn(
                      "flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs",
                      selectedId === element.id ? "border-primary bg-primary/5" : "border-transparent hover:bg-accent/40",
                    )}
                  >
                    <button type="button" className="flex-1 truncate text-left" onClick={() => setSelectedId(element.id)}>
                      <span className="text-muted-foreground">{ELEMENT_LABELS[element.type]}</span>
                      {element.label ? ` · ${element.label}` : element.field ? ` · ${element.field}` : ""}
                    </button>
                    {canManage && (
                      <>
                        <button type="button" aria-label="Yuqoriga" onClick={() => moveElement(element.id, -1)}><ArrowUp className="h-3 w-3" /></button>
                        <button type="button" aria-label="Pastga" onClick={() => moveElement(element.id, 1)}><ArrowDown className="h-3 w-3" /></button>
                        <button type="button" aria-label="Nusxalash" data-testid={`duplicate-${element.id}`}
                          onClick={() => duplicateElement(element.id)}><CopyPlus className="h-3 w-3" /></button>
                        <button type="button" aria-label="O'chirish" onClick={() => removeElement(element.id)}>
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </button>
                      </>
                    )}
                  </div>
                ))}
                {(elements.get(section) ?? []).length === 0 && (
                  <p className="px-2 py-1 text-[11px] text-muted-foreground">Bo'sh</p>
                )}
              </div>
              <Separator className="mt-2" />
            </div>
          ))}
        </div>

        {/* A4 — HAQIQIY PDF. `min-w-0`: shusiz iframe ustunni cho'zib, o'ng paneli ekrandan chiqib ketardi */}
        <div className="min-w-0 rounded-xl border border-border bg-muted/30 p-2">
          <div className="mb-2 flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <FileText className="h-3.5 w-3.5" /> A4 ko'rinish (namuna ma'lumot bilan) — chop etilganda aynan shunday chiqadi
          </div>
          {previewUrl ? (
            <iframe title="A4 ko'rinish" src={previewUrl} className="h-[70vh] w-full rounded-lg border border-border bg-white" />
          ) : (
            <div className="flex h-[70vh] items-center justify-center text-sm text-muted-foreground">Shablon tanlang</div>
          )}
        </div>

        {/* Tanlangan element sozlamalari */}
        <div className="space-y-3 rounded-xl border border-border p-3">
          {!selected && <p className="text-xs text-muted-foreground">Chapdan element tanlang</p>}
          {selected && (
            <ElementEditor
              element={selected}
              catalog={catalog}
              disabled={!canManage}
              maxImageLength={MAX_IMAGE_DATA_LENGTH}
              companyLogoUrl={activeCompany?.logoUrl}
              onChange={(patch) => updateElement(selected.id, patch)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
