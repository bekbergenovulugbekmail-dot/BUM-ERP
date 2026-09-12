/**
 * "Русский" til sozlamasi: ekrandagi o'zbekcha matn lug'at bo'yicha ruschaga (`ru-dictionary.ts`).
 *  - aniq ibora (chetdagi bo'shliqlar saqlanadi);
 *  - qolip (`{}` — raqam, nom, chek raqami); qolip ichidagi qism ham shu qoidalar bilan o'giriladi;
 *  - lug'atda yo'q matn (mahsulot nomi, serverdan kelgan xabar) o'zgarmaydi.
 */
import { RU_PATTERNS, RU_PHRASES } from "./ru-dictionary.ts";

const PHRASES = new Map(Object.entries(RU_PHRASES));

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Aniqroq (ko'proq doimiy matnli) qolip birinchi
const PATTERNS = RU_PATTERNS.map(([uz, ru]) => ({
  regex: new RegExp(`^${uz.split("{}").map(escapeRegex).join("(.+?)")}$`),
  literal: uz.replaceAll("{}", "").length,
  ru,
})).sort((a, b) => b.literal - a.literal);

export function toRussian(text: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  const [, lead = "", core = "", trail = ""] = match ?? [];
  if (!/[A-Za-z]/.test(core)) return text;
  const exact = PHRASES.get(core);
  if (exact !== undefined) return lead + exact + trail;
  for (const { regex, ru } of PATTERNS) {
    const found = regex.exec(core);
    if (!found) continue;
    let index = 1;
    // Qolip ichidagi qism (masalan xato matni) ham o'giriladi — u butun matndan qisqa, rekursiya tugaydi
    return lead + ru.replace(/\{\}/g, () => toRussian(found[index++] ?? "")) + trail;
  }
  return text;
}
