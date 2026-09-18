/**
 * Sotuv agenti va yetkazuvchi ish joylari TELEFON o'lchamlarida (390x844 va 412x915).
 *
 * Tekshiriladi: sahifa yon tomonga surilmaydi, pastki 5 bo'limli navigatsiya ko'rinadi va
 * bosiladigan o'lchamda, sarlavha va asosiy tugmalar kesilmaydi.
 */
import { expect, test, type Page } from "@playwright/test";
import { appPath, login } from "./_lib/accounts.ts";

const PHONES = [
  { name: "390x844 (iPhone 14)", viewport: { width: 390, height: 844 } },
  { name: "412x915 (Pixel 7)", viewport: { width: 412, height: 915 } },
];

/** Gorizontal scroll bo'lmasligi — telefonda eng ko'p uchraydigan nuqson. */
async function expectNoHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth, `${label}: yon tomonga suriladi`).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

for (const phone of PHONES) {
  test.describe(`Telefon ${phone.name}`, () => {
    test.use({ viewport: phone.viewport });

    test("sotuv agenti ish joyi: navigatsiya va sahifalar telefonga sig'adi", async ({ page }) => {
      await login(page, "agent");
      for (const path of ["sales-agent/dashboard", "sales-agent/customers", "sales-agent/promotions", "sales-agent/reports"]) {
        await page.goto(appPath(path));
        const nav = page.locator("nav").last();
        await expect(nav).toBeVisible({ timeout: 30_000 });
        await expectNoHorizontalScroll(page, path);
        const links = nav.locator("a");
        await expect(links).toHaveCount(5);
        // Bosish uchun qulay balandlik (Apple/Google tavsiyasi ~44px)
        const box = await links.first().boundingBox();
        expect(box?.height ?? 0, `${path}: navigatsiya tugmasi past`).toBeGreaterThanOrEqual(40);
      }
      await page.screenshot({ path: `e2e/.artifacts/distribution/agent-${phone.viewport.width}.png`, fullPage: false });
    });

    test("yetkazuvchi ish joyi: navigatsiya va sahifalar telefonga sig'adi", async ({ page }) => {
      await login(page, "dostavchi");
      for (const path of ["delivery-agent/dashboard", "delivery-agent/tasks", "delivery-agent/customers", "delivery-agent/reports"]) {
        await page.goto(appPath(path));
        const nav = page.locator("nav").last();
        await expect(nav).toBeVisible({ timeout: 30_000 });
        await expectNoHorizontalScroll(page, path);
        await expect(nav.locator("a")).toHaveCount(5);
      }
      await page.screenshot({ path: `e2e/.artifacts/distribution/courier-${phone.viewport.width}.png`, fullPage: false });
    });
  });
}
