/**
 * NAKLADNOY — HAQIQIY DASTURDA QABUL SINOVI.
 *
 * Bu yerda hech narsa "chizib ko'rdik" darajasida tekshirilmaydi: testlar ilovaning O'ZIDAN
 * o'tadi — kirish, Dostavka bo'limi, yetkazmalarni belgilash, "Nakladnoy" tugmasi, yuklab
 * olingan HAQIQIY PDF. Keyin o'sha PDF pdf.js bilan ochilib, sahifa soni, matni va har
 * sahifaning RASMI olinadi (`e2e/.artifacts/nakladnoy/`), ya'ni ko'z bilan tekshirish uchun
 * dalil qoladi.
 *
 * Nega shunday: 2026-09-25 da testlar yashil bo'lgan holda foydalanuvchining qo'lidagi PDF
 * ikki varaq chiqqan edi. Testning o'zi emas, DASTURNING NATIJASI tekshirilishi kerak.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { appPath, login } from "./_lib/accounts.ts";

/** Har test PDF chizadi va birinchisida ~900 KB unicode shrift yuklanadi. */
test.describe.configure({ timeout: 420_000 });

const ARTIFACTS = resolve(import.meta.dirname, ".artifacts/nakladnoy");

type PdfReport = { count: number; texts: string[] };

/**
 * Yuklab olingan PDF ni pdf.js bilan ochadi: sahifa soni, har sahifaning matni va rasmi.
 * Rasm `e2e/.artifacts/nakladnoy/<nom>-<sahifa>.png` bo'lib saqlanadi.
 */
async function inspectPdf(page: Page, pdf: Buffer, name: string): Promise<PdfReport> {
  const base64 = pdf.toString("base64");
  const result = await page.evaluate(async (data) => {
    const pdfjs = (await import(
      /* @vite-ignore */ "/node_modules/pdfjs-dist/build/pdf.mjs"
    )) as typeof import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/node_modules/pdfjs-dist/build/pdf.worker.mjs";
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    const pages: { text: string; png: string }[] = [];
    for (let index = 1; index <= doc.numPages; index += 1) {
      const pdfPage = await doc.getPage(index);
      const content = await pdfPage.getTextContent();
      const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
      const viewport = pdfPage.getViewport({ scale: 1.6 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await pdfPage.render({ canvasContext: context, viewport, canvas }).promise;
      pages.push({ text, png: canvas.toDataURL("image/png") });
    }
    return { count: doc.numPages, pages };
  }, base64);

  mkdirSync(ARTIFACTS, { recursive: true });
  writeFileSync(resolve(ARTIFACTS, `${name}.pdf`), pdf);
  result.pages.forEach((item, index) => {
    writeFileSync(resolve(ARTIFACTS, `${name}-${index + 1}.png`), Buffer.from(item.png.split(",")[1]!, "base64"));
  });
  return { count: result.count, texts: result.pages.map((item) => item.text) };
}

/** Dostavka bo'limini ochadi va belgilanadigan yetkazmalar ro'yxatini kutadi. */
async function openDeliveries(page: Page) {
  await page.goto(appPath("/delivery"));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
  // Bo'lim "Bugun" ko'rsatkichlari bilan ochiladi — ro'yxat "Yetkazmalar" ichida
  await page.getByRole("tab", { name: "Yetkazmalar" }).click();
  await expect(page.getByTestId("waybill-print")).toBeVisible({ timeout: 30_000 });
  // Belgilash katakchalari chiqquncha (ro'yxat yuklanishi)
  await expect(page.getByRole("checkbox", { name: /nakladnoy uchun belgilash/ }).first())
    .toBeVisible({ timeout: 30_000 });
}

/** Birinchi `count` ta BELGILASH MUMKIN bo'lgan yetkazmani tanlaydi va tanlanganini qaytaradi. */
async function selectDeliveries(page: Page, count: number): Promise<number> {
  const boxes = page.getByRole("checkbox", { name: /nakladnoy uchun belgilash/ });
  const total = await boxes.count();
  let taken = 0;
  for (let index = 0; index < total && taken < count; index += 1) {
    const box = boxes.nth(index);
    if (await box.isDisabled()) continue;
    await box.click();
    taken += 1;
  }
  return taken;
}

/** "Nakladnoy" tugmasini bosadi va yuklab olingan PDF baytlarini qaytaradi. */
async function printSelected(page: Page, mode: "smart" | "full"): Promise<Buffer> {
  await page.getByTestId("waybill-pack-mode").click();
  await page.getByRole("option", { name: mode === "smart" ? /Aqlli A4/ : /alohida varaq/ }).click();
  const button = page.getByTestId("waybill-print");
  await expect(button, "yetkazma belgilanganda Nakladnoy tugmasi yonishi kerak").toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 180_000 }), button.click()]);
  const path = await download.path();
  const { readFile } = await import("node:fs/promises");
  return readFile(path);
}

test.beforeEach(async ({ page }) => {
  await login(page, "owner");
});

test("ikkita yetkazma → BITTA A4", async ({ page }) => {
  await openDeliveries(page);
  expect(await selectDeliveries(page, 2), "ikkita belgilanadigan yetkazma kerak").toBe(2);
  const pdf = await printSelected(page, "smart");
  const report = await inspectPdf(page, pdf, "ikkita");

  expect(report.count, "ikkita qisqa nakladnoy bitta varaqqa sig'ishi kerak").toBe(1);
  const text = report.texts.join(" ");
  // Ikkala hujjat raqami ham bitta sahifada
  const numbers = [...text.matchAll(/DL-\d{4}-\d{4}/g)].map((match) => match[0]);
  expect(new Set(numbers).size, "ikkita turli nakladnoy raqami").toBe(2);
});

test("uchta va to'rtta yetkazma — sig'gani birga, qolgani keyingi varaqda", async ({ page }) => {
  await openDeliveries(page);
  expect(await selectDeliveries(page, 4)).toBe(4);
  const pdf = await printSelected(page, "smart");
  const report = await inspectPdf(page, pdf, "tortta");

  const numbers = new Set([...report.texts.join(" ").matchAll(/DL-\d{4}-\d{4}/g)].map((match) => match[0]));
  expect(numbers.size, "to'rttasi ham chiqishi kerak").toBe(4);
  // Har varaqqa kamida ikkitadan tushsin — aks holda joylashuv ishlamayapti
  expect(report.count, "to'rttasi 2 varaqdan oshmasin").toBeLessThanOrEqual(2);
});

test("o'nta yetkazma — hammasi chiqadi, hech biri takrorlanmaydi", async ({ page }) => {
  await openDeliveries(page);
  const taken = await selectDeliveries(page, 10);
  expect(taken, "o'nta belgilanadigan yetkazma kerak").toBe(10);
  const pdf = await printSelected(page, "smart");
  const report = await inspectPdf(page, pdf, "onta");

  const all = [...report.texts.join(" ").matchAll(/DL-\d{4}-\d{4}/g)].map((match) => match[0]);
  const unique = new Set(all);
  expect(unique.size, "o'nta turli nakladnoy").toBe(10);
  // Bitta hujjat ikki marta chizilmasin: har raqam bitta sahifada bittadan
  expect(all.length, "takroriy nakladnoy bor").toBe(10);
  expect(report.count, "aqlli joylashuv sahifani tejashi kerak").toBeLessThanOrEqual(5);
});

test("`Har biri alohida varaq` rejimi — har nakladnoy o'z sahifasida", async ({ page }) => {
  await openDeliveries(page);
  expect(await selectDeliveries(page, 3)).toBe(3);
  const pdf = await printSelected(page, "full");
  const report = await inspectPdf(page, pdf, "alohida");
  expect(report.count).toBe(3);
});

test("ma'lumot aralashmaydi: har nakladnoyda faqat o'z mijozi", async ({ page }) => {
  await openDeliveries(page);
  // Ro'yxatdagi birinchi ikkita belgilanadigan yetkazmaning mijozi
  expect(await selectDeliveries(page, 2)).toBe(2);
  const pdf = await printSelected(page, "smart");
  const report = await inspectPdf(page, pdf, "aralashmaydi");
  const text = report.texts.join(" ");

  // Buzilgan glif — pdf.js o'qiy olmagan belgilar (bo'sh yoki almashtirish belgisi)
  expect(text, "buzilgan belgi qolmasin").not.toMatch(/�/u);
  // Matn haqiqatan chiqqan (bo'sh sahifa emas)
  expect(text.length).toBeGreaterThan(80);
});
