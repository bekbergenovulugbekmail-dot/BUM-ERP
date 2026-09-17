/**
 * CSV import: shablon yuklab olish va ustunlarni qo'lda moslash.
 *
 * Fayl sarlavhalari mahsulot nomlariga mos kelmaydigan qilib beriladi — avtomat moslash ishlamaydi,
 * foydalanuvchi ustunlarni o'zi tanlaydi. Import haqiqatan bajariladi (yangi mijoz qo'shiladi);
 * mavjud ma'lumot o'chirilmaydi va o'zgartirilmaydi.
 */
import { expect, test, type Page } from "@playwright/test";
import { ACCOUNTS, PASSWORD, appPath } from "./_lib/accounts.ts";

async function signIn(page: Page, phone: string) {
  await page.context().clearCookies();
  await page.goto("about:blank");
  await page.goto("/login");
  await expect(page.locator("#phone")).toBeVisible({ timeout: 30_000 });
  await page.locator("#phone").fill(phone);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: /kirish/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
}

async function openCustomers(page: Page) {
  await signIn(page, ACCOUNTS.owner.phone);
  await page.goto(appPath("sales"), { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Mijozlar" }).first().click();
  await expect(page.getByTestId("csv-import")).toBeVisible({ timeout: 30_000 });
}

test("shablon yuklab olinadi va kutilayotgan sarlavhalarni o'z ichiga oladi", async ({ page }) => {
  test.setTimeout(120_000);
  await openCustomers(page);

  const download = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("csv-template").click(),
  ]).then(([event]) => event);

  expect(download.suggestedFilename()).toBe("mijozlar-shablon.csv");
  const path = await download.path();
  const text = await (await import("node:fs/promises")).readFile(path, "utf8");
  // Excel uchun BOM va o'zbekcha sarlavhalar
  expect(text.charCodeAt(0)).toBe(0xfeff);
  expect(text).toContain("Nomi");
  expect(text).toContain("Telefon");
  expect(text).toContain("STIR");
});

test("fayl sarlavhalari boshqacha bo'lsa — ustunlar qo'lda moslanadi va import o'tadi", async ({ page }) => {
  test.setTimeout(180_000);
  await openCustomers(page);

  // Sarlavhalar ataylab "notanish" — avtomat moslash ularni topa olmaydi
  const stamp = Date.now().toString().slice(-6);
  const csv = [
    "Klient nomi;Aloqa raqami;Izoh",
    `Import Test ${stamp};+99893${stamp}1;qo'lda moslash`,
  ].join("\n");

  await page.getByTestId("csv-import").click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "mijozlar.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8"),
  });

  const dialog = page.getByTestId("csv-mapping");
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(dialog).toContainText("1 ta qator");

  // Avtomat moslash hech narsani topmagan — "Tekshirish" o'chirilgan
  await expect(page.getByTestId("csv-mapping-continue")).toBeDisabled();

  // Qo'lda moslaymiz
  await dialog.getByLabel("Nomi", { exact: true }).click();
  await page.getByRole("option", { name: "Klient nomi" }).click();
  await dialog.getByLabel("Telefon", { exact: true }).click();
  await page.getByRole("option", { name: "Aloqa raqami" }).click();

  await page.screenshot({ path: "e2e/.screenshots/csv-mapping.png" });
  await expect(page.getByTestId("csv-mapping-continue")).toBeEnabled();
  await page.getByTestId("csv-mapping-continue").click();

  // Tekshiruv oynasi: bazaga hali yozilmagan
  const preview = page.getByRole("dialog").filter({ hasText: "Importni tekshirish" });
  await expect(preview).toBeVisible({ timeout: 30_000 });
  await expect(preview).toContainText("Bu bosqichda bazaga hech narsa yozilmagan");
  // Orqaga qaytib moslashni o'zgartirish mumkin
  await expect(page.getByTestId("csv-remap")).toBeVisible();

  await preview.getByRole("button", { name: /Importni boshlash/ }).click();
  await expect(preview).toBeHidden({ timeout: 30_000 });

  // Mijoz haqiqatan qo'shildi
  await page.getByPlaceholder(/qidir/i).first().fill(`Import Test ${stamp}`);
  await expect(page.getByText(`Import Test ${stamp}`).first()).toBeVisible({ timeout: 20_000 });
});
