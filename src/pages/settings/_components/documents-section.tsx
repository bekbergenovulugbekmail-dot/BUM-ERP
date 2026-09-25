/**
 * Hujjat dizayneri: nakladnoy va boshqa qog'ozlarning ko'rinishini foydalanuvchi o'zi tuzadi.
 *
 * VIZUAL DIZAYNER (2-bosqich): A4 varaqda elementni sichqoncha bilan ushlab suriladi,
 * burchak/qirrasidan tortib kattalashtiriladi. Joy millimetrda saqlanadi va PDF xuddi shu
 * joyga chizadi. Varaqdagi har element — HAQIQIY PDF rendereri chizgan rasm, shuning uchun
 * "ekranda ko'ringan" va "qog'ozga chiqqan" bir xil.
 *
 * Eski (oqim) shablon ochilganda u avtomatik ERKIN JOYLASHUVGA o'tkaziladi — ko'rinishi
 * o'zgarmaydi, faqat endi har element suriladigan bo'ladi. Saqlanmaguncha bazadagi shablon
 * va chiqadigan nakladnoy o'zgarmaydi.
 *
 * MOLIYAVIY YAXLITLIK: bu yerda faqat KO'RINISH tahrirlanadi. Summalar serverdan keladi va
 * shablon orqali o'zgartirilmaydi (server ham shablonni oq ro'yxat bo'yicha qayta quradi).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Copy, FileText, History, Info, Layers, Plus, RotateCcw, Save, Star, Trash2 } from "lucide-react";
import {
  DOCUMENT_TYPE_LABELS, DOCUMENT_TYPES, MAX_IMAGE_DATA_LENGTH, isFreeLayout, pageSizeMm,
  type DocumentElement, type DocumentTemplateSchema, type DocumentType,
} from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { useActiveCompany, usePermissions } from "@/hooks/use-company.ts";
import { cn } from "@/lib/utils.ts";
import { FREE_DEFAULT_SIZE, boxOf, freeElements, isPageFurniture } from "@/lib/pdf/template-free.ts";
import {
  ELEMENT_LABELS, sampleData,
  type FieldCatalog, type TemplateRow, type VersionRow,
} from "../_lib/document-designer.ts";
import {
  PX_PER_MM, alignRects, copiesPerPage, distributeRects, intersects, reorderLayers, round,
  type AlignMode, type LayerOp, type Rect,
} from "../_lib/canvas-geometry.ts";
import { renderDensity, useElementSprites } from "../_lib/element-sprites.ts";
import { useHistory } from "../_lib/use-history.ts";
import DesignCanvas, { type CanvasGrid } from "./design-canvas.tsx";
import DesignerToolbar, { type InsertKind } from "./designer-toolbar.tsx";
import ElementEditor from "./element-editor.tsx";

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

/** Yangi element mazmuni — turiga qarab eng kerakli standart qiymat bilan. */
function newElement(type: DocumentElement["type"], catalog: FieldCatalog | undefined, documentType: DocumentType): DocumentElement {
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
  if (type === "text") return { id, type, label: "Yangi matn", style: { fontSize: 10 } };
  if (type === "qr") return { id, type, qrSource: "documentNumber" };
  if (type === "barcode") return { id, type, qrSource: "documentNumber" };
  if (type === "image") return { id, type, fit: "contain", lockRatio: true };
  if (type === "rect") return { id, type, box: { borderWidth: 0.3, borderStyle: "solid" } };
  if (type === "line") return { id, type, box: { borderWidth: 0.3, borderStyle: "solid" } };
  return { id, type };
}

/** Elementlar ro'yxatini sxemaga qaytaradi (bo'limlari saqlanadi, yangilari "body" ga). */
function mapElements(schema: DocumentTemplateSchema, update: (element: DocumentElement) => DocumentElement | null): DocumentTemplateSchema {
  return {
    ...schema,
    sections: schema.sections.map((section) => ({
      ...section,
      elements: section.elements.flatMap((element) => {
        const next = update(element);
        return next ? [next] : [];
      }),
    })),
  };
}

const draftKey = (templateId: string) => `bum.designer.draft.${templateId}`;
type Draft = { versionId: string | null; schema: DocumentTemplateSchema; at: number };

function readDraft(templateId: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(templateId));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

/** Kiritish maydonida yozilayotganda klaviatura buyruqlari ishlamasin. */
const isTyping = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)
    || Boolean(element.closest("[role=listbox],[role=menu],[role=dialog]"));
};

export default function DocumentsSection() {
  const { can } = usePermissions();
  const canManage = can("settings.manage");
  const activeCompany = useActiveCompany().data?.company;
  const companyName = activeCompany?.name ?? "BUM ERP";

  const [documentType, setDocumentType] = useState<DocumentType>("delivery_waybill");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const history = useHistory<DocumentTemplateSchema>();
  const { reset: resetHistory, set: setHistory } = history;
  const schema = history.present;
  /** Bazadagi (oxirgi saqlangan) holat — `schema` undan farq qilsa, saqlanmagan o'zgarish bor. */
  const [saved, setSaved] = useState<DocumentTemplateSchema | null>(null);
  const dirty = schema !== null && schema !== saved;
  const [selection, setSelection] = useState<string[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Sxema qaysi shablon (va versiya) uchun yuklangani. */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  /** Eski shablon erkin joylashuvga o'tkazildi — foydalanuvchiga aytiladi. */
  const [converted, setConverted] = useState(false);
  /** Saqlanmagan qoralama topildi (brauzer yopilgan yoki sahifa yangilangan). */
  const [draft, setDraft] = useState<Draft | null>(null);
  const [creating, setCreating] = useState<"new" | "duplicate" | null>(null);
  const [newName, setNewName] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [zoom, setZoom] = useState(0.75);
  const [grid, setGrid] = useState<CanvasGrid>({ show: false, snap: true, size: 5, outlines: true });
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  const templatesQuery = useApiQuery<{ templates: TemplateRow[] }>("/api/documents/templates", { documentType });
  const templates = templatesQuery.data?.templates ?? [];
  const catalog = useApiQuery<FieldCatalog>("/api/documents/fields", { documentType }).data;
  /**
   * Tanlangan shablon. Foydalanuvchi (yoki hozirgina yaratish) tanlagan bo'lsa — O'SHA.
   * Ro'yxatda bor-yo'qligi tekshirilmaydi: yangi shablon yaratilganda ro'yxat bir zum eski
   * bo'lib turadi va standart shablonga sakrab, saqlanmagan tahrir yo'qolardi.
   */
  const activeId = templateId ?? (templates.find((template) => template.isDefault)?.id ?? templates[0]?.id ?? null);

  const detail = useApiQuery<{ schema: DocumentTemplateSchema; version: { id: string; version: number } | null }>(
    activeId ? `/api/documents/templates/${activeId}` : null,
  );
  const versions = useApiQuery<{ versions: VersionRow[] }>(
    showVersions && activeId ? `/api/documents/templates/${activeId}/versions` : null,
  ).data?.versions;
  const createTemplate = useApiMutation((body: object) => api.post<{ template: TemplateRow }>("/api/documents/templates", body));
  const invalidate = () => void templatesQuery.refetch();

  const sample = useMemo(() => sampleData(documentType, companyName), [documentType, companyName]);
  const serverSchema = detail.data?.schema;
  const serverVersionId = detail.data?.version?.id ?? null;
  const loadKey = activeId && serverSchema ? `${activeId}:${serverVersionId ?? "factory"}` : null;

  /**
   * Serverdagi shablonni tahrir holatiga yuklash. Saqlanmagan o'zgarish bo'lsa HECH QACHON
   * ustiga yozilmaydi (fondagi qayta so'rov tahrirni o'chirib yuborardi). Oqim shabloni —
   * erkin joylashuvga o'tkaziladi (namuna ma'lumot bilan haqiqatan chizib, joylari o'lchanadi).
   */
  useEffect(() => {
    if (!loadKey || !serverSchema || loadedFor === loadKey || (dirty && loadedFor?.startsWith(`${activeId}:`))) return;
    let cancelled = false;
    void (async () => {
      try {
        const free = isFreeLayout(serverSchema)
          ? serverSchema
          : await (await import("@/lib/pdf/template-renderer.ts")).convertToFreeLayout(serverSchema, sample);
        if (cancelled) return;
        resetHistory(free);
        // O'tkazilgan shablon hali saqlanmagan — "Saqlash" yonadi
        setSaved(isFreeLayout(serverSchema) ? free : serverSchema);
        setConverted(!isFreeLayout(serverSchema));
        setSelection([]);
        setLoadedFor(loadKey);
        const stored = activeId ? readDraft(activeId) : null;
        setDraft(stored && stored.versionId === serverVersionId && JSON.stringify(stored.schema) !== JSON.stringify(free) ? stored : null);
      } catch (error) {
        if (!cancelled) toast.error(`Shablonni ochib bo'lmadi: ${errorMessage(error)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadKey, serverSchema, serverVersionId, loadedFor, dirty, activeId, sample, resetHistory]);

  // Qoralama — brauzerda, 800 ms kechikish bilan (har sichqoncha harakatida emas). Server
  // versiyasi faqat "Saqlash" bilan yaratiladi, ya'ni versiyalar tarixi buzilmaydi.
  useEffect(() => {
    if (!dirty || !schema || !activeId) return;
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(draftKey(activeId), JSON.stringify({ versionId: serverVersionId, schema, at: Date.now() } satisfies Draft));
      } catch {
        // Xotira to'lgan bo'lsa — qoralamasiz ishlashda davom etamiz
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [dirty, schema, activeId, serverVersionId]);

  // Saqlanmagan o'zgarish bilan sahifani yopishda ogohlantirish
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const elements = useMemo(() => (schema ? freeElements(schema) : []), [schema]);
  const page = schema ? pageSizeMm(schema.page) : { width: 210, height: 297 };
  const selected = selection.length === 1 ? elements.find((element) => element.id === selection[0]) ?? null : null;
  const { sprites, pending } = useElementSprites(elements, schema ? sample : null, renderDensity(PX_PER_MM * zoom));

  // ── Tahrirlash amallari ──
  const patchElements = useCallback((patches: Record<string, Partial<DocumentElement>>, options?: { record?: boolean; key?: string }) =>
    setHistory((current) => mapElements(current, (element) => (patches[element.id] ? { ...element, ...patches[element.id] } : element)), options), [setHistory]);

  const liveChange = useCallback((patches: Record<string, Partial<DocumentElement>>) => patchElements(patches, { record: false }), [patchElements]);

  const updateElement = (id: string, patch: Partial<DocumentElement>) => {
    const previous = elements.find((element) => element.id === id);
    const next = { ...patch };
    /**
     * Maydon almashtirilganda yorliq ham ergashadi — AGAR foydalanuvchi uni o'zi yozmagan
     * bo'lsa. Aks holda "Kompaniya nomi: Test Market" kabi chalkash juftlik chiqardi.
     */
    if (previous && patch.field && patch.field !== previous.field) {
      const wasAuto = !previous.label || previous.label === catalog?.fields.find((field) => field.path === previous.field)?.label;
      if (wasAuto) next.label = catalog?.fields.find((field) => field.path === patch.field)?.label;
    }
    patchElements({ [id]: next }, { key: `${id}:${Object.keys(patch).sort().join(",")}` });
  };

  const topZ = () => elements.reduce((max, element) => Math.max(max, element.zIndex ?? 0), 0);

  /**
   * Yangi element — varaqdagi BIRINCHI BO'SH joyga (mavjud jadval yoki matn ustiga tushib, uni
   * yopib qo'ymasin), qatlamning eng ustiga, darhol tanlanadi. Bo'sh joy bo'lmasa — o'rtaga.
   */
  const insert = (element: DocumentElement, size?: { w: number; h: number }) => {
    if (!schema) return;
    const base = size ?? FREE_DEFAULT_SIZE[element.type];
    const { margins } = schema.page;
    const w = Math.min(base.w, page.width - margins.left - margins.right);
    const x = round((page.width - w) / 2);
    const taken = elements.filter((item) => !isPageFurniture(item)).map((item) => boxOf(item));
    let y: number | null = null;
    for (let top = margins.top; top + base.h <= page.height - margins.bottom; top += 2) {
      const candidate = { x, y: top, w, h: base.h };
      if (!taken.some((box) => intersects(candidate, { x: box.x - 1, y: box.y - 1, w: box.w + 2, h: box.h + 2 }))) {
        y = top;
        break;
      }
    }
    const placed: DocumentElement = {
      ...element,
      x,
      y: round(y ?? Math.min(page.height - base.h - 10, 40 + (elements.length % 8) * 6)),
      width: round(w),
      height: base.h,
      zIndex: topZ() + 1,
    };
    history.set((current) => ({
      ...current,
      sections: current.sections.map((section) => (section.key === "body" ? { ...section, elements: [...section.elements, placed] } : section)),
    }));
    setSelection([placed.id]);
  };

  const insertKind = (kind: InsertKind) => {
    if (kind === "vline") {
      insert(newElement("line", catalog, documentType), { w: 2, h: 60 });
      return;
    }
    insert(newElement(kind, catalog, documentType), kind === "qr" ? { w: 24, h: 24 } : undefined);
  };

  const removeSelected = () => {
    if (selection.length === 0) return;
    const doomed = new Set(selection);
    history.set((current) => mapElements(current, (element) => (doomed.has(element.id) ? null : element)));
    setSelection([]);
  };

  /** Nusxa — 5 mm pastroq-o'ngroqda, eng ustki qatlamda. */
  const duplicateSelected = () => {
    if (selection.length === 0) return;
    const chosen = new Set(selection);
    const copies: string[] = [];
    let z = topZ();
    history.set((current) => ({
      ...current,
      sections: current.sections.map((section) => ({
        ...section,
        elements: section.elements.flatMap((element) => {
          if (!chosen.has(element.id)) return [element];
          const box = boxOf(element);
          const copy: DocumentElement = {
            ...structuredClone(element),
            id: crypto.randomUUID(),
            x: round(Math.min(box.x + 5, page.width - box.w)),
            y: round(Math.min(box.y + 5, page.height - box.h)),
            zIndex: (z += 1),
          };
          copies.push(copy.id);
          return [element, copy];
        }),
      })),
    }));
    setSelection(copies);
  };

  const rectsOf = (ids: string[]) => ids.map((id) => boxOf(elements.find((element) => element.id === id)!));

  const applyRects = (ids: string[], rects: Rect[]) =>
    patchElements(Object.fromEntries(ids.map((id, index) => [id, { x: rects[index]!.x, y: rects[index]!.y }])));

  const align = (mode: AlignMode) => applyRects(selection, alignRects(rectsOf(selection), mode, page));
  const distribute = (axis: "horizontal" | "vertical") => applyRects(selection, distributeRects(rectsOf(selection), axis));

  const layer = (op: LayerOp) => {
    const order = reorderLayers(elements.map((element) => element.id), selection, op);
    patchElements(Object.fromEntries(order.map((id, index) => [id, { zIndex: index }])));
  };

  const nudge = (dx: number, dy: number) => {
    const rects = rectsOf(selection);
    const patches: Record<string, Partial<DocumentElement>> = {};
    selection.forEach((id, index) => {
      const rect = rects[index]!;
      patches[id] = {
        x: round(Math.min(Math.max(0, rect.x + dx), page.width - rect.w)),
        y: round(Math.min(Math.max(0, rect.y + dy), page.height - rect.h)),
      };
    });
    patchElements(patches, { key: `nudge:${selection.join(",")}` });
  };

  const handleSave = async () => {
    if (!activeId || !schema) return;
    setSaving(true);
    try {
      const result = await api.post<{ version: { version: number }; warnings: string[] }>(
        `/api/documents/templates/${activeId}/versions`,
        { schema },
      );
      setSaved(schema);
      setConverted(false);
      setDraft(null);
      try { localStorage.removeItem(draftKey(activeId)); } catch { /* e'tiborsiz */ }
      // Yangi versiya — shu holatning o'zi; qayta yuklab ustiga yozmaymiz
      setLoadedFor(null);
      await detail.refetch();
      toast.success(`${result.version.version}-versiya saqlandi`);
      for (const warning of result.warnings.slice(0, 3)) toast.warning(warning);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  // Klaviatura: Ctrl+Z/Y, Delete, Esc, strelkalar, Ctrl+D/S/A
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    keyHandler.current = (event: KeyboardEvent) => {
      if (!schema || isTyping(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === "s") {
        event.preventDefault();
        if (dirty && canManage) void handleSave();
        return;
      }
      if (!canManage) return;
      if (mod && key === "z" && !event.shiftKey) { event.preventDefault(); history.undo(); return; }
      if (mod && (key === "y" || (key === "z" && event.shiftKey))) { event.preventDefault(); history.redo(); return; }
      if (mod && key === "a") { event.preventDefault(); setSelection(elements.map((element) => element.id)); return; }
      if (event.key === "Escape") { setSelection([]); return; }
      if (selection.length === 0) return;
      if (mod && key === "d") { event.preventDefault(); duplicateSelected(); return; }
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); removeSelected(); return; }
      const step = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const move = moves[event.key];
      if (move) {
        event.preventDefault();
        nudge(move[0], move[1]);
      }
    };
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandler.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const openPdf = async () => {
    if (!schema) return;
    try {
      const { renderTemplate } = await import("@/lib/pdf/template-renderer.ts");
      const doc = await renderTemplate(schema, sample);
      setPdfUrl(doc.output("bloburl") as unknown as string);
    } catch (error) {
      toast.error(`PDF xatosi: ${errorMessage(error)}`);
    }
  };

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
      history.reset(null);
      setSaved(null);
      setTemplateId(created.template.id);
      setLoadedFor(null);
      invalidate();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const templateAction = async (path: string, message: string, body?: object) => {
    if (!activeId) return;
    try {
      await api.post(`/api/documents/templates/${activeId}/${path}`, body ?? {});
      toast.success(message);
      invalidate();
      if (path === "restore") {
        history.reset(null);
        setSaved(null);
        setLoadedFor(null);
      }
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
      history.reset(null);
      setSaved(null);
      setLoadedFor(null);
      invalidate();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const switchTemplate = (id: string | null, type = documentType) => {
    history.reset(null);
    setSaved(null);
    setLoadedFor(null);
    setSelection([]);
    setDocumentType(type);
    setTemplateId(id);
  };

  // Hujjat balandligi — bir nechta nakladnoy bitta A4 ga nechtadan sig'adi
  const extent = useMemo(() => {
    const content = elements.filter((element) => !isPageFurniture(element));
    if (!schema || content.length === 0) return null;
    const rects = content.map((element) => {
      const box = boxOf(element);
      const natural = element.type === "itemsTable" ? sprites.get(element.id)?.natural ?? 0 : 0;
      return { top: box.y, bottom: box.y + Math.max(box.h, natural) };
    });
    const top = Math.min(...rects.map((rect) => rect.top));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    return { height: bottom - top, copies: copiesPerPage(top, bottom, page.height - schema.page.margins.bottom) };
  }, [schema, elements, sprites, page.height]);

  const readOnly = !canManage;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48">
          <Label className="text-xs">Hujjat turi</Label>
          <Select value={documentType} onValueChange={(value) => switchTemplate(null, value as DocumentType)}>
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
          <Select value={activeId ?? ""} onValueChange={(value) => switchTemplate(value)}>
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
        <div className="flex flex-wrap gap-2">
          {canManage && (
            <>
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
            </>
          )}
          <Button size="sm" variant="secondary" disabled={!schema} onClick={() => void openPdf()} data-testid="pdf-preview-open">
            <FileText className="mr-1.5 h-3.5 w-3.5" /> PDF
          </Button>
          {canManage && (
            <>
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
            </>
          )}
        </div>
        {dirty && <span className="pb-2 text-xs text-amber-600" data-testid="unsaved">● Saqlanmagan o'zgarish</span>}
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

      {draft && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" data-testid="draft-banner">
          <Info className="h-3.5 w-3.5" />
          Saqlanmagan qoralama topildi ({new Date(draft.at).toLocaleString("uz-UZ")}).
          <Button size="sm" variant="secondary" className="h-7" data-testid="draft-restore"
            onClick={() => { history.set(draft.schema); setDraft(null); }}>Tiklash</Button>
          <Button size="sm" variant="ghost" className="h-7"
            onClick={() => { if (activeId) try { localStorage.removeItem(draftKey(activeId)); } catch { /* e'tiborsiz */ } setDraft(null); }}>
            O'chirish
          </Button>
        </div>
      )}

      {converted && (
        <div className="flex items-start gap-2 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:bg-sky-950/40 dark:text-sky-200" data-testid="converted-banner">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Bu shablon <b>erkin joylashuvga</b> o'tkazildi: endi har elementni sichqoncha bilan surish va burchagidan
            tortib kattalashtirish mumkin. Ko'rinish o'zgarmadi. Saqlaganingizdan keyin nakladnoy aynan shu varaqdagidek chiqadi.
          </span>
        </div>
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

      {schema && (
        <DesignerToolbar
          catalog={catalog}
          readOnly={readOnly}
          selection={selection}
          textElement={selected && ["text", "field", "pageNumber"].includes(selected.type) ? selected : null}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          zoom={zoom}
          grid={grid}
          onInsert={insertKind}
          onInsertField={(path, label) => insert({ id: crypto.randomUUID(), type: "field", field: path, label })}
          onUndo={history.undo}
          onRedo={history.redo}
          onDuplicate={duplicateSelected}
          onDelete={removeSelected}
          onAlign={align}
          onDistribute={distribute}
          onLayer={layer}
          onZoom={setZoom}
          onGrid={setGrid}
          onStyle={(style) => selected && updateElement(selected.id, { style })}
        />
      )}

      {/*
        `minmax(0,1fr)` — `1fr` ning o'zi `minmax(auto,1fr)` degani, ya'ni ustun ichidagi eng
        tor kenglikdan pastga tushmaydi va o'ngdagi panel ekrandan chiqib ketardi.
      */}
      <div className="grid gap-3 lg:grid-cols-[210px_minmax(0,1fr)] xl:grid-cols-[210px_minmax(0,1fr)_300px]">
        {/* Qatlamlar — yuqoridagisi ustida chiziladi */}
        <div className="min-w-0 space-y-1 rounded-xl border border-border p-2" data-testid="layers-panel">
          <p className="mb-1 flex items-center gap-1.5 px-1 text-xs font-semibold"><Layers className="h-3.5 w-3.5" /> Qatlamlar</p>
          {[...elements].reverse().map((element) => (
            <button
              key={element.id}
              type="button"
              data-testid={`layer-${element.id}`}
              className={cn(
                "flex w-full items-center gap-1 truncate rounded-md border px-2 py-1 text-left text-[11px]",
                selection.includes(element.id) ? "border-primary bg-primary/5" : "border-transparent hover:bg-accent/50",
              )}
              onClick={(event) => {
                const additive = event.ctrlKey || event.metaKey || event.shiftKey;
                setSelection(additive
                  ? (selection.includes(element.id) ? selection.filter((id) => id !== element.id) : [...selection, element.id])
                  : [element.id]);
              }}
            >
              <span className="text-muted-foreground">{ELEMENT_LABELS[element.type]}</span>
              <span className="truncate">
                {element.label ? ` · ${element.label}` : ""}
                {element.field ? <code className="ml-1 text-[10px] text-muted-foreground">{`{{${element.field}}}`}</code> : null}
              </span>
            </button>
          ))}
          {elements.length === 0 && <p className="px-1 text-[11px] text-muted-foreground">Bo'sh varaq — yuqoridan element qo'shing</p>}
        </div>

        <div className="min-w-0 space-y-1.5">
          {schema ? (
            <DesignCanvas
              schema={schema}
              elements={elements}
              sprites={sprites}
              selection={selection}
              zoom={zoom}
              grid={grid}
              readOnly={readOnly}
              onSelect={setSelection}
              onBeginChange={history.checkpoint}
              onLiveChange={liveChange}
              onZoom={setZoom}
              onEditText={(id) => {
                setSelection([id]);
                window.setTimeout(() => document.querySelector<HTMLInputElement>("[data-testid=element-label]")?.focus(), 0);
              }}
            />
          ) : (
            <div className="flex h-[72vh] items-center justify-center rounded-lg border border-border text-sm text-muted-foreground">
              {activeId ? "Shablon ochilmoqda…" : "Shablon tanlang"}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-muted-foreground" data-testid="canvas-status">
            {selected && (() => {
              const box = boxOf(selected);
              return <span data-testid="selection-geometry">X {box.x} · Y {box.y} · {box.w} × {box.h} mm</span>;
            })()}
            {selection.length > 1 && <span>{selection.length} ta element tanlangan</span>}
            {extent && (
              <span data-testid="document-extent">
                Hujjat balandligi: {Math.round(extent.height)} mm — bitta A4 ga {extent.copies} ta sig'adi
              </span>
            )}
            {pending && <span>chizilmoqda…</span>}
            <span className="ml-auto hidden md:inline">Surish — sichqoncha · aniq — strelkalar (Shift ×10) · Ctrl+Z / Ctrl+Y · Delete · Esc</span>
          </div>
        </div>

        {/* Tanlangan element sozlamalari */}
        <div className="space-y-3 rounded-xl border border-border p-3 lg:col-span-2 xl:col-span-1" data-testid="properties-panel">
          {!selected && (
            <p className="text-xs text-muted-foreground">
              {selection.length > 1
                ? `${selection.length} ta element tanlangan — birga surish, tekislash, taqsimlash yoki o'chirish mumkin.`
                : "Varaqdagi elementni bosing. Sichqoncha bilan suring, burchagidan tortib kattalashtiring."}
            </p>
          )}
          {selected && (
            <ElementEditor
              element={selected}
              catalog={catalog}
              disabled={readOnly}
              maxImageLength={MAX_IMAGE_DATA_LENGTH}
              companyLogoUrl={activeCompany?.logoUrl}
              onChange={(patch) => updateElement(selected.id, patch)}
            />
          )}
        </div>
      </div>

      <Dialog open={pdfUrl !== null} onOpenChange={(open) => { if (!open && pdfUrl) { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); } }}>
        <DialogContent className="max-w-5xl">
          <DialogHeader><DialogTitle>PDF (namuna ma'lumot bilan) — chop etilganda aynan shunday</DialogTitle></DialogHeader>
          {pdfUrl && <iframe title="PDF" src={pdfUrl} data-testid="pdf-preview" className="h-[78vh] w-full rounded-lg border border-border bg-white" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
