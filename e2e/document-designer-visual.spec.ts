/**
 * VIZUAL DIZAYNER — HAQIQIY BRAUZERDA, HAQIQIY SICHQONCHA BILAN QABUL SINOVI.
 *
 * Egasining talabi (2026-09-25): "elementni o'zini ushlab sichqoncha bilan ko'chirish,
 * burchagidan ushlab kattalashtirish/kichraytirish". Shuning uchun bu yerda hech narsa
 * maydonga son yozib qilinmaydi: `page.mouse` bilan bosib, tortib, qo'yib yuboriladi —
 * foydalanuvchi qo'li bilan qiladigandek. Keyin:
 *   - saqlanadi, sahifa YANGILANADI, shablon qayta ochiladi va joy tekshiriladi;
 *   - shablon bilan HAQIQIY PDF chiziladi va varaq (dizayner) bilan PIKSELMA-PIKSEL
 *     solishtiriladi — joy siljishi (drift) bo'lsa test yiqiladi;
 *   - QR PDF ichidan dekoder bilan topilib, joyi mm da o'lchanadi;
 *   - nakladnoy Dostavka bo'limidan chiqariladi: ikkitasi bitta A4 da.
 * Hamma rasm `e2e/.artifacts/vizual/` da qoladi (ko'z bilan tekshirish uchun).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { appPath, COMPANY_HEADERS, login } from "./_lib/accounts.ts";

test.describe.configure({ timeout: 480_000 });
test.use({ viewport: { width: 1600, height: 1000 } });

const ARTIFACTS = resolve(import.meta.dirname, ".artifacts/vizual");
mkdirSync(ARTIFACTS, { recursive: true });

/** 200×100 PNG (logotip o'rniga): chap yarmi ko'k, o'ng yarmi qizil — nisbati 2:1. */
async function logoPng(page: Page): Promise<Buffer> {
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 100;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#1d4ed8";
    context.fillRect(0, 0, 100, 100);
    context.fillStyle = "#dc2626";
    context.fillRect(100, 0, 100, 100);
    return canvas.toDataURL("image/png");
  });
  return Buffer.from(data.split(",")[1]!, "base64");
}

type Box = { x: number; y: number; w: number; h: number };
type Element = Record<string, unknown> & { id: string; type: string; x?: number; y?: number; width?: number; height?: number };
type Schema = { page: { layout?: string }; sections: { key: string; elements: Element[] }[] };

const designPage = (page: Page) => page.getByTestId("design-page");
const element = (page: Page, id: string) => page.locator(`[data-testid=canvas-element][data-id="${id}"]`);

async function pxPerMm(page: Page): Promise<number> {
  return Number(await designPage(page).getAttribute("data-px-per-mm"));
}

/** Elementning varaqdagi joyi (mm) — EKRANDAN o'lchanadi (DOM holatiga emas, ko'ringaniga). */
async function screenBox(page: Page, id: string): Promise<Box> {
  const px = await pxPerMm(page);
  const pageBox = (await designPage(page).boundingBox())!;
  const box = (await element(page, id).boundingBox())!;
  return { x: (box.x - pageBox.x) / px, y: (box.y - pageBox.y) / px, w: box.width / px, h: box.height / px };
}

/** Sichqoncha bilan: bosish → tortish → qo'yib yuborish. */
async function mouseDrag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx * 0.3, from.y + dy * 0.3, { steps: 4 });
  await page.mouse.move(from.x + dx * 0.8, from.y + dy * 0.8, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

/**
 * Elementni KO'RINIB TURGAN qismining o'rtasidan ushlab suradi (katta zoomda element
 * aylantirish qutisidan kengroq bo'ladi — foydalanuvchi ham ko'ringan joyidan ushlaydi).
 */
async function dragElement(page: Page, target: Locator, dx: number, dy: number) {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  const view = (await page.getByTestId("design-scroller").boundingBox())!;
  const left = Math.max(box.x, view.x + 30);
  const right = Math.min(box.x + box.width, view.x + view.width - 20);
  const top = Math.max(box.y, view.y + 30);
  const bottom = Math.min(box.y + box.height, view.y + view.height - 20);
  await mouseDrag(page, { x: (left + right) / 2, y: top + Math.min((bottom - top) / 2, 12) }, dx, dy);
}

/** Tanlangan elementning tutqichidan (burchak/qirra) tortadi. */
async function dragHandle(page: Page, handle: string, dx: number, dy: number) {
  const target = page.getByTestId(`handle-${handle}`);
  await expect(target).toBeVisible();
  const box = (await target.boundingBox())!;
  await mouseDrag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, dx, dy);
}

async function selectedId(page: Page): Promise<string> {
  const selected = page.locator("[data-testid=canvas-element][data-selected=true]");
  await expect(selected).toHaveCount(1);
  return (await selected.getAttribute("data-id"))!;
}

/** Elementlar rasmlari chizilib bo'lguncha (har element — haqiqiy PDF rasmi). */
async function waitSprites(page: Page) {
  await expect(async () => {
    const total = await page.getByTestId("canvas-element").count();
    const images = await page.locator("[data-testid=canvas-element] img").count();
    expect(total).toBeGreaterThan(0);
    expect(images).toBe(total);
    await expect(page.getByTestId("canvas-status")).not.toContainText("chizilmoqda");
  }).toPass({ timeout: 60_000 });
}

async function openDesigner(page: Page) {
  await page.goto(appPath("/settings"));
  await page.getByRole("tab", { name: "Hujjatlar" }).click();
  await expect(page.getByTestId("template-select")).toBeVisible({ timeout: 60_000 });
}

/** Yangi shablon (zavod ko'rinishidan) — erkin joylashuvga o'tkazilgan holda ochiladi. */
async function createTemplate(page: Page): Promise<string> {
  const name = `Qabul ${Date.now()}`;
  await page.getByTestId("template-create").click();
  await page.getByTestId("template-name").fill(name);
  await page.getByTestId("template-create-confirm").click();
  await expect(page.getByTestId("template-select")).toContainText(name, { timeout: 60_000 });
  await waitSprites(page);
  await expect(page.getByTestId("converted-banner")).toBeVisible();
  // Varaqni ekranning tepasiga — sichqoncha bilan butun sahifa bo'ylab ishlash uchun
  await page.getByTestId("design-scroller").evaluate((node) => node.scrollIntoView({ block: "start" }));
  return name;
}

async function setZoom(page: Page, label: string) {
  await page.getByTestId("zoom-select").click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await expect(page.getByTestId("zoom-select")).toContainText(label);
}

async function snapOff(page: Page) {
  const toggle = page.getByTestId("snap-toggle");
  if ((await toggle.getAttribute("aria-pressed")) === "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
}

async function save(page: Page) {
  await page.getByTestId("template-save").click();
  await expect(page.getByText(/versiya saqlandi/).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("unsaved")).toHaveCount(0);
}

async function templateId(page: Page, name: string): Promise<string> {
  const response = await page.request.get("/api/documents/templates?documentType=delivery_waybill", { headers: COMPANY_HEADERS });
  const { templates } = (await response.json()) as { templates: { id: string; name: string }[] };
  return templates.find((template) => template.name === name)!.id;
}

async function savedSchema(page: Page, id: string): Promise<Schema> {
  const response = await page.request.get(`/api/documents/templates/${id}`, { headers: COMPANY_HEADERS });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { schema: Schema }).schema;
}

const findElement = (schema: Schema, id: string) => schema.sections.flatMap((section) => section.elements).find((item) => item.id === id)!;

/** Sahifani YANGILAB, shablonni qaytadan ochadi — holat serverdan keladi. */
async function reloadAndOpen(page: Page, name: string) {
  await page.reload();
  await page.getByRole("tab", { name: "Hujjatlar" }).click();
  await page.getByTestId("template-select").click();
  await page.getByRole("option", { name: new RegExp(name) }).click();
  await waitSprites(page);
  await expect(page.getByTestId("converted-banner")).toHaveCount(0);
  await page.getByTestId("design-scroller").evaluate((node) => node.scrollIntoView({ block: "start" }));
}

const near = (actual: number, expected: number, tolerance: number, what: string) =>
  expect(Math.abs(actual - expected), `${what}: ${actual.toFixed(2)} ≈ ${expected.toFixed(2)}`).toBeLessThanOrEqual(tolerance);

/**
 * Dizayner varag'i va HAQIQIY PDF — piksel solishtiruvi.
 *
 * Ikkalasi bir xil o'lchamda (100% zoom = 3.78 px/mm) rasmga olinadi, "siyoh" piksellari
 * (qora-kulrang) ajratiladi va biridagi har siyoh nuqtasi ikkinchisida 2 px radius ichida
 * bormi — sanaladi. Joy 1 mm siljisa ham (≈4 px) bu ko'rsatkich keskin tushadi.
 */
async function comparePdfWithEditor(page: Page, schema: Schema, name: string) {
  await setZoom(page, "100%");
  await page.keyboard.press("Escape");
  const outlines = page.getByTestId("outline-toggle");
  if ((await outlines.getAttribute("aria-pressed")) === "true") await outlines.click();
  // Faqat varaqning o'zi: yordamchi chiziqlar yashiriladi, aylantirish qutisi butun varaqqa
  // yoyiladi (aks holda yopishqoq chizg'ich va holat qatori rasmga tushib qoladi)
  await page.addStyleTag({
    content: "[data-editor-overlay],[data-ruler],[data-sonner-toaster],[data-testid=pointer-mm]{visibility:hidden!important} [data-testid=design-scroller]{height:auto!important;overflow:visible!important}",
  });
  await page.mouse.move(2, 2);
  await waitSprites(page);
  // Butun varaq ko'rinadigan oynada bo'lsin (ilova ichki qutida aylanadi — undan tashqarisi rasmga tushmaydi)
  await page.setViewportSize({ width: 1600, height: 1400 });
  await designPage(page).evaluate((node) => node.scrollIntoView({ block: "start" }));
  const editor = await designPage(page).screenshot();
  writeFileSync(resolve(ARTIFACTS, `${name}-dizayner.png`), editor);

  const result = await page.evaluate(async ({ schema: templateSchema, editorPng }) => {
    const { renderTemplate } = (await import("/src/lib/pdf/template-renderer.ts")) as typeof import("../src/lib/pdf/template-renderer.ts");
    const { sampleData } = (await import("/src/pages/settings/_lib/document-designer.ts")) as typeof import("../src/pages/settings/_lib/document-designer.ts");
    const doc = await renderTemplate(templateSchema as Parameters<typeof renderTemplate>[0], sampleData("delivery_waybill", "BUM Demo"));
    const bytes = new Uint8Array(doc.output("arraybuffer"));
    const pdfjs = (await import(/* @vite-ignore */ "/node_modules/pdfjs-dist/build/pdf.mjs")) as typeof import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/node_modules/pdfjs-dist/build/pdf.worker.mjs";
    const pdf = await pdfjs.getDocument({ data: bytes }).promise;
    const pdfPage = await pdf.getPage(1);

    const image = new Image();
    image.src = `data:image/png;base64,${editorPng}`;
    await image.decode();
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const viewport = pdfPage.getViewport({ scale: width / pdfPage.getViewport({ scale: 1 }).width });
    const pdfCanvas = document.createElement("canvas");
    pdfCanvas.width = width;
    pdfCanvas.height = height;
    const pdfContext = pdfCanvas.getContext("2d", { willReadFrequently: true })!;
    pdfContext.fillStyle = "#fff";
    pdfContext.fillRect(0, 0, width, height);
    await pdfPage.render({ canvas: pdfCanvas, canvasContext: pdfContext, viewport }).promise;

    const editorCanvas = document.createElement("canvas");
    editorCanvas.width = width;
    editorCanvas.height = height;
    const editorContext = editorCanvas.getContext("2d", { willReadFrequently: true })!;
    editorContext.drawImage(image, 0, 0);

    const ink = (context: CanvasRenderingContext2D) => {
      const { data } = context.getImageData(0, 0, width, height);
      const mask = new Uint8Array(width * height);
      for (let i = 0; i < mask.length; i += 1) {
        const lum = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
        mask[i] = lum < 200 ? 1 : 0;
      }
      return mask;
    };
    const a = ink(editorContext);
    const b = ink(pdfContext);
    const radius = 2;
    const recall = (from: Uint8Array, to: Uint8Array) => {
      let total = 0;
      let hit = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (!from[y * width + x]) continue;
          total += 1;
          let found = false;
          for (let oy = -radius; oy <= radius && !found; oy += 1) {
            for (let ox = -radius; ox <= radius && !found; ox += 1) {
              const nx = x + ox;
              const ny = y + oy;
              if (nx >= 0 && ny >= 0 && nx < width && ny < height && to[ny * width + nx]) found = true;
            }
          }
          if (found) hit += 1;
        }
      }
      return { total, ratio: total === 0 ? 1 : hit / total };
    };
    // Farq rasmi: qizil — faqat dizaynerda, ko'k — faqat PDF da, qora — ikkalasida
    const diff = pdfContext.createImageData(width, height);
    for (let i = 0; i < a.length; i += 1) {
      const color = a[i] && b[i] ? [0, 0, 0] : a[i] ? [220, 38, 38] : b[i] ? [37, 99, 235] : [255, 255, 255];
      diff.data.set([...color, 255], i * 4);
    }
    const diffCanvas = document.createElement("canvas");
    diffCanvas.width = width;
    diffCanvas.height = height;
    diffCanvas.getContext("2d")!.putImageData(diff, 0, 0);
    return {
      editorToPdf: recall(a, b),
      pdfToEditor: recall(b, a),
      pdfPng: pdfCanvas.toDataURL("image/png"),
      diffPng: diffCanvas.toDataURL("image/png"),
    };
  }, { schema, editorPng: editor.toString("base64") });

  writeFileSync(resolve(ARTIFACTS, `${name}-pdf.png`), Buffer.from(result.pdfPng.split(",")[1]!, "base64"));
  writeFileSync(resolve(ARTIFACTS, `${name}-farq.png`), Buffer.from(result.diffPng.split(",")[1]!, "base64"));
  console.log(`[${name}] dizayner→PDF ${(result.editorToPdf.ratio * 100).toFixed(2)}% (${result.editorToPdf.total} px), PDF→dizayner ${(result.pdfToEditor.ratio * 100).toFixed(2)}% (${result.pdfToEditor.total} px)`);
  expect(result.editorToPdf.total, "varaqda siyoh bor").toBeGreaterThan(2000);
  expect(result.editorToPdf.ratio, "dizaynerdagi har narsa PDF da o'sha joyda").toBeGreaterThan(0.97);
  expect(result.pdfToEditor.ratio, "PDF dagi har narsa dizaynerda o'sha joyda").toBeGreaterThan(0.97);
}

/** Yaratilgan sinov shablonlari qolib ketmasin. */
test.afterEach(async ({ page }) => {
  const list = await page.request.get("/api/documents/templates?documentType=delivery_waybill", { headers: COMPANY_HEADERS }).catch(() => null);
  if (!list?.ok()) return;
  const { templates } = (await list.json()) as { templates: { id: string; name: string; isDefault: boolean }[] };
  for (const template of templates) {
    if (!template.name.startsWith("Qabul ") || template.isDefault) continue;
    await page.request.delete(`/api/documents/templates/${template.id}`, { headers: COMPANY_HEADERS }).catch(() => null);
  }
});

test.beforeEach(async ({ page }) => {
  await login(page, "owner");
  await openDesigner(page);
});

test("LOGO: sichqoncha bilan chapdan o'ngga, burchagidan kattalashtirish/kichraytirish, saqlash → yangilash → joyida", async ({ page }) => {
  const name = await createTemplate(page);
  await snapOff(page);
  const px = await pxPerMm(page);

  await page.getByTestId("add-image").click();
  const id = await selectedId(page);
  await page.getByTestId("image-file").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: await logoPng(page) });
  await expect(page.getByAltText("Tanlangan rasm")).toBeVisible({ timeout: 30_000 });
  await waitSprites(page);
  const start = await screenBox(page, id);
  near(start.w / start.h, 2, 0.05, "logotip nisbati 2:1");

  // 1) Chapdan o'ngga — 170 px
  await dragElement(page, element(page, id), 170, 0);
  const moved = await screenBox(page, id);
  near(moved.x, start.x + 170 / px, 0.3, "o'ngga surildi (mm)");
  near(moved.y, start.y, 0.3, "vertikal joyi o'zgarmadi");

  // 2) Pastki o'ng burchakdan tortib KATTALASHTIRISH — nisbat saqlanadi
  await dragHandle(page, "se", 90, 10);
  const bigger = await screenBox(page, id);
  expect(bigger.w, "kattalashdi").toBeGreaterThan(moved.w + 20);
  near(bigger.w / bigger.h, 2, 0.05, "rasm cho'zilmadi (nisbat qulfi)");
  near(bigger.x, moved.x, 0.3, "chap-tepa burchak joyida");

  // 3) Yana tortib KICHRAYTIRISH
  await dragHandle(page, "se", -130, -40);
  const smaller = await screenBox(page, id);
  expect(smaller.w, "kichraydi").toBeLessThan(bigger.w - 25);
  near(smaller.w / smaller.h, 2, 0.05, "kichraytirishda ham nisbat saqlandi");
  await page.screenshot({ path: resolve(ARTIFACTS, "logo-dizayner.png") });

  await save(page);
  const saved = findElement(await savedSchema(page, await templateId(page, name)), id);
  near(saved.x!, smaller.x, 0.2, "bazadagi X");
  near(saved.y!, smaller.y, 0.2, "bazadagi Y");
  near(saved.width!, smaller.w, 0.2, "bazadagi eni");

  // 4) Sahifani yangilab, qayta ochamiz — logotip AYNAN o'sha joyda
  await reloadAndOpen(page, name);
  const reopened = await screenBox(page, id);
  near(reopened.x, smaller.x, 0.2, "yangilangach X");
  near(reopened.y, smaller.y, 0.2, "yangilangach Y");
  near(reopened.w, smaller.w, 0.2, "yangilangach eni");
  near(reopened.h, smaller.h, 0.2, "yangilangach bo'yi");
});

test("MIJOZ MAYDONI: {{customer.name}} pastga suriladi, shrift o'zgaradi, quti o'lchamidan alohida", async ({ page }) => {
  const name = await createTemplate(page);
  await snapOff(page);
  const px = await pxPerMm(page);

  await page.getByTestId("add-field").click();
  await page.getByTestId("add-field-customer.name").click();
  const id = await selectedId(page);
  await waitSprites(page);
  await expect(page.getByTestId("layer-" + id)).toContainText("{{customer.name}}");
  // "Mijoz: {{customer.name}}" — yorliq foydalanuvchi yozganidek
  await page.getByTestId("element-label").fill("Mijoz");
  await page.mouse.move(2, 2);
  await waitSprites(page);
  const start = await screenBox(page, id);

  await dragElement(page, element(page, id), -40, 260);
  const moved = await screenBox(page, id);
  near(moved.y, start.y + 260 / px, 0.3, "pastga surildi");
  near(moved.x, start.x - 40 / px, 0.3, "chapga surildi");

  // Shrift — asboblar panelidan; qutining o'lchami O'ZGARMAYDI
  await page.getByTestId("toolbar-font-size").fill("16");
  await page.getByTestId("font-bold").click();
  await waitSprites(page);
  const afterFont = await screenBox(page, id);
  near(afterFont.w, moved.w, 0.2, "shrift quti enini o'zgartirmaydi");
  // Qutini kengaytirish — shrift o'zgarmaydi
  await element(page, id).click();
  await dragHandle(page, "e", 60, 0);
  const wider = await screenBox(page, id);
  expect(wider.w).toBeGreaterThan(afterFont.w + 10);
  await expect(page.getByTestId("toolbar-font-size")).toHaveValue("16");

  await save(page);
  const saved = findElement(await savedSchema(page, await templateId(page, name)), id);
  expect(saved).toMatchObject({ type: "field", field: "customer.name", label: "Mijoz", style: { fontSize: 16, bold: true } });

  await reloadAndOpen(page, name);
  const reopened = await screenBox(page, id);
  near(reopened.x, wider.x, 0.2, "yangilangach X");
  near(reopened.y, wider.y, 0.2, "yangilangach Y");
  near(reopened.w, wider.w, 0.2, "yangilangach eni");
  await element(page, id).click();
  await expect(page.getByTestId("toolbar-font-size")).toHaveValue("16");
});

test("QR: pastki o'ngga suriladi, kattalashtiriladi va PDF da aynan o'sha joyda o'qiladi", async ({ page }) => {
  const name = await createTemplate(page);
  await setZoom(page, "50%");
  await snapOff(page);

  await page.getByTestId("add-qr").click();
  const id = await selectedId(page);
  await waitSprites(page);
  // Varaqning pastki o'ng burchagi tomon
  const pageBox = (await designPage(page).boundingBox())!;
  const qrBox = (await element(page, id).boundingBox())!;
  await dragElement(page, element(page, id), pageBox.x + pageBox.width - 90 - qrBox.x, pageBox.y + pageBox.height - 110 - qrBox.y);
  await dragHandle(page, "se", 25, 25);
  const placed = await screenBox(page, id);
  expect(placed.x, "o'ng tomonda").toBeGreaterThan(140);
  expect(placed.y, "pastda").toBeGreaterThan(220);
  near(placed.w, placed.h, 0.2, "QR kvadrat qoladi");
  expect(placed.w, "kattalashdi (24 mm dan)").toBeGreaterThan(30);

  await save(page);
  const schema = await savedSchema(page, await templateId(page, name));
  const saved = findElement(schema, id);

  // PDF chiziladi, QR dekoder bilan topiladi va joyi mm ga aylantiriladi
  await page.addScriptTag({ path: resolve(import.meta.dirname, "../node_modules/jsqr/dist/jsQR.js") });
  const found = await page.evaluate(async (templateSchema) => {
    const { renderTemplate } = (await import("/src/lib/pdf/template-renderer.ts")) as typeof import("../src/lib/pdf/template-renderer.ts");
    const { sampleData } = (await import("/src/pages/settings/_lib/document-designer.ts")) as typeof import("../src/pages/settings/_lib/document-designer.ts");
    const doc = await renderTemplate(templateSchema as Parameters<typeof renderTemplate>[0], sampleData("delivery_waybill", "BUM Demo"));
    const pdfjs = (await import(/* @vite-ignore */ "/node_modules/pdfjs-dist/build/pdf.mjs")) as typeof import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/node_modules/pdfjs-dist/build/pdf.worker.mjs";
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(doc.output("arraybuffer")) }).promise;
    const pdfPage = await pdf.getPage(1);
    const pxPerMm = 8;
    const viewport = pdfPage.getViewport({ scale: pxPerMm / (72 / 25.4) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await pdfPage.render({ canvas, canvasContext: context, viewport }).promise;
    const jsQR = (window as unknown as { jsQR: typeof import("jsqr").default }).jsQR;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(pixels.data, pixels.width, pixels.height);
    if (!code) return null;
    const xs = [code.location.topLeftCorner.x, code.location.bottomLeftCorner.x];
    const ys = [code.location.topLeftCorner.y, code.location.topRightCorner.y];
    const right = [code.location.topRightCorner.x, code.location.bottomRightCorner.x];
    return {
      data: code.data,
      left: Math.min(...xs) / pxPerMm,
      top: Math.min(...ys) / pxPerMm,
      right: Math.max(...right) / pxPerMm,
      png: canvas.toDataURL("image/png"),
    };
  }, schema);
  expect(found, "PDF da QR topilmadi").not.toBeNull();
  writeFileSync(resolve(ARTIFACTS, "qr-pdf.png"), Buffer.from(found!.png.split(",")[1]!, "base64"));
  expect(found!.data).toBe("NAMUNA-0001");
  // jsQR kodning TASHQI burchaklarini beradi — ular element qutisining chetlari bilan bir xil
  // bo'lishi kerak (QR qutida yuqoriga yopishgan, eni bo'yicha o'rtada, kvadrat)
  const size = Math.min(saved.width!, saved.height!);
  near(found!.left, saved.x! + (saved.width! - size) / 2, 0.5, "PDF dagi QR chap cheti (mm)");
  near(found!.top, saved.y!, 0.5, "PDF dagi QR yuqori cheti (mm)");
  near(found!.right, saved.x! + (saved.width! + size) / 2, 0.5, "PDF dagi QR o'ng cheti (mm)");
  // Dizaynerda ko'ringan joy ham xuddi shu
  near(placed.x, saved.x!, 0.2, "dizaynerdagi X = bazadagi X");
  near(placed.y, saved.y!, 0.2, "dizaynerdagi Y = bazadagi Y");
});

test("JADVAL: chiziqlari o'zgaradi, yuqoriga/pastga suriladi, eni sichqoncha bilan o'zgaradi", async ({ page }) => {
  const name = await createTemplate(page);
  await snapOff(page);
  const px = await pxPerMm(page);

  const table = page.locator("[data-testid=canvas-element][data-type=itemsTable]");
  const id = (await table.getAttribute("data-id"))!;
  await table.click();
  await page.getByTestId("table-vertical").click();
  await page.getByTestId("table-border-style").click();
  await page.getByRole("option", { name: "Uzuq" }).click();
  await page.getByTestId("table-border-width").fill("0.5");
  await waitSprites(page);
  const start = await screenBox(page, id);

  await dragElement(page, table, 0, 70);
  const lower = await screenBox(page, id);
  near(lower.y, start.y + 70 / px, 0.3, "pastga surildi");
  await dragElement(page, table, 0, -30);
  const upper = await screenBox(page, id);
  near(upper.y, lower.y - 30 / px, 0.3, "yuqoriga surildi");

  // O'ng qirradan tortib torroq qilamiz — ustunlar moslashadi
  await dragHandle(page, "e", -150, 0);
  await waitSprites(page);
  const narrow = await screenBox(page, id);
  near(narrow.w, upper.w - 150 / px, 0.3, "jadval eni");
  await page.screenshot({ path: resolve(ARTIFACTS, "jadval-dizayner.png") });

  await save(page);
  const schema = await savedSchema(page, await templateId(page, name));
  const saved = findElement(schema, id) as Element & { table: Record<string, unknown> };
  expect(saved.table).toMatchObject({ vertical: false, borderStyle: "dashed", borderWidth: 0.5 });
  near(saved.width!, narrow.w, 0.2, "bazadagi eni");
  await comparePdfWithEditor(page, schema, "jadval");
});

test("IMZO + TO'RTBURCHAK + CHIZIQ: hammasi joylashtiriladi, saqlanadi, yangilanadi va PDF bilan mos", async ({ page }) => {
  const name = await createTemplate(page);
  await snapOff(page);
  const px = await pxPerMm(page);

  // Imzo bloki — mavjudini pastroqqa surib, balandligini tortib o'zgartiramiz
  const signature = page.locator("[data-testid=canvas-element][data-type=signatures]");
  const signatureId = (await signature.getAttribute("data-id"))!;
  const signatureStart = await screenBox(page, signatureId);
  await dragElement(page, signature, 0, 40);
  await dragHandle(page, "s", 0, 30);
  await dragHandle(page, "w", 80, 0);
  const signaturePlaced = await screenBox(page, signatureId);
  near(signaturePlaced.y, signatureStart.y + 40 / px, 0.3, "imzo pastga surildi");
  near(signaturePlaced.h, signatureStart.h + 30 / px, 0.3, "imzo balandligi");
  near(signaturePlaced.w, signatureStart.w - 80 / px, 0.3, "imzo eni");

  // To'rtburchak — qo'shiladi, suriladi, kattalashtiriladi
  await page.getByTestId("add-rect").click();
  const rectId = await selectedId(page);
  await waitSprites(page);
  const rectStart = await screenBox(page, rectId);
  await dragElement(page, element(page, rectId), (20 - rectStart.x) * px, (170 - rectStart.y) * px);
  await dragHandle(page, "se", 40, 30);
  const rect = await screenBox(page, rectId);

  // Vertikal chiziq — qo'shiladi va o'ng tomonga suriladi, pastki uchidan cho'ziladi
  await page.getByTestId("add-vline").click();
  const lineId = await selectedId(page);
  await waitSprites(page);
  // Varaqdagi aniq nuqtaga (x ≈ 185 mm, y ≈ 150 mm) — joylashuvdan qat'i nazar
  const start = await screenBox(page, lineId);
  await dragElement(page, element(page, lineId), (185 - start.x) * px, (150 - start.y) * px);
  await dragHandle(page, "s", 0, 40);
  const line = await screenBox(page, lineId);
  expect(line.h, "vertikal chiziq cho'zildi").toBeGreaterThan(65);
  await expect(page.getByTestId("handle-e"), "vertikal chiziqda faqat uchlari").toHaveCount(0);

  await save(page);
  await reloadAndOpen(page, name);
  for (const [id, expected] of [[signatureId, signaturePlaced], [rectId, rect], [lineId, line]] as const) {
    const box = await screenBox(page, id);
    near(box.x, expected.x, 0.2, `${id} X`);
    near(box.y, expected.y, 0.2, `${id} Y`);
    near(box.w, expected.w, 0.2, `${id} eni`);
    near(box.h, expected.h, 0.2, `${id} bo'yi`);
  }
  const schema = await savedSchema(page, await templateId(page, name));
  expect(schema.page.layout).toBe("free");
  await comparePdfWithEditor(page, schema, "toliq");
});

test("UNDO/REDO, klaviatura, bir nechtasini tanlash va zoom 200% da koordinata", async ({ page }) => {
  await createTemplate(page);
  await snapOff(page);

  const logo = page.locator("[data-testid=canvas-element][data-type=totals]");
  const logoId = (await logo.getAttribute("data-id"))!;
  const text = page.locator("[data-testid=canvas-element][data-type=text]").first();
  const textId = (await text.getAttribute("data-id"))!;
  const table = page.locator("[data-testid=canvas-element][data-type=itemsTable]");
  const tableId = (await table.getAttribute("data-id"))!;

  const a0 = await screenBox(page, logoId);
  const b0 = await screenBox(page, textId);
  const c0 = await screenBox(page, tableId);
  await dragElement(page, logo, -60, 40); // 1) jami bloki surildi
  await dragElement(page, text, 30, 20); // 2) matn surildi
  await table.click();
  await dragHandle(page, "e", -80, 0); // 3) jadval o'lchami
  const a1 = await screenBox(page, logoId);
  const b1 = await screenBox(page, textId);
  const c1 = await screenBox(page, tableId);

  await page.mouse.move(2, 2);
  await page.keyboard.press("Control+z");
  near((await screenBox(page, tableId)).w, c0.w, 0.2, "1-Ctrl+Z: jadval o'lchami qaytdi");
  near((await screenBox(page, textId)).x, b1.x, 0.2, "matn hali surilgan");
  await page.keyboard.press("Control+z");
  near((await screenBox(page, textId)).x, b0.x, 0.2, "2-Ctrl+Z: matn joyiga qaytdi");
  near((await screenBox(page, logoId)).x, a1.x, 0.2, "jami bloki hali surilgan");
  await page.keyboard.press("Control+z");
  near((await screenBox(page, logoId)).x, a0.x, 0.2, "3-Ctrl+Z: jami bloki joyiga qaytdi");
  await page.keyboard.press("Control+y");
  near((await screenBox(page, logoId)).x, a1.x, 0.2, "Ctrl+Y: qayta qo'llandi");
  await page.getByTestId("redo").click();
  await page.getByTestId("redo").click();
  near((await screenBox(page, tableId)).w, c1.w, 0.2, "qaytarish tugmasi");

  // Klaviatura: strelka 1 mm, Shift+strelka 10 mm. Jami bloki imzo ostida qolgan — qatlamlar
  // ro'yxatidan tanlanadi (ustma-ust elementlarda foydalanuvchi ham shunday qiladi)
  await page.getByTestId(`layer-${logoId}`).click();
  const k0 = await screenBox(page, logoId);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  const k1 = await screenBox(page, logoId);
  near(k1.x - k0.x, 2, 0.15, "→ → = 2 mm");
  near(k1.y - k0.y, 10, 0.15, "Shift+↓ = 10 mm");

  // Ctrl+bosish bilan ikkitasini tanlab, chapga tekislash
  await page.getByTestId(`layer-${textId}`).click({ modifiers: ["Control"] });
  await expect(page.locator("[data-testid=canvas-element][data-selected=true]")).toHaveCount(2);
  await page.getByTestId("align-left").click();
  near((await screenBox(page, logoId)).x, (await screenBox(page, textId)).x, 0.15, "chapga tekislandi");

  // Esc — tanlov bekor; Delete — o'chiriladi
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-testid=canvas-element][data-selected=true]")).toHaveCount(0);
  await page.getByTestId(`layer-${logoId}`).click();
  await page.mouse.move(2, 2);
  await page.keyboard.press("Delete");
  await expect(element(page, logoId)).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(element(page, logoId)).toHaveCount(1);

  // Sahifa chegarasi: sarlavha o'ng chetga taqalgan — undan nariga surib bo'lmaydi
  await page.getByTestId(`layer-${textId}`).click();
  const edge = await screenBox(page, textId);
  await page.mouse.move(2, 2);
  await page.keyboard.press("Shift+ArrowRight");
  near((await screenBox(page, textId)).x + edge.w, Math.min(210, edge.x + 10 + edge.w), 0.15, "varaqdan chiqmaydi");
  // Aniq qiymat (qo'shimcha usul) — eni 100 mm, X 20 mm
  await page.getByTestId("geom-w").fill("100");
  await page.getByTestId("geom-x").fill("20");
  await page.mouse.move(2, 2);

  // Zoom 200%: 100 px suruv = 100 / (3.78 × 2) mm — xuddi shu mm tizimi
  await setZoom(page, "200%");
  const px = await pxPerMm(page);
  near(px, (96 / 25.4) * 2, 0.01, "200% da px/mm");
  const z0 = await screenBox(page, textId);
  await text.scrollIntoViewIfNeeded();
  await dragElement(page, text, 100, 0);
  const z1 = await screenBox(page, textId);
  near(z1.x - z0.x, 100 / px, 0.2, "200% da surilgan mm");
  await setZoom(page, "50%");
  near((await screenBox(page, textId)).x, z1.x, 0.3, "50% da o'sha mm joy");
});

test("YOPISHISH: yoqilganda katakka (5 mm) yoki qo'shni qirraga, o'chirilganda erkin", async ({ page }) => {
  await createTemplate(page);
  await expect(page.getByTestId("snap-toggle")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("add-rect").click();
  const id = await selectedId(page);
  await waitSprites(page);
  const others = await page.getByTestId("canvas-element").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-id")!));
  const lines = { x: [0, 14, 105, 196, 210], y: [0, 14, 148.5, 283, 297] };
  for (const other of others.filter((item) => item !== id)) {
    const box = await screenBox(page, other);
    lines.x.push(box.x, box.x + box.w / 2, box.x + box.w);
    lines.y.push(box.y, box.y + box.h / 2, box.y + box.h);
  }
  const onGrid = (value: number) => Math.abs(value / 5 - Math.round(value / 5)) < 0.02;
  const onLine = (edges: number[], candidates: number[]) => edges.some((edge) => candidates.some((line) => Math.abs(edge - line) < 0.05));

  await dragElement(page, element(page, id), 37, 53);
  const snapped = await screenBox(page, id);
  expect(onGrid(snapped.x) || onLine([snapped.x, snapped.x + snapped.w / 2, snapped.x + snapped.w], lines.x), `X yopishdi: ${snapped.x}`).toBe(true);
  expect(onGrid(snapped.y) || onLine([snapped.y, snapped.y + snapped.h / 2, snapped.y + snapped.h], lines.y), `Y yopishdi: ${snapped.y}`).toBe(true);

  // Yopishish o'chiq — piksel aniqligida erkin
  await snapOff(page);
  const px = await pxPerMm(page);
  await dragElement(page, element(page, id), 7, 3);
  const free = await screenBox(page, id);
  near(free.x - snapped.x, 7 / px, 0.2, "erkin X");
  near(free.y - snapped.y, 3 / px, 0.2, "erkin Y");
});

test("BIRGA SURISH, NUSXA (Ctrl+D), QATLAM va QORALAMA (yangilangandan keyin tiklash)", async ({ page }) => {
  const name = await createTemplate(page);
  await snapOff(page);
  const px = await pxPerMm(page);

  // Ikkita element: Ctrl bilan tanlanib, BITTASIDAN ushlab suriladi — ikkalasi birga
  await page.getByTestId("add-rect").click();
  const rectId = await selectedId(page);
  await page.getByTestId("add-qr").click();
  const qrId = await selectedId(page);
  await waitSprites(page);
  await page.getByTestId(`layer-${rectId}`).click({ modifiers: ["Control"] });
  await expect(page.locator("[data-testid=canvas-element][data-selected=true]")).toHaveCount(2);
  const r0 = await screenBox(page, rectId);
  const q0 = await screenBox(page, qrId);
  await dragElement(page, element(page, qrId), 45, 60);
  const r1 = await screenBox(page, rectId);
  const q1 = await screenBox(page, qrId);
  near(q1.x - q0.x, 45 / px, 0.3, "QR surildi");
  near(r1.x - r0.x, q1.x - q0.x, 0.15, "to'rtburchak QR bilan birga surildi (X)");
  near(r1.y - r0.y, q1.y - q0.y, 0.15, "to'rtburchak QR bilan birga surildi (Y)");

  // Qatlam: to'rtburchak eng orqaga — qatlamlar ro'yxatining oxiriga tushadi
  await page.getByTestId(`layer-${rectId}`).click();
  await page.getByTestId("layer-back").click();
  await expect(page.getByTestId("layers-panel").getByRole("button").last()).toHaveAttribute("data-testid", `layer-${rectId}`);
  await page.getByTestId("layer-front").click();
  await expect(page.getByTestId("layers-panel").getByRole("button").first()).toHaveAttribute("data-testid", `layer-${rectId}`);

  // Nusxa: Ctrl+D — 5 mm pastroq-o'ngroqda
  await page.mouse.move(2, 2);
  const before = await page.getByTestId("canvas-element").count();
  await page.keyboard.press("Control+d");
  await expect(page.getByTestId("canvas-element")).toHaveCount(before + 1);
  const copyId = await selectedId(page);
  expect(copyId).not.toBe(rectId);
  const copy = await screenBox(page, copyId);
  near(copy.x - r1.x, 5, 0.15, "nusxa 5 mm o'ngda");
  near(copy.y - r1.y, 5, 0.15, "nusxa 5 mm pastda");

  // QORALAMA: saqlamasdan sahifa yangilanadi — o'zgarish yo'qolmaydi, tiklash taklif qilinadi
  await page.waitForTimeout(1500);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.reload();
  await page.getByRole("tab", { name: "Hujjatlar" }).click();
  await page.getByTestId("template-select").click();
  await page.getByRole("option", { name: new RegExp(name) }).click();
  await expect(page.getByTestId("draft-banner")).toBeVisible({ timeout: 60_000 });
  await expect(element(page, copyId)).toHaveCount(0);
  await page.getByTestId("draft-restore").click();
  await expect(element(page, copyId)).toHaveCount(1);
  await waitSprites(page);
  await page.getByTestId("design-scroller").evaluate((node) => node.scrollIntoView({ block: "start" }));
  near((await screenBox(page, copyId)).x, copy.x, 0.2, "qoralamadan tiklangan joy");
  await save(page);
  await expect(page.getByTestId("draft-banner")).toHaveCount(0);
});

test("A4: ikkita nakladnoy bitta varaqda — erkin joylashuvdagi shablon bilan, Dostavka bo'limidan", async ({ page }) => {
  const name = await createTemplate(page);
  // Nakladnoy ixcham bo'lsin: imzoni jadval ostiga yaqinlashtiramiz
  await save(page);
  const id = await templateId(page, name);
  const before = await page.request.get("/api/documents/templates?documentType=delivery_waybill", { headers: COMPANY_HEADERS });
  const previousDefault = ((await before.json()) as { templates: { id: string; isDefault: boolean }[] }).templates.find((template) => template.isDefault)?.id;
  await expect(page.getByTestId("document-extent")).toContainText(/2 ta sig'adi|3 ta sig'adi/);

  const response = await page.request.post(`/api/documents/templates/${id}/default`, { headers: COMPANY_HEADERS, data: {} });
  expect(response.ok()).toBe(true);
  try {
    await page.goto(appPath("/delivery"));
    await page.getByRole("tab", { name: "Yetkazmalar" }).click();
    await expect(page.getByTestId("waybill-print")).toBeVisible({ timeout: 30_000 });
    const boxes = page.getByRole("checkbox", { name: /nakladnoy uchun belgilash/ });
    await expect(boxes.first()).toBeVisible({ timeout: 30_000 });
    let taken = 0;
    for (let index = 0; index < (await boxes.count()) && taken < 2; index += 1) {
      if (await boxes.nth(index).isDisabled()) continue;
      await boxes.nth(index).click();
      taken += 1;
    }
    expect(taken).toBe(2);
    await page.getByTestId("waybill-pack-mode").click();
    await page.getByRole("option", { name: /Aqlli A4/ }).click();
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 180_000 }), page.getByTestId("waybill-print").click()]);
    const { readFile } = await import("node:fs/promises");
    const pdf = await readFile((await download.path())!);
    writeFileSync(resolve(ARTIFACTS, "ikkita-bitta-a4.pdf"), pdf);
    const report = await page.evaluate(async (data) => {
      const pdfjs = (await import(/* @vite-ignore */ "/node_modules/pdfjs-dist/build/pdf.mjs")) as typeof import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/node_modules/pdfjs-dist/build/pdf.worker.mjs";
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const doc = await pdfjs.getDocument({ data: bytes }).promise;
      const pdfPage = await doc.getPage(1);
      const text = (await pdfPage.getTextContent()).items.map((item) => ("str" in item ? item.str : "")).join(" ");
      const viewport = pdfPage.getViewport({ scale: 1.6 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await pdfPage.render({ canvas, canvasContext: context, viewport }).promise;
      return { pages: doc.numPages, text, png: canvas.toDataURL("image/png") };
    }, pdf.toString("base64"));
    writeFileSync(resolve(ARTIFACTS, "ikkita-bitta-a4.png"), Buffer.from(report.png.split(",")[1]!, "base64"));
    expect(report.pages, "ikkita nakladnoy bitta A4 da").toBe(1);
    const numbers = new Set([...report.text.matchAll(/DL-\d{4}-\d{4}/g)].map((match) => match[0]));
    expect(numbers.size, "ikkala nakladnoy raqami").toBe(2);
    expect(report.text).not.toMatch(/�/u);
  } finally {
    // Kompaniyaning avvalgi standart shablonini qaytaramiz
    if (previousDefault) await page.request.post(`/api/documents/templates/${previousDefault}/default`, { headers: COMPANY_HEADERS, data: {} });
    await page.request.delete(`/api/documents/templates/${id}`, { headers: COMPANY_HEADERS }).catch(() => null);
  }
});
