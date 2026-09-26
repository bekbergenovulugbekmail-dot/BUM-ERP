/**
 * Android/telefon o'lchamlarida POS: mahsulot maydoni to'liq kenglikda, savat pastki panelda,
 * gorizontal scroll yo'q, muhim tugmalar ekran ichida. Skrinshotlar `e2e/.screenshots/` ga saqlanadi.
 */
import { expect, test, type Page } from "@playwright/test";
import { appPath, login } from "./_lib/accounts.ts";
import { ensureShift, openCart } from "./_lib/pos.ts";

const PHONES = [
  { name: "360", width: 360, height: 800 },
  { name: "375", width: 375, height: 812 },
  { name: "390", width: 390, height: 844 },
  { name: "412", width: 412, height: 915 },
  { name: "430", width: 430, height: 932 },
];

/** Sahifada gorizontal scroll bo'lmasligi kerak. */
async function noHorizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}

async function openPos(page: Page) {
  await login(page, "kassir");
  await page.goto(appPath("pos"));
  // Smena yopiq bo'lsa (oldingi kassa testi yopgan bo'lishi mumkin) — o'zi ochadi; test tashqi holatga bog'liq bo'lmasin
  const search = page.getByPlaceholder(/Mahsulot nomi, SKU yoki barkod/);
  await expect(async () => {
    if (await search.isVisible()) return;
    if (await page.getByRole("button", { name: "Smena ochish" }).first().isVisible()) await ensureShift(page);
    await expect(search).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 45_000 });
  return search;
}

for (const phone of PHONES) {
  test(`POS ${phone.width}px: mahsulot maydoni to'liq, savat pastki panelda, gorizontal scroll yo'q`, async ({ page }) => {
    await page.setViewportSize({ width: phone.width, height: phone.height });
    await openPos(page);

    // Savat paneli telefonda yopiq — mahsulotlar butun kenglikni egallaydi
    const cartBar = page.getByTestId("cart-bar");
    await expect(cartBar).toBeVisible();

    // Mahsulot kartochkasi ko'rinadi va bosiladi
    const card = page.getByRole("button", { name: /savatga qo'shish/ }).first();
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    expect(box, "kartochka ekran ichida").not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(phone.width + 1);

    expect(await noHorizontalOverflow(page), "gorizontal scroll bo'lmasin").toBe(true);

    await page.screenshot({ path: `e2e/.screenshots/pos-${phone.name}.png`, fullPage: false });
  });
}

test("telefonda savat ochiladi, to'lov tugmalari va yakunlash ko'rinadi", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const search = await openPos(page);

  // Mahsulot qo'shamiz
  await search.fill("Nestle suv 0.5L");
  const card = page.getByRole("button", { name: /Nestle suv 0\.5L — savatga qo'shish/ });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.click();

  // Pastki panelda miqdor va jami ko'rinadi
  const cartBar = page.getByTestId("cart-bar");
  await expect(cartBar).toContainText("Savat: 1 ta");
  await page.screenshot({ path: "e2e/.screenshots/pos-cart-bar.png" });

  // Savatni ochamiz — to'liq ekranli panel
  const panel = await openCart(page);
  await expect(page.getByTestId("cart-close")).toBeVisible();
  await expect(panel).toContainText("Nestle suv 0.5L");
  expect(await noHorizontalOverflow(page)).toBe(true);
  await page.screenshot({ path: "e2e/.screenshots/pos-cart-mobile.png" });

  // To'lov usullari va yakunlash tugmasi ekran ichida
  const cash = panel.locator(`[aria-label="To'lov usuli"] button`).filter({ hasText: /naqd/i }).first();
  await expect(cash).toBeVisible();
  const finalize = panel.getByRole("button", { name: /yakunlash/i }).first();
  await expect(finalize).toBeVisible();
  const box = await finalize.boundingBox();
  expect(box!.y + box!.height, "yakunlash tugmasi ekran ichida").toBeLessThanOrEqual(844 + 1);

  // To'lov summasi oynasi
  await cash.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: "e2e/.screenshots/pos-payment-mobile.png" });
  expect(await noHorizontalOverflow(page)).toBe(true);
});
