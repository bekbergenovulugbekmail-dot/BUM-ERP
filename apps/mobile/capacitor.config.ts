/**
 * BUM ERP Android ilovasi. Ilova production web manzilini ochadi (bitta kod, deploy — darhol hamma telefonda):
 * cookie sessiya, biznes manzili (/{biznes}/{bo'lim}), service worker oflayn keshi va real-time — web bilan bir xil.
 * Native qism: fonda GPS (ekran qulflanganda ham — faqat ish sessiyasida, doimiy bildirishnoma bilan), telefon
 * bildirishnomasi, kamera va navigatorga o'tish (`geo:` / Google Maps / Yandex havolalari tizim ilovasida ochiladi).
 *
 * Manzil: `BUM_APP_URL` (standart — kompaniyaning o'z domeni). Native plaginlar (GPS, kamera) ochiladigan sahifaga
 * beriladi — Railway umumiy domenidagi xizmat nomi o'zgarsa yoki bo'shasa begona sayt ularni ololmasin.
 */
import type { CapacitorConfig } from "@capacitor/cli";

const appUrl = process.env.BUM_APP_URL ?? "https://app.bum-erp.uz";

const config: CapacitorConfig = {
  appId: "uz.bumerp.app",
  appName: "BUM ERP",
  webDir: "www",
  server: {
    url: appUrl,
    androidScheme: "https",
    cleartext: false,
    // Server ochilmasa (internet yo'q, birinchi ishga tushirish) — ilova ichidagi sahifa
    errorPath: "offline.html",
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    LocalNotifications: {
      iconColor: "#4f46e5",
    },
  },
};

export default config;
