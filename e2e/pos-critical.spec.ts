/**
 * §6 KRITIK TEST — real brauzerda kassa sotuvi va Sotuvlar ro'yxatidagi ko'rinish.
 *
 * 100 000 so'm: naqd 50 000 (Saqlash) + UZCARD 50 000 (Yakunlash).
 * Kutilgan: Sotuv = Yakunlangan, To'lov = To'langan, Yetkazma = "—".
 * "Yetkazildi" chiqsa — FAIL.
 */
import { expect, test, type Page } from "@playwright/test";
import { appPath, login, logout } from "./_lib/accounts.ts";

/** Smena ochilmagan bo'lsa ochadi (oynadagi Label input bilan bog'lanmagan — dialog ichidan topamiz). */
async function ensureShift(page: Page) {
  // Sahifa smena holatini ko'rsatishini kutamiz (aks holda tugma hali yo'q bo'ladi)
  await expect(page.getByRole("button", { name: /Smena (ochish|yopish)/ }).first()).toBeVisible({ timeout: 30_000 });
  const openButton = page.getByRole("button", { name: "Smena ochish" }).first();
  if (await openButton.isVisible().catch(() => false)) {
    await openButton.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("opening-cash").fill("0");
    await dialog.getByTestId("open-session-confirm").click();
    // Oyna yopilishi va smena ochilishini kutamiz
    await expect(dialog).toBeHidden({ timeout: 20_000 });
  }
  await expect(page.getByText("Smena ochilmagan")).toBeHidden({ timeout: 20_000 });
  await expect(page.getByPlaceholder(/Mahsulot nomi, SKU yoki barkod/)).toBeVisible({ timeout: 20_000 });
}

/**
 * Mahsulotni qidiradi va kartochkani `times` marta bosadi (har bosish miqdorni +1 qiladi —
 * real kassir xatti-harakati). Kartochkaning aria-label'i barqaror: "<nom> — savatga qo'shish".
 */
async function addToCart(page: Page, name: string, times: number) {
  await page.getByPlaceholder(/Mahsulot nomi, SKU yoki barkod/).fill(name);
  const card = page.getByRole("button", { name: new RegExp(`${name} — savatga qo'shish`) });
  await expect(card).toBeVisible({ timeout: 15_000 });
  for (let i = 0; i < times; i += 1) await card.click();
  await expect(page.getByText("Savatcha bo'sh")).toBeHidden();
}

/** To'lov usuli tugmasi → summa oynasi → Saqlash yoki Yakunlash. */
async function payPart(page: Page, methodTitle: RegExp, amount: string, finish: boolean) {
  await page.locator(`[aria-label="To'lov usuli"] button`).filter({ hasText: methodTitle }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Maydonda aria-label: "<usul> summasi" (masalan "Naqd summasi")
  const input = dialog.getByLabel(/summasi$/);
  await input.fill(amount);
  await dialog.getByRole("button", { name: finish ? /yakunlash/i : /^saqlash$/i }).click();
}

test("100 000 so'm: naqd 50 000 + UZCARD 50 000 — Yetkazma ustuni bo'sh qoladi", async ({ page }) => {
  await login(page, "kassir");
  await page.goto(appPath("pos"));
  await ensureShift(page);

  // Nestle suv 0.5L — 4 000 so'm × 25 = 100 000 so'm
  await addToCart(page, "Nestle suv 0.5L", 25);

  await payPart(page, /naqd/i, "50000", false);
  await payPart(page, /uzcard/i, "50000", true);

  // Chek yopildi — savat bo'shaydi
  await expect(page.getByText("Savatcha bo'sh")).toBeVisible({ timeout: 20_000 });

  // ── Kassa cheki qayerda ko'rinadi ───────────────────────────────────────
  // Sotuvlar sahifasi kassa cheklarini ko'rsatmaydi (`isPos: false` filtri) — chek
  // Dashboard'dagi "so'nggi sotuvlar" ro'yxatida chiqadi. Aynan shu yerda ilgari
  // "Yetkazildi" ko'rinardi, shuning uchun tekshiruv shu yuzada.
  await logout(page);
  await login(page, "owner");
  await page.goto(appPath("dashboard"));

  // Chek ro'yxatda turibdi
  await expect(page.getByText("Chakana (POS)").first()).toBeVisible({ timeout: 30_000 });
  // Holati "Yakunlandi" deb ko'rsatiladi
  await expect(page.locator("body")).toContainText("Yakunlandi");
  // ENG MUHIMI: kassa cheki uchun hech qayerda "Yetkazildi" yozilmaydi
  await expect(page.locator("body")).not.toContainText("Yetkazildi");
});
