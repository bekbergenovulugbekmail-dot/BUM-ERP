import { useEffect, useRef, useState } from "react";
import { compareBuild, fetchServerBuild, SILENT_RELOAD_AFTER_MS } from "@/lib/build-version.ts";

/** Old planda ochiq turganda ham vaqti-vaqti bilan tekshiriladi. */
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Serverda yangi web build chiqqanini aniqlaydi.
 *
 * Tekshirish payti: ilova ochilganda, sahifa old planga qaytganda (telefonda — ilovaga qaytish,
 * brauzerda — tabga qaytish) va har 15 daqiqada.
 *
 * Fonda 2 daqiqadan ko'p turgandan keyin qaytilsa — indamay qayta yuklanadi: o'sha paytda yarim
 * yozilgan narsa bo'lmaydi va agent yangilanganini sezmaydi ham. Qolgan hollarda foydalanuvchidan
 * so'raladi (yozayotgan buyurtmasi yo'qolmasin).
 */
export function useBuildVersion(): { stale: boolean; reload: () => void } {
  const [stale, setStale] = useState(false);
  const hiddenSince = useRef<number | null>(null);

  useEffect(() => {
    // Dev'da `build.json` yo'q va har HMR'da belgi o'zgaradi — tekshiruv faqat production build'da
    if (!import.meta.env.PROD) return;
    const current = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : null;
    if (!current) return;

    let cancelled = false;
    const controller = new AbortController();

    const check = async (canReloadSilently: boolean) => {
      // Tarmoq yo'qligi aniq bo'lsa umuman so'ramaymiz — oflayn qayta yuklash ilovani "internet yo'q"
      // sahifasiga olib boradi
      if (navigator.onLine === false) return;
      const server = await fetchServerBuild(controller.signal);
      if (cancelled) return;
      const result = compareBuild(current, server);
      if (result.status !== "stale") return;
      if (canReloadSilently) window.location.reload();
      else setStale(true);
    };

    void check(false);
    const timer = setInterval(() => void check(false), CHECK_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenSince.current = Date.now();
        return;
      }
      const away = hiddenSince.current === null ? 0 : Date.now() - hiddenSince.current;
      hiddenSince.current = null;
      void check(away >= SILENT_RELOAD_AFTER_MS);
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, []);

  return { stale, reload: () => window.location.reload() };
}
