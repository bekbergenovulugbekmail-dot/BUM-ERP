/**
 * Kirill matn PDF'da o'qilishi kerak — HAQIQIY brauzerda.
 *
 * Regressiya (2026-09-24, production nakladnoyi): agent nomi "Раматов Расул" o'rniga
 * `0 < 0 B > 2  0 A C ;` bo'lib chiqqan, chunki jsPDF ning ichki `helvetica` shrifti
 * faqat Latin-1 ni biladi. Bu yerda shriftning brauzerda yuklanishi, hujjatga ulanishi va
 * kirill matnning chizilishi tekshiriladi.
 */
import { expect, test } from "@playwright/test";
import { appPath, login } from "./_lib/accounts.ts";

test("shrift fayli brauzerga yetib keladi", async ({ page }) => {
  const response = await page.request.get("/fonts/PTSans-Regular.ttf");
  expect(response.status()).toBe(200);
  const body = await response.body();
  expect(body.byteLength).toBeGreaterThan(100_000);
  // TrueType imzosi
  expect(body.readUInt32BE(0)).toBe(0x00010000);
});

test("hujjat unicode shrift bilan ochiladi va kirill matn chiziladi", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("/dashboard"));

  const result = await page.evaluate(async () => {
    const { createDocument } = (await import("/src/lib/pdf/pdf-utils.ts")) as typeof import("../src/lib/pdf/pdf-utils.ts");
    const doc = await createDocument();
    const cyrillic = "Раматов Расул";
    doc.setFont("helvetica", "bold"); // mavjud hujjat kodi shunday yozadi
    doc.text(cyrillic, 10, 10);
    const output = doc.output("datauristring");
    return {
      fontName: doc.getFont().fontName,
      width: doc.getTextWidth(cyrillic),
      fonts: Object.keys(doc.getFontList()),
      isPdf: output.startsWith("data:application/pdf"),
    };
  });

  expect(result.fonts, "PTSans hujjatga ulanmagan").toContain("PTSans");
  expect(result.fontName, "`helvetica` unicode shriftga yo'naltirilmadi").toBe("PTSans");
  expect(result.width, "kirill matn kengligi hisoblanmadi").toBeGreaterThan(0);
  expect(result.isPdf).toBe(true);
});
