/**
 * O'zbek lotin → kirill transliteratsiyasi va "Ўзбекча (кирилл)" tili (`oz`).
 *
 * Interfeys matnlari kodda lotinda yozilgan; kirill rejimida ular shu funksiya bilan o'giriladi:
 *   - tarjima fayllari (`locales/uz/*.json`) — `i18n.ts` da `oz` resurslari shu yerdan yasaladi;
 *   - komponentlardagi matn — build paytida `vite-plugin-uz-cyrl.ts` JSX matni va yorliqlarni `__cyr()` bilan o'raydi.
 * Foydalanuvchi ma'lumoti (mahsulot, mijoz nomi, SKU, raqamlar) kodda emas, bazada — u o'girilmaydi.
 *
 * Bu modul hech narsani import qilmaydi (i18n bilan aylana bog'liqlik bo'lmasin): faol til `setCyrillicActive` bilan beriladi.
 */

/** Kirill rejimidagi til kodi (gov.uz dagidek). */
export const CYRILLIC_LOCALE = "oz";

let active = false;

export function setCyrillicActive(value: boolean): void {
  active = value;
}

export function isCyrillicActive(): boolean {
  return active;
}

/** O'girilmaydigan so'zlar: qisqartmalar va tovar belgilari. */
const KEEP = new Set([
  "SKU", "POS", "PDF", "QR", "GPS", "OTP", "CSV", "AVCO", "UZS", "USD", "RUB", "KZT", "EUR", "HR", "KPI", "AI", "ID", "SMS", "API",
  "URL", "IP", "PIN", "TIN", "INN", "STIR", "MFO", "ERP", "BUM", "CRM", "VAT", "QQS", "IKPU", "MXIK", "USB", "OK", "PNG", "JPG",
  "Excel", "Telegram", "Google", "Click", "Payme", "Uzum", "Android", "iOS", "WhatsApp", "Chrome", "Wi", "Fi", "Bluetooth",
  "Humo", "Uzcard", "Visa", "Mastercard", "Didox", "Soliq", "email", "Email", "e-mail", "WebSocket", "ZIP", "XLSX", "Ctrl", "Enter", "Esc",
]);

const SINGLE: Record<string, string> = {
  a: "а", b: "б", c: "с", d: "д", e: "е", f: "ф", g: "г", h: "ҳ", i: "и", j: "ж", k: "к", l: "л", m: "м", n: "н", o: "о",
  p: "п", q: "қ", r: "р", s: "с", t: "т", u: "у", v: "в", w: "в", x: "х", y: "й", z: "з",
};
const VOWELS = new Set(["a", "e", "i", "o", "u"]);
const APOSTROPHES = "'ʻʼ‘’`";
const isApostrophe = (ch: string | undefined) => ch !== undefined && APOSTROPHES.includes(ch);
const isLatin = (ch: string | undefined) => ch !== undefined && /[A-Za-z]/.test(ch);
const upper = (text: string) => text.toLocaleUpperCase("uz");

/** Bitta so'z (lotin harflar va ichki tutuq belgilari). */
function word(source: string): string {
  if (KEEP.has(source) || /\d/.test(source)) return source;
  const lower = source.toLowerCase();
  const allUpper = source.length > 1 && source === source.toUpperCase() && /[A-Z]/.test(source);
  let out = "";
  for (let i = 0; i < lower.length; i += 1) {
    const ch = lower[i]!;
    const next = lower[i + 1];
    const prev = lower[i - 1];
    let mapped: string;
    let consumed = 1;
    if ((ch === "o" || ch === "g") && isApostrophe(next)) {
      mapped = ch === "o" ? "ў" : "ғ";
      consumed = 2;
    } else if (ch === "s" && next === "h") {
      mapped = "ш";
      consumed = 2;
    } else if (ch === "c" && next === "h") {
      mapped = "ч";
      consumed = 2;
    } else if (ch === "y" && (next === "o" || next === "u" || next === "a" || next === "e") && !isApostrophe(lower[i + 2])) {
      mapped = { o: "ё", u: "ю", a: "я", e: "е" }[next]!;
      consumed = 2;
    } else if (ch === "t" && next === "s" && /^(iya|ion|iy|en|ep|ent)/.test(lower.slice(i + 2))) {
      // operatsiya → операция, litsenziya → лицензия (o'zlashma so'zlar)
      mapped = "ц";
      consumed = 2;
    } else if (ch === "e") {
      mapped = i === 0 || (prev !== undefined && VOWELS.has(prev)) ? "э" : "е";
    } else if (isApostrophe(ch)) {
      // Tutuq belgisi (ma'lumot → маълумот); so'z chetidagi qo'shtirnoq emas — u bu yerga kelmaydi
      mapped = "ъ";
    } else {
      mapped = SINGLE[ch] ?? ch;
    }
    const original = source.slice(i, i + consumed);
    const isUpper = original[0] !== undefined && original[0] !== original[0].toLowerCase();
    out += isUpper ? (allUpper ? upper(mapped) : upper(mapped[0]!) + mapped.slice(1)) : mapped;
    i += consumed - 1;
  }
  return out;
}

/** O'zgarmaydigan bo'laklar: {{o'zgaruvchi}}, <teg>, havola, e-pochta. */
const PROTECTED = /\{\{[^}]*\}\}|\{[a-zA-Z_][\w.]*\}|<[^>]+>|https?:\/\/\S+|[\w.+-]+@[\w-]+\.[\w.]+/g;

function plain(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";
    if (!isLatin(ch) && !isDigit(ch)) {
      out += ch;
      i += 1;
      continue;
    }
    // So'z: lotin harflar, ichidagi tutuq/o'-g' belgisi (keyingi belgi harf bo'lsa yoki o'/g' dan keyin), chiziqcha emas
    let j = i + 1;
    while (j < text.length) {
      const c = text[j]!;
      if (isLatin(c) || isDigit(c)) j += 1;
      else if (isApostrophe(c) && (isLatin(text[j + 1]) || /[oOgG]/.test(text[j - 1] ?? ""))) j += 1;
      else break;
    }
    out += word(text.slice(i, j));
    i = j;
  }
  return out;
}

export function toCyrillic(text: string): string {
  if (!text || !/[A-Za-z]/.test(text)) return text;
  let out = "";
  let last = 0;
  for (const match of text.matchAll(PROTECTED)) {
    out += plain(text.slice(last, match.index)) + match[0];
    last = match.index! + match[0].length;
  }
  return out + plain(text.slice(last));
}

/** Build paytida qo'yiladi: kirill rejimida matnni o'giradi, aks holda o'zgarishsiz. */
export function __cyr<T>(text: T): T {
  return (active && typeof text === "string" ? toCyrillic(text) : text) as T;
}

/** Shablon satr uchun: faqat yozilgan qismlar o'giriladi, `${qiymat}` lar (ma'lumot) — o'zgarmaydi. */
export function __cyrT(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = "";
  strings.forEach((part, index) => {
    out += active ? toCyrillic(part) : part;
    if (index < values.length) out += String(values[index]);
  });
  return out;
}

/**
 * Server xabari (xato, bildirishnoma): qo'shtirnoq ichidagi qismlar (odatda ma'lumot — mahsulot, mijoz nomi) o'girilmaydi.
 */
export function cyrMessage(text: string): string {
  if (!active || !text) return text;
  return text
    .split(/("[^"]*"|«[^»]*»)/)
    .map((part) => (part.startsWith('"') || part.startsWith("«") ? part : toCyrillic(part)))
    .join("");
}
