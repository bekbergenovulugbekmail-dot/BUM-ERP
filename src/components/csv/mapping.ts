/**
 * Import ustunlarini moslash mantig'i (UI'siz qism — `csv-toolbar.tsx` shulardan foydalanadi).
 *
 * Moslash ikki tomondan bajariladi: maydon ro'yxatidan ("Telefon uchun qaysi ustun?") va fayl namunasi
 * jadvalining sarlavhasidan ("bu ustun — Telefon"). Ikkalasi bitta `choice` obyektiga yozadi, shuning
 * uchun bitta ustun ikkita maydonga tushib qolmaydi.
 */

/** "Bu maydon olinmasin" tanlovi (Radix Select bo'sh qiymatni qabul qilmaydi). */
export const SKIP = "__skip__";

/** Maydon kaliti → fayl ustuni (yoki `SKIP`). */
export type Choice = Record<string, string>;

/**
 * Maydonga fayl ustunini biriktiradi va o'sha ustunni ISHLATAYOTGAN boshqa maydonni bo'shatadi:
 * bir ustun ikki maydonga tushsa, import qaysi biriga yozishni bilmay qoladi.
 */
export function assignColumn(choice: Choice, key: string, field: string): Choice {
  const next: Choice = { ...choice, [key]: field };
  if (field === SKIP) return next;
  for (const [otherKey, otherField] of Object.entries(choice)) {
    if (otherKey !== key && otherField === field) next[otherKey] = SKIP;
  }
  return next;
}

/** Fayl ustunini qaysi maydon egallagani (namuna jadvalining sarlavhasi shuni ko'rsatadi). */
export function columnOwner(choice: Choice, field: string): string | null {
  return Object.entries(choice).find(([, value]) => value === field)?.[0] ?? null;
}

/** Ustunni boshqa maydonga (yoki hech qaysiga) o'tkazadi — jadval sarlavhasidagi tanlov shu. */
export function assignByColumn(choice: Choice, field: string, key: string | null): Choice {
  const cleared: Choice = { ...choice };
  for (const [otherKey, otherField] of Object.entries(choice)) {
    if (otherField === field) cleared[otherKey] = SKIP;
  }
  return key ? assignColumn(cleared, key, field) : cleared;
}

/** Maydon tagida ko'rsatiladigan namuna qiymatlar (bo'sh kataklar hisobga olinmaydi). */
export function sampleValues(rows: Record<string, string>[], field: string, limit = 3): string[] {
  const seen: string[] = [];
  for (const row of rows) {
    const value = (row[field] ?? "").trim();
    if (value && !seen.includes(value)) seen.push(value);
    if (seen.length >= limit) break;
  }
  return seen;
}

/**
 * Ajratgichni qo'lda tanlash — fayl ustunlarga ajralmagan holat uchun.
 * `null` — avtomatik aniqlash (`papaparse` o'zi topadi).
 */
export const DELIMITERS: { value: string | null; label: string; slug: string }[] = [
  { value: null, label: "Avtomatik", slug: "auto" },
  { value: ",", label: "Vergul ,", slug: "comma" },
  { value: ";", label: "Nuqtali vergul ;", slug: "semicolon" },
  { value: "\t", label: "Tabulyatsiya", slug: "tab" },
  { value: "|", label: "Tik chiziq |", slug: "pipe" },
];
