/**
 * Distributsiya → Mijozlar: "Yangi mijoz" ning uchala yo'li haqiqiy brauzerda.
 *
 *  - uchta tanlov ko'rinadi (Tezda qo'shish / Import qilish / Excel shablon);
 *  - tezda qo'shish: majburiy maydonlar tekshiriladi, saqlangach mijoz ro'yxatda DARHOL chiqadi;
 *  - Excel shablon haqiqiy .xlsx bo'lib yuklanadi;
 *  - .xlsx import: avval PREVIEW (bazaga yozilmaydi), keyin "Importni boshlash" va yakuniy hisobot;
 *  - dublikat qator preview'da alohida ko'rinadi va yozilmaydi.
 *
 * Mavjud ma'lumot o'chirilmaydi — har ishga tushirishda nomlar `stamp` bilan yangi bo'ladi.
 */
import { expect, test, type Page } from "@playwright/test";
import { appPath, login } from "./_lib/accounts.ts";

const stamp = Date.now().toString().slice(-6);

async function openCustomers(page: Page) {
  await login(page, "owner");
  await page.goto(appPath("distribution"), { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Mijozlar" }).first().click();
  await expect(page.getByTestId("dist-new-customer")).toBeVisible({ timeout: 30_000 });
}

/** "Yangi mijoz" → uchta tanlovli oyna. */
async function openChooser(page: Page) {
  await page.getByTestId("dist-new-customer").click();
  const chooser = page.getByTestId("dist-customer-chooser");
  await expect(chooser).toBeVisible({ timeout: 30_000 });
  return chooser;
}

/** Sarlavha + qatorlardan .xlsx yasaydi (brauzerdan tashqarida, Node tomonida). */
async function xlsxBuffer(rows: string[][]): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Mijozlar");
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test("Yangi mijoz oynasida uchta yo'l ko'rinadi", async ({ page }) => {
  test.setTimeout(120_000);
  await openCustomers(page);
  const chooser = await openChooser(page);

  await expect(chooser.getByTestId("dist-choose-quick")).toBeVisible();
  await expect(chooser.getByTestId("dist-choose-import")).toBeVisible();
  await expect(chooser.getByTestId("dist-choose-template")).toBeVisible();
  await expect(chooser.getByText("Tezda qo'shish")).toBeVisible();
  await expect(chooser.getByText("Import qilish")).toBeVisible();
  await expect(chooser.getByText("Excel shablon")).toBeVisible();
});

test("tezda qo'shish: majburiy maydonlar tekshiriladi, mijoz ro'yxatda darhol chiqadi", async ({ page }) => {
  test.setTimeout(180_000);
  const name = `Tezkor do'kon ${stamp}`;

  await openCustomers(page);
  const chooser = await openChooser(page);
  await chooser.getByTestId("dist-choose-quick").click();

  const form = page.getByTestId("dist-quick-customer");
  await expect(form).toBeVisible({ timeout: 30_000 });

  // Bo'sh forma — saqlanmaydi
  await form.getByTestId("quick-save").click();
  await expect(page.getByText("Mijoz nomi majburiy")).toBeVisible({ timeout: 15_000 });

  // Faqat nom — telefon baribir majburiy
  await form.getByTestId("quick-name").fill(name);
  await form.getByTestId("quick-save").click();
  await expect(page.getByText("Telefon majburiy")).toBeVisible({ timeout: 15_000 });

  await form.getByTestId("quick-phone").fill(`+99893${stamp}1`);
  await form.getByTestId("quick-save").click();

  // Oyna yopiladi va yangi mijoz ro'yxatda ko'rinadi
  await expect(form).toBeHidden({ timeout: 30_000 });
  await expect(page.getByTestId("dist-customer-list").getByText(name)).toBeVisible({ timeout: 30_000 });
});

test("Excel shablon .xlsx bo'lib yuklab olinadi", async ({ page }) => {
  test.setTimeout(120_000);
  await openCustomers(page);
  const chooser = await openChooser(page);

  const download = await Promise.all([
    page.waitForEvent("download"),
    chooser.getByTestId("dist-choose-template").click(),
  ]).then(([event]) => event);

  expect(download.suggestedFilename()).toBe("mijozlar-shablon.xlsx");

  // Haqiqiy .xlsx: ZIP sarlavhasi "PK" bilan boshlanadi va sarlavhalar o'qiladi
  const path = await download.path();
  const fs = await import("node:fs/promises");
  const buffer = await fs.readFile(path);
  expect(buffer.subarray(0, 2).toString("utf8")).toBe("PK");

  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const header = workbook.worksheets[0]!.getRow(1).values as unknown[];
  const text = header.map((value) => String(value ?? "")).join("|");
  expect(text).toContain("Mijoz nomi*");
  expect(text).toContain("Telefon*");
  expect(text).toContain("Hudud");
  expect(text).toContain("Savdo agenti");
});

test(".xlsx import: preview ko'rsatiladi, tasdiqlangach yoziladi, dublikat o'tmaydi", async ({ page }) => {
  test.setTimeout(240_000);
  const first = `Excel do'kon A ${stamp}`;
  const second = `Excel do'kon B ${stamp}`;

  await openCustomers(page);
  const chooser = await openChooser(page);
  await chooser.getByTestId("dist-choose-import").click();

  // Uchinchi qator — ikkinchisining aynan takrori (bir xil telefon): dublikat bo'lib ajraladi
  const buffer = await xlsxBuffer([
    ["Mijoz nomi", "Telefon", "Hudud"],
    [first, `+99893${stamp}2`, "Urganch"],
    [second, `+99893${stamp}3`, "Urganch"],
    ["Takroriy do'kon", `+99893${stamp}3`, "Urganch"],
  ]);
  await page.locator('input[type="file"]').setInputFiles({
    name: "mijozlar.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });

  // 1-bosqich: ustunlarni moslash. Sarlavhalar shablondagidek, shuning uchun avtomat moslanadi —
  // foydalanuvchi faqat tasdiqlaydi
  const mapping = page.getByTestId("csv-mapping");
  await expect(mapping).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("csv-mapping-continue")).toBeEnabled();
  await page.getByTestId("csv-mapping-continue").click();

  // 2-bosqich: preview (server `dryRun` bilan tekshirdi, bazaga yozmadi)
  const preview = page.getByRole("dialog").filter({ hasText: "Importni boshlash" });
  await expect(preview).toBeVisible({ timeout: 60_000 });
  await expect(preview.getByText("Dublikatlar", { exact: false })).toBeVisible();

  // Preview bosqichida bazaga HECH NARSA yozilmagan
  await expect(page.getByTestId("dist-customer-list").getByText(first)).toBeHidden();

  await preview.getByRole("button", { name: /Importni boshlash/ }).click();

  // Yakuniy hisobot: jami / yaratildi / dublikat / xato
  const result = page.getByTestId("csv-result");
  await expect(result).toBeVisible({ timeout: 60_000 });
  await expect(result.getByTestId("csv-result-jami")).toHaveText("3");
  await expect(result.getByTestId("csv-result-yaratildi")).toHaveText("2");
  await expect(result.getByTestId("csv-result-dublikat")).toHaveText("1");
  await expect(result.getByTestId("csv-result-xato")).toHaveText("0");
  // Xatolar/dublikatlar bo'lgani uchun yuklab olish tugmasi bor
  await expect(result.getByTestId("csv-result-issues-download")).toBeVisible();
  await result.getByRole("button", { name: "Yopish" }).click();

  // Ikkala yangi mijoz ro'yxatda, takroriysi esa yozilmagan
  const list = page.getByTestId("dist-customer-list");
  await expect(list.getByText(first)).toBeVisible({ timeout: 30_000 });
  await expect(list.getByText(second)).toBeVisible();
  await expect(list.getByText("Takroriy do'kon")).toBeHidden();
});
