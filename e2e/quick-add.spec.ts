/**
 * "Tezda qo'shish" (import yonidagi kataklar) va xaridda mahsulot qidirish.
 *
 *  - Mahsulotlar sahifasi: "Tezda qo'shish" jadvaliga yozib saqlash — mahsulot ro'yxatda paydo bo'ladi;
 *  - Xarid: umumiy ma'lumotlar (ta'minotchi, ombor, sana) bir marta yuqorida, mahsulotlar qatorlarda —
 *    bir saqlash BITTA hujjat bo'ladi;
 *  - Oynani butun ekranga yoyish;
 *  - Xarid hujjati: nomi bo'yicha qidirib bir nechta mahsulotni belgilab qo'shish.
 */
import { expect, test } from "@playwright/test";
import { COMPANY_HEADERS, appPath, login } from "./_lib/accounts.ts";

const stamp = Date.now().toString().slice(-6);

test("mahsulotlarda «Tezda qo'shish»: kataklarga yozib saqlansa ro'yxatga tushadi", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("products"));

  const quick = page.getByTestId("quick-add").first();
  await expect(quick, "import yonida «Tezda qo'shish» tugmasi").toBeVisible({ timeout: 30_000 });
  await quick.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Tezda qo'shish")).toBeVisible();

  // Bir marta kiritiladigan maydonlar (birlik, kategoriya, brend) yuqorida — jadvalda emas
  const shared = dialog.getByTestId("quick-add-shared");
  await expect(shared).toBeVisible();
  await expect(shared.getByText("Kategoriya")).toBeVisible();
  await expect(dialog.locator("thead").getByText("Kategoriya"), "kategoriya jadvalda takrorlanmaydi").toHaveCount(0);
  await shared.locator("input").first().fill("Dona");

  // Birinchi qatorni to'ldiramiz: nomi va SKU
  const name = `Tezkor tovar ${stamp}`;
  const rows = dialog.locator("tbody tr");
  await expect(rows.first()).toBeVisible();
  const inputs = rows.first().locator("input");
  await inputs.nth(0).fill(name);
  await inputs.nth(1).fill(`TEZ-${stamp}`);

  await dialog.getByRole("button", { name: "Saqlash" }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  // Ro'yxatda paydo bo'ldi
  await page.getByPlaceholder(/Nomi, SKU, barcode/i).first().fill(name);
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 30_000 });
});

test("«Tezda qo'shish» oynasini butun ekranga yoyish mumkin", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("products"));

  await page.getByTestId("quick-add").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });

  // Ochilish animatsiyasi tugaganda kenglik barqarorlashadi
  const width = async () => (await dialog.boundingBox())!.width;
  await expect.poll(width, { timeout: 10_000 }).toBeGreaterThan(1000);
  const normal = await width();

  await dialog.getByTestId("quick-add-fullscreen").click();
  await expect.poll(width, { timeout: 10_000 }).toBeGreaterThan(normal + 100);
  const expanded = await width();

  // Qaytarish ham ishlaydi
  await dialog.getByTestId("quick-add-fullscreen").click();
  await expect.poll(width, { timeout: 10_000 }).toBeLessThan(expanded - 100);
});

test("xaridda «Tezda qo'shish»: umumiy maydonlar bir marta, mahsulotlar bitta hujjatga tushadi", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("purchase"));

  // Saqlashdan oldingi hujjatlar (UI sanog'i emas — API bo'yicha aniq)
  await expect(page.getByTestId("quick-add").first()).toBeVisible({ timeout: 30_000 });
  type OrderRow = { id: string; itemCount: number; status: string };
  const orders = async (): Promise<OrderRow[]> => {
    const res = await page.request.get("/api/purchase/orders?limit=100", { headers: COMPANY_HEADERS });
    expect(res.ok(), await res.text()).toBeTruthy();
    return (await res.json()).orders as OrderRow[];
  };
  const before = await orders();

  await page.getByTestId("quick-add").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });

  // Ta'minotchi/ombor/sana — bir marta yuqorida
  const shared = dialog.getByTestId("quick-add-shared");
  await expect(shared).toBeVisible();
  await shared.locator("#quick-shared-supplier").fill("Oziq-ovqat ta'minoti");
  await shared.locator("#quick-shared-warehouse").fill("Asosiy ombor");
  await shared.locator("#quick-shared-orderDate").fill("2026-09-19");

  // Jadvalda faqat mahsulotga tegishli kataklar qoladi
  await expect(dialog.locator("thead").getByText("Ta'minotchi")).toHaveCount(0);
  await expect(dialog.locator("thead").getByText("Mahsulot")).toBeVisible();

  const rows = dialog.locator("tbody tr");
  const fill = async (index: number, product: string, qty: string, price: string) => {
    const inputs = rows.nth(index).locator("input");
    await inputs.nth(0).fill(product); // Mahsulot
    await inputs.nth(1).fill(qty); // Miqdor
    await inputs.nth(3).fill(price); // Narx (2 - birlik)
  };
  await fill(0, "Coca Cola 1L", "2", "9000");
  await fill(1, "Nestle suv 0.5L", "3", "2500");

  await expect(dialog.getByText(/bitta hujjatga tushadi/)).toBeVisible();
  await dialog.getByRole("button", { name: "Saqlash" }).click();

  // Ikki qator — BITTA xarid hujjati, ichida 2 ta mahsulot
  await expect(page.getByText(/Hujjat qo'shildi \(2 ta qator\)/)).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  await expect.poll(async () => (await orders()).length, { timeout: 30_000 }).toBe(before.length + 1);
  const known = new Set(before.map((row) => row.id));
  const created = (await orders()).find((row) => !known.has(row.id))!;
  expect(created, "yangi hujjat").toBeTruthy();
  expect(created.itemCount, "ikkala mahsulot bitta hujjatda").toBe(2);
  expect(created.status).toBe("draft");
});

test("xaridda mahsulotni nomi bo'yicha qidirib, belgilab qo'shish", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("purchase"));

  await page.getByRole("button", { name: "Xarid buyurtmasi" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });

  const search = dialog.getByPlaceholder(/Mahsulot nomi, SKU yoki barkod/);
  await expect(search, "qidiruv maydoni").toBeVisible();
  await search.fill("Nestle");

  // Ro'yxatdan belgilab qo'shamiz
  const option = dialog.locator("label").filter({ hasText: /Nestle/ }).first();
  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.locator("button[role='checkbox'], input[type='checkbox']").first().click();

  const addPicked = dialog.getByRole("button", { name: /Tanlanganlarni qo'shish/ });
  await expect(addPicked).toBeVisible();
  await addPicked.click();

  // Qator jadvalga tushdi
  await expect(dialog.getByRole("row").filter({ hasText: /Nestle/ }).first()).toBeVisible({ timeout: 15_000 });
});

test("xarid buyurtmasi oynasini butun ekranga yoyish mumkin", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("purchase"));

  await page.getByRole("button", { name: "Xarid buyurtmasi" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });

  const before = (await dialog.boundingBox())!.width;
  await dialog.getByTestId("order-fullscreen").click();
  await expect
    .poll(async () => (await dialog.boundingBox())!.width, { timeout: 10_000 })
    .toBeGreaterThan(before);
});
