/**
 * AUD-003 — HUJJATSIZ QOLDIQ, HAQIQIY BRAUZERDA (2026-09-28): mijozga boshlang'ich qarz 50 000 (hujjatsiz) →
 * Sotuv → Qarzdorlik: "Hujjatsiz qoldiq" blokida mijoz qatori (hujjatlar 0, hisob 50 000, hujjatsiz qarz 50 000);
 * bu summa hujjatlar qarz yoshi qatorlarida ko'rinmaydi.
 */
import { expect, test, type Page } from "@playwright/test";
import { appPath, login } from "./_lib/accounts.ts";

test.describe.configure({ timeout: 240_000 });

async function api<T = unknown>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(path, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
      return { status: res.status, json: await res.json().catch(() => null) };
    },
    { method, path, body },
  ) as Promise<{ status: number; json: T }>;
}

test("qarz yoshi: hujjatsiz qoldiq alohida blokda, hujjatlar jamisiga kirmaydi", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("/sales"));
  const stamp = String(Date.now()).slice(-7);
  const name = `Hujjatsiz ${stamp}`;
  const customer = await api<{ customer: { id: string } }>(page, "POST", "/api/sales/customers", { name });
  expect(customer.status, JSON.stringify(customer.json)).toBe(201);
  const id = customer.json.customer.id;
  const adjust = await api(page, "POST", `/api/sales/customers/${id}/balance-adjust`, { totalDebt: "50000", reason: "Boshlang'ich qarz", counter: "equity" });
  expect(adjust.status, JSON.stringify(adjust.json)).toBe(200);

  await page.getByRole("tab", { name: "Qarzdorlik" }).click();
  const block = page.getByTestId("aging-undocumented");
  await expect(block).toBeVisible({ timeout: 30_000 });
  const row = page.getByTestId(`aging-undocumented-${id}`);
  await expect(row).toContainText(name);
  await expect(row.locator("td").nth(1)).toHaveText("0");
  await expect(row.locator("td").nth(2)).toHaveText(/50\D?000/);
  await expect(row.locator("td").nth(3)).toHaveText(/50\D?000/);
  await expect(page.getByTestId(`aging-customer-${id}`), "hujjatlar qarz yoshida yo'q").toHaveCount(0);
  await page.screenshot({ path: "e2e/.screenshots/aging-undocumented.png" });
});
