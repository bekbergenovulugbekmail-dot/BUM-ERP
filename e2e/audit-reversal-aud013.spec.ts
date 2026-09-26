/**
 * AUDIT AUD-013 — HAQIQIY BRAUZERDA: to'langan xarajatni va ta'minotchiga to'lovni bekor qilish.
 * Tayyorlash brauzer sessiyasi orqali API bilan; bekor qilish esa foydalanuvchi yo'li (tugma → sabab → tasdiq).
 * Natija API orqali tekshiriladi: pul kassaga qaytdi, holat "bekor", ta'minotchi qarzi tiklandi.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { appPath, login } from "./_lib/accounts.ts";

test.describe.configure({ timeout: 240_000 });
test.use({ viewport: { width: 1500, height: 1000 } });

const ARTIFACTS = resolve(import.meta.dirname, ".artifacts/audit");
mkdirSync(ARTIFACTS, { recursive: true });

const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

async function api<T = unknown>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(path, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
      return { status: res.status, json: await res.json().catch(() => null) };
    },
    { method, path, body },
  ) as Promise<{ status: number; json: T }>;
}

async function mainCash(page: Page) {
  const list = (await api<{ cashAccounts: { id: string; isDefault: boolean; balance: string }[] }>(page, "GET", "/api/finance/cash-accounts")).json.cashAccounts;
  return list.find((row) => row.isDefault)!;
}

test("to'langan xarajat: 'Bekor qilish' → pul kassaga qaytadi, holat 'Bekor qilingan'", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("/finance"));
  const cash = await mainCash(page);
  const accountsList = (await api<{ accounts: { id: string; subtype: string | null }[] }>(page, "GET", "/api/finance/accounts")).json.accounts;
  const capital = accountsList.find((row) => row.subtype === "capital")!;
  expect((await api(page, "POST", "/api/finance/cash-transactions", { cashAccountId: cash.id, type: "in", amount: "50000", description: "E2E", counterAccountId: capital.id })).status).toBe(201);
  const created = await api<{ expense: { id: string; number: string } }>(page, "POST", "/api/finance/expenses", { category: "boshqa", description: `E2E xarajat ${Date.now()}`, amount: "12000", expenseDate: localToday() });
  expect(created.status).toBe(201);
  const expense = created.json.expense;
  expect((await api(page, "POST", `/api/finance/expenses/${expense.id}/status`, { status: "approved" })).status).toBe(200);
  expect((await api(page, "POST", `/api/finance/expenses/${expense.id}/status`, { status: "paid", cashAccountId: cash.id })).status).toBe(200);
  const before = Number((await mainCash(page)).balance);

  await page.getByRole("tab", { name: "Xarajatlar" }).first().click();
  await page.getByTestId(`expense-reverse-${expense.number}`).click();
  const dialog = page.getByTestId("reversal-dialog");
  await dialog.getByTestId("reversal-reason").fill("E2E: ikki marta kiritilgan");
  await dialog.getByTestId("reversal-confirm").click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole("row", { name: new RegExp(expense.number) })).toContainText("Bekor qilingan", { timeout: 15_000 });
  await page.screenshot({ path: resolve(ARTIFACTS, "aud013-expense-reversed.png") });
  expect(Number((await mainCash(page)).balance), "12 000 kassaga qaytdi").toBe(before + 12000);
});

test("ta'minotchiga to'lov: buyurtma oynasida 'Bekor qilish' → qarz tiklanadi, to'lov 'bekor'", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("/purchase"));
  const cash = await mainCash(page);
  const accountsList = (await api<{ accounts: { id: string; subtype: string | null }[] }>(page, "GET", "/api/finance/accounts")).json.accounts;
  const capital = accountsList.find((row) => row.subtype === "capital")!;
  await api(page, "POST", "/api/finance/cash-transactions", { cashAccountId: cash.id, type: "in", amount: "50000", description: "E2E", counterAccountId: capital.id });
  const stamp = Date.now();
  const supplier = await api<{ supplier: { id: string } }>(page, "POST", "/api/purchase/suppliers", { name: `E2E ta'minotchi ${stamp}`, code: `E2E-${stamp}` });
  expect(supplier.status).toBe(201);
  const warehouses = (await api<{ warehouses: { id: string }[] }>(page, "GET", "/api/inventory/warehouses")).json.warehouses;
  const products = (await api<{ products: { id: string; baseUnitId: string }[] }>(page, "GET", "/api/catalog/products?limit=5")).json.products;
  const order = await api<{ order: { id: string; number: string; items: { id: string }[] } }>(page, "POST", "/api/purchase/orders", {
    supplierId: supplier.json.supplier.id, warehouseId: warehouses[0]!.id, orderDate: localToday(),
    items: [{ productId: products[0]!.id, unitId: products[0]!.baseUnitId, orderedQty: "2", unitPrice: "3000" }],
  });
  expect(order.status, JSON.stringify(order.json)).toBe(201);
  const confirmed = await api<{ order: { items: { id: string }[] } }>(page, "POST", `/api/purchase/orders/${order.json.order.id}/confirm`, {});
  expect((await api(page, "POST", `/api/purchase/orders/${order.json.order.id}/receipts`, { items: [{ orderItemId: confirmed.json.order.items[0]!.id, receivedQty: "2" }] })).status).toBe(201);
  const paid = await api<{ payment: { id: string } }>(page, "POST", "/api/purchase/payments", { supplierId: supplier.json.supplier.id, orderId: order.json.order.id, amount: "6000", method: "cash", cashAccountId: cash.id });
  expect(paid.status, JSON.stringify(paid.json)).toBe(201);

  await page.reload();
  await page.getByText(order.json.order.number).first().click();
  const button = page.getByTestId(`supplier-payment-reverse-${paid.json.payment.id}`);
  await expect(button).toBeVisible({ timeout: 20_000 });
  await button.click();
  const dialog = page.getByTestId("reversal-dialog");
  await dialog.getByTestId("reversal-reason").fill("E2E: boshqa ta'minotchiga to'langan");
  await dialog.getByTestId("reversal-confirm").click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(button).toHaveCount(0, { timeout: 15_000 });
  await page.screenshot({ path: resolve(ARTIFACTS, "aud013-supplier-payment-reversed.png") });

  const detail = (await api<{ order: { paidAmount: string; payments: { id: string; status: string }[] } }>(page, "GET", `/api/purchase/orders/${order.json.order.id}`)).json.order;
  expect(detail.payments.find((row) => row.id === paid.json.payment.id)!.status).toBe("reversed");
  expect(Number(detail.paidAmount)).toBe(0);
  const supplierRow = (await api<{ supplier: { totalDebt: string } }>(page, "GET", `/api/purchase/suppliers/${supplier.json.supplier.id}`)).json.supplier;
  expect(Number(supplierRow.totalDebt), "qarz tiklandi").toBe(6000);
});
