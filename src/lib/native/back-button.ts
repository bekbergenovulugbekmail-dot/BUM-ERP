/**
 * Android'dagi apparat "orqaga" tugmasi.
 *
 * Standart holatda Capacitor bu tugmani o'zi qayta ishlaydi va tarix bo'sh bo'lsa ilovadan chiqadi —
 * shu sababli foydalanuvchi oldingi sahifaga qaytish o'rniga ilovadan chiqib ketardi. Bu yerda tartib aniq:
 *   1) ochiq oyna (dialog, sheet, dropdown) bo'lsa — avval o'sha yopiladi (Escape bilan);
 *   2) tarixda orqaga qaytish mumkin bo'lsa — qaytiladi;
 *   3) bosh sahifada — "yana bir marta bosing" deb ogohlantiriladi va faqat ikkinchi bosishda chiqiladi,
 *      ya'ni tasodifiy bosishda ish yo'qolmaydi.
 *
 * Brauzerda hech narsa qilmaydi. Plagin yo'q eski APK'da ham xavfsiz — `hasNativePlugin` tekshiriladi.
 */
import { hasNativePlugin } from "./platform.ts";

/** Ikkinchi bosish shu vaqt ichida kelsa — ilovadan chiqiladi. */
const EXIT_WINDOW_MS = 2000;

/** Ochiq modal oyna bormi (Radix `data-state="open"` qo'yadi). */
function openOverlay(): Element | null {
  return document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-radix-popper-content-wrapper] [data-state="open"]',
  );
}

type Options = {
  /** Chiqishdan oldingi ogohlantirish (toast). */
  onConfirmExit: (message: string) => void;
};

/**
 * Tugmani ushlaydi. Tozalash funksiyasini qaytaradi (effektda `return` qilinadi).
 * Plagin mavjud bo'lmasa — hech narsa qilmaydi va bo'sh tozalash qaytaradi.
 */
export function listenAndroidBack({ onConfirmExit }: Options): () => void {
  if (!hasNativePlugin("App")) return () => undefined;

  let disposed = false;
  let remove: (() => void) | null = null;
  let lastPress = 0;

  void (async () => {
    const { App } = await import("@capacitor/app");
    if (disposed) return;
    const handle = await App.addListener("backButton", ({ canGoBack }) => {
      // 1) Ochiq oyna — avval uni yopamiz
      const overlay = openOverlay();
      if (overlay) {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        return;
      }
      // 2) Tarixda orqaga
      if (canGoBack || window.history.length > 1) {
        window.history.back();
        return;
      }
      // 3) Bosh sahifa — ikki marta bosilsagina chiqiladi
      const now = Date.now();
      if (now - lastPress < EXIT_WINDOW_MS) {
        void App.exitApp();
        return;
      }
      lastPress = now;
      onConfirmExit("Chiqish uchun yana bir marta bosing");
    });
    if (disposed) void handle.remove();
    else remove = () => void handle.remove();
  })();

  return () => {
    disposed = true;
    remove?.();
  };
}
