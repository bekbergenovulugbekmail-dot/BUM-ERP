/**
 * Hujjat dizayneri — HAQIQIY brauzerda.
 *
 * Eng muhimi: A4 ko'rinish CHINAKAM PDF. Shuning uchun bu yerda shablon yaratiladi, element
 * qo'shiladi, saqlanadi va sahifa qayta ochilganda o'zgarish JOYIDA ekani tekshiriladi.
 */
import { expect, test, type Page } from "@playwright/test";
import { appPath, login } from "./_lib/accounts.ts";

/** Shablon yuklanib, A4 ko'rinish chizilgunicha kutadi. */
const waitForPreview = async (page: Page) => {
  await expect(page.locator("iframe").first()).toHaveAttribute("src", /^blob:/, { timeout: 20_000 });
};

const openDesigner = async (page: Page) => {
  await page.goto(appPath("/settings"));
  await page.getByRole("tab", { name: "Hujjatlar" }).click();
  await expect(page.getByText(/A4 ko'rinish/)).toBeVisible({ timeout: 20_000 });
};

test.beforeEach(async ({ page }) => {
  await login(page, "owner");
});

/**
 * Test o'zidan keyin tozalaydi: sinov shablonlari arxivlanadi.
 *
 * Shusiz har yurish yangi shablon qoldirar va bir necha yurishdan keyin "bu turda 20 tadan
 * ortiq shablon bo'lmaydi" chegarasiga urilib, testlar sababsiz qizil bo'lardi.
 */
test.afterEach(async ({ page }) => {
  // Tozalash HECH QACHON testni yiqitmasin — u asosiy tekshiruv emas
  const list = await page.request.get("/api/documents/templates", { timeout: 30_000 }).catch(() => null);
  if (!list?.ok()) return;
  const { templates } = (await list.json()) as { templates: { id: string; name: string; isDefault: boolean }[] };
  for (const template of templates) {
    if (!/^(Sinov|Versiya|Nakladnoy) \d+$/.test(template.name)) continue;
    await page.request.delete(`/api/documents/templates/${template.id}`, { timeout: 30_000 }).catch(() => null);
  }
});

test("shablon yaratiladi, tahrirlanadi, saqlanadi va qayta ochilganda joyida qoladi", async ({ page }) => {
  await openDesigner(page);

  // ── Yaratish ──
  const name = `Sinov ${Date.now()}`;
  await page.getByTestId("template-create").click();
  await page.getByTestId("template-name").fill(name);
  await page.getByTestId("template-create-confirm").click();
  await expect(page.getByTestId("template-select")).toContainText(name, { timeout: 20_000 });

  // A4 ko'rinish haqiqiy PDF bo'lib chiziladi
  const frame = page.locator('iframe[title="A4 ko\'rinish"]');
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute("src", /^blob:/);

  // ── Element qo'shish: "Sarlavha" bo'limiga matn ──
  await page.getByTestId("add-header-text").click();

  // Yangi element tanlanadi va matni o'zgartiriladi
  await page.getByRole("button", { name: /Matn · Yangi matn/ }).click();
  await page.getByTestId("element-label").fill("MENING NAKLADNOYIM");

  // ── Saqlash ──
  await page.getByTestId("template-save").click();
  await expect(page.getByText(/versiya saqlandi/)).toBeVisible({ timeout: 20_000 });

  // ── Qayta ochish: o'zgarish joyida ──
  await page.reload();
  await openDesigner(page);
  await page.getByTestId("template-select").click();
  await page.getByRole("option", { name: new RegExp(name) }).click();
  await expect(page.getByRole("button", { name: /MENING NAKLADNOYIM/ })).toBeVisible({ timeout: 20_000 });
});

test("versiyaga qaytish eski ko'rinishni tiklaydi", async ({ page }) => {
  // Bu test ko'p qadam bosadi va har qadamda A4 PDF qayta chiziladi (shrift bilan) — sekinroq
  test.setTimeout(180_000);
  await openDesigner(page);

  const name = `Versiya ${Date.now()}`;
  await page.getByTestId("template-create").click();
  await page.getByTestId("template-name").fill(name);
  await page.getByTestId("template-create-confirm").click();
  await expect(page.getByTestId("template-select")).toContainText(name, { timeout: 20_000 });

  // 2-versiya: matn qo'shamiz
  await waitForPreview(page);
  await page.getByTestId("add-header-text").click();
  await page.getByRole("button", { name: /Matn · Yangi matn/ }).click();
  await page.getByTestId("element-label").fill("IKKINCHI VERSIYA");
  await page.getByTestId("template-save").click();
  await expect(page.getByText(/2-versiya saqlandi/)).toBeVisible({ timeout: 20_000 });

  // 1-versiyaga qaytamiz
  await page.getByRole("button", { name: "Versiyalar" }).click();
  await page.getByRole("button", { name: "Qaytarish" }).last().click();
  await expect(page.getByText(/qaytarildi/)).toBeVisible({ timeout: 20_000 });

  await page.reload();
  await openDesigner(page);
  await page.getByTestId("template-select").click();
  await page.getByRole("option", { name: new RegExp(name) }).click();
  await expect(page.getByText(/A4 ko'rinish/)).toBeVisible();
  await expect(page.getByRole("button", { name: /IKKINCHI VERSIYA/ }), "eski ko'rinish qaytdi").toHaveCount(0);
});
