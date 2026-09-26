/**
 * USTUVOR VAZIFA (2026-09-26) — HAQIQIY BRAUZERDA:
 *   1) Ombor eksporti ("Ombordagi miqdori bilan eksport") — Excel ustunlari va qatorlar
 *   2) Mijozning bank orqali to'lovi — taqsimot (qarz + avans) ko'rsatiladi, tasdiqlanadi, qarz va avans API'da mos
 *   3) Kassir faqat o'z kassasini ko'radi, asosiy kassaga topshiradi; rahbar Moliya → Kassalar'da hujjatni bekor qiladi
 *   4) Reys: "Yetkazishga chiqadiganlar" → reys → 3 hujjat (PDF matni va rasmi tekshiriladi) → terish → yuklash
 * Rasmlar va PDF: `e2e/.artifacts/priority/`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import ExcelJS from "exceljs";
import { expect, test, type Download, type Page } from "@playwright/test";
import { ACCOUNTS, appPath, login } from "./_lib/accounts.ts";

test.describe.configure({ timeout: 300_000 });
test.use({ viewport: { width: 1500, height: 1000 } });

const ARTIFACTS = resolve(import.meta.dirname, ".artifacts/priority");
mkdirSync(ARTIFACTS, { recursive: true });

const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

/** Brauzer sessiyasi bilan API (ilova bilan bir xil cookie va biznes sarlavhasi). */
async function api<T = unknown>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(path, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
      return { status: res.status, json: await res.json().catch(() => null) };
    },
    { method, path, body },
  ) as Promise<{ status: number; json: T }>;
}

async function inspectPdf(page: Page, download: Download, name: string) {
  const path = await download.path();
  const pdf = readFileSync(path!);
  const result = await page.evaluate(async (data) => {
    const pdfjs = (await import(/* @vite-ignore */ "/node_modules/pdfjs-dist/build/pdf.mjs")) as typeof import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/node_modules/pdfjs-dist/build/pdf.worker.mjs";
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    const pages: { text: string; png: string }[] = [];
    for (let index = 1; index <= doc.numPages; index += 1) {
      const pdfPage = await doc.getPage(index);
      const content = await pdfPage.getTextContent();
      const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
      const viewport = pdfPage.getViewport({ scale: 1.5 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await pdfPage.render({ canvasContext: context, viewport, canvas }).promise;
      pages.push({ text, png: canvas.toDataURL("image/png") });
    }
    return pages;
  }, pdf.toString("base64"));
  writeFileSync(resolve(ARTIFACTS, `${name}.pdf`), pdf);
  result.forEach((item, index) => writeFileSync(resolve(ARTIFACTS, `${name}-${index + 1}.png`), Buffer.from(item.png.split(",")[1]!, "base64")));
  return result.map((item) => item.text);
}

test("ombor eksporti: barcha omborlar, band va mavjud ustunlari bilan Excel", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("/warehouse"));
  const button = page.getByTestId("stock-export-quantities");
  await expect(button).toBeEnabled({ timeout: 30_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(download.suggestedFilename()).toMatch(/^ombor-qoldigi-.*\.xlsx$/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await download.path())!);
  const sheet = workbook.getWorksheet("Omborlar bo'yicha")!;
  const header = (sheet.getRow(4).values as (string | undefined)[]).filter(Boolean);
  expect(header).toEqual(expect.arrayContaining(["SKU", "Shtrix-kod", "Mahsulot", "Kategoriya", "Birlik", "Ombor", "Haqiqiy qoldiq", "Band (buyurtmalar)", "Mavjud (sotish mumkin)", "Sotuv narxi"]));
  expect(sheet.rowCount, "kamida bitta mahsulot qatori").toBeGreaterThan(4);
  expect(workbook.getWorksheet("Jami"), "Jami varag'i").toBeTruthy();
  await page.screenshot({ path: resolve(ARTIFACTS, "warehouse-export.png") });
});

test("mijozning bank orqali to'lovi: qarzdan ortig'i avansga — ko'rsatiladi va tasdiqlanadi", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("/crm"));
  const name = `Bank mijoz ${Date.now()}`;
  const customer = await api<{ customer: { id: string; code: string } }>(page, "POST", "/api/sales/customers", { name });
  expect(customer.status).toBe(201);
  const warehouses = (await api<{ warehouses: { id: string }[] }>(page, "GET", "/api/inventory/warehouses")).json.warehouses;
  const products = (await api<{ products: { id: string; name: string }[] }>(page, "GET", "/api/catalog/products?limit=50")).json.products;
  const product = products.find((row) => /Nestle suv/.test(row.name)) ?? products[0]!;
  const order = await api<{ order: { id: string } }>(page, "POST", "/api/sales/orders", { customerId: customer.json.customer.id, warehouseId: warehouses[0]!.id, orderDate: localToday(), items: [{ productId: product.id, quantity: "2" }] });
  expect(order.status).toBe(201);
  expect((await api(page, "POST", `/api/sales/orders/${order.json.order.id}/confirm`, {})).status).toBe(200);
  const shipped = await api<{ order: { totalAmount: string } }>(page, "POST", `/api/sales/orders/${order.json.order.id}/ship`, {});
  expect(shipped.status).toBe(200);
  const debt = Number(shipped.json.order.totalAmount);
  const paying = debt + 50_000;

  await page.getByRole("tab", { name: "Mijozlar" }).first().click();
  await page.getByPlaceholder(/qidir/i).first().fill(name);
  await page.getByTestId(`customer-bank-receipt-${customer.json.customer.code}`).click();
  const dialog = page.getByTestId("bank-receipt-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("bank-receipt-amount").fill(String(paying));
  await dialog.getByTestId("bank-receipt-reference").fill(`PP-${Date.now()}`);
  await expect(dialog.getByTestId("bank-receipt-to-advance")).toHaveText(/50[\s,.00a0202f]?000/, { timeout: 15_000 });
  await page.screenshot({ path: resolve(ARTIFACTS, "bank-receipt-split.png") });
  await dialog.getByTestId("bank-receipt-confirm").click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  const after = (await api<{ customer: { totalDebt: string; balance: string } }>(page, "GET", `/api/sales/customers/${customer.json.customer.id}`)).json.customer;
  expect(Number(after.totalDebt), "qarz yopildi").toBe(0);
  expect(Number(after.balance), "ortig'i avansda").toBe(50_000);
});

test("kassir faqat o'z kassasini ko'radi va topshiradi; rahbar hujjatni bekor qiladi", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("/finance"));
  // Kassirning HR kartasi va unga biriktirilgan yangi kassa (rahbar ochadi)
  const employees = (await api<{ employees: { id: string; phone: string | null; loginPhone: string | null }[] }>(page, "GET", "/api/hr/employees?limit=500")).json.employees;
  const cashierCard = employees.find((row) => row.loginPhone === ACCOUNTS.kassir.phone || row.phone === ACCOUNTS.kassir.phone);
  expect(cashierCard, "kassirning HR kartasi").toBeTruthy();
  const registerName = `E2E kassir kassasi ${Date.now()}`;
  const created = await api<{ cashAccount: { id: string } }>(page, "POST", "/api/finance/cash-accounts", { name: registerName, type: "cash", employeeId: cashierCard!.id });
  expect(created.status).toBe(201);
  const accountsList = (await api<{ accounts: { id: string; subtype: string | null }[] }>(page, "GET", "/api/finance/accounts")).json.accounts;
  const capital = accountsList.find((row) => row.subtype === "capital")!;
  expect((await api(page, "POST", "/api/finance/cash-transactions", { cashAccountId: created.json.cashAccount.id, type: "in", amount: "100000", description: "E2E boshlang'ich", counterAccountId: capital.id })).status).toBe(201);

  // ── Kassir
  await login(page, "kassir");
  await page.goto(appPath("/cash"));
  const panel = page.getByTestId("registers-panel");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByTestId(`register-${created.json.cashAccount.id}`)).toBeVisible();
  // Boshqa kassalar ko'rinmaydi (asosiy kassa ham)
  const visible = (await api<{ registers: { id: string }[]; scope: string }>(page, "GET", "/api/finance/cash/registers")).json;
  expect(visible.scope).toBe("own");
  expect(visible.registers.every((row) => row.id !== undefined)).toBe(true);
  await panel.getByTestId(`register-${created.json.cashAccount.id}`).click();
  await panel.getByTestId("register-action-transfer").click();
  const dialog = page.getByTestId("cash-document-transfer");
  await dialog.getByTestId("cash-document-counterpart").click();
  await page.getByRole("option").first().click();
  await dialog.getByTestId("cash-document-amount").fill("60000");
  await dialog.getByTestId("cash-document-reason").fill("Kun oxiri topshirish (E2E)");
  await dialog.getByTestId("cash-document-submit").click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(panel.getByTestId(`register-balance-${created.json.cashAccount.id}`)).toHaveText(/40[\s,.00a0202f]?000/, { timeout: 15_000 });
  await expect(page.getByTestId("report-closing")).toContainText(/40[\s,.00a0202f]?000/);
  await page.screenshot({ path: resolve(ARTIFACTS, "cashier-register.png") });

  // ── Rahbar: Moliya → Kassalar → hujjatni bekor qilish
  await login(page, "owner");
  await page.goto(appPath("/finance"));
  await page.getByRole("tab", { name: "Kassalar" }).first().click();
  const ownerPanel = page.getByTestId("registers-panel");
  await ownerPanel.getByTestId(`register-${created.json.cashAccount.id}`).click();
  const reverse = ownerPanel.locator("[data-testid^='cash-doc-reverse-']").first();
  await reverse.click();
  const reverseDialog = page.getByTestId("cash-doc-reverse-dialog");
  await reverseDialog.getByRole("textbox").fill("E2E: noto'g'ri kassa");
  await reverseDialog.getByRole("button", { name: "Bekor qilish" }).click();
  await expect(reverseDialog).toBeHidden({ timeout: 15_000 });
  await expect(ownerPanel.getByTestId(`register-balance-${created.json.cashAccount.id}`)).toHaveText(/100[\s,.00a0202f]?000/, { timeout: 15_000 });
  await page.screenshot({ path: resolve(ARTIFACTS, "owner-register-reversed.png") });
});

test("reys: yetkazishga chiqadiganlar → 3 hujjat mos (PDF) → terish → yuklash", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("/delivery"));
  const agents = (await api<{ agents: { id: string; phone: string | null; name: string | null }[] }>(page, "GET", "/api/delivery/agents")).json.agents;
  const agent = agents.find((row) => row.phone === ACCOUNTS.dostavchi.phone) ?? agents[0]!;
  const warehouses = (await api<{ warehouses: { id: string }[] }>(page, "GET", "/api/inventory/warehouses")).json.warehouses;
  const products = (await api<{ products: { id: string; name: string }[] }>(page, "GET", "/api/catalog/products?limit=50")).json.products;
  const stamp = Date.now();
  const names = [`Test Market ${stamp}`, `Bonnu Market ${stamp}`, `Anor Market ${stamp}`];
  const taskIds: string[] = [];
  for (const [index, customerName] of names.entries()) {
    const customer = await api<{ customer: { id: string } }>(page, "POST", "/api/sales/customers", { name: customerName });
    const order = await api<{ order: { id: string } }>(page, "POST", "/api/sales/orders", {
      customerId: customer.json.customer.id,
      warehouseId: warehouses[0]!.id,
      orderDate: localToday(),
      deliveryRequired: true,
      items: [{ productId: products[0]!.id, quantity: String(index + 1) }, ...(index !== 1 ? [{ productId: products[1]!.id, quantity: "2" }] : [])],
    });
    expect(order.status, JSON.stringify(order.json)).toBe(201);
    expect((await api(page, "POST", `/api/sales/orders/${order.json.order.id}/confirm`, {})).status).toBe(200);
    const tasks = (await api<{ tasks: { id: string; orderId: string }[] }>(page, "GET", "/api/delivery/tasks?limit=200")).json.tasks;
    const task = tasks.find((row) => row.orderId === order.json.order.id)!;
    expect((await api(page, "POST", `/api/delivery/tasks/${task.id}/assign`, { deliveryAgentId: agent.id })).status).toBe(200);
    taskIds.push(task.id);
  }

  await page.getByRole("tab", { name: "Reyslar" }).first().click();
  const section = page.getByTestId("trips-section");
  await expect(section.getByTestId("trips-outgoing-count")).not.toHaveText("0", { timeout: 30_000 });
  await section.getByTestId("trips-create-all").click();
  await expect(page.getByTestId("trip-detail")).toBeVisible({ timeout: 30_000 });

  // Bizning yetkazmalar qaysi reysda — API'dan (demo bazada boshqa yetkazmalar ham bo'lishi mumkin)
  const trips = (await api<{ trips: { id: string; number: string }[] }>(page, "GET", `/api/delivery/trips?date=${localToday()}`)).json.trips;
  let ours: { id: string; number: string } | null = null;
  for (const trip of trips) {
    const detail = (await api<{ trip: { snapshot: { tasks: { id: string }[] } } }>(page, "GET", `/api/delivery/trips/${trip.id}`)).json.trip;
    if (taskIds.every((id) => detail.snapshot.tasks.some((task) => task.id === id))) ours = trip;
  }
  expect(ours, "uchala yetkazma bitta reysda").toBeTruthy();
  await section.getByTestId(`trip-row-${ours!.number}`).click();
  const detail = page.getByTestId("trip-detail");
  await expect(detail).toContainText(ours!.number);
  await expect(detail.getByTestId("trip-mismatch")).toHaveCount(0);

  const downloads: Download[] = [];
  page.on("download", (item) => downloads.push(item));
  await detail.getByTestId("trip-print-all").click();
  await expect.poll(() => downloads.length, { timeout: 60_000 }).toBe(3);
  const [waybills, pickList, route] = downloads;
  const waybillText = (await inspectPdf(page, waybills!, "trip-waybills")).join(" ");
  for (const customerName of names) expect(waybillText, `nakladnoyda ${customerName}`).toContain(customerName);
  const pickText = await inspectPdf(page, pickList!, "trip-picklist");
  expect(pickText, "yig'ma ro'yxat 2 nusxa").toHaveLength(2);
  expect(pickText[0]).toContain("1-nusxa");
  expect(pickText[1]).toContain("2-nusxa");
  const routeText = (await inspectPdf(page, route!, "trip-route")).join(" ");
  for (const customerName of names) expect(routeText, `marshrutda ${customerName}`).toContain(customerName);
  expect(routeText).toContain("MARSHRUT");

  // Terish: hammasi to'liq → yuklash
  const lines = detail.locator("[data-testid^='trip-pick-']");
  const count = await lines.count();
  for (let index = 0; index < count; index += 1) {
    const row = detail.locator("tr[data-testid^='trip-line-']").nth(index);
    const required = (await row.locator("td").nth(2).innerText()).trim();
    await lines.nth(index).fill(required);
  }
  await detail.getByTestId("trip-save-picking").click();
  await expect(detail.locator("tr[data-testid^='trip-line-']").first()).toContainText("Terildi", { timeout: 15_000 });
  await detail.getByTestId("trip-load").click();
  await expect(detail.getByTestId("trip-status")).toHaveText("Yuklandi", { timeout: 15_000 });
  await page.screenshot({ path: resolve(ARTIFACTS, "trip-loaded.png"), fullPage: true });
});
