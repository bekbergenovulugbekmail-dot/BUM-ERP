/**
 * Ishlab turgan web build serverdagisidan eskirganmi.
 *
 * Android ilovasi production saytini ochadi — ya'ni web qismi deploy bilan yangilanadi, LEKIN faqat
 * sahifa qayta yuklanganda. Agent ilovani yopmaydi (ish sessiyasi va fondagi GPS ochiq turadi),
 * shuning uchun WebView bir necha kunlik eski JS bilan ishlab yurishi mumkin edi — brauzerdagi
 * foydalanuvchi yangi ekranni ko'rib turganda telefondagi agent eskisini ko'rardi.
 *
 * Service worker'ning "yangi versiya" xabari bu holatni QOPLAMAYDI: u faqat `sw.js` fayli
 * o'zgarganda chiqadi, oddiy deployda esa `sw.js` o'zgarmaydi.
 */

/** Sahifa fonda shuncha turgandan keyin qaytsa — ogohlantirmasdan qayta yuklanadi (yarim yozilgan narsa qolmaydi). */
export const SILENT_RELOAD_AFTER_MS = 2 * 60 * 1000;

export type BuildCheck =
  | { status: "same" }
  | { status: "stale"; serverBuild: string }
  | { status: "unknown" };

/**
 * `build.json` har buildda yangi qiymat bilan chiqadi va `/assets/` dan tashqarida bo'lgani uchun
 * nginx unga `no-cache` beradi. `cache: "no-store"` — WebView'ning o'z keshi ham oraga tushmasin.
 */
export async function fetchServerBuild(signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch("/build.json", { cache: "no-store", signal });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const build = (body as { build?: unknown }).build;
    return typeof build === "string" && build.length > 0 ? build : null;
  } catch {
    // Internet yo'q yoki dev serverda bunday fayl yo'q — keyingi tekshiruvda qayta urinamiz
    return null;
  }
}

/** Solishtirish alohida: tarmoqsiz ham test qilinadi. */
export function compareBuild(current: string | null, server: string | null): BuildCheck {
  if (!server || !current) return { status: "unknown" };
  return server === current ? { status: "same" } : { status: "stale", serverBuild: server };
}
