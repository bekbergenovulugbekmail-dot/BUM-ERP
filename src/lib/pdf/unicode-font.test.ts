/**
 * Kirill matn PDF'da o'qilishi kerak.
 *
 * Regressiya (2026-09-24, production nakladnoyi): jsPDF ning ichki `helvetica` shrifti faqat
 * Latin-1 ni biladi, shuning uchun "Раматов Расул" hujjatda `0 < 0 B > 2  0 A C ;` bo'lib
 * chiqardi. Bu yerda HAQIQIY shrift fayli (`public/fonts`) o'qilib jsPDF ga beriladi:
 * fayl yaroqli ekani va hujjat unicode shrift bilan chizilayotgani tekshiriladi.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FONT_DIR = resolve(import.meta.dirname, "../../../public/fonts");

/** Brauzerdagidek: `/fonts/...` so'rovi haqiqiy fayl bilan javob beradi. */
async function mockFontFetch() {
  const files = new Map<string, Buffer>([
    ["/fonts/PTSans-Regular.ttf", await readFile(resolve(FONT_DIR, "PTSans-Regular.ttf"))],
    ["/fonts/PTSans-Bold.ttf", await readFile(resolve(FONT_DIR, "PTSans-Bold.ttf"))],
  ]);
  vi.stubGlobal("fetch", async (url: string) => {
    const data = files.get(String(url));
    if (!data) return { ok: false, status: 404 };
    return { ok: true, status: 200, arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
  });
  return files;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PDF unicode shrifti", () => {
  it("shrift fayllari yaroqli TrueType va kirill uchun yetarli hajmda", async () => {
    const files = await mockFontFetch();
    for (const [name, data] of files) {
      // TrueType imzosi: 0x00010000 yoki "true"
      const signature = data.readUInt32BE(0);
      expect(signature === 0x00010000 || signature === 0x74727565, `${name} TrueType emas`).toBe(true);
      expect(data.byteLength, `${name} juda kichik — kirill glifi bo'lmasligi mumkin`).toBeGreaterThan(100_000);
    }
  });

  it("hujjat unicode shrift bilan ochiladi va kirill matn chiziladi", async () => {
    await mockFontFetch();
    const { createDocument } = await import("./pdf-utils.ts");
    const doc = await createDocument();

    // Shrift ro'yxatida PTSans bor va joriy shrift o'sha
    expect(Object.keys(doc.getFontList())).toContain("PTSans");
    expect(doc.getFont().fontName).toBe("PTSans");

    // Kirill matn xatosiz chiziladi va kengligi hisoblanadi (helvetica'da glif yo'q edi)
    const cyrillic = "Раматов Расул";
    expect(() => doc.text(cyrillic, 10, 10)).not.toThrow();
    expect(doc.getTextWidth(cyrillic)).toBeGreaterThan(0);
  });

  it("shrift yuklanmasa hujjat baribir chiqadi (helvetica zaxira)", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 404 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { createDocument } = await import("./pdf-utils.ts");
    const doc = await createDocument();
    expect(doc.getFont().fontName).toBe("helvetica");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("`helvetica` so'ralganda ham unicode shriftga yo'naltiriladi", async () => {
    await mockFontFetch();
    const { createDocument } = await import("./pdf-utils.ts");
    const doc = await createDocument();
    // Mavjud hujjat kodi hamma joyda `setFont("helvetica", ...)` yozadi — u o'zgarmasdan ishlashi kerak
    doc.setFont("helvetica", "bold");
    expect(doc.getFont().fontName).toBe("PTSans");
  });
});
