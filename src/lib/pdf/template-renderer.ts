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
import type {
  BorderStyle, BoxStyle, DocumentElement, DocumentTemplateSchema, TableStyle, TextStyle, VisibilityCondition,
} from "@bum/shared";
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

/**
 * Chiziq naqshi (mm). `double` alohida ishlanadi — u ikki marta chiziladi.
 */
const dashPattern = (style: BorderStyle | undefined, width: number): number[] => {
  if (style === "dashed") return [Math.max(0.8, width * 4), Math.max(0.8, width * 3)];
  if (style === "dotted") return [Math.max(0.25, width), Math.max(0.6, width * 2.5)];
  return [];
};

/** Chiziq/ramka uslubini hujjatga qo'yadi va naqshni qaytaradi (keyin tozalash uchun). */
function applyStroke(doc: jsPDF, box: BoxStyle | undefined, fallbackWidth: number): number {
  const width = box?.borderWidth ?? fallbackWidth;
  doc.setDrawColor(...(box?.borderColor ? hexToRgb(box.borderColor) : PDF_COLORS.border));
  doc.setLineWidth(width);
  doc.setLineDashPattern(dashPattern(box?.borderStyle, width), 0);
  return width;
}

const clearStroke = (doc: jsPDF) => {
  doc.setLineDashPattern([], 0);
  doc.setLineWidth(0.2);
};

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

/**
 * Mahsulot jadvali — chiziqlari SHABLONDAN.
 *
 * Har katakning to'rt tomoni alohida hisoblanadi (autotable `lineWidth` obyektini qabul qiladi),
 * shuning uchun foydalanuvchi tashqi ramkani qoldirib ichki chiziqlarni o'chira oladi va aksincha.
 * Ichki chiziq IKKI MARTA chizilmaydi: gorizontal — yuqoridagi katakning "pastki" tomoni,
 * vertikal — o'ngdagi katakning "chap" tomoni sifatida chiziladi.
 */
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

  const table: TableStyle = element.table ?? {};
  const width = table.borderWidth ?? 0.2;
  const outer = table.outer ?? true;
  const side = {
    top: (table.top ?? outer) ? width : 0,
    bottom: (table.bottom ?? outer) ? width : 0,
    left: (table.left ?? outer) ? width : 0,
    right: (table.right ?? outer) ? width : 0,
  };
  const inner = { h: (table.horizontal ?? true) ? width : 0, v: (table.vertical ?? true) ? width : 0 };
  const headerLine = (table.headerBorder ?? true) ? width : 0;
  const lastColumn = columns.length - 1;
  const lastRow = body.length - 1;
  const dash = dashPattern(table.borderStyle, width);
  const base = tableOptions(ctx.doc, ctx.data.company, ctx.header, columnStyles);
  /** Jadval haqiqatan qaysi kenglikda chizilgani — `double` ramkasi aynan shunga qo'yiladi. */
  const bounds = { left: Number.POSITIVE_INFINITY, right: Number.NEGATIVE_INFINITY };

  // Katak ichidagi bo'shliq: berilmasa autotable standarti qoladi
  const padding =
    table.paddingX !== undefined || table.paddingY !== undefined
      ? { top: table.paddingY ?? 1.76, bottom: table.paddingY ?? 1.76, left: table.paddingX ?? 1.76, right: table.paddingX ?? 1.76 }
      : undefined;

  autoTable(ctx.doc, {
    ...base,
    startY: ctx.y,
    head,
    body,
    headStyles: {
      ...base.headStyles,
      ...(table.headerFill ? { fillColor: hexToRgb(table.headerFill) } : {}),
      ...(table.headerText ? { textColor: hexToRgb(table.headerText) } : {}),
      ...(table.fontSize ? { fontSize: table.fontSize } : {}),
    },
    bodyStyles: {
      ...base.bodyStyles,
      ...(table.fontSize ? { fontSize: table.fontSize } : {}),
      ...(table.rowHeight ? { minCellHeight: table.rowHeight } : {}),
    },
    // Zebra o'chirilsa qatorlar bir xil oq bo'ladi
    alternateRowStyles: (table.zebra ?? true) ? base.alternateRowStyles : {},
    styles: {
      ...base.styles,
      lineColor: table.borderColor ? hexToRgb(table.borderColor) : PDF_COLORS.border,
      ...(table.valign ? { valign: table.valign } : {}),
      ...(padding ? { cellPadding: padding } : {}),
    },
    willDrawCell: (data: CellHookData) => {
      const isHead = data.section === "head";
      const column = data.column.index;
      const row = data.row.index;
      // autotable `lineWidth` uchun obyektni ham qabul qiladi (har tomon alohida)
      (data.cell.styles as { lineWidth: unknown }).lineWidth = {
        // Ichki gorizontal — faqat yuqoridagi katakning pastki tomoni bo'lib chiziladi
        top: isHead ? side.top : 0,
        // Qatorsiz jadvalda sarlavhaning pasti — jadvalning pastki chegarasi
        bottom: isHead ? (lastRow < 0 ? side.bottom : headerLine) : row === lastRow ? side.bottom : inner.h,
        left: column === 0 ? side.left : inner.v,
        right: column === lastColumn ? side.right : 0,
      };
      bounds.left = Math.min(bounds.left, data.cell.x);
      bounds.right = Math.max(bounds.right, data.cell.x + data.cell.width);
      ctx.doc.setLineDashPattern(dash, 0);
    },
    didDrawCell: () => { ctx.doc.setLineDashPattern([], 0); },
  });

  const finalY = (ctx.doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  // `double` — tashqi ramka ikki chiziq bo'lib ko'rinsin (autotable buni o'zi qila olmaydi)
  if (table.borderStyle === "double" && width > 0) {
    ctx.doc.setDrawColor(...(table.borderColor ? hexToRgb(table.borderColor) : PDF_COLORS.border));
    ctx.doc.setLineWidth(width);
    const gap = Math.max(0.6, width * 2);
    const left = Number.isFinite(bounds.left) ? bounds.left : ctx.left;
    const right = Number.isFinite(bounds.right) ? bounds.right : ctx.right;
    ctx.doc.rect(left - gap, ctx.y - gap, right - left + gap * 2, finalY - ctx.y + gap * 2);
    clearStroke(ctx.doc);
  }
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
        images[element.id] = await QRCode.toDataURL(value, {
          margin: element.qrMargin ?? 0,
          width: 256,
          errorCorrectionLevel: element.qrLevel ?? "M",
        });
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
