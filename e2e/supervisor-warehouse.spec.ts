/**
 * HAQIQIY BRAUZERDA (2026-09-26):
 *   1) Ombor: Excel fayl → PREVIEW (10 blok × 6 = 60, 100 dona, 20 pachka × 10 = 200) → Import → bazadagi qoldiq →
 *      A4 hisobot (pdf.js bilan ochiladi): har sahifada sarlavha, jami qiymat = Σ qoldiq × AVCO (/stock/export).
 *   2) Supervayzer paneli: KPI va yetkazish kartalari, "Agent nomidan" → mavjud agent ish joyi agent kontekstida
 *      (banner), GPS/ish vaqti agent nomidan — 403, "Tugatish" → panelga qaytish.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";
import { appPath, login } from "./_lib/accounts.ts";

test.describe.configure({ timeout: 300_000 });
test.use({ viewport: { width: 1500, height: 1000 } });

const ARTIFACTS = resolve(import.meta.dirname, ".artifacts/supervisor-warehouse");
mkdirSync(ARTIFACTS, { recursive: true });

async function api<T = unknown>(page: Page, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: T }> {
  return page.evaluate(
    async ({ method, path, body, headers }) => {
      const res = await fetch(path, {
        method,
        headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    },
    { method, path, body, headers },
  ) as Promise<{ status: number; json: T }>;
}

async function pdfTexts(page: Page, pdf: Buffer, name: string) {
  const result = await page.evaluate(async (data) => {
    const pdfjs = (await import(/* @vite-ignore */ "/node_modules/pdfjs-dist/build/pdf.mjs")) as typeof import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/node_modules/pdfjs-dist/build/pdf.worker.mjs";
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    const pages: { text: string; width: number; height: number; png: string }[] = [];
    for (let index = 1; index <= doc.numPages; index += 1) {
      const pdfPage = await doc.getPage(index);
      const content = await pdfPage.getTextContent();
      const viewport = pdfPage.getViewport({ scale: 1 });
      const big = pdfPage.getViewport({ scale: 1.4 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(big.width);
      canvas.height = Math.round(big.height);
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      if (index <= 2 || index === doc.numPages) await pdfPage.render({ canvasContext: context, viewport: big, canvas }).promise;
      pages.push({ text: content.items.map((item) => ("str" in item ? item.str : "")).join(" "), width: viewport.width, height: viewport.height, png: index <= 2 || index === doc.numPages ? canvas.toDataURL("image/png") : "" });
    }
    return pages;
  }, pdf.toString("base64"));
  writeFileSync(resolve(ARTIFACTS, `${name}.pdf`), pdf);
  result.forEach((item, index) => {
    if (item.png) writeFileSync(resolve(ARTIFACTS, `${name}-${index + 1}.png`), Buffer.from(item.png.split(",")[1]!, "base64"));
  });
  return result;
}

/** Raqam ajratgichlari (bo'sh joy, NBSP, vergul — brauzer lokaliga qarab) olib tashlanadi. */
const digits = (text: string) => text.replace(/[\s,]/g, "");

test("ombor: Excel → preview → import → bazadagi qoldiq → A4 hisobot (AVCO)", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("/warehouse"));
  await expect(page.getByTestId("stock-import")).toBeVisible({ timeout: 30_000 });

  const warehouses = (await api<{ warehouses: { id: string; name: string; isDefault: boolean }[] }>(page, "GET", "/api/inventory/warehouses")).json.warehouses;
  const warehouse = warehouses.find((row) => row.isDefault) ?? warehouses[0]!;
  const units = (await api<{ units: { id: string; name: string; shortName: string }[] }>(page, "GET", "/api/catalog/units")).json.units;
  const piece = units.find((unit) => unit.shortName === "d") ?? units[0]!;
  const block = units.find((unit) => /^blok$/i.test(unit.name) || unit.shortName === "bl")!;
  const pack = units.find((unit) => /pach/i.test(unit.name)) ?? block;
  const stamp = Date.now();
  const products: Record<string, { id: string; sku: string; name: string }> = {};
  for (const key of ["A", "B", "C"]) {
    const sku = `E2E-IMP-${key}-${stamp}`;
    const name = `E2E import ${key} ${stamp}`;
    const res = await api<{ product: { id: string } }>(page, "POST", "/api/catalog/products", { name, sku, baseUnitId: piece.id, salesPrice: "15000", taxRate: "0" });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    products[key] = { id: res.json.product.id, sku, name };
  }
  for (const [key, unit, factor] of [["A", block, "6"], ["C", pack, "10"]] as const) {
    const conv = await api(page, "POST", "/api/catalog/unit-conversions", { productId: products[key]!.id, fromUnitId: unit.id, toUnitId: piece.id, factor });
    expect([200, 201], JSON.stringify(conv.json)).toContain(conv.status);
  }

  // Excel fayl — foydalanuvchi to'ldiradigan ko'rinishda
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Qoldiq");
  sheet.addRow(["SKU", "Mahsulot", "Birlik", "Miqdor", "Ombor", "Tannarx", "Sotuv narxi"]);
  sheet.addRow([products.A!.sku, products.A!.name, block.shortName, 10, warehouse.name, 60000, 15000]);
  sheet.addRow([products.B!.sku, products.B!.name, piece.shortName, 100, warehouse.name, 5000, 8000]);
  sheet.addRow([products.C!.sku, products.C!.name, pack.shortName, 20, warehouse.name, 30000, 4000]);
  const file = resolve(ARTIFACTS, `import-${stamp}.xlsx`);
  writeFileSync(file, Buffer.from(await workbook.xlsx.writeBuffer()));

  await page.getByTestId("stock-import").click();
  const dialog = page.getByTestId("stock-import-dialog");
  await dialog.getByTestId("stock-import-file").setInputFiles(file);
  const lines = dialog.getByTestId("stock-import-line");
  await expect(lines).toHaveCount(3, { timeout: 30_000 });
  await expect(lines.nth(0).getByTestId("stock-import-base-qty")).toContainText("60");
  await expect(lines.nth(1).getByTestId("stock-import-base-qty")).toContainText("100");
  await expect(lines.nth(2).getByTestId("stock-import-base-qty")).toContainText("200");
  await expect(dialog.getByTestId("stock-import-invalid")).toHaveCount(0);
  await expect(dialog.getByTestId("stock-import-value")).toContainText(/1[\s,]?700[\s,]?000/);
  await page.screenshot({ path: resolve(ARTIFACTS, "import-preview.png") });
  await dialog.getByTestId("stock-import-apply").click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  // Excel = baza (asosiy birlikda, bitta konversiya)
  const exported = (await api<{ rows: { productId: string; quantity: string; avgCostPrice: string | null }[]; costVisible: boolean }>(page, "GET", `/api/inventory/stock/export?warehouseId=${warehouse.id}&inStockOnly=true`)).json;
  const qty = (key: string) => Number(exported.rows.find((row) => row.productId === products[key]!.id)?.quantity ?? 0);
  expect(qty("A"), "10 blok × 6").toBe(60);
  expect(qty("B")).toBe(100);
  expect(qty("C"), "20 pachka × 10").toBe(200);
  expect(Number(exported.rows.find((row) => row.productId === products.A!.id)!.avgCostPrice)).toBe(10000);
  const expectedValue = exported.rows.reduce((sum, row) => sum + Math.round(Number(row.quantity) * Number(row.avgCostPrice ?? 0) * 100), 0) / 100;

  // A4 hisobot
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 180_000 }), page.getByTestId("stock-a4-report").click()]);
  const { readFile } = await import("node:fs/promises");
  const pages = await pdfTexts(page, await readFile((await download.path())!), "stock-a4");
  expect(pages.length).toBeGreaterThanOrEqual(1);
  for (const [index, item] of pages.entries()) {
    expect(Math.round(item.width), `${index + 1}-sahifa: A4 kenglik`).toBe(595);
    expect(Math.round(item.height), `${index + 1}-sahifa: A4 balandlik`).toBe(842);
    expect(item.text, `${index + 1}-sahifa: sarlavha takrorlanadi`).toContain("OMBOR QOLDIG'I");
  }
  const all = pages.map((item) => item.text).join(" ");
  // Uzun SKU katakda ikki qatorga bo'linadi (kesilmaydi) — bo'sh joysiz solishtiriladi
  for (const key of ["A", "B", "C"]) expect(digits(all)).toContain(products[key]!.sku);
  const last = pages[pages.length - 1]!.text;
  expect(last).toContain("JAMI");
  expect(digits(last), `jami qiymat (AVCO) = ${expectedValue}`).toContain(`qiymati(tannarxAVCO)${Math.round(expectedValue)}`);
  expect(digits(last)).toContain(String(exported.rows.length));
});

test("supervayzer: panel, 'Agent nomidan' — mavjud agent ish joyi, GPS/ish vaqti agent nomidan bloklangan", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("/distribution?tab=supervisor"));
  const section = page.getByTestId("supervisor-section");
  await expect(section).toBeVisible({ timeout: 30_000 });
  await expect(section.getByTestId("supervisor-totals")).toBeVisible();
  await expect(section.getByTestId("supervisor-delivery")).toBeVisible();
  const rows = section.getByTestId("supervisor-agent-row");
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  const overview = (await api<{ agents: { id: string; name: string }[] }>(page, "GET", "/api/sales-agent/supervisor/overview")).json;
  const first = overview.agents[0]!;
  await page.screenshot({ path: resolve(ARTIFACTS, "supervisor-panel.png") });

  // Buyurtma zanjiri (agentda buyurtma bo'lsa)
  await rows.first().getByRole("button", { name: first.name }).click();
  const chainButton = section.getByTestId("open-chain").first();
  if (await chainButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await chainButton.click();
    await expect(page.getByTestId("chain-step")).toHaveCount(7, { timeout: 15_000 });
    await page.screenshot({ path: resolve(ARTIFACTS, "order-chain.png") });
    await page.keyboard.press("Escape");
  }

  await rows.first().getByTestId("act-as-agent").click();
  await expect(page).toHaveURL(/\/sales-agent\/customers/, { timeout: 30_000 });
  await expect(page.getByTestId("act-as-banner")).toContainText(first.name, { timeout: 30_000 });
  const me = await api<{ agent: { id: string } }>(page, "GET", "/api/sales-agent/me", undefined, { "x-act-as-sales-rep": first.id });
  expect(me.status).toBe(200);
  expect(me.json.agent.id).toBe(first.id);
  const blocked = await api(page, "POST", "/api/sales-agent/work-session/start", { latitude: 41.3, longitude: 69.2, accuracy: 10, recordedAt: new Date().toISOString() }, { "x-act-as-sales-rep": first.id });
  expect(blocked.status, "ish vaqti agent nomidan boshlanmaydi").toBe(403);
  await page.screenshot({ path: resolve(ARTIFACTS, "act-as-workspace.png") });

  await page.getByTestId("act-as-banner").getByRole("button", { name: "Tugatish" }).click();
  await expect(page.getByTestId("supervisor-section")).toBeVisible({ timeout: 30_000 });
});
