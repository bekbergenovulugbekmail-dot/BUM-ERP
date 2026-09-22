/**
 * CSV eksport va import uchun umumiy yordamchilar.
 *
 * Eksport Excel'da ochilishi uchun UTF-8 BOM va CRLF bilan yoziladi; matn maydonlari formula injection'dan
 * himoyalanadi (`=`, `+`, `-`, `@` bilan boshlangan qiymat apostrof bilan chiqadi — Excel uni formula deb o'qimaydi).
 * Import qatorlari serverda tekshiriladi: har xato qator `ImportError` bo'lib qaytadi, to'g'rilari yoziladi.
 */

/** Bir eksportda ko'pi bilan shuncha qator — katta bazada so'rov cheksiz o'smasin. */
export const MAX_EXPORT_ROWS = 10_000;

/** Import xatosi: qator raqami (1 dan, sarlavhasiz), qatorni tanituvchi kalit (nom, kod) va sabab. */
export type ImportError = { row: number; key: string | null; message: string };

/**
 * Import natijasi — preview (`dryRun: true`) va haqiqiy import uchun bitta shakl.
 * Preview'da bazaga hech narsa yozilmaydi: `created` doim 0, `valid` — yozilishga tayyor qatorlar soni
 * (`updated` esa preview'da ham yangilanishi KUTILAYOTGAN qatorlarni ko'rsatadi).
 * Dublikat (CREATE ONLY rejimi) alohida ro'yxatda: u xato emas, lekin yangi yozuv ochilmaydi.
 */
export type ImportOutcome = {
  created: number;
  /** Yangilash rejimi bor bo'limlarda (mijozlar): mavjud yozuv ustiga yozilgan qatorlar soni. */
  updated?: number;
  valid: number;
  errors: ImportError[];
  duplicates: ImportError[];
  warnings: ImportError[];
  dryRun: boolean;
};

/** Telefonni taqqoslash uchun normal shakl: faqat raqamlar ("+998 90 123-45-67" va "998901234567" — bir xil). */
export function normalizePhone(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits || null;
}

/** Nom, kod va shunga o'xshash matn kalitlarini taqqoslash uchun: bo'shliqlar qisqaradi, kichik harf. */
export function normalizeKey(value: string | null | undefined): string | null {
  const text = (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return text || null;
}

/** Excel formula injection'dan himoya: `=`, `+`, `-`, `@` bilan boshlangan matn apostrof bilan. */
export function csvText(value: string | null | undefined): string {
  const text = value ?? "";
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Sarlavha va qatorlardan Excel ochadigan CSV hujjati (UTF-8 BOM + CRLF).
 * Har katak `csvText` orqali o'tadi — son va matn bir xil xavfsiz yoziladi.
 */
export function csvDocument(header: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [
    header.map(csvText).join(","),
    ...rows.map((row) => row.map((cell) => csvText(cell === null || cell === undefined ? "" : String(cell))).join(",")),
  ];
  return String.fromCharCode(0xfeff) + lines.join("\r\n");
}

/**
 * Excel/CSV dagi sonni bir xil (nuqtali) ko'rinishga keltiradi. Bo'sh — "0".
 *
 * MUAMMO: ilgari `replace(",", ".")` qilinardi va "10,500" → "10.500" = 10.5 bo'lib ketardi
 * (10 500 o'rniga), "10.000" esa 10 bo'lardi. Bu narx va miqdorni 1000 barobar buzadi.
 *
 * QOIDA (aniq va takrorlanadigan):
 *   1. Ikkala ajratgich ham bor ("1.234,56" yoki "1,234.56") — OXIRGISI kasr, boshqasi mingliklar.
 *   2. Bitta ajratgich bir necha marta ("1.234.567") — mingliklar.
 *   3. Bitta ajratgich bir marta:
 *        - ortidan AYNAN 3 raqam ("10,500", "10.500") — MINGLIKLAR (o'zbek/rus yozuvi);
 *        - 1, 2 yoki 4+ raqam ("10.5", "10000.50", "1.2345") — KASR.
 * Natija previewda ko'rsatiladi, shuning uchun noaniqlik foydalanuvchidan yashirilmaydi.
 *
 * Yaroqsiz qiymat (harf, bir nechta minus, NaN, Infinity) — "" qaytadi; chaqiruvchi sxema
 * (`priceSchema`, `qtySchema`) uni xato deb rad etadi.
 */
export function cleanNumber(value: string | number | null | undefined): string {
  if (value === undefined || value === null || value === "") return "0";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";

  // Probel (bo'linmas ham), apostrof va valyuta belgilaridan tozalash
  const raw = String(value).replace(/[\s\u00a0\u202f']/g, "").trim();
  if (!raw) return "0";

  const match = /^([+-]?)([\d.,]+)$/.exec(raw);
  if (!match) return "";
  const sign = match[1] === "-" ? "-" : "";
  const body = match[2]!;

  const dots = (body.match(/\./g) ?? []).length;
  const commas = (body.match(/,/g) ?? []).length;

  let normalized: string;
  if (dots > 0 && commas > 0) {
    // Oxirgi ajratgich — kasr, qolgani mingliklar
    const decimalChar = body.lastIndexOf(".") > body.lastIndexOf(",") ? "." : ",";
    const thousandsChar = decimalChar === "." ? "," : ".";
    const index = body.lastIndexOf(decimalChar);
    normalized = `${body.slice(0, index).split(thousandsChar).join("")}.${body.slice(index + 1)}`;
  } else if (dots + commas === 0) {
    normalized = body;
  } else {
    const separator = dots > 0 ? "." : ",";
    const parts = body.split(separator);
    const tail = parts[parts.length - 1]!;
    // Bir necha ajratgich yoki ortidan aynan 3 raqam — mingliklar
    normalized = parts.length > 2 || (parts.length === 2 && parts[0] !== "" && tail.length === 3)
      ? parts.join("")
      : `${parts[0]}.${tail}`;
  }

  if (!/^\d*\.?\d*$/.test(normalized) || normalized === "" || normalized === ".") return "";
  const asNumber = Number(`${sign}${normalized}`);
  if (!Number.isFinite(asNumber)) return "";
  return `${sign}${normalized}`;
}

/** "ha", "true", "1", "faol" → true; "yo'q", "false", "0" → false; bo'sh — standart qiymat. */
export function parseBool(value: string | undefined | null, fallback = true): boolean {
  const text = (value ?? "").trim().toLowerCase();
  if (!text) return fallback;
  if (["ha", "true", "1", "faol", "yes", "+"].includes(text)) return true;
  if (["yo'q", "yoq", "false", "0", "nofaol", "no", "-"].includes(text)) return false;
  return fallback;
}

/** Bo'sh satr — `null` (ixtiyoriy maydonlar uchun); uzunlik cheklanadi. */
export function optionalText(value: string | undefined | null, max: number): string | null {
  const text = (value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

/** "YYYY-MM-DD" sanasi; noto'g'ri yoki bo'sh bo'lsa `null`. */
export function parseIsoDate(value: string | undefined | null): string | null {
  const text = (value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return Number.isNaN(new Date(`${text}T00:00:00Z`).getTime()) ? null : text;
}
