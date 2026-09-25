/**
 * Shablon JSON → A4 hujjat.
 *
 * Bu YANGI chizish dvigateli EMAS: hamma chizish `pdf-utils.ts` dagi mavjud funksiyalar bilan
 * bajariladi (sarlavha, jadval, jami qutisi, imzo, footer, sahifa bo'linishi). Shablon faqat
 * "qaysi element qayerda va qanday ko'rinsin" deydi.
 *
 * MOLIYAVIY YAXLITLIK: renderer qiymat HISOBLAMAYDI. U `DocumentData` dagi tayyor, serverdan
 * kelgan qiymatlarni joylashtiradi, xolos. Shablonda son yozib qo'yish imkoni yo'q — `text`
 * elementi faqat YORLIQ, `field` esa bog'lanish nomi.
 */
import type jsPDF from "jspdf";
import autoTable, { type CellHookData } from "jspdf-autotable";
import { isFreeLayout, type BoxStyle, type DocumentElement, type DocumentTemplateSchema } from "@bum/shared";
import {
  A4,
  PDF_COLORS,
  afterTable,
  contentBottom,
  createDocument,
  drawFooter,
  drawTotalsBox,
  ensureSpace,
  tableOptions,
  type TotalRow,
} from "./pdf-utils.ts";
import {
  DEFAULT_ROW_LABELS, applyStroke, applyStyle, buildCodeImages, clearStroke, hexToRgb, isVisible, itemsTableSetup, textX,
  type DocumentData,
} from "./template-common.ts";

export { isVisible, type DocumentData };

type RenderContext = {
  doc: jsPDF;
  data: DocumentData;
  left: number;
  right: number;
  y: number;
  /** Keyingi sahifalarda takrorlanadigan sarlavha (jadval bo'linganda). */
  header: { title: string; number: string; date: string };
  /** Element id → tayyor QR/shtrix-kod rasmi (data URL). */
  codeImages?: Record<string, string>;
  /** Erkin joylashuvga o'tkazishda: har element qayerda chizilgani. */
  trace?: TraceEntry[];
};

/** Oqim rejimida element chizilishidan oldingi va keyingi Y (erkin joylashuvga o'tkazish uchun). */
type TraceEntry = { element: DocumentElement | null; page: number; before: number; after: number };

function drawText(ctx: RenderContext, element: DocumentElement, value: string) {
  const { doc } = ctx;
  applyStyle(doc, element.style, element.type === "text" ? 10 : 9);
  const { x, align } = textX(doc, element.style, ctx.left, ctx.right);
  const lineHeight = (element.style?.fontSize ?? 10) * 0.42 + 1.5;
  const text = element.label && element.type === "field" ? `${element.label}: ${value}` : (value || element.label || "");
  if (!text) return;
  const lines = doc.splitTextToSize(text, ctx.right - ctx.left);
  ctx.y = ensureSpace(doc, ctx.y, lines.length * lineHeight + 1);
  doc.text(lines, x, ctx.y, { align });
  ctx.y += lines.length * lineHeight + 1;
}

/** Mahsulot jadvali (oqim rejimi) — sozlamasi `itemsTableSetup` dan, erkin rejim bilan bir xil. */
function drawItemsTable(ctx: RenderContext, element: DocumentElement) {
  const setup = itemsTableSetup(ctx.doc, element, ctx.data, ctx.header);
  if (!setup) return;
  autoTable(ctx.doc, { ...setup.options, startY: ctx.y });
  const finalY = (ctx.doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  setup.finish(ctx.y, finalY, { left: ctx.left, right: ctx.right });
  ctx.y = afterTable(ctx.doc);
}

function drawTotals(ctx: RenderContext, element: DocumentElement, source: Record<string, string>) {
  const labels = { ...DEFAULT_ROW_LABELS, ...ctx.data.rowLabels };
  const rows: TotalRow[] = (element.rows ?? [])
    .filter((key) => source[key] !== undefined)
    .map((key) => ({ label: labels[key] ?? key, value: source[key]!, bold: key === "total" }));
  if (rows.length === 0) return;
  ctx.y = drawTotalsBox(ctx.doc, ctx.y, rows, ctx.data.company, ctx.header);
}

/**
 * Imzo joylari — IXCHAM.
 *
 * Nega bu yerda o'z chizig'i bor (`pdf-utils.drawSignatures` o'rniga): u blokka 34 mm
 * ajratadi va tagiga yana bugungi sanani yozadi. Bitta A4 ga ikkita nakladnoy sig'ishi uchun
 * shuncha bo'sh joy ortiqcha edi; qalam uchun joy (qo'l bilan imzo qo'yish) qoladi, lekin
 * takroriy sana chizilmaydi. Boshqa (shablonsiz) hujjatlar eski ko'rinishida qoladi.
 *
 * Balandlikni foydalanuvchi o'zi bera oladi (`height`) — imzo uchun ko'proq joy kerak bo'lsa.
 */
function drawSignatureBlock(ctx: RenderContext, element: DocumentElement) {
  const labels = (element.label ?? "Topshirdi|Qabul qildi")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 4);
  if (labels.length === 0) return;
  const total = Math.min(Math.max(element.height ?? 22, 12), 70);
  // Chiziqdan yuqorisi — qo'l bilan imzo qo'yiladigan bo'sh joy
  const gap = Math.max(6, total - 8);
  ctx.y = ensureSpace(ctx.doc, ctx.y, total);
  const lineY = ctx.y + gap;
  const span = (ctx.right - ctx.left - (labels.length - 1) * 8) / labels.length;
  ctx.doc.setDrawColor(...PDF_COLORS.border);
  ctx.doc.setLineWidth(0.2);
  ctx.doc.setFont("helvetica", "normal");
  ctx.doc.setFontSize(element.style?.fontSize ?? 8);
  ctx.doc.setTextColor(...PDF_COLORS.textMuted);
  labels.forEach((label, index) => {
    const x = ctx.left + index * (span + 8);
    ctx.doc.line(x, lineY, x + span, lineY);
    ctx.doc.text(label, x + span / 2, lineY + 4, { align: "center" });
  });
  ctx.y = lineY + 6;
}

/** Ramka chiziladimi (kengligi 0 bo'lsa — yo'q). */
const hasBorder = (box: BoxStyle | undefined) => (box?.borderWidth ?? 0) > 0;

/**
 * Rasm — data URL. Tashqi tarmoqqa chiqmaydi (server ham faqat data URL ga ruxsat beradi).
 *
 * `fit: "contain"` — rasm nisbati saqlanadi va katak ichiga sig'diriladi; `"fill"` — cho'ziladi.
 */
function drawImage(ctx: RenderContext, element: DocumentElement) {
  if (!element.imageData) return;
  const boxWidth = Math.min(element.width ?? 30, ctx.right - ctx.left);
  const boxHeight = element.height ?? boxWidth * 0.5;
  ctx.y = ensureSpace(ctx.doc, ctx.y, boxHeight + 2);
  const align = element.style?.align ?? "left";
  const boxX = align === "center" ? (ctx.left + ctx.right) / 2 - boxWidth / 2 : align === "right" ? ctx.right - boxWidth : ctx.left;

  if (element.box?.fill) {
    ctx.doc.setFillColor(...hexToRgb(element.box.fill));
    ctx.doc.roundedRect(boxX, ctx.y, boxWidth, boxHeight, element.box.radius ?? 0, element.box.radius ?? 0, "F");
  }

  let x = boxX;
  let y = ctx.y;
  let width = boxWidth;
  let height = boxHeight;
  if ((element.fit ?? "contain") === "contain") {
    try {
      const props = ctx.doc.getImageProperties(element.imageData);
      const scale = Math.min(boxWidth / props.width, boxHeight / props.height);
      width = props.width * scale;
      height = props.height * scale;
      x = boxX + (boxWidth - width) / 2;
      y = ctx.y + (boxHeight - height) / 2;
    } catch {
      // O'lchamini o'qib bo'lmasa katakni to'liq egallaydi
    }
  }
  try {
    ctx.doc.addImage(element.imageData, x, y, width, height);
  } catch {
    // Buzuq rasm butun hujjatni yiqitmasin — joyi bo'sh qoladi
  }
  if (hasBorder(element.box)) {
    applyStroke(ctx.doc, element.box, 0.2);
    ctx.doc.roundedRect(boxX, ctx.y, boxWidth, boxHeight, element.box?.radius ?? 0, element.box?.radius ?? 0);
    clearStroke(ctx.doc);
  }
  ctx.y += boxHeight + 2;
}

/** QR yoki shtrix-kod: matn OLDINDAN tayyorlangan data URL ko'rinishida keladi. */
function drawCode(ctx: RenderContext, element: DocumentElement) {
  const image = ctx.codeImages?.[element.id];
  if (!image) return;
  const size = Math.min(element.width ?? (element.type === "qr" ? 22 : 50), ctx.right - ctx.left);
  const height = element.type === "qr" ? size : (element.height ?? 14);
  const caption = element.label ? 4 : 0;
  ctx.y = ensureSpace(ctx.doc, ctx.y, height + caption + 2);
  const align = element.style?.align ?? "left";
  const x = align === "center" ? (ctx.left + ctx.right) / 2 - size / 2 : align === "right" ? ctx.right - size : ctx.left;
  try {
    ctx.doc.addImage(image, x, ctx.y, size, height);
  } catch {
    // e'tiborsiz
  }
  if (element.label) {
    ctx.doc.setFont("helvetica", "normal");
    ctx.doc.setFontSize(element.style?.fontSize ?? 7.5);
    ctx.doc.setTextColor(...PDF_COLORS.textMuted);
    ctx.doc.text(element.label, x + size / 2, ctx.y + height + 3, { align: "center" });
  }
  ctx.y += height + caption + 2;
}

/** Ajratuvchi chiziq — qalinligi, ko'rinishi va uzunligi shablondan. */
function drawLine(ctx: RenderContext, element?: DocumentElement) {
  ctx.y = ensureSpace(ctx.doc, ctx.y, 4);
  const full = ctx.right - ctx.left;
  const length = Math.min(element?.width ?? full, full);
  const align = element?.style?.align ?? "left";
  const x = align === "center" ? (ctx.left + ctx.right) / 2 - length / 2 : align === "right" ? ctx.right - length : ctx.left;
  applyStroke(ctx.doc, element?.box, 0.2);
  ctx.doc.line(x, ctx.y, x + length, ctx.y);
  clearStroke(ctx.doc);
  ctx.y += 3;
}

/** To'rtburchak — ramka yoki bo'yalgan quti (izoh joyi, imzo katagi). */
function drawRect(ctx: RenderContext, element: DocumentElement) {
  const full = ctx.right - ctx.left;
  const width = Math.min(element.width ?? full, full);
  const height = Math.min(element.height ?? 20, 200);
  ctx.y = ensureSpace(ctx.doc, ctx.y, height + 2);
  const align = element.style?.align ?? "left";
  const x = align === "center" ? (ctx.left + ctx.right) / 2 - width / 2 : align === "right" ? ctx.right - width : ctx.left;
  const radius = element.box?.radius ?? 0;
  if (element.box?.fill) {
    ctx.doc.setFillColor(...hexToRgb(element.box.fill));
    ctx.doc.roundedRect(x, ctx.y, width, height, radius, radius, "F");
  }
  if (hasBorder(element.box) || !element.box?.fill) {
    applyStroke(ctx.doc, element.box, 0.3);
    ctx.doc.roundedRect(x, ctx.y, width, height, radius, radius);
    clearStroke(ctx.doc);
  }
  if (element.label) {
    ctx.doc.setFont("helvetica", "normal");
    ctx.doc.setFontSize(element.style?.fontSize ?? 8);
    ctx.doc.setTextColor(...PDF_COLORS.textMuted);
    ctx.doc.text(element.label, x + 2, ctx.y + 5);
  }
  ctx.y += height + 2;
}

function renderElement(ctx: RenderContext, element: DocumentElement) {
  if (!isVisible(element.visibleWhen, ctx.data)) return;
  switch (element.type) {
    case "text":
      drawText(ctx, element, "");
      break;
    case "field":
      drawText(ctx, element, ctx.data.values[element.field ?? ""] ?? "");
      break;
    case "itemsTable":
      drawItemsTable(ctx, element);
      break;
    case "totals":
      drawTotals(ctx, element, ctx.data.totals);
      break;
    case "payments":
      drawTotals(ctx, element, ctx.data.payments ?? {});
      break;
    case "signatures":
      drawSignatureBlock(ctx, element);
      break;
    case "image":
      drawImage(ctx, element);
      break;
    case "qr":
    case "barcode":
      drawCode(ctx, element);
      break;
    case "line":
      drawLine(ctx, element);
      break;
    case "rect":
      drawRect(ctx, element);
      break;
    case "spacer":
      ctx.y += Math.min(element.height ?? 4, 40);
      break;
    // `pageNumber` — hamma sahifa chizilgandan keyin (jami soni shunda ma'lum)
    default:
      break;
  }
}

/** Shablonda "sahifa raqami" elementi bormi — taglik o'z raqamini chizmasligi uchun. */
const pageNumberElement = (schema: DocumentTemplateSchema) =>
  schema.sections.flatMap((section) => section.elements).find((item) => item.type === "pageNumber");

/** Hamma sahifa chizilgandan keyin: "1 / 3". Jami soni faqat shu payt ma'lum. */
function drawPageNumbers(doc: jsPDF, schema: DocumentTemplateSchema) {
  const element = pageNumberElement(schema);
  if (!element) return;
  const total = doc.getNumberOfPages();
  const width = doc.internal.pageSize.getWidth();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(element.style?.fontSize ?? 8);
    doc.setTextColor(...PDF_COLORS.textMuted);
    const align = element.style?.align ?? "right";
    const x = align === "center" ? width / 2 : align === "left" ? A4.marginX : width - A4.marginX;
    // Taglik tasmasi `A4.height - A4.footerHeight + 4` dan boshlanadi — raqam uning USTIDA
    doc.text(`${page} / ${total}`, x, contentBottom() + 3, { align });
  }
}

/**
 * Bitta hujjatni MAVJUD PDF ichiga chizadi va tugagan Y ni qaytaradi.
 *
 * Nega shu kerak: bir nechta nakladnoyni alohida PDF qilib, keyin sahifasini nusxalash
 * MUMKIN EMAS. Har PDF o'ziga faqat ISHLATGAN gliflarini joylaydi; nusxalangan sahifadagi
 * glif raqamlari boshqa to'plamga tegib, harflar yo'qoladi (2026-09-25: "42,200" → "2,200",
 * kirill nomlar teshik bo'lib chiqqan). Shuning uchun hammasi BITTA hujjat ichida chiziladi.
 */
async function drawDocumentInto(
  doc: jsPDF,
  schema: DocumentTemplateSchema,
  data: DocumentData,
  startY: number,
  trace?: TraceEntry[],
): Promise<number> {
  const codeImages = await buildCodeImages(schema.sections.flatMap((section) => section.elements), data);
  const left = schema.page.margins.left || A4.marginX;
  const right = doc.internal.pageSize.getWidth() - (schema.page.margins.right || A4.marginX);
  const headerSection = schema.sections.find((section) => section.key === "header");
  const title = headerSection?.elements.find((element) => element.type === "text")?.label ?? "HUJJAT";
  const ctx: RenderContext = {
    doc,
    data,
    left,
    right,
    y: startY,
    header: { title, number: data.values["document.number"] ?? "", date: data.values["document.date"] ?? "" },
    codeImages,
    trace,
  };

  const traced = (element: DocumentElement | null, draw: () => void) => {
    const before = ctx.y;
    const page = doc.getCurrentPageInfo().pageNumber;
    draw();
    ctx.trace?.push({ element, page, before, after: ctx.y });
  };
  for (const section of schema.sections) {
    if (section.key === "footer") continue;
    for (const element of section.elements) traced(element, () => renderElement(ctx, element));
    if (section.key === "header") traced(null, () => drawLine(ctx));
  }
  const footer = schema.sections.find((section) => section.key === "footer");
  if (footer) for (const element of footer.elements) traced(element, () => renderElement(ctx, element));
  return ctx.y;
}

/** Bitta hujjat — o'z sahifasida (mavjud chaqiruvchilar shuni ishlatadi). */
export async function renderTemplate(schema: DocumentTemplateSchema, data: DocumentData): Promise<jsPDF> {
  if (isFreeLayout(schema)) return (await import("./template-free.ts")).renderFreeTemplate(schema, data);
  const doc = await createDocument({ orientation: schema.page.orientation });
  await drawDocumentInto(doc, schema, data, schema.page.margins.top || A4.marginX);
  drawFooter(doc, undefined, { pageNumbers: !pageNumberElement(schema) });
  drawPageNumbers(doc, schema);
  return doc;
}

/** Hujjatlar orasidagi ajratgich — qayerda biri tugab, ikkinchisi boshlangani ko'rinsin. */
function drawSeparator(doc: jsPDF, y: number, schema: DocumentTemplateSchema): number {
  const left = schema.page.margins.left || A4.marginX;
  const right = doc.internal.pageSize.getWidth() - (schema.page.margins.right || A4.marginX);
  const at = y + 4;
  doc.setDrawColor(...PDF_COLORS.border);
  doc.setLineWidth(0.2);
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.line(left, at, right, at);
  doc.setLineDashPattern([], 0);
  return at + 6;
}

export type PackMode = "smart" | "full";

/** O'lchash natijasi: hujjat qancha joy oladi va bitta sahifaga sig'adimi. */
type Measured = { height: number; multiPage: boolean };

/**
 * Hujjat balandligini O'LCHAYDI — chetga tashlanadigan nusxada chizib ko'radi.
 *
 * CSS `scale` yoki taxminiy hisob ishlatilmaydi: balandlik matn uzunligi, jadval qatorlari va
 * shrift bilan bog'liq, shuning uchun yagona ishonchli yo'l — haqiqatan chizib ko'rish.
 */
export async function measureDocument(schema: DocumentTemplateSchema, data: DocumentData): Promise<Measured> {
  if (isFreeLayout(schema)) return (await import("./template-free.ts")).measureFreeDocument(schema, data);
  const probe = await createDocument({ orientation: schema.page.orientation });
  const top = schema.page.margins.top || A4.marginX;
  const end = await drawDocumentInto(probe, schema, data, top);
  const pages = probe.getNumberOfPages();
  return { height: pages > 1 ? Number.POSITIVE_INFINITY : end - top, multiPage: pages > 1 };
}

/**
 * Bir nechta hujjat — A4 varaqlarga AQLLI joylashtiriladi.
 *
 * Qoidalar:
 *  1. Hujjat O'RTASIDAN bo'linmaydi: sig'masa butunlay keyingi sahifaga o'tadi.
 *  2. Sig'sa — o'sha sahifada, ajratgich chizig'i bilan davom etadi.
 *  3. Bitta sahifaga sig'maydigan uzun hujjat (50+ mahsulot) o'z sahifasidan boshlanadi.
 *  4. Tartib foydalanuvchi tanlagan tartibda qoladi (birinchi-mos, qayta saralamaydi).
 *  5. Kichraytirish YO'Q — o'qilishi muhimroq; sig'masa keyingi varaq.
 *
 * `mode: "full"` — eski xulq: har hujjat o'z sahifasida.
 */
export async function renderDocuments(
  schema: DocumentTemplateSchema,
  list: DocumentData[],
  mode: PackMode = "smart",
): Promise<jsPDF> {
  if (isFreeLayout(schema)) return (await import("./template-free.ts")).renderFreeDocuments(schema, list, mode);
  const doc = await createDocument({ orientation: schema.page.orientation });
  const top = schema.page.margins.top || A4.marginX;
  const bottom = contentBottom();
  let y = top;

  for (const [index, data] of list.entries()) {
    if (index > 0) {
      let newPage = true;
      if (mode === "smart") {
        const measured = await measureDocument(schema, data);
        // Sig'sa — shu sahifada davom etadi
        newPage = measured.multiPage || y + 10 + measured.height > bottom;
      }
      if (newPage) {
        doc.addPage();
        y = top;
      } else {
        y = drawSeparator(doc, y, schema);
      }
    }
    y = await drawDocumentInto(doc, schema, data, y);
  }

  drawFooter(doc, undefined, { pageNumbers: !pageNumberElement(schema) });
  drawPageNumbers(doc, schema);
  return doc;
}

/**
 * Oqim shablonini ERKIN JOYLASHUVGA o'tkazadi — ko'rinishi o'zgarmasin.
 *
 * Taxmin qilinmaydi: shablon namuna ma'lumot bilan HAQIQATAN chiziladi va har element qaysi
 * Y oralig'ini egallagani yozib olinadi. Shu joylar elementning `x/y/width/height` iga
 * aylanadi, ya'ni dizaynerni ochgan foydalanuvchi o'zining eski nakladnoyini o'sha joyida
 * ko'radi va darhol sichqoncha bilan sura boshlaydi.
 */
export async function convertToFreeLayout(schema: DocumentTemplateSchema, data: DocumentData): Promise<DocumentTemplateSchema> {
  if (isFreeLayout(schema)) return schema;
  const doc = await createDocument({ orientation: schema.page.orientation });
  const trace: TraceEntry[] = [];
  await drawDocumentInto(doc, schema, data, schema.page.margins.top || A4.marginX, trace);
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const left = schema.page.margins.left || A4.marginX;
  const right = pageWidth - (schema.page.margins.right || A4.marginX);
  const full = right - left;
  const round = (value: number) => Math.round(value * 10) / 10;
  const alignX = (width: number, align: string | undefined) =>
    align === "center" ? (left + right) / 2 - width / 2 : align === "right" ? right - width : left;
  /** Keyingi sahifaga o'tgan (namunada kam uchraydi) element — birinchi sahifaning pastiga. */
  const pageShift = (page: number) => (page - 1) * (pageHeight - 40);
  const MM_PER_PT = 25.4 / 72;

  const converted = new Map<string, DocumentElement>();
  const extra: DocumentElement[] = [];
  trace.forEach((entry, order) => {
    const before = entry.before + pageShift(entry.page);
    const after = entry.after + pageShift(entry.page);
    const element = entry.element;
    const box = (x: number, y: number, width: number, height: number) => ({
      x: round(Math.max(0, x)),
      y: round(Math.min(Math.max(0, y), pageHeight - 2)),
      width: round(Math.max(1, width)),
      height: round(Math.max(1, height)),
      zIndex: order,
    });
    if (!element) {
      // Sarlavhadan keyingi ajratuvchi chiziq — endi oddiy (suriladigan) element
      extra.push({ id: crypto.randomUUID(), type: "line", ...box(left, before - 1, full, 2) });
      return;
    }
    const align = element.style?.align;
    switch (element.type) {
      case "text":
      case "field": {
        const size = (element.style?.fontSize ?? (element.type === "text" ? 10 : 9)) * MM_PER_PT;
        converted.set(element.id, { ...element, ...box(left, before - size * 0.8, full, Math.max(after - before - 1, size * 1.2)) });
        break;
      }
      case "itemsTable":
        converted.set(element.id, { ...element, ...box(left, before, full, Math.max(10, after - 6 - before)) });
        break;
      case "totals":
      case "payments":
        converted.set(element.id, { ...element, ...box(A4.width - A4.marginX - 73, before - 2, 75, Math.max(10, after - before)) });
        break;
      case "signatures":
        converted.set(element.id, { ...element, ...box(left, before, full, Math.max(12, after - before)) });
        break;
      case "image": {
        const width = Math.min(element.width ?? 30, full);
        converted.set(element.id, { ...element, ...box(alignX(width, align), before, width, element.height ?? width * 0.5) });
        break;
      }
      case "qr":
      case "barcode": {
        const size = Math.min(element.width ?? (element.type === "qr" ? 22 : 50), full);
        const height = (element.type === "qr" ? size : (element.height ?? 14)) + (element.label ? 4 : 0);
        converted.set(element.id, { ...element, ...box(alignX(size, align), before, size, height) });
        break;
      }
      case "line": {
        const width = Math.min(element.width ?? full, full);
        converted.set(element.id, { ...element, ...box(alignX(width, align), before - 1, width, 2) });
        break;
      }
      case "rect": {
        const width = Math.min(element.width ?? full, full);
        converted.set(element.id, { ...element, ...box(alignX(width, align), before, width, Math.min(element.height ?? 20, 200)) });
        break;
      }
      case "pageNumber":
        converted.set(element.id, { ...element, ...box(alignX(30, align ?? "right"), contentBottom() - 2, 30, 5) });
        break;
      default:
        // `spacer` — erkin joylashuvda kerak emas (bo'sh joy sichqoncha bilan qoldiriladi)
        break;
    }
  });

  return {
    ...schema,
    page: { ...schema.page, margins: { ...schema.page.margins }, layout: "free" },
    sections: schema.sections.map((section) => ({
      key: section.key,
      elements: [
        ...section.elements.flatMap((element) => (converted.has(element.id) ? [converted.get(element.id)!] : [])),
        ...(section.key === "header" ? extra : []),
      ],
    })),
  };
}
