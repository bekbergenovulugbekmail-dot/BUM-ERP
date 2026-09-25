/**
 * HUJJAT DIZAYNERI — HAQIQIY DASTURDA QABUL SINOVI.
 *
 * Foydalanuvchi shikoyati (2026-09-25): "jadval chiziqlarini tahrir qilib bo'lmayapti,
 * rasm qo'shib bo'lmayapti, QR qo'shib bo'lmayapti". Shu sababli bu yerda har bir imkoniyat
 * ILOVANING O'ZIDAN — tugmani bosib, faylni yuklab, saqlab, sahifani yangilab — tekshiriladi.
 * Oxirida shablon bilan HAQIQIY PDF chiziladi va rasmga aylantirilib saqlanadi.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { appPath, COMPANY_HEADERS, login } from "./_lib/accounts.ts";

test.describe.configure({ timeout: 420_000 });

const ARTIFACTS = resolve(import.meta.dirname, ".artifacts/dizayner");

/** 4×4 qizil PNG — yuklash yo'lini tekshirish uchun yetarli, tashqi faylga bog'liq emas. */
const LOGO_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGO4o6EBRwzEcQDzAxLBI9OCRQAAAABJRU5ErkJggg==",
  "base64",
);

type TemplateSchema = {
  sections: { key: string; elements: Record<string, unknown>[] }[];
};

/** Shablonlar ro'yxatidan shu nomdagi shablonning id'sini oladi. */
async function templateId(page: Page, name: string): Promise<string> {
  const response = await page.request.get("/api/documents/templates?documentType=delivery_waybill", { headers: COMPANY_HEADERS });
  expect(response.ok()).toBe(true);
  const { templates } = (await response.json()) as { templates: { id: string; name: string }[] };
  const found = templates.find((template) => template.name === name);
  expect(found, `"${name}" shabloni ro'yxatda yo'q`).toBeTruthy();
  return found!.id;
}

/** Serverdagi saqlangan sxema — brauzer holatiga emas, BAZAGA tushganiga ishonch. */
async function savedSchema(page: Page, id: string): Promise<TemplateSchema> {
  const response = await page.request.get(`/api/documents/templates/${id}`, { headers: COMPANY_HEADERS });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { schema: TemplateSchema }).schema;
}

const allElements = (schema: TemplateSchema) => schema.sections.flatMap((section) => section.elements);
const byType = (schema: TemplateSchema, type: string) => allElements(schema).filter((element) => element.type === type);

/** Dizaynerni ochadi va A4 ko'rinish chizilguncha kutadi. */
async function openDesigner(page: Page) {
  await page.goto(appPath("/settings"));
  await page.getByRole("tab", { name: "Hujjatlar" }).click();
  await expect(page.getByTestId("template-select")).toBeVisible({ timeout: 60_000 });
}

/** Yangi shablon yaratadi (standart ko'rinishdan nusxa) va nomini qaytaradi. */
async function createTemplate(page: Page): Promise<string> {
  const name = `Qabul ${Date.now()}`;
  await page.getByTestId("template-create").click();
  await page.getByTestId("template-name").fill(name);
  await page.getByTestId("template-create-confirm").click();
  await expect(page.getByTestId("template-select")).toContainText(name, { timeout: 60_000 });
  await expect(page.locator("[data-testid=canvas-element] img").first()).toBeVisible({ timeout: 60_000 });
  return name;
}

async function save(page: Page) {
  await page.getByTestId("template-save").click();
  await expect(page.getByText(/versiya saqlandi/)).toBeVisible({ timeout: 60_000 });
}

/** Yaratilgan sinov shablonlari qolib ketmasin (faol shablon chegarasi bor). */
test.afterEach(async ({ page }) => {
  const list = await page.request.get("/api/documents/templates?documentType=delivery_waybill", { headers: COMPANY_HEADERS }).catch(() => null);
  if (!list?.ok()) return;
  const { templates } = (await list.json()) as { templates: { id: string; name: string; isDefault: boolean }[] };
  for (const template of templates) {
    if (!template.name.startsWith("Qabul ")) continue;
    await page.request.delete(`/api/documents/templates/${template.id}`, { headers: COMPANY_HEADERS }).catch(() => null);
  }
});

test.beforeEach(async ({ page }) => {
  await login(page, "owner");
});

test("jadval chiziqlarini foydalanuvchi o'zi tahrir qiladi", async ({ page }) => {
  await openDesigner(page);
  const name = await createTemplate(page);

  // Mahsulot jadvalini tanlaymiz
  await page.getByTestId("layers-panel").getByRole("button", { name: /^Jadval/ }).click();
  await expect(page.getByTestId("table-outer")).toBeVisible({ timeout: 30_000 });

  // Har chiziq alohida: vertikalni o'chirib, gorizontalni qoldiramiz
  await page.getByTestId("table-vertical").click();
  await page.getByTestId("table-header-border").click();
  // Chiziq turi va qalinligi
  await page.getByTestId("table-border-style").click();
  await page.getByRole("option", { name: "Uzuq" }).click();
  await page.getByTestId("table-border-width").fill("0.6");
  // Katak sozlamalari
  await page.getByTestId("table-padding-x").fill("3");
  await page.getByTestId("table-row-height").fill("8");
  await page.getByTestId("table-font-size").fill("9");
  await page.getByTestId("table-zebra").click();

  await save(page);

  const schema = await savedSchema(page, await templateId(page, name));
  const table = byType(schema, "itemsTable")[0] as { table: Record<string, unknown> };
  expect(table.table, "jadval sozlamalari saqlanmadi").toMatchObject({
    vertical: false,
    headerBorder: false,
    borderStyle: "dashed",
    borderWidth: 0.6,
    paddingX: 3,
    rowHeight: 8,
    fontSize: 9,
    zebra: false,
  });
});

test("ustunlarni olib tashlash, nomlash, kengaytirish va tartibini o'zgartirish", async ({ page }) => {
  await openDesigner(page);
  const name = await createTemplate(page);

  await page.getByTestId("layers-panel").getByRole("button", { name: /^Jadval/ }).click();
  await expect(page.getByTestId("column-customerName")).toBeVisible({ timeout: 30_000 });

  // "Qarz" ustunini butunlay olib tashlaymiz
  await page.getByTestId("column-remove-customerDebt").click();
  await expect(page.getByTestId("column-customerDebt")).toHaveCount(0);

  // Nomini o'zimiz yozamiz va kengligini belgilaymiz
  await page.getByTestId("column-label-customerName").fill("Do'kon nomi");
  await page.getByTestId("column-width-customerName").fill("50");

  // Tartibni o'zgartiramiz: "Telefon" ni yuqoriga
  await page.getByTestId("column-customerPhone").getByLabel("Yuqoriga").click();

  await save(page);

  const schema = await savedSchema(page, await templateId(page, name));
  const columns = (byType(schema, "itemsTable")[0] as { columns: { key: string; label?: string; width?: number }[] }).columns;
  expect(columns.map((column) => column.key), "Qarz ustuni qolmasligi kerak").not.toContain("customerDebt");
  const customer = columns.find((column) => column.key === "customerName");
  expect(customer).toMatchObject({ label: "Do'kon nomi", width: 50 });
  expect(
    columns.findIndex((column) => column.key === "customerPhone"),
    "Telefon ustuni Mijozdan oldinga o'tishi kerak",
  ).toBeLessThan(columns.findIndex((column) => column.key === "customerName"));
});

test("rasm qo'shiladi, o'lchami o'zgaradi va saqlanadi", async ({ page }) => {
  await openDesigner(page);
  const name = await createTemplate(page);

  // Yangi element varaqqa qo'shiladi va darhol tanlanadi
  await page.getByTestId("add-image").click();
  await expect(page.getByTestId("image-upload")).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("image-file").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: LOGO_PNG });
  await expect(page.getByAltText("Tanlangan rasm")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("geom-w").fill("28");

  await save(page);

  const schema = await savedSchema(page, await templateId(page, name));
  const image = byType(schema, "image")[0] as { imageData: string; width: number };
  expect(image, "rasm elementi saqlanmadi").toBeTruthy();
  expect(image.imageData).toMatch(/^data:image\/(png|jpeg|webp);base64,/);
  expect(image.width).toBe(28);
});

test("QR kod qo'shiladi, manbasi tanlanadi va PDF ga tushadi", async ({ page }) => {
  await openDesigner(page);
  const name = await createTemplate(page);

  await page.getByTestId("add-qr").click();
  await expect(page.getByTestId("qr-source")).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("qr-source").click();
  await page.getByRole("option", { name: "Buyurtma raqami" }).click();
  await page.getByTestId("geom-w").fill("26");
  await page.getByTestId("qr-level").click();
  await page.getByRole("option", { name: /^H/ }).click();
  await page.getByTestId("element-label").fill("Tekshirish kodi");

  await save(page);

  const id = await templateId(page, name);
  const schema = await savedSchema(page, id);
  const qr = byType(schema, "qr")[0] as { qrSource: string; width: number; qrLevel: string; label: string };
  expect(qr).toMatchObject({ qrSource: "orderNumber", width: 26, qrLevel: "H", label: "Tekshirish kodi" });

  /**
   * QR ni HAQIQATAN o'qib ko'ramiz: shablon bilan PDF chiziladi, sahifa rasmga aylantiriladi
   * va QR dekoder ichidagi matnni chiqaradi. Telefon bilan skanerlashning kod bilan
   * tekshiriladigan ekvivalenti — "rasm bor" degan tekshiruv bundan ancha zaif.
   */
  // jsQR — UMD to'plam: klassik skript bo'lib yuklanadi va `window.jsQR` ni beradi
  await page.addScriptTag({ path: resolve(import.meta.dirname, "../node_modules/jsqr/dist/jsQR.js") });
  const decoded = await page.evaluate(async (templateSchema) => {
    const { renderTemplate } = (await import("/src/lib/pdf/template-renderer.ts")) as typeof import("../src/lib/pdf/template-renderer.ts");
    const { sampleData } = (await import("/src/pages/settings/_lib/document-designer.ts")) as typeof import("../src/pages/settings/_lib/document-designer.ts");
    const doc = await renderTemplate(
      templateSchema as Parameters<typeof renderTemplate>[0],
      sampleData("delivery_waybill", "BUM Demo"),
    );
    const raw = doc.output("datauristring") as string;
    const binary = atob(raw.slice(raw.indexOf(",") + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

    const pdfjs = (await import(/* @vite-ignore */ "/node_modules/pdfjs-dist/build/pdf.mjs")) as typeof import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/node_modules/pdfjs-dist/build/pdf.worker.mjs";
    const rendered = await pdfjs.getDocument({ data: bytes }).promise;
    const pdfPage = await rendered.getPage(1);
    const viewport = pdfPage.getViewport({ scale: 4 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await pdfPage.render({ canvasContext: context, viewport, canvas }).promise;

    const jsQR = (window as unknown as { jsQR: typeof import("jsqr").default }).jsQR;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(pixels.data, pixels.width, pixels.height)?.data ?? null;
  }, schema);

  // Namuna hujjatining buyurtma raqami — QR aynan shuni ko'rsatishi kerak
  expect(decoded, "QR o'qilmadi yoki boshqa qiymatni ko'rsatmoqda").toBe("SO-NAMUNA-0001");
});

test("saqlanadi, sahifa yangilangach o'zgarishlar joyida", async ({ page }) => {
  await openDesigner(page);
  const name = await createTemplate(page);

  // Bir nechta o'zgarish: matn, imzo balandligi, chiziq
  await page.getByTestId("add-text").click();
  await page.getByTestId("element-label").fill("Tovar qabul qilindi, e'tiroz yo'q");

  await page.getByTestId("layers-panel").getByRole("button", { name: /^Imzo/ }).click();
  await page.getByTestId("geom-h").fill("30");

  await save(page);

  // SAHIFANI YANGILAYMIZ — holat brauzer xotirasidan emas, serverdan kelishi kerak
  await page.reload();
  await page.getByRole("tab", { name: "Hujjatlar" }).click();
  await expect(page.getByTestId("template-select")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("template-select").click();
  await page.getByRole("option", { name: new RegExp(name) }).click();
  await expect(page.locator("[data-testid=canvas-element] img").first()).toBeVisible({ timeout: 60_000 });

  await page.getByTestId("layers-panel").getByRole("button", { name: /Tovar qabul qilindi/ }).click();
  await expect(page.getByTestId("element-label")).toHaveValue("Tovar qabul qilindi, e'tiroz yo'q");

  await page.getByTestId("layers-panel").getByRole("button", { name: /^Imzo/ }).click();
  await expect(page.getByTestId("geom-h")).toHaveValue("30");
});

test("versiyani qaytarish eski ko'rinishni tiklaydi", async ({ page }) => {
  await openDesigner(page);
  const name = await createTemplate(page);
  const id = await templateId(page, name);

  // v2: jadvalning vertikal chiziqlarini o'chiramiz
  await page.getByTestId("layers-panel").getByRole("button", { name: /^Jadval/ }).click();
  await page.getByTestId("table-vertical").click();
  await save(page);
  const v2 = await savedSchema(page, id);
  expect((byType(v2, "itemsTable")[0] as { table: { vertical: boolean } }).table.vertical).toBe(false);

  // Versiyalar ro'yxatidan v1 ni qaytaramiz
  await page.getByRole("button", { name: "Versiyalar" }).click();
  const first = page.getByText(/^v1/).first();
  await expect(first).toBeVisible({ timeout: 30_000 });
  await first.locator("xpath=ancestor::div[1]").getByRole("button", { name: "Qaytarish" }).click();
  await expect(page.getByText(/v1 qaytarildi/)).toBeVisible({ timeout: 60_000 });

  const restored = await savedSchema(page, id);
  const table = byType(restored, "itemsTable")[0] as { table?: { vertical?: boolean } };
  expect(table.table?.vertical, "v1 da vertikal chiziqlar yoqilgan edi").not.toBe(false);
});

test("to'liq ssenariy: chiziq + rasm + QR + matn bitta shablonda PDF bo'lib chiqadi", async ({ page }) => {
  await openDesigner(page);
  const name = await createTemplate(page);

  await page.getByTestId("layers-panel").getByRole("button", { name: /^Jadval/ }).click();
  await page.getByTestId("table-border-width").fill("0.5");
  await page.getByTestId("table-vertical").click();
  await page.getByTestId("column-remove-customerDebt").click();

  await page.getByTestId("add-image").click();
  await page.getByTestId("image-file").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: LOGO_PNG });
  await expect(page.getByAltText("Tanlangan rasm")).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("add-qr").click();
  await expect(page.getByTestId("qr-source")).toBeVisible({ timeout: 30_000 });

  await save(page);

  const schema = await savedSchema(page, await templateId(page, name));
  expect(byType(schema, "image").length, "rasm").toBe(1);
  expect(byType(schema, "qr").length, "QR").toBe(1);

  // Shu shablon bilan haqiqiy PDF — rasmga aylantirib saqlaymiz (ko'z bilan tekshirish uchun)
  const png = await page.evaluate(async (templateSchema) => {
    const { renderTemplate } = (await import("/src/lib/pdf/template-renderer.ts")) as typeof import("../src/lib/pdf/template-renderer.ts");
    const { sampleData } = (await import("/src/pages/settings/_lib/document-designer.ts")) as typeof import("../src/pages/settings/_lib/document-designer.ts");
    const doc = await renderTemplate(
      templateSchema as Parameters<typeof renderTemplate>[0],
      sampleData("delivery_waybill", "BUM Demo"),
    );
    const raw = doc.output("datauristring") as string;
    const binary = atob(raw.slice(raw.indexOf(",") + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

    const pdfjs = (await import(/* @vite-ignore */ "/node_modules/pdfjs-dist/build/pdf.mjs")) as typeof import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/node_modules/pdfjs-dist/build/pdf.worker.mjs";
    const rendered = await pdfjs.getDocument({ data: bytes }).promise;
    const pdfPage = await rendered.getPage(1);
    const viewport = pdfPage.getViewport({ scale: 1.6 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await pdfPage.render({ canvasContext: context, viewport, canvas }).promise;
    return canvas.toDataURL("image/png");
  }, schema);

  mkdirSync(ARTIFACTS, { recursive: true });
  writeFileSync(resolve(ARTIFACTS, "toliq-shablon.png"), Buffer.from(png.split(",")[1]!, "base64"));
});
