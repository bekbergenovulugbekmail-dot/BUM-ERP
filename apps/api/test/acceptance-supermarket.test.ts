/**
 * BUSINESS 02 — SUPERMARKET 0 → 100 (BONNU MARKET) — REAL BIZNES QABUL TESTI (2026-09-26).
 *
 * Izolyatsiyalangan TEST bazada (`resetDatabase` faqat `_test` bazada ishlaydi): BONNU MARKET (supermarket), begona
 * TEST MARKET va yakuniy senariy uchun alohida BONNU FINAL. Har moliyaviy qadamdan keyin: biznes hodisasi → baza → ombor →
 * mijoz/ta'minotchi qarzi (kesh = jurnal) → kassa/bank (kitob = hisob = 1010/1020) → jurnal (debet = kredit) → hisobot.
 * Kutilgan qiymatlar test ichida MUSTAQIL hisoblanadi (`book`), keyin bazadagi haqiqiy qiymat bilan tiyingacha solishtiriladi.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { batches, products, units } from "../src/db/schema/catalog.js";
import { accounts, cashAccounts, cashTransactions, journalEntries, journalLines } from "../src/db/schema/finance.js";
import { stockLevels, stockMovements, warehouses } from "../src/db/schema/inventory.js";
import { auditLogs } from "../src/db/schema/platform.js";
import { suppliers } from "../src/db/schema/purchase.js";
import { customerPayments, customers, posShifts, salesOrderItems, salesOrders, salesReturns } from "../src/db/schema/sales.js";
import { buildServer } from "../src/server.js";
import { NO_PROOFS, agentAction, assign, deliveryAgent, near, resetUnits, setPolicy, shop, startShift, taskForOrder } from "./delivery-setup.js";
import { addEmployee, createCompany, resetDatabase, signedIn, uniquePhone } from "./helpers.js";

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
let app: FastifyInstance;
let adminCookie: string;
let piece: string;
let block: string;
let kg: string;

const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const n = (value: string | number | null | undefined) => Number(value ?? 0);
const businessToday = () => new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
const PERIOD = () => `from=2000-01-01&to=${businessToday()}`;

/** EAN-13 nazorat raqami bilan (haqiqiy formatdagi shtrix-kod). */
function ean13(base12: string) {
  const digits = base12.padStart(12, "0").slice(0, 12);
  const sum = [...digits].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return digits + String((10 - (sum % 10)) % 10);
}

type Company = {
  companyId: string;
  owner: string;
  manager: string;
  cashier1: string;
  cashier2: string;
  storekeeper: string;
  mainWh: string;
  cash: string;
  bank: string;
  shift1: string;
  shift2: string;
  p: Record<string, string>;
  bar: Record<string, string>;
  s: Record<string, string>;
  c: Record<string, string>;
  orders: Record<string, string>;
};
const emptyCompany = (): Company => ({
  companyId: "", owner: "", manager: "", cashier1: "", cashier2: "", storekeeper: "", mainWh: "", cash: "", bank: "",
  shift1: "", shift2: "", p: {}, bar: {}, s: {}, c: {}, orders: {},
});
const B = emptyCompany();
/** POS-02: desktop kassa qurilmasi (token, kod, kassir, smena). */
const POS2 = { token: "", code: "", cashierId: "", shiftId: "", seq: 0 };
let cashier2Phone = "";
const device = (method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${POS2.token}` }, ...(payload ? { payload } : {}) });
const deviceOp = (type: string, payload: object) => ({ opId: randomUUID(), type, cashierId: POS2.cashierId, createdAt: new Date(Date.now() - 1000).toISOString(), payload });
async function push(ops: object[]) {
  const res = await device("POST", "/api/pos-device/push", { ops });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().results as { status: string; duplicate?: boolean; result?: Record<string, unknown>; error?: unknown }[];
}
const F = { owner: "", companyId: "", productId: "", barcode: "", warehouse: "" };

/** Mustaqil kitob: kassa, bank, sotuv, qaytarish, tannarx, xarajat. */
function makeBook() {
  return { cash: 0, bank: 0, grossSales: 0, discounts: 0, returns: 0, cogs: 0, opex: 0, cashFlow: [] as { label: string; amount: number }[], bankFlow: [] as { label: string; amount: number }[] };
}
const book = makeBook();

// ─── Baza holati ─────────────────────────────────────────────────────────────

async function balanceOf(cashAccountId: string) {
  const [row] = await db.select({ balance: cashAccounts.balance }).from(cashAccounts).where(eq(cashAccounts.id, cashAccountId));
  return n(row!.balance);
}
async function stockRow(productId: string, warehouseId: string) {
  const [row] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, warehouseId)));
  return row;
}
async function stockOf(productId: string, warehouseId = B.mainWh) {
  const row = await stockRow(productId, warehouseId);
  if (!row) return 0;
  expect(n(row.quantity), "manfiy qoldiq").toBeGreaterThanOrEqual(0);
  expect(n(row.reservedQty), "band >= 0").toBeGreaterThanOrEqual(0);
  expect(n(row.reservedQty), "band > qoldiq").toBeLessThanOrEqual(n(row.quantity));
  return n(row.quantity);
}
async function ledger(companyId: string, code: string) {
  const [row] = await db.select({ balance: accounts.balance }).from(accounts).where(and(eq(accounts.companyId, companyId), eq(accounts.code, code)));
  return n(row?.balance);
}
async function debtOf(customerId: string) {
  const [cache] = await db.select({ debt: customers.totalDebt }).from(customers).where(eq(customers.id, customerId));
  const [led] = await db
    .select({ debt: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)::numeric(18,2)` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalLines.partyType, "customer"), eq(journalLines.partyId, customerId), eq(accounts.subtype, "receivable"), eq(journalEntries.status, "posted")));
  expect(n(cache!.debt), "mijoz qarzi: kesh = jurnal").toBe(n(led!.debt));
  return n(cache!.debt);
}
async function supplierDebt(supplierId: string) {
  const [cache] = await db.select({ debt: suppliers.totalDebt }).from(suppliers).where(eq(suppliers.id, supplierId));
  const [led] = await db
    .select({ debt: sql<string>`coalesce(sum(${journalLines.credit} - ${journalLines.debit}), 0)::numeric(18,2)` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalLines.partyType, "supplier"), eq(journalLines.partyId, supplierId), eq(accounts.subtype, "payable"), eq(journalEntries.status, "posted")));
  expect(n(cache!.debt), "ta'minotchi qarzi: kesh = jurnal").toBe(n(led!.debt));
  return n(cache!.debt);
}
async function expectBalanced(companyId: string, label: string) {
  const unbalanced = await db
    .select({ entryId: journalLines.entryId })
    .from(journalLines)
    .where(eq(journalLines.companyId, companyId))
    .groupBy(journalLines.entryId)
    .having(sql`sum(${journalLines.debit}) <> sum(${journalLines.credit})`);
  expect(unbalanced, `${label}: balanslanmagan jurnal yozuvi`).toHaveLength(0);
  const [tot] = await db
    .select({ d: sql<string>`coalesce(sum(${journalLines.debit}), 0)::numeric(18,2)`, c: sql<string>`coalesce(sum(${journalLines.credit}), 0)::numeric(18,2)` })
    .from(journalLines)
    .where(eq(journalLines.companyId, companyId));
  expect(tot!.d, `${label}: jami debet = kredit`).toBe(tot!.c);
}
/** 1200 hisobi = Σ qoldiq × AVCO (tiyingacha). */
async function inventoryValue(companyId: string) {
  const [row] = await db
    .select({ value: sql<string>`coalesce(sum(round(${stockLevels.quantity} * ${stockLevels.avgCostPrice}, 2)), 0)::numeric(18,2)` })
    .from(stockLevels)
    .where(eq(stockLevels.companyId, companyId));
  return n(row!.value);
}
async function expectInventoryValue(companyId: string, label: string, expected: number | null = null) {
  const value = await inventoryValue(companyId);
  expect(Math.abs((await ledger(companyId, "1200")) - value), `${label}: 1200 = Σ qoldiq × AVCO (${value})`).toBeLessThanOrEqual(0.05);
  if (expected !== null) expect(value, `${label}: ombor qiymati`).toBeCloseTo(expected, 1);
}
function cashMove(label: string, amount: number) {
  book.cash += amount;
  book.cashFlow.push({ label, amount });
}
function bankMove(label: string, amount: number) {
  book.bank += amount;
  book.bankFlow.push({ label, amount });
}
async function expectMoney(label: string) {
  expect(await balanceOf(B.cash), `${label}: kassa`).toBe(book.cash);
  expect(await balanceOf(B.bank), `${label}: bank`).toBe(book.bank);
  expect(await ledger(B.companyId, "1010"), `${label}: 1010 = kassa`).toBe(book.cash);
  expect(await ledger(B.companyId, "1020"), `${label}: 1020 = bank`).toBe(book.bank);
}
const journalCount = async (companyId: string) => {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(journalEntries).where(eq(journalEntries.companyId, companyId));
  return row!.n;
};

// ─── Biznes amallari ─────────────────────────────────────────────────────────

async function createOrder(company: Company, supplierId: string, lines: { productId: string; qty: string; price: string; unitId?: string }[]) {
  const created = await call(company.owner, "POST", "/api/purchase/orders", {
    supplierId,
    warehouseId: company.mainWh,
    orderDate: businessToday(),
    items: lines.map((line) => ({ productId: line.productId, unitId: line.unitId ?? piece, orderedQty: line.qty, unitPrice: line.price })),
  });
  expect(created.statusCode, created.body).toBe(201);
  const order = created.json().order as { id: string; totalAmount: string; items: { id: string; productId: string; unitId: string }[] };
  expect((await call(company.owner, "POST", `/api/purchase/orders/${order.id}/confirm`)).statusCode).toBe(200);
  return order;
}
async function receive(company: Company, orderId: string, items: { orderItemId: string; receivedQty: string; batchNumber?: string; expiryDate?: string }[], extra: object = {}) {
  return call(company.owner, "POST", `/api/purchase/orders/${orderId}/receipts`, { receiptDate: businessToday(), items, ...extra });
}
async function purchase(company: Company, supplierId: string, lines: { productId: string; qty: string; price: string; unitId?: string }[]) {
  const order = await createOrder(company, supplierId, lines);
  const res = await receive(company, order.id, order.items.map((item) => ({ orderItemId: item.id, receivedQty: lines.find((line) => line.productId === item.productId && (line.unitId ?? piece) === item.unitId)!.qty })));
  expect(res.statusCode, res.body).toBe(201);
  return order;
}
const pos = (payload: object, cookie = B.cashier1, shiftId = B.shift1) => call(cookie, "POST", "/api/sales/pos/sales", { shiftId, ...payload });

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
  await resetDatabase();
  await resetUnits();
  adminCookie = (await signedIn(app, { isPlatformAdmin: true })).cookie;
  piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  block = (await db.select().from(units).where(eq(units.shortName, "bl")))[0]!.id;
  kg = (await db.select().from(units).where(eq(units.shortName, "kg")))[0]!.id;
}, 120_000);

afterAll(async () => {
  await app.close();
  await closeDb();
});

// Asortiment: [kalit, nomi, kategoriya, brend, sotuv narxi, kirim narxi]
const ASSORTMENT: [string, string, string, string, string, string][] = [
  ["COLA", "Coca Cola 1L", "DRINKS", "Coca-Cola", "15000", "10000"],
  ["PEPSI", "Pepsi 1L", "DRINKS", "PepsiCo", "14000", "9000"],
  ["FANTA", "Fanta 1L", "DRINKS", "Coca-Cola", "14000", "9000"],
  ["WATER", "Mineral suv 0.5L (Nestle)", "DRINKS", "Nestle", "12000", "10000"],
  ["JUICE", "Sharbat Bella 1L", "DRINKS", "Bella", "18000", "12000"],
  ["TEA", "Choy Ahmad 100g", "FOOD", "Ahmad", "25000", "18000"],
  ["RICE", "Guruch Lazer 1kg", "FOOD", "Lazer", "22000", "16000"],
  ["SUGAR", "Shakar 1kg", "FOOD", "Local", "15000", "11000"],
  ["OIL", "Yog' Oltin 1L", "FOOD", "Oltin", "32000", "25000"],
  ["PASTA", "Makaron Makfa", "FOOD", "Makfa", "12000", "8000"],
  ["SOAP", "Sovun Dove", "PERSONAL CARE", "Dove", "15000", "10000"],
  ["SHAMPOO", "Shampun Head&Shoulders", "PERSONAL CARE", "P&G", "45000", "33000"],
  ["PASTE", "Tish pastasi Colgate", "PERSONAL CARE", "Colgate", "18000", "12000"],
  ["CREAM", "Krem Nivea", "COSMETICS", "Nivea", "55000", "40000"],
  ["LIPSTICK", "Lab bo'yog'i Maybelline", "COSMETICS", "Maybelline", "80000", "60000"],
  ["DETERG", "Kir kukuni Ariel 3kg", "HOUSEHOLD", "P&G", "95000", "70000"],
  ["DISH", "Idish yuvish Fairy", "HOUSEHOLD", "P&G", "25000", "17000"],
  ["NAPKIN", "Salfetka Zewa", "HOUSEHOLD", "Zewa", "8000", "5000"],
  ["CHIPS", "Chips Lays 80g", "SNACKS", "Lays", "12000", "8000"],
  ["CHOCO", "Shokolad Snickers", "SNACKS", "Mars", "9000", "6000"],
  ["BISCUIT", "Pechenye Oreo", "SNACKS", "Mondelez", "11000", "7500"],
  ["MILK", "Sut Nestle 1L", "DAIRY", "Nestle", "14000", "10500"],
  ["KEFIR", "Kefir 1L", "DAIRY", "Local", "12000", "9000"],
  ["CHEESE", "Pishloq Gauda 200g", "DAIRY", "Local", "35000", "27000"],
  ["BREAD", "Non", "BAKERY", "Local", "4000", "2800"],
  ["CAKE", "Keks", "BAKERY", "Local", "20000", "14000"],
  ["ICECREAM", "Muzqaymoq Eskimo", "FROZEN", "Local", "8000", "5500"],
  ["PELMENI", "Chuchvara 1kg", "FROZEN", "Local", "45000", "34000"],
  ["TUNA", "Tunets konserva", "CANNED", "Local", "28000", "20000"],
  ["BEANS", "Loviya konserva", "CANNED", "Local", "14000", "9500"],
  ["DIAPER", "Tagliklar Pampers", "BABY", "P&G", "180000", "140000"],
  ["BABYFOOD", "Bolalar pyuresi", "BABY", "Nestle", "16000", "11500"],
  ["BATTERY", "Batareyka Duracell", "OTHER", "Duracell", "30000", "21000"],
  ["LIGHTER", "Zajigalka", "OTHER", "Local", "3000", "1800"],
  ["TV", "Televizor (kattaa summa)", "OTHER", "Samsung", "1000000", "800000"],
  ["GUM", "Saqich Orbit", "SNACKS", "Mars", "5000", "3200"],
  ["YOGURT", "Yogurt Danone", "DAIRY", "Danone", "9000", "6500"],
  ["COFFEE", "Kofe Nescafe 3in1", "FOOD", "Nestle", "3000", "2000"],
  ["MUSTARD", "Xantal", "CANNED", "Local", "10000", "7000"],
  ["TOWEL", "Qog'oz sochiq", "HOUSEHOLD", "Zewa", "12000", "8000"],
];
const CATEGORIES = ["FOOD", "DRINKS", "HOUSEHOLD", "PERSONAL CARE", "COSMETICS", "SNACKS", "DAIRY", "BAKERY", "FROZEN", "CANNED", "BABY", "OTHER"];

describe("SUPERMARKET 0→100 — BONNU MARKET", () => {
  it("S01 — bootstrap: BONNU MARKET + TEST MARKET, MAIN WAREHOUSE, xodimlar, kassa 10 mln / bank 20 mln, POS-01/POS-02 smenalari", async () => {
    const company = await createCompany(app, adminCookie, { name: "BONNU MARKET" });
    const foreign = await createCompany(app, adminCookie, { name: "TEST MARKET" });
    B.companyId = company.companyId;
    B.owner = company.ownerCookie;
    F.owner = foreign.ownerCookie;
    F.companyId = foreign.companyId;
    B.mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, B.companyId)))[0]!.id;
    F.warehouse = (await db.select().from(warehouses).where(eq(warehouses.companyId, F.companyId)))[0]!.id;
    expect((await call(B.owner, "PATCH", `/api/inventory/warehouses/${B.mainWh}`, { name: "MAIN WAREHOUSE" })).statusCode).toBe(200);
    B.manager = (await addEmployee(app, company, "Savdo menejeri")).cookie;
    B.cashier1 = (await addEmployee(app, company, "Kassir")).cookie;
    const second = await addEmployee(app, company, "Kassir");
    B.cashier2 = second.cookie;
    cashier2Phone = second.phone;
    B.storekeeper = (await addEmployee(app, company, "Omborchi")).cookie;

    const list = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, B.companyId));
    B.cash = list.find((row) => row.isDefault)!.id;
    B.bank = list.find((row) => row.type === "bank")!.id;
    const chart = (await call(B.owner, "GET", "/api/finance/accounts")).json().accounts as { id: string; code: string }[];
    const capital = chart.find((row) => row.code === "3000")!.id;
    for (const [id, amount] of [[B.cash, "10000000"], [B.bank, "20000000"]] as const) {
      const res = await call(B.owner, "POST", "/api/finance/cash-transactions", { cashAccountId: id, type: "in", amount, description: "Boshlang'ich mablag'", counterAccountId: capital });
      expect(res.statusCode, res.body).toBe(201);
    }
    cashMove("Boshlang'ich kassa", 10_000_000);
    bankMove("Boshlang'ich bank", 20_000_000);
    // POS-01 — web kassa (kassir 1). POS-02 — desktop kassa QURILMASI (K02): bir omborda bir nechta kassa mavjud
    // arxitekturada qurilma bo'yicha ajraladi (web kassada omborga bitta ochiq smena — SUP-003 hisobotda)
    const shift = await call(B.cashier1, "POST", "/api/sales/pos/shifts", { warehouseId: B.mainWh, openingCash: "0" });
    expect(shift.statusCode, shift.body).toBe(201);
    B.shift1 = shift.json().shift.id;
    const webSecond = await call(B.cashier2, "POST", "/api/sales/pos/shifts", { warehouseId: B.mainWh, openingCash: "0" });
    expect(webSecond.statusCode, "web kassada omborga ikkinchi smena — mavjud qoida").toBe(409);
    const registered = await app.inject({ method: "POST", url: "/api/pos-device/setup/register", payload: { phone: company.owner.phone, password: company.owner.password, warehouseId: B.mainWh, name: "POS-02", appVersion: "0.1.0", platform: "win32" } });
    expect(registered.statusCode, registered.body).toBe(201);
    POS2.token = registered.json().token;
    POS2.code = registered.json().device.code;
    const cashier2 = await db.select({ userId: sql<string>`u.id` }).from(sql`users u`).where(sql`u.phone = ${cashier2Phone}`);
    POS2.cashierId = cashier2[0]!.userId;
    const login = await device("POST", "/api/pos-device/cashiers/login", { phone: cashier2Phone, password: "xodim-parol-123" });
    expect(login.statusCode, login.body).toBe(200);
    POS2.shiftId = randomUUID();
    const [opened] = await push([deviceOp("shift.open", { shiftId: POS2.shiftId, openingCash: "0" })]);
    expect(opened!.status, JSON.stringify(opened)).toBe("applied");
    B.shift2 = POS2.shiftId;
    await expectMoney("bootstrap");
    await expectBalanced(B.companyId, "bootstrap");
  });

  it("S02 — master data: 12 kategoriya, brendlar, 40 mahsulot (SKU, EAN-13, kategoriya, brend, narx), blok = 6, PLU tarozi mahsuloti", async () => {
    const categories: Record<string, string> = {};
    for (const name of CATEGORIES) {
      const res = await call(B.owner, "POST", "/api/catalog/categories", { name });
      expect(res.statusCode, res.body).toBe(201);
      categories[name] = res.json().category.id;
    }
    const brands: Record<string, string> = {};
    for (const name of [...new Set(ASSORTMENT.map((row) => row[3]))]) {
      const res = await call(B.owner, "POST", "/api/catalog/brands", { name });
      expect(res.statusCode, res.body).toBe(201);
      brands[name] = res.json().brand.id;
    }
    let seq = 1;
    for (const [key, name, category, brand, price, cost] of ASSORTMENT) {
      const barcode = ean13(`478000${String(seq).padStart(6, "0")}`);
      seq += 1;
      const res = await call(B.owner, "POST", "/api/catalog/products", {
        name, sku: `BM-${key}`, barcode, categoryId: categories[category], brandId: brands[brand], baseUnitId: piece, salesPrice: price, purchasePrice: cost, taxRate: "0",
        ...(key === "WATER" ? { purchaseUnitId: block, salesUnitId: piece } : {}),
      });
      expect(res.statusCode, `${name}: ${res.body}`).toBe(201);
      B.p[key] = res.json().product.id;
      B.bar[key] = barcode;
    }
    expect(Object.keys(B.p)).toHaveLength(40);
    const conv = await call(B.owner, "POST", "/api/catalog/unit-conversions", { productId: B.p.WATER, fromUnitId: block, toUnitId: piece, factor: "6" });
    expect([200, 201], conv.body).toContain(conv.statusCode);
    // Tarozi mahsuloti: PLU (etiketka kodi) — SKU va shtrix-koddan alohida tushuncha
    const banana = await call(B.owner, "POST", "/api/catalog/products", { name: "Banan (tarozi)", sku: "BM-BANANA", baseUnitId: kg, salesPrice: "25000", purchasePrice: "18000", taxRate: "0", isWeighted: true, pluCode: 101 });
    expect(banana.statusCode, banana.body).toBe(201);
    B.p.BANANA = banana.json().product.id;
    const product = banana.json().product;
    expect(product).toMatchObject({ sku: "BM-BANANA", pluCode: 101, barcode: null });
    const pluDup = await call(B.owner, "POST", "/api/catalog/products", { name: "Olma", sku: "BM-APPLE", baseUnitId: kg, salesPrice: "15000", taxRate: "0", isWeighted: true, pluCode: 101 });
    expect(pluDup.statusCode, "PLU band").toBeGreaterThanOrEqual(400);
    // Kategoriyalar ro'yxati — 12 ta
    expect(((await call(B.owner, "GET", "/api/catalog/categories")).json().categories as unknown[]).length).toBe(12);
  });

  it("S03 — shtrix-kod: skaner = qidiruv = SKU bir mahsulot; dublikat, noma'lum, bo'sh, noto'g'ri, faolsiz, begona tenant", async () => {
    const lookup = (code: string, cookie = B.cashier1) => call(cookie, "GET", `/api/catalog/products/by-barcode/${encodeURIComponent(code)}`);
    const scanned = await lookup(B.bar.COLA!);
    expect(scanned.statusCode, scanned.body).toBe(200);
    expect(scanned.json().product).toMatchObject({ id: B.p.COLA, name: "Coca Cola 1L", sku: "BM-COLA", barcode: B.bar.COLA });
    expect(scanned.json().product.purchasePrice ?? null, "kassirga tannarx ko'rinmaydi").toBeNull();
    for (const term of ["Coca Cola", "BM-COLA", B.bar.COLA!]) {
      const found = (await call(B.cashier1, "GET", `/api/catalog/products?search=${encodeURIComponent(term)}`)).json().products as { id: string }[];
      expect(found.map((row) => row.id), `qidiruv "${term}"`).toContain(B.p.COLA);
    }
    // Takror / tez-tez skanerlash — har safar o'sha mahsulot
    const rapid = await Promise.all(Array.from({ length: 15 }, () => lookup(B.bar.COLA!)));
    expect(new Set(rapid.map((res) => res.json().product.id))).toEqual(new Set([B.p.COLA]));
    // Dublikat shtrix-kod — yaratish, tahrir va importda RAD (SUP-001)
    const dupCreate = await call(B.owner, "POST", "/api/catalog/products", { name: "Soxta Cola", sku: "BM-FAKE", barcode: B.bar.COLA, baseUnitId: piece, salesPrice: "1000", taxRate: "0" });
    expect(dupCreate.statusCode, dupCreate.body).toBe(409);
    const dupPatch = await call(B.owner, "PATCH", `/api/catalog/products/${B.p.PEPSI}`, { barcode: B.bar.COLA });
    expect(dupPatch.statusCode, dupPatch.body).toBe(409);
    const dupImport = (await call(B.owner, "POST", "/api/catalog/products/import", { dryRun: true, rows: [{ name: "Import Cola", sku: "BM-IMP-COLA", barcode: B.bar.COLA, salesPrice: "1" }] })).json();
    expect(dupImport.errors.map((row: { message: string }) => row.message).join(), "import: band shtrix-kod").toMatch(/band/);
    // Noma'lum, bo'sh, noto'g'ri
    expect((await lookup("4780000999999")).statusCode).toBe(404);
    expect([400, 404]).toContain((await lookup(" ")).statusCode);
    expect([400, 404]).toContain((await lookup("abc'; drop table products;--")).statusCode);
    // Begona tenant: TEST MARKET o'z mahsulotiga XUDDI SHU kodni qo'ya oladi (unikallik kompaniya ichida), lekin
    // BONNU skaneri begona mahsulotni topmaydi va aksincha
    const foreign = await call(F.owner, "POST", "/api/catalog/products", { name: "Test Market Cola", sku: "TM-COLA", barcode: ean13("478999000001"), baseUnitId: piece, salesPrice: "1", taxRate: "0" });
    expect(foreign.statusCode, foreign.body).toBe(201);
    F.productId = foreign.json().product.id;
    F.barcode = ean13("478999000001");
    expect((await lookup(F.barcode)).statusCode, "begona shtrix-kod — topilmaydi").toBe(404);
    expect((await call(F.owner, "GET", `/api/catalog/products/by-barcode/${B.bar.COLA}`)).statusCode).toBe(404);
    const sameCode = await call(F.owner, "POST", "/api/catalog/products", { name: "TM ichki", sku: "TM-2", barcode: B.bar.PEPSI, baseUnitId: piece, salesPrice: "1", taxRate: "0" });
    expect(sameCode.statusCode, "boshqa kompaniyada bir xil kod — mumkin").toBe(201);
    expect((await lookup(B.bar.PEPSI!)).json().product.id, "BONNU skaneri — o'z Pepsi'si").toBe(B.p.PEPSI);
    // Faolsiz mahsulot: skaner ko'rsatadi (faol emas deb), sotuv RAD
    expect((await call(B.owner, "DELETE", `/api/catalog/products/${B.p.LIGHTER}`)).statusCode).toBeLessThan(300);
    const inactive = await lookup(B.bar.LIGHTER!);
    expect(inactive.json().product.isActive).toBe(false);
    const sold = await pos({ items: [{ productId: B.p.LIGHTER, quantity: "1" }], paymentMethod: "cash", amountPaid: "3000" });
    expect(sold.statusCode, "faolsiz mahsulot sotilmaydi").toBeGreaterThanOrEqual(400);
    expect(await journalCount(B.companyId)).toBe(2);
  });

  it("S04 — xarid + blok konversiyasi + qisman qabul: 100 blok × 60 000; tasdiqlangan buyurtma omborga tegmaydi; 60 blok → 360 dona", async () => {
    const supplier = await call(B.owner, "POST", "/api/purchase/suppliers", { name: "SUPPLIER A", phone: uniquePhone("94") });
    expect(supplier.statusCode, supplier.body).toBe(201);
    B.s.A! = supplier.json().supplier.id;
    const order = await createOrder(B, B.s.A!, [{ productId: B.p.WATER!, qty: "100", price: "60000", unitId: block }]);
    B.orders.WATER_PO = order.id;
    expect(n(order.totalAmount), "xarid jami").toBe(6_000_000);
    expect(await stockOf(B.p.WATER!), "tasdiqlangan (qabul qilinmagan) — ombor 0").toBe(0);
    expect(await supplierDebt(B.s.A!), "qabul qilinmagan — qarz yo'q").toBe(0);
    const item = order.items[0]!;
    const first = await receive(B, order.id, [{ orderItemId: item.id, receivedQty: "60" }]);
    expect(first.statusCode, first.body).toBe(201);
    expect(await stockOf(B.p.WATER!), "60 blok × 6 = 360 dona (bir marta)").toBe(360);
    expect(await supplierDebt(B.s.A!), "qarz — qabul qilingan qism bo'yicha").toBe(3_600_000);
    const detail = (await call(B.owner, "GET", `/api/purchase/orders/${order.id}`)).json().order;
    const line = detail.items.find((row: { id: string }) => row.id === item.id);
    expect(n(line.receivedQty), "qabul qilindi 60").toBe(60);
    expect(n(line.orderedQty) - n(line.receivedQty), "qoldi 40").toBe(40);
    const [level] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, B.p.WATER!), eq(stockLevels.warehouseId, B.mainWh)));
    expect(n(level!.avgCostPrice), "tannarx 10 000 / dona").toBe(10_000);
    await expectInventoryValue(B.companyId, "qisman qabul", 3_600_000);
    await expectBalanced(B.companyId, "qisman qabul");
  });

  it("S05 — qolgan 40 blok, ortiqcha qabul RAD, takroriy qabul so'rovi ikki marta yozilmaydi; 600 dona, qarz 6 mln", async () => {
    const order = (await call(B.owner, "GET", `/api/purchase/orders/${B.orders.WATER_PO}`)).json().order;
    const item = order.items[0]!;
    const over = await receive(B, order.id, [{ orderItemId: item.id, receivedQty: "41" }]);
    expect(over.statusCode, "buyurtmadan ortiq qabul RAD").toBeGreaterThanOrEqual(400);
    const requestId = randomUUID();
    const body = [{ orderItemId: item.id, receivedQty: "40" }];
    const [a, b] = await Promise.all([receive(B, order.id, body, { requestId }), receive(B, order.id, body, { requestId })]);
    expect([a.statusCode, b.statusCode].sort(), `${a.body} | ${b.body}`).toEqual([200, 201]);
    expect(await stockOf(B.p.WATER!), "600 dona — 3600 emas, 640 emas").toBe(600);
    expect(await supplierDebt(B.s.A!)).toBe(6_000_000);
    await expectInventoryValue(B.companyId, "to'liq qabul", 6_000_000);
    await expectBalanced(B.companyId, "to'liq qabul");
  });

  it("S06 — ta'minotchiga to'lov 2 mln naqd → qarz 4 mln; takroriy to'lov (reference) ta'sirsiz", async () => {
    const body = { supplierId: B.s.A!, amount: "2000000", method: "cash", cashAccountId: B.cash, reference: "SP-A-1" };
    const first = await call(B.owner, "POST", "/api/purchase/payments", body);
    expect(first.statusCode, first.body).toBe(201);
    cashMove("SUPPLIER A to'lov", -2_000_000);
    const dup = await call(B.owner, "POST", "/api/purchase/payments", body);
    expect(dup.statusCode, "takroriy — mavjud to'lov").toBe(200);
    expect(await supplierDebt(B.s.A!)).toBe(4_000_000);
    await expectMoney("ta'minotchi to'lovi");
    await expectBalanced(B.companyId, "ta'minotchi to'lovi");
  });

  it("S07 — boshqa mahsulotlar xaridi (dona) va AVCO: 600 × 10 000 + 100 × 12 000 → 10 285.71; eski sotuv tannarxi o'zgarmaydi", async () => {
    const supplier = await call(B.owner, "POST", "/api/purchase/suppliers", { name: "SUPPLIER B", phone: uniquePhone("94") });
    B.s.B! = supplier.json().supplier.id;
    // Asortiment qoldig'i: har mahsulotdan 100 dona (COLA 600), kirim narxi bo'yicha
    const lines = ASSORTMENT.filter(([key]) => key !== "WATER" && key !== "LIGHTER").map(([key, , , , , cost]) => ({ productId: B.p[key]!, qty: key === "COLA" ? "600" : "100", price: cost }));
    await purchase(B, B.s.B!, lines);
    expect(await stockOf(B.p.COLA!)).toBe(600);
    const cogsBefore = await ledger(B.companyId, "5000");
    // Eski sotuv: 10 COLA (tannarx 10 000)
    const early = await pos({ items: [{ productId: B.p.COLA, quantity: "10" }], paymentMethod: "cash", amountPaid: "150000" });
    expect(early.statusCode, early.body).toBe(201);
    book.grossSales += 150_000;
    book.cogs += 100_000;
    cashMove("POS 10 COLA", 150_000);
    B.orders.EARLY! = early.json().order.id;
    expect((await ledger(B.companyId, "5000")) - cogsBefore, "COGS 10 × 10 000").toBe(100_000);
    // Yangi kirim 100 × 12 000 → AVCO (590 × 10 000 + 100 × 12 000) / 690
    await purchase(B, B.s.B!, [{ productId: B.p.COLA!, qty: "100", price: "12000" }]);
    const [level] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, B.p.COLA!), eq(stockLevels.warehouseId, B.mainWh)));
    expect(n(level!.avgCostPrice), "AVCO").toBeCloseTo(7_100_000 / 690, 3);
    const [earlyItem] = await db.select().from(salesOrderItems).where(eq(salesOrderItems.orderId, B.orders.EARLY!));
    expect(n(earlyItem!.costPrice), "eski sotuv tannarxi tarixda o'zgarmaydi").toBe(10_000);
    await expectInventoryValue(B.companyId, "AVCO");
    await expectMoney("AVCO");
    await expectBalanced(B.companyId, "AVCO");
  });

  it("S08 — narx: sotuv narxi serverdan (15 000, marja 5 000); narx tavsiyasi narxni o'zgartirmaydi; kassir narxni tushira olmaydi", async () => {
    const suggestion = await call(B.owner, "GET", `/api/catalog/products/${B.p.WATER}/price-suggestions`);
    expect(suggestion.statusCode, suggestion.body).toBe(200);
    const text = JSON.stringify(suggestion.json());
    expect(text, "oxirgi kirim narxi (dona bo'yicha 10 000) ko'rinadi").toMatch(/10000/);
    const [before] = await db.select({ salesPrice: products.salesPrice }).from(products).where(eq(products.id, B.p.WATER!));
    expect(n(before!.salesPrice), "tavsiya narxni avtomatik o'zgartirmaydi").toBe(12_000);
    expect((await call(B.cashier1, "GET", `/api/catalog/products/${B.p.WATER}/price-suggestions`)).statusCode, "kassirga tannarx tavsiyasi yopiq").toBe(403);
    // Kassir TV (1 000 000) narxini 1 000 ga tushirib yuboradi — RAD, ombor/jurnal o'zgarmaydi
    const journals = await journalCount(B.companyId);
    const hacked = await pos({ items: [{ productId: B.p.TV, quantity: "1", unitPrice: "1000" }], paymentMethod: "cash", amountPaid: "1000" });
    expect(hacked.statusCode, `narx manipulyatsiyasi: ${hacked.body}`).toBeGreaterThanOrEqual(400);
    expect(await stockOf(B.p.TV!)).toBe(100);
    expect(await journalCount(B.companyId)).toBe(journals);
  });

  it("S09 — shtrix-kod bilan POS: skaner → mahsulot → 2 dona → to'lov → yakunlangan; takroriy yuborish — ikkinchi chek yo'q", async () => {
    const first = (await call(B.cashier1, "GET", `/api/catalog/products/by-barcode/${B.bar.CHIPS}`)).json().product;
    const second = (await call(B.cashier1, "GET", `/api/catalog/products/by-barcode/${B.bar.CHIPS}`)).json().product;
    expect(second.id).toBe(first.id);
    const clientRequestId = randomUUID();
    const payload = { items: [{ productId: first.id, quantity: "2" }], paymentMethod: "cash", amountPaid: "24000", clientRequestId };
    const sale = await pos(payload);
    expect(sale.statusCode, sale.body).toBe(201);
    expect(sale.json().order).toMatchObject({ status: "completed", paymentStatus: "paid" });
    expect(n(sale.json().order.totalAmount)).toBe(24_000);
    book.grossSales += 24_000;
    book.cogs += 16_000;
    cashMove("POS skaner 2 CHIPS", 24_000);
    const dup = await pos(payload);
    expect([200, 409], dup.body).toContain(dup.statusCode);
    expect(await stockOf(B.p.CHIPS!), "ikkinchi chek yozilmadi").toBe(98);
    await expectMoney("skaner sotuv");
    await expectBalanced(B.companyId, "skaner sotuv");
  });

  it("S10 — ko'p qatorli chek (POS-02): 5 PEPSI + 3 SOAP + 2 blok WATER; qatorlar = chek = to'lov = 4000", async () => {
    const revenueBefore = await ledger(B.companyId, "4000");
    POS2.seq += 1;
    const saleId = randomUUID();
    const saleOp = deviceOp("sale.complete", {
      saleId,
      shiftId: POS2.shiftId,
      number: `${POS2.code}-${String(POS2.seq).padStart(6, "0")}`,
      items: [
        { id: randomUUID(), productId: B.p.PEPSI, unitId: piece, quantity: "5", unitPrice: "14000" },
        { id: randomUUID(), productId: B.p.SOAP, unitId: piece, quantity: "3", unitPrice: "15000" },
        { id: randomUUID(), productId: B.p.WATER, unitId: block, quantity: "2", unitPrice: "72000" },
      ],
      paymentMethod: "cash",
      amountPaid: "300000",
    });
    const [sold] = await push([saleOp]);
    expect(sold!.status, JSON.stringify(sold)).toBe("applied");
    expect(sold!.result).toMatchObject({ orderId: saleId, totalAmount: "259000.00", change: "41000.00" });
    const [again] = await push([saleOp]);
    expect(again!.duplicate, "qurilmadan takror — bitta chek").toBe(true);
    const order = { id: saleId, totalAmount: String(sold!.result!.totalAmount) };
    // 5 × 14 000 + 3 × 15 000 + 2 blok × (6 × 12 000) = 70 000 + 45 000 + 144 000
    const expected = 259_000;
    expect(n(order.totalAmount), "API jami").toBe(expected);
    const items = await db.select().from(salesOrderItems).where(eq(salesOrderItems.orderId, order.id));
    expect(items.reduce((sum, row) => sum + n(row.lineTotal), 0), "qatorlar yig'indisi = chek").toBe(expected);
    const [dbOrder] = await db.select().from(salesOrders).where(eq(salesOrders.id, order.id));
    expect(n(dbOrder!.totalAmount), "baza jami").toBe(expected);
    const paid = await db.select().from(customerPayments).where(eq(customerPayments.orderId, order.id));
    expect(paid.reduce((sum, row) => sum + n(row.amount), 0), "to'lov = chek (qaytim chiqarilgan)").toBe(expected);
    expect((await ledger(B.companyId, "4000")) - revenueBefore, "4000 = chek").toBe(expected);
    expect(await stockOf(B.p.WATER!), "2 blok = 12 dona chiqdi").toBe(588);
    book.grossSales += expected;
    book.cogs += 5 * 9_000 + 3 * 10_000 + 12 * 10_000;
    cashMove("POS-02 ko'p qatorli", expected);
    await expectMoney("ko'p qatorli");
    await expectBalanced(B.companyId, "ko'p qatorli");
  });

  it("S11 — chegirma: 10 SHAMPOO+... yalpi 1 000 000, chegirma 10% → 900 000; tannarx chegirmadan kamaymaydi", async () => {
    const cogsBefore = await ledger(B.companyId, "5000");
    const revenueBefore = await ledger(B.companyId, "4000");
    const sale = await pos({ items: [{ productId: B.p.TV, quantity: "1", discountPercent: "10" }], paymentMethod: "cash", amountPaid: "900000" }, B.owner, B.shift1);
    expect(sale.statusCode, sale.body).toBe(201);
    expect(n(sale.json().order.totalAmount), "sof sotuv").toBe(900_000);
    expect((await ledger(B.companyId, "4000")) - revenueBefore, "4000 +900 000").toBe(900_000);
    expect((await ledger(B.companyId, "5000")) - cogsBefore, "tannarx 800 000 — chegirma ta'sir qilmaydi").toBe(800_000);
    book.grossSales += 1_000_000;
    book.discounts += 100_000;
    book.cogs += 800_000;
    cashMove("TV chegirma bilan", 900_000);
    await expectMoney("chegirma");
    await expectBalanced(B.companyId, "chegirma");
  });

  it("S12 — mijoz nasiya: 1 000 000, 600 000 naqd → qarz 400 000; to'lov 400 000 bank (reference) → 0; takror kamaytirmaydi", async () => {
    const customer = await call(B.owner, "POST", "/api/sales/customers", { name: "CUSTOMER A", phone: uniquePhone("95"), creditLimit: "5000000" });
    expect(customer.statusCode, customer.body).toBe(201);
    B.c.A = customer.json().customer.id;
    const sale = await pos({ customerId: B.c.A, items: [{ productId: B.p.TV, quantity: "1" }], paymentMethod: "cash", amountPaid: "600000", onCredit: true });
    expect(sale.statusCode, sale.body).toBe(201);
    B.orders.CREDIT! = sale.json().order.id;
    expect(sale.json().order.paymentStatus).toBe("partial");
    book.grossSales += 1_000_000;
    book.cogs += 800_000;
    cashMove("CUSTOMER A 600k", 600_000);
    expect(await debtOf(B.c.A!), "qarz 400 000").toBe(400_000);
    const statement = (await call(B.owner, "GET", `/api/sales/customers/${B.c.A}/statement?${PERIOD()}`)).json();
    expect(statement.reconciliation.ok).toBe(true);
    const body = { customerId: B.c.A, amount: "400000", method: "bank", cashAccountId: B.bank, reference: "CP-A-BANK-1" };
    expect((await call(B.owner, "POST", "/api/sales/payments", body)).statusCode).toBe(201);
    bankMove("CUSTOMER A bank", 400_000);
    const dup = await call(B.owner, "POST", "/api/sales/payments", body);
    expect(dup.statusCode, "takroriy reference").toBe(200);
    expect(await debtOf(B.c.A!)).toBe(0);
    const [credit] = await db.select().from(salesOrders).where(eq(salesOrders.id, B.orders.CREDIT!));
    expect(n(credit!.paidAmount), "buyurtmaga taqsimot: 600 000 + 400 000 = 1 000 000").toBe(1_000_000);
    await expectMoney("mijoz to'lovi");
    await expectBalanced(B.companyId, "mijoz to'lovi");
  });

  it("S13 — aralash to'lov: 1 000 000 = naqd 400k + bank 300k + karta 300k; qarz 0", async () => {
    const sale = await pos({ items: [{ productId: B.p.TV, quantity: "1" }], payments: [{ method: "cash", amount: "400000" }, { method: "bank", amount: "300000" }, { method: "card", amount: "300000" }] });
    expect(sale.statusCode, sale.body).toBe(201);
    const parts = await db.select().from(customerPayments).where(eq(customerPayments.orderId, sale.json().order.id));
    expect(parts.reduce((sum, part) => sum + n(part.amount), 0)).toBe(1_000_000);
    expect(sale.json().order.paymentStatus).toBe("paid");
    book.grossSales += 1_000_000;
    book.cogs += 800_000;
    cashMove("aralash naqd", 400_000);
    bankMove("aralash bank+karta", 600_000);
    await expectMoney("aralash to'lov");
    await expectBalanced(B.companyId, "aralash to'lov");
  });

  it("S14 — to'lov manipulyatsiyasi: manfiy summa RAD, chekdan ortiq bank/karta RAD, faolsiz/begona mahsulot RAD", async () => {
    const journals = await journalCount(B.companyId);
    expect((await pos({ items: [{ productId: B.p.GUM, quantity: "1" }], paymentMethod: "cash", amountPaid: "-100000" })).statusCode).toBe(400);
    expect((await call(B.cashier1, "POST", "/api/sales/payments", { customerId: B.c.A, amount: "-100000", method: "cash" })).statusCode).toBe(400);
    const over = await pos({ items: [{ productId: B.p.GUM, quantity: "1" }], payments: [{ method: "bank", amount: "100000" }] });
    expect(over.statusCode, `chekdan ortiq bank to'lovi: ${over.body}`).toBeGreaterThanOrEqual(400);
    expect((await pos({ items: [{ productId: F.productId, quantity: "1" }], paymentMethod: "cash", amountPaid: "1" })).statusCode, "begona mahsulot").toBeGreaterThanOrEqual(400);
    expect(await journalCount(B.companyId)).toBe(journals);
    await expectMoney("manipulyatsiya");
  });

  it("S15 — qoldiq yetmasa sotuv RAD (5 dan 10); parallel 7+7 (qoldiq 10) — bittasi o'tadi, manfiy yo'q", async () => {
    // BATTERY: 100 → 95 (qoldiq kam qilinadi), keyin 5 qoldi deb ko'rsatish uchun 90 ta chiqariladi
    const issue = await call(B.owner, "POST", "/api/inventory/stock/movements", { type: "issue", productId: B.p.BATTERY, warehouseId: B.mainWh, quantity: "95", notes: "Test: 5 qolsin" });
    expect(issue.statusCode, issue.body).toBe(201);
    book.opex += 95 * 21_000;
    expect(await stockOf(B.p.BATTERY!)).toBe(5);
    const journals = await journalCount(B.companyId);
    const tooMany = await pos({ items: [{ productId: B.p.BATTERY, quantity: "10" }], paymentMethod: "cash", amountPaid: "300000" });
    expect(tooMany.statusCode, `qoldiqdan ortiq: ${tooMany.body}`).toBeGreaterThanOrEqual(400);
    expect(await stockOf(B.p.BATTERY!)).toBe(5);
    expect(await journalCount(B.companyId)).toBe(journals);

    // Parallel: CAKE qoldig'i 10 ga tushiriladi
    await call(B.owner, "POST", "/api/inventory/stock/movements", { type: "issue", productId: B.p.CAKE, warehouseId: B.mainWh, quantity: "90", notes: "Test: 10 qolsin" });
    book.opex += 90 * 14_000;
    const [x, y] = await Promise.all([
      pos({ items: [{ productId: B.p.CAKE, quantity: "7" }], paymentMethod: "cash", amountPaid: "140000" }, B.cashier1, B.shift1),
      pos({ items: [{ productId: B.p.CAKE, quantity: "7" }], paymentMethod: "cash", amountPaid: "140000" }, B.owner, B.shift1),
    ]);
    const ok = [x, y].filter((res) => res.statusCode === 201);
    expect(ok, `${x.body} | ${y.body}`).toHaveLength(1);
    book.grossSales += 140_000;
    book.cogs += 7 * 14_000;
    cashMove("parallel CAKE", 140_000);
    expect(await stockOf(B.p.CAKE!), "10 − 7 = 3, manfiy emas").toBe(3);
    await expectMoney("parallel");
    await expectBalanced(B.companyId, "parallel");
  });

  it("S16 — band qilish: buyurtma 20 (qoldiq 100) → band 20, mavjud 80, qoldiq 100; jo'natishda qoldiq 80, band 0", async () => {
    const created = await call(B.manager, "POST", "/api/sales/orders", { customerId: B.c.A, warehouseId: B.mainWh, orderDate: businessToday(), deliveryRequired: false, items: [{ productId: B.p.RICE, quantity: "20" }] });
    expect(created.statusCode, created.body).toBe(201);
    const orderId = created.json().order.id;
    expect((await call(B.manager, "POST", `/api/sales/orders/${orderId}/confirm`)).statusCode).toBe(200);
    const reserved = (await stockRow(B.p.RICE!, B.mainWh))!;
    expect({ quantity: n(reserved.quantity), reserved: n(reserved.reservedQty) }).toEqual({ quantity: 100, reserved: 20 });
    const listed = (await call(B.owner, "GET", `/api/inventory/stock/products/${B.p.RICE}`)).json().stock as { availableQty?: string; quantity: string; reservedQty: string }[];
    expect(n(listed[0]!.quantity) - n(listed[0]!.reservedQty), "mavjud 80").toBe(80);
    const shipped = await call(B.owner, "POST", `/api/sales/orders/${orderId}/ship`);
    expect(shipped.statusCode, shipped.body).toBe(200);
    const after = (await stockRow(B.p.RICE!, B.mainWh))!;
    expect({ quantity: n(after.quantity), reserved: n(after.reservedQty) }).toEqual({ quantity: 80, reserved: 0 });
    book.grossSales += 20 * 22_000;
    book.cogs += 20 * 16_000;
    expect(await debtOf(B.c.A!), "jo'natilgan buyurtma — qarz").toBe(440_000);
    await expectBalanced(B.companyId, "band qilish");
  });

  it("S17 — qaytarish: 10 dan 3 (alohida hujjat, to'lov tarixi o'chmaydi); qisman: 5 dan 2, keyin 4 — RAD", async () => {
    const sale = await pos({ items: [{ productId: B.p.MILK, quantity: "10" }], paymentMethod: "cash", amountPaid: "140000" });
    expect(sale.statusCode).toBe(201);
    book.grossSales += 140_000;
    book.cogs += 10 * 10_500;
    cashMove("MILK 10", 140_000);
    const orderId = sale.json().order.id;
    const [item] = await db.select().from(salesOrderItems).where(eq(salesOrderItems.orderId, orderId));
    const cogsBefore = await ledger(B.companyId, "5000");
    const revenueBefore = await ledger(B.companyId, "4000");
    const requestId = randomUUID();
    const back = await call(B.owner, "POST", `/api/sales/orders/${orderId}/return-items`, { items: [{ orderItemId: item!.id, quantity: "3" }], refundMethod: "cash", reason: "Mijoz qaytardi", requestId });
    expect(back.statusCode, back.body).toBe(201);
    book.returns += 42_000;
    book.cogs -= 31_500;
    cashMove("qaytarish MILK 3", -42_000);
    expect(revenueBefore - (await ledger(B.companyId, "4000"))).toBe(42_000);
    expect(cogsBefore - (await ledger(B.companyId, "5000"))).toBe(31_500);
    expect(await stockOf(B.p.MILK!)).toBe(93);
    expect((await call(B.owner, "POST", `/api/sales/orders/${orderId}/return-items`, { items: [{ orderItemId: item!.id, quantity: "3" }], refundMethod: "cash", reason: "Mijoz qaytardi", requestId })).statusCode, "takror").toBe(200);
    expect((await db.select().from(customerPayments).where(eq(customerPayments.orderId, orderId))).length, "to'lov tarixi saqlanadi").toBeGreaterThan(0);

    const five = await pos({ items: [{ productId: B.p.KEFIR, quantity: "5" }], paymentMethod: "cash", amountPaid: "60000" });
    book.grossSales += 60_000;
    book.cogs += 5 * 9_000;
    cashMove("KEFIR 5", 60_000);
    const [kefir] = await db.select().from(salesOrderItems).where(eq(salesOrderItems.orderId, five.json().order.id));
    expect((await call(B.owner, "POST", `/api/sales/orders/${five.json().order.id}/return-items`, { items: [{ orderItemId: kefir!.id, quantity: "2" }], refundMethod: "cash", reason: "Qaytdi" })).statusCode).toBe(201);
    book.returns += 24_000;
    book.cogs -= 18_000;
    cashMove("qaytarish KEFIR 2", -24_000);
    const tooMany = await call(B.owner, "POST", `/api/sales/orders/${five.json().order.id}/return-items`, { items: [{ orderItemId: kefir!.id, quantity: "4" }], refundMethod: "cash", reason: "Ortiqcha" });
    expect(tooMany.statusCode, "qaytariladigani 3 — 4 RAD").toBeGreaterThanOrEqual(400);
    const [row] = await db.select().from(salesOrderItems).where(eq(salesOrderItems.id, kefir!.id));
    expect(n(row!.quantity) - n(row!.returnedQty), "qaytariladigan qoldiq 3").toBe(3);
    await expectMoney("qaytarish");
    await expectBalanced(B.companyId, "qaytarish");
    await expectInventoryValue(B.companyId, "qaytarish");
  });

  it("S18 — ta'minotchiga qaytarish: 100 SUGAR dan 20 → ombor −20, qarz −220 000; asl xarid o'zgarmaydi", async () => {
    const order = await purchase(B, B.s.B!, [{ productId: B.p.MUSTARD!, qty: "100", price: "7000" }]);
    const debtBefore = await supplierDebt(B.s.B!);
    const stockBefore = await stockOf(B.p.MUSTARD!);
    const returned = await call(B.owner, "POST", `/api/purchase/orders/${order.id}/returns`, { items: [{ orderItemId: order.items[0]!.id, quantity: "20" }], reason: "Sifatsiz" });
    expect(returned.statusCode, returned.body).toBe(201);
    expect(await stockOf(B.p.MUSTARD!)).toBe(stockBefore - 20);
    expect(debtBefore - (await supplierDebt(B.s.B!)), "qarz −20 × 7 000").toBe(140_000);
    const po = (await call(B.owner, "GET", `/api/purchase/orders/${order.id}`)).json().order;
    expect(n(po.items[0].orderedQty), "asl xarid qatori o'zgarmaydi").toBe(100);
    expect(n(po.items[0].receivedQty)).toBe(100);
    await expectInventoryValue(B.companyId, "ta'minotchiga qaytarish");
    await expectBalanced(B.companyId, "ta'minotchiga qaytarish");
  });

  it("S19 — inventarizatsiya: 100 → sanaldi 97 (−3), tarix saqlanadi; kassir sanoqni qo'llay olmaydi", async () => {
    const count = await call(B.owner, "POST", "/api/inventory/counts", { warehouseId: B.mainWh, name: "Oylik sanoq" });
    expect(count.statusCode, count.body).toBe(201);
    const countId = count.json().count.id as string;
    await call(B.owner, "POST", `/api/inventory/counts/${countId}/items`, { productId: B.p.TOWEL });
    const detail = (await call(B.owner, "GET", `/api/inventory/counts/${countId}?search=Qog`)).json();
    const items = (detail.items ?? detail.count.items) as { id: string; productId: string }[];
    const row = items.find((entry) => entry.productId === B.p.TOWEL)!;
    expect((await call(B.owner, "PATCH", `/api/inventory/counts/${countId}/items/${row.id}`, { countedQty: "97" })).statusCode).toBe(200);
    expect((await call(B.cashier1, "POST", `/api/inventory/counts/${countId}/apply`)).statusCode, "kassir — yo'q").toBe(403);
    const valueBefore = await ledger(B.companyId, "1200");
    const applied = await call(B.owner, "POST", `/api/inventory/counts/${countId}/apply`);
    expect(applied.statusCode, applied.body).toBe(200);
    book.opex += 3 * 8_000;
    expect(await stockOf(B.p.TOWEL!)).toBe(97);
    expect(valueBefore - (await ledger(B.companyId, "1200"))).toBe(24_000);
    expect((await call(B.owner, "GET", `/api/inventory/counts/${countId}`)).statusCode, "sanoq tarixi saqlanadi").toBe(200);
    await expectInventoryValue(B.companyId, "inventarizatsiya");
    await expectBalanced(B.companyId, "inventarizatsiya");
  });

  it("S20 — o'tkazma MAIN → BRANCH-02: 30 dona; jami 100 va qiymat o'zgarmaydi; takror — ta'sirsiz", async () => {
    const created = await call(B.owner, "POST", "/api/inventory/warehouses", { name: "BRANCH-02", code: "BR-02" });
    expect(created.statusCode, created.body).toBe(201);
    const branch = created.json().warehouse.id as string;
    const valueBefore = await ledger(B.companyId, "1200");
    const body = { productId: B.p.JUICE, fromWarehouseId: B.mainWh, toWarehouseId: branch, quantity: "30", requestId: randomUUID() };
    const moved = await call(B.owner, "POST", "/api/inventory/stock/transfers", body);
    expect(moved.statusCode, moved.body).toBe(201);
    expect((await call(B.owner, "POST", "/api/inventory/stock/transfers", body)).statusCode).toBe(200);
    expect(await stockOf(B.p.JUICE!, B.mainWh)).toBe(70);
    expect(await stockOf(B.p.JUICE!, branch)).toBe(30);
    expect((await stockOf(B.p.JUICE!, B.mainWh)) + (await stockOf(B.p.JUICE!, branch)), "kompaniya jami").toBe(100);
    expect(await ledger(B.companyId, "1200")).toBe(valueBefore);
    await expectInventoryValue(B.companyId, "o'tkazma");
  });

  it("S21 — partiya/muddat: qabulda partiya yoziladi; sotuv FEFO bo'yicha partiyani kamaytirmaydi (GAP — alohida tizim yaratilmadi)", async () => {
    const order = await createOrder(B, B.s.B!, [{ productId: B.p.YOGURT!, qty: "20", price: "6500" }]);
    const res = await receive(B, order.id, [{ orderItemId: order.items[0]!.id, receivedQty: "20", batchNumber: "YG-A", expiryDate: "2026-10-05" }]);
    expect(res.statusCode, res.body).toBe(201);
    const batchRows = await db.select().from(batches).where(eq(batches.productId, B.p.YOGURT!));
    // Hujjatlashtiriladi: partiya jadvali bor-yo'qligi va sotuvda kamayishi (FEFO) — hisobotda GAP sifatida
    console.log("FEFO GAP:", JSON.stringify(batchRows.map((row) => ({ batch: row.batchNumber, qty: row.quantity, expiry: row.expiryDate }))));
    expect(await stockOf(B.p.YOGURT!)).toBe(120);
  });

  it("S22 — xarajat 500 000 naqd: kassa −500k, debet = kredit, foyda − xarajat", async () => {
    const expense = await call(B.owner, "POST", "/api/finance/expenses", { category: "boshqa", description: "Qadoqlash", amount: "500000", expenseDate: businessToday() });
    expect(expense.statusCode, expense.body).toBe(201);
    const id = expense.json().expense.id;
    expect((await call(B.owner, "POST", `/api/finance/expenses/${id}/status`, { status: "approved" })).statusCode).toBe(200);
    expect((await call(B.owner, "POST", `/api/finance/expenses/${id}/status`, { status: "paid", cashAccountId: B.cash })).statusCode).toBe(200);
    expect((await call(B.owner, "POST", `/api/finance/expenses/${id}/status`, { status: "paid", cashAccountId: B.cash })).statusCode, "ikki marta to'lanmaydi").toBe(400);
    cashMove("xarajat", -500_000);
    book.opex += 500_000;
    await expectMoney("xarajat");
    await expectBalanced(B.companyId, "xarajat");
  });

  it("S23 — kun yakuni: POS-01/POS-02 smenalari yopiladi (sanalgan = kutilgan, farq 0); kassa kitob = tizim", async () => {
    const shift = (await call(B.cashier1, "GET", `/api/sales/pos/shifts/${B.shift1}`)).json().shift;
    const expected = n(shift.expectedCash ?? shift.expectedClosingCash ?? 0) || n(shift.openingCash) + n(shift.totalCash);
    const closed = await call(B.cashier1, "POST", `/api/sales/pos/shifts/${B.shift1}/close`, { closingCash: String(expected) });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(n(closed.json().shift.difference ?? 0), `POS-01 smena farqi: ${JSON.stringify(closed.json().shift)}`).toBe(0);
    const [pos2] = await db.select().from(posShifts).where(eq(posShifts.id, POS2.shiftId));
    const [deviceClosed] = await push([deviceOp("shift.close", { shiftId: POS2.shiftId, closingCash: String(n(pos2!.openingCash) + n(pos2!.totalCash)) })]);
    expect(deviceClosed!.status, JSON.stringify(deviceClosed)).toBe("applied");
    expect(deviceClosed!.result, "POS-02 smena farqi 0").toMatchObject({ difference: "0.00" });
    const expectedCash = book.cashFlow.reduce((sum, row) => sum + row.amount, 0);
    expect(expectedCash, JSON.stringify(book.cashFlow)).toBe(book.cash);
    await expectMoney("kun yakuni");
    const [flow] = await db
      .select({ v: sql<string>`coalesce(sum(case when ${cashTransactions.type} = 'in' then ${cashTransactions.amount} else -${cashTransactions.amount} end), 0)::numeric(18,2)` })
      .from(cashTransactions)
      .where(eq(cashTransactions.cashAccountId, B.cash));
    expect(n(flow!.v), "kassa harakatlari yig'indisi = qoldiq").toBe(book.cash);
  });

  it("S24 — foyda: yalpi − chegirma − qaytarish = sof sotuv; − COGS = yalpi foyda; − xarajat = sof foyda (hisobot = mustaqil hisob)", async () => {
    const netSales = book.grossSales - book.discounts - book.returns;
    const grossProfit = netSales - book.cogs;
    const net = grossProfit - book.opex;
    expect(await ledger(B.companyId, "4000"), "4000 = sof sotuv").toBe(netSales);
    expect(await ledger(B.companyId, "5000"), "5000 = COGS").toBe(book.cogs);
    const pnl = (await call(B.owner, "GET", `/api/finance/reports/profit-loss?dateFrom=2000-01-01&dateTo=${businessToday()}`)).json();
    expect(n(pnl.netProfit), `foyda-zarar: ${JSON.stringify(pnl)}`).toBe(net);
    const [orders] = await db
      .select({ total: sql<string>`coalesce(sum(${salesOrders.totalAmount}), 0)::numeric(18,2)` })
      .from(salesOrders)
      .where(and(eq(salesOrders.companyId, B.companyId), inArray(salesOrders.status, ["completed", "shipped", "delivered"])));
    const [returned] = await db.select({ total: sql<string>`coalesce(sum(${salesReturns.totalAmount}), 0)::numeric(18,2)` }).from(salesReturns).where(eq(salesReturns.companyId, B.companyId));
    expect(n(orders!.total) - n(returned!.total), "hujjatlar = 4000").toBe(netSales);
  });

  it("S25 — mahsulot rentabelligi (yangi hisobot): yalpi, chegirma, qaytarish, COGS, foyda, marja = mustaqil hisob; kassirga yopiq", async () => {
    const res = await call(B.owner, "GET", `/api/analytics/reports/product-profitability?${PERIOD()}`);
    expect(res.statusCode, res.body).toBe(200);
    const report = res.json();
    const tv = report.products.find((row: { productId: string }) => row.productId === B.p.TV);
    // TV: 3 dona × 1 000 000 = 3 mln yalpi, chegirma 100k, COGS 3 × 800 000
    expect(tv).toMatchObject({ unitsSold: "3.0000", grossSales: "3000000.00", discount: "100000.00", netRevenue: "2900000.00", cogs: "2400000.00", grossProfit: "500000.00" });
    expect(tv.marginPercent).toBeCloseTo(17.24, 2);
    const milk = report.products.find((row: { productId: string }) => row.productId === B.p.MILK);
    expect(milk).toMatchObject({ unitsReturned: "3.0000", returns: "42000.00", netRevenue: "98000.00", cogs: "73500.00", grossProfit: "24500.00" });
    const netSales = book.grossSales - book.discounts - book.returns;
    expect(n(report.totals.netRevenue), "jami sof tushum = 4000").toBe(netSales);
    expect(n(report.totals.cogs), "jami COGS = 5000").toBe(book.cogs);
    expect(n(report.totals.grossProfit)).toBe(netSales - book.cogs);
    expect((await call(B.cashier1, "GET", `/api/analytics/reports/product-profitability?${PERIOD()}`)).statusCode, "kassir — yo'q").toBe(403);
  });

  it("S26 — katta assortiment: 80 mahsulot importi (preview: yangi/dublikat/xato), boshlang'ich qoldiq importi, 120+ mahsulotda qidiruv va sahifalash", async () => {
    const rows = Array.from({ length: 80 }, (_, index) => ({
      name: `Import mahsulot ${index + 1}`,
      sku: `IMP-${String(index + 1).padStart(3, "0")}`,
      barcode: ean13(`478100${String(index + 1).padStart(6, "0")}`),
      unit: "d",
      purchaseUnit: index % 10 === 0 ? "bl" : undefined,
      unitsPerPackage: index % 10 === 0 ? "12" : undefined,
      purchasePrice: String(1000 + index * 10),
      salesPrice: String(1500 + index * 10),
      category: CATEGORIES[index % CATEGORIES.length],
    }));
    const bad = [
      { name: "Dublikat SKU", sku: "BM-COLA", salesPrice: "1" },
      { name: "Band shtrix-kod", sku: "IMP-X1", barcode: B.bar.PEPSI, salesPrice: "1" },
      { name: "Noma'lum birlik", sku: "IMP-X2", unit: "quti-yoq", salesPrice: "1" },
      { name: "Qadoq sonisiz blok", sku: "IMP-X3", purchaseUnit: "bl", salesPrice: "1" },
    ];
    const preview = (await call(B.owner, "POST", "/api/catalog/products/import", { dryRun: true, rows: [...rows, ...bad] })).json();
    const statuses = (preview.preview as { status: string }[]).reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.status]: (acc[row.status] ?? 0) + 1 }), {});
    expect(statuses).toEqual({ new: 80, duplicate: 1, error: 3 });
    const withPack = (preview.preview as { sku: string; unitCost: string }[]).find((row) => row.sku === "IMP-001")!;
    expect(n(withPack.unitCost), "blok narxi / 12 — bir marta").toBeCloseTo(1000 / 12, 3);
    expect(await db.select().from(products).where(eq(products.sku, "IMP-001")), "preview — hech narsa yozilmadi").toHaveLength(0);
    const applied = await call(B.owner, "POST", "/api/catalog/products/import", { rows });
    expect(applied.statusCode, applied.body).toBe(200);
    expect(applied.json().created).toBe(80);
    // Boshlang'ich qoldiq: 10 blok (×12) va 50 dona — mavjud ombor Excel importi orqali (preview → yozish)
    const opening = [{ sku: "IMP-001", unit: "bl", quantity: "10", costPrice: "12000" }, { sku: "IMP-002", quantity: "50", costPrice: "1010" }];
    const stockPreview = (await call(B.owner, "POST", "/api/inventory/stock/import", { warehouseId: B.mainWh, rows: opening, dryRun: true })).json();
    expect(stockPreview.lines.map((line: { baseQuantity: string }) => line.baseQuantity)).toEqual(["120.0000", "50.0000"]);
    const stockApplied = await call(B.owner, "POST", "/api/inventory/stock/import", { warehouseId: B.mainWh, rows: opening, importId: randomUUID() });
    expect(stockApplied.statusCode, stockApplied.body).toBe(200);
    const imp1 = (await db.select().from(products).where(and(eq(products.companyId, B.companyId), eq(products.sku, "IMP-001"))))[0]!;
    expect(await stockOf(imp1.id), "10 blok × 12 = 120 (bir marta)").toBe(120);
    await expectInventoryValue(B.companyId, "boshlang'ich qoldiq importi");
    await expectBalanced(B.companyId, "boshlang'ich qoldiq importi");

    // 120+ mahsulot: qidiruv (nom, SKU, shtrix-kod, kategoriya), sahifalash, tezlik
    const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(products).where(eq(products.companyId, B.companyId));
    expect(count!.n).toBeGreaterThanOrEqual(120);
    const started = Date.now();
    const seen = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = (await call(B.owner, "GET", `/api/catalog/products?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)).json();
      for (const row of page.products as { id: string }[]) seen.add(row.id);
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor && pages < 10);
    expect(seen.size, "sahifalash: hammasi, takrorsiz").toBe(count!.n);
    expect(Date.now() - started, "sahifalash tezligi").toBeLessThan(5000);
    const byBarcode = Date.now();
    expect((await call(B.cashier1, "GET", `/api/catalog/products/by-barcode/${rows[42]!.barcode}`)).json().product.sku).toBe("IMP-043");
    expect(Date.now() - byBarcode, "shtrix-kod qidiruvi tezligi (ms)").toBeLessThan(1000);
    const bySku = (await call(B.owner, "GET", "/api/catalog/products?search=IMP-07")).json().products as { sku: string }[];
    expect(bySku.map((row) => row.sku).sort()).toEqual(["IMP-070", "IMP-071", "IMP-072", "IMP-073", "IMP-074", "IMP-075", "IMP-076", "IMP-077", "IMP-078", "IMP-079"]);
    const categories = (await call(B.owner, "GET", "/api/catalog/categories")).json().categories as { id: string; name: string }[];
    const dairy = categories.find((row) => row.name === "DAIRY")!.id;
    const inDairy = (await call(B.owner, "GET", `/api/catalog/products?categoryId=${dairy}&limit=200`)).json().products as { id: string }[];
    expect(inDairy.map((row) => row.id)).toEqual(expect.arrayContaining([B.p.MILK, B.p.KEFIR, B.p.CHEESE, B.p.YOGURT]));
    const foreignSearch = (await call(F.owner, "GET", "/api/catalog/products?search=Coca")).json().products as { id: string }[];
    expect(foreignSearch.map((row) => row.id)).not.toContain(B.p.COLA);
  });

  it("S27 — tenant izolyatsiyasi: begona ID bilan mahsulot, shtrix-kod, ombor, xarid, ta'minotchi, sotuv, mijoz, to'lov, qaytarish — 403/404", async () => {
    const [payment] = await db.select().from(customerPayments).where(eq(customerPayments.companyId, B.companyId)).limit(1);
    const [ret] = await db.select().from(salesReturns).where(eq(salesReturns.companyId, B.companyId)).limit(1);
    const probes: [Method, string, object?][] = [
      ["GET", `/api/catalog/products/${B.p.COLA}`],
      ["PATCH", `/api/catalog/products/${B.p.COLA}`, { salesPrice: "1" }],
      ["GET", `/api/catalog/products/by-barcode/${B.bar.COLA}`],
      ["GET", `/api/inventory/stock/products/${B.p.COLA}`],
      ["GET", `/api/inventory/warehouses/${B.mainWh}`],
      ["GET", `/api/purchase/orders/${B.orders.WATER_PO}`],
      ["POST", `/api/purchase/orders/${B.orders.WATER_PO}/receipts`, { items: [{ orderItemId: randomUUID(), receivedQty: "1" }] }],
      ["GET", `/api/purchase/suppliers/${B.s.A!}`],
      ["GET", `/api/sales/orders/${B.orders.CREDIT!}`],
      ["POST", `/api/sales/orders/${B.orders.CREDIT!}/return-items`, { items: [{ orderItemId: randomUUID(), quantity: "1" }], refundMethod: "cash" }],
      ["GET", `/api/sales/customers/${B.c.A}`],
      ["POST", `/api/sales/payments/${payment!.id}/reverse`, { reason: "hack" }],
      ["GET", `/api/sales/payments/${payment!.id}/reversal`],
      ["POST", "/api/inventory/stock/movements", { type: "issue", productId: B.p.COLA, warehouseId: B.mainWh, quantity: "1" }],
      ["POST", "/api/inventory/stock/transfers", { productId: B.p.COLA, fromWarehouseId: B.mainWh, toWarehouseId: F.warehouse, quantity: "1" }],
    ];
    for (const [method, url, body] of probes) {
      const res = await call(F.owner, method, url, body);
      expect([400, 403, 404], `${method} ${url}: ${res.statusCode} ${res.body}`).toContain(res.statusCode);
    }
    expect(ret, "qaytarish hujjati bor").toBeTruthy();
    const smuggled = await call(B.owner, "POST", "/api/catalog/products", { name: "Hack", baseUnitId: piece, salesPrice: "1", companyId: F.companyId });
    expect(smuggled.statusCode, "tanadagi companyId rad").toBe(400);
    expect(await stockOf(B.p.COLA!), "COLA o'zgarmadi").toBe(690);
  });

  it("S28 — RBAC: kassir sotadi va to'lov oladi; tannarx, AVCO, ta'minotchi qarzi, foyda, jurnal, sanoq, maosh — yopiq (to'g'ridan-to'g'ri API)", async () => {
    const shift = await call(B.cashier1, "POST", "/api/sales/pos/shifts", { warehouseId: B.mainWh, openingCash: "0" });
    expect(shift.statusCode, shift.body).toBe(201);
    B.shift1 = shift.json().shift.id;
    const sale = await pos({ items: [{ productId: B.p.BREAD, quantity: "3" }], paymentMethod: "cash", amountPaid: "12000" });
    expect(sale.statusCode, sale.body).toBe(201);
    book.grossSales += 12_000;
    book.cogs += 3 * 2_800;
    cashMove("kassir non", 12_000);
    const denied: [Method, string][] = [
      ["GET", "/api/catalog/products/costs"],
      ["GET", `/api/catalog/products/${B.p.COLA}/cost-history`],
      ["GET", "/api/purchase/suppliers"],
      ["GET", `/api/purchase/suppliers/${B.s.A!}/statement`],
      ["GET", `/api/finance/reports/profit-loss?dateFrom=2000-01-01&dateTo=${businessToday()}`],
      ["GET", "/api/finance/journal"],
      ["GET", `/api/analytics/reports/product-profitability?${PERIOD()}`],
      ["GET", "/api/hr/payroll"],
    ];
    for (const [method, url] of denied) {
      const res = await call(B.cashier1, method, url);
      expect([403, 404], `kassir ${url}: ${res.statusCode}`).toContain(res.statusCode);
    }
    const stock = (await call(B.cashier1, "GET", `/api/inventory/stock/products/${B.p.COLA}`));
    if (stock.statusCode === 200) {
      for (const row of stock.json().stock as { avgCostPrice: string | null }[]) expect(row.avgCostPrice, "AVCO kassirga yashirin").toBeNull();
    }
    const adjust = await call(B.cashier1, "POST", "/api/inventory/stock/movements", { type: "adjust", productId: B.p.COLA, warehouseId: B.mainWh, quantity: "-1" });
    expect(adjust.statusCode, "kassir qoldiqni tuzata olmaydi").toBe(403);
    expect((await call(B.cashier1, "POST", "/api/purchase/payments", { supplierId: B.s.A!, amount: "1", method: "cash" })).statusCode).toBe(403);
    expect((await call(B.storekeeper, "GET", "/api/catalog/products/costs")).statusCode, "omborchiga tannarx yopiq").toBe(403);
    expect((await call(B.storekeeper, "POST", "/api/sales/payments", { customerId: B.c.A, amount: "1", method: "cash" })).statusCode).toBe(403);
    await expectMoney("rollar");
  });

  it("S29 — audit izi: narx o'zgarishi (eski → yangi), qoldiq tuzatish, xarid, qabul, sotuv, qaytarish, to'lov, o'tkazma, sanoq, smena", async () => {
    const changed = await call(B.owner, "PATCH", `/api/catalog/products/${B.p.GUM}`, { salesPrice: "5500" });
    expect(changed.statusCode, changed.body).toBe(200);
    const [priceLog] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.companyId, B.companyId), eq(auditLogs.action, "PRODUCT_UPDATED"), eq(auditLogs.resourceId, B.p.GUM!)))
      .limit(1);
    expect(priceLog!.details, "narx: eski → yangi").toMatchObject({ diff: { salesPrice: { old: "5000.0000", new: "5500.0000" } } });
    expect(priceLog!.userId, "kim").toBeTruthy();
    const actions = (await db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.companyId, B.companyId))).map((row) => row.action);
    console.log("AUDIT ACTIONS:", [...new Set(actions)].sort().join(", "));
    expect(actions.length).toBeGreaterThan(50);
  });

  it("S30 — baza invariantlari: qoldiq ≥ 0, band ≤ qoldiq, qaytarish ≤ sotilgan, taqsimot ≤ to'lov, harakatlar = qoldiq, debet = kredit", async () => {
    const [bad] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(stockLevels)
      .where(and(eq(stockLevels.companyId, B.companyId), sql`${stockLevels.quantity} < 0 or ${stockLevels.reservedQty} < 0 or ${stockLevels.reservedQty} > ${stockLevels.quantity}`));
    expect(bad!.n, "qoldiq invariantlari").toBe(0);
    const [overReturn] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(salesOrderItems)
      .where(and(eq(salesOrderItems.companyId, B.companyId), sql`${salesOrderItems.returnedQty} > ${salesOrderItems.quantity} or ${salesOrderItems.returnedQty} < 0`));
    expect(overReturn!.n, "qaytarish ≤ sotilgan").toBe(0);
    const moved = await db
      .select({ productId: stockMovements.productId, warehouseId: stockMovements.warehouseId, qty: sql<string>`sum(${stockMovements.quantity})::numeric(18,4)` })
      .from(stockMovements)
      .where(eq(stockMovements.companyId, B.companyId))
      .groupBy(stockMovements.productId, stockMovements.warehouseId);
    const levels = await db.select().from(stockLevels).where(eq(stockLevels.companyId, B.companyId));
    for (const level of levels) {
      const sum = moved.find((row) => row.productId === level.productId && row.warehouseId === level.warehouseId);
      expect(n(sum?.qty), `harakatlar = qoldiq (${level.productId})`).toBe(n(level.quantity));
    }
    const [dupBarcodes] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(sql`(select company_id, barcode from products where barcode is not null and btrim(barcode) <> '' group by 1, 2 having count(*) > 1) d`);
    expect(dupBarcodes!.n, "shtrix-kod kompaniyada unikal").toBe(0);
    const [paymentsOver] = await db.execute<{ n: number }>(sql`
      select count(*)::int n from customer_payments p
      where p.company_id = ${B.companyId} and p.status = 'posted' and p.amount < 0`).then((res) => res.rows);
    expect(paymentsOver!.n, "manfiy to'lov yo'q").toBe(0);
    await expectBalanced(B.companyId, "invariantlar");
    await expectInventoryValue(B.companyId, "invariantlar");
    await expectMoney("invariantlar");
  });
});

// ─── YAKUNIY SENARIY (58-bo'lim) — alohida kompaniyada, aniq raqamlar bilan ──────────────────────────────────────

describe("SUPERMARKET — YAKUNIY SENARIY (BONNU FINAL): har raqam mustaqil hisob bilan", () => {
  const Z = emptyCompany();
  const money = { cash: 0, bank: 0 };
  let branch = "";
  const expectCashBank = async (label: string) => {
    expect(await balanceOf(Z.cash), `${label}: kassa`).toBe(money.cash);
    expect(await ledger(Z.companyId, "1010"), `${label}: 1010`).toBe(money.cash);
    expect(await balanceOf(Z.bank), `${label}: bank`).toBe(money.bank);
    expect(await ledger(Z.companyId, "1020"), `${label}: 1020`).toBe(money.bank);
  };

  it("F1 — ochilish: kassa 10 mln, bank 20 mln; xarid 100 blok × 60 000 (1 blok = 6) → 600 dona, tannarx 10 000; to'lov 2 mln → qarz 4 mln", async () => {
    const company = await createCompany(app, adminCookie, { name: "BONNU FINAL" });
    Z.companyId = company.companyId;
    Z.owner = company.ownerCookie;
    Z.mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, Z.companyId)))[0]!.id;
    const list = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, Z.companyId));
    Z.cash = list.find((row) => row.isDefault)!.id;
    Z.bank = list.find((row) => row.type === "bank")!.id;
    const chart = (await call(Z.owner, "GET", "/api/finance/accounts")).json().accounts as { id: string; code: string }[];
    const capital = chart.find((row) => row.code === "3000")!.id;
    await call(Z.owner, "POST", "/api/finance/cash-transactions", { cashAccountId: Z.cash, type: "in", amount: "10000000", description: "Ochilish", counterAccountId: capital });
    await call(Z.owner, "POST", "/api/finance/cash-transactions", { cashAccountId: Z.bank, type: "in", amount: "20000000", description: "Ochilish", counterAccountId: capital });
    money.cash = 10_000_000;
    money.bank = 20_000_000;
    const water = await call(Z.owner, "POST", "/api/catalog/products", { name: "Mineral suv", sku: "FIN-WATER", barcode: ean13("478200000001"), baseUnitId: piece, purchaseUnitId: block, salesPrice: "12000", taxRate: "0" });
    Z.p.WATER! = water.json().product.id;
    await call(Z.owner, "POST", "/api/catalog/unit-conversions", { productId: Z.p.WATER!, fromUnitId: block, toUnitId: piece, factor: "6" });
    const goods = await call(Z.owner, "POST", "/api/catalog/products", { name: "Yetkazma tovari", sku: "FIN-DLV", barcode: ean13("478200000002"), baseUnitId: piece, salesPrice: "10000", taxRate: "0" });
    Z.p.DLV! = goods.json().product.id;
    const supplier = await call(Z.owner, "POST", "/api/purchase/suppliers", { name: "SUPPLIER A", phone: uniquePhone("94") });
    Z.s.A = supplier.json().supplier.id;
    const order = await createOrder(Z, Z.s.A!, [{ productId: Z.p.WATER!, qty: "100", price: "60000", unitId: block }, { productId: Z.p.DLV!, qty: "100", price: "8000" }]);
    const res = await receive(Z, order.id, order.items.map((item) => ({ orderItemId: item.id, receivedQty: "100" })));
    expect(res.statusCode, res.body).toBe(201);
    expect(await stockOf(Z.p.WATER!, Z.mainWh), "600 dona").toBe(600);
    const [level] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, Z.p.WATER!), eq(stockLevels.warehouseId, Z.mainWh)));
    expect(n(level!.avgCostPrice)).toBe(10_000);
    const paid = await call(Z.owner, "POST", "/api/purchase/payments", { supplierId: Z.s.A, amount: "2000000", method: "cash", cashAccountId: Z.cash, reference: "FIN-SP-1" });
    expect(paid.statusCode, paid.body).toBe(201);
    money.cash -= 2_000_000;
    // Qarz: suv 6 000 000 + yetkazma tovari 800 000 − 2 000 000
    expect(await supplierDebt(Z.s.A!)).toBe(4_800_000);
    await expectCashBank("F1");
    await expectBalanced(Z.companyId, "F1");
  });

  it("F2 — sotuv #1: 50 dona × 12 000 = 600 000, 200 000 naqd → qarz 400 000; sotuv #2: 1 blok = 70 000 (kelishilgan), COGS 60 000, foyda 10 000", async () => {
    const customer = await call(Z.owner, "POST", "/api/sales/customers", { name: "CUSTOMER A", phone: uniquePhone("95"), creditLimit: "5000000", ...shop });
    Z.c.A = customer.json().customer.id;
    const shift = await call(Z.owner, "POST", "/api/sales/pos/shifts", { warehouseId: Z.mainWh, openingCash: "0" });
    Z.shift1 = shift.json().shift.id;
    const sale1 = await call(Z.owner, "POST", "/api/sales/pos/sales", { shiftId: Z.shift1, customerId: Z.c.A, items: [{ productId: Z.p.WATER!, quantity: "50" }], paymentMethod: "cash", amountPaid: "200000", onCredit: true });
    expect(sale1.statusCode, sale1.body).toBe(201);
    expect(n(sale1.json().order.totalAmount)).toBe(600_000);
    money.cash += 200_000;
    expect(await debtOf(Z.c.A!)).toBe(400_000);
    // Blok narxi — mijoz × mahsulot × birlik narx resolveri (kanonik)
    const agreed = await call(Z.owner, "POST", "/api/sales/customer-prices", { customerId: Z.c.A, productId: Z.p.WATER!, unitId: block, price: "70000" });
    expect(agreed.statusCode, agreed.body).toBe(201);
    const cogsBefore = await ledger(Z.companyId, "5000");
    const sale2 = await call(Z.owner, "POST", "/api/sales/pos/sales", { shiftId: Z.shift1, customerId: Z.c.A, items: [{ productId: Z.p.WATER!, unitId: block, quantity: "1" }], paymentMethod: "cash", amountPaid: "70000" });
    expect(sale2.statusCode, sale2.body).toBe(201);
    Z.orders.SALE2 = sale2.json().order.id;
    expect(n(sale2.json().order.totalAmount), "sotuv #2 = 70 000").toBe(70_000);
    money.cash += 70_000;
    expect((await ledger(Z.companyId, "5000")) - cogsBefore, "COGS 6 × 10 000").toBe(60_000);
    expect(await stockOf(Z.p.WATER!, Z.mainWh)).toBe(544);
    await expectCashBank("F2");
    await expectBalanced(Z.companyId, "F2");
  });

  it("F3 — mijoz 400 000 bank → qarz 0; qaytarish 1 blok → ombor +6, tushum −70 000, COGS −60 000", async () => {
    const paid = await call(Z.owner, "POST", "/api/sales/payments", { customerId: Z.c.A, amount: "400000", method: "bank", cashAccountId: Z.bank, reference: "FIN-CP-1" });
    expect(paid.statusCode, paid.body).toBe(201);
    money.bank += 400_000;
    expect(await debtOf(Z.c.A!)).toBe(0);
    const [item] = await db.select().from(salesOrderItems).where(eq(salesOrderItems.orderId, Z.orders.SALE2!));
    const revenueBefore = await ledger(Z.companyId, "4000");
    const cogsBefore = await ledger(Z.companyId, "5000");
    const back = await call(Z.owner, "POST", `/api/sales/orders/${Z.orders.SALE2}/return-items`, { items: [{ orderItemId: item!.id, quantity: "1" }], refundMethod: "cash", reason: "1 blok qaytdi", requestId: randomUUID() });
    expect(back.statusCode, back.body).toBe(201);
    money.cash -= 70_000;
    expect(await stockOf(Z.p.WATER!, Z.mainWh), "+6 dona").toBe(550);
    expect(revenueBefore - (await ledger(Z.companyId, "4000"))).toBe(70_000);
    expect(cogsBefore - (await ledger(Z.companyId, "5000"))).toBe(60_000);
    await expectCashBank("F3");
    await expectBalanced(Z.companyId, "F3");
  });

  it("F4 — xarajat 500 000 naqd; o'tkazma 100 dona MAIN → BRANCH (jami o'zgarmaydi)", async () => {
    const expense = await call(Z.owner, "POST", "/api/finance/expenses", { category: "boshqa", description: "Ijara", amount: "500000", expenseDate: businessToday() });
    const id = expense.json().expense.id;
    await call(Z.owner, "POST", `/api/finance/expenses/${id}/status`, { status: "approved" });
    expect((await call(Z.owner, "POST", `/api/finance/expenses/${id}/status`, { status: "paid", cashAccountId: Z.cash })).statusCode).toBe(200);
    money.cash -= 500_000;
    const created = await call(Z.owner, "POST", "/api/inventory/warehouses", { name: "BRANCH", code: "BR-1" });
    branch = created.json().warehouse.id;
    const moved = await call(Z.owner, "POST", "/api/inventory/stock/transfers", { productId: Z.p.WATER!, fromWarehouseId: Z.mainWh, toWarehouseId: branch, quantity: "100", requestId: randomUUID() });
    expect(moved.statusCode, moved.body).toBe(201);
    expect(await stockOf(Z.p.WATER!, Z.mainWh)).toBe(450);
    expect(await stockOf(Z.p.WATER!, branch)).toBe(100);
    await expectCashBank("F4");
    await expectBalanced(Z.companyId, "F4");
  });

  it("F5 — yetkazma: buyurtma 1 000 000, 700 000 yetkazildi (300 000 qaytdi), yig'ildi naqd 300 000 + karta 200 000; naqd kassaga topshirildi", async () => {
    await setPolicy(app, Z.owner, { ...NO_PROOFS });
    const courier = await deliveryAgent(app, { ownerCookie: Z.owner });
    await startShift(app, courier.cookie);
    const created = await call(Z.owner, "POST", "/api/sales/orders", { customerId: Z.c.A, warehouseId: Z.mainWh, orderDate: businessToday(), deliveryRequired: true, items: [{ productId: Z.p.DLV!, quantity: "100" }] });
    expect(created.statusCode, created.body).toBe(201);
    const orderId = created.json().order.id;
    expect(n(created.json().order.totalAmount)).toBe(1_000_000);
    expect((await call(Z.owner, "POST", `/api/sales/orders/${orderId}/confirm`)).statusCode).toBe(200);
    const task = await taskForOrder(app, Z.owner, orderId);
    await assign(app, Z.owner, task.id, courier.id);
    for (const [action, body] of [["accept", {}], ["start", {}], ["arrive", near(30)], ["delivering", {}]] as const) {
      const res = await agentAction(app, courier.cookie, task.id, action, body);
      expect(res.statusCode, `${action}: ${res.body}`).toBe(200);
    }
    const pay = await agentAction(app, courier.cookie, task.id, "payments", { parts: [{ method: "cash", amount: "300000" }, { method: "card", amount: "200000" }] });
    expect(pay.statusCode, pay.body).toBe(201);
    const detail = (await call(courier.cookie, "GET", `/api/delivery/agent/tasks/${task.id}`)).json().task as { items: { id: string }[] };
    const done = await agentAction(app, courier.cookie, task.id, "confirm", { ...near(20), items: [{ taskItemId: detail.items[0]!.id, deliveredQty: "70" }] });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().summary.status).toBe("partially_delivered");
    // Yetkazilmagan 30 dona hali yetkazuvchida — buyurtma qarzi to'liq (1 000 000 − 500 000); omborga qaytarilgach tuzatiladi
    expect(await debtOf(Z.c.A!), "yetkazuvchidagi tovar hali qaytmagan").toBe(500_000);
    const returned = await call(Z.owner, "POST", `/api/delivery/tasks/${task.id}/return`, { reason: "Qolgan 30 dona omborga qaytdi" });
    expect(returned.statusCode, returned.body).toBeLessThan(300);
    // 700 000 yetkazildi, 500 000 to'landi → mijoz qarzi 200 000; yetkazilmagan 30 dona omborda
    expect(await debtOf(Z.c.A!), "qarz = yetkazilgan − to'langan").toBe(200_000);
    expect(await stockOf(Z.p.DLV!, Z.mainWh), "100 − 70 (30 qaytdi)").toBe(30);
    // Karta — bank hisobiga; naqd — yetkazuvchidagi "yo'ldagi naqd"da, keyin kassaga topshiriladi
    const handover = await call(Z.owner, "POST", `/api/delivery/agents/${courier.id}/cash-handover`, { amount: "300000" });
    expect(handover.statusCode, handover.body).toBe(201);
    money.cash += 300_000;
    const [cardIn] = await db
      .select({ v: sql<string>`coalesce(sum(${cashTransactions.amount}), 0)::numeric(18,2)` })
      .from(cashTransactions)
      .innerJoin(cashAccounts, eq(cashAccounts.id, cashTransactions.cashAccountId))
      .where(and(eq(cashAccounts.companyId, Z.companyId), eq(cashAccounts.type, "bank"), eq(cashTransactions.type, "in"), sql`${cashTransactions.description} is distinct from 'Ochilish'`));
    money.bank += n(cardIn!.v) - 400_000;
    expect(n(cardIn!.v) - 400_000, "karta 200 000 bankka").toBe(200_000);
    await expectCashBank("F5");
    await expectBalanced(Z.companyId, "F5");
  });

  it("F6 — yakuniy solishtiruv: kassa, bank, ombor, qarzlar, tushum, COGS, yalpi va sof foyda — mustaqil hisob = tizim", async () => {
    // Kassa: 10 000 000 − 2 000 000 + 200 000 + 70 000 − 70 000 − 500 000 + 300 000
    expect(money.cash).toBe(8_000_000);
    // Bank: 20 000 000 + 400 000 + 200 000
    expect(money.bank).toBe(20_600_000);
    await expectCashBank("yakun");
    // Tushum: 600 000 + 70 000 − 70 000 + 700 000 = 1 300 000; COGS: 500 000 + 60 000 − 60 000 + 70 × 8 000 = 1 060 000
    const revenue = await ledger(Z.companyId, "4000");
    const cogs = await ledger(Z.companyId, "5000");
    expect(revenue, "tushum").toBe(1_300_000);
    expect(cogs, "COGS").toBe(1_060_000);
    const pnl = (await call(Z.owner, "GET", `/api/finance/reports/profit-loss?dateFrom=2000-01-01&dateTo=${businessToday()}`)).json();
    expect(n(pnl.netProfit), `sof foyda: ${JSON.stringify(pnl)}`).toBe(1_300_000 - 1_060_000 - 500_000);
    // Qarzlar: mijoz 200 000, ta'minotchi 4 800 000
    expect(await debtOf(Z.c.A!)).toBe(200_000);
    expect(await ledger(Z.companyId, "1100")).toBe(200_000);
    expect(await supplierDebt(Z.s.A!)).toBe(4_800_000);
    expect(await ledger(Z.companyId, "2000")).toBe(4_800_000);
    // Ombor: suv MAIN 450 + BRANCH 100 = 550 × 10 000; yetkazma tovari 30 × 8 000
    expect(await stockOf(Z.p.WATER!, Z.mainWh)).toBe(450);
    expect(await stockOf(Z.p.WATER!, branch)).toBe(100);
    await expectInventoryValue(Z.companyId, "yakun", 550 * 10_000 + 30 * 8_000);
    expect(await ledger(Z.companyId, "1200")).toBe(5_740_000);
    await expectBalanced(Z.companyId, "yakun");
    const report = (await call(Z.owner, "GET", `/api/analytics/reports/product-profitability?${PERIOD()}`)).json();
    expect(n(report.totals.netRevenue)).toBe(1_300_000);
    expect(n(report.totals.cogs)).toBe(1_060_000);
    console.log("YAKUNIY SENARIY:", JSON.stringify({ kassa: money.cash, bank: money.bank, tushum: revenue, cogs, yalpiFoyda: revenue - cogs, xarajat: 500_000, sofFoyda: n(pnl.netProfit), mijozQarzi: 200_000, taminotchiQarzi: 4_800_000, ombor: 5_740_000 }));
  });
});
