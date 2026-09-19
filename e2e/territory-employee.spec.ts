/**
 * Hududlar va xodim qo'shish — haqiqiy brauzerda.
 *
 *  - Distribyutsiya → Marshrutlar: avval hudud qo'shiladi, keyin marshrut shu hudud tarkibida ochiladi
 *    va ro'yxatda hudud sarlavhasi ostida ko'rinadi;
 *  - Sozlamalar → Foydalanuvchilar: xodim bo'lim va lavozim bilan qo'shiladi va Kadrlar ro'yxatida chiqadi.
 */
import { expect, test } from "@playwright/test";
import { appPath, login } from "./_lib/accounts.ts";

const stamp = Date.now().toString().slice(-6);

test("marshrut hudud tarkibida ochiladi", async ({ page }) => {
  const territory = `Urganch ${stamp}`;
  const route = `Luchevoy ${stamp}`;

  await login(page, "owner");
  await page.goto(appPath("distribution"));
  await page.getByRole("tab", { name: "Marshrutlar" }).click();

  // 1) Avval hudud
  await page.getByTestId("territories-open").click();
  const territories = page.getByTestId("territories-dialog");
  await expect(territories).toBeVisible({ timeout: 30_000 });
  await territories.getByTestId("territory-name").fill(territory);
  await territories.getByRole("button", { name: "Qo'shish" }).click();
  await expect(territories.getByText(territory)).toBeVisible({ timeout: 30_000 });
  await territories.getByRole("button", { name: "Yopish" }).click();

  // 2) Keyin marshrut — hudud tanlanadi
  await page.getByRole("button", { name: "Marshrut qo'shish" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("Shimoliy marshrut").fill(route);
  await dialog.getByTestId("route-territory").click();
  await page.getByRole("option", { name: territory }).click();
  await dialog.getByRole("button", { name: "Yaratish" }).click();
  await expect(page.getByText(/Marshrut qo'shildi/)).toBeVisible({ timeout: 30_000 });

  // 3) Ro'yxatda hudud sarlavhasi ostida
  const group = page.getByText(new RegExp(`${territory}.*1 ta marshrut`)).first();
  await expect(group, "hudud sarlavhasi va marshrutlar soni").toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(route).first()).toBeVisible();
});

test("qo'shilgan xodim Kadrlar ro'yxatida bo'lim va lavozimi bilan ko'rinadi", async ({ page }) => {
  const name = `Sinov Xodim ${stamp}`;
  const phone = `+99890${stamp}1`;

  await login(page, "owner");
  await page.goto(appPath("settings"));
  await page.getByRole("tab", { name: "Foydalanuvchilar" }).click();
  await page.getByRole("button", { name: /Xodim qo'shish/ }).first().click();

  const dialog = page.getByTestId("new-employee-dialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByLabel("Telefon").fill(phone);
  await dialog.getByLabel("Ism-familiya", { exact: false }).fill(name);
  await dialog.getByLabel("Parol", { exact: false }).first().fill("Xodim-parol-2026");

  // Bo'lim va lavozim tanlovi — Kadrlarda ochilgan ro'yxatdan
  const department = dialog.locator("#new-employee-department");
  if (await department.isVisible().catch(() => false)) {
    await department.click();
    await page.getByRole("option").first().click();
  }

  await dialog.getByRole("button", { name: /Qo'shish|Saqlash/ }).last().click();
  await expect(page.getByText(/Xodim qo'shildi/)).toBeVisible({ timeout: 30_000 });

  // Kadrlar ro'yxatida ko'rinadi
  await page.goto(appPath("hr"));
  await expect(page.getByText(name).first(), "yangi xodim Kadrlar ro'yxatida").toBeVisible({ timeout: 30_000 });
});
