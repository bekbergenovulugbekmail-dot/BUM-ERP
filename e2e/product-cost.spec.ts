/**
 * TANNARX VA NARX TAKLIFLARI.
 *
 *  - Mahsulotlar → "Tannarx": tannarx, o'rtacha tannarx, oxirgi xarid va marja;
 *  - Xarid hujjatida "Narxlarni taklif qilish": narx O'ZI o'zgarmaydi, "Olish" bosilganda qo'yiladi;
 *  - Kassirda tannarx yo'q: na menyu, na ro'yxatdagi ustun, na API (403 — himoya serverda).
 */
import { expect, test } from "@playwright/test";
import { appPath, login } from "./_lib/accounts.ts";

test("Mahsulotlar bo'limida «Tannarx» sahifasi ochiladi", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("products"));

  const tab = page.getByTestId("products-tab-costs");
  await expect(tab, "Mahsulotlar ichida Tannarx bo'limi").toBeVisible({ timeout: 30_000 });
  await tab.click();

  const costs = page.getByTestId("product-costs");
  await expect(costs).toBeVisible({ timeout: 30_000 });
  for (const column of ["Joriy tannarx", "O'rtacha tannarx", "Oxirgi xarid narxi", "Marja"]) {
    await expect(costs.getByText(column, { exact: true }), `«${column}» ustuni`).toBeVisible();
  }
  // Kamida bitta mahsulot qatori (demo ma'lumotlari)
  await expect(costs.locator("tbody tr").first()).toBeVisible({ timeout: 30_000 });
});

test("tannarx tarixi qatordan ochiladi", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("products"));
  await page.getByTestId("products-tab-costs").click();

  const costs = page.getByTestId("product-costs");
  await expect(costs.locator("tbody tr").first()).toBeVisible({ timeout: 30_000 });
  await costs.locator("tbody tr").first().getByRole("button").first().click();

  await expect(
    costs.getByText(/Ta'minotchi|xarid qilinmagan/).first(),
    "tarix jadvali yoki «xarid qilinmagan» izohi",
  ).toBeVisible({ timeout: 30_000 });
});

test("xarid hujjatida narx taklifi faqat «Olish» bosilganda qo'llanadi", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("purchase"));

  await page.getByRole("button", { name: "Xarid buyurtmasi" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });

  // Mahsulotni qidirib qo'shamiz — narx qatori paydo bo'ladi
  await dialog.getByPlaceholder(/Mahsulot nomi, SKU yoki barkod/).fill("Nestle");
  const option = dialog.locator("label").filter({ hasText: /Nestle/ }).first();
  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.click();
  await dialog.getByRole("button", { name: /Tanlanganlarni qo'shish/ }).click();

  const row = dialog.locator("tbody tr").first();
  const priceInput = row.locator('input[type="number"]').nth(1);
  await priceInput.fill("1");
  await expect(priceInput).toHaveValue("1");

  // Taklif oynasi ochilgani bilan narx o'zgarmaydi
  await row.getByTestId("price-suggest-trigger").click();
  const popover = page.getByTestId("price-suggestions");
  await expect(popover).toBeVisible({ timeout: 15_000 });
  await expect(popover.getByText(/bilan tanlaysiz/)).toBeVisible();
  await expect(priceInput, "oyna ochilganda narx o'zgarmaydi").toHaveValue("1");

  // Kartochkadagi kirim narxi doim mavjud — shu qiymatni olamiz
  const pick = popover.getByTestId("suggestion-current-purchase").getByRole("button", { name: "Olish" });
  await expect(pick).toBeVisible({ timeout: 15_000 });
  await pick.click();

  await expect(popover).toBeHidden({ timeout: 15_000 });
  await expect(priceInput, "tanlangandan keyin narx qo'yiladi").not.toHaveValue("1");
});

test("kassir tannarxni ko'rmaydi: menyu ham, ustun ham, API ham", async ({ page }) => {
  await login(page, "kassir");
  await page.goto(appPath("products"));
  await expect(page.getByRole("heading", { name: /Mahsulot/ }).first()).toBeVisible({ timeout: 30_000 });

  await expect(page.getByTestId("products-tab-costs"), "Tannarx bo'limi yo'q").toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Xarid narxi" }), "jadvalda tannarx ustuni yo'q").toHaveCount(0);

  // Asosiy himoya — serverda: to'g'ridan-to'g'ri so'rov ham rad etiladi
  const costs = await page.request.get("/api/catalog/products/costs", { headers: { "x-bum-company": "bum-demo" } });
  expect(costs.status(), await costs.text()).toBe(403);

  const list = await page.request.get("/api/catalog/products?limit=5", { headers: { "x-bum-company": "bum-demo" } });
  expect(list.ok(), await list.text()).toBeTruthy();
  const products = (await list.json()).products as { purchasePrice?: string; salesPrice: string }[];
  expect(products.length, "mahsulotlar ko'rinadi").toBeGreaterThan(0);
  expect(products.every((row) => row.purchasePrice === undefined), "kirim narxi yuborilmaydi").toBe(true);
});
