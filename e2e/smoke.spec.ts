/** Brauzer avtomatizatsiyasi ishlayotganini tasdiqlash: kirish va bosh sahifa. */
import { expect, test } from "@playwright/test";
import { ACCOUNTS, appPath, login, logout } from "./_lib/accounts.ts";

test("egasi tizimga kiradi va bosh sahifa ochiladi", async ({ page }) => {
  await login(page, "owner");
  // Kirish sahifasidan chiqdi va ilova yuklandi
  await expect(page.locator("body")).toBeVisible();
  expect(page.url()).not.toContain("/login");
});

test("noto'g'ri parol bilan kirib bo'lmaydi", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#phone").fill(ACCOUNTS.owner.phone);
  await page.locator("#password").fill("mutlaqo-notogri-parol");
  await page.getByRole("button", { name: /kirish/i }).click();
  await expect(page).toHaveURL(/\/login/);
});

test("chiqishdan keyin himoyalangan sahifa ochilmaydi", async ({ page }) => {
  await login(page, "owner");
  await logout(page);
  await page.goto(appPath("sales"));
  await expect(page).toHaveURL(/\/login/);
});
