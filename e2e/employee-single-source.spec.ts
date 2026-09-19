/**
 * XODIM YARATISH — YAGONA JOY: Kadrlar → "Xodim qo'shish".
 *
 * Boshqa bo'limlarda yangi xodim ochilmaydi: Sozlamalar → Foydalanuvchilar va Obuna sahifasi
 * MAVJUD xodimga login beradi, Dostavka va Distribyutsiya esa Kadrlar bo'limiga yo'naltiradi.
 */
import { expect, test } from "@playwright/test";
import { appPath, login } from "./_lib/accounts.ts";

test("Kadrlar bo'limida xodim qo'shish bor", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("hr"));
  const add = page.getByRole("button", { name: /Xodim qo'shish/ }).first();
  await expect(add, "Kadrlarda — xodim yaratish").toBeVisible({ timeout: 30_000 });

  await add.click();
  await expect(page.getByTestId("new-employee-dialog"), "xodim yaratish oynasi").toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("Ism-familiya", { exact: false })).toBeVisible();
});

test("Foydalanuvchilar sahifasida xodim yaratilmaydi — mavjud xodimga login beriladi", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("settings"));
  await page.getByRole("tab", { name: "Foydalanuvchilar" }).click();

  await expect(page.getByRole("button", { name: /Xodim qo'shish/ }), "xodim yaratish tugmasi yo'q").toHaveCount(0);
  const add = page.getByRole("button", { name: /Foydalanuvchi qo'shish/ }).first();
  await expect(add).toBeVisible({ timeout: 30_000 });

  await add.click();
  const dialog = page.getByTestId("add-user-dialog");
  await expect(dialog, "mavjud xodimga login berish oynasi").toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText(/Kadrlar → Xodim qo'shish/)).toBeVisible();
  // Xodim TANLANADI (yaratilmaydi)
  await expect(dialog.locator("#add-user-employee")).toBeVisible();
  await expect(page.getByTestId("new-employee-dialog"), "xodim yaratish oynasi ochilmaydi").toHaveCount(0);
});

test("Foydalanuvchilar ro'yxatida xodim bog'lanishi ko'rinadi", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("settings"));
  await page.getByRole("tab", { name: "Foydalanuvchilar" }).click();
  await expect(page.getByText(/Xodim: |Xodim biriktirilmagan/).first(), "har bir foydalanuvchida xodim holati").toBeVisible({
    timeout: 30_000,
  });
});

test("Dostavka va Distribyutsiya bo'limlari Kadrlarga yo'naltiradi", async ({ page }) => {
  await login(page, "owner");

  await page.goto(appPath("delivery"));
  await page.getByRole("tab", { name: /Yetkazuvchilar|Agentlar/ }).first().click();
  const deliveryLink = page.getByTestId("agents-add-via-hr");
  await expect(deliveryLink).toBeVisible({ timeout: 30_000 });
  await expect(deliveryLink).toHaveAttribute("href", /\/hr$/);

  await page.goto(appPath("distribution"));
  await page.getByRole("tab", { name: "Savdo agentlari" }).first().click();
  const repsLink = page.getByTestId("reps-add-via-hr");
  await expect(repsLink).toBeVisible({ timeout: 30_000 });
  await expect(repsLink).toHaveAttribute("href", /\/hr$/);
});
