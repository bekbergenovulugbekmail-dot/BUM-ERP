/**
 * Shablon rendererining UMUMIY qismi: ma'lumot turi, rang/chiziq/matn uslubi, shart va
 * QR/shtrix-kod rasmlari. Oqim (`template-renderer.ts`) va erkin joylashuv
 * (`template-free.ts`) ikkalasi ham shuni ishlatadi — shu sababli ikki rejimda element bir
 * xil ko'rinadi.
 */
import type jsPDF from "jspdf";
import type { CellHookData, UserOptions } from "jspdf-autotable";
import type { BorderStyle, BoxStyle, DocumentElement, TableStyle, TextStyle, VisibilityCondition } from "@bum/shared";
import { PDF_COLORS, tableOptions, type CompanyInfo } from "./pdf-utils.ts";

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

export const DEFAULT_ROW_LABELS: Record<string, string> = {
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

export const hexToRgb = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

/**
 * Chiziq naqshi (mm). `double` alohida ishlanadi — u ikki marta chiziladi.
 */
export const dashPattern = (style: BorderStyle | undefined, width: number): number[] => {
  if (style === "dashed") return [Math.max(0.8, width * 4), Math.max(0.8, width * 3)];
  if (style === "dotted") return [Math.max(0.25, width), Math.max(0.6, width * 2.5)];
  return [];
};

/** Chiziq/ramka uslubini hujjatga qo'yadi va naqshni qaytaradi (keyin tozalash uchun). */
export function applyStroke(doc: jsPDF, box: BoxStyle | undefined, fallbackWidth: number): number {
  const width = box?.borderWidth ?? fallbackWidth;
  doc.setDrawColor(...(box?.borderColor ? hexToRgb(box.borderColor) : PDF_COLORS.border));
  doc.setLineWidth(width);
  doc.setLineDashPattern(dashPattern(box?.borderStyle, width), 0);
  return width;
}

export const clearStroke = (doc: jsPDF) => {
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

export function applyStyle(doc: jsPDF, style: TextStyle | undefined, fallbackSize = 9) {
  doc.setFontSize(style?.fontSize ?? fallbackSize);
  doc.setFont("helvetica", style?.bold ? "bold" : style?.italic ? "italic" : "normal");
  const color = style?.color ? hexToRgb(style.color) : PDF_COLORS.textDark;
  doc.setTextColor(...color);
}

/** Matn qaysi X dan boshlanadi (tekislashga qarab). */
export function textX(doc: jsPDF, style: TextStyle | undefined, left: number, right: number): { x: number; align: "left" | "center" | "right" } {
  const align = style?.align ?? "left";
  if (align === "center") return { x: (left + right) / 2, align };
  if (align === "right") return { x: right, align };
  return { x: left, align };
}

/**
 * Shablondagi QR va shtrix-kod elementlari uchun rasm tayyorlaydi.
 *
 * Kod ichiga FAQAT ro'yxatdagi manbadan qiymat tushadi (hujjat raqami, buyurtma raqami,
 * mijoz telefoni) — ixtiyoriy URL yoki matn emas, shuning uchun skanerlanganda begona
 * manzilga olib bormaydi.
 */
export async function buildCodeImages(all: DocumentElement[], data: DocumentData): Promise<Record<string, string>> {
  const elements = all.filter((element) => element.type === "qr" || element.type === "barcode");
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


type Halign = "left" | "center" | "right";

/**
 * Mahsulot jadvali — chiziqlari SHABLONDAN. Oqim va erkin rejim IKKALASI shuni ishlatadi.
 *
 * Har katakning to'rt tomoni alohida hisoblanadi (autotable `lineWidth` obyektini qabul qiladi),
 * shuning uchun foydalanuvchi tashqi ramkani qoldirib ichki chiziqlarni o'chira oladi va aksincha.
 * Ichki chiziq IKKI MARTA chizilmaydi: gorizontal — yuqoridagi katakning "pastki" tomoni,
 * vertikal — o'ngdagi katakning "chap" tomoni sifatida chiziladi.
 *
 * `columnWidths` — erkin rejimda jadval kengligiga moslangan ustun kengliklari (mm).
 * `finish` — jadval chizilgandan keyin `double` tashqi ramkasini qo'yadi.
 */
export function itemsTableSetup(
  doc: jsPDF,
  element: DocumentElement,
  data: DocumentData,
  header: { title: string; number: string; date: string },
  columnWidths?: (number | undefined)[],
): { options: UserOptions; finish: (startY: number, finalY: number, fallback: { left: number; right: number }) => void } | null {
  const columns = element.columns ?? [];
  if (columns.length === 0) return null;
  const labels = data.columnLabels ?? {};
  const head = [columns.map((column) => column.label ?? labels[column.key] ?? column.key)];
  const body = data.items.map((item, index) =>
    columns.map((column) => (column.key === "index" ? String(index + 1) : (item[column.key] ?? ""))),
  );

  // Ustun tekislash va kengligi shablondan; qolganini autotable o'zi taqsimlaydi
  const columnStyles: Record<number, { halign?: Halign; cellWidth?: number }> = {};
  columns.forEach((column, index) => {
    const style: { halign?: Halign; cellWidth?: number } = {};
    if (column.align) style.halign = column.align;
    const width = columnWidths ? columnWidths[index] : column.width;
    if (width) style.cellWidth = width;
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
  const base = tableOptions(doc, data.company, header, columnStyles);
  /** Jadval haqiqatan qaysi kenglikda chizilgani — `double` ramkasi aynan shunga qo'yiladi. */
  const bounds = { left: Number.POSITIVE_INFINITY, right: Number.NEGATIVE_INFINITY };

  // Katak ichidagi bo'shliq: berilmasa autotable standarti qoladi
  const padding =
    table.paddingX !== undefined || table.paddingY !== undefined
      ? { top: table.paddingY ?? 1.76, bottom: table.paddingY ?? 1.76, left: table.paddingX ?? 1.76, right: table.paddingX ?? 1.76 }
      : undefined;

  const options: UserOptions = {
    ...base,
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
    willDrawCell: (hook: CellHookData) => {
      const isHead = hook.section === "head";
      const column = hook.column.index;
      const row = hook.row.index;
      // autotable `lineWidth` uchun obyektni ham qabul qiladi (har tomon alohida)
      (hook.cell.styles as { lineWidth: unknown }).lineWidth = {
        // Ichki gorizontal — faqat yuqoridagi katakning pastki tomoni bo'lib chiziladi
        top: isHead ? side.top : 0,
        // Qatorsiz jadvalda sarlavhaning pasti — jadvalning pastki chegarasi
        bottom: isHead ? (lastRow < 0 ? side.bottom : headerLine) : row === lastRow ? side.bottom : inner.h,
        left: column === 0 ? side.left : inner.v,
        right: column === lastColumn ? side.right : 0,
      };
      bounds.left = Math.min(bounds.left, hook.cell.x);
      bounds.right = Math.max(bounds.right, hook.cell.x + hook.cell.width);
      doc.setLineDashPattern(dash, 0);
    },
    didDrawCell: () => { doc.setLineDashPattern([], 0); },
  };

  const finish = (startY: number, finalY: number, fallback: { left: number; right: number }) => {
    // `double` — tashqi ramka ikki chiziq bo'lib ko'rinsin (autotable buni o'zi qila olmaydi)
    if (table.borderStyle !== "double" || width <= 0) return;
    doc.setDrawColor(...(table.borderColor ? hexToRgb(table.borderColor) : PDF_COLORS.border));
    doc.setLineWidth(width);
    const gap = Math.max(0.6, width * 2);
    const left = Number.isFinite(bounds.left) ? bounds.left : fallback.left;
    const right = Number.isFinite(bounds.right) ? bounds.right : fallback.right;
    doc.rect(left - gap, startY - gap, right - left + gap * 2, finalY - startY + gap * 2);
    clearStroke(doc);
  };

  return { options, finish };
}

let codeAliasSeq = 0;
/**
 * QR/shtrix-kod rasmi uchun jsPDF ichidagi noyob nom. jsPDF rasmlarni ma'lumot xeshi bo'yicha qayta ishlatadi —
 * ommaviy chop etishda (bir faylda ko'p nakladnoy) xesh to'qnashuvi bir hujjatga boshqasining QR kodini qo'yib
 * yuborishi nazariy jihatdan mumkin. Har chizishga alohida nom berilsa, har hujjat faqat o'z kodini oladi.
 */
export const nextCodeAlias = () => `bum-code-${++codeAliasSeq}`;
