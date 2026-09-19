/**
 * Obuna sahifasidagi "Foydalanuvchi qo'shish" — MAVJUD xodimga dasturga kirish beradi.
 *
 * Xodim faqat Kadrlarda ochiladi (yagona manba), shuning uchun bu oyna xodimni TANLAYDI.
 * Har berilgan kirish bitta included litsenziyani band qiladi; bo'sh litsenziya tugagach
 * server rad etadi va oyna yopilmaydi.
 *
 * Test o'zidan keyin hech narsani o'chirmaydi: bergan kirishini qaytarib oladi (litsenziya bo'shaydi)
 * va yaratgan xodimlarini "ishdan bo'shagan" holatiga o'tkazadi — demo kompaniya holati saqlanadi.
 */
import { expect, test, type Page } from "@playwright/test";
import { COMPANY_HEADERS, PASSWORD, appPath, login } from "./_lib/accounts.ts";

const stamp = Date.now().toString().slice(-6);

/** Shu test yaratgan xodimlar — oxirida kirishi olinadi va holati "terminated" bo'ladi. */
const createdEmployees: string[] = [];

/** "Bo'sh" katagidagi raqam. */
async function freeLicenses(page: Page) {
  const tile = page.locator("div", { has: page.getByText("Bo'sh", { exact: true }) });
  const text = await tile.last().innerText();
  return Number(text.replace(/\D/g, ""));
}

/** Kadrlardagi kanonik xizmat orqali loginsiz (bepul) xodim — litsenziya band qilmaydi. */
async function freeEmployee(page: Page, name: string, phone: string) {
  const res = await page.request.post("/api/hr/employees", {
    headers: COMPANY_HEADERS,
    data: { name, phone, hireDate: new Date().toISOString().slice(0, 10), baseSalary: "0", salaryType: "monthly" },
  });
  expect(res.status(), await res.text()).toBe(201);
  const id = (await res.json()).employee.id as string;
  createdEmployees.push(id);
  return id;
}

/** Obuna sahifasidagi oyna: xodimni tanlab, unga login beradi. */
async function grantAccess(page: Page, employeeName: string, phone: string) {
  await page.getByTestId("add-user").click();
  const dialog = page.getByTestId("add-user-dialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });

  await dialog.locator("#add-user-employee").click();
  await page.getByRole("option", { name: new RegExp(employeeName) }).first().click();
  await dialog.locator("#add-user-phone").fill(phone);
  await dialog.locator("#add-user-password").fill(PASSWORD);
  await dialog.locator("#add-user-pin").fill("4321");
  await dialog.locator("#add-user-role").click();
  await page.getByRole("option", { name: "Kassir" }).first().click();
  await dialog.getByRole("button", { name: "Kirish berish" }).click();
  return dialog;
}

test.afterAll(async ({ browser }) => {
  if (createdEmployees.length === 0) return;
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, "owner");
  for (const id of createdEmployees) {
    // Kirishni qaytarib olamiz (litsenziya bo'shaydi), so'ng xodimni arxivga — yozuv o'chirilmaydi
    await page.request.delete(`/api/hr/employees/${id}/software-access`, { headers: COMPANY_HEADERS });
    await page.request.patch(`/api/hr/employees/${id}`, { headers: COMPANY_HEADERS, data: { status: "terminated" } });
  }
  await context.close();
});

test("obuna sahifasida foydalanuvchi qo'shish litsenziya talab qiladi", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "owner");

  const addButton = page.getByTestId("add-user");
  await page.goto(appPath("subscription"), { waitUntil: "domcontentloaded" });
  await expect(addButton, "kompaniya egasiga tugma ko'rinadi").toBeVisible({ timeout: 30_000 });

  const before = await freeLicenses(page);
  expect(before, "testni boshlash uchun bo'sh litsenziya kerak").toBeGreaterThan(0);

  // Kadrlarda bo'sh litsenziyalardan bitta ko'p xodim ochamiz (oxirgisi rad etilishi kerak)
  const names: string[] = [];
  for (let i = 0; i <= before; i += 1) {
    const name = `Litsenziya sinovi ${stamp}-${i}`;
    await freeEmployee(page, name, `+99893${stamp}${i}`);
    names.push(name);
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(addButton).toBeVisible({ timeout: 30_000 });

  // ── Bo'sh litsenziya bor: kirish beriladi va bo'sh litsenziya kamayadi ───
  const first = await grantAccess(page, names[0]!, `+99894${stamp}0`);
  await expect(first, "kirish berildi").toBeHidden({ timeout: 30_000 });
  await expect.poll(async () => freeLicenses(page), { timeout: 30_000 }).toBe(before - 1);

  // ── Qolgan bo'sh litsenziyalarni to'ldiramiz ────────────────────────────
  for (let i = 1; i < before; i += 1) {
    const dialog = await grantAccess(page, names[i]!, `+99894${stamp}${i}`);
    await expect(dialog).toBeHidden({ timeout: 30_000 });
  }
  await expect.poll(async () => freeLicenses(page), { timeout: 30_000 }).toBe(0);

  // ── Bo'sh litsenziya yo'q: server rad etadi, oyna yopilmaydi ────────────
  const blockedPhone = `+99894${stamp}9`;
  const blocked = await grantAccess(page, names[before]!, blockedPhone);
  await expect(blocked, "oyna ochiq qoladi").toBeVisible();
  const error = blocked.getByRole("alert");
  await expect(error, "server xatosi oynada ko'rsatiladi").toBeVisible({ timeout: 30_000 });
  await expect(error).toContainText(/litsenziya/i);

  // Server ham yaratmagan: bu telefon bilan foydalanuvchi yo'q
  const check = await page.request.get("/api/company/employees", { headers: COMPANY_HEADERS });
  const { employees } = (await check.json()) as { employees: { phone: string }[] };
  expect(employees.some((row) => row.phone === blockedPhone), "litsenziyasiz kirish berilmaydi").toBe(false);

  await page.screenshot({ path: "e2e/.screenshots/subscription-license.png" });
  await blocked.getByRole("button", { name: "Bekor" }).click();
});
