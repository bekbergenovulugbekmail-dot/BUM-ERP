/**
 * SUPERMARKET — HAQIQIY BRAUZERDA (2026-09-27):
 *   Kassir: skaner (klaviatura-emulyatsiyali USB skaner: kod + Enter) → mahsulot savatga → ikkinchi skaner = 2 dona →
 *   naqd to'lov → chek → BAZADA: chek jami, to'lov, ombor −2 (DOM yetarli emas).
 *   SKU ≠ shtrix-kod: bir mahsulotning SKU'si boshqasining shtrix-kodiga teng bo'lsa — skaner SHTRIX-KOD egasini qo'shadi.
 */
import { expect, test, type Page } from "@playwright/test";
import { appPath, login } from "./_lib/accounts.ts";
import { clearCart, closeReceipt, ensureShift, savePart } from "./_lib/pos.ts";

test.describe.configure({ timeout: 240_000 });

function ean13(base12: string) {
  const digits = base12.padStart(12, "0").slice(0, 12);
  const sum = [...digits].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return digits + String((10 - (sum % 10)) % 10);
}

async function api<T = unknown>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(path, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
      return { status: res.status, json: await res.json().catch(() => null) };
    },
    { method, path, body },
  ) as Promise<{ status: number; json: T }>;
}

/** USB skaner, hech narsa fokusda emas: tez yoziladigan belgilar + Enter (global skaner tinglovchisi). */
async function scan(page: Page, code: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.type(code, { delay: 5 });
  await page.keyboard.press("Enter");
}

/** USB skaner, kursor qidiruv maydonida (kassir oldin qidirgan): kod maydonga yoziladi + Enter. */
async function scanIntoSearch(page: Page, code: string) {
  const search = page.getByPlaceholder(/Mahsulot nomi, SKU yoki barkod/);
  await search.click();
  await page.keyboard.type(code, { delay: 5 });
  await page.keyboard.press("Enter");
  await expect(search, "skanerdan keyin qidiruv tozalanadi").toHaveValue("", { timeout: 10_000 });
}

test("kassir: skaner → savat (2 dona) → naqd → chek → baza (jami, to'lov, ombor); SKU emas, shtrix-kod egasi qo'shiladi", async ({ page }) => {
  // Tayyorlash (egasi): ikki mahsulot — B ning SKU'si A ning shtrix-kodi bilan bir xil (SKU ≠ shtrix-kod sinovi)
  await login(page, "owner");
  await page.goto(appPath("dashboard"));
  const stamp = String(Date.now()).slice(-9);
  const barcode = ean13(`47${stamp}9`);
  const units = (await api<{ units: { id: string; shortName: string }[] }>(page, "GET", "/api/catalog/units")).json.units;
  const piece = units.find((unit) => unit.shortName === "d")!.id;
  const warehouses = (await api<{ warehouses: { id: string; isDefault: boolean }[] }>(page, "GET", "/api/inventory/warehouses")).json.warehouses;
  const warehouseId = (warehouses.find((row) => row.isDefault) ?? warehouses[0]!).id;
  const a = await api<{ product: { id: string } }>(page, "POST", "/api/catalog/products", { name: `Skaner A ${stamp}`, sku: `SCAN-A-${stamp}`, barcode, baseUnitId: piece, salesPrice: "7000", taxRate: "0" });
  expect(a.status, JSON.stringify(a.json)).toBe(201);
  const b = await api<{ product: { id: string } }>(page, "POST", "/api/catalog/products", { name: `Skaner B ${stamp}`, sku: barcode, baseUnitId: piece, salesPrice: "99000", taxRate: "0" });
  expect(b.status, JSON.stringify(b.json)).toBe(201);
  for (const productId of [a.json.product.id, b.json.product.id]) {
    const received = await api(page, "POST", "/api/inventory/stock/movements", { type: "receive", productId, warehouseId, quantity: "10", costPrice: "5000" });
    expect(received.status).toBe(201);
  }
  // Takroriy shtrix-kod — server rad etadi
  expect((await api(page, "POST", "/api/catalog/products", { name: "Dublikat", sku: `SCAN-D-${stamp}`, barcode, baseUnitId: piece, salesPrice: "1", taxRate: "0" })).status).toBe(409);

  // Kassir
  await login(page, "kassir");
  await page.goto(appPath("pos"));
  await expect(page.getByRole("button", { name: /Smena (ochish|yopish)/ }).first()).toBeVisible({ timeout: 30_000 });
  await ensureShift(page, "0");
  await clearCart(page);

  await scan(page, barcode);
  await expect(page.getByText(`Skaner A ${stamp} savatchaga qo'shildi`).first()).toBeVisible({ timeout: 15_000 });
  await scanIntoSearch(page, barcode);
  await expect(page.getByText(/14[\s,.]?000/).first(), "2 × 7 000 = 14 000").toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: "e2e/.screenshots/supermarket-scan-cart.png" });

  await savePart(page, /naqd/i, "14000");
  const finalize = page.getByTestId("finalize-sale");
  await expect(finalize).toBeEnabled();
  await finalize.click();
  await expect(page.getByRole("button", { name: "Yangi" })).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: "e2e/.screenshots/supermarket-receipt.png" });
  await closeReceipt(page);

  // Bazada: oxirgi chek aynan shu mahsulot 2 dona, jami 14 000, to'langan, ombor 10 − 2
  await login(page, "owner");
  await page.goto(appPath("dashboard"));
  const orders = (await api<{ orders: { id: string; totalAmount: string; status: string; paymentStatus: string }[] }>(page, "GET", "/api/sales/orders?isPos=true&limit=100")).json.orders;
  const detail = await Promise.all(orders.map((order) => api<{ order: { items: { productId: string; quantity: string }[]; totalAmount: string; status: string; paymentStatus: string } }>(page, "GET", `/api/sales/orders/${order.id}`)));
  const sale = detail.map((res) => res.json.order).find((order) => order.items.some((item) => item.productId === a.json.product.id))!;
  expect(sale, "chek bazada").toBeTruthy();
  expect(sale).toMatchObject({ totalAmount: "14000.00", status: "completed", paymentStatus: "paid" });
  expect(Number(sale.items.find((item) => item.productId === a.json.product.id)!.quantity)).toBe(2);
  const stock = (await api<{ stock: { warehouseId: string; quantity: string }[] }>(page, "GET", `/api/inventory/stock/products/${a.json.product.id}`)).json.stock;
  expect(Number(stock.find((row) => row.warehouseId === warehouseId)!.quantity), "ombor 10 − 2").toBe(8);
  const other = (await api<{ stock: { warehouseId: string; quantity: string }[] }>(page, "GET", `/api/inventory/stock/products/${b.json.product.id}`)).json.stock;
  expect(Number(other.find((row) => row.warehouseId === warehouseId)!.quantity), "SKU egasi (B) sotilmadi").toBe(10);
});
