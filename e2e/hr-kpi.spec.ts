/**
 * KPI: lavozimga bosqichli qoida yoziladi, hisob-kitob ko'rinadi.
 * Faqat qoida yaratiladi — mavjud oyliklar va hujjatlarga tegilmaydi.
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

test("lavozimga bosqichli KPI qoidasi yoziladi va hisob-kitob ko'rinadi", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, ACCOUNTS.owner.phone);
  await page.goto(appPath("hr"), { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "KPI" }).click();
  await expect(page.getByTestId("kpi-add")).toBeVisible({ timeout: 30_000 });

  // ── Yangi qoida: yetkazma soni bo'yicha ikki bosqich ─────────────────────
  await page.getByTestId("kpi-add").click();
  const dialog = page.getByTestId("kpi-dialog");
  await expect(dialog).toBeVisible();

  // Lavozim tanlash (demo seeder yaratgan lavozimlardan birinchisi)
  await dialog.getByLabel("Lavozim", { exact: true }).click();
  await page.getByRole("option").first().click();

  // Ko'rsatkich: yetkazma soni (sukut bo'yicha shu)
  await expect(dialog.getByLabel("Ko'rsatkich")).toContainText("yetkazma soni");

  // 1-bosqich: 0 dan 100 gacha, 4 000 so'm
  await dialog.getByLabel("1-bosqich: dan").fill("0");
  await dialog.getByLabel("1-bosqich: gacha").fill("100");
  await dialog.getByLabel("1-bosqich: stavka").fill("4000");

  // 2-bosqich qo'shiladi va avtomat 100 dan boshlanadi
  await page.getByTestId("kpi-add-tier").click();
  await expect(dialog.getByLabel("2-bosqich: dan")).toHaveValue("100");
  await dialog.getByLabel("2-bosqich: stavka").fill("6000");

  await page.screenshot({ path: "e2e/.screenshots/kpi-dialog.png" });
  await page.getByTestId("kpi-save").click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  // ── Ro'yxatda bosqichlar ko'rinadi ──────────────────────────────────────
  const rules = page.getByTestId("kpi-rules");
  await expect(rules).toBeVisible({ timeout: 20_000 });
  await expect(rules).toContainText("yetkazma soni");
  await expect(rules).toContainText("0–100");
  await expect(rules).toContainText("100+");

  await page.screenshot({ path: "e2e/.screenshots/kpi-rules.png" });
});

test("bosqichlar noto'g'ri bo'lsa server rad etadi", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, ACCOUNTS.owner.phone);
  await page.goto(appPath("hr"), { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "KPI" }).click();
  await expect(page.getByTestId("kpi-add")).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("kpi-add").click();
  const dialog = page.getByTestId("kpi-dialog");
  await dialog.getByLabel("Lavozim", { exact: true }).click();
  await page.getByRole("option").first().click();
  // Ko'rsatkichni almashtiramiz — birinchi test yozgan qoida bilan to'qnashmasin
  await dialog.getByLabel("Ko'rsatkich").click();
  await page.getByRole("option", { name: /tashrif soni/ }).click();

  // 0 dan boshlanmaydi — server rad etishi kerak
  await dialog.getByLabel("1-bosqich: dan").fill("10");
  await dialog.getByLabel("1-bosqich: stavka").fill("5000");
  await page.getByTestId("kpi-save").click();

  await expect(dialog.getByRole("alert")).toContainText("0 dan boshlanishi", { timeout: 20_000 });
  await expect(dialog).toBeVisible();
});
