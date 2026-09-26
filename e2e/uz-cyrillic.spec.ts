/**
 * "Ўзбекча" (kirill) tili — HAQIQIY BRAUZERDA: interfeys kirillda, foydalanuvchi ma'lumoti (mahsulot nomi, SKU)
 * o'zgarmaydi, sahifalar xatosiz ochiladi, lotinga qaytish ishlaydi.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { appPath, login } from "./_lib/accounts.ts";

test.describe.configure({ timeout: 240_000 });
test.use({ viewport: { width: 1440, height: 900 } });

const ARTIFACTS = resolve(import.meta.dirname, ".artifacts/uz-cyrillic");
mkdirSync(ARTIFACTS, { recursive: true });

async function setLocale(page: Page, code: "oz" | "uz") {
  await page.evaluate((value) => localStorage.setItem("erp_locale", value), code);
}

test("kirill: menyu, ombor, sotuv, distributsiya — interfeys kirillda, ma'lumot o'zgarmaydi, xato yo'q", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page, "owner");
  await setLocale(page, "oz");

  await page.goto(appPath("/warehouse"));
  await expect(page.getByRole("heading", { name: "Омбор бошқаруви" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Экспорт", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Қабул қилиш" })).toBeVisible();
  // Ma'lumot (bazadagi mahsulot nomi) lotinda qoladi
  await expect(page.getByText("Coca Cola 1L").first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: resolve(ARTIFACTS, "warehouse.png") });

  // Menyu (tarjima fayllari) — kirill
  await expect(page.getByRole("link", { name: "Омбор" }).first()).toBeVisible();

  for (const [path, file] of [["/sales", "sales"], ["/distribution", "distribution"], ["/dashboard", "dashboard"]] as const) {
    await page.goto(appPath(path));
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 30_000 });
    const heading = await page.getByRole("heading", { level: 1 }).first().innerText();
    expect(heading, `${path}: sarlavha kirillda`).toMatch(/[А-Яа-яЎўҚқҒғҲҳ]/);
    await page.screenshot({ path: resolve(ARTIFACTS, `${file}.png`) });
  }
  expect(errors, "sahifa xatolari").toEqual([]);

  // Lotinga qaytish
  await setLocale(page, "uz");
  await page.goto(appPath("/warehouse"));
  await expect(page.getByRole("heading", { name: "Ombor boshqaruvi" })).toBeVisible({ timeout: 30_000 });
});

test("kirill: sotuv agenti ish joyi (mobil)", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await login(page, "agent");
  await setLocale(page, "oz");
  await page.goto(appPath("/sales-agent"));
  await expect(page.getByText("Бош саҳифа").first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: resolve(ARTIFACTS, "agent-dashboard.png") });
  await page.goto(appPath("/sales-agent/customers"));
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.screenshot({ path: resolve(ARTIFACTS, "agent-customers.png") });
});
