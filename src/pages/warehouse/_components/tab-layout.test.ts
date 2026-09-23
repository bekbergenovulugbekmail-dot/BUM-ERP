/**
 * OMBOR YORLIQLARI — balandlik shartnomasi.
 *
 * Regressiya (real shikoyat): "inventarizatsiyani faqat ekranni kichraytirganda ishlatish
 * mumkin". Sababi — `page.tsx` dagi yorliq paneli `flex-1 min-h-0`, ya'ni balandligi QAT'IY.
 * Bo'lim ildizi `flex flex-col h-full` bo'lsa, ichidagi `overflow-hidden` kartochkaning eng
 * kichik balandligi CSS bo'yicha 0 ga tushadi (`min-height: auto` faqat `overflow: visible`
 * da ishlaydi) va flex uni butunlay siqib yuboradi. Brauzer masshtabi kichraytirilganda
 * CSS piksel ko'payadi va ro'yxat "paydo bo'ladi" — shuning uchun xato shunday ko'rinardi.
 *
 * Shartnoma: bo'limning O'ZI aylanadi (`overflow-y-auto` + `min-h-0`), ichidagi
 * `overflow-hidden` bloklar esa siqilmaydi (`shrink-0`).
 *
 * jsdom joylashuvni hisoblamaydi, shuning uchun test MANBAni tekshiradi — bu qoidani
 * refaktoring paytida tasodifan yo'qotib qo'ymaslik uchun.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Vite muhitida `import.meta.url` diskka mos kelmaydi — yo'l loyiha ildizidan olinadi
const DIR = join(process.cwd(), "src", "pages", "warehouse", "_components");
const read = (name: string) => readFileSync(join(DIR, name), "utf8");

/** Yorliq ichida to'liq balandlikni egallaydigan bo'limlar. */
const SECTIONS = ["inventory-count-section.tsx", "movement-history.tsx"];

describe("Ombor yorlig'i balandligi", () => {
  it.each(SECTIONS)("%s ildizi o'zi aylanadi (siqilib qolmaydi)", (name) => {
    const source = read(name);
    const root = source.match(/<div className="([^"]*h-full[^"]*)">/)?.[1];
    expect(root, `${name}: ildiz konteyner topilmadi`).toBeTruthy();
    expect(root, `${name}: ildiz aylanmasa, ichidagi bloklar siqiladi`).toContain("overflow-y-auto");
    expect(root, `${name}: min-h-0 bo'lmasa flex ildizni ham siqadi`).toContain("min-h-0");
  });

  it.each(SECTIONS)("%s ichidagi overflow-hidden bloklar shrink-0 bilan", (name) => {
    const source = read(name);
    // `overflow-hidden` flex bolasining eng kichik balandligi 0 — `shrink-0` bo'lmasa yo'qoladi
    const blocks = [...source.matchAll(/className="([^"]*\boverflow-hidden\b[^"]*)"/g)].map((m) => m[1]!);
    expect(blocks.length, `${name}: tekshiriladigan blok yo'q`).toBeGreaterThan(0);
    for (const cls of blocks) {
      expect(cls, `${name}: "${cls}" — shrink-0 yo'q, blok nolgacha siqiladi`).toContain("shrink-0");
    }
  });
});
