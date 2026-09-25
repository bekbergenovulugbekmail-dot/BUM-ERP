/**
 * Biznes manzilidagi kirish: app.bum-erp.uz/<biznes> — aynan shu biznesning kirish sahifasi.
 */
import { expect, test } from "@playwright/test";
import { ACCOUNTS, PASSWORD, SLUG } from "./_lib/accounts.ts";

test("biznes manzili sessiyasiz ochilsa — shu biznes nomi bilan kirish sahifasi", async ({ page, context }) => {
  await context.clearCookies();
  // Har test yangi brauzer ochadi — qurilma identifikatori bo'lmasa kirish "yangi qurilma" deb to'siladi
  await context.addInitScript((value) => {
    try {
      localStorage.setItem("bum:device-id", value);
    } catch {
      // xususiy rejim
    }
  }, "e2eownerdevice0001");
  await page.goto(`/${SLUG}`);

  // Biznes nomi sarlavhada
  await expect(page.getByRole("heading", { name: /BUM Demo/i })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`Xodimlar uchun kirish · ${SLUG}`)).toBeVisible();

  // Kirish shu biznesga
  await page.locator("#phone").fill(ACCOUNTS.owner.phone);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: /Kirish/ }).click();
  await expect(page).toHaveURL(new RegExp(`/${SLUG}/dashboard`), { timeout: 30_000 });
});

test("noto'g'ri biznes manzili — tushunarli xabar", async ({ page, context }) => {
  await context.clearCookies();
  await page.goto("/yoq-biznes-12345");
  await expect(page.getByText(/Bunday biznes manzili yo'q/)).toBeVisible({ timeout: 30_000 });
});

test("manzilsiz kirilganda biznes manzili so'raladi", async ({ page, context }) => {
  await context.clearCookies();
  await page.goto("/");
  await expect(page.getByText("Biznes manzili")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByPlaceholder("bum")).toBeVisible();
});
