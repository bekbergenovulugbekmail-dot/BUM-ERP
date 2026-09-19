/** Brauzer avtomatizatsiyasi ishlayotganini tasdiqlash: kirish va bosh sahifa. */
import { expect, test } from "@playwright/test";
import { ACCOUNTS, SLUG, appPath, login, logout } from "./_lib/accounts.ts";

test("egasi tizimga kiradi va bosh sahifa ochiladi", async ({ page }) => {
  await login(page, "owner");
  // Kirish sahifasidan chiqdi va ilova yuklandi
  await expect(page.locator("body")).toBeVisible();
  await expect(page.locator("#password"), "kirish formasi yopildi").toHaveCount(0);
});

test("noto'g'ri parol bilan kirib bo'lmaydi", async ({ page }) => {
  await page.goto(`/${SLUG}`);
  await page.locator("#phone").fill(ACCOUNTS.owner.phone);
  await page.locator("#password").fill("mutlaqo-notogri-parol");
  await page.getByRole("button", { name: /kirish/i }).click();
  await expect(page.getByRole("alert"), "xato xabari").toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#password"), "kirish formasi joyida qoladi").toBeVisible();
});

test("chiqishdan keyin himoyalangan sahifa ochilmaydi", async ({ page }) => {
  await login(page, "owner");
  await logout(page);
  await page.goto(appPath("sales"));
  // Biznes manzilida chiqilgan bo'lsa — o'sha biznesning kirish sahifasi ko'rinadi (sahifa mazmuni emas)
  await expect(page.locator("#phone")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Xodimlar uchun kirish/)).toBeVisible();
  await expect(page.getByRole("heading", { name: /Sotuv|Savdo/ })).toHaveCount(0);
});
