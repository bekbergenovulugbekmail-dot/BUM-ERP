/**
 * Mahsulot qo'shish oynasi: shtrix-kod skaneri, kategoriya va brendni shu yerdan qo'shish,
 * o'lchov konversiyalarini shu yerda kiritish.
 */
import { expect, test } from "@playwright/test";
import { appPath, login } from "./_lib/accounts.ts";

const stamp = () => Date.now().toString().slice(-6);

test("mahsulot oynasi: skaner tugmasi, kategoriya/brend qo'shish va konversiya", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "owner");
  await page.goto(appPath("products"), { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: /Mahsulot qo'shish/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 20_000 });

  // ── Shtrix-kod yonida skaner tugmasi bor va oynani ochadi ───────────────
  const scanButton = dialog.getByTestId("product-barcode-scan");
  await expect(scanButton).toBeVisible();
  await scanButton.click();
  // Skaner oynasida qo'lda kiritish rejimi ham bor (kamera yo'q mashinada ham ishlaydi)
  await page.getByRole("button", { name: /Qo'lda \/ HID skaner/ }).click();
  const manual = page.getByPlaceholder("0000000000000");
  await expect(manual).toBeVisible({ timeout: 15_000 });
  await manual.fill("4780000001234");
  await page.getByRole("button", { name: "Yuborish" }).click();
  await expect(dialog.getByTestId("product-barcode")).toHaveValue("4780000001234", { timeout: 15_000 });

  // ── Kategoriya va brend shu oynadan qo'shiladi ──────────────────────────
  const suffix = stamp();
  await dialog.getByTestId("product-add-category").click();
  const categoryInput = dialog.getByTestId("product-new-category");
  // Yozganni o'chirib bo'lishi kerak (Android klaviaturasida ishlamay qolgan edi)
  await categoryInput.fill("Xato matn");
  await categoryInput.press("Backspace");
  await expect(categoryInput).toHaveValue("Xato mat");
  await categoryInput.fill(`Sinov kategoriya ${suffix}`);
  await dialog.getByRole("button", { name: "Qo'shish", exact: true }).first().click();
  await expect(dialog.getByTestId("product-add-category")).toBeVisible({ timeout: 20_000 });

  await dialog.getByTestId("product-add-brand").click();
  await dialog.getByTestId("product-new-brand").fill(`Sinov brend ${suffix}`);
  await dialog.getByRole("button", { name: "Qo'shish", exact: true }).first().click();
  await expect(dialog.getByTestId("product-add-brand")).toBeVisible({ timeout: 20_000 });

  // ── O'lchov: asosiy birlik va konversiya shu yerda ──────────────────────
  await dialog.getByRole("tab", { name: "O'lchov" }).click();
  await dialog.getByRole("combobox").first().click();
  await page.getByRole("option", { name: /Dona/ }).first().click();
  await dialog.getByTestId("conversion-add").click();
  const row = dialog.getByTestId("conversion-row").first();
  await expect(row).toBeVisible();
  await row.getByRole("combobox").click();
  await page.getByRole("option", { name: /Quti/ }).first().click();
  await row.getByPlaceholder("12").fill("12");

  // Yana bitta konversiya qo'shsa bo'ladi
  await dialog.getByTestId("conversion-add").click();
  await expect(dialog.getByTestId("conversion-row")).toHaveCount(2);

  // ── Saqlash ─────────────────────────────────────────────────────────────
  await dialog.getByRole("tab", { name: "Asosiy" }).click();
  await dialog.getByLabel(/Mahsulot nomi/).fill(`Sinov mahsulot ${suffix}`);
  await dialog.getByRole("tab", { name: "Narxlar" }).click();
  await dialog.getByLabel(/Sotuv narxi/).first().fill("15000");
  await dialog.getByRole("button", { name: "Saqlash" }).click();

  await expect(page.getByText("Mahsulot qo'shildi")).toBeVisible({ timeout: 30_000 });
});
