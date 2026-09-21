/**
 * Import faylining KODLASHINI aniqlab, matnga aylantiradi.
 *
 * Muammo: Excel "CSV (razdelitel — zapyataya)" bilan saqlaganda faylni UTF-8 emas, tizim kodlashida
 * (bizda — Windows-1251) yozadi. Brauzer esa faylni sukut bo'yicha UTF-8 deb o'qiydi va har bir
 * kirill harfi `U+FFFD` (savol belgisi ko'rinishidagi romb) bo'lib qoladi. Bunday matn bazaga yozilgach TIKLANMAYDI — shuning uchun kodlash
 * fayl o'qilayotgan paytda aniqlanishi kerak.
 *
 * Tartib: BOM (UTF-8 / UTF-16) → sof ASCII → qat'iy UTF-8 tekshiruvi → aks holda Windows-1251.
 * Kirill matnli 1251 fayl qat'iy UTF-8 dekoderidan deyarli hech qachon o'tmaydi (0xC0–0xFF baytlari
 * ketma-ketligi UTF-8 qoidalariga to'g'ri kelmaydi), shuning uchun tekshiruv ishonchli.
 */

/** Aniqlangan kodlash — foydalanuvchiga xabar berish uchun. */
export type DetectedEncoding = "utf-8" | "utf-16le" | "utf-16be" | "windows-1251";

export type DecodedText = { text: string; encoding: DetectedEncoding };

const startsWith = (bytes: Uint8Array, ...prefix: number[]) =>
  prefix.every((byte, index) => bytes[index] === byte);

/** Baytlar to'g'ri UTF-8 ketma-ketligimi (BOM'siz fayllar uchun asosiy mezon). */
function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function decodeWith(bytes: Uint8Array, encoding: DetectedEncoding, offset = 0): DecodedText {
  const body = offset ? bytes.subarray(offset) : bytes;
  try {
    return { text: new TextDecoder(encoding).decode(body), encoding };
  } catch {
    // Kodlash muhitda qo'llab-quvvatlanmasa — yo'qotishli UTF-8 (hech bo'lmasa fayl ochiladi)
    return { text: new TextDecoder("utf-8").decode(body), encoding: "utf-8" };
  }
}

/** Fayl baytlaridan matn: kodlash avtomatik aniqlanadi. */
export function decodeTextBytes(buffer: ArrayBuffer): DecodedText {
  const bytes = new Uint8Array(buffer);
  if (startsWith(bytes, 0xef, 0xbb, 0xbf)) return decodeWith(bytes, "utf-8", 3);
  if (startsWith(bytes, 0xff, 0xfe)) return decodeWith(bytes, "utf-16le", 2);
  if (startsWith(bytes, 0xfe, 0xff)) return decodeWith(bytes, "utf-16be", 2);
  // Sof ASCII — kodlash farq qilmaydi
  if (bytes.every((byte) => byte < 0x80)) return decodeWith(bytes, "utf-8");
  if (isValidUtf8(bytes)) return decodeWith(bytes, "utf-8");
  // Kirill matnli Excel eksporti: Windows-1251 (ANSI)
  return decodeWith(bytes, "windows-1251");
}

/** CSV faylni to'g'ri kodlash bilan o'qiydi (`papaparse` ga tayyor matn). */
export async function readTextFile(file: File): Promise<DecodedText> {
  return decodeTextBytes(await file.arrayBuffer());
}
