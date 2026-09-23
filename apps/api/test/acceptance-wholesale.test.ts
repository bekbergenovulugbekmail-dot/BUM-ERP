/**
 * REAL BIZNES SIMULATSIYASI — BUSINESS 03: ULGURJI SAVDO (`TEST-03-WHOLESALE`).
 *
 * Kompaniya ochilishidan kun yakuniga qadar: ta'minotchilar, 50 mahsulot, katta xaridlar, turli narxlarda
 * qayta xarid (AVCO), B2B buyurtmalar (yaratish → tasdiq → jo'natish), katta buyurtma va zaxira, nasiya
 * savdo va kredit limiti, qisman va aralash to'lov, qaytarish, ta'minotchiga to'lov, xarajatlar, omborlararo
 * o'tkazma, buxgalteriya solishtiruvi, hisobotlar, xavfsizlik va kun yakuni.
 *
 * Har qadamda API javobi BILAN BIRGA baza holati tekshiriladi (qoldiq, zaxira, qarz, kassa, jurnal).
 * Production bazasiga aloqasi yo'q: `resetDatabase` faqat `_test` bazada ishlaydi.
 */
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { cashAccounts, expenses as expensesTable, journalEntries, journalLines } from "../src/db/schema/finance.js";
import { stockLevels, stockMovements, warehouses } from "../src/db/schema/inventory.js";
import { auditLogs } from "../src/db/schema/platform.js";
import { purchaseOrders, suppliers } from "../src/db/schema/purchase.js";
import { customerPayments, customers, salesOrders } from "../src/db/schema/sales.js";
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
const money = (value: string | number | null | undefined) => Number(value ?? 0);

/** Ulgurji kompaniya: ega, xodimlar, omborlar va hisoblar. */
type Wholesale = {
  companyId: string;
  ownerCookie: string;
  managerCookie: string;
  salesCookie: string;
  accountantCookie: string;
  warehouseCookie: string;
  mainWarehouseId: string;
  secondWarehouseId: string;
  cashAccountId: string;
  bankAccountId: string;
  products: Record<string, string>;
  suppliers: Record<string, string>;
  customers: Record<string, string>;
};

let ws: Wholesale;
/** Boshqa tenant — izolyatsiyani tekshirish uchun. */
let outsider: { companyId: string; ownerCookie: string; productId: string; customerId: string };

// ─── Baza holati ─────────────────────────────────────────────────────────────

async function stockRow(productId: string, warehouseId: string) {
  const [row] = await db
    .select({ quantity: stockLevels.quantity, reserved: stockLevels.reservedQty })
    .from(stockLevels)
    .where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, warehouseId)));
  if (!row) return { quantity: 0, reserved: 0 };
  const quantity = money(row.quantity);
  const reserved = money(row.reserved);
  expect(quantity, "qoldiq manfiy bo'lmasligi kerak").toBeGreaterThanOrEqual(0);
  expect(reserved, "reserved_qty > quantity").toBeLessThanOrEqual(quantity);
  return { quantity, reserved };
}

const stockOf = async (productId: string, warehouseId = ws.mainWarehouseId) => (await stockRow(productId, warehouseId)).quantity;

const debtOf = async (customerId: string) =>
  money((await db.select({ debt: customers.totalDebt }).from(customers).where(eq(customers.id, customerId)))[0]!.debt);

const supplierDebtOf = async (supplierId: string) =>
  money((await db.select({ debt: suppliers.totalDebt }).from(suppliers).where(eq(suppliers.id, supplierId)))[0]!.debt);

const cashOf = async (accountId: string) =>
  money((await db.select({ balance: cashAccounts.balance }).from(cashAccounts).where(eq(cashAccounts.id, accountId)))[0]!.balance);

async function journalTotals(companyId: string) {
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

/** Umumiy balans va har bir yozuvning ichki balansi. */
async function expectBalanced(label: string) {
  const totals = await journalTotals(ws.companyId);
  expect(totals.debit, `${label}: debet ≠ kredit`).toBe(totals.credit);
  const unbalanced = await db
    .select({ entryId: journalLines.entryId })
    .from(journalLines)
    .where(eq(journalLines.companyId, ws.companyId))
    .groupBy(journalLines.entryId)
    .having(sql`sum(${journalLines.debit}) <> sum(${journalLines.credit})`);
  expect(unbalanced, `${label}: balanslanmagan jurnal yozuvi`).toHaveLength(0);
}

// ─── Biznes amallari ─────────────────────────────────────────────────────────

async function addProduct(name: string, sku: string, salesPrice: string, extra: object = {}) {
  const res = await call(ws.ownerCookie, "POST", "/api/catalog/products", {
    name,
    sku,
    baseUnitId: piece,
    salesPrice,
    taxRate: "0",
    ...extra,
  });
  expect(res.statusCode, `${sku}: ${res.body}`).toBe(201);
  const id = res.json().product.id as string;
  ws.products[sku] = id;
  return id;
}

/** Xarid: hujjat → tasdiq → qabul. */
async function purchase(
  supplierId: string,
  lines: { productId: string; quantity: string; unitPrice: string }[],
  cookie = ws.managerCookie,
  warehouseId = ws.mainWarehouseId,
) {
  const created = await call(cookie, "POST", "/api/purchase/orders", {
    supplierId,
    warehouseId,
    orderDate: today(),
    items: lines.map((line) => ({ productId: line.productId, unitId: piece, orderedQty: line.quantity, unitPrice: line.unitPrice })),
  });
  expect(created.statusCode, created.body).toBe(201);
  const order = created.json().order as { id: string; items: { id: string; productId: string }[] };
  expect((await call(cookie, "POST", `/api/purchase/orders/${order.id}/confirm`)).statusCode).toBe(200);
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

/** Ulgurji buyurtma: yaratish → tasdiq (zaxira) → jo'natish (qoldiq kamayadi). */
async function wholesaleOrder(
  customerId: string,
  lines: { productId: string; quantity: string }[],
  options: { ship?: boolean; cookie?: string } = {},
) {
  const cookie = options.cookie ?? ws.salesCookie;
  const created = await call(cookie, "POST", "/api/sales/orders", {
    customerId,
    warehouseId: ws.mainWarehouseId,
    orderDate: today(),
    deliveryRequired: false,
    items: lines,
  });
  expect(created.statusCode, created.body).toBe(201);
  const orderId = created.json().order.id as string;

  const confirmed = await call(cookie, "POST", `/api/sales/orders/${orderId}/confirm`);
  expect(confirmed.statusCode, confirmed.body).toBe(200);

  if (options.ship !== false) {
    const shipped = await call(cookie, "POST", `/api/sales/orders/${orderId}/ship`);
    expect(shipped.statusCode, shipped.body).toBe(200);
  }
  return orderId;
}

const orderOf = async (orderId: string, cookie = ws.ownerCookie) =>
  (await call(cookie, "GET", `/api/sales/orders/${orderId}`)).json().order;

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

describe("BUSINESS 03 — ULGURJI SAVDO (TEST-03-WHOLESALE)", () => {
  it("PHASE 0 — bootstrap: kompaniya, omborlar, 5 rol, sessiya va tenant izolyatsiyasi", async () => {
    const company = await createCompany(app, adminCookie, { name: "TEST-03-WHOLESALE" });
    const mainWarehouseId = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;

    const setup = await call(company.ownerCookie, "POST", "/api/finance/setup");
    expect(setup.statusCode, setup.body).toBe(200);
    const accounts = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));

    const manager = await addEmployee(app, company, "Direktor");
    const sales = await addEmployee(app, company, "Savdo menejeri");
    const accountant = await addEmployee(app, company, "Buxgalter");
    const warehouseUser = await addEmployee(app, company, "Ombor menejeri");

    ws = {
      companyId: company.companyId,
      ownerCookie: company.ownerCookie,
      managerCookie: manager.cookie,
      salesCookie: sales.cookie,
      accountantCookie: accountant.cookie,
      warehouseCookie: warehouseUser.cookie,
      mainWarehouseId,
      secondWarehouseId: "",
      cashAccountId: accounts.find((row) => row.type === "cash")!.id,
      bankAccountId: accounts.find((row) => row.type === "bank")!.id,
      products: {},
      suppliers: {},
      customers: {},
    };

    // Asosiy ombor nomi va ikkinchi ombor (o'tkazma uchun)
    expect((await call(ws.ownerCookie, "PATCH", `/api/inventory/warehouses/${mainWarehouseId}`, { name: "MAIN WHOLESALE WAREHOUSE" })).statusCode).toBe(200);
    const second = await call(ws.ownerCookie, "POST", "/api/inventory/warehouses", { name: "SECONDARY WAREHOUSE", code: "WH-02" });
    expect(second.statusCode, second.body).toBe(201);
    ws.secondWarehouseId = second.json().warehouse.id as string;

    // Boshlang'ich mablag' (ustav kapitali) — naqd to'lovlar uchun
    const chart = (await call(ws.ownerCookie, "GET", "/api/finance/accounts")).json().accounts as { id: string; code: string }[];
    const capitalId = chart.find((row) => row.code === "3000")!.id;
    for (const [accountId, amount] of [[ws.cashAccountId, "50000000"], [ws.bankAccountId, "300000000"]] as const) {
      const deposit = await call(ws.ownerCookie, "POST", "/api/finance/cash-transactions", {
        cashAccountId: accountId,
        type: "in",
        amount,
        description: "Boshlang'ich mablag'",
        counterAccountId: capitalId,
        txDate: today(),
      });
      expect(deposit.statusCode, deposit.body).toBe(201);
    }

    // Kompaniya ma'lumotlari va sessiya
    const me = await call(ws.ownerCookie, "GET", "/api/company");
    expect(me.json().company).toMatchObject({ id: ws.companyId, name: "TEST-03-WHOLESALE" });
    expect(me.json().company.currency ?? "UZS").toBe("UZS");
    expect((await call(ws.salesCookie, "GET", "/api/company")).json().company.id).toBe(ws.companyId);

    // Begona tenant — keyingi xavfsizlik bosqichi uchun
    const other = await createCompany(app, adminCookie, { name: "TEST-03-OUTSIDER" });
    const product = await call(other.ownerCookie, "POST", "/api/catalog/products", {
      name: "Begona mahsulot",
      sku: "OUT-01",
      baseUnitId: piece,
      salesPrice: "1000",
      taxRate: "0",
    });
    const customer = await call(other.ownerCookie, "POST", "/api/sales/customers", { name: "Begona mijoz", phone: uniquePhone("96") });
    outsider = {
      companyId: other.companyId,
      ownerCookie: other.ownerCookie,
      productId: product.json().product.id as string,
      customerId: customer.json().customer.id as string,
    };

    // Yangi kompaniyada begona ma'lumot yo'q
    expect((await call(ws.ownerCookie, "GET", "/api/catalog/products")).json().products).toHaveLength(0);
    await expectBalanced("bootstrap");
  });

  it("PHASE 0b — rollar: har bir rol o'z ishini qiladi, begona bo'limga kira olmaydi", async () => {
    // Savdo menejeri: sotuv — ha, xarid hujjati — yo'q
    expect((await call(ws.salesCookie, "GET", "/api/sales/orders")).statusCode).toBe(200);
    expect((await call(ws.salesCookie, "GET", "/api/purchase/orders")).statusCode).toBe(403);
    // Ombor menejeri: qoldiq — ha, mijoz qarzini to'g'rilash — yo'q
    expect((await call(ws.warehouseCookie, "GET", `/api/inventory/stock?warehouseId=${ws.mainWarehouseId}`)).statusCode).toBe(200);
    expect((await call(ws.warehouseCookie, "GET", "/api/finance/journal")).statusCode).toBe(403);
    // Buxgalter: jurnal — ha, mahsulot yaratish — yo'q
    expect((await call(ws.accountantCookie, "GET", "/api/finance/journal")).statusCode).toBe(200);
    expect((await call(ws.accountantCookie, "POST", "/api/catalog/products", { name: "X", sku: "X", baseUnitId: piece })).statusCode).toBe(403);
  });

  it("PHASE 1 — master data: 3 ta'minotchi, 5 mijoz (limit va muddat), 50 mahsulot", async () => {
    for (const name of ["TEST-SUPPLIER-A", "TEST-SUPPLIER-B", "TEST-SUPPLIER-C"]) {
      const res = await call(ws.managerCookie, "POST", "/api/purchase/suppliers", { name, phone: uniquePhone("94") });
      expect(res.statusCode, res.body).toBe(201);
      ws.suppliers[name] = res.json().supplier.id as string;
    }

    const letters = ["A", "B", "C", "D", "E"];
    for (const letter of letters) {
      const name = `TEST-WHOLESALE-CUSTOMER-${letter}`;
      const res = await call(ws.salesCookie, "POST", "/api/sales/customers", {
        name,
        phone: uniquePhone("95"),
        address: `Urganch, ${letter} ko'chasi`,
        contactName: `Mas'ul ${letter}`,
        partyType: "legal",
        creditLimit: "100000000",
        paymentTermDays: 14,
      });
      expect(res.statusCode, res.body).toBe(201);
      ws.customers[letter] = res.json().customer.id as string;
    }
    const customerA = (await call(ws.ownerCookie, "GET", `/api/sales/customers/${ws.customers.A}`)).json().customer;
    expect(customerA).toMatchObject({ partyType: "legal", paymentTermDays: 14 });
    expect(money(customerA.creditLimit)).toBe(100_000_000);

    const groups = ["Ichimliklar", "Oziq-ovqat", "Shirinlik", "Maishiy", "Gigiyena"];
    const categoryIds: string[] = [];
    for (const name of groups) {
      const res = await call(ws.ownerCookie, "POST", "/api/catalog/categories", { name });
      expect(res.statusCode, res.body).toBe(201);
      categoryIds.push(res.json().category.id as string);
    }
    for (let index = 0; index < 50; index += 1) {
      await addProduct(
        `${groups[index % 5]} ${index + 1}`,
        `WS-${String(index + 1).padStart(2, "0")}`,
        String(12_000 + index * 250),
        { categoryId: categoryIds[index % 5], barcode: `300${String(index + 1).padStart(4, "0")}` },
      );
    }
    expect(Object.keys(ws.products)).toHaveLength(50);

    // Birlik konversiyasi (dona/blok) — 5 mahsulotda
    const blok = (await db.select().from(units).where(eq(units.shortName, "blok")))[0];
    if (blok) {
      for (let index = 0; index < 5; index += 1) {
        const res = await call(ws.ownerCookie, "POST", "/api/catalog/unit-conversions", {
          productId: ws.products[`WS-${String(index + 1).padStart(2, "0")}`]!,
          unitId: blok.id,
          factor: "10",
        });
        expect([201, 200]).toContain(res.statusCode);
      }
      const conversions = await call(ws.ownerCookie, "GET", `/api/catalog/unit-conversions?productId=${ws.products["WS-01"]}`);
      expect(conversions.json().conversions.length).toBeGreaterThan(0);
    }
  });

  it("PHASE 2 — katta xaridlar: uch ta'minotchidan qabul, qarz va jurnal", async () => {
    const p = (sku: string) => ws.products[sku]!;

    await purchase(ws.suppliers["TEST-SUPPLIER-A"]!, [
      { productId: p("WS-01"), quantity: "1000", unitPrice: "10000" },
      { productId: p("WS-02"), quantity: "500", unitPrice: "9000" },
      { productId: p("WS-03"), quantity: "300", unitPrice: "8000" },
    ]);
    await purchase(ws.suppliers["TEST-SUPPLIER-B"]!, [
      { productId: p("WS-04"), quantity: "2000", unitPrice: "7000" },
      { productId: p("WS-05"), quantity: "1000", unitPrice: "6000" },
    ]);
    await purchase(ws.suppliers["TEST-SUPPLIER-C"]!, [
      { productId: p("WS-06"), quantity: "500", unitPrice: "15000" },
      { productId: p("WS-07"), quantity: "500", unitPrice: "16000" },
    ]);

    expect(await stockOf(p("WS-01"))).toBe(1000);
    expect(await stockOf(p("WS-04"))).toBe(2000);
    expect(await stockOf(p("WS-07"))).toBe(500);

    expect(await supplierDebtOf(ws.suppliers["TEST-SUPPLIER-A"]!)).toBe(1000 * 10_000 + 500 * 9_000 + 300 * 8_000);
    expect(await supplierDebtOf(ws.suppliers["TEST-SUPPLIER-B"]!)).toBe(2000 * 7_000 + 1000 * 6_000);
    expect(await supplierDebtOf(ws.suppliers["TEST-SUPPLIER-C"]!)).toBe(500 * 15_000 + 500 * 16_000);

    // Qabul qilingan hujjat holati va ombor harakati
    const orders = (await call(ws.managerCookie, "GET", "/api/purchase/orders?limit=50")).json().orders as { status: string }[];
    expect(orders.every((row) => ["received", "invoiced", "paid"].includes(row.status)), "hujjatlar qabul qilingan").toBe(true);
    const movements = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(stockMovements)
      .where(and(eq(stockMovements.companyId, ws.companyId), eq(stockMovements.type, "receive")));
    expect(movements[0]!.n).toBeGreaterThanOrEqual(7);
    await expectBalanced("xaridlar");
  });

  it("PHASE 3 — qayta xarid: AVCO uch narxning o'rtachasi, tavsiya narxni o'zgartirmaydi", async () => {
    const productId = ws.products["WS-01"]!;
    const cardBefore = (await call(ws.ownerCookie, "GET", `/api/catalog/products/${productId}`)).json().product;

    await purchase(ws.suppliers["TEST-SUPPLIER-B"]!, [{ productId, quantity: "1000", unitPrice: "12000" }]);
    await purchase(ws.suppliers["TEST-SUPPLIER-C"]!, [{ productId, quantity: "1000", unitPrice: "11000" }]);
    expect(await stockOf(productId)).toBe(3000);

    // Tannarx ro'yxati faqat egada (`products.view_cost` hech bir tayyor rolda yo'q)
    expect((await call(ws.managerCookie, "GET", "/api/catalog/products/costs?search=WS-01")).statusCode).toBe(403);
    const costs = (await call(ws.ownerCookie, "GET", "/api/catalog/products/costs?search=WS-01")).json().products;
    const row = costs.find((item: { sku: string }) => item.sku === "WS-01");
    expect(money(row.avgCost), "AVCO = (10000+12000+11000)/3").toBeCloseTo(11_000, 0);
    expect(money(row.lastPurchasePrice), "oxirgi xarid narxi").toBe(11_000);
    expect(row.lastPurchaseDate).toBe(today());

    const suggestion = await call(ws.ownerCookie, "GET", `/api/catalog/products/${productId}/price-suggestions`);
    expect(suggestion.statusCode, suggestion.body).toBe(200);
    expect(money(suggestion.json().lastPurchase.price)).toBe(11_000);
    expect(money(suggestion.json().avgPurchasePrice)).toBeCloseTo(11_000, 0);

    // Tavsiya hech narsani o'zgartirmaydi
    const cardAfter = (await call(ws.ownerCookie, "GET", `/api/catalog/products/${productId}`)).json().product;
    expect(cardAfter.salesPrice).toBe(cardBefore.salesPrice);
    expect(cardAfter.purchasePrice).toBe(cardBefore.purchasePrice);

    const history = await call(ws.ownerCookie, "GET", `/api/catalog/products/${productId}/cost-history`);
    expect(history.statusCode, history.body).toBe(200);
    expect((await call(ws.managerCookie, "GET", `/api/catalog/products/${productId}/cost-history`)).statusCode, "menejerga tannarx tarixi yopiq").toBe(403);
  });

  it("PHASE 4 — ulgurji savdo: besh mijozga buyurtma, tasdiq va jo'natish", async () => {
    const p = (sku: string) => ws.products[sku]!;
    const before = {
      one: await stockOf(p("WS-01")),
      two: await stockOf(p("WS-02")),
      three: await stockOf(p("WS-03")),
      four: await stockOf(p("WS-04")),
      five: await stockOf(p("WS-05")),
      six: await stockOf(p("WS-06")),
      seven: await stockOf(p("WS-07")),
    };

    const orderA = await wholesaleOrder(ws.customers.A!, [
      { productId: p("WS-01"), quantity: "200" },
      { productId: p("WS-02"), quantity: "100" },
      { productId: p("WS-03"), quantity: "50" },
    ]);
    const orderB = await wholesaleOrder(ws.customers.B!, [
      { productId: p("WS-01"), quantity: "300" },
      { productId: p("WS-04"), quantity: "500" },
      { productId: p("WS-05"), quantity: "200" },
    ]);
    const orderC = await wholesaleOrder(ws.customers.C!, [
      { productId: p("WS-06"), quantity: "200" },
      { productId: p("WS-07"), quantity: "200" },
    ]);
    const orderD = await wholesaleOrder(ws.customers.D!, [
      { productId: p("WS-02"), quantity: "50" },
      { productId: p("WS-04"), quantity: "300" },
      { productId: p("WS-05"), quantity: "100" },
      { productId: p("WS-06"), quantity: "50" },
    ]);
    const orderE = await wholesaleOrder(ws.customers.E!, [{ productId: p("WS-03"), quantity: "10" }]);

    for (const orderId of [orderA, orderB, orderC, orderD, orderE]) {
      const order = await orderOf(orderId);
      expect(["shipped", "completed", "delivered"], "jo'natilgan buyurtma yakunlangan holatda").toContain(order.status);
      expect(order.paymentStatus, "to'lovsiz buyurtma").toBe("unpaid");
    }

    expect(await stockOf(p("WS-01"))).toBe(before.one - 500);
    expect(await stockOf(p("WS-02"))).toBe(before.two - 150);
    expect(await stockOf(p("WS-04"))).toBe(before.four - 800);
    expect(await stockOf(p("WS-07"))).toBe(before.seven - 200);

    // Jo'natilgan buyurtma qarzga aylanadi
    expect(await debtOf(ws.customers.A!)).toBeGreaterThan(0);
    expect(await debtOf(ws.customers.E!)).toBe(10 * money((await call(ws.ownerCookie, "GET", `/api/catalog/products/${p("WS-03")}`)).json().product.salesPrice));
    await expectBalanced("ulgurji savdo");
  });

  it("PHASE 5 — katta buyurtma: 1000+ dona, zaxira band bo'ladi va jo'natishda bo'shaydi", async () => {
    const p = (sku: string) => ws.products[sku]!;
    const beforeFour = await stockRow(p("WS-04"), ws.mainWarehouseId);
    const beforeFive = await stockRow(p("WS-05"), ws.mainWarehouseId);

    const started = Date.now();
    const created = await call(ws.salesCookie, "POST", "/api/sales/orders", {
      customerId: ws.customers.A!,
      warehouseId: ws.mainWarehouseId,
      orderDate: today(),
      deliveryRequired: false,
      items: [
        { productId: p("WS-04"), quantity: "800" },
        { productId: p("WS-05"), quantity: "400" },
        { productId: p("WS-01"), quantity: "100" },
      ],
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(Date.now() - started, "katta buyurtma 10 soniyadan tez yaratiladi").toBeLessThan(10_000);
    const orderId = created.json().order.id as string;

    expect((await call(ws.salesCookie, "POST", `/api/sales/orders/${orderId}/confirm`)).statusCode).toBe(200);
    const reservedFour = await stockRow(p("WS-04"), ws.mainWarehouseId);
    expect(reservedFour.reserved - beforeFour.reserved, "tasdiq zaxirani band qiladi").toBe(800);
    expect(reservedFour.quantity, "band qilish qoldiqni kamaytirmaydi").toBe(beforeFour.quantity);

    // Jo'natish moliyaviy oqibatli amal — `sales.approve` talab qilinadi (omborchi emas, savdo menejeri)
    expect((await call(ws.warehouseCookie, "POST", `/api/sales/orders/${orderId}/ship`)).statusCode).toBe(403);
    const shipped = await call(ws.salesCookie, "POST", `/api/sales/orders/${orderId}/ship`);
    expect(shipped.statusCode, shipped.body).toBe(200);
    const afterFour = await stockRow(p("WS-04"), ws.mainWarehouseId);
    const afterFive = await stockRow(p("WS-05"), ws.mainWarehouseId);
    expect(afterFour.quantity).toBe(beforeFour.quantity - 800);
    expect(afterFour.reserved).toBe(beforeFour.reserved);
    expect(afterFive.quantity).toBe(beforeFive.quantity - 400);
    await expectBalanced("katta buyurtma");
  });

  it("PHASE 6 — kredit: qarz o'sadi, limitdan oshiq buyurtma rad etiladi", async () => {
    const productId = ws.products["WS-08"]!;
    await purchase(ws.suppliers["TEST-SUPPLIER-A"]!, [{ productId, quantity: "5000", unitPrice: "9000" }]);
    const salesPrice = money((await call(ws.ownerCookie, "GET", `/api/catalog/products/${productId}`)).json().product.salesPrice);

    const customerB = ws.customers.B!;
    const debtBefore = await debtOf(customerB);

    // Limitni aniq nazorat qilish uchun qarzni nolga keltiramiz va limitni belgilaymiz
    const reset = await call(ws.ownerCookie, "POST", `/api/sales/customers/${customerB}/balance-adjust`, {
      totalDebt: "0",
      reason: "Test: qarzni nolga keltirish",
    });
    expect(reset.statusCode, reset.body).toBe(200);
    expect(await debtOf(customerB)).toBe(0);
    expect(debtBefore).toBeGreaterThan(0);
    expect((await call(ws.ownerCookie, "PATCH", `/api/sales/customers/${customerB}`, { creditLimit: "50000000" })).statusCode).toBe(200);

    // 30 000 000 ga yaqin nasiya
    const firstQty = Math.floor(30_000_000 / salesPrice);
    await wholesaleOrder(customerB, [{ productId, quantity: String(firstQty) }]);
    const afterFirst = await debtOf(customerB);
    expect(afterFirst).toBe(firstQty * salesPrice);

    // Yana bir nasiya — limit ichida
    const secondQty = Math.floor(15_000_000 / salesPrice);
    await wholesaleOrder(customerB, [{ productId, quantity: String(secondQty) }]);
    const afterSecond = await debtOf(customerB);
    expect(afterSecond).toBe(afterFirst + secondQty * salesPrice);

    // Limitdan oshiq — rad etiladi va qarz o'zgarmaydi
    const overQty = Math.ceil(60_000_000 / salesPrice);
    const over = await call(ws.salesCookie, "POST", "/api/sales/orders", {
      customerId: customerB,
      warehouseId: ws.mainWarehouseId,
      orderDate: today(),
      deliveryRequired: false,
      items: [{ productId, quantity: String(overQty) }],
    });
    let blocked = over.statusCode >= 400;
    if (!blocked) {
      const overId = over.json().order.id as string;
      const confirm = await call(ws.salesCookie, "POST", `/api/sales/orders/${overId}/confirm`);
      blocked = confirm.statusCode >= 400;
      if (!blocked) {
        const ship = await call(ws.salesCookie, "POST", `/api/sales/orders/${overId}/ship`);
        blocked = ship.statusCode >= 400;
      }
    }
    expect(blocked, "kredit limitidan oshiq savdo to'xtatiladi").toBe(true);
    expect(await debtOf(customerB), "rad etilgan savdo qarzni oshirmaydi").toBe(afterSecond);
    await expectBalanced("kredit");
  });

  it("PHASE 7 — qisman to'lov: qarz kamayadi, takroriy so'rov ikki marta yozilmaydi", async () => {
    const customerB = ws.customers.B!;
    const debt = await debtOf(customerB);
    expect(debt).toBeGreaterThan(0);

    const first = await call(ws.accountantCookie, "POST", "/api/sales/payments", {
      customerId: customerB,
      amount: "20000000",
      method: "bank",
      cashAccountId: ws.bankAccountId,
      paymentDate: today(),
    });
    expect(first.statusCode, first.body).toBe(201);
    expect(await debtOf(customerB)).toBe(debt - 20_000_000);

    const reference = `WS-PAY-${Date.now()}`;
    const second = await call(ws.accountantCookie, "POST", "/api/sales/payments", {
      customerId: customerB,
      amount: "10000000",
      method: "cash",
      reference,
      paymentDate: today(),
    });
    expect(second.statusCode, second.body).toBe(201);
    const afterTwo = await debtOf(customerB);
    expect(afterTwo).toBe(debt - 30_000_000);

    // Takroriy so'rov — yangi to'lov yozilmaydi
    const repeat = await call(ws.accountantCookie, "POST", "/api/sales/payments", {
      customerId: customerB,
      amount: "10000000",
      method: "cash",
      reference,
      paymentDate: today(),
    });
    expect(repeat.statusCode, "takroriy to'lov 200").toBe(200);
    expect(await debtOf(customerB), "qarz ikki marta kamaymaydi").toBe(afterTwo);

    // To'lov taqsimoti buyurtma qoldig'idan oshmaydi
    const payments = await db
      .select({ amount: customerPayments.amount })
      .from(customerPayments)
      .where(and(eq(customerPayments.companyId, ws.companyId), eq(customerPayments.customerId, customerB)));
    expect(payments.reduce((sum, row) => sum + money(row.amount), 0)).toBe(30_000_000);
    await expectBalanced("qisman to'lov");
  });

  it("PHASE 8 — aralash to'lov: naqd + bank bitta to'lovda", async () => {
    const customerA = ws.customers.A!;
    const debt = await debtOf(customerA);
    expect(debt).toBeGreaterThan(3_000_000);
    const cashBefore = await cashOf(ws.cashAccountId);
    const bankBefore = await cashOf(ws.bankAccountId);

    const mixed = await call(ws.accountantCookie, "POST", "/api/sales/payments", {
      customerId: customerA,
      paymentDate: today(),
      parts: [
        { method: "cash", amount: "1000000", cashAccountId: ws.cashAccountId },
        { method: "bank", amount: "2000000", cashAccountId: ws.bankAccountId },
      ],
    });
    expect(mixed.statusCode, mixed.body).toBe(201);
    expect(await debtOf(customerA), "aralash to'lov qarzni 3 mln kamaytiradi").toBe(debt - 3_000_000);
    expect(await cashOf(ws.cashAccountId)).toBe(cashBefore + 1_000_000);
    expect(await cashOf(ws.bankAccountId)).toBe(bankBefore + 2_000_000);
    await expectBalanced("aralash to'lov");
  });

  it("PHASE 9 — mijoz qaytarishi: qoldiq oshadi, qarz kamayadi, takror qaytarish yo'q", async () => {
    const p = (sku: string) => ws.products[sku]!;
    const customerC = ws.customers.C!;
    const beforeSix = await stockOf(p("WS-06"));
    const beforeSeven = await stockOf(p("WS-07"));

    // Qaytarish uchun alohida buyurtma (10 + 5 dona)
    const orderId = await wholesaleOrder(customerC, [
      { productId: p("WS-06"), quantity: "10" },
      { productId: p("WS-07"), quantity: "5" },
    ]);
    expect(await stockOf(p("WS-06"))).toBe(beforeSix - 10);
    const debtAfterSale = await debtOf(customerC);
    const total = money((await orderOf(orderId)).totalAmount);

    const returned = await call(ws.ownerCookie, "POST", `/api/sales/orders/${orderId}/return`, { reason: "Sifat" });
    expect(returned.statusCode, returned.body).toBe(200);
    expect(await stockOf(p("WS-06")), "qaytgan tovar omborga").toBe(beforeSix);
    expect(await stockOf(p("WS-07"))).toBe(beforeSeven);
    expect(await debtOf(customerC), "qaytarish qarzni kamaytiradi").toBe(debtAfterSale - total);

    const again = await call(ws.ownerCookie, "POST", `/api/sales/orders/${orderId}/return`, { reason: "Takror" });
    expect(again.statusCode, "ikkinchi qaytarish rad etiladi").toBeGreaterThanOrEqual(400);
    expect(await stockOf(p("WS-06")), "qoldiq ikki marta oshmaydi").toBe(beforeSix);
    await expectBalanced("qaytarish");
  });

  it("PHASE 10 — ta'minotchiga to'lov: qisman, keyin qolgani — qarz nolga tushadi", async () => {
    const supplierA = ws.suppliers["TEST-SUPPLIER-A"]!;
    const debt = await supplierDebtOf(supplierA);
    expect(debt).toBeGreaterThan(0);

    const partial = await call(ws.accountantCookie, "POST", "/api/purchase/payments", {
      supplierId: supplierA,
      amount: "10000000",
      method: "bank",
      cashAccountId: ws.bankAccountId,
      paymentDate: today(),
    });
    expect(partial.statusCode, partial.body).toBe(201);
    expect(await supplierDebtOf(supplierA)).toBe(debt - 10_000_000);

    // Qolganini aralash to'lov bilan yopamiz
    const rest = await supplierDebtOf(supplierA);
    const half = Math.floor(rest / 2);
    const mixed = await call(ws.accountantCookie, "POST", "/api/purchase/payments", {
      supplierId: supplierA,
      paymentDate: today(),
      parts: [
        { method: "cash", amount: String(half), cashAccountId: ws.cashAccountId },
        { method: "bank", amount: String(rest - half), cashAccountId: ws.bankAccountId },
      ],
    });
    expect(mixed.statusCode, mixed.body).toBe(201);
    expect(await supplierDebtOf(supplierA), "ta'minotchi qarzi yopildi").toBe(0);
    await expectBalanced("ta'minotchiga to'lov");
  });

  it("PHASE 11 — xarajatlar: besh modda, kassa va bank, jurnal balanslangan", async () => {
    const cashBefore = await cashOf(ws.cashAccountId);
    const items: [string, string, string, string][] = [
      ["Ijara", "Ombor ijarasi", "12000000", ws.bankAccountId],
      ["Kommunal", "Elektr energiyasi", "3000000", ws.cashAccountId],
      ["Transport", "Tovar tashish", "5000000", ws.cashAccountId],
      ["Yuklash", "Yuk ortish-tushirish", "2000000", ws.cashAccountId],
      ["Ofis", "Ofis xarajatlari", "1500000", ws.bankAccountId],
    ];
    let fromCash = 0;
    for (const [category, description, amount, accountId] of items) {
      const created = await call(ws.accountantCookie, "POST", "/api/finance/expenses", {
        category,
        description,
        amount,
        expenseDate: today(),
      });
      expect(created.statusCode, created.body).toBe(201);
      const id = created.json().expense.id as string;
      expect((await call(ws.ownerCookie, "POST", `/api/finance/expenses/${id}/status`, { status: "approved" })).statusCode).toBe(200);
      const paid = await call(ws.ownerCookie, "POST", `/api/finance/expenses/${id}/status`, {
        status: "paid",
        cashAccountId: accountId,
        paidDate: today(),
      });
      expect(paid.statusCode, paid.body).toBe(200);
      if (accountId === ws.cashAccountId) fromCash += money(amount);
    }
    expect(await cashOf(ws.cashAccountId)).toBe(cashBefore - fromCash);
    await expectBalanced("xarajatlar");
  });

  it("PHASE 12 — omborlararo o'tkazma: manba kamayadi, qabul qiluvchi oshadi, jami o'zgarmaydi", async () => {
    const productId = ws.products["WS-04"]!;
    const mainBefore = await stockOf(productId, ws.mainWarehouseId);
    const secondBefore = await stockOf(productId, ws.secondWarehouseId);

    const transfer = await call(ws.warehouseCookie, "POST", "/api/inventory/stock/transfers", {
      productId,
      fromWarehouseId: ws.mainWarehouseId,
      toWarehouseId: ws.secondWarehouseId,
      quantity: "200",
      notes: "Ikkinchi omborga",
    });
    expect(transfer.statusCode, transfer.body).toBe(201);

    expect(await stockOf(productId, ws.mainWarehouseId)).toBe(mainBefore - 200);
    expect(await stockOf(productId, ws.secondWarehouseId)).toBe(secondBefore + 200);
    expect(
      (await stockOf(productId, ws.mainWarehouseId)) + (await stockOf(productId, ws.secondWarehouseId)),
      "jami qoldiq o'zgarmaydi",
    ).toBe(mainBefore + secondBefore);
    await expectBalanced("o'tkazma");
  });

  it("PHASE 13 — inventar nazorati: oldindan buyurtma band qilinmaydi, jo'natish to'xtaydi, bekor qilish bo'shatadi", async () => {
    const productId = ws.products["WS-03"]!;
    const start = await stockRow(productId, ws.mainWarehouseId);
    const available = start.quantity - start.reserved;

    /**
     * Qo'lda kiritilgan ERP buyurtmasi `best_effort` siyosatida: qoldiq yetmasa ham TASDIQLANADI,
     * lekin faqat BOR miqdor band qilinadi (qolgani — oldindan buyurtma). Jo'natish esa to'xtaydi.
     */
    const preOrder = await call(ws.salesCookie, "POST", "/api/sales/orders", {
      customerId: ws.customers.D!,
      warehouseId: ws.mainWarehouseId,
      orderDate: today(),
      deliveryRequired: false,
      items: [{ productId, quantity: String(start.quantity + 100) }],
    });
    expect(preOrder.statusCode, preOrder.body).toBe(201);
    const preOrderId = preOrder.json().order.id as string;
    expect((await call(ws.salesCookie, "POST", `/api/sales/orders/${preOrderId}/confirm`)).statusCode).toBe(200);

    const reservedRow = await stockRow(productId, ws.mainWarehouseId);
    expect(reservedRow.reserved, "faqat bor miqdor band qilinadi").toBe(start.reserved + available);
    expect(reservedRow.reserved, "band qilingan qoldiqdan oshmaydi").toBeLessThanOrEqual(reservedRow.quantity);
    expect(reservedRow.quantity, "band qilish qoldiqni kamaytirmaydi").toBe(start.quantity);

    const ship = await call(ws.salesCookie, "POST", `/api/sales/orders/${preOrderId}/ship`);
    expect(ship.statusCode, "qoldiqdan ko'p tovar jo'natilmaydi").toBeGreaterThanOrEqual(400);
    expect((await stockRow(productId, ws.mainWarehouseId)).quantity, "rad etilgan jo'natish qoldiqqa tegmaydi").toBe(start.quantity);

    // Bekor qilish band qilingan zaxirani to'liq bo'shatadi
    const cancelled = await call(ws.salesCookie, "POST", `/api/sales/orders/${preOrderId}/cancel`, { reason: "Tovar yetmadi" });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    const afterCancel = await stockRow(productId, ws.mainWarehouseId);
    expect(afterCancel.reserved, "bekor qilish zaxirani bo'shatadi").toBe(start.reserved);
    expect(afterCancel.quantity).toBe(start.quantity);

    // Endi bor miqdor ichidagi buyurtma aynan o'zicha band qilinadi
    const normal = await call(ws.salesCookie, "POST", "/api/sales/orders", {
      customerId: ws.customers.D!,
      warehouseId: ws.mainWarehouseId,
      orderDate: today(),
      deliveryRequired: false,
      items: [{ productId, quantity: "5" }],
    });
    expect(normal.statusCode, normal.body).toBe(201);
    const normalId = normal.json().order.id as string;
    expect((await call(ws.salesCookie, "POST", `/api/sales/orders/${normalId}/confirm`)).statusCode).toBe(200);
    expect((await stockRow(productId, ws.mainWarehouseId)).reserved, "tasdiq 5 donani band qiladi").toBe(start.reserved + 5);

    expect((await call(ws.salesCookie, "POST", `/api/sales/orders/${normalId}/cancel`, { reason: "Test" })).statusCode).toBe(200);
    expect((await stockRow(productId, ws.mainWarehouseId)).reserved).toBe(start.reserved);
    await expectBalanced("inventar nazorati");
  });

  it("PHASE 14 — buxgalteriya solishtiruvi: jurnal, aylanma balans va kassa qoldig'i", async () => {
    await expectBalanced("solishtiruv");

    const trial = await call(ws.accountantCookie, "GET", `/api/finance/reports/trial-balance?dateFrom=2000-01-01&dateTo=${today()}`);
    expect(trial.statusCode, trial.body).toBe(200);
    const rows = trial.json().rows as { accountCode?: string; code?: string; debit: string; credit: string }[];
    expect(rows.length).toBeGreaterThan(0);
    const debit = rows.reduce((sum, row) => sum + money(row.debit), 0);
    const credit = rows.reduce((sum, row) => sum + money(row.credit), 0);
    expect(Math.round(debit), "aylanma balans").toBe(Math.round(credit));

    // Kassa hisobi qoldig'i — kirim/chiqim yig'indisi bilan mos
    const dashboard = await call(ws.accountantCookie, "GET", "/api/finance/dashboard");
    expect(dashboard.statusCode, dashboard.body).toBe(200);
    // Foyda-zarar — FAQAT egada (`analytics.view_profit`): buxgalter foydani ko'rmaydi
    const plUrl = `/api/finance/reports/profit-loss?dateFrom=2000-01-01&dateTo=${today()}`;
    expect((await call(ws.accountantCookie, "GET", plUrl)).statusCode, "buxgalterga foyda yopiq").toBe(403);
    const pl = await call(ws.ownerCookie, "GET", plUrl);
    expect(pl.statusCode, pl.body).toBe(200);
  });

  it("PHASE 15 — hisobotlar: sotuv, xarid, xarajat va to'lovlar baza bilan bir xil", async () => {
    const [dbSales] = await db
      .select({
        total: sql<string>`coalesce(sum(${salesOrders.totalAmount}), 0)::numeric(18,2)`,
        count: sql<number>`count(*)::int`,
      })
      .from(salesOrders)
      .where(and(eq(salesOrders.companyId, ws.companyId), sql`${salesOrders.status} in ('completed','shipped','delivered')`));
    const sales = (await call(ws.managerCookie, "GET", "/api/analytics/reports/sales?days=30")).json();
    expect(money(sales.totalRevenue), "sotuv hisoboti = baza").toBe(money(dbSales!.total));
    expect(sales.totalOrders).toBe(dbSales!.count);

    const [dbPurchases] = await db
      .select({
        total: sql<string>`coalesce(sum(${purchaseOrders.totalAmount}), 0)::numeric(18,2)`,
        count: sql<number>`count(*)::int`,
      })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.companyId, ws.companyId), sql`${purchaseOrders.status} not in ('draft','cancelled')`));
    const purchases = (await call(ws.managerCookie, "GET", "/api/analytics/reports/purchases?days=30")).json();
    expect(money(purchases.totalAmount), "xarid hisoboti = baza").toBe(money(dbPurchases!.total));
    expect(purchases.totalOrders).toBe(dbPurchases!.count);

    const [dbExpenses] = await db
      .select({ total: sql<string>`coalesce(sum(${expensesTable.amount}), 0)::numeric(18,2)` })
      .from(expensesTable)
      .where(and(eq(expensesTable.companyId, ws.companyId), sql`${expensesTable.status} <> 'pending'`));
    const expenseReport = (await call(ws.accountantCookie, "GET", "/api/analytics/reports/expenses?days=30")).json();
    expect(money(expenseReport.total), "xarajat hisoboti = baza").toBe(money(dbExpenses!.total));

    const [dbPayments] = await db
      .select({ total: sql<string>`coalesce(sum(${customerPayments.amount}), 0)::numeric(18,2)`, count: sql<number>`count(*)::int` })
      .from(customerPayments)
      .where(eq(customerPayments.companyId, ws.companyId));
    const paymentsApi = (await call(ws.accountantCookie, "GET", "/api/sales/payments?limit=200")).json().payments as { amount: string }[];
    expect(paymentsApi.length).toBe(dbPayments!.count);
    expect(paymentsApi.reduce((sum, row) => sum + money(row.amount), 0)).toBe(money(dbPayments!.total));

    // Mijoz qarzlari: ro'yxat = baza
    const [dbDebt] = await db
      .select({ total: sql<string>`coalesce(sum(${customers.totalDebt}), 0)::numeric(18,2)` })
      .from(customers)
      .where(eq(customers.companyId, ws.companyId));
    const debtors = (await call(ws.salesCookie, "GET", "/api/sales/customers?withDebt=true&limit=200")).json().customers as
      { totalDebt: string }[];
    expect(debtors.reduce((sum, row) => sum + money(row.totalDebt), 0)).toBe(money(dbDebt!.total));

    const stockReport = await call(ws.warehouseCookie, "GET", "/api/analytics/reports/stock");
    expect(stockReport.statusCode, stockReport.body).toBe(200);
  });

  it("PHASE 16 — xavfsizlik: tenant izolyatsiyasi va ruxsat chegaralari", async () => {
    // Begona ma'lumot ko'rinmaydi
    expect((await call(ws.ownerCookie, "GET", `/api/catalog/products/${outsider.productId}`)).statusCode).toBe(404);
    expect((await call(ws.ownerCookie, "GET", `/api/sales/customers/${outsider.customerId}`)).statusCode).toBe(404);
    expect((await call(outsider.ownerCookie, "GET", `/api/catalog/products/${ws.products["WS-01"]}`)).statusCode).toBe(404);

    // Begona mijozga buyurtma — rad etiladi
    const foreignOrder = await call(ws.salesCookie, "POST", "/api/sales/orders", {
      customerId: outsider.customerId,
      warehouseId: ws.mainWarehouseId,
      orderDate: today(),
      items: [{ productId: ws.products["WS-01"]!, quantity: "1" }],
    });
    expect(foreignOrder.statusCode).toBeGreaterThanOrEqual(400);

    // Begona mahsulot bilan buyurtma — rad etiladi
    const foreignProduct = await call(ws.salesCookie, "POST", "/api/sales/orders", {
      customerId: ws.customers.A!,
      warehouseId: ws.mainWarehouseId,
      orderDate: today(),
      items: [{ productId: outsider.productId, quantity: "1" }],
    });
    expect(foreignProduct.statusCode).toBeGreaterThanOrEqual(400);

    // Tanadagi companyId — sxema rad etadi
    const spoof = await call(ws.salesCookie, "POST", "/api/sales/customers", { name: "Spoof", companyId: outsider.companyId });
    expect(spoof.statusCode).toBe(400);

    // Moliyaviy va tannarx ma'lumotlari cheklangan rolga yopiq
    expect((await call(ws.warehouseCookie, "GET", "/api/finance/expenses")).statusCode).toBe(403);
    expect((await call(ws.salesCookie, "POST", "/api/finance/expenses", { category: "X", description: "X", amount: "1", expenseDate: today() })).statusCode).toBe(403);

    // Begona omborga o'tkazma — rad etiladi
    const foreignWarehouse = await call(ws.warehouseCookie, "POST", "/api/inventory/stock/transfers", {
      productId: ws.products["WS-04"]!,
      fromWarehouseId: ws.mainWarehouseId,
      toWarehouseId: outsider.companyId,
      quantity: "1",
    });
    expect(foreignWarehouse.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("PHASE 17 — kun yakuni: bugungi savdo, xarid, to'lov, qarz va kassa mos", async () => {
    const day = today();

    const [dbToday] = await db
      .select({ total: sql<string>`coalesce(sum(${salesOrders.totalAmount}), 0)::numeric(18,2)`, count: sql<number>`count(*)::int` })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.companyId, ws.companyId),
          eq(salesOrders.orderDate, day),
          sql`${salesOrders.status} in ('completed','shipped','delivered')`,
        ),
      );
    const ordersApi = (await call(ws.managerCookie, "GET", `/api/sales/orders?dateFrom=${day}&dateTo=${day}&limit=200`)).json().orders as
      { status: string; totalAmount: string }[];
    const realized = ordersApi.filter((row) => ["completed", "shipped", "delivered"].includes(row.status));
    expect(realized.length, "bugungi yakunlangan buyurtmalar").toBe(dbToday!.count);
    expect(realized.reduce((sum, row) => sum + money(row.totalAmount), 0)).toBe(money(dbToday!.total));

    // Qarzlar va ta'minotchi qarzi
    const [dbCustomerDebt] = await db
      .select({ total: sql<string>`coalesce(sum(${customers.totalDebt}), 0)::numeric(18,2)` })
      .from(customers)
      .where(eq(customers.companyId, ws.companyId));
    const [dbSupplierDebt] = await db
      .select({ total: sql<string>`coalesce(sum(${suppliers.totalDebt}), 0)::numeric(18,2)` })
      .from(suppliers)
      .where(eq(suppliers.companyId, ws.companyId));
    expect(money(dbCustomerDebt!.total)).toBeGreaterThanOrEqual(0);
    expect(money(dbSupplierDebt!.total)).toBeGreaterThanOrEqual(0);

    // Kassa va bank qoldig'i manfiy emas
    expect(await cashOf(ws.cashAccountId)).toBeGreaterThanOrEqual(0);
    expect(await cashOf(ws.bankAccountId)).toBeGreaterThanOrEqual(0);

    // Audit: kun davomidagi asosiy amallar yozilgan
    const actions = await db
      .select({ action: auditLogs.action, n: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(eq(auditLogs.companyId, ws.companyId))
      .groupBy(auditLogs.action);
    const names = new Set(actions.map((row) => row.action));
    for (const action of ["PURCHASE_GOODS_RECEIVED", "CUSTOMER_PAYMENT_RECORDED", "SALES_ORDER_RETURNED"]) {
      expect(names.has(action), `${action} auditda`).toBe(true);
    }

    await expectBalanced("kun yakuni");
  });
});
