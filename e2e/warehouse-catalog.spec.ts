/**
 * Ombor → Katalog: mahsulot, xom ashyo va yarim tayyor bitta ro'yxatda, tur bo'yicha filtr,
 * shu yerdan qo'shish. Va admin panelidagi "Chiqish" tugmasi.
 */
import { execFileSync } from "node:child_process";
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

test("omborda katalog: tur bo'yicha filtr va xom ashyo qo'shish", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, ACCOUNTS.owner.phone);
  await page.goto(appPath("warehouse"), { waitUntil: "domcontentloaded" });

  await page.getByRole("tab", { name: "Katalog" }).click();
  await expect(page.getByTestId("catalog-kinds")).toBeVisible({ timeout: 30_000 });

  // Mavjud mahsulotlar sukut bo'yicha "Mahsulot" turida
  const list = page.getByTestId("catalog-list");
  await expect(list).toBeVisible({ timeout: 20_000 });
  await expect(list).toContainText("Nestle suv 0.5L");

  // ── Xom ashyo qo'shamiz ────────────────────────────────────────────────
  const stamp = Date.now().toString().slice(-6);
  const name = `Sinov xom ashyo ${stamp}`;
  await page.getByTestId("catalog-add").click();
  const dialog = page.getByTestId("catalog-dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Turi").click();
  await page.getByRole("option", { name: "Xom ashyo" }).click();
  await dialog.getByLabel("Nomi").fill(name);
  await dialog.getByLabel("O'lchov birligi").click();
  await page.getByRole("option").first().click();
  await page.getByTestId("catalog-save").click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  // ── "Xom ashyo" filtri: yangi yozuv bor, mahsulot yo'q ─────────────────
  await page.getByTestId("catalog-kinds").getByRole("button", { name: "Xom ashyo" }).click();
  await expect(list).toContainText(name, { timeout: 20_000 });
  await expect(list).not.toContainText("Nestle suv 0.5L");

  // ── "Mahsulot" filtri: aksincha ────────────────────────────────────────
  await page.getByTestId("catalog-kinds").getByRole("button", { name: "Mahsulot", exact: true }).click();
  await expect(list).toContainText("Nestle suv 0.5L", { timeout: 20_000 });
  await expect(list).not.toContainText(name);

  await page.screenshot({ path: "e2e/.screenshots/warehouse-catalog.png" });
});

/** Lokal, vaqtinchalik platforma admini — admin paneli ochilishi uchun (test oxirida qaytariladi). */
function platformAdmin(action: "grant" | "revoke") {
  execFileSync("pnpm", ["--filter", "@bum/api", "test:platform-admin", action, ACCOUNTS.direktor.phone], {
    stdio: ["ignore", "ignore", "inherit"],
    shell: process.platform === "win32",
  });
}

test("admin panelida 'Chiqish' tugmasi bor va ishlaydi", async ({ page }) => {
  test.setTimeout(120_000);
  platformAdmin("grant");
  try {
    await runAdminLogout(page);
  } finally {
    platformAdmin("revoke");
  }
});

async function runAdminLogout(page: Page) {
  await signIn(page, ACCOUNTS.direktor.phone);
  await page.goto(appPath("admin"), { waitUntil: "domcontentloaded" });

  const logout = page.getByTestId("admin-logout");
  await expect(logout, "chiqish tugmasi yozuvi bilan ko'rinadi").toBeVisible({ timeout: 30_000 });
  await expect(logout).toContainText("Chiqish");

  await page.screenshot({ path: "e2e/.screenshots/admin-logout.png" });
  await logout.click();
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
}
