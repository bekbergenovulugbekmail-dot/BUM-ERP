/**
 * Telefon raqamni yagona ko'rinishga keltiradi: +998XXXXXXXXX.
 *
 * Convexdagi `normalizePhone` (convex/auth.ts) bilan aynan bir xil qoida —
 * ko'chirilgan akkauntlar shu ko'rinishda saqlangan.
 *
 * Qabul qilinadi: "+998 90 123 45 67", "998901234567", "901234567".
 * Raqam umuman bo'lmasa `null`; format tekshiruvi `isValidPhone` da.
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return null;
  if (digits.length === 9) return "+998" + digits;
  if (digits.length === 12 && digits.startsWith("998")) return "+" + digits;
  // Boshqa davlat kodlari — shundayligicha, faqat + qo'shiladi
  return "+" + digits;
}

const PHONE_RE = /^\+\d{9,15}$/;

export function isValidPhone(phone: string): boolean {
  return PHONE_RE.test(phone);
}
