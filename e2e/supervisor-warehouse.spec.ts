/**
 * HAQIQIY BRAUZERDA (2026-09-26):
 *   1) Ombor: sarlavhada faqat Eksport, Ombordagi miqdori bilan eksport, Chiqarish, Qabul qilish; miqdorli Excel
 *      ochilganda A4 ga tayyor (A4 albom, bir sahifa kengligi, sarlavha har sahifada, chegaralar, uzun nom bo'linadi).
 *   2) Supervayzer (maydondagi): "Sotuv" — agent ish joyi, o'z savdo profili avtomatik, ERP'ga qaytish.
 *   3) Rahbar: Supervayzer paneli, "Agent nomidan" — banner, GPS/ish vaqti agent nomidan 403, "Tugatish".
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, SLUG, appPath, login } from "./_lib/accounts.ts";

test.describe.configure({ timeout: 300_000 });
test.use({ viewport: { width: 1500, height: 1000 } });

const ARTIFACTS = resolve(import.meta.dirname, ".artifacts/supervisor-warehouse");
mkdirSync(ARTIFACTS, { recursive: true });

async function api<T = unknown>(page: Page, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: T }> {
  return page.evaluate(
    async ({ method, path, body, headers }) => {
      const res = await fetch(path, {
        method,
        headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    },
    { method, path, body, headers },
  ) as Promise<{ status: number; json: T }>;
}

test("ombor: faqat 4 ta tugma; 'Ombordagi miqdori bilan eksport' Excel'i A4 ga tayyor", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("/warehouse"));
  const button = page.getByTestId("stock-export-quantities");
  await expect(button).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByTestId("stock-export")).toBeVisible();
  await expect(page.getByRole("button", { name: "Chiqarish" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Qabul qilish" })).toBeVisible();
  await expect(page.getByRole("button", { name: /A4 hisobot/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Excel import/ })).toHaveCount(0);
  await page.screenshot({ path: resolve(ARTIFACTS, "warehouse-header.png") });

  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await download.path())!);
  for (const sheet of workbook.worksheets) {
    expect(sheet.pageSetup, `${sheet.name}: A4 chop etish`).toMatchObject({ paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "4:4" });
    expect(sheet.getRow(4).getCell(1).value).toBe("SKU");
    expect(sheet.getRow(5).getCell(3).alignment?.wrapText, "uzun nom bo'linadi").toBe(true);
    expect(sheet.getRow(5).getCell(1).border?.left?.style, "katak chegarasi").toBe("thin");
  }
});

test("maydondagi supervayzer: 'Sotuv' — agent ish joyi, profil avtomatik, ERP'ga qaytish", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("/warehouse"));
  const phone = "+998900000150";
  const created = await api(page, "POST", "/api/company/employees", { phone, password: PASSWORD, name: "E2E Supervayzer", role: "Supervayzer" });
  expect([201, 400, 409], JSON.stringify(created.json)).toContain(created.status);

  await page.context().clearCookies();
  await page.goto(`/${SLUG}`);
  await page.locator("#phone").fill(phone);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: /kirish/i }).click();
  await expect(page.locator("#password")).toBeHidden({ timeout: 30_000 });
  await page.goto(appPath("/dashboard"));
  const sales = page.locator(`a[href="/${SLUG}/sales-agent"]`).first();
  await expect(sales, "'Sotuv' agent ish joyiga olib boradi").toBeVisible({ timeout: 30_000 });
  await sales.click();
  await expect(page).toHaveURL(/\/sales-agent/, { timeout: 30_000 });
  // O'z savdo profili avtomatik yaratiladi — agent ish joyi ochiladi
  await expect.poll(async () => (await api(page, "GET", "/api/sales-agent/me")).status, { timeout: 30_000 }).toBe(200);
  await expect(page.getByTestId("agent-back-to-erp")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: resolve(ARTIFACTS, "supervisor-sales.png") });
  await page.getByTestId("agent-back-to-erp").click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
});

test("rahbar: supervayzer paneli, 'Agent nomidan' — GPS/ish vaqti agent nomidan bloklangan", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("/distribution?tab=supervisor"));
  const section = page.getByTestId("supervisor-section");
  await expect(section).toBeVisible({ timeout: 30_000 });
  await expect(section.getByTestId("supervisor-totals")).toBeVisible();
  await expect(section.getByTestId("supervisor-delivery")).toBeVisible();
  const overview = (await api<{ agents: { id: string; name: string }[] }>(page, "GET", "/api/sales-agent/supervisor/overview")).json;
  const first = overview.agents[0]!;
  const row = section.getByTestId("supervisor-agent-row").filter({ hasText: first.name }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: resolve(ARTIFACTS, "supervisor-panel.png") });

  await row.getByRole("button", { name: first.name }).click();
  const chainButton = section.getByTestId("open-chain").first();
  if (await chainButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await chainButton.click();
    await expect(page.getByTestId("chain-step")).toHaveCount(7, { timeout: 15_000 });
    await page.keyboard.press("Escape");
  }

  await row.getByTestId("act-as-agent").click();
  await expect(page).toHaveURL(/\/sales-agent\/customers/, { timeout: 30_000 });
  await expect(page.getByTestId("act-as-banner")).toContainText(first.name, { timeout: 30_000 });
  const me = await api<{ agent: { id: string } }>(page, "GET", "/api/sales-agent/me", undefined, { "x-act-as-sales-rep": first.id });
  expect(me.status).toBe(200);
  expect(me.json.agent.id).toBe(first.id);
  const blocked = await api(page, "POST", "/api/sales-agent/work-session/start", { latitude: 41.3, longitude: 69.2, accuracy: 10, recordedAt: new Date().toISOString() }, { "x-act-as-sales-rep": first.id });
  expect(blocked.status, "ish vaqti agent nomidan boshlanmaydi").toBe(403);
  await page.getByTestId("act-as-banner").getByRole("button", { name: "Tugatish" }).click();
  await expect(page.getByTestId("supervisor-section")).toBeVisible({ timeout: 30_000 });
});
