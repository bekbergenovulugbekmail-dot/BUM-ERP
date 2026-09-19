/**
 * "Tezda qo'shish" (import yonidagi kataklar) va xaridda mahsulot qidirish.
 *
 *  - Mahsulotlar sahifasi: "Tezda qo'shish" jadvaliga yozib saqlash — mahsulot ro'yxatda paydo bo'ladi;
 *  - Xarid hujjati: nomi bo'yicha qidirib bir nechta mahsulotni belgilab qo'shish.
 */
import { expect, test } from "@playwright/test";
import { appPath, login } from "./_lib/accounts.ts";

const stamp = Date.now().toString().slice(-6);

test("mahsulotlarda «Tezda qo'shish»: kataklarga yozib saqlansa ro'yxatga tushadi", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("products"));

  const quick = page.getByTestId("quick-add").first();
  await expect(quick, "import yonida «Tezda qo'shish» tugmasi").toBeVisible({ timeout: 30_000 });
  await quick.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Tezda qo'shish")).toBeVisible();

  // Birinchi qatorni to'ldiramiz: nomi va SKU majburiy
  const name = `Tezkor tovar ${stamp}`;
  const rows = dialog.locator("tbody tr");
  await expect(rows.first()).toBeVisible();
  const firstRow = rows.first();
  const inputs = firstRow.locator("input");
  await inputs.nth(0).fill(name);
  await inputs.nth(1).fill(`TEZ-${stamp}`);

  await dialog.getByRole("button", { name: "Saqlash" }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  // Ro'yxatda paydo bo'ldi
  await page.getByPlaceholder(/Nomi, SKU, barcode/i).first().fill(name);
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 30_000 });
});

test("xaridda mahsulotni nomi bo'yicha qidirib, belgilab qo'shish", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("purchase"));

  await page.getByRole("button", { name: "Xarid buyurtmasi" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });

  const search = dialog.getByPlaceholder(/Mahsulot nomi, SKU yoki barkod/);
  await expect(search, "qidiruv maydoni").toBeVisible();
  await search.fill("Nestle");

  // Ro'yxatdan belgilab qo'shamiz
  const option = dialog.locator("label").filter({ hasText: /Nestle/ }).first();
  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.locator("button[role='checkbox'], input[type='checkbox']").first().click();

  const addPicked = dialog.getByRole("button", { name: /Tanlanganlarni qo'shish/ });
  await expect(addPicked).toBeVisible();
  await addPicked.click();

  // Qator jadvalga tushdi
  await expect(dialog.getByRole("row").filter({ hasText: /Nestle/ }).first()).toBeVisible({ timeout: 15_000 });
});
