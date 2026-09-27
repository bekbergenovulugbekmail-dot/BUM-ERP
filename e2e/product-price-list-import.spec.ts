/**
 * NARX RO'YXATI IMPORTI — HAQIQIY BRAUZERDA (2026-09-28):
 *   Mahsulotlar → Import → fayl (Nomi;SKU;Sotuv narxi) → "Mavjudlarini yangilash" belgisi → tekshirish (bazaga yozilmaydi)
 *   → import → mavjud mahsulot sotuv narxi 8 000 → 9 500, yangi mahsulot ochilmaydi.
 */
import { expect, test, type Page } from "@playwright/test";
import { appPath, login } from "./_lib/accounts.ts";

test.describe.configure({ timeout: 240_000 });

async function api<T = unknown>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(path, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
      return { status: res.status, json: await res.json().catch(() => null) };
    },
    { method, path, body },
  ) as Promise<{ status: number; json: T }>;
}

test("mahsulot importi: mavjud SKU narxini yangilash", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("products"), { waitUntil: "domcontentloaded" });
  const stamp = String(Date.now()).slice(-7);
  const sku = `NR-${stamp}`;
  const units = (await api<{ units: { id: string; shortName: string }[] }>(page, "GET", "/api/catalog/units")).json.units;
  const piece = units.find((unit) => unit.shortName === "d")!.id;
  const created = await api<{ product: { id: string } }>(page, "POST", "/api/catalog/products", { name: `Narx ${stamp}`, sku, baseUnitId: piece, salesPrice: "8000", taxRate: "0" });
  expect(created.status, JSON.stringify(created.json)).toBe(201);
  const priceOf = async () => Number((await api<{ product: { salesPrice: string } }>(page, "GET", `/api/catalog/products/${created.json.product.id}`)).json.product.salesPrice);

  await expect(page.getByTestId("csv-import")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("csv-import").click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "narxlar.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(["Nomi;SKU;Sotuv narxi", `Narx ${stamp};${sku};9500`].join("\n"), "utf8"),
  });
  await expect(page.getByTestId("csv-mapping")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("csv-update-existing").click();
  await page.getByTestId("csv-mapping-continue").click();
  const preview = page.getByRole("dialog").filter({ hasText: "Importni tekshirish" });
  await expect(preview).toBeVisible({ timeout: 30_000 });
  await expect(preview).toContainText("Yangilanadi");
  expect(await priceOf(), "tekshirishda o'zgarmaydi").toBe(8000);
  await page.screenshot({ path: "e2e/.screenshots/product-price-list-import.png" });
  await preview.getByRole("button", { name: /Importni boshlash/ }).click();
  await expect(preview).toBeHidden({ timeout: 30_000 });
  await expect.poll(priceOf, { timeout: 15_000 }).toBe(9500);
  const same = (await api<{ products: { sku: string }[] }>(page, "GET", `/api/catalog/products?search=${sku}`)).json.products;
  expect(same.filter((row) => row.sku === sku)).toHaveLength(1);
});
