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

/** "12 500,50" → "12500.50" (bo'linmas probel ham); bo'sh → "0". */
export function cleanNumber(value: string | number | null | undefined): string {
  if (value === undefined || value === null || value === "") return "0";
  return String(value).replace(/\s/g, "").replace(",", ".");
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
