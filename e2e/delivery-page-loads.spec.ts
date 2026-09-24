/**
 * Dostavka bo'limi OCHILISHI kerak.
 *
 * Regressiya (2026-09-24, production): egasi "Dostavka" ga kirganda butun sahifa oq bo'lib qoldi —
 * yon menyu ham yo'qoldi. Bu React'da ushlanmagan xato belgisi: ilovada xato chegarasi
 * (ErrorBoundary) yo'q, shuning uchun bitta bo'limdagi xato BUTUN ilovani o'chiradi.
 */
import { expect, test } from "@playwright/test";
import { appPath, login } from "./_lib/accounts.ts";

test("Dostavka sahifasi oq ekran bermaydi", async ({ page }) => {
  // Faqat USHLANMAGAN xato muhim: oq ekran aynan shundan bo'ladi. Tarmoqdagi 401
  // (kirishdan oldingi so'rovlar) va konsol ogohlantirishlari — xato emas.
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(`${error.name}: ${error.message}`));

  await login(page, "owner");
  await page.goto(appPath("/delivery"));

  // Sarlavha ko'rinadi — ya'ni daraxt yiqilmagan
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
  // Yon menyu joyida (oq ekranda u ham yo'qoladi)
  await expect(page.getByRole("navigation").first()).toBeVisible();

  // Xato chegarasi ishlaganda ham bu matn chiqmasligi kerak — sahifa haqiqatan ochilsin
  await expect(page.getByText("Bu bo'limni ochib bo'lmadi")).toHaveCount(0);
  expect(crashes, `Ushlanmagan xatolar:\n${crashes.join("\n")}`).toEqual([]);
});
