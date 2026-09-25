/**
 * PDF uchun UNICODE shrift: kirill matn buzilmasin.
 *
 * Muammo (2026-09-24, production nakladnoyida ko'rindi): jsPDF ning ichki `helvetica` shrifti
 * faqat WinAnsi (Latin-1) kodlashni biladi. "Раматов Расул" degan agent nomi PDF'da
 * `0 < 0 B > 2  0 A C ;` bo'lib chiqardi — ya'ni kirill ismli hamma xodim, mijoz va do'kon
 * hujjatda o'qib bo'lmas holda edi.
 *
 * Yechim: PT Sans (OFL, kirill uchun maxsus ishlangan) hujjat yaratilganda BIR MARTA yuklanadi
 * va jsPDF virtual fayl tizimiga qo'yiladi. Shrift `/fonts/` dan alohida fayl bo'lib keladi —
 * ilovaning asosiy bundle'i og'irlashmaydi, brauzer esa uni keshlaydi.
 *
 * Shrift yuklanmasa (internet yo'q, fayl topilmadi) hujjat baribir chiqadi: `helvetica` ga
 * qaytamiz. Lotin matn o'qiladi, kirill esa avvalgidek buziladi — lekin PDF umuman
 * chiqmay qolgandan yaxshiroq.
 */
import type jsPDF from "jspdf";

export const PDF_FONT = "PTSans";

const FILES = [
  { file: "PTSans-Regular.ttf", style: "normal" as const, url: "/fonts/PTSans-Regular.ttf" },
  { file: "PTSans-Bold.ttf", style: "bold" as const, url: "/fonts/PTSans-Bold.ttf" },
];

/** Bir marta yuklab olinadi va keyingi hujjatlarda qayta ishlatiladi. */
let cache: Promise<{ file: string; style: "normal" | "bold"; base64: string }[] | null> | null = null;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // Katta fayl uchun bo'lak-bo'lak: `String.fromCharCode(...bytes)` stack'ni to'ldiradi
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function load() {
  cache ??= (async () => {
    try {
      return await Promise.all(
        FILES.map(async (item) => {
          const response = await fetch(item.url);
          if (!response.ok) throw new Error(`${item.url} → ${response.status}`);
          return { file: item.file, style: item.style, base64: toBase64(await response.arrayBuffer()) };
        }),
      );
    } catch (error) {
      console.warn("[BUM ERP] PDF shrifti yuklanmadi, helvetica ishlatiladi:", error);
      cache = null; // keyingi hujjatda yana urinib ko'riladi
      return null;
    }
  })();
  return cache;
}

/**
 * Hujjatga unicode shriftni ulaydi va uni JORIY shrift qilib qo'yadi.
 * Qaytadi: ishlatilayotgan shrift nomi (`PTSans` yoki zaxira `helvetica`).
 */
export async function applyUnicodeFont(doc: jsPDF): Promise<string> {
  const fonts = await load();
  if (!fonts) return "helvetica";
  for (const font of fonts) {
    doc.addFileToVFS(font.file, font.base64);
    doc.addFont(font.file, PDF_FONT, font.style);
  }
  doc.setFont(PDF_FONT, "normal");
  return PDF_FONT;
}

/**
 * Hujjat yaratilgandan keyin `setFont("helvetica", ...)` chaqiruvlari unicode shriftga
 * yo'naltiriladi. Shu bilan hamma mavjud hujjat kodi (nakladnoy, hisob-faktura, maosh
 * varaqasi) o'zgarishsiz kirill matnni to'g'ri chizadi.
 */
export function redirectHelvetica(doc: jsPDF, fontName: string): void {
  if (fontName === "helvetica") return;
  const original = doc.setFont.bind(doc);
  doc.setFont = ((family: string, style?: string) => {
    if (family !== "helvetica") return original(family, style);
    /**
     * PT Sans'da faqat `normal` va `bold` bor. `italic` so'ralsa jsPDF shriftni topa olmay
     * standart Times-Italic'ga tushardi — u esa kirillni bilmaydi, ya'ni qiya yozilgan
     * matndagi kirill yana buzilardi. Shuning uchun qiya → oddiy.
     */
    return original(fontName, style === "bold" || style === "bolditalic" ? "bold" : "normal");
  }) as typeof doc.setFont;
}
