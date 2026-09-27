/**
 * TA'MINOTCHIGA QAYTARISH — HAQIQIY BRAUZERDA (2026-09-27):
 *   xarid (10 dona × 5 000) qabul qilingan → xarid oynasi → "Ta'minotchiga qaytarish" → 3 dona, sabab → "Qaytarish" tugmasi
 *   IKKI MARTA bosiladi → BAZADA: faqat bitta qaytarish (qaytarilgan 3), ombor 10 − 3, ta'minotchi qarzi 50 000 − 15 000.
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

test("xarid oynasidan ta'minotchiga qaytarish: ikki marta bosish — bitta qaytarish, ombor va qarz bir marta", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("dashboard"));
  const stamp = String(Date.now()).slice(-7);
  const units = (await api<{ units: { id: string; shortName: string }[] }>(page, "GET", "/api/catalog/units")).json.units;
  const piece = units.find((unit) => unit.shortName === "d")!.id;
  const warehouses = (await api<{ warehouses: { id: string; isDefault: boolean }[] }>(page, "GET", "/api/inventory/warehouses")).json.warehouses;
  const warehouseId = (warehouses.find((row) => row.isDefault) ?? warehouses[0]!).id;
  const product = await api<{ product: { id: string } }>(page, "POST", "/api/catalog/products", { name: `Qaytariladigan ${stamp}`, sku: `PR-${stamp}`, baseUnitId: piece, salesPrice: "8000", taxRate: "0" });
  expect(product.status, JSON.stringify(product.json)).toBe(201);
  const supplier = await api<{ supplier: { id: string } }>(page, "POST", "/api/purchase/suppliers", { name: `Ta'minotchi ${stamp}`, code: `SUP-${stamp}` });
  expect(supplier.status, JSON.stringify(supplier.json)).toBe(201);
  const created = await api<{ order: { id: string; number: string; items: { id: string }[] } }>(page, "POST", "/api/purchase/orders", {
    supplierId: supplier.json.supplier.id,
    warehouseId,
    orderDate: new Date().toISOString().slice(0, 10),
    items: [{ productId: product.json.product.id, unitId: piece, orderedQty: "10", unitPrice: "5000", taxRate: "0" }],
  });
  expect(created.status, JSON.stringify(created.json)).toBe(201);
  const order = created.json.order;
  expect((await api(page, "POST", `/api/purchase/orders/${order.id}/confirm`)).status).toBe(200);
  const received = await api(page, "POST", `/api/purchase/orders/${order.id}/receipts`, { items: [{ orderItemId: order.items[0]!.id, receivedQty: "10" }] });
  expect(received.status, JSON.stringify(received.json)).toBe(201);
  const stockOf = async () => Number((await api<{ stock: { warehouseId: string; quantity: string }[] }>(page, "GET", `/api/inventory/stock/products/${product.json.product.id}`)).json.stock.find((row) => row.warehouseId === warehouseId)?.quantity ?? 0);
  const debtOf = async () => Number((await api<{ supplier: { totalDebt: string } }>(page, "GET", `/api/purchase/suppliers/${supplier.json.supplier.id}`)).json.supplier.totalDebt);
  expect(await stockOf()).toBe(10);
  expect(await debtOf()).toBe(50_000);

  await page.goto(appPath("purchase"));
  await page.getByText(order.number).first().click();
  await page.getByTestId("purchase-return-open").click();
  const form = page.getByTestId("purchase-return-form");
  await expect(form).toBeVisible({ timeout: 15_000 });
  await form.getByLabel(new RegExp(`Qaytariladigan ${stamp} qaytariladigan miqdor`)).fill("3");
  await form.getByLabel(/Sabab/).fill("Muddati o'tgan");
  await page.screenshot({ path: "e2e/.screenshots/purchase-return-dialog.png" });
  const save = page.getByTestId("purchase-return-save");
  await save.dblclick();
  await expect(page.getByText("Ta'minotchiga qaytarildi").first()).toBeVisible({ timeout: 20_000 });

  expect(await stockOf(), "ombor 10 − 3 (bir marta)").toBe(7);
  expect(await debtOf(), "qarz 50 000 − 15 000 (bir marta)").toBe(35_000);
  const detail = (await api<{ order: { items: { returnedQty: string }[] } }>(page, "GET", `/api/purchase/orders/${order.id}`)).json.order;
  expect(Number(detail.items[0]!.returnedQty), "qaytarilgan jami 3").toBe(3);
});
