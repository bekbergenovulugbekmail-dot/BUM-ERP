/**
 * ERKIN JOYLASHUV renderer'i — vizual dizaynerning PDF tomoni.
 *
 * Har element o'z qutisida (`x/y/width/height`, mm, sahifaning yuqori-chap burchagidan)
 * chiziladi. Dizayner ham elementlarni AYNAN SHU funksiyalar bilan chizadi (har elementni
 * alohida kichik sahifaga, keyin pdf.js bilan rasmga) — shuning uchun ekranda ko'ringani va
 * qog'ozga chiqqani piksel darajasida bir xil: ikkinchi, "o'xshatilgan" HTML ko'rinish yo'q.
 *
 * O'suvchi element — faqat mahsulot jadvali: haqiqiy hujjatda qator ko'p bo'lsa jadval
 * loyihadagi balandligidan uzayadi va UNING OSTIDAGI elementlar shuncha pastga suriladi
 * (yonidagilar joyida qoladi). Qisqarish yo'q: bo'sh joy qoladi, joylashuv o'zgarmaydi.
 *
 * MOLIYAVIY YAXLITLIK: bu yerda ham qiymat hisoblanmaydi — `DocumentData` dagi tayyor satrlar
 * joylashtiriladi, xolos.
 */
import type jsPDF from "jspdf";
import { __createTable, __drawTable, type Table } from "jspdf-autotable";
import { pageSizeMm, type DocumentElement, type DocumentTemplateSchema, type ElementType } from "@bum/shared";
import { A4, PDF_COLORS, createDocument } from "./pdf-utils.ts";
import {
  DEFAULT_ROW_LABELS, applyStroke, applyStyle, buildCodeImages, clearStroke, hexToRgb, isVisible, itemsTableSetup,
  type DocumentData,
} from "./template-common.ts";

/** Quti, mm. */
export type Box = { x: number; y: number; w: number; h: number };

/** Yangi element va eski (o'lchamsiz) shablon uchun standart o'lcham, mm. */
export const FREE_DEFAULT_SIZE: Record<ElementType, { w: number; h: number }> = {
  text: { w: 90, h: 8 },
  field: { w: 90, h: 6 },
  image: { w: 40, h: 20 },
  line: { w: 182, h: 2 },
  spacer: { w: 40, h: 4 },
  itemsTable: { w: 182, h: 30 },
  totals: { w: 75, h: 22 },
  payments: { w: 75, h: 22 },
  signatures: { w: 182, h: 22 },
  rect: { w: 80, h: 20 },
  qr: { w: 22, h: 22 },
  barcode: { w: 50, h: 14 },
  pageNumber: { w: 30, h: 5 },
};

/** Kod ostidagi yozuv uchun joy, mm. */
export const CODE_CAPTION = 4;

/** Elementning qutisi (berilmagan qiymat — standart). */
export function boxOf(element: DocumentElement): Box {
  const size = FREE_DEFAULT_SIZE[element.type];
  return {
    x: element.x ?? A4.marginX,
    y: element.y ?? A4.marginX,
    w: element.width ?? size.w,
    h: element.height ?? size.h,
  };
}

/** Chizish tartibi: qatlam bo'yicha, teng bo'lsa — shablondagi tartibda. */
export function freeElements(schema: DocumentTemplateSchema): DocumentElement[] {
  return schema.sections
    .flatMap((section) => section.elements)
    .map((element, order) => ({ element, order }))
    .sort((a, b) => (a.element.zIndex ?? 0) - (b.element.zIndex ?? 0) || a.order - b.order)
    .map((item) => item.element);
}

/**
 * Sahifa "jihozi" — hujjatga emas, VARAQQA tegishli (sahifa raqami). U hujjat balandligiga
 * kirmaydi va bitta varaqqa ikkita nakladnoy tushganda ikki marta chizilmaydi: loyihadagi
 * joyida, har varaqda bir marta. Aks holda pastdagi sahifa raqami har nakladnoyni butun
 * varaq balandligiga cho'zib, ikkitasini bitta A4 ga sig'dirmasdi.
 */
export const isPageFurniture = (element: DocumentElement) => element.type === "pageNumber";

/** Chiziq gorizontalmi (eni bo'yidan katta) yoki vertikal. */
export const isHorizontalLine = (box: Pick<Box, "w" | "h">) => box.w >= box.h;

/**
 * Surilish — SOF funksiya (dizayner ham, renderer ham ishlatadi).
 *
 * `natural` — o'suvchi elementning haqiqiy balandligi (id → mm). Element pastga suriladi, agar
 * uning tepasi o'suvchi elementning LOYIHADAGI pastidan pastda bo'lsa; surilish — o'sha
 * elementlarning o'sishi yig'indisi. Qaytadi: id → surilish (mm, ≥ 0).
 */
export function layoutShifts(
  items: { id: string; y: number; h: number }[],
  natural: Record<string, number>,
): Record<string, number> {
  const growers = items
    .filter((item) => natural[item.id] !== undefined && natural[item.id]! > item.h + 0.01)
    .map((item) => ({ bottom: item.y + item.h, grow: natural[item.id]! - item.h, id: item.id }));
  const shifts: Record<string, number> = {};
  for (const item of items) {
    let shift = 0;
    for (const grower of growers) {
      if (grower.id !== item.id && item.y >= grower.bottom - 0.01) shift += grower.grow;
    }
    shifts[item.id] = shift;
  }
  return shifts;
}

/** Bitta hujjatni chizish konteksti. */
type FreeContext = {
  doc: jsPDF;
  data: DocumentData;
  codeImages: Record<string, string>;
  header: { title: string; number: string; date: string };
  /** Sahifa raqamlari hamma sahifa chizilgandan keyin yoziladi (jami soni shunda ma'lum). */
  pageNumbers: { page: number; element: DocumentElement; box: Box }[];
  /** Jadval bo'linganda keyingi sahifadagi chekkalar. */
  margins: { top: number; bottom: number };
};

const MM_PER_PT = 25.4 / 72;

/** Matn qatorlari balandligi (mm) — jsPDF ning qator oralig'i bilan. */
const lineHeightMm = (doc: jsPDF) => doc.getFontSize() * doc.getLineHeightFactor() * MM_PER_PT;

/** `field` uchun "Yorliq: qiymat", `text` uchun yorliqning o'zi. */
export function elementText(element: DocumentElement, data: DocumentData): string {
  if (element.type === "text") return element.label ?? "";
  const value = data.values[element.field ?? ""] ?? "";
  return element.label ? `${element.label}: ${value}` : value;
}

/** Matn qutisi: tepadan boshlanadi, kenglikka qarab qatorlarga bo'linadi. Qaytadi: balandlik. */
function drawTextBox(doc: jsPDF, element: DocumentElement, text: string, box: Box, fallbackSize: number): number {
  if (!text) return 0;
  applyStyle(doc, element.style, fallbackSize);
  const lines = doc.splitTextToSize(text, Math.max(box.w, 1)) as string[];
  const align = element.style?.align ?? "left";
  const x = align === "center" ? box.x + box.w / 2 : align === "right" ? box.x + box.w : box.x;
  doc.text(lines, x, box.y, { align, baseline: "top" });
  return lines.length * lineHeightMm(doc);
}

/** Matn qutisining kerakli balandligi (chizmasdan). */
export function measureText(doc: jsPDF, element: DocumentElement, data: DocumentData, width: number): number {
  const text = elementText(element, data);
  if (!text) return 0;
  applyStyle(doc, element.style, element.type === "text" ? 10 : 9);
  return (doc.splitTextToSize(text, Math.max(width, 1)) as string[]).length * lineHeightMm(doc);
}

/**
 * Jadval ustunlari jadval kengligiga moslanadi.
 *
 * Hammasining kengligi berilgan bo'lsa — PROPORSIONAL cho'ziladi/qisqaradi (jadval sichqoncha
 * bilan kengaytirilganda ustunlar nisbati saqlanadi). Bir qismi "auto" bo'lsa — berilganlari
 * o'z o'lchamida qoladi, sig'masa kichraytiriladi, qolgan joyni "auto" ustunlar bo'lishadi.
 */
export function fitColumnWidths(widths: (number | undefined)[], total: number): (number | undefined)[] {
  const sum = widths.reduce<number>((acc, width) => acc + (width ?? 0), 0);
  if (sum <= 0) return widths;
  if (widths.every((width) => width !== undefined)) return widths.map((width) => (width! * total) / sum);
  const autoCount = widths.filter((width) => width === undefined).length;
  const budget = Math.max(total - autoCount * 12, total * 0.3);
  if (sum <= budget) return widths;
  return widths.map((width) => (width === undefined ? undefined : (width * budget) / sum));
}

/** Jadvalni o'lchab tayyorlaydi (chizmasdan): balandligi ma'lum bo'ladi, keyin `drawTable`. */
function prepareTable(ctx: FreeContext, element: DocumentElement, box: Box): { table: Table; height: number; finish: (finalY: number) => void } | null {
  const widths = fitColumnWidths((element.columns ?? []).map((column) => column.width), box.w);
  const setup = itemsTableSetup(ctx.doc, element, ctx.data, ctx.header, widths);
  if (!setup) return null;
  const pageWidth = ctx.doc.internal.pageSize.getWidth();
  const table = __createTable(ctx.doc, {
    ...setup.options,
    startY: box.y,
    tableWidth: box.w,
    margin: { left: box.x, right: Math.max(0, pageWidth - box.x - box.w), top: ctx.margins.top, bottom: ctx.margins.bottom },
  });
  const height = [...table.head, ...table.body].reduce((sum, row) => sum + row.height, 0);
  return { table, height, finish: (finalY) => setup.finish(box.y, finalY, { left: box.x, right: box.x + box.w }) };
}

/** Jami / to'lov bloki — qutining ichida, qatorlar teng oraliqda. */
function drawRowsBox(ctx: FreeContext, element: DocumentElement, source: Record<string, string>, box: Box) {
  const labels = { ...DEFAULT_ROW_LABELS, ...ctx.data.rowLabels };
  const rows = (element.rows ?? []).filter((key) => source[key] !== undefined);
  if (rows.length === 0) return;
  const { doc } = ctx;
  const natural = rows.length * 8 + 6;
  doc.setFillColor(...(element.box?.fill ? hexToRgb(element.box.fill) : PDF_COLORS.rowAlt));
  doc.roundedRect(box.x, box.y, box.w, Math.max(box.h, natural), 3, 3, "F");
  rows.forEach((key, index) => {
    const y = box.y + 6 + index * 8;
    const bold = key === "total";
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(element.style?.fontSize ?? (bold ? 10 : 9));
    doc.setTextColor(...(element.style?.color ? hexToRgb(element.style.color) : PDF_COLORS.textDark));
    doc.text(labels[key] ?? key, box.x + 4, y);
    doc.text(source[key]!, box.x + box.w - 4, y, { align: "right" });
  });
}

/** Imzo joylari — qutining eni bo'yicha teng bo'linadi, chiziq pastda, yorliq chiziq ostida. */
function drawSignatures(ctx: FreeContext, element: DocumentElement, box: Box) {
  const labels = (element.label ?? "Topshirdi|Qabul qildi").split("|").map((part) => part.trim()).filter(Boolean).slice(0, 4);
  if (labels.length === 0) return;
  const { doc } = ctx;
  const gutter = labels.length > 1 ? 8 : 0;
  const span = (box.w - (labels.length - 1) * gutter) / labels.length;
  const lineY = box.y + Math.max(2, box.h - 6);
  doc.setDrawColor(...PDF_COLORS.border);
  doc.setLineWidth(0.2);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(element.style?.fontSize ?? 8);
  doc.setTextColor(...(element.style?.color ? hexToRgb(element.style.color) : PDF_COLORS.textMuted));
  labels.forEach((label, index) => {
    const x = box.x + index * (span + gutter);
    doc.line(x, lineY, x + span, lineY);
    doc.text(label, x + span / 2, lineY + 4, { align: "center" });
  });
}

/** Rasm: `contain` — nisbat saqlanib qutiga sig'adi, `fill` — cho'ziladi. */
function drawImage(ctx: FreeContext, element: DocumentElement, box: Box) {
  const { doc } = ctx;
  const radius = element.box?.radius ?? 0;
  if (element.box?.fill) {
    doc.setFillColor(...hexToRgb(element.box.fill));
    doc.roundedRect(box.x, box.y, box.w, box.h, radius, radius, "F");
  }
  if (element.imageData) {
    let { x, y, w, h } = box;
    if ((element.fit ?? "contain") === "contain") {
      try {
        const props = doc.getImageProperties(element.imageData);
        const scale = Math.min(box.w / props.width, box.h / props.height);
        w = props.width * scale;
        h = props.height * scale;
        x = box.x + (box.w - w) / 2;
        y = box.y + (box.h - h) / 2;
      } catch {
        // O'lchamini o'qib bo'lmasa qutini to'liq egallaydi
      }
    }
    try {
      doc.addImage(element.imageData, x, y, w, h);
    } catch {
      // Buzuq rasm butun hujjatni yiqitmasin
    }
  }
  if ((element.box?.borderWidth ?? 0) > 0) {
    applyStroke(doc, element.box, 0.2);
    doc.roundedRect(box.x, box.y, box.w, box.h, radius, radius);
    clearStroke(doc);
  }
}

/** QR — kvadrat, qutining eni va (yozuvsiz) bo'yining kichigi; shtrix-kod qutini to'ldiradi. */
function drawCode(ctx: FreeContext, element: DocumentElement, box: Box) {
  const image = ctx.codeImages[element.id];
  const { doc } = ctx;
  const caption = element.label ? CODE_CAPTION : 0;
  const areaH = Math.max(1, box.h - caption);
  const w = element.type === "qr" ? Math.min(box.w, areaH) : box.w;
  const h = element.type === "qr" ? w : areaH;
  const x = box.x + (box.w - w) / 2;
  if (image) {
    try {
      doc.addImage(image, x, box.y, w, h);
    } catch {
      // e'tiborsiz
    }
  }
  if (element.label) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(element.style?.fontSize ?? 7.5);
    doc.setTextColor(...PDF_COLORS.textMuted);
    doc.text(element.label, box.x + box.w / 2, box.y + h + 0.6, { align: "center", baseline: "top" });
  }
}

/** Chiziq — qutining o'rtasidan (gorizontal yoki vertikal). */
function drawLine(ctx: FreeContext, element: DocumentElement, box: Box) {
  applyStroke(ctx.doc, element.box, 0.2);
  if (isHorizontalLine(box)) ctx.doc.line(box.x, box.y + box.h / 2, box.x + box.w, box.y + box.h / 2);
  else ctx.doc.line(box.x + box.w / 2, box.y, box.x + box.w / 2, box.y + box.h);
  clearStroke(ctx.doc);
}

function drawRect(ctx: FreeContext, element: DocumentElement, box: Box) {
  const { doc } = ctx;
  const radius = element.box?.radius ?? 0;
  if (element.box?.fill) {
    doc.setFillColor(...hexToRgb(element.box.fill));
    doc.roundedRect(box.x, box.y, box.w, box.h, radius, radius, "F");
  }
  if ((element.box?.borderWidth ?? 0) > 0 || !element.box?.fill) {
    applyStroke(doc, element.box, 0.3);
    doc.roundedRect(box.x, box.y, box.w, box.h, radius, radius);
    clearStroke(doc);
  }
  if (element.label) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(element.style?.fontSize ?? 8);
    doc.setTextColor(...(element.style?.color ? hexToRgb(element.style.color) : PDF_COLORS.textMuted));
    doc.text(element.label, box.x + 2, box.y + 2, { baseline: "top" });
  }
}

/** Bitta element (jadvaldan boshqa) — o'z qutisida. */
function drawElement(ctx: FreeContext, element: DocumentElement, box: Box) {
  switch (element.type) {
    case "text":
    case "field":
      drawTextBox(ctx.doc, element, elementText(element, ctx.data), box, element.type === "text" ? 10 : 9);
      break;
    case "totals":
      drawRowsBox(ctx, element, ctx.data.totals, box);
      break;
    case "payments":
      drawRowsBox(ctx, element, ctx.data.payments ?? {}, box);
      break;
    case "signatures":
      drawSignatures(ctx, element, box);
      break;
    case "image":
      drawImage(ctx, element, box);
      break;
    case "qr":
    case "barcode":
      drawCode(ctx, element, box);
      break;
    case "line":
      drawLine(ctx, element, box);
      break;
    case "rect":
      drawRect(ctx, element, box);
      break;
    case "pageNumber":
      // Jami sahifa soni oxirida ma'lum — joyi hozir eslab qolinadi
      ctx.pageNumbers.push({ page: ctx.doc.getCurrentPageInfo().pageNumber, element, box });
      break;
    default:
      // `spacer` erkin rejimda ko'rinmaydi
      break;
  }
}

/** Hamma sahifa chizilgandan keyin: "1 / 3". */
function drawPageNumbers(doc: jsPDF, entries: FreeContext["pageNumbers"]) {
  const total = doc.getNumberOfPages();
  for (const { page, element, box } of entries) {
    doc.setPage(page);
    drawTextBox(doc, { ...element, style: { fontSize: 8, color: "#646482", ...element.style } }, `${page} / ${total}`, box, 8);
  }
}

/** Hujjat sarlavhasi (jadval keyingi sahifaga o'tganda takrorlanadi). */
function headerOf(elements: DocumentElement[], data: DocumentData) {
  const title = [...elements].sort((a, b) => (a.y ?? 0) - (b.y ?? 0)).find((element) => element.type === "text")?.label ?? "HUJJAT";
  return { title, number: data.values["document.number"] ?? "", date: data.values["document.date"] ?? "" };
}

export type FreeDrawResult = {
  /** Hujjat tugagan Y (oxirgi sahifada). */
  bottom: number;
  /** Hujjat bir nechta sahifaga cho'zildimi. */
  multiPage: boolean;
};

/**
 * Hujjatlar ketma-ket joylanganda (bitta A4 ga ikkita nakladnoy) ikkinchisi qayerdan
 * boshlanadi: loyihadagi ENG YUQORI element shu Y ga tushadi. `null` — yangi sahifa, loyiha
 * aynan dizaynerdagidek (surilishsiz) chiziladi.
 */
export function frameTop(schema: DocumentTemplateSchema): number {
  const tops = freeElements(schema).filter((element) => !isPageFurniture(element)).map((element) => boxOf(element).y);
  return tops.length > 0 ? Math.min(...tops) : schema.page.margins.top;
}

/**
 * Bitta hujjatni MAVJUD PDF ichiga erkin joylashuvda chizadi.
 *
 * Bir sahifaga sig'sa (odatiy holat) — hamma element QATLAM tartibida, aynan dizaynerdagi
 * joyida (+ jadval o'sishi surilishi). Jadval sahifadan oshib ketsa — jadval o'zi keyingi
 * sahifalarga bo'linadi, uning ostidagi elementlar esa jadval tugagan joydan, loyihadagi
 * oraliqni saqlab davom etadi.
 */
export async function drawFreeDocumentInto(
  doc: jsPDF,
  schema: DocumentTemplateSchema,
  data: DocumentData,
  startY: number | null,
  pageNumbers: FreeContext["pageNumbers"] = [],
): Promise<FreeDrawResult> {
  const visible = freeElements(schema).filter((element) => isVisible(element.visibleWhen, data));
  const furniture = visible.filter(isPageFurniture);
  const all = visible.filter((element) => !isPageFurniture(element));
  const ctx: FreeContext = {
    doc,
    data,
    codeImages: await buildCodeImages(all, data),
    header: headerOf(all, data),
    pageNumbers,
    margins: { top: A4.headerHeight, bottom: schema.page.margins.bottom || A4.marginX },
  };
  const pageHeight = doc.internal.pageSize.getHeight();
  const limit = pageHeight - ctx.margins.bottom;
  const offset = startY === null ? 0 : startY - frameTop(schema);
  const boxes = new Map(all.map((element) => {
    const box = boxOf(element);
    return [element.id, { ...box, y: box.y + offset }] as const;
  }));

  // O'suvchi jadvallar — avval o'lchanadi (chizilmaydi)
  const prepared = new Map<string, NonNullable<ReturnType<typeof prepareTable>>>();
  const natural: Record<string, number> = {};
  for (const element of all) {
    if (element.type !== "itemsTable") continue;
    const table = prepareTable(ctx, element, boxes.get(element.id)!);
    if (!table) continue;
    prepared.set(element.id, table);
    natural[element.id] = table.height;
  }
  const shifts = layoutShifts(all.map((element) => ({ id: element.id, y: boxes.get(element.id)!.y, h: boxes.get(element.id)!.h })), natural);
  const finalBox = (element: DocumentElement): Box => {
    const box = boxes.get(element.id)!;
    return { ...box, y: box.y + (shifts[element.id] ?? 0), h: Math.max(box.h, natural[element.id] ?? 0) };
  };
  /**
   * Bitta sahifaga sig'adimi: jadval chekkadan oshmasa va surilgan elementlar sahifadan
   * chiqmasa. Surilmagan element loyihadagi joyida qoladi — foydalanuvchi uni atayin chekka
   * yaqiniga qo'ygan bo'lishi mumkin (sahifa raqami), bu ko'p sahifa degani emas.
   */
  const fitsOnePage = all.every((element) => {
    const box = finalBox(element);
    if (element.type === "itemsTable") return box.y + box.h <= limit + 0.01;
    return (shifts[element.id] ?? 0) === 0 || box.y + box.h <= pageHeight + 0.01;
  });

  const startPage = doc.getCurrentPageInfo().pageNumber;
  /** Sahifa raqami — hujjat egallagan har varaqda bir marta, loyihadagi joyida (surilmaydi). */
  const placeFurniture = () => {
    for (let page = startPage; page <= doc.getNumberOfPages(); page += 1) {
      for (const element of furniture) {
        if (pageNumbers.some((entry) => entry.page === page && entry.element.id === element.id)) continue;
        pageNumbers.push({ page, element, box: boxOf(element) });
      }
    }
  };

  if (fitsOnePage) {
    let bottom = 0;
    for (const element of all) {
      const box = finalBox(element);
      const table = prepared.get(element.id);
      if (table) {
        // O'lchashda jadval asl Y da tuzilgan edi — surilgan joyida qayta tuziladi
        const placed = (shifts[element.id] ?? 0) > 0 ? prepareTable(ctx, element, box) : table;
        if (placed) {
          __drawTable(doc, placed.table);
          placed.finish(placed.table.finalY ?? box.y + placed.height);
        }
      } else {
        drawElement(ctx, element, box);
      }
      bottom = Math.max(bottom, box.y + box.h);
    }
    placeFurniture();
    return { bottom, multiPage: false };
  }

  // ── Ko'p sahifali: loyihadagi Y bo'yicha "bo'laklar", har jadvaldan keyin davom etiladi ──
  const byTop = [...all].sort((a, b) => boxes.get(a.id)!.y - boxes.get(b.id)!.y);
  const tables = byTop.filter((element) => prepared.has(element.id));
  /** Loyihadagi Y → haqiqiy Y (joriy sahifada). */
  let delta = 0;
  let bottom = 0;
  let afterTable = false;
  const drawn = new Set<string>();
  const drawBand = (members: DocumentElement[]) => {
    if (members.length === 0) return;
    const top = Math.min(...members.map((element) => boxes.get(element.id)!.y + delta));
    const end = Math.max(...members.map((element) => boxes.get(element.id)!.y + boxes.get(element.id)!.h + delta));
    // Jadvaldan keyingi bo'lak sahifaga sig'masa — butunicha keyingi sahifaga
    if (afterTable && end > limit && top > schema.page.margins.top + 0.01) {
      doc.addPage();
      delta += schema.page.margins.top - top;
    }
    // Qatlam tartibi bo'lak ichida saqlanadi
    for (const element of all) {
      if (!members.includes(element)) continue;
      const box = boxes.get(element.id)!;
      const placed = { ...box, y: box.y + delta };
      drawElement(ctx, element, placed);
      bottom = Math.max(bottom, placed.y + placed.h);
    }
  };

  for (const table of tables) {
    const box = boxes.get(table.id)!;
    const tableBottom = box.y + box.h;
    // Jadvaldan yuqoridagi (hali chizilmagan) elementlar
    drawBand(byTop.filter((element) => !drawn.has(element.id) && element !== table && boxes.get(element.id)!.y < tableBottom - 0.01 && !prepared.has(element.id)));
    for (const element of byTop) if (boxes.get(element.id)!.y < tableBottom - 0.01) drawn.add(element.id);
    const placed = prepareTable(ctx, table, { ...box, y: box.y + delta });
    if (placed) {
      __drawTable(doc, placed.table);
      const finalY = placed.table.finalY ?? box.y + delta + placed.height;
      placed.finish(finalY);
      // Jadvaldan keyingilar jadval TUGAGAN joydan, loyihadagi oraliq bilan
      delta = Math.max(finalY, box.y + delta + box.h) - tableBottom;
      bottom = Math.max(bottom, finalY);
      afterTable = true;
    }
    drawn.add(table.id);
  }
  drawBand(byTop.filter((element) => !drawn.has(element.id)));
  placeFurniture();

  return { bottom, multiPage: doc.getCurrentPageInfo().pageNumber > startPage || doc.getNumberOfPages() > startPage };
}

/** Bitta hujjat (erkin joylashuv) — o'z sahifasida. */
export async function renderFreeTemplate(schema: DocumentTemplateSchema, data: DocumentData): Promise<jsPDF> {
  const doc = await createDocument({ orientation: schema.page.orientation });
  const numbers: FreeContext["pageNumbers"] = [];
  await drawFreeDocumentInto(doc, schema, data, null, numbers);
  drawPageNumbers(doc, numbers);
  return doc;
}

/** Hujjat balandligi — bir nechtasini bitta varaqqa joylash uchun. */
export async function measureFreeDocument(schema: DocumentTemplateSchema, data: DocumentData): Promise<{ height: number; multiPage: boolean }> {
  const probe = await createDocument({ orientation: schema.page.orientation });
  const result = await drawFreeDocumentInto(probe, schema, data, null);
  const multiPage = result.multiPage || probe.getNumberOfPages() > 1;
  return { height: multiPage ? Number.POSITIVE_INFINITY : result.bottom - frameTop(schema), multiPage };
}

/** Hujjatlar orasidagi uzuq chiziq. */
function drawSeparator(doc: jsPDF, y: number, schema: DocumentTemplateSchema): number {
  const width = doc.internal.pageSize.getWidth();
  const at = y + 4;
  doc.setDrawColor(...PDF_COLORS.border);
  doc.setLineWidth(0.2);
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.line(schema.page.margins.left || A4.marginX, at, width - (schema.page.margins.right || A4.marginX), at);
  doc.setLineDashPattern([], 0);
  return at + 6;
}

/**
 * Bir nechta hujjat — erkin joylashuvda ham A4 ga AQLLI joylanadi (oqim rejimi qoidalari):
 * hujjat o'rtasidan bo'linmaydi, sig'sa shu varaqda, sig'masa keyingisida, kichraytirilmaydi.
 */
export async function renderFreeDocuments(
  schema: DocumentTemplateSchema,
  list: DocumentData[],
  mode: "smart" | "full",
): Promise<jsPDF> {
  const doc = await createDocument({ orientation: schema.page.orientation });
  const limit = doc.internal.pageSize.getHeight() - (schema.page.margins.bottom || A4.marginX);
  const numbers: FreeContext["pageNumbers"] = [];
  let y = 0;
  for (const [index, data] of list.entries()) {
    let start: number | null = null;
    if (index > 0) {
      let newPage = true;
      if (mode === "smart") {
        const measured = await measureFreeDocument(schema, data);
        newPage = measured.multiPage || y + 10 + measured.height > limit;
      }
      if (newPage) doc.addPage();
      else start = drawSeparator(doc, y, schema);
    }
    y = (await drawFreeDocumentInto(doc, schema, data, start, numbers)).bottom;
  }
  drawPageNumbers(doc, numbers);
  return doc;
}

// ───────────────────────── Dizayner uchun: element "rasmlari" ─────────────────────────

/** Element qutisi atrofidagi zaxira (qo'sh ramka, qalin chiziq qutidan chiqadi), mm. */
export const SPRITE_BLEED = 7;

export type SpriteMeta = {
  id: string;
  /** Sahifa o'lchami (zaxira bilan), mm. */
  width: number;
  height: number;
  /** Jadval va matnning namunadagi haqiqiy balandligi, mm (qutidan katta bo'lishi mumkin). */
  natural: number;
};

/**
 * Har elementni ALOHIDA sahifaga chizadi — o'sha renderer funksiyalari bilan. Dizayner bu
 * sahifalarni pdf.js bilan rasmga aylantirib, sichqoncha bilan suriladigan qatlamlar qiladi.
 * Element joyi (`x/y`) rasmga ta'sir qilmaydi — ko'chirishda qayta chizish kerak emas.
 */
export async function renderElementSprites(
  elements: DocumentElement[],
  data: DocumentData,
): Promise<{ pdf: ArrayBuffer; pages: SpriteMeta[] }> {
  const doc = await createDocument({ format: [50, 50] });
  const ctx: FreeContext = {
    doc,
    data,
    codeImages: await buildCodeImages(elements, data),
    header: headerOf(elements, data),
    pageNumbers: [],
    margins: { top: 0, bottom: 0 },
  };
  const pages: SpriteMeta[] = [];
  for (const element of elements) {
    const box = boxOf(element);
    let natural = box.h;
    if (element.type === "itemsTable") {
      const measured = prepareTable(ctx, element, { ...box, x: SPRITE_BLEED, y: SPRITE_BLEED });
      natural = Math.max(box.h, measured?.height ?? 0);
    } else if (element.type === "text" || element.type === "field") {
      natural = Math.max(box.h, measureText(doc, element, data, box.w));
    }
    const width = box.w + SPRITE_BLEED * 2;
    const height = natural + SPRITE_BLEED * 2;
    doc.addPage([width, height], width > height ? "landscape" : "portrait");
    const placed: Box = { x: SPRITE_BLEED, y: SPRITE_BLEED, w: box.w, h: box.h };
    if (element.type === "itemsTable") {
      const table = prepareTable(ctx, element, placed);
      if (table) {
        __drawTable(doc, table.table);
        table.finish(table.table.finalY ?? placed.y + table.height);
      }
    } else if (element.type === "pageNumber") {
      drawTextBox(doc, { ...element, style: { fontSize: 8, color: "#646482", ...element.style } }, "1 / 1", placed, 8);
    } else {
      drawElement(ctx, element, placed);
    }
    pages.push({ id: element.id, width, height, natural });
  }
  // Birinchi (bo'sh) sahifa kerak emas
  doc.deletePage(1);
  return { pdf: doc.output("arraybuffer"), pages };
}
