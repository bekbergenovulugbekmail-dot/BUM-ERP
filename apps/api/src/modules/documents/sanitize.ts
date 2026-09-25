/**
 * Shablonni OQ RO'YXAT bo'yicha qayta quradi.
 *
 * Qoida: kelgan JSON hech qachon "shundayligicha" saqlanmaydi. Biz uni o'qib, faqat
 * taniydigan kalitlarimizni yangi obyektga ko'chiramiz. Shu sababli:
 *   - noma'lum kalit (masalan `onClick`, `html`, `script`) umuman saqlanmaydi;
 *   - maydon va ustun faqat katalogdan bo'ladi — maxfiy tannarxni qo'lda yozib bo'lmaydi;
 *   - rang faqat `#rrggbb`, rasm faqat `files` kaliti (tashqi URL yo'q);
 *   - o'lcham va shrift chegaralari bor — hujjat buzilmaydi.
 *
 * Xato bo'lsa jimgina tashlab yuborilmaydi: nima rad etilgani `warnings` da qaytadi,
 * foydalanuvchi ko'radi (jim yo'qolgan element eng yomon holat).
 */
import { randomUUID } from "node:crypto";
import {
  ALIGNMENTS,
  BORDER_STYLES,
  DEFAULT_PAGE,
  ELEMENT_TYPES,
  HEX_COLOR,
  MAX_ELEMENTS_PER_SECTION,
  MAX_TABLE_COLUMNS,
  SECTIONS,
  STYLE_LIMITS,
  CONDITION_OPERATORS,
  IMAGE_DATA_PREFIX,
  MAX_IMAGE_DATA_LENGTH,
  IMAGE_FITS,
  QR_LEVELS,
  QR_SOURCES,
  VALIGNMENTS,
  type Alignment,
  type BorderStyle,
  type BoxStyle,
  type ConditionOperator,
  type DocumentElement,
  type DocumentSection,
  type DocumentTemplateSchema,
  type ElementType,
  type ImageFit,
  type PageSettings,
  type QrLevel,
  type QrSource,
  type SectionKey,
  type TableStyle,
  type TextStyle,
  type VAlignment,
  type VisibilityCondition,
} from "@bum/shared";
import { isColumnAllowed, isFieldAllowed, PAYMENT_ROWS, TOTAL_ROWS, type CatalogAccess } from "./field-catalog.js";

export type SanitizeResult = { schema: DocumentTemplateSchema; warnings: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
};

const clamp = (value: unknown, min: number, max: number): number | undefined => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(max, Math.max(min, Math.round(parsed * 100) / 100));
};

const pick = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
  typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;

function sanitizeStyle(value: unknown): TextStyle | undefined {
  if (!isRecord(value)) return undefined;
  const style: TextStyle = {};
  const fontSize = clamp(value.fontSize, STYLE_LIMITS.fontSizeMin, STYLE_LIMITS.fontSizeMax);
  if (fontSize !== undefined) style.fontSize = fontSize;
  if (value.bold === true) style.bold = true;
  if (value.italic === true) style.italic = true;
  const align = pick<Alignment>(value.align, ALIGNMENTS);
  if (align) style.align = align;
  // Rang faqat `#rrggbb`: `rgb()`, `url(...)` va boshqa ifodalar chizishga umuman yetmaydi
  if (typeof value.color === "string" && HEX_COLOR.test(value.color)) style.color = value.color.toLowerCase();
  return Object.keys(style).length > 0 ? style : undefined;
}

/** `#rrggbb` bo'lsa qaytaradi, aks holda `undefined` — boshqa ifoda saqlanmaydi. */
const hex = (value: unknown): string | undefined =>
  typeof value === "string" && HEX_COLOR.test(value) ? value.toLowerCase() : undefined;

/** `true`/`false` bo'lsa o'sha, aks holda `undefined` (= standart ko'rinish). */
const bool = (value: unknown): boolean | undefined => (typeof value === "boolean" ? value : undefined);

/**
 * Jadval chiziqlari. Har kalit alohida tekshiriladi va faqat berilganlari saqlanadi:
 * berilmagani standart ko'rinishda qoladi, ya'ni eski shablonlar o'zgarmaydi.
 */
function sanitizeTableStyle(value: unknown): TableStyle | undefined {
  if (!isRecord(value)) return undefined;
  const style: TableStyle = {};
  const borderStyle = pick<BorderStyle>(value.borderStyle, BORDER_STYLES);
  if (borderStyle) style.borderStyle = borderStyle;
  const borderWidth = clamp(value.borderWidth, 0, 3);
  if (borderWidth !== undefined) style.borderWidth = borderWidth;
  const borderColor = hex(value.borderColor);
  if (borderColor) style.borderColor = borderColor;
  for (const key of ["outer", "top", "bottom", "left", "right", "horizontal", "vertical", "headerBorder", "zebra"] as const) {
    const flag = bool(value[key]);
    if (flag !== undefined) style[key] = flag;
  }
  const paddingX = clamp(value.paddingX, 0, 10);
  if (paddingX !== undefined) style.paddingX = paddingX;
  const paddingY = clamp(value.paddingY, 0, 10);
  if (paddingY !== undefined) style.paddingY = paddingY;
  const rowHeight = clamp(value.rowHeight, 0, 40);
  if (rowHeight !== undefined) style.rowHeight = rowHeight;
  const fontSize = clamp(value.fontSize, STYLE_LIMITS.fontSizeMin, STYLE_LIMITS.fontSizeMax);
  if (fontSize !== undefined) style.fontSize = fontSize;
  const headerFill = hex(value.headerFill);
  if (headerFill) style.headerFill = headerFill;
  const headerText = hex(value.headerText);
  if (headerText) style.headerText = headerText;
  const valign = pick<VAlignment>(value.valign, VALIGNMENTS);
  if (valign) style.valign = valign;
  return Object.keys(style).length > 0 ? style : undefined;
}

/** Rasm/to'rtburchak ramkasi. */
function sanitizeBoxStyle(value: unknown): BoxStyle | undefined {
  if (!isRecord(value)) return undefined;
  const box: BoxStyle = {};
  const borderStyle = pick<BorderStyle>(value.borderStyle, BORDER_STYLES);
  if (borderStyle) box.borderStyle = borderStyle;
  const borderWidth = clamp(value.borderWidth, 0, 3);
  if (borderWidth !== undefined) box.borderWidth = borderWidth;
  const borderColor = hex(value.borderColor);
  if (borderColor) box.borderColor = borderColor;
  const radius = clamp(value.radius, 0, 20);
  if (radius !== undefined) box.radius = radius;
  const fill = hex(value.fill);
  if (fill) box.fill = fill;
  return Object.keys(box).length > 0 ? box : undefined;
}

function sanitizeCondition(value: unknown, access: CatalogAccess, warnings: string[]): VisibilityCondition | undefined {
  if (!isRecord(value)) return undefined;
  const field = text(value.field, 120);
  const operator = pick<ConditionOperator>(value.operator, CONDITION_OPERATORS);
  if (!field || !operator) return undefined;
  if (!isFieldAllowed(field, access)) {
    warnings.push(`Shart uchun mavjud bo'lmagan maydon: ${field}`);
    return undefined;
  }
  const condition: VisibilityCondition = { field, operator };
  if (operator !== "empty" && operator !== "notEmpty") {
    if (typeof value.value === "number" && Number.isFinite(value.value)) condition.value = value.value;
    else {
      const asText = text(value.value, 200);
      if (asText !== undefined) condition.value = asText;
    }
  }
  return condition;
}

/** Element turiga qarab faqat o'sha turga tegishli kalitlar saqlanadi. */
function sanitizeElement(value: unknown, access: CatalogAccess, warnings: string[]): DocumentElement | null {
  if (!isRecord(value)) return null;
  const type = pick<ElementType>(value.type, ELEMENT_TYPES);
  if (!type) {
    warnings.push(`Noma'lum element turi tashlab yuborildi: ${String(value.type)}`);
    return null;
  }

  const element: DocumentElement = { id: text(value.id, 64) ?? randomUUID(), type };
  const label = text(value.label, 200);
  if (label) element.label = label;

  const width = clamp(value.width, 1, STYLE_LIMITS.widthMax);
  if (width !== undefined) element.width = width;
  const height = clamp(value.height, 1, STYLE_LIMITS.heightMax);
  if (height !== undefined) element.height = height;

  const style = sanitizeStyle(value.style);
  if (style) element.style = style;

  const condition = sanitizeCondition(value.visibleWhen, access, warnings);
  if (condition) element.visibleWhen = condition;

  if (type === "field") {
    const field = text(value.field, 120);
    if (!field || !isFieldAllowed(field, access)) {
      warnings.push(`Bu hujjat turida mavjud bo'lmagan maydon: ${field ?? "(bo'sh)"}`);
      return null;
    }
    element.field = field;
  }

  if (type === "itemsTable") {
    const raw = Array.isArray(value.columns) ? value.columns : [];
    const columns: NonNullable<DocumentElement["columns"]> = [];
    for (const item of raw.slice(0, MAX_TABLE_COLUMNS)) {
      if (!isRecord(item)) continue;
      const key = text(item.key, 64);
      if (!key) continue;
      if (!isColumnAllowed(key, access)) {
        warnings.push(`Ustun mavjud emas yoki ruxsat yo'q: ${key}`);
        continue;
      }
      if (columns.some((column) => column.key === key)) continue;
      const column: (typeof columns)[number] = { key };
      const columnLabel = text(item.label, 60);
      if (columnLabel) column.label = columnLabel;
      const columnWidth = clamp(item.width, 5, STYLE_LIMITS.widthMax);
      if (columnWidth !== undefined) column.width = columnWidth;
      const align = pick<Alignment>(item.align, ALIGNMENTS);
      if (align) column.align = align;
      columns.push(column);
    }
    if (columns.length === 0) {
      warnings.push("Jadvalda birorta ruxsat etilgan ustun qolmadi — element tashlandi");
      return null;
    }
    element.columns = columns;
    const table = sanitizeTableStyle(value.table);
    if (table) element.table = table;
  }

  if (type === "image" || type === "rect" || type === "line") {
    const box = sanitizeBoxStyle(value.box);
    if (box) element.box = box;
  }

  if (type === "totals" || type === "payments") {
    const allowedRows: readonly string[] = type === "totals" ? TOTAL_ROWS : PAYMENT_ROWS;
    const raw = Array.isArray(value.rows) ? value.rows : [];
    const rows = [...new Set(raw.filter((row): row is string => typeof row === "string" && allowedRows.includes(row)))];
    if (rows.length === 0) {
      warnings.push(`${type === "totals" ? "Jami" : "To'lov"} blokida qator qolmadi — element tashlandi`);
      return null;
    }
    element.rows = rows;
  }

  if (type === "image") {
    /**
     * Faqat `data:image/(png|jpeg|webp);base64,...`. Tashqi URL, `data:text/html` va `svg`
     * qabul qilinmaydi: SVG ichida skript bo'lishi mumkin, tashqi URL esa hujjat chiqarilganda
     * begona manzilga so'rov yuborardi.
     */
    const raw = typeof value.imageData === "string" ? value.imageData.trim() : "";
    if (!raw || !IMAGE_DATA_PREFIX.test(raw)) {
      warnings.push("Rasm formati yaroqsiz — faqat PNG, JPEG yoki WEBP");
      return null;
    }
    if (raw.length > MAX_IMAGE_DATA_LENGTH) {
      warnings.push("Rasm juda katta — kichikroq fayl tanlang");
      return null;
    }
    element.imageData = raw;
    const fit = pick<ImageFit>(value.fit, IMAGE_FITS);
    if (fit) element.fit = fit;
  }

  if (type === "qr" || type === "barcode") {
    const source = pick<QrSource>(value.qrSource, QR_SOURCES);
    if (!source) {
      warnings.push("Kod manbasi noto'g'ri — element tashlandi");
      return null;
    }
    element.qrSource = source;
    const level = pick<QrLevel>(value.qrLevel, QR_LEVELS);
    if (level) element.qrLevel = level;
    const margin = clamp(value.qrMargin, 0, 8);
    if (margin !== undefined) element.qrMargin = margin;
  }

  return element;
}

function sanitizePage(value: unknown): PageSettings {
  if (!isRecord(value)) return { ...DEFAULT_PAGE, margins: { ...DEFAULT_PAGE.margins } };
  const margins = isRecord(value.margins) ? value.margins : {};
  return {
    size: "a4",
    orientation: pick(value.orientation, ["portrait", "landscape"] as const) ?? DEFAULT_PAGE.orientation,
    margins: {
      top: clamp(margins.top, 0, 60) ?? DEFAULT_PAGE.margins.top,
      right: clamp(margins.right, 0, 60) ?? DEFAULT_PAGE.margins.right,
      bottom: clamp(margins.bottom, 0, 60) ?? DEFAULT_PAGE.margins.bottom,
      left: clamp(margins.left, 0, 60) ?? DEFAULT_PAGE.margins.left,
    },
    footerOnEveryPage: value.footerOnEveryPage !== false,
    signaturesOnLastPage: value.signaturesOnLastPage !== false,
  };
}

/**
 * Kelgan JSON dan XAVFSIZ shablon quradi. Natija — faqat bizning kalitlarimiz.
 */
export function sanitizeTemplateSchema(input: unknown, access: CatalogAccess): SanitizeResult {
  const warnings: string[] = [];
  const raw = isRecord(input) ? input : {};
  const rawSections = Array.isArray(raw.sections) ? raw.sections : [];

  const sections: DocumentSection[] = SECTIONS.map((key) => {
    const found = rawSections.find((section) => isRecord(section) && section.key === key);
    const rawElements = isRecord(found) && Array.isArray(found.elements) ? found.elements : [];
    if (rawElements.length > MAX_ELEMENTS_PER_SECTION) {
      warnings.push(`"${key}" bo'limida ${MAX_ELEMENTS_PER_SECTION} tadan ortiq element — ortiqchasi tashlandi`);
    }
    const elements = rawElements
      .slice(0, MAX_ELEMENTS_PER_SECTION)
      .map((element) => sanitizeElement(element, access, warnings))
      .filter((element): element is DocumentElement => element !== null);
    return { key: key as SectionKey, elements };
  });

  return { schema: { schemaVersion: 1, page: sanitizePage(raw.page), sections }, warnings };
}
