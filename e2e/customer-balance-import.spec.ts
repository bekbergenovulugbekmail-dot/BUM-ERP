/**
 * MIJOZ BALANSI IMPORTI — HAQIQIY BRAUZERDA (2026-09-28):
 *   CRM → Mijozlar → "Balans importi" → fayl (Mijoz;Balans;Sabab) → avtomat moslash → tekshirish (bazaga yozilmaydi)
 *   → "Importni boshlash" → mijoz balansi 150 000. O'sha faylni qayta yuklash balansni o'zgartirmaydi (maqsad qiymat).
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

test("balans importi: tekshirish → import → qayta yuklash o'zgartirmaydi", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("/crm"));
  const stamp = String(Date.now()).slice(-7);
  const name = `Balans mijoz ${stamp}`;
  const created = await api<{ customer: { id: string } }>(page, "POST", "/api/sales/customers", { name });
  expect(created.status, JSON.stringify(created.json)).toBe(201);
  const balanceOf = async () =>
    Number((await api<{ customer: { balance: string } }>(page, "GET", `/api/sales/customers/${created.json.customer.id}`)).json.customer.balance);

  await page.getByRole("tab", { name: "Mijozlar" }).first().click();
  const importOnce = async () => {
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("customer-balance-import").click()]);
    await chooser.setFiles({ name: "balans.csv", mimeType: "text/csv", buffer: Buffer.from(["Mijoz;Balans;Sabab", `${name};150000;Eski dasturdan`].join("\n"), "utf8") });
    const mapping = page.getByTestId("csv-mapping");
    await expect(mapping).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("csv-mapping-continue").click();
    const preview = page.getByRole("dialog").filter({ hasText: "Importni tekshirish" });
    await expect(preview).toBeVisible({ timeout: 30_000 });
    await expect(preview).toContainText("Bu bosqichda bazaga hech narsa yozilmagan");
    return preview;
  };

  const preview = await importOnce();
  expect(await balanceOf(), "tekshirishda hech narsa yozilmaydi").toBe(0);
  await page.screenshot({ path: "e2e/.screenshots/customer-balance-import.png" });
  await preview.getByRole("button", { name: /Importni boshlash/ }).click();
  await expect(preview).toBeHidden({ timeout: 30_000 });
  await expect.poll(balanceOf, { timeout: 15_000 }).toBe(150_000);
  const report = page.getByRole("dialog").filter({ hasText: "Import yakunlandi" });
  await expect(report).toContainText("Xato");
  await report.getByRole("button", { name: "Yopish" }).click();

  const again = await importOnce();
  await again.getByRole("button", { name: /Importni boshlash/ }).click();
  await expect(again).toBeHidden({ timeout: 30_000 });
  expect(await balanceOf(), "qayta yuklash — o'sha maqsad qiymat").toBe(150_000);
});
