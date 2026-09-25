/**
 * AUDIT — mijoz qarzi va to'lovni bekor qilish HAQIQIY BRAUZERDA.
 *
 * Tayyorlash (brauzer sessiyasi orqali API): yangi mijoz → sotuv (jo'natildi) → qisman to'lov.
 * Keyin foydalanuvchi yo'li: CRM → mijoz → "Akt" → davr, qatorlar, yakuniy qarz → Excel va PDF yuklab olinadi →
 * to'lov qatoridan "Bekor qilish" → bog'langan operatsiyalar va qarz oldin/keyin → sabab → tasdiq →
 * akt'dagi yakuniy qarz sotuv summasiga qaytadi. So'ng Sotuv → Qarzdorlik: "Istalgan sanaga" va "Oyma-oy".
 * Rasmlar: `e2e/.artifacts/audit/`.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { appPath, login } from "./_lib/accounts.ts";

test.describe.configure({ timeout: 300_000 });
test.use({ viewport: { width: 1500, height: 1000 } });

const ARTIFACTS = resolve(import.meta.dirname, ".artifacts/audit");
mkdirSync(ARTIFACTS, { recursive: true });

type Fixture = { customerId: string; customerName: string; customerCode: string; orderNumber: string; total: string; paid: string; paymentId: string };

async function prepare(page: Page): Promise<Fixture> {
  const name = `Audit mijoz ${Date.now()}`;
  const result = await page.evaluate(async (customerName) => {
    const get = async (path: string) => (await fetch(path)).json();
    const send = async (method: string, path: string, body?: unknown) => {
      const res = await fetch(path, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
      return { status: res.status, json: await res.json().catch(() => null) };
    };
    const customer = await send("POST", "/api/sales/customers", { name: customerName });
    if (customer.status !== 201) return { error: `mijoz: ${customer.status}` };
    const warehouses = (await get("/api/inventory/warehouses")).warehouses as { id: string }[];
    const products = (await get("/api/catalog/products?limit=50")).products as { id: string; name: string }[];
    const product = products.find((row) => /Nestle suv/.test(row.name)) ?? products[0];
    const order = await send("POST", "/api/sales/orders", {
      customerId: customer.json.customer.id, warehouseId: warehouses[0]!.id, orderDate: new Date().toISOString().slice(0, 10),
      items: [{ productId: product!.id, quantity: "4" }],
    });
    if (order.status !== 201) return { error: `buyurtma: ${order.status} ${JSON.stringify(order.json)}` };
    const orderId = order.json.order.id as string;
    if ((await send("POST", `/api/sales/orders/${orderId}/confirm`, {})).status !== 200) return { error: "tasdiqlash" };
    const shipped = await send("POST", `/api/sales/orders/${orderId}/ship`, {});
    if (shipped.status !== 200) return { error: `jo'natish: ${JSON.stringify(shipped.json)}` };
    const total = shipped.json.order.totalAmount as string;
    const paid = String(Math.floor(Number(total) / 2));
    const payment = await send("POST", "/api/sales/payments", { orderId, amount: paid, method: "cash" });
    if (payment.status !== 201) return { error: `to'lov: ${JSON.stringify(payment.json)}` };
    return {
      customerId: customer.json.customer.id, customerName, customerCode: customer.json.customer.code,
      orderNumber: order.json.order.number, total, paid, paymentId: payment.json.payment.id,
    };
  }, name);
  expect((result as { error?: string }).error ?? "", JSON.stringify(result)).toBe("");
  return result as Fixture;
}

/** Summa — ajratgich (probel, vergul) qaysi bo'lishidan qat'i nazar: "8 000" = "8,000" = 8000. */
const amount = (value: string | number) => {
  // Mingliklar orasida istalgan ajratgich (probel, vergul, nuqta, bo'linmas probel) — yoki hech narsa
  const digits = String(Math.round(Number(value))).replace(/\B(?=(\d{3})+(?!\d))/g, "[\\s,.\\u00a0\\u202f]?");
  return new RegExp(`(^|\\D)${digits}(\\D|$)`);
};

test("mijoz akti → Excel/PDF → to'lovni bekor qilish → qarz qaytadi; istalgan sanaga va oyma-oy", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("/crm"));
  const fixture = await prepare(page);
  const debtAfterPayment = Number(fixture.total) - Number(fixture.paid);

  // ── CRM → mijoz → Akt
  await page.getByRole("tab", { name: "Mijozlar" }).first().click();
  await page.getByPlaceholder(/qidir/i).first().fill(fixture.customerName);
  await page.getByTestId(`customer-statement-${fixture.customerCode}`).click();
  const dialog = page.getByTestId("customer-statement");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("statement-closing")).toHaveText(amount(debtAfterPayment), { timeout: 30_000 });
  const rows = dialog.getByTestId("statement-lines").locator("tbody tr[data-kind]");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText(fixture.orderNumber);
  await expect(rows.nth(0)).toContainText("Sotuv");
  await expect(rows.nth(1)).toContainText("To'lov");
  await expect(dialog.getByTestId("statement-mismatch")).toHaveCount(0);
  await page.screenshot({ path: resolve(ARTIFACTS, "akt.png") });

  // ── Excel va PDF — haqiqiy fayllar
  const [xlsx] = await Promise.all([page.waitForEvent("download"), dialog.getByTestId("statement-xlsx").click()]);
  expect(xlsx.suggestedFilename()).toMatch(/^akt-.*\.xlsx$/);
  const xlsxBytes = readFileSync((await xlsx.path())!);
  expect(xlsxBytes.subarray(0, 2).toString()).toBe("PK"); // xlsx = zip
  const [pdf] = await Promise.all([page.waitForEvent("download"), dialog.getByTestId("statement-pdf").click()]);
  expect(pdf.suggestedFilename()).toMatch(/^akt-.*\.pdf$/);
  const pdfBytes = readFileSync((await pdf.path())!);
  expect(pdfBytes.subarray(0, 5).toString()).toBe("%PDF-");
  await pdf.saveAs(resolve(ARTIFACTS, "akt.pdf"));

  // ── To'lovni bekor qilish: ko'rib chiqish → sabab → tasdiq
  await dialog.getByTestId(`reverse-${fixture.paymentId}`).click();
  const reversal = page.getByTestId("payment-reversal-dialog");
  await expect(reversal).toBeVisible();
  await expect(reversal.getByTestId("reversal-debt")).toHaveText(amount(fixture.total), { timeout: 30_000 });
  await expect(reversal.getByTestId("reversal-blockers")).toHaveCount(0);
  await expect(reversal.getByTestId("reversal-confirm")).toBeDisabled(); // sababsiz — yo'q
  await reversal.getByTestId("reversal-reason").fill("E2E: summa xato kiritilgan");
  await page.screenshot({ path: resolve(ARTIFACTS, "bekor-qilish.png") });
  await reversal.getByTestId("reversal-confirm").click();
  await expect(reversal).toBeHidden({ timeout: 30_000 });

  // Akt yangilandi: teskari yozuv qatori, yakuniy qarz = sotuv summasi, asl to'lov "bekor" belgisi bilan
  await expect(dialog.getByTestId("statement-closing")).toHaveText(amount(fixture.total), { timeout: 30_000 });
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(2)).toContainText("To'lov bekor qilindi");
  await expect(rows.nth(1)).toContainText("bekor");
  await page.screenshot({ path: resolve(ARTIFACTS, "akt-bekordan-keyin.png") });
  await page.keyboard.press("Escape");

  // ── Sotuv → Qarzdorlik: istalgan sanaga va oyma-oy
  await page.goto(appPath("/sales"));
  await page.getByRole("tab", { name: "Qarzdorlik" }).click();
  await page.getByTestId("receivables-mode-as_of").click();
  const asOf = page.getByTestId("receivables-as-of");
  await expect(asOf.getByText(fixture.customerName)).toBeVisible({ timeout: 30_000 });
  // 2-ustun — "shu sanaga qarz"
  await expect(asOf.locator("tr", { hasText: fixture.customerName }).locator("td").nth(1)).toHaveText(amount(fixture.total));
  await page.screenshot({ path: resolve(ARTIFACTS, "sanaga-qarz.png") });

  await page.getByTestId("receivables-mode-monthly").click();
  const monthly = page.getByTestId("receivables-monthly");
  // Oxirgi oy ustuni (joriy oy oxiri holati) — sotuv summasi
  const monthRow = monthly.locator("tr", { hasText: fixture.customerName });
  await expect(monthRow.locator("td").nth(-2)).toHaveText(amount(fixture.total), { timeout: 30_000 });
  await page.screenshot({ path: resolve(ARTIFACTS, "oyma-oy.png") });
});
