/**
 * SOXTA GPS OQIMI — brauzer testlari uchun.
 *
 * Nega kerak: `context.setGeolocation()` brauzerga BITTA statik nuqta beradi. Haqiqiy qurilmada GPS
 * bir necha soniyada yangi o'lchov chiqaradi, statik mock esa boshqa hech narsa bermaydi. Natijada:
 *
 *   1. ilovadagi kuzatuv (`watchPosition`) nuqtani bir marta oladi va keyin jim qoladi;
 *   2. ilova eskirgan nuqta bilan ish qilmaydi — 15 soniyadan keyin YANGI o'lchov so'raydi
 *      (`getCurrentPosition`, `maximumAge: 15s`);
 *   3. Chromium'ning keshi eskirgani uchun bu so'rov javobsiz qoladi va faqat o'z taymauti bilan
 *      (20 s) xato beradi — "Joylashuvni aniqlab bo'lmadi".
 *
 * Ya'ni bu ilovaning emas, mock'ning cheklovi. Shuning uchun testda nuqtani davriy ravishda qayta
 * e'lon qilamiz — aynan qurilmadagi GPS oqimi kabi. KOORDINATA O'ZGARMAYDI: geofence, masofa va
 * aniqlik tekshiruvlari (ham UI, ham server) o'z kuchida qoladi.
 */
import type { BrowserContext } from "@playwright/test";

export type GeoPoint = { latitude: number; longitude: number; accuracy?: number };

/** Standart oraliq: ilova qabul qiladigan "yangilik" chegarasidan (15 s) ancha kichik. */
const DEFAULT_INTERVAL_MS = 5_000;

/**
 * Nuqtani darhol qo'yadi va to'xtatilgunga qadar davriy qayta e'lon qiladi.
 * Qaytgan funksiya oqimni to'xtatadi (test oxirida chaqiriladi).
 */
export async function startGeoFeed(
  context: BrowserContext,
  point: GeoPoint,
  intervalMs = DEFAULT_INTERVAL_MS,
): Promise<() => void> {
  const coords = { accuracy: 10, ...point };
  await context.setGeolocation(coords);

  let stopped = false;
  const pump = async () => {
    while (!stopped) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      if (stopped) return;
      try {
        await context.setGeolocation(coords);
      } catch {
        return; // kontekst yopilgan — test tugadi
      }
    }
  };
  void pump();

  return () => {
    stopped = true;
  };
}
