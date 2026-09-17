/**
 * Obuna sahifasidagi "Foydalanuvchi qo'shish": bo'sh included litsenziya bo'lsa xodim yaratiladi,
 * tugagan bo'lsa qo'shimcha litsenziya tarifi talab qilinadi va hech narsa yaratilmaydi.
 *
 * Test o'zidan keyin yaratgan foydalanuvchilarni o'chirmaydi — faolsizlantiradi (included litsenziya bo'shaydi),
 * shunda demo kompaniya holati oldingiday qoladi. Mavjud ma'lumot o'chirilmaydi.
 */
import { expect, test, type Page } from "@playwright/test";
import { ACCOUNTS, PASSWORD, appPath, login } from "./_lib/accounts.ts";

/** Yaratilgan test foydalanuvchilarining telefonlari — oxirida faolsizlantiriladi. */
const created: string[] = [];

/** "Bo'sh" katagidagi raqam. */
async function freeLicenses(page: Page) {
  const tile = page.locator("div", { has: page.getByText("Bo'sh", { exact: true }) });
  const text = await tile.last().innerText();
  return Number(text.replace(/\D/g, ""));
}

async function addUser(page: Page, phone: string) {
  await page.getByTestId("add-user").click();
  const dialog = page.getByTestId("new-employee-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Telefon raqam").fill(phone);
  await dialog.getByLabel("Dastlabki parol").fill(PASSWORD);
  await page.getByTestId("new-employee-submit").click();
  return dialog;
}

test.afterAll(async ({ browser }) => {
  if (created.length === 0) return;
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, "owner");
  const list = await page.request.get("/api/company/employees");
  const { employees } = (await list.json()) as { employees: { id: string; phone: string }[] };
  for (const phone of created) {
    const found = employees.find((row) => row.phone === phone);
    // O'chirilmaydi — faqat faolsizlantiriladi; included litsenziya bo'shaydi
    if (found) await page.request.patch(`/api/company/employees/${found.id}`, { data: { isActive: false } });
  }
  await context.close();
});

test("obuna sahifasida foydalanuvchi qo'shish litsenziya talab qiladi", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "owner");
  await page.goto(appPath("subscription"), { waitUntil: "domcontentloaded" });

  const addButton = page.getByTestId("add-user");
  await expect(addButton, "kompaniya egasiga tugma ko'rinadi").toBeVisible({ timeout: 30_000 });

  const before = await freeLicenses(page);
  expect(before, "testni boshlash uchun bo'sh litsenziya kerak").toBeGreaterThan(0);

  // ── Bo'sh litsenziya bor: xodim darhol yaratiladi ────────────────────────
  const stamp = Date.now().toString().slice(-7);
  const firstPhone = `+9989${stamp}`;
  created.push(firstPhone);
  const dialog = await addUser(page, firstPhone);
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect.poll(async () => freeLicenses(page), { timeout: 20_000 }).toBe(before - 1);

  // ── Qolgan bo'sh litsenziyalarni to'ldiramiz ─────────────────────────────
  for (let i = 1; i < before; i += 1) {
    const phone = `+9989${stamp}`.slice(0, 8) + String(i).padStart(4, "0");
    created.push(phone);
    const next = await addUser(page, phone);
    await expect(next).toBeHidden({ timeout: 20_000 });
  }
  await expect.poll(async () => freeLicenses(page), { timeout: 20_000 }).toBe(0);

  // ── Bo'sh litsenziya yo'q: ogohlantirish va tarif talabi ─────────────────
  await expect(page.getByText(/Bo'sh included litsenziya yo'q/)).toBeVisible();

  const blockedPhone = `+9989${stamp}`.slice(0, 8) + "9999";
  const blocked = await addUser(page, blockedPhone);
  // Xodim yaratilmaydi: oyna yopilmaydi, qo'shimcha litsenziya tarifi so'raladi
  await expect(blocked).toBeVisible();
  await expect(blocked.getByText(/litsenziyasi ishlatilgan/)).toBeVisible({ timeout: 20_000 });
  await expect(blocked.getByText(/qo'shimcha litsenziya tanlang/i)).toBeVisible();

  // Server ham yaratmagan
  const check = await page.request.get("/api/company/employees");
  const { employees } = (await check.json()) as { employees: { phone: string }[] };
  expect(employees.some((row) => row.phone === blockedPhone), "tarif tanlanmaguncha xodim yaratilmaydi").toBe(false);

  await page.screenshot({ path: "e2e/.screenshots/subscription-license.png" });
  await blocked.getByRole("button", { name: "Bekor" }).click();
});
