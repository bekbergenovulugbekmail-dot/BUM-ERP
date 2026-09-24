/**
 * Miqdor birligi (dona ↔ blok) va narxning ikkala birlikda ko'rinishi — HAQIQIY brauzerda.
 *
 * Egasining talabi (2026-09-24): "dona yozilsa donada, blok yozilsa blokda kirsin", narx esa
 * ikkalasida ham tursin. Xaridda bu bir marta noto'g'ri chiqqan (blok dona narxida ketgan),
 * shuning uchun raqamlar shu yerda qulflanadi.
 *
 * Talab: `EZO-460` mahsuloti (1 dona = 8 300 xarid / 12 000 sotuv, 1 blok = 12 dona).
 */
import { expect, test, type Page } from "@playwright/test";
import { appPath, login } from "./_lib/accounts.ts";

const SKU = "EZO-460";

/** Radix Select: triggerni bosib, ro'yxatdan bandni tanlaydi. */
async function pick(page: Page, trigger: ReturnType<Page["locator"]>, option: string | RegExp) {
  await trigger.click();
  await page.getByRole("option", { name: option }).click();
}

test.beforeEach(async ({ page }) => {
  await login(page, "owner");
});

test("Xarid: blokka o'tilganda narx dona narxidan hisoblanadi", async ({ page }) => {
  await page.goto(appPath("/purchase"));
  await page.getByRole("button", { name: /Xarid buyurtmasi/ }).click();

  // Oyna ichidagi jadval (orqadagi ro'yxat jadvali bilan adashmasin)
  const row = page.getByRole("dialog").locator("tbody tr").first();
  await pick(page, row.getByRole("combobox").first(), new RegExp(SKU));

  const qty = row.getByRole("spinbutton").first();
  await expect(qty).toHaveValue("1");

  // Qator DONA da ochiladi (blok avtomatik qo'yilmaydi) va narx dona narxi
  const unit = row.getByRole("combobox").nth(1);
  await expect(unit).toContainText("Dona");
  const price = row.getByRole("spinbutton").nth(1);
  await expect(price).toHaveValue("8300");

  // Narx ikkala birlikda: ikkinchi maydon — 1 blok narxi
  const otherPrice = page.getByTestId("other-unit-price-0");
  await expect(otherPrice).toHaveValue("99600");

  // Blokka o'tiladi — endi asosiy maydon blok narxini ko'rsatadi
  await pick(page, unit, "Blok");
  await expect(price).toHaveValue("99600");
  await expect(page.getByTestId("other-unit-price-0")).toHaveValue("8300");
  await expect(row).toContainText("= 12 dona");
});

test("Sotuv: birlik tanlovi, ikkala narx va keng ekran", async ({ page }) => {
  await page.goto(appPath("/sales"));
  await page.getByRole("button", { name: /Sotuv buyurtmasi/ }).click();

  // Keng ekran — egasi so'ragan imkoniyat
  const fullscreen = page.getByTestId("order-fullscreen");
  await expect(fullscreen).toHaveAttribute("title", "Butun ekranga yoyish");
  await fullscreen.click();
  await expect(page.getByTestId("order-fullscreen")).toHaveAttribute("title", "Kichraytirish");

  const row = page.getByRole("dialog").locator("tbody tr").first();
  await pick(page, row.getByRole("combobox").first(), new RegExp(SKU));

  // Sotuv narxi ham asosiy birlikda: 12 000/dona
  const price = row.getByRole("spinbutton").nth(1);
  await expect(price).toHaveValue("12000");
  await expect(page.getByTestId("sale-other-unit-price-0")).toHaveValue("144000");

  // Blokka o'tilganda miqdor blokda, narx blok narxida
  await pick(page, row.getByRole("combobox").nth(1), "Blok");
  await expect(price).toHaveValue("144000");
  await expect(row).toContainText("= 12 dona");
});
