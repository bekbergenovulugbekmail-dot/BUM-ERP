/**
 * Dizayner qatlamlari: har element — HAQIQIY PDF rendereri chizgan rasm.
 *
 * Nega HTML/CSS maket emas: brauzer shrifti, qator oralig'i va jadval kengligi PDF dan bir oz
 * farq qiladi, natijada "ekranda bir joyda, qog'ozda boshqa joyda" muammosi chiqadi. Bu yerda
 * element `template-free.ts` ning o'sha funksiyalari bilan kichik PDF sahifaga chiziladi va
 * pdf.js bilan rasmga aylanadi — ekrandagi piksellar PDF ning o'zi.
 *
 * Joy (`x/y/zIndex`) rasmga kirmaydi: element surilganda qayta chizilmaydi, faqat ko'chadi.
 * O'lcham yoki uslub o'zgarsa — shu elementgina qayta chiziladi (kesh kaliti bo'yicha).
 */
import { useEffect, useState } from "react";
import type { DocumentElement } from "@bum/shared";
import type { DocumentData } from "@/lib/pdf/template-common.ts";

export type Sprite = {
  /** Rasm (blob URL). */
  url: string;
  /** Rasm qamragan maydon (zaxira bilan), mm. */
  widthMm: number;
  heightMm: number;
  /** Rasm qaysi quti o'lchamida chizilgan — surish paytida cho'zib ko'rsatish uchun. */
  boxW: number;
  boxH: number;
  /** Namunadagi haqiqiy balandlik (jadval/matn qutidan uzun bo'lishi mumkin). */
  natural: number;
  bleed: number;
};

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<{ lib: PdfJs; worker: InstanceType<PdfJs["PDFWorker"]> }> | null = null;

/**
 * pdf.js — faqat dizayner ochilganda yuklanadi (asosiy to'plamga kirmaydi).
 *
 * Ishchi (worker) BITTA va o'zimizniki: hujjat yopilganda (`loadingTask.destroy`) umumiy
 * ishchi o'chib qolmasin — keyingi chizish "worker is being destroyed" bilan yiqilardi.
 */
function loadPdfJs() {
  pdfjsPromise ??= import("pdfjs-dist").then((lib) => {
    // Vite ishchini alohida `.js` qilib yig'adi — nginx da `.mjs` MIME muammosi bo'lmaydi
    const port = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
    return { lib, worker: lib.PDFWorker.create({ port }) };
  });
  return pdfjsPromise;
}

/** Element rasmining kaliti: joyi va qatlami kirmaydi. */
export function spriteKey(element: DocumentElement, pxPerMm: number): string {
  const { x: _x, y: _y, zIndex: _z, ...rest } = element;
  return `${pxPerMm}|${JSON.stringify(rest)}`;
}

/** Ekran zichligi bo'yicha chizish sifati (px/mm) — pog'onali, har zoom uchun qayta chizilmasin. */
export function renderDensity(zoomPxPerMm: number): number {
  const wanted = zoomPxPerMm * (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
  return [4, 6, 8, 12, 16].find((step) => step >= wanted) ?? 16;
}

const PT_PER_MM = 72 / 25.4;

/** Elementlarni bitta PDF ga (har biri alohida sahifa) chizib, rasmga aylantiradi. */
async function renderBatch(elements: DocumentElement[], data: DocumentData, density: number): Promise<Map<string, Sprite>> {
  const [{ renderElementSprites, SPRITE_BLEED, boxOf }, pdfjs] = await Promise.all([import("@/lib/pdf/template-free.ts"), loadPdfJs()]);
  const { pdf, pages } = await renderElementSprites(elements, data);
  const loadingTask = pdfjs.lib.getDocument({ data: new Uint8Array(pdf), worker: pdfjs.worker });
  const document = await loadingTask.promise;
  const result = new Map<string, Sprite>();
  try {
    for (const [index, meta] of pages.entries()) {
      const page = await document.getPage(index + 1);
      const viewport = page.getViewport({ scale: density / PT_PER_MM });
      const canvas = window.document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      // Shaffof fon: ustma-ust tushgan elementlar bir-birini oq to'rtburchak bilan yopmasin
      // O'z kontekstimiz (alpha bilan): pdf.js o'zi yaratganda `alpha: false` qiladi va fon qora chiqadi
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) continue;
      await page.render({ canvas, canvasContext: context, viewport, background: "rgba(0,0,0,0)" }).promise;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) continue;
      const element = elements.find((item) => item.id === meta.id)!;
      const box = boxOf(element);
      result.set(meta.id, {
        url: URL.createObjectURL(blob),
        widthMm: meta.width,
        heightMm: meta.height,
        boxW: box.w,
        boxH: box.h,
        natural: meta.natural,
        bleed: SPRITE_BLEED,
      });
    }
  } finally {
    void document.cleanup();
    void loadingTask.destroy();
  }
  return result;
}

/**
 * Kesh modul darajasida: kalit — element mazmuni + sifat, ya'ni dizayner qayta ochilganda ham
 * tayyor rasmlar qayta chizilmaydi. `shown` — har element uchun oxirgi ko'rsatilgan rasm.
 */
const cache = new Map<string, Sprite>();
const shown = new Map<string, Sprite>();
/** Chizib bo'lmagan kalitlar — cheksiz qayta urinish bo'lmasin. */
const failed = new Set<string>();

/**
 * Elementlar rasmlari. Qaytadi: id → rasm (yangisi tayyor bo'lguncha ESKISI ko'rsatiladi —
 * o'lcham o'zgartirilayotganda element yo'qolib qolmaydi, vaqtincha cho'zilib turadi).
 */
export function useElementSprites(
  elements: DocumentElement[],
  data: DocumentData | null,
  density: number,
): { sprites: Map<string, Sprite>; pending: boolean } {
  const [version, setVersion] = useState(0);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    const missing = elements.filter((element) => {
      const key = spriteKey(element, density);
      return !cache.has(key) && !failed.has(key);
    });
    if (missing.length === 0) return;
    // Sichqoncha bilan o'lcham o'zgartirilayotganda har harakatda chizmaslik uchun kichik kechikish
    const timer = window.setTimeout(() => {
      setPending(true);
      renderBatch(missing, data, density)
        .then((rendered) => {
          for (const element of missing) {
            const key = spriteKey(element, density);
            const sprite = rendered.get(element.id);
            if (sprite) cache.set(key, sprite);
            else failed.add(key);
          }
          // Kesh cheksiz o'smasin — eng eskilari bo'shatiladi (ekrandagilari emas)
          const visible = new Set(shown.values());
          for (const [key, sprite] of cache) {
            if (cache.size <= 300) break;
            if (visible.has(sprite)) continue;
            cache.delete(key);
            URL.revokeObjectURL(sprite.url);
          }
        })
        .catch(() => {
          for (const element of missing) failed.add(spriteKey(element, density));
        })
        .finally(() => {
          if (cancelled) return;
          setPending(false);
          setVersion((value) => value + 1);
        });
    }, 90);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [elements, data, density, version]);

  // Joriy elementlar uchun: keshdagi mos rasm, bo'lmasa oldingi (vaqtincha cho'ziladi)
  const sprites = new Map<string, Sprite>();
  for (const element of elements) {
    const sprite = cache.get(spriteKey(element, density)) ?? shown.get(element.id);
    if (sprite) sprites.set(element.id, sprite);
  }
  useEffect(() => {
    for (const [id, sprite] of sprites) shown.set(id, sprite);
  });
  return { sprites, pending };
}
