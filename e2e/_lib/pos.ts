/** Kassa testlari uchun umumiy qadamlar (barqaror selektorlar: aria-label va data-testid). */
import { expect, type Page } from "@playwright/test";
import { appPath, login, type AccountKey } from "./accounts.ts";

export async function openPos(page: Page, who: AccountKey = "kassir") {
  await login(page, who);
  await page.goto(appPath("pos"));
  await expect(page.getByRole("button", { name: /Smena (ochish|yopish)/ }).first()).toBeVisible({ timeout: 30_000 });
}

/** Smena ochilmagan bo'lsa ochadi va kassa ish maydonini kutadi. */
export async function ensureShift(page: Page, openingCash = "0") {
  const openButton = page.getByRole("button", { name: "Smena ochish" }).first();
  if (await openButton.isVisible().catch(() => false)) {
    await openButton.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("opening-cash").fill(openingCash);
    await dialog.getByTestId("open-session-confirm").click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
  }
  await expect(page.getByPlaceholder(/Mahsulot nomi, SKU yoki barkod/)).toBeVisible({ timeout: 20_000 });
}

/** Mahsulotni qidiradi va kartochkani `times` marta bosadi (har bosish +1). */
export async function addToCart(page: Page, name: string, times: number) {
  await page.getByPlaceholder(/Mahsulot nomi, SKU yoki barkod/).fill(name);
  const card = page.getByRole("button", { name: new RegExp(`${name} — savatga qo'shish`) });
  await expect(card).toBeVisible({ timeout: 15_000 });
  const qty = async () => Number((await card.getAttribute("data-in-cart")) ?? "0");
  const target = (await qty()) + times;
  for (let i = 0; i < times; i += 1) await card.click();
  // Tez ketma-ket bosishda bitta-yarimta bosish yo'qolishi mumkin — yetishmaganini qo'shamiz
  for (let i = 0; i < 15 && (await qty()) < target; i += 1) await card.click();
  await expect(card).toHaveAttribute("data-in-cart", String(target), { timeout: 15_000 });
}

/** To'lov usuli → summa oynasi → "Saqlash" (qism qo'shiladi). */
export async function savePart(page: Page, method: RegExp, amount: string) {
  await page.locator(`[aria-label="To'lov usuli"] button`).filter({ hasText: method }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/summasi$/).fill(amount);
  await dialog.getByRole("button", { name: /^saqlash$/i }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
}

/**
 * Telefonda savat panelini ochadi va animatsiya TUGAGUNCHA kutadi.
 * Panel pastdan 200ms da ko'tariladi — kutilmasa o'lchovlar ekran tashqarisini ko'rsatadi.
 */
export async function openCart(page: Page) {
  await page.getByTestId("cart-bar").click();
  const panel = page.getByTestId("pos-cart-panel");
  await expect(panel).toBeVisible();
  await expect
    .poll(async () => Math.round((await panel.boundingBox())?.y ?? -1), { timeout: 10_000 })
    .toBe(0);
  return panel;
}

/** Chek oynasini yopadi (u keyingi bosishlarni to'sadi). */
export async function closeReceipt(page: Page) {
  const button = page.getByRole("button", { name: "Yangi" });
  await expect(button).toBeVisible({ timeout: 20_000 });
  await button.click();
  await expect(page.getByText("Savatcha bo'sh")).toBeVisible({ timeout: 20_000 });
}

/** Savatni tozalaydi (test orasida holat qolmasin). */
export async function clearCart(page: Page) {
  const reset = page.getByRole("button", { name: "Tozalash" });
  if (await reset.isVisible().catch(() => false)) await reset.click();
}
