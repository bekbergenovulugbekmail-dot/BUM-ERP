/**
 * KELISHILGAN NARX — HAQIQIY BRAUZERDA (2026-09-28):
 *   CRM → Mijozlar → "kelishilgan narxlar" → mahsulot qidirish/tanlash → narx 7 500 → saqlash → BAZADA faol narx;
 *   o'sha kunga yangi narx — server rad etadi (price_overlap, xabar ko'rinadi); "narxni yopish" → yangi 7 200 saqlanadi,
 *   eskisi tarixda qoladi.
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

type Price = { price: string; effectiveTo: string | null; isActive: boolean };

test("mijozga kelishilgan narx: qo'shish, almashtirish (tarix), yopish", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("/crm"));
  const stamp = String(Date.now()).slice(-7);
  const units = (await api<{ units: { id: string; shortName: string }[] }>(page, "GET", "/api/catalog/units")).json.units;
  const piece = units.find((unit) => unit.shortName === "d")!.id;
  const product = await api<{ product: { id: string } }>(page, "POST", "/api/catalog/products", { name: `Kelishuv ${stamp}`, sku: `KN-${stamp}`, baseUnitId: piece, salesPrice: "8000", taxRate: "0" });
  expect(product.status, JSON.stringify(product.json)).toBe(201);
  const customer = await api<{ customer: { id: string } }>(page, "POST", "/api/sales/customers", { name: `Narx mijoz ${stamp}` });
  expect(customer.status, JSON.stringify(customer.json)).toBe(201);
  const pricesOf = async (activeOnly: boolean) =>
    (await api<{ prices: Price[] }>(page, "GET", `/api/sales/customer-prices?customerId=${customer.json.customer.id}${activeOnly ? "&activeOnly=true" : ""}`)).json.prices;

  await page.getByRole("tab", { name: "Mijozlar" }).first().click();
  await page.getByPlaceholder(/qidir/i).first().fill(`Narx mijoz ${stamp}`);
  await page.getByRole("button", { name: `Narx mijoz ${stamp} — kelishilgan narxlar` }).click();
  const form = page.getByTestId("customer-price-form");
  await expect(form).toBeVisible({ timeout: 15_000 });

  const addPrice = async (value: string, expected: RegExp) => {
    await form.getByLabel("Mahsulot", { exact: true }).fill(`KN-${stamp}`);
    const select = form.getByLabel("Mahsulotni tanlash");
    const option = select.locator("option", { hasText: `Kelishuv ${stamp}` });
    await expect(option).toHaveCount(1, { timeout: 15_000 });
    await select.selectOption({ label: await option.innerText() });
    await form.getByLabel("Narx").fill(value);
    await page.getByTestId("customer-price-save").click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: expected }).last()).toBeVisible({ timeout: 15_000 });
  };

  await addPrice("7500", /Kelishilgan narx saqlandi/);
  await expect(page.getByTestId("customer-price-list")).toContainText(/7\D?500/);
  expect((await pricesOf(true)).map((row) => row.price)).toEqual(["7500.0000"]);

  // O'sha kunga ikkinchi narx — ustma-ust tushadi, server rad etadi va sabab ko'rinadi
  await addPrice("7200", /avval uni bekor qiling/);
  expect((await pricesOf(true)).map((row) => row.price), "eski narx o'zgarmadi").toEqual(["7500.0000"]);

  await page.getByRole("button", { name: `Kelishuv ${stamp} narxini yopish` }).click();
  await expect(page.getByText(`Kelishuv ${stamp}: narx yopildi`).first()).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await pricesOf(true)).filter((row) => row.isActive).length).toBe(0);

  await addPrice("7200", /Kelishilgan narx saqlandi/);
  expect((await pricesOf(true)).map((row) => row.price), "faqat yangi narx faol").toEqual(["7200.0000"]);
  expect((await pricesOf(false)).length, "eskisi tarixda qoldi").toBe(2);
  await page.screenshot({ path: "e2e/.screenshots/customer-prices.png" });
});
