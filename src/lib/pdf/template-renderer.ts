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
import autoTable from "jspdf-autotable";
import type { DocumentElement, DocumentTemplateSchema, TextStyle, VisibilityCondition } from "@bum/shared";
import {
  A4,
  PDF_COLORS,
  afterTable,
  contentBottom,
  createDocument,
  drawFooter,
  drawSignatures,
  drawTotalsBox,
  ensureSpace,
  tableOptions,
  type CompanyInfo,
  type TotalRow,
} from "./pdf-utils.ts";

/**
 * Hujjatning TAYYOR ma'lumoti. Har bir hujjat turi (nakladnoy, hisob-faktura) shuni quradi;
 * qiymatlar allaqachon formatlangan satr bo'ladi — renderer ularni o'zgartirmaydi.
 */
export type DocumentData = {
  company: CompanyInfo;
  /** Maydon yo'li → ko'rsatiladigan qiymat: `{"customer.name": "Test Market"}`. */
  values: Record<string, string>;
  /** Jadval qatorlari: ustun kaliti → qiymat. */
  items: Record<string, string>[];
  /** Jami bloki qatorlari: `{"total": "42 200 so'm"}`. */
  totals: Record<string, string>;
  /** To'lov usullari bo'yicha: `{"cash": "500 000"}`. */
  payments?: Record<string, string>;
  /** Shart tekshiruvi uchun SON qiymatlar (`finance.debt` > 0). */
  numbers?: Record<string, number>;
  /** Ustun sarlavhalari uchun standart nomlar. */
  columnLabels?: Record<string, string>;
  /** Jami va to'lov qatorlarining nomlari. */
  rowLabels?: Record<string, string>;
  /** QR va shtrix-kod ichiga yoziladigan qiymatlar (faqat shu manbalardan). */
  codes?: Partial<Record<"documentNumber" | "orderNumber" | "customerPhone", string>>;
};

const DEFAULT_ROW_LABELS: Record<string, string> = {
  subtotal: "Oraliq summa",
  discount: "Chegirma",
  tax: "Soliq",
  total: "Jami",
  paid: "To'langan",
  debt: "Qarz",
  cash: "Naqd",
  card: "Karta",
  bank: "Bank",
  transfer: "O'tkazma",
};

const hexToRgb = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

/** Shart bajarildimi. Faqat tuzilmali taqqoslash — ifoda bajarilmaydi. */
export function isVisible(condition: VisibilityCondition | undefined, data: DocumentData): boolean {
  if (!condition) return true;
  const raw = data.values[condition.field];
  const numeric = data.numbers?.[condition.field];
  switch (condition.operator) {
    case "empty":
      return !raw;
    case "notEmpty":
      return Boolean(raw);
    case "eq":
      return String(raw ?? "") === String(condition.value ?? "");
    case "ne":
      return String(raw ?? "") !== String(condition.value ?? "");
    default: {
      const left = numeric ?? Number(raw);
      const right = Number(condition.value);
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
      if (condition.operator === "gt") return left > right;
      if (condition.operator === "gte") return left >= right;
      if (condition.operator === "lt") return left < right;
      return left <= right;
    }
  }
}

function applyStyle(doc: jsPDF, style: TextStyle | undefined, fallbackSize = 9) {
  doc.setFontSize(style?.fontSize ?? fallbackSize);
  doc.setFont("helvetica", style?.bold ? "bold" : style?.italic ? "italic" : "normal");
  const color = style?.color ? hexToRgb(style.color) : PDF_COLORS.textDark;
  doc.setTextColor(...color);
}

/** Matn qaysi X dan boshlanadi (tekislashga qarab). */
function textX(doc: jsPDF, style: TextStyle | undefined, left: number, right: number): { x: number; align: "left" | "center" | "right" } {
  const align = style?.align ?? "left";
  if (align === "center") return { x: (left + right) / 2, align };
  if (align === "right") return { x: right, align };
  return { x: left, align };
}

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
};

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

function drawItemsTable(ctx: RenderContext, element: DocumentElement) {
  const columns = element.columns ?? [];
  if (columns.length === 0) return;
  const labels = ctx.data.columnLabels ?? {};
  const head = [columns.map((column) => column.label ?? labels[column.key] ?? column.key)];
  const body = ctx.data.items.map((item, index) =>
    columns.map((column) => (column.key === "index" ? String(index + 1) : (item[column.key] ?? ""))),
  );
  // Ustun tekislash va kengligi shablondan; qolganini autotable o'zi taqsimlaydi
  const columnStyles: Record<number, { halign?: "left" | "center" | "right"; cellWidth?: number }> = {};
  columns.forEach((column, index) => {
    const style: { halign?: "left" | "center" | "right"; cellWidth?: number } = {};
    if (column.align) style.halign = column.align;
    if (column.width) style.cellWidth = column.width;
    if (Object.keys(style).length > 0) columnStyles[index] = style;
  });

  autoTable(ctx.doc, {
    ...tableOptions(ctx.doc, ctx.data.company, ctx.header, columnStyles),
    startY: ctx.y,
    head,
    body,
  });
  ctx.y = afterTable(ctx.doc);
}

function drawTotals(ctx: RenderContext, element: DocumentElement, source: Record<string, string>) {
  const labels = { ...DEFAULT_ROW_LABELS, ...ctx.data.rowLabels };
  const rows: TotalRow[] = (element.rows ?? [])
    .filter((key) => source[key] !== undefined)
    .map((key) => ({ label: labels[key] ?? key, value: source[key]!, bold: key === "total" }));
  if (rows.length === 0) return;
  ctx.y = ensureSpace(ctx.doc, ctx.y, rows.length * 6 + 10);
  ctx.y = drawTotalsBox(ctx.doc, ctx.y, rows);
}

function drawSignatureBlock(ctx: RenderContext, element: DocumentElement) {
  // Yorliq "Topshirdi|Qabul qildi" ko'rinishida — foydalanuvchi o'zi yozadi
  const labels = (element.label ?? "Topshirdi|Qabul qildi")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 4);
  if (labels.length === 0) return;
  // Mavjud dvigatel ikkita imzo joyini chizadi; shablon yorliqlarini o'shanga beramiz
  const pair: [string, string] = [labels[0] ?? "Topshirdi", labels[1] ?? "Qabul qildi"];
  ctx.y = drawSignatures(ctx.doc, ctx.y, ctx.data.company, ctx.header, pair);
}

/** Rasm — data URL. Tashqi tarmoqqa chiqmaydi (server ham faqat data URL ga ruxsat beradi). */
function drawImage(ctx: RenderContext, element: DocumentElement) {
  if (!element.imageData) return;
  const width = Math.min(element.width ?? 30, ctx.right - ctx.left);
  const height = element.height ?? width * 0.5;
  ctx.y = ensureSpace(ctx.doc, ctx.y, height + 2);
  const align = element.style?.align ?? "left";
  const x = align === "center" ? (ctx.left + ctx.right) / 2 - width / 2 : align === "right" ? ctx.right - width : ctx.left;
  try {
    ctx.doc.addImage(element.imageData, x, ctx.y, width, height);
  } catch {
    // Buzuq rasm butun hujjatni yiqitmasin — joyi bo'sh qoladi
  }
  ctx.y += height + 2;
}

/** QR yoki shtrix-kod: matn OLDINDAN tayyorlangan data URL ko'rinishida keladi. */
function drawCode(ctx: RenderContext, element: DocumentElement) {
  const image = ctx.codeImages?.[element.id];
  if (!image) return;
  const size = Math.min(element.width ?? (element.type === "qr" ? 22 : 50), ctx.right - ctx.left);
  const height = element.type === "qr" ? size : (element.height ?? 14);
  ctx.y = ensureSpace(ctx.doc, ctx.y, height + 2);
  const align = element.style?.align ?? "left";
  const x = align === "center" ? (ctx.left + ctx.right) / 2 - size / 2 : align === "right" ? ctx.right - size : ctx.left;
  try {
    ctx.doc.addImage(image, x, ctx.y, size, height);
  } catch {
    // e'tiborsiz
  }
  ctx.y += height + 2;
}

function drawLine(ctx: RenderContext) {
  ctx.y = ensureSpace(ctx.doc, ctx.y, 4);
  ctx.doc.setDrawColor(...PDF_COLORS.border);
  ctx.doc.line(ctx.left, ctx.y, ctx.right, ctx.y);
  ctx.y += 3;
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
      drawLine(ctx);
      break;
    case "spacer":
      ctx.y += Math.min(element.height ?? 4, 40);
      break;
    // `pageNumber` — hamma sahifa chizilgandan keyin (jami soni shunda ma'lum)
    default:
      break;
  }
}

/**
 * Shablonni chizadi va tayyor hujjatni qaytaradi.
 *
 * Sahifa bo'linishi mavjud dvigateldan: jadval o'zi bo'linadi va har sahifada sarlavhasini
 * takrorlaydi, bloklar esa `ensureSpace` bilan chetga chiqib ketmaydi.
 */
/**
 * Shablondagi QR va shtrix-kod elementlari uchun rasm tayyorlaydi.
 *
 * Kod ichiga FAQAT ro'yxatdagi manbadan qiymat tushadi (hujjat raqami, buyurtma raqami,
 * mijoz telefoni) — ixtiyoriy URL yoki matn emas, shuning uchun skanerlanganda begona
 * manzilga olib bormaydi.
 */
async function buildCodeImages(schema: DocumentTemplateSchema, data: DocumentData): Promise<Record<string, string>> {
  const elements = schema.sections.flatMap((section) => section.elements).filter((element) => element.type === "qr" || element.type === "barcode");
  if (elements.length === 0) return {};
  const images: Record<string, string> = {};
  for (const element of elements) {
    const value = element.qrSource ? data.codes?.[element.qrSource] : undefined;
    if (!value) continue;
    try {
      if (element.type === "qr") {
        const QRCode = (await import("qrcode")).default;
        images[element.id] = await QRCode.toDataURL(value, { margin: 0, width: 256 });
      } else {
        const JsBarcode = (await import("jsbarcode")).default;
        const canvas = document.createElement("canvas");
        JsBarcode(canvas, value, { format: "CODE128", displayValue: false, margin: 0, height: 60 });
        images[element.id] = canvas.toDataURL("image/png");
      }
    } catch {
      // Kod chizilmasa hujjat baribir chiqadi
    }
  }
  return images;
}

/** Hamma sahifa chizilgandan keyin: "1 / 3". Jami soni faqat shu payt ma'lum. */
function drawPageNumbers(doc: jsPDF, schema: DocumentTemplateSchema) {
  const element = schema.sections
    .flatMap((section) => section.elements)
    .find((item) => item.type === "pageNumber");
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
    doc.text(`${page} / ${total}`, x, contentBottom() + 10, { align });
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
): Promise<number> {
  const codeImages = await buildCodeImages(schema, data);
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
  };

  for (const section of schema.sections) {
    if (section.key === "footer") continue;
    for (const element of section.elements) renderElement(ctx, element);
    if (section.key === "header") drawLine(ctx);
  }
  const footer = schema.sections.find((section) => section.key === "footer");
  if (footer) for (const element of footer.elements) renderElement(ctx, element);
  return ctx.y;
}

/** Bitta hujjat — o'z sahifasida (mavjud chaqiruvchilar shuni ishlatadi). */
export async function renderTemplate(schema: DocumentTemplateSchema, data: DocumentData): Promise<jsPDF> {
  const doc = await createDocument({ orientation: schema.page.orientation });
  await drawDocumentInto(doc, schema, data, schema.page.margins.top || A4.marginX);
  drawFooter(doc);
  drawPageNumbers(doc, schema);
  return doc;
}

/** Hujjatlar orasidagi ajratgich — qayerda biri tugab, ikkinchisi boshlangani ko'rinsin. */
function drawSeparator(doc: jsPDF, y: number, schema: DocumentTemplateSchema): number {
  const left = schema.page.margins.left || A4.marginX;
  const right = doc.internal.pageSize.getWidth() - (schema.page.margins.right || A4.marginX);
  const at = y + 5;
  doc.setDrawColor(...PDF_COLORS.border);
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.line(left, at, right, at);
  doc.setLineDashPattern([], 0);
  return at + 7;
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
async function measureDocument(schema: DocumentTemplateSchema, data: DocumentData): Promise<Measured> {
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
        newPage = measured.multiPage || y + 5 + measured.height > bottom;
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

  drawFooter(doc);
  drawPageNumbers(doc, schema);
  return doc;
}
