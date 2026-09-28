/**
 * EKRAN MASSHTABI — ekranning pastki chap burchagida "− 100% +" boshqaruvi. Butun oynani (shrift, tugma, logo,
 * rasm) birga kattalashtiradi yoki kichraytiradi; foizga bosilsa 100% ga qaytadi. Tanlov kassir bo'yicha saqlanadi
 * (`device:save-prefs` → `zoomPercent`) va ilova qayta ochilganda tiklanadi. Tezkor tugmalar: Ctrl + / Ctrl − / Ctrl 0.
 */
import { useEffect } from "react";
import { Minus, Plus } from "lucide-react";
import type { DevicePrefs } from "../shared/kassa-api.js";
import { ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, normalizeZoom } from "../shared/themes.js";
import { call } from "./kassa.ts";

type Props = { prefs: DevicePrefs; onPrefs: (prefs: DevicePrefs) => void };

export default function ZoomBar({ prefs, onPrefs }: Props) {
  const zoom = normalizeZoom(prefs.zoomPercent, ZOOM_DEFAULT);

  const apply = (next: number) => {
    const value = normalizeZoom(next, zoom);
    if (value === zoom) return;
    // Darhol ko'rinadi (saqlash javobini kutmaydi), keyin qurilmada saqlanadi
    onPrefs({ ...prefs, zoomPercent: value });
    call("device:save-prefs", { ...prefs, zoomPercent: value }).then(onPrefs, () => undefined);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.key === "+" || event.key === "=") apply(zoom + ZOOM_STEP);
      else if (event.key === "-") apply(zoom - ZOOM_STEP);
      else if (event.key === "0") apply(ZOOM_DEFAULT);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div
      className="fixed bottom-2 left-2 z-40 flex items-center gap-0.5 rounded-full border border-border bg-card/90 px-1 py-0.5 shadow-sm backdrop-blur"
      aria-label="Ekran masshtabi"
    >
      <button
        type="button"
        className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-40"
        title={`Kichraytirish (Ctrl −, eng kichigi ${ZOOM_MIN}%)`}
        aria-label="Kichraytirish"
        disabled={zoom <= ZOOM_MIN}
        onClick={() => apply(zoom - ZOOM_STEP)}
      >
        <Minus className="size-4" />
      </button>
      <button
        type="button"
        className="min-w-11 rounded-full px-1 text-xs font-semibold tabular-nums text-muted-foreground hover:bg-muted"
        title="100% ga qaytarish (Ctrl 0)"
        onClick={() => apply(ZOOM_DEFAULT)}
      >
        {zoom}%
      </button>
      <button
        type="button"
        className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-40"
        title={`Kattalashtirish (Ctrl +, eng kattasi ${ZOOM_MAX}%)`}
        aria-label="Kattalashtirish"
        disabled={zoom >= ZOOM_MAX}
        onClick={() => apply(zoom + ZOOM_STEP)}
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}
