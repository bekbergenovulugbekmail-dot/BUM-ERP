/**
 * REAL BIZNES QABUL TESTI — ikki biznes ketma-ket, uchidan-uchigacha.
 *
 *   BUSINESS 01 — MINI MARKET (`TEST-01-MINIMARKET`)
 *   BUSINESS 02 — SUPERMARKET (`TEST-02-SUPERMARKET`)
 *
 * Har bir qadam FAQAT frontend javobiga emas, BAZA holatiga ham qarab tekshiriladi:
 * ombor qoldig'i, mijoz qarzi, kassa qoldig'i, buxgalteriya jurnali (debet = kredit) va audit yozuvlari.
 *
 * Ikkala kompaniya BIR VAQTDA yashaydi (baza test boshida bir marta tozalanadi) — shuning uchun
 * oxirida tenant izolyatsiyasi haqiqiy ikki tenant bilan tekshiriladi.
 *
 * Productionga aloqasi yo'q: `resetDatabase` faqat `_test` bazada ishlaydi (nomi tekshiriladi).
 */
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { deliveryTasks } from "../src/db/schema/delivery.js";
import { cashAccounts, journalEntries, journalLines } from "../src/db/schema/finance.js";
import { stockLevels, stockMovements, warehouses } from "../src/db/schema/inventory.js";
import { auditLogs } from "../src/db/schema/platform.js";
import { customerPayments, customers, salesOrders } from "../src/db/schema/sales.js";
import { purchaseOrders, suppliers } from "../src/db/schema/purchase.js";
import { expenses as expensesTable } from "../src/db/schema/finance.js";
import { buildServer } from "../src/server.js";
import { resetUnits } from "./delivery-setup.js";
import { addEmployee, createCompany, resetDatabase, signedIn, uniquePhone } from "./helpers.js";

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

let app: FastifyInstance;
let adminCookie: string;
let piece: string;

const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

const today = () => new Date().toISOString().slice(0, 10);
const money = (value: string | number) => Number(value);

/** Bitta test biznesi: kompaniya, ombor, kassa hisoblari va xodimlar. */
type Business = {
  name: string;
  companyId: string;
  ownerCookie: string;
  warehouseId: string;
  cashAccountId: string;
  bankAccountId: string;
  managerCookie: string;
  cashierCookie: string;
  products: Record<string, string>;
  suppliers: Record<string, string>;
  customers: Record<string, string>;
  shiftId: string;
};

async function setupBusiness(name: string, managerRole: string): Promise<Business> {
  const company = await createCompany(app, adminCookie, { name });
  const warehouseId = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;

  // Hisoblar rejasi va kassa/bank hisoblari
  const setup = await call(company.ownerCookie, "POST", "/api/finance/setup");
  expect(setup.statusCode, setup.body).toBe(200);
  const accounts = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));

  const manager = await addEmployee(app, company, managerRole);
  const cashier = await addEmployee(app, company, "Kassir");

  const shift = await call(cashier.cookie, "POST", "/api/sales/pos/shifts", { warehouseId, openingCash: "0" });
  expect(shift.statusCode, shift.body).toBe(201);

  // Real biznesdagidek: ega kassaga va bankka boshlang'ich mablag' qo'yadi (ustav kapitali)
  const chart = (await call(company.ownerCookie, "GET", "/api/finance/accounts")).json().accounts as
    { id: string; code: string }[];
  const capitalId = chart.find((row) => row.code === "3000")!.id;
  const cashId = accounts.find((row) => row.type === "cash")!.id;
  const bankId = accounts.find((row) => row.type === "bank")!.id;
  for (const [accountId, amount] of [[cashId, "5000000"], [bankId, "20000000"]] as const) {
    const deposit = await call(company.ownerCookie, "POST", "/api/finance/cash-transactions", {
      cashAccountId: accountId,
      type: "in",
      amount,
      description: "Boshlang'ich mablag'",
      counterAccountId: capitalId,
      txDate: today(),
    });
    expect(deposit.statusCode, deposit.body).toBe(201);
  }

  return {
    name,
    companyId: company.companyId,
    ownerCookie: company.ownerCookie,
    warehouseId,
    cashAccountId: accounts.find((row) => row.type === "cash")!.id,
    bankAccountId: accounts.find((row) => row.type === "bank")!.id,
    managerCookie: manager.cookie,
    cashierCookie: cashier.cookie,
    products: {},
    suppliers: {},
    customers: {},
    shiftId: shift.json().shift.id as string,
  };
}

// ─── Baza holatini o'qish ────────────────────────────────────────────────────

async function stockOf(business: Business, productId: string): Promise<number> {
  const [row] = await db
    .select({ quantity: stockLevels.quantity, reserved: stockLevels.reservedQty })
    .from(stockLevels)
    .where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, business.warehouseId)));
  if (!row) return 0;
  // Invariant: qoldiq manfiy emas va band qilingan qoldiqdan oshmaydi
  expect(money(row.quantity), "qoldiq manfiy").toBeGreaterThanOrEqual(0);
  expect(money(row.reserved), "reserved_qty > quantity").toBeLessThanOrEqual(money(row.quantity));
  return money(row.quantity);
}

async function debtOf(customerId: string): Promise<number> {
  const [row] = await db.select({ debt: customers.totalDebt }).from(customers).where(eq(customers.id, customerId));
  return money(row!.debt);
}

/** Buxgalteriya jurnali: debet va kredit yig'indisi hamda yozuvlar soni. */
async function journalOf(companyId: string) {
  const [row] = await db
    .select({
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)::numeric(18,2)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)::numeric(18,2)`,
      entries: sql<number>`(select count(*)::int from ${journalEntries} je where je.company_id = ${companyId})`,
    })
    .from(journalLines)
    .where(eq(journalLines.companyId, companyId));
  return row!;
}

/** Har bir qadamdan keyin: debet = kredit va har bir yozuv ichida ham balans. */
async function expectBalanced(business: Business) {
  const totals = await journalOf(business.companyId);
  expect(totals.debit, `${business.name}: debet ≠ kredit`).toBe(totals.credit);

  const unbalanced = await db
    .select({ entryId: journalLines.entryId })
    .from(journalLines)
    .where(eq(journalLines.companyId, business.companyId))
    .groupBy(journalLines.entryId)
    .having(sql`sum(${journalLines.debit}) <> sum(${journalLines.credit})`);
  expect(unbalanced, `${business.name}: balanslanmagan jurnal yozuvi`).toHaveLength(0);
}

const auditCount = async (companyId: string, action: string) => {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(and(eq(auditLogs.companyId, companyId), eq(auditLogs.action, action)));
  return row!.n;
};

// ─── Biznes amallari (API orqali) ────────────────────────────────────────────

async function addProduct(business: Business, name: string, sku: string, salesPrice: string, extra: object = {}) {
  const res = await call(business.ownerCookie, "POST", "/api/catalog/products", {
    name,
    sku,
    baseUnitId: piece,
    salesPrice,
    taxRate: "0",
    ...extra,
  });
  expect(res.statusCode, `${name}: ${res.body}`).toBe(201);
  const id = res.json().product.id as string;
  business.products[sku] = id;
  return id;
}

async function addSupplier(business: Business, name: string) {
  const res = await call(business.ownerCookie, "POST", "/api/purchase/suppliers", { name, phone: uniquePhone("94") });
  expect(res.statusCode, res.body).toBe(201);
  const id = res.json().supplier.id as string;
  business.suppliers[name] = id;
  return id;
}

async function addCustomer(business: Business, name: string, extra: object = {}) {
  const res = await call(business.ownerCookie, "POST", "/api/sales/customers", { name, phone: uniquePhone("95"), ...extra });
  expect(res.statusCode, res.body).toBe(201);
  const id = res.json().customer.id as string;
  business.customers[name] = id;
  return id;
}

/** To'liq xarid oqimi: hujjat → tasdiq → qabul (ombor kirimi). */
async function purchase(
  business: Business,
  supplierId: string,
  lines: { productId: string; quantity: string; unitPrice: string }[],
  cookie = business.ownerCookie,
) {
  const created = await call(cookie, "POST", "/api/purchase/orders", {
    supplierId,
    warehouseId: business.warehouseId,
    orderDate: today(),
    items: lines.map((line) => ({ productId: line.productId, unitId: piece, orderedQty: line.quantity, unitPrice: line.unitPrice })),
  });
  expect(created.statusCode, created.body).toBe(201);
  const order = created.json().order as { id: string; items: { id: string; productId: string }[] };

  const confirmed = await call(cookie, "POST", `/api/purchase/orders/${order.id}/confirm`);
  expect(confirmed.statusCode, confirmed.body).toBe(200);

  const receipt = await call(cookie, "POST", `/api/purchase/orders/${order.id}/receipts`, {
    receiptDate: today(),
    items: order.items.map((item) => ({
      orderItemId: item.id,
      receivedQty: lines.find((line) => line.productId === item.productId)!.quantity,
    })),
  });
  expect(receipt.statusCode, receipt.body).toBe(201);
  return order.id;
}

/** Kassa cheki. */
const sell = (business: Business, payload: object, cookie = business.cashierCookie) =>
  call(cookie, "POST", "/api/sales/pos/sales", { shiftId: business.shiftId, ...payload });

const orderOf = async (business: Business, orderId: string) =>
  (await call(business.ownerCookie, "GET", `/api/sales/orders/${orderId}`)).json().order;

const tasksOf = (orderId: string) => db.select().from(deliveryTasks).where(eq(deliveryTasks.orderId, orderId));

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
  await resetDatabase();
  await resetUnits();
  adminCookie = (await signedIn(app, { isPlatformAdmin: true })).cookie;
  piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
}, 120_000);

afterAll(async () => {
  await app.close();
  await closeDb();
});

// ═══════════════════════════════════════════════════════════════════════════
// BUSINESS 01 — MINI MARKET
// ═══════════════════════════════════════════════════════════════════════════

let mini: Business;

describe("BUSINESS 01 — MINI MARKET (TEST-01-MINIMARKET)", () => {
  it("1. Tenant: kompaniya ochiladi, ega kiradi, kontekst to'g'ri", async () => {
    mini = await setupBusiness("TEST-01-MINIMARKET", "Savdo menejeri");

    const me = await call(mini.ownerCookie, "GET", "/api/company");
    expect(me.statusCode, me.body).toBe(200);
    expect(me.json().company).toMatchObject({ id: mini.companyId, name: "TEST-01-MINIMARKET" });
    expect(me.json().permissions).toContain("sales.create");
  });

  it("2. Rollar: menejer ishlaydi, kassir tannarx va sozlamalarga kira olmaydi", async () => {
    // Menejer: mahsulot va savdo bo'yicha ishlaydi
    expect((await call(mini.managerCookie, "GET", "/api/catalog/products")).statusCode).toBe(200);
    expect((await call(mini.managerCookie, "GET", "/api/sales/orders")).statusCode).toBe(200);

    // Kassir: kassa va sotuv — ha; tannarx, narx tavsiyasi, xarid va rollar — yo'q
    expect((await call(mini.cashierCookie, "GET", "/api/catalog/products")).statusCode).toBe(200);
    expect((await call(mini.cashierCookie, "GET", "/api/catalog/products/costs")).statusCode).toBe(403);
    expect((await call(mini.cashierCookie, "GET", "/api/purchase/orders")).statusCode).toBe(403);
    expect((await call(mini.cashierCookie, "GET", "/api/company/employees")).statusCode).toBe(403);
    expect((await call(mini.cashierCookie, "GET", "/api/finance/expenses")).statusCode).toBe(403);
    expect((await call(mini.cashierCookie, "GET", "/api/finance/journal")).statusCode).toBe(403);
  });

  it("3. Mahsulotlar: 10 ta mahsulot, SKU va shtrix-kod, qidiruv, faolsizlantirish", async () => {
    const category = await call(mini.ownerCookie, "POST", "/api/catalog/categories", { name: "Oziq-ovqat" });
    expect(category.statusCode, category.body).toBe(201);
    const categoryId = category.json().category.id as string;

    const catalog: [string, string, string][] = [
      ["Non", "MM-NON", "5000"],
      ["Sut 1L", "MM-SUT", "12000"],
      ["Shakar 1kg", "MM-SHAKAR", "15000"],
      ["Choy 100g", "MM-CHOY", "18000"],
      ["Coca-Cola 1L", "MM-COLA", "14000"],
      ["Suv 1.5L", "MM-SUV", "4000"],
      ["Pechenye", "MM-PECH", "9000"],
      ["Yog' 1L", "MM-YOG", "28000"],
      ["Makaron", "MM-MAK", "11000"],
      ["Shokolad", "MM-SHOK", "16000"],
    ];
    for (const [name, sku, price] of catalog) {
      await addProduct(mini, name, sku, price, { categoryId, barcode: `200${sku.slice(-4)}` });
    }
    expect(Object.keys(mini.products)).toHaveLength(10);

    // Qidiruv va shtrix-kod bo'yicha topish
    const found = await call(mini.ownerCookie, "GET", "/api/catalog/products?search=Coca");
    expect(found.json().products.map((row: { sku: string }) => row.sku)).toEqual(["MM-COLA"]);
    const barcode = await call(mini.cashierCookie, "GET", "/api/catalog/products/by-barcode/200COLA");
    expect(barcode.statusCode, barcode.body).toBe(200);
    expect(barcode.json().product.id).toBe(mini.products["MM-COLA"]);

    // Faolsizlantirish ro'yxatdan chiqaradi, qayta yoqilsa qaytadi
    const shokolad = mini.products["MM-SHOK"]!;
    expect((await call(mini.ownerCookie, "DELETE", `/api/catalog/products/${shokolad}`)).statusCode).toBe(200);
    const active = (await call(mini.ownerCookie, "GET", "/api/catalog/products?isActive=true")).json().products;
    expect(active.some((row: { id: string }) => row.id === shokolad)).toBe(false);
    expect((await call(mini.ownerCookie, "PATCH", `/api/catalog/products/${shokolad}`, { isActive: true })).statusCode).toBe(200);
  });

  it("4. Xarid: ikki ta'minotchidan qabul — ombor oshadi, qarz yoziladi, jurnal balanslangan", async () => {
    const supplierA = await addSupplier(mini, "TEST-SUPPLIER-A");
    const supplierB = await addSupplier(mini, "TEST-SUPPLIER-B");

    await purchase(mini, supplierA, [
      { productId: mini.products["MM-NON"]!, quantity: "100", unitPrice: "5000" },
      { productId: mini.products["MM-SUT"]!, quantity: "50", unitPrice: "8000" },
    ]);
    await purchase(mini, supplierB, [
      { productId: mini.products["MM-SHAKAR"]!, quantity: "100", unitPrice: "12000" },
      { productId: mini.products["MM-COLA"]!, quantity: "60", unitPrice: "9000" },
      { productId: mini.products["MM-SUV"]!, quantity: "80", unitPrice: "2500" },
    ]);

    expect(await stockOf(mini, mini.products["MM-NON"]!)).toBe(100);
    expect(await stockOf(mini, mini.products["MM-SUT"]!)).toBe(50);
    expect(await stockOf(mini, mini.products["MM-SHAKAR"]!)).toBe(100);
    expect(await stockOf(mini, mini.products["MM-COLA"]!)).toBe(60);

    // Ta'minotchi qarzi = qabul qilingan tovar qiymati (100×5000 + 50×8000 = 900 000)
    const [a] = await db.select({ debt: suppliers.totalDebt }).from(suppliers).where(eq(suppliers.id, supplierA));
    expect(money(a!.debt)).toBe(900_000);
    const [b] = await db.select({ debt: suppliers.totalDebt }).from(suppliers).where(eq(suppliers.id, supplierB));
    expect(money(b!.debt)).toBe(100 * 12_000 + 60 * 9_000 + 80 * 2_500);

    await expectBalanced(mini);

    // Ta'minotchiga to'lov: qarz kamayadi
    const paid = await call(mini.ownerCookie, "POST", "/api/purchase/payments", {
      supplierId: supplierA,
      amount: "400000",
      method: "cash",
      paymentDate: today(),
    });
    expect(paid.statusCode, paid.body).toBe(201);
    const [afterPay] = await db.select({ debt: suppliers.totalDebt }).from(suppliers).where(eq(suppliers.id, supplierA));
    expect(money(afterPay!.debt)).toBe(500_000);
    await expectBalanced(mini);
  });

  it("5. Ombor: harakatlar tarixi yoziladi, invariantlar saqlanadi", async () => {
    const movements = await db
      .select({ type: stockMovements.type, quantity: stockMovements.quantity })
      .from(stockMovements)
      .where(and(eq(stockMovements.companyId, mini.companyId), eq(stockMovements.productId, mini.products["MM-NON"]!)));
    expect(movements.length).toBeGreaterThan(0);
    expect(movements.every((row) => money(row.quantity) !== 0)).toBe(true);

    const stockApi = await call(mini.ownerCookie, "GET", `/api/inventory/stock?warehouseId=${mini.warehouseId}`);
    expect(stockApi.statusCode, stockApi.body).toBe(200);
    const nonRow = stockApi.json().stock.find((row: { productId: string }) => row.productId === mini.products["MM-NON"]);
    expect(money(nonRow.quantity)).toBe(100);
  });

  it("6. Kassa cheki: yakunlangan, qo'lma-qo'l, yetkazma YARATILMAYDI, qoldiq kamayadi", async () => {
    const before = await stockOf(mini, mini.products["MM-NON"]!);
    const sale = await sell(mini, {
      items: [
        { productId: mini.products["MM-NON"]!, quantity: "2" },
        { productId: mini.products["MM-SUT"]!, quantity: "1" },
        { productId: mini.products["MM-COLA"]!, quantity: "1" },
      ],
      paymentMethod: "cash",
      amountPaid: "36000",
    });
    expect(sale.statusCode, sale.body).toBe(201);
    const order = sale.json().order;
    expect(order).toMatchObject({
      status: "completed",
      paymentStatus: "paid",
      source: "pos",
      fulfillmentMethod: "counter",
      isPos: true,
    });
    expect(money(order.totalAmount)).toBe(2 * 5000 + 12000 + 14000);
    expect(await tasksOf(order.id), "kassa chekiga yetkazma ochilmaydi").toHaveLength(0);
    expect(order.deliveryStatus).toBeNull();

    expect(await stockOf(mini, mini.products["MM-NON"]!)).toBe(before - 2);
    await expectBalanced(mini);
  });

  it("7. Aralash to'lov: naqd + karta bitta chekda, taqsimot to'liq", async () => {
    const sale = await sell(mini, {
      items: [{ productId: mini.products["MM-SHAKAR"]!, quantity: "2" }],
      payments: [
        { method: "cash", amount: "20000" },
        { method: "card", amount: "10000" },
      ],
    });
    expect(sale.statusCode, sale.body).toBe(201);
    const order = sale.json().order;
    expect(order).toMatchObject({ status: "completed", paymentStatus: "paid" });
    expect(money(order.totalAmount)).toBe(30_000);
    expect(money(order.paidAmount)).toBe(30_000);

    const payments = await db
      .select({ amount: customerPayments.amount, method: customerPayments.method })
      .from(customerPayments)
      .where(eq(customerPayments.orderId, order.id));
    const total = payments.reduce((sum, row) => sum + money(row.amount), 0);
    expect(total, "to'lov taqsimoti chek summasiga teng").toBe(30_000);
    await expectBalanced(mini);
  });

  it("8. Nasiya sotuv va qarzni yopish: 100 000 → 50 000 → 0", async () => {
    const customerId = await addCustomer(mini, "TEST CUSTOMER 01", { creditLimit: "1000000" });

    // 100 000 so'mlik nasiya chek (10 dona shakar × 15 000 dan 100 000 lik qism to'lanmaydi)
    const sale = await sell(mini, {
      customerId,
      items: [{ productId: mini.products["MM-SHAKAR"]!, quantity: "10" }],
      paymentMethod: "cash",
      amountPaid: "50000",
      onCredit: true,
    });
    expect(sale.statusCode, sale.body).toBe(201);
    const order = sale.json().order;
    expect(money(order.totalAmount)).toBe(150_000);
    expect(money(order.paidAmount)).toBe(50_000);
    expect(order.paymentStatus).toBe("partial");
    expect(await debtOf(customerId)).toBe(100_000);

    // Qarzning yarmi
    const first = await call(mini.ownerCookie, "POST", "/api/sales/payments", {
      customerId,
      amount: "50000",
      method: "cash",
      paymentDate: today(),
    });
    expect(first.statusCode, first.body).toBe(201);
    expect(await debtOf(customerId)).toBe(50_000);

    // Qolgani
    const second = await call(mini.ownerCookie, "POST", "/api/sales/payments", {
      customerId,
      amount: "50000",
      method: "cash",
      paymentDate: today(),
    });
    expect(second.statusCode, second.body).toBe(201);
    expect(await debtOf(customerId)).toBe(0);

    // UI ro'yxati ham shuni ko'rsatadi
    const list = (await call(mini.ownerCookie, "GET", "/api/sales/customers")).json().customers;
    expect(money(list.find((row: { id: string }) => row.id === customerId).totalDebt)).toBe(0);
    await expectBalanced(mini);
  });

  it("9. Qaytarish: qoldiq qaytadi, takroriy qaytarish rad etiladi", async () => {
    const before = await stockOf(mini, mini.products["MM-COLA"]!);
    const sale = await sell(mini, {
      items: [{ productId: mini.products["MM-COLA"]!, quantity: "1" }],
      paymentMethod: "cash",
      amountPaid: "14000",
    });
    expect(sale.statusCode, sale.body).toBe(201);
    const orderId = sale.json().order.id as string;
    expect(await stockOf(mini, mini.products["MM-COLA"]!)).toBe(before - 1);

    const returned = await call(mini.ownerCookie, "POST", `/api/sales/orders/${orderId}/return`, {
      reason: "Mijoz qaytardi",
      refund: true,
      method: "cash",
    });
    expect(returned.statusCode, returned.body).toBe(200);
    expect(await stockOf(mini, mini.products["MM-COLA"]!)).toBe(before);
    expect((await orderOf(mini, orderId)).status).toBe("returned");

    // Ikkinchi marta qaytarib bo'lmaydi — qoldiq ikki marta oshmaydi
    const again = await call(mini.ownerCookie, "POST", `/api/sales/orders/${orderId}/return`, { refund: false });
    expect(again.statusCode).toBeGreaterThanOrEqual(400);
    expect(await stockOf(mini, mini.products["MM-COLA"]!)).toBe(before);
    await expectBalanced(mini);
  });

  it("10. Narx tavsiyalari: ma'lumot beradi, narxni O'ZGARTIRMAYDI", async () => {
    const productId = mini.products["MM-NON"]!;
    const before = (await call(mini.ownerCookie, "GET", `/api/catalog/products/${productId}`)).json().product;

    const suggestion = await call(mini.ownerCookie, "GET", `/api/catalog/products/${productId}/price-suggestions`);
    expect(suggestion.statusCode, suggestion.body).toBe(200);
    const body = suggestion.json().suggestion ?? suggestion.json();
    expect(money(body.lastPurchase.price), "oxirgi xarid narxi").toBe(5000);
    expect(body.lastPurchase.supplierName).toBe("TEST-SUPPLIER-A");
    expect(money(body.avgPurchasePrice)).toBe(5000);
    expect(money(body.currentSalesPrice)).toBe(5000);

    const after = (await call(mini.ownerCookie, "GET", `/api/catalog/products/${productId}`)).json().product;
    expect(after.salesPrice, "tavsiya narxni o'zgartirmasligi kerak").toBe(before.salesPrice);
    expect(after.costPrice).toBe(before.costPrice);

    // Kassirda yopiq
    expect((await call(mini.cashierCookie, "GET", `/api/catalog/products/${productId}/price-suggestions`)).statusCode).toBe(403);
  });

  it("11. Tannarx: AVCO va oxirgi xarid ko'rinadi; kassirga yopiq", async () => {
    const costs = await call(mini.ownerCookie, "GET", "/api/catalog/products/costs");
    expect(costs.statusCode, costs.body).toBe(200);
    const non = costs.json().products.find((row: { sku: string }) => row.sku === "MM-NON");
    expect(money(non.lastPurchasePrice), "oxirgi xarid narxi").toBe(5000);
    expect(money(non.avgCost), "AVCO").toBeGreaterThan(0);
    expect(non.lastPurchaseDate).toBe(today());

    const history = await call(mini.ownerCookie, "GET", `/api/catalog/products/${mini.products["MM-NON"]}/cost-history`);
    expect(history.statusCode, history.body).toBe(200);

    // Kassir ro'yxatida tannarx yuborilmaydi
    // Kartochkadagi kirim narxi QABULDAN avtomatik yozilmaydi (narx tavsiyasi qoidasi) — qo'lda kiritamiz
    const priced = await call(mini.ownerCookie, "PATCH", `/api/catalog/products/${mini.products["MM-NON"]}`, { purchasePrice: "5000" });
    expect(priced.statusCode, priced.body).toBe(200);
    const forOwner = (await call(mini.ownerCookie, "GET", "/api/catalog/products?search=MM-NON")).json().products[0];
    expect(money(forOwner.purchasePrice), "egada tannarx bor").toBe(5000);
    const forCashier = (await call(mini.cashierCookie, "GET", "/api/catalog/products?search=MM-NON")).json().products[0];
    expect(forCashier.id, "kassir ham mahsulotni ko'radi").toBe(forOwner.id);
    expect(forCashier.purchasePrice ?? null, "kassirga tannarx yuborilmaydi").toBeNull();
  });

  it("12. Xarajat: to'langan xarajat kassadan chiqadi, jurnal balanslangan", async () => {
    const before = (await db.select({ balance: cashAccounts.balance }).from(cashAccounts).where(eq(cashAccounts.id, mini.cashAccountId)))[0]!;

    const created = await call(mini.ownerCookie, "POST", "/api/finance/expenses", {
      category: "Kommunal",
      description: "Elektr energiyasi",
      amount: "500000",
      expenseDate: today(),
    });
    expect(created.statusCode, created.body).toBe(201);
    const expenseId = created.json().expense.id as string;

    const approved = await call(mini.ownerCookie, "POST", `/api/finance/expenses/${expenseId}/status`, { status: "approved" });
    expect(approved.statusCode, approved.body).toBe(200);
    const paid = await call(mini.ownerCookie, "POST", `/api/finance/expenses/${expenseId}/status`, {
      status: "paid",
      cashAccountId: mini.cashAccountId,
      paidDate: today(),
    });
    expect(paid.statusCode, paid.body).toBe(200);

    const after = (await db.select({ balance: cashAccounts.balance }).from(cashAccounts).where(eq(cashAccounts.id, mini.cashAccountId)))[0]!;
    expect(money(before.balance) - money(after.balance)).toBe(500_000);
    await expectBalanced(mini);

    // Ijara — bank hisobidan
    const rent = await call(mini.ownerCookie, "POST", "/api/finance/expenses", {
      category: "Ijara",
      description: "Do'kon ijarasi",
      amount: "1000000",
      expenseDate: today(),
    });
    expect(rent.statusCode, rent.body).toBe(201);
    const rentId = rent.json().expense.id as string;
    expect((await call(mini.ownerCookie, "POST", `/api/finance/expenses/${rentId}/status`, { status: "approved" })).statusCode).toBe(200);
    const rentPaid = await call(mini.ownerCookie, "POST", `/api/finance/expenses/${rentId}/status`, {
      status: "paid",
      cashAccountId: mini.bankAccountId,
      paidDate: today(),
    });
    expect(rentPaid.statusCode, rentPaid.body).toBe(200);
    await expectBalanced(mini);
  });

  it("13. Hisobotlar: API summalari baza bilan bir xil", async () => {
    const [dbTotals] = await db
      .select({
        total: sql<string>`coalesce(sum(${salesOrders.totalAmount}), 0)::numeric(18,2)`,
        paid: sql<string>`coalesce(sum(${salesOrders.paidAmount}), 0)::numeric(18,2)`,
        count: sql<number>`count(*)::int`,
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.companyId, mini.companyId),
          sql`${salesOrders.status} in ('completed','shipped','delivered')`,
        ),
      );

    const report = await call(mini.ownerCookie, "GET", "/api/analytics/reports/sales?days=30");
    expect(report.statusCode, report.body).toBe(200);
    const summary = report.json();
    expect(money(summary.totalRevenue), "hisobot tushumi = bazadagi yakunlangan sotuvlar").toBe(money(dbTotals!.total));
    expect(summary.totalOrders, "hisobotdagi chek soni = bazadagi").toBe(dbTotals!.count);
    expect(money(summary.paidRevenue)).toBe(money(dbTotals!.paid));

    const stockReport = await call(mini.ownerCookie, "GET", "/api/analytics/reports/stock");
    expect(stockReport.statusCode, stockReport.body).toBe(200);

    const trial = await call(mini.ownerCookie, "GET", `/api/finance/reports/trial-balance?dateFrom=2000-01-01&dateTo=${today()}`);
    expect(trial.statusCode, trial.body).toBe(200);
    const rows = trial.json().rows as { debit: string; credit: string }[];
    expect(rows.length, "aylanma balansda satrlar bor").toBeGreaterThan(0);
    const debit = rows.reduce((sum, row) => sum + money(row.debit), 0);
    const credit = rows.reduce((sum, row) => sum + money(row.credit), 0);
    expect(Math.round(debit), "aylanma balansi").toBe(Math.round(credit));
  });

  it("14. Audit: sotuv, to'lov, xarid va qaytarish yozuvlari tenant bilan", async () => {
    expect(await auditCount(mini.companyId, "POS_SALE_COMPLETED"), "kassa cheki auditda").toBeGreaterThan(0);
    expect(await auditCount(mini.companyId, "PURCHASE_GOODS_RECEIVED"), "tovar qabuli auditda").toBeGreaterThan(0);
    expect(await auditCount(mini.companyId, "CUSTOMER_PAYMENT_RECORDED"), "mijoz to'lovi auditda").toBeGreaterThan(0);
    expect(await auditCount(mini.companyId, "SALES_ORDER_RETURNED"), "qaytarish auditda").toBeGreaterThan(0);

    // Audit yozuvlari faqat shu kompaniyaniki
    const foreign = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(and(eq(auditLogs.companyId, mini.companyId), sql`${auditLogs.action} is null`));
    expect(foreign[0]!.n).toBe(0);

    const api = await call(mini.ownerCookie, "GET", "/api/company/audit-logs?limit=20");
    expect(api.statusCode, api.body).toBe(200);
    expect(api.json().logs.length).toBeGreaterThan(0);
  });

  it("15. Idempotentlik: takroriy chek va takroriy to'lov ikki marta yozilmaydi", async () => {
    const clientRequestId = crypto.randomUUID();
    const payload = {
      items: [{ productId: mini.products["MM-SUV"]!, quantity: "1" }],
      paymentMethod: "cash",
      amountPaid: "4000",
      clientRequestId,
    };
    const first = await sell(mini, payload);
    expect(first.statusCode, first.body).toBe(201);
    const stockAfterFirst = await stockOf(mini, mini.products["MM-SUV"]!);

    const repeat = await sell(mini, payload);
    // Takroriy chek yangi hujjat OCHMAYDI: server 409 bilan o'sha chekni ko'rsatadi
    expect(repeat.statusCode, repeat.body).toBe(409);
    expect(repeat.json().details).toMatchObject({ duplicate: true, orderId: first.json().order.id });
    expect(await stockOf(mini, mini.products["MM-SUV"]!), "qoldiq ikki marta kamaymaydi").toBe(stockAfterFirst);

    // Takroriy mijoz to'lovi — bir xil `reference`
    const customerId = mini.customers["TEST CUSTOMER 01"]!;
    const reference = `TEST-PAY-${Date.now()}`;
    const sale = await sell(mini, {
      customerId,
      items: [{ productId: mini.products["MM-SUT"]!, quantity: "1" }],
      paymentMethod: "cash",
      amountPaid: "0",
      onCredit: true,
    });
    expect(sale.statusCode, sale.body).toBe(201);
    const debtBefore = await debtOf(customerId);

    const p1 = await call(mini.ownerCookie, "POST", "/api/sales/payments", {
      customerId,
      amount: "12000",
      method: "cash",
      reference,
      paymentDate: today(),
    });
    expect(p1.statusCode, p1.body).toBe(201);
    const p2 = await call(mini.ownerCookie, "POST", "/api/sales/payments", {
      customerId,
      amount: "12000",
      method: "cash",
      reference,
      paymentDate: today(),
    });
    expect(p2.statusCode, "takroriy to'lov 200 bilan qaytadi").toBe(200);
    expect(await debtOf(customerId), "qarz ikki marta kamaymaydi").toBe(debtBefore - 12_000);
    await expectBalanced(mini);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BUSINESS 02 — SUPERMARKET
// ═══════════════════════════════════════════════════════════════════════════

let superm: Business;
/** Supermarket mijozlari: to'liq to'lagan, qisman to'lagan va to'lamagan. */
const debtors: Record<"A" | "B" | "C", string> = { A: "", B: "", C: "" };

describe("BUSINESS 02 — SUPERMARKET (TEST-02-SUPERMARKET)", () => {
  it("1. Tenant: alohida kompaniya ochiladi va mini market ma'lumotisiz boshlanadi", async () => {
    superm = await setupBusiness("TEST-02-SUPERMARKET", "Direktor");
    expect(superm.companyId).not.toBe(mini.companyId);

    // Yangi tenant bo'sh: mini marketning mahsuloti, mijozi va ta'minotchisi ko'rinmaydi
    expect((await call(superm.ownerCookie, "GET", "/api/catalog/products")).json().products).toHaveLength(0);
    expect((await call(superm.ownerCookie, "GET", "/api/sales/customers")).json().customers).toHaveLength(0);
    expect((await call(superm.ownerCookie, "GET", "/api/purchase/suppliers")).json().suppliers).toHaveLength(0);
    expect((await call(superm.ownerCookie, "GET", "/api/sales/orders")).json().orders).toHaveLength(0);
  });

  it("2. Foydalanuvchilar: uchta rol, sessiya va ruxsatlar", async () => {
    expect((await call(superm.managerCookie, "GET", "/api/purchase/orders")).statusCode).toBe(200);
    expect((await call(superm.cashierCookie, "GET", "/api/sales/orders")).statusCode).toBe(200);
    expect((await call(superm.cashierCookie, "GET", "/api/catalog/products/costs")).statusCode).toBe(403);
    expect((await call(superm.cashierCookie, "GET", "/api/company/employees")).statusCode).toBe(403);

    const me = await call(superm.managerCookie, "GET", "/api/company");
    expect(me.json().company.id, "xodim faqat o'z kompaniyasida").toBe(superm.companyId);
  });

  it("3. Mahsulotlar: 30 ta mahsulot, 5 kategoriya", async () => {
    const groups = ["Oziq-ovqat", "Ichimliklar", "Shirinlik", "Maishiy", "Gigiyena"];
    const categoryIds: string[] = [];
    for (const name of groups) {
      const res = await call(superm.ownerCookie, "POST", "/api/catalog/categories", { name });
      expect(res.statusCode, res.body).toBe(201);
      categoryIds.push(res.json().category.id as string);
    }

    for (let index = 0; index < 30; index += 1) {
      const group = index % 5;
      await addProduct(
        superm,
        `${groups[group]} mahsulot ${index + 1}`,
        `SM-${String(index + 1).padStart(2, "0")}`,
        String(10_000 + index * 500),
        { categoryId: categoryIds[group], barcode: `210${String(index + 1).padStart(4, "0")}` },
      );
    }
    expect(Object.keys(superm.products)).toHaveLength(30);

    const list = await call(superm.ownerCookie, "GET", `/api/catalog/products?categoryId=${categoryIds[0]}`);
    expect(list.json().products.length, "kategoriya bo'yicha filtr").toBe(6);
  });

  it("4. Xaridlar: uch ta'minotchi, har xil narx — AVCO o'rtacha qiymatni beradi", async () => {
    const supplierIds: string[] = [];
    for (const name of ["SM-SUPPLIER-A", "SM-SUPPLIER-B", "SM-SUPPLIER-C"]) {
      supplierIds.push(await addSupplier(superm, name));
    }

    // Bir xil mahsulot ikki xil narxda — AVCO ikkisining o'rtasida bo'lishi kerak
    const first = superm.products["SM-01"]!;
    await purchase(superm, supplierIds[0]!, [{ productId: first, quantity: "100", unitPrice: "6000" }]);
    await purchase(superm, supplierIds[1]!, [{ productId: first, quantity: "100", unitPrice: "8000" }]);

    // Qolgan mahsulotlar — uchinchi ta'minotchidan bitta hujjatda
    const rest = Object.entries(superm.products)
      .filter(([sku]) => sku !== "SM-01")
      .slice(0, 20)
      .map(([, productId], index) => ({ productId, quantity: "50", unitPrice: String(5000 + index * 250) }));
    await purchase(superm, supplierIds[2]!, rest);

    expect(await stockOf(superm, first)).toBe(200);
    const costs = (await call(superm.ownerCookie, "GET", "/api/catalog/products/costs?search=SM-01")).json().products;
    const row = costs.find((item: { sku: string }) => item.sku === "SM-01");
    expect(money(row.avgCost), "AVCO ikki narx o'rtasida").toBeCloseTo(7000, 0);
    expect(money(row.lastPurchasePrice)).toBe(8000);
    await expectBalanced(superm);
  });

  it("5. Ombor: qoldiq va harakatlar bazadagi bilan bir xil", async () => {
    const productId = superm.products["SM-02"]!;
    expect(await stockOf(superm, productId)).toBe(50);

    const stockApi = (await call(superm.ownerCookie, "GET", `/api/inventory/stock?warehouseId=${superm.warehouseId}`)).json().stock;
    for (const row of stockApi) {
      const dbQty = await stockOf(superm, row.productId);
      expect(money(row.quantity), "API qoldig'i = baza qoldig'i").toBe(dbQty);
    }
  });

  it("6. O'n chek: naqd, aralash, nasiya, mijozli va anonim", async () => {
    debtors.A = await addCustomer(superm, "SM MIJOZ A", { creditLimit: "5000000" });
    debtors.B = await addCustomer(superm, "SM MIJOZ B", { creditLimit: "5000000" });
    debtors.C = await addCustomer(superm, "SM MIJOZ C", { creditLimit: "5000000" });

    const productId = superm.products["SM-01"]!;
    const price = 10_000;
    const before = await stockOf(superm, productId);
    let sold = 0;

    // 1–5: oddiy naqd cheklar (anonim mijoz)
    for (let index = 0; index < 5; index += 1) {
      const res = await sell(superm, {
        items: [{ productId, quantity: "1" }],
        paymentMethod: "cash",
        amountPaid: String(price),
      });
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json().order).toMatchObject({ status: "completed", paymentStatus: "paid", fulfillmentMethod: "counter" });
      expect(await tasksOf(res.json().order.id), "kassa chekiga yetkazma yo'q").toHaveLength(0);
      sold += 1;
    }

    // 6–7: aralash to'lov (naqd + karta)
    for (let index = 0; index < 2; index += 1) {
      const res = await sell(superm, {
        items: [{ productId, quantity: "2" }],
        payments: [
          { method: "cash", amount: "12000" },
          { method: "card", amount: "8000" },
        ],
      });
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json().order.paymentStatus).toBe("paid");
      sold += 2;
    }

    // 8: mijozli, to'liq to'langan (A — qarzi yo'q)
    const paidSale = await sell(superm, {
      customerId: debtors.A,
      items: [{ productId, quantity: "3" }],
      paymentMethod: "cash",
      amountPaid: "30000",
    });
    expect(paidSale.statusCode, paidSale.body).toBe(201);
    sold += 3;

    // 9: qisman to'langan (B)
    const partial = await sell(superm, {
      customerId: debtors.B,
      items: [{ productId, quantity: "5" }],
      paymentMethod: "cash",
      amountPaid: "20000",
      onCredit: true,
    });
    expect(partial.statusCode, partial.body).toBe(201);
    expect(partial.json().order.paymentStatus).toBe("partial");
    sold += 5;

    // 10: butunlay nasiya (C)
    const credit = await sell(superm, {
      customerId: debtors.C,
      items: [{ productId, quantity: "4" }],
      paymentMethod: "cash",
      amountPaid: "0",
      onCredit: true,
    });
    expect(credit.statusCode, credit.body).toBe(201);
    expect(credit.json().order.paymentStatus).toBe("unpaid");
    sold += 4;

    expect(await stockOf(superm, productId), "har bir chek qoldiqni kamaytiradi").toBe(before - sold);
    await expectBalanced(superm);
  });

  it("7. Mijoz qarzi: to'langan 0, qisman 30 000, nasiya 40 000", async () => {
    expect(await debtOf(debtors.A), "to'liq to'langan mijozda qarz yo'q").toBe(0);
    expect(await debtOf(debtors.B), "qisman to'lov qoldig'i").toBe(30_000);
    expect(await debtOf(debtors.C), "nasiya chek to'liq qarz").toBe(40_000);

    // Qarzli mijozlar ro'yxati baza bilan mos
    const withDebt = (await call(superm.ownerCookie, "GET", "/api/sales/customers?withDebt=true")).json().customers;
    const ids = withDebt.map((row: { id: string }) => row.id).sort();
    expect(ids).toEqual([debtors.B, debtors.C].sort());

    // B qarzini yopadi
    const pay = await call(superm.ownerCookie, "POST", "/api/sales/payments", {
      customerId: debtors.B,
      amount: "30000",
      method: "cash",
      paymentDate: today(),
    });
    expect(pay.statusCode, pay.body).toBe(201);
    expect(await debtOf(debtors.B)).toBe(0);
    await expectBalanced(superm);
  });

  it("8. Qaytarishlar: ikkita chek qaytariladi — qoldiq va qarz qayta hisoblanadi", async () => {
    const productId = superm.products["SM-03"]!;
    const before = await stockOf(superm, productId);

    // 1-qaytarish: naqd chek
    const cashSale = await sell(superm, {
      items: [{ productId, quantity: "2" }],
      paymentMethod: "cash",
      amountPaid: "22000",
    });
    expect(cashSale.statusCode, cashSale.body).toBe(201);
    const cashOrderId = cashSale.json().order.id as string;
    expect(await stockOf(superm, productId)).toBe(before - 2);
    const firstReturn = await call(superm.ownerCookie, "POST", `/api/sales/orders/${cashOrderId}/return`, {
      reason: "Sifatsiz",
      refund: true,
      method: "cash",
    });
    expect(firstReturn.statusCode, firstReturn.body).toBe(200);
    expect(await stockOf(superm, productId)).toBe(before);

    // 2-qaytarish: nasiya chek — qarz ham kamayadi
    const creditSale = await sell(superm, {
      customerId: debtors.C,
      items: [{ productId, quantity: "1" }],
      paymentMethod: "cash",
      amountPaid: "0",
      onCredit: true,
    });
    expect(creditSale.statusCode, creditSale.body).toBe(201);
    const debtAfterSale = await debtOf(debtors.C);
    const creditOrderId = creditSale.json().order.id as string;
    const salePrice = money(creditSale.json().order.totalAmount);

    const secondReturn = await call(superm.ownerCookie, "POST", `/api/sales/orders/${creditOrderId}/return`, {
      reason: "Mijoz olmadi",
    });
    expect(secondReturn.statusCode, secondReturn.body).toBe(200);
    expect(await stockOf(superm, productId), "qaytgan tovar omborga qaytadi").toBe(before);
    expect(await debtOf(debtors.C), "nasiya qaytarilganda qarz kamayadi").toBe(debtAfterSale - salePrice);
    await expectBalanced(superm);
  });

  it("9. Xarajatlar: ijara, elektr va transport — kassadan chiqadi", async () => {
    const [cashBefore] = await db
      .select({ balance: cashAccounts.balance })
      .from(cashAccounts)
      .where(eq(cashAccounts.id, superm.cashAccountId));

    const items: [string, string, string][] = [
      ["Ijara", "Savdo maydoni ijarasi", "3000000"],
      ["Kommunal", "Elektr energiyasi", "800000"],
      ["Transport", "Tovar yetkazish", "400000"],
    ];
    for (const [category, description, amount] of items) {
      const created = await call(superm.ownerCookie, "POST", "/api/finance/expenses", {
        category,
        description,
        amount,
        expenseDate: today(),
      });
      expect(created.statusCode, created.body).toBe(201);
      const id = created.json().expense.id as string;
      expect((await call(superm.ownerCookie, "POST", `/api/finance/expenses/${id}/status`, { status: "approved" })).statusCode).toBe(200);
      const paid = await call(superm.ownerCookie, "POST", `/api/finance/expenses/${id}/status`, {
        status: "paid",
        cashAccountId: superm.cashAccountId,
        paidDate: today(),
      });
      expect(paid.statusCode, paid.body).toBe(200);
    }

    const [cashAfter] = await db
      .select({ balance: cashAccounts.balance })
      .from(cashAccounts)
      .where(eq(cashAccounts.id, superm.cashAccountId));
    expect(money(cashBefore!.balance) - money(cashAfter!.balance)).toBe(4_200_000);
    await expectBalanced(superm);

    const stats = await call(superm.ownerCookie, "GET", "/api/finance/expenses/stats");
    expect(stats.statusCode, stats.body).toBe(200);
  });

  it("10. Narx va tannarx: marja hisoblanadi, kassirga yopiq", async () => {
    const productId = superm.products["SM-01"]!;
    const costs = (await call(superm.ownerCookie, "GET", "/api/catalog/products/costs?search=SM-01")).json().products;
    const row = costs.find((item: { sku: string }) => item.sku === "SM-01");
    expect(money(row.salesPrice)).toBe(10_000);
    expect(money(row.marginPercent), "marja foizda").toBeGreaterThan(0);

    const suggestion = await call(superm.ownerCookie, "GET", `/api/catalog/products/${productId}/price-suggestions`);
    expect(suggestion.statusCode, suggestion.body).toBe(200);
    expect(money(suggestion.json().avgPurchasePrice), "o'rtacha xarid narxi").toBeCloseTo(7000, 0);

    // Egasining qarori: tannarxni faqat ega ko'radi — menejer ham, kassir ham ko'rmaydi
    expect((await call(superm.managerCookie, "GET", `/api/catalog/products/${productId}/price-suggestions`)).statusCode).toBe(403);
    expect((await call(superm.cashierCookie, "GET", `/api/catalog/products/${productId}/price-suggestions`)).statusCode).toBe(403);
    expect((await call(superm.cashierCookie, "GET", `/api/catalog/products/${productId}/cost-history`)).statusCode).toBe(403);
  });

  it("11. Hisobotlar: sotuv, xarid va xarajat summalari baza bilan bir xil", async () => {
    const [dbSales] = await db
      .select({
        total: sql<string>`coalesce(sum(${salesOrders.totalAmount}), 0)::numeric(18,2)`,
        count: sql<number>`count(*)::int`,
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.companyId, superm.companyId),
          sql`${salesOrders.status} in ('completed','shipped','delivered')`,
        ),
      );

    const sales = (await call(superm.ownerCookie, "GET", "/api/analytics/reports/sales?days=30")).json();
    expect(money(sales.totalRevenue)).toBe(money(dbSales!.total));
    expect(sales.totalOrders).toBe(dbSales!.count);

    const [dbExpenses] = await db
      .select({ total: sql<string>`coalesce(sum(${expensesTable.amount}), 0)::numeric(18,2)` })
      .from(expensesTable)
      .where(and(eq(expensesTable.companyId, superm.companyId), eq(expensesTable.status, "paid")));
    const expenses = (await call(superm.ownerCookie, "GET", "/api/analytics/reports/expenses?days=30")).json();
    expect(money(expenses.total), "xarajat hisoboti = bazadagi to'langan xarajatlar").toBe(money(dbExpenses!.total));
    expect(expenses.byCategory.length, "xarajat moddalari bo'yicha bo'linadi").toBe(3);

    const [dbPurchases] = await db
      .select({ total: sql<string>`coalesce(sum(${purchaseOrders.totalAmount}), 0)::numeric(18,2)`, count: sql<number>`count(*)::int` })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.companyId, superm.companyId),
          sql`${purchaseOrders.status} not in ('draft','cancelled')`,
        ),
      );
    const purchases = (await call(superm.ownerCookie, "GET", "/api/analytics/reports/purchases?days=30")).json();
    expect(money(purchases.totalAmount), "xarid hisoboti = bazadagi xarid hujjatlari").toBe(money(dbPurchases!.total));
    expect(purchases.totalOrders).toBe(dbPurchases!.count);

    // To'lovlar ro'yxati (hisobot) baza bilan bir xil
    const [dbPayments] = await db
      .select({ total: sql<string>`coalesce(sum(${customerPayments.amount}), 0)::numeric(18,2)`, count: sql<number>`count(*)::int` })
      .from(customerPayments)
      .where(eq(customerPayments.companyId, superm.companyId));
    const paymentsApi = (await call(superm.ownerCookie, "GET", "/api/sales/payments?limit=200")).json().payments as
      { amount: string }[];
    expect(paymentsApi.length, "to'lovlar soni = bazadagi").toBe(dbPayments!.count);
    expect(paymentsApi.reduce((sum, row) => sum + money(row.amount), 0)).toBe(money(dbPayments!.total));

    // Mini marketning sotuvlari supermarket hisobotiga TUSHMAYDI
    const miniSales = (await call(mini.ownerCookie, "GET", "/api/analytics/reports/sales?days=30")).json();
    expect(money(sales.totalRevenue)).not.toBe(money(miniSales.totalRevenue));
  });

  it("12. Buxgalteriya: jurnal balanslangan, aylanma balans teng", async () => {
    await expectBalanced(superm);
    const trial = await call(superm.ownerCookie, "GET", `/api/finance/reports/trial-balance?dateFrom=2000-01-01&dateTo=${today()}`);
    expect(trial.statusCode, trial.body).toBe(200);
    const rows = trial.json().rows as { debit: string; credit: string }[];
    expect(rows.length, "aylanma balansda satrlar bor").toBeGreaterThan(0);
    const debit = rows.reduce((sum, row) => sum + money(row.debit), 0);
    const credit = rows.reduce((sum, row) => sum + money(row.credit), 0);
    expect(Math.round(debit)).toBe(Math.round(credit));

    const pl = await call(superm.ownerCookie, "GET", `/api/finance/reports/profit-loss?dateFrom=2000-01-01&dateTo=${today()}`);
    expect(pl.statusCode, pl.body).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TENANT IZOLYATSIYASI — ikki haqiqiy biznes o'rtasida
// ═══════════════════════════════════════════════════════════════════════════

describe("CROSS-TENANT XAVFSIZLIK", () => {
  it("bir biznes ikkinchisining hujjat va ma'lumotlarini ko'ra olmaydi", async () => {
    const miniProduct = mini.products["MM-NON"]!;
    const superProduct = superm.products["SM-01"]!;
    const miniCustomer = mini.customers["TEST CUSTOMER 01"]!;

    // Begona ID bo'yicha o'qish — 404 (mavjudligi ham oshkor qilinmaydi)
    expect((await call(superm.ownerCookie, "GET", `/api/catalog/products/${miniProduct}`)).statusCode).toBe(404);
    expect((await call(mini.ownerCookie, "GET", `/api/catalog/products/${superProduct}`)).statusCode).toBe(404);
    expect((await call(superm.ownerCookie, "GET", `/api/sales/customers/${miniCustomer}`)).statusCode).toBe(404);

    // Ro'yxatlar faqat o'z tenantiniki
    const superProducts = (await call(superm.ownerCookie, "GET", "/api/catalog/products?limit=200")).json().products;
    expect(superProducts.some((row: { sku: string }) => row.sku.startsWith("MM-"))).toBe(false);
    const miniCustomers = (await call(mini.ownerCookie, "GET", "/api/sales/customers")).json().customers;
    expect(miniCustomers.some((row: { name: string }) => row.name.startsWith("SM MIJOZ"))).toBe(false);
    const superSuppliers = (await call(superm.ownerCookie, "GET", "/api/purchase/suppliers")).json().suppliers;
    expect(superSuppliers.some((row: { name: string }) => row.name.startsWith("TEST-SUPPLIER"))).toBe(false);
  });

  it("begona mahsulotni sotib, begona hujjatni o'zgartirib bo'lmaydi", async () => {
    // Boshqa tenant mahsuloti bilan chek — rad etiladi, qoldiq o'zgarmaydi
    const before = await stockOf(mini, mini.products["MM-NON"]!);
    const sale = await sell(superm, {
      items: [{ productId: mini.products["MM-NON"]!, quantity: "1" }],
      paymentMethod: "cash",
      amountPaid: "5000",
    });
    expect(sale.statusCode, "begona mahsulot sotilmaydi").toBeGreaterThanOrEqual(400);
    expect(await stockOf(mini, mini.products["MM-NON"]!)).toBe(before);

    // Begona mijozga to'lov — rad etiladi
    const payment = await call(superm.ownerCookie, "POST", "/api/sales/payments", {
      customerId: mini.customers["TEST CUSTOMER 01"]!,
      amount: "1000",
      method: "cash",
      paymentDate: today(),
    });
    expect(payment.statusCode).toBeGreaterThanOrEqual(400);

    // So'rov tanasida `companyId` yuborish — sxema begona kalitni qabul qilmaydi
    const spoof = await call(superm.ownerCookie, "POST", "/api/sales/customers", {
      name: "Spoof",
      companyId: mini.companyId,
    });
    expect(spoof.statusCode, "tana orqali tenant almashtirib bo'lmaydi").toBe(400);

    // Begona mahsulotni tahrirlash — 404
    const patch = await call(superm.ownerCookie, "PATCH", `/api/catalog/products/${mini.products["MM-SUT"]}`, { salesPrice: "1" });
    expect(patch.statusCode).toBe(404);
  });

  it("audit va jurnal yozuvlari tenantlar orasida aralashmaydi", async () => {
    const [miniAudit] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(eq(auditLogs.companyId, mini.companyId));
    const [superAudit] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(eq(auditLogs.companyId, superm.companyId));
    expect(miniAudit!.n).toBeGreaterThan(0);
    expect(superAudit!.n).toBeGreaterThan(0);

    const miniJournal = await journalOf(mini.companyId);
    const superJournal = await journalOf(superm.companyId);
    expect(miniJournal.debit).toBe(miniJournal.credit);
    expect(superJournal.debit).toBe(superJournal.credit);
    expect(miniJournal.entries).toBeGreaterThan(0);
    expect(superJournal.entries).toBeGreaterThan(0);

    // Har bir jurnal satri o'z kompaniyasining hisobiga tegishli
    const foreignLines = await db.execute(sql`
      select count(*)::int as n
      from journal_lines jl
      join accounts a on a.id = jl.account_id
      where jl.company_id <> a.company_id
    `);
    expect((foreignLines.rows[0] as { n: number }).n, "jurnal satri begona hisobga bog'lanmagan").toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CHEGARALAR VA INVARIANTLAR — salbiy ssenariylar
// ═══════════════════════════════════════════════════════════════════════════

describe("CHEGARALAR: qoldiq, kredit limiti, narx va takroriy qabul", () => {
  it("omborda yo'q tovarni sotib bo'lmaydi — qoldiq manfiyga tushmaydi", async () => {
    const productId = mini.products["MM-CHOY"]!;
    expect(await stockOf(mini, productId), "bu mahsulot hali kelmagan").toBe(0);

    const sale = await sell(mini, {
      items: [{ productId, quantity: "1" }],
      paymentMethod: "cash",
      amountPaid: "18000",
    });
    expect(sale.statusCode, "qoldiqsiz tovar sotilmaydi").toBeGreaterThanOrEqual(400);
    expect(await stockOf(mini, productId)).toBe(0);

    // Bor tovardan ko'p sotish ham rad etiladi
    const sut = mini.products["MM-SUT"]!;
    const have = await stockOf(mini, sut);
    const tooMany = await sell(mini, {
      items: [{ productId: sut, quantity: String(have + 10) }],
      paymentMethod: "cash",
      amountPaid: "1000000",
    });
    expect(tooMany.statusCode, "qoldiqdan ko'p sotilmaydi").toBeGreaterThanOrEqual(400);
    expect(await stockOf(mini, sut)).toBe(have);
  });

  it("kredit limitidan oshiq nasiya rad etiladi, qarz o'zgarmaydi", async () => {
    const customerId = await addCustomer(mini, "LIMITLI MIJOZ", { creditLimit: "20000" });
    const productId = mini.products["MM-SHAKAR"]!;

    const over = await sell(mini, {
      customerId,
      items: [{ productId, quantity: "5" }],
      paymentMethod: "cash",
      amountPaid: "0",
      onCredit: true,
    });
    expect(over.statusCode, "limitdan oshiq nasiya berilmaydi").toBeGreaterThanOrEqual(400);
    expect(await debtOf(customerId), "rad etilgan chek qarz yozmaydi").toBe(0);

    // Limit ichidagi nasiya esa o'tadi
    const within = await sell(mini, {
      customerId,
      items: [{ productId, quantity: "1" }],
      paymentMethod: "cash",
      amountPaid: "0",
      onCredit: true,
    });
    expect(within.statusCode, within.body).toBe(201);
    expect(await debtOf(customerId)).toBe(15_000);
    await expectBalanced(mini);
  });

  it("kassir chekda narxni o'zgartira olmaydi (sales.edit yo'q)", async () => {
    const productId = mini.products["MM-SUV"]!;
    const cheaper = await sell(mini, {
      items: [{ productId, quantity: "1", unitPrice: "1" }],
      paymentMethod: "cash",
      amountPaid: "1",
    });
    expect(cheaper.statusCode, "kassir narxni tushira olmaydi").toBeGreaterThanOrEqual(400);

    // Ega esa o'zgartira oladi — chek kartochkadagi narxdan farq qiladi
    const byOwner = await sell(
      mini,
      { items: [{ productId, quantity: "1", unitPrice: "1000" }], paymentMethod: "cash", amountPaid: "1000" },
      mini.ownerCookie,
    );
    expect(byOwner.statusCode, byOwner.body).toBe(201);
    expect(money(byOwner.json().order.totalAmount)).toBe(1000);
  });

  it("bir xil qabulni ikki marta yozib bo'lmaydi — ombor ikki marta oshmaydi", async () => {
    const productId = superm.products["SM-05"]!;
    const before = await stockOf(superm, productId);
    const supplierId = superm.suppliers["SM-SUPPLIER-A"]!;

    const created = await call(superm.ownerCookie, "POST", "/api/purchase/orders", {
      supplierId,
      warehouseId: superm.warehouseId,
      orderDate: today(),
      items: [{ productId, unitId: piece, orderedQty: "10", unitPrice: "7000" }],
    });
    expect(created.statusCode, created.body).toBe(201);
    const order = created.json().order as { id: string; items: { id: string }[] };
    expect((await call(superm.ownerCookie, "POST", `/api/purchase/orders/${order.id}/confirm`)).statusCode).toBe(200);

    const receiptPayload = {
      receiptDate: today(),
      items: [{ orderItemId: order.items[0]!.id, receivedQty: "10" }],
    };
    const first = await call(superm.ownerCookie, "POST", `/api/purchase/orders/${order.id}/receipts`, receiptPayload);
    expect(first.statusCode, first.body).toBe(201);
    expect(await stockOf(superm, productId)).toBe(before + 10);

    // Hujjat allaqachon to'liq qabul qilingan — ikkinchi qabul rad etiladi
    const second = await call(superm.ownerCookie, "POST", `/api/purchase/orders/${order.id}/receipts`, receiptPayload);
    expect(second.statusCode, "ortiqcha qabul rad etiladi").toBeGreaterThanOrEqual(400);
    expect(await stockOf(superm, productId), "ombor ikki marta oshmaydi").toBe(before + 10);
    await expectBalanced(superm);
  });

  it("buyurtma tasdiqlanganda zaxira band bo'ladi va jo'natilganda kamayadi", async () => {
    const productId = superm.products["SM-06"]!;
    const before = await stockOf(superm, productId);

    const created = await call(superm.ownerCookie, "POST", "/api/sales/orders", {
      customerId: debtors.A,
      warehouseId: superm.warehouseId,
      orderDate: today(),
      items: [{ productId, quantity: "5" }],
    });
    expect(created.statusCode, created.body).toBe(201);
    const orderId = created.json().order.id as string;

    expect((await call(superm.ownerCookie, "POST", `/api/sales/orders/${orderId}/confirm`)).statusCode).toBe(200);
    const [reservedRow] = await db
      .select({ quantity: stockLevels.quantity, reserved: stockLevels.reservedQty })
      .from(stockLevels)
      .where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, superm.warehouseId)));
    expect(money(reservedRow!.reserved), "tasdiqlangan buyurtma zaxirani band qiladi").toBe(5);
    expect(money(reservedRow!.quantity), "band qilish qoldiqni kamaytirmaydi").toBe(before);
    expect(money(reservedRow!.reserved)).toBeLessThanOrEqual(money(reservedRow!.quantity));

    const shipped = await call(superm.ownerCookie, "POST", `/api/sales/orders/${orderId}/ship`);
    expect(shipped.statusCode, shipped.body).toBe(200);
    const [afterShip] = await db
      .select({ quantity: stockLevels.quantity, reserved: stockLevels.reservedQty })
      .from(stockLevels)
      .where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, superm.warehouseId)));
    expect(money(afterShip!.quantity), "jo'natilganda qoldiq kamayadi").toBe(before - 5);
    expect(money(afterShip!.reserved), "band qilingan zaxira bo'shaydi").toBe(0);
    await expectBalanced(superm);
  });
});
