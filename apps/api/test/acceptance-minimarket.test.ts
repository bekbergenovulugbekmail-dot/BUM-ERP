/**
 * BUSINESS 01 — MINI MARKET: 0 → 100 REAL BIZNES QABUL TESTI (2026-09-26).
 *
 * Bitta kompaniya (`TEST-01-MINIMARKET`) va begona tenant (`TEST-01-FOREIGN`) izolyatsiyalangan TEST bazada (`resetDatabase`
 * faqat `_test` bazada ishlaydi). Har moliyaviy qadamdan keyin: biznes hodisasi → baza → ombor → mijoz/ta'minotchi balansi →
 * kassa/bank → jurnal → hisobot. Kutilgan qiymatlar test ichida MUSTAQIL hisoblanadi (`book` — kutilgan kitob), keyin
 * bazadagi haqiqiy qiymat bilan 1 so'm aniqlikda solishtiriladi.
 *
 * Narxlar (so'm): X = Coca Cola 1L (tannarx 10 000 → 15 000 AVCO, sotuv 20 000), Y = Shampun (20 000 / 25 000),
 * Z = Sharbat 1L (blok = 6 dona, 60 000 / blok → 10 000 dona; sotuv 20 000), W = Yog' 1L (30 000 / 40 000).
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { deliveryTasks } from "../src/db/schema/delivery.js";
import { accounts, cashAccounts, cashTransactions, journalEntries, journalLines } from "../src/db/schema/finance.js";
import { stockLevels, stockMovements, warehouses } from "../src/db/schema/inventory.js";
import { auditLogs } from "../src/db/schema/platform.js";
import { suppliers } from "../src/db/schema/purchase.js";
import { customerPayments, customers, salesOrderItems, salesOrders, salesReturns } from "../src/db/schema/sales.js";
import { buildServer } from "../src/server.js";
import { resetUnits } from "./delivery-setup.js";
import { addEmployee, createCompany, resetDatabase, signedIn, uniquePhone } from "./helpers.js";

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

let app: FastifyInstance;
let adminCookie: string;
let piece: string;
let block: string;
let pack: string;

const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

const localIso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
/** Server biznes sanasi (Toshkent) — UTC emas (tunda farq qiladi). */
const businessToday = () => new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
const n = (value: string | number | null | undefined) => Number(value ?? 0);
void localIso;

/** Mini market holati — testlar orasida umumiy. */
const S = {
  companyId: "",
  owner: "",
  manager: "",
  cashier: "",
  storekeeper: "",
  foreignOwner: "",
  foreignCompanyId: "",
  mainWh: "",
  secondWh: "",
  cash: "",
  bank: "",
  shiftId: "",
  p: {} as Record<string, string>,
  s: {} as Record<string, string>,
  c: {} as Record<string, string>,
  orders: {} as Record<string, string>,
};

/** MUSTAQIL kitob: kutilgan kassa, bank va sof natija komponentlari (test o'zi yig'adi). */
const book = {
  cash: 0,
  bank: 0,
  grossSales: 0,
  returns: 0,
  cogs: 0,
  opex: 0,
  cashFlow: [] as { label: string; amount: number }[],
  bankFlow: [] as { label: string; amount: number }[],
};
const cashMove = (label: string, amount: number) => {
  book.cash += amount;
  book.cashFlow.push({ label, amount });
};
const bankMove = (label: string, amount: number) => {
  book.bank += amount;
  book.bankFlow.push({ label, amount });
};

// ─── Baza holati ─────────────────────────────────────────────────────────────

async function balanceOf(cashAccountId: string) {
  const [row] = await db.select({ balance: cashAccounts.balance }).from(cashAccounts).where(eq(cashAccounts.id, cashAccountId));
  return n(row!.balance);
}

async function stockOf(productId: string, warehouseId = S.mainWh) {
  const [row] = await db
    .select({ quantity: stockLevels.quantity, reserved: stockLevels.reservedQty })
    .from(stockLevels)
    .where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, warehouseId)));
  if (!row) return 0;
  expect(n(row.quantity), "manfiy qoldiq").toBeGreaterThanOrEqual(0);
  expect(n(row.reserved), "band > qoldiq").toBeLessThanOrEqual(n(row.quantity));
  return n(row.quantity);
}

async function ledger(code: string) {
  const [row] = await db.select({ balance: accounts.balance }).from(accounts).where(and(eq(accounts.companyId, S.companyId), eq(accounts.code, code)));
  return n(row?.balance);
}

/** Mijoz qarzi: kesh (`total_debt`) = jurnal subhisobi (1100, kontragent) — farq bo'lsa darhol yiqiladi. */
async function debtOf(customerId: string) {
  const [cache] = await db.select({ debt: customers.totalDebt, balance: customers.balance }).from(customers).where(eq(customers.id, customerId));
  const [led] = await db
    .select({ debt: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)::numeric(18,2)` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalLines.partyType, "customer"), eq(journalLines.partyId, customerId), eq(accounts.subtype, "receivable"), eq(journalEntries.status, "posted")));
  expect(n(cache!.debt), "mijoz qarzi: kesh = jurnal").toBe(n(led!.debt));
  return n(cache!.debt);
}

/** Ta'minotchi qarzi: kesh = jurnal subhisobi (2000). */
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

/** Har yozuv ichida va jami debet = kredit. */
async function expectBalanced(label: string) {
  const unbalanced = await db
    .select({ entryId: journalLines.entryId })
    .from(journalLines)
    .where(eq(journalLines.companyId, S.companyId))
    .groupBy(journalLines.entryId)
    .having(sql`sum(${journalLines.debit}) <> sum(${journalLines.credit})`);
  expect(unbalanced, `${label}: balanslanmagan jurnal yozuvi`).toHaveLength(0);
  const [tot] = await db
    .select({ d: sql<string>`coalesce(sum(${journalLines.debit}), 0)::numeric(18,2)`, c: sql<string>`coalesce(sum(${journalLines.credit}), 0)::numeric(18,2)` })
    .from(journalLines)
    .where(eq(journalLines.companyId, S.companyId));
  expect(tot!.d, `${label}: jami debet = kredit`).toBe(tot!.c);
}

/** Ombor qiymati (Σ qoldiq × o'rtacha tannarx) = 1200 hisobi. */
async function expectInventoryValue(expected: number | null, label: string) {
  const [row] = await db
    .select({ value: sql<string>`coalesce(sum(round(${stockLevels.quantity} * ${stockLevels.avgCostPrice}, 2)), 0)::numeric(18,2)` })
    .from(stockLevels)
    .where(eq(stockLevels.companyId, S.companyId));
  expect(await ledger("1200"), `${label}: 1200 = ombor qiymati`).toBe(n(row!.value));
  if (expected !== null) expect(n(row!.value), `${label}: ombor qiymati`).toBe(expected);
}

/** Kassa va bank: kitob (mustaqil hisob) = hisob qoldig'i = 1010/1020 jurnal hisobi. */
async function expectMoney(label: string) {
  expect(await balanceOf(S.cash), `${label}: kassa`).toBe(book.cash);
  expect(await balanceOf(S.bank), `${label}: bank`).toBe(book.bank);
  expect(await ledger("1010"), `${label}: 1010 = kassa`).toBe(book.cash);
  expect(await ledger("1020"), `${label}: 1020 = bank`).toBe(book.bank);
}

const journalCount = async () => {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(journalEntries).where(eq(journalEntries.companyId, S.companyId));
  return row!.n;
};

// ─── Biznes amallari ─────────────────────────────────────────────────────────

async function purchase(supplierId: string, lines: { productId: string; qty: string; price: string; unitId?: string }[], cookie = S.owner) {
  const created = await call(cookie, "POST", "/api/purchase/orders", {
    supplierId,
    warehouseId: S.mainWh,
    orderDate: businessToday(),
    items: lines.map((line) => ({ productId: line.productId, unitId: line.unitId ?? piece, orderedQty: line.qty, unitPrice: line.price })),
  });
  expect(created.statusCode, created.body).toBe(201);
  const order = created.json().order as { id: string; totalAmount: string; items: { id: string; productId: string; unitId: string }[] };
  expect((await call(cookie, "POST", `/api/purchase/orders/${order.id}/confirm`)).statusCode).toBe(200);
  const receipt = await call(cookie, "POST", `/api/purchase/orders/${order.id}/receipts`, {
    receiptDate: businessToday(),
    items: order.items.map((item) => ({ orderItemId: item.id, receivedQty: lines.find((line) => line.productId === item.productId && (line.unitId ?? piece) === item.unitId)!.qty })),
  });
  expect(receipt.statusCode, receipt.body).toBe(201);
  return order;
}

const pos = (payload: object, cookie = S.cashier) => call(cookie, "POST", "/api/sales/pos/sales", { shiftId: S.shiftId, ...payload });

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
  await resetDatabase();
  await resetUnits();
  adminCookie = (await signedIn(app, { isPlatformAdmin: true })).cookie;
  piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  block = (await db.select().from(units).where(eq(units.shortName, "bl")))[0]!.id;
}, 120_000);

afterAll(async () => {
  await app.close();
  await closeDb();
});

describe("BUSINESS 01 — MINI MARKET (TEST-01-MINIMARKET)", () => {
  it("PHASE 1 — bootstrap: kompaniya, MAIN-WH, rollar, boshlang'ich kassa 10 mln va bank 20 mln", async () => {
    const company = await createCompany(app, adminCookie, { name: "TEST-01-MINIMARKET" });
    const foreign = await createCompany(app, adminCookie, { name: "TEST-01-FOREIGN" });
    S.companyId = company.companyId;
    S.owner = company.ownerCookie;
    S.foreignOwner = foreign.ownerCookie;
    S.foreignCompanyId = foreign.companyId;
    const [wh] = await db.select().from(warehouses).where(eq(warehouses.companyId, S.companyId));
    S.mainWh = wh!.id;
    expect((await call(S.owner, "PATCH", `/api/inventory/warehouses/${S.mainWh}`, { name: "MAIN-WH" })).statusCode).toBe(200);
    const me = (await call(S.owner, "GET", "/api/company")).json();
    expect(me.company).toMatchObject({ name: "TEST-01-MINIMARKET", currency: "UZS" });

    S.manager = (await addEmployee(app, company, "Savdo menejeri")).cookie;
    S.cashier = (await addEmployee(app, company, "Kassir")).cookie;
    S.storekeeper = (await addEmployee(app, company, "Omborchi")).cookie;

    const list = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, S.companyId));
    S.cash = list.find((row) => row.isDefault)!.id;
    S.bank = list.find((row) => row.type === "bank")!.id;
    const chart = (await call(S.owner, "GET", "/api/finance/accounts")).json().accounts as { id: string; code: string }[];
    const capital = chart.find((row) => row.code === "3000")!.id;
    for (const [id, amount] of [[S.cash, "10000000"], [S.bank, "20000000"]] as const) {
      const res = await call(S.owner, "POST", "/api/finance/cash-transactions", { cashAccountId: id, type: "in", amount, description: "Boshlang'ich mablag'", counterAccountId: capital });
      expect(res.statusCode, res.body).toBe(201);
    }
    cashMove("Boshlang'ich kassa", 10_000_000);
    bankMove("Boshlang'ich bank", 20_000_000);
    await expectMoney("bootstrap");
    await expectBalanced("bootstrap");

    const shift = await call(S.cashier, "POST", "/api/sales/pos/shifts", { warehouseId: S.mainWh, openingCash: "0" });
    expect(shift.statusCode, shift.body).toBe(201);
    S.shiftId = shift.json().shift.id;
  });

  it("PHASE 1b — rollar: kassir tannarx, ta'minotchi moliyasi va buxgalteriyaga kira olmaydi; begona tenant ko'rmaydi", async () => {
    expect((await call(S.cashier, "GET", "/api/catalog/products/costs")).statusCode).toBe(403);
    expect((await call(S.cashier, "GET", "/api/purchase/payments")).statusCode).toBe(403);
    expect((await call(S.cashier, "GET", "/api/purchase/suppliers")).statusCode).toBe(403);
    expect((await call(S.cashier, "GET", "/api/finance/journal")).statusCode).toBe(403);
    expect((await call(S.cashier, "GET", `/api/finance/reports/profit-loss?dateFrom=2000-01-01&dateTo=${businessToday()}`)).statusCode).toBe(403);
    expect((await call(S.storekeeper, "GET", `/api/inventory/stock?warehouseId=${S.mainWh}`)).statusCode).toBe(200);
    expect((await call(S.storekeeper, "GET", `/api/finance/reports/profit-loss?dateFrom=2000-01-01&dateTo=${businessToday()}`)).statusCode).toBe(403);
    expect((await call(S.manager, "GET", "/api/sales/orders")).statusCode).toBe(200);
    expect((await call(S.foreignOwner, "GET", `/api/inventory/warehouses/${S.mainWh}`)).statusCode).toBe(404);
  });

  it("PHASE 2 — master data: 3 ta'minotchi, 5 mijoz, 20 mahsulot (kategoriya, SKU, shtrix-kod), blok = 6, pachka = 12", async () => {
    for (const name of ["Supplier A", "Supplier B", "Supplier C"]) {
      const res = await call(S.owner, "POST", "/api/purchase/suppliers", { name, phone: uniquePhone("94") });
      expect(res.statusCode, res.body).toBe(201);
      S.s[name] = res.json().supplier.id;
    }
    for (const [name, limit, term] of [["Customer A", "0", 0], ["Customer B", "2000000", 15], ["Customer C", "3000000", 30], ["Customer D", "500000", 7], ["Customer E", "0", 0]] as const) {
      const res = await call(S.owner, "POST", "/api/sales/customers", { name, phone: uniquePhone("95"), address: `Urganch, ${name}`, creditLimit: limit, paymentTermDays: term });
      expect(res.statusCode, res.body).toBe(201);
      S.c[name] = res.json().customer.id;
    }
    const categories: Record<string, string> = {};
    for (const name of ["Ichimliklar", "Oziq-ovqat", "Maishiy kimyo", "Gigiyena"]) {
      const res = await call(S.owner, "POST", "/api/catalog/categories", { name });
      expect(res.statusCode, res.body).toBe(201);
      categories[name] = res.json().category.id;
    }
    // O'lchov birliklari — platforma katalogi (admin qo'shadi), kompaniyalar ulashadi
    const unit = await call(adminCookie, "POST", "/api/catalog/units", { name: "Pachka", shortName: "pch", isBase: false });
    expect([200, 201], unit.body).toContain(unit.statusCode);
    pack = unit.json().unit.id;

    const catalog: [key: string, name: string, sku: string, price: string, category: string][] = [
      ["X", "Coca Cola 1L", "MM-COLA", "20000", "Ichimliklar"],
      ["PEPSI", "Pepsi 1L", "MM-PEPSI", "14000", "Ichimliklar"],
      ["FANTA", "Fanta 1L", "MM-FANTA", "14000", "Ichimliklar"],
      ["SPRITE", "Sprite 1L", "MM-SPRITE", "14000", "Ichimliklar"],
      ["SUV05", "Suv 0.5L", "MM-SUV05", "3000", "Ichimliklar"],
      ["SUV15", "Suv 1.5L", "MM-SUV15", "5000", "Ichimliklar"],
      ["NON", "Non", "MM-NON", "4000", "Oziq-ovqat"],
      ["SHAKAR", "Shakar 1kg", "MM-SHAKAR", "15000", "Oziq-ovqat"],
      ["GURUCH", "Guruch 1kg", "MM-GURUCH", "18000", "Oziq-ovqat"],
      ["MAKARON", "Makaron", "MM-MAKARON", "9000", "Oziq-ovqat"],
      ["W", "Yog' 1L", "MM-YOG", "40000", "Oziq-ovqat"],
      ["CHOY", "Choy 100g", "MM-CHOY", "12000", "Oziq-ovqat"],
      ["PECH", "Pechenye", "MM-PECH", "3000", "Oziq-ovqat"],
      ["Y", "Shampun", "MM-SHAMPUN", "25000", "Gigiyena"],
      ["SOVUN", "Sovun", "MM-SOVUN", "6000", "Gigiyena"],
      ["TISH", "Tish pastasi", "MM-TISH", "15000", "Gigiyena"],
      ["SALFETKA", "Salfetka", "MM-SALFETKA", "5000", "Gigiyena"],
      ["KIR", "Kir yuvish kukuni", "MM-KIR", "35000", "Maishiy kimyo"],
      ["KOFE", "Kofe 3in1", "MM-KOFE", "2500", "Oziq-ovqat"],
      ["Z", "Sharbat 1L", "MM-SHARBAT", "20000", "Ichimliklar"],
    ];
    for (const [key, name, sku, price, category] of catalog) {
      const res = await call(S.owner, "POST", "/api/catalog/products", { name, sku, barcode: `478${sku.replace(/\D/g, "").padEnd(3, "0")}${String(Object.keys(S.p).length).padStart(7, "0")}`, baseUnitId: piece, salesPrice: price, taxRate: "0", categoryId: categories[category] });
      expect(res.statusCode, `${name}: ${res.body}`).toBe(201);
      S.p[key] = res.json().product.id;
    }
    expect(Object.keys(S.p)).toHaveLength(20);
    for (const [productId, unitId, factor] of [[S.p.Z!, block, "6"], [S.p.PECH!, pack, "12"]] as const) {
      const conv = await call(S.owner, "POST", "/api/catalog/unit-conversions", { productId, fromUnitId: unitId, toUnitId: piece, factor });
      expect([200, 201], conv.body).toContain(conv.statusCode);
    }
    expect((await call(S.foreignOwner, "GET", `/api/catalog/products/${S.p.X}`)).statusCode, "begona tenant mahsulotni ko'rmaydi").toBe(404);
  });

  it("PHASE 3 — xarid: A dan X 100×10 000, Y 50×20 000, Z 10 blok×60 000 = 2 600 000; qarz, ombor, qiymat, kassa o'zgarmaydi", async () => {
    const order = await purchase(S.s["Supplier A"]!, [
      { productId: S.p.X!, qty: "100", price: "10000" },
      { productId: S.p.Y!, qty: "50", price: "20000" },
      { productId: S.p.Z!, qty: "10", price: "60000", unitId: block },
    ]);
    expect(n(order.totalAmount)).toBe(2_600_000);
    expect(await supplierDebt(S.s["Supplier A"]!)).toBe(2_600_000);
    expect(await stockOf(S.p.X!)).toBe(100);
    expect(await stockOf(S.p.Y!)).toBe(50);
    expect(await stockOf(S.p.Z!), "10 blok = 60 dona").toBe(60);
    await expectInventoryValue(2_600_000, "xarid");
    await expectMoney("xarid: to'lovsiz — kassa/bank o'zgarmaydi");
    await expectBalanced("xarid");
  });

  it("PHASE 4 — ta'minotchiga to'lov: 1 000 000 naqd, 600 000 bank; takroriy to'lov ikki marta yozilmaydi", async () => {
    const supplierId = S.s["Supplier A"]!;
    const first = await call(S.owner, "POST", "/api/purchase/payments", { supplierId, amount: "1000000", method: "cash", cashAccountId: S.cash, reference: "SP-A-1" });
    expect(first.statusCode, first.body).toBe(201);
    cashMove("Supplier A naqd", -1_000_000);
    expect(await supplierDebt(supplierId)).toBe(1_600_000);
    const second = await call(S.owner, "POST", "/api/purchase/payments", { supplierId, amount: "600000", method: "bank", cashAccountId: S.bank, reference: "SP-A-2" });
    expect(second.statusCode, second.body).toBe(201);
    bankMove("Supplier A bank", -600_000);
    expect(await supplierDebt(supplierId)).toBe(1_000_000);
    const journals = await journalCount();
    const dup = await call(S.owner, "POST", "/api/purchase/payments", { supplierId, amount: "1000000", method: "cash", cashAccountId: S.cash, reference: "SP-A-1" });
    expect(dup.statusCode, "takroriy — mavjud to'lov qaytadi").toBe(200);
    expect(await supplierDebt(supplierId)).toBe(1_000_000);
    expect(await journalCount(), "takroriy jurnal yo'q").toBe(journals);
    await expectMoney("ta'minotchi to'lovi");
    await expectBalanced("ta'minotchi to'lovi");
  });

  it("PHASE 5 — AVCO: X yana 100×20 000 → 15 000; 50 dona sotuv COGS 750 000; qolgan 150 × 15 000", async () => {
    await purchase(S.s["Supplier B"]!, [{ productId: S.p.X!, qty: "100", price: "20000" }]);
    expect(await stockOf(S.p.X!)).toBe(200);
    const [level] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, S.p.X!), eq(stockLevels.warehouseId, S.mainWh)));
    expect(n(level!.avgCostPrice), "AVCO").toBe(15_000);
    const costs = (await call(S.owner, "GET", "/api/catalog/products/costs")).json().products as { id: string; avgCost: string }[];
    expect(n(costs.find((row) => row.id === S.p.X)!.avgCost), "tannarx kartochkasi = AVCO").toBe(15_000);
    await expectInventoryValue(2_600_000 + 2_000_000, "ikkinchi xarid");

    const cogsBefore = await ledger("5000");
    const sale = await pos({ items: [{ productId: S.p.X!, quantity: "50" }], paymentMethod: "cash", amountPaid: "1000000" });
    expect(sale.statusCode, sale.body).toBe(201);
    book.grossSales += 1_000_000;
    book.cogs += 750_000;
    cashMove("POS 50 X naqd", 1_000_000);
    const order = sale.json().order;
    const [item] = await db.select().from(salesOrderItems).where(eq(salesOrderItems.orderId, order.id));
    expect(n(item!.costPrice), "sotuv qatori tannarxi = AVCO").toBe(15_000);
    expect((await ledger("5000")) - cogsBefore, "COGS 50 × 15 000").toBe(750_000);
    expect(await stockOf(S.p.X!)).toBe(150);
    const [after] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, S.p.X!), eq(stockLevels.warehouseId, S.mainWh)));
    expect(n(after!.quantity) * n(after!.avgCostPrice), "qolgan qiymat").toBe(2_250_000);
    await expectInventoryValue(null, "AVCO sotuv");
    await expectMoney("AVCO sotuv");
    await expectBalanced("AVCO sotuv");
  });

  it("PHASE 6 — narx: A uchun kelishilgan 18 000 serverda qo'llanadi; kassir narxni 1 000 ga tushira olmaydi", async () => {
    const agreed = await call(S.owner, "POST", "/api/sales/customer-prices", { customerId: S.c["Customer A"], productId: S.p.X, unitId: piece, price: "18000" });
    expect(agreed.statusCode, agreed.body).toBe(201);
    const stock = await stockOf(S.p.X!);
    const journals = await journalCount();
    const hacked = await pos({ customerId: S.c["Customer A"], items: [{ productId: S.p.X!, quantity: "1", unitPrice: "1000" }], paymentMethod: "cash", amountPaid: "1000" });
    expect(hacked.statusCode, `narx manipulyatsiyasi rad etilishi kerak: ${hacked.body}`).toBeGreaterThanOrEqual(400);
    expect(await stockOf(S.p.X!), "rad etilgan chek omborga tegmaydi").toBe(stock);
    expect(await journalCount()).toBe(journals);
    await expectMoney("narx manipulyatsiyasi");
  });

  it("PHASE 7 — POS naqd: A ga 10 X (kelishilgan 18 000) = 180 000; yakunlangan, to'langan, yetkazmasiz", async () => {
    const cogsBefore = await ledger("5000");
    const sale = await pos({ customerId: S.c["Customer A"], items: [{ productId: S.p.X!, quantity: "10" }], paymentMethod: "cash", amountPaid: "180000" });
    expect(sale.statusCode, sale.body).toBe(201);
    const order = sale.json().order;
    S.orders.A = order.id;
    expect(n(order.totalAmount), "server narxi: kelishilgan 18 000").toBe(180_000);
    expect(order).toMatchObject({ status: "completed", paymentStatus: "paid", fulfillmentMethod: "counter" });
    expect(await db.select().from(deliveryTasks).where(eq(deliveryTasks.orderId, order.id)), "kassa chekiga yetkazma yo'q").toHaveLength(0);
    book.grossSales += 180_000;
    book.cogs += 150_000;
    cashMove("POS A 10 X", 180_000);
    expect((await ledger("5000")) - cogsBefore).toBe(150_000);
    expect(await debtOf(S.c["Customer A"]!)).toBe(0);
    expect(await stockOf(S.p.X!)).toBe(140);
    await expectMoney("POS naqd");
    await expectBalanced("POS naqd");
  });

  it("PHASE 8 — aralash to'lov: 40 Y × 25 000 = 1 000 000 (naqd 300k + karta 400k + bank 300k); takror — ta'sirsiz", async () => {
    const clientRequestId = randomUUID();
    const payload = {
      items: [{ productId: S.p.Y!, quantity: "40" }],
      payments: [{ method: "cash", amount: "300000" }, { method: "card", amount: "400000" }, { method: "bank", amount: "300000" }],
      clientRequestId,
    };
    const sale = await pos(payload);
    expect(sale.statusCode, sale.body).toBe(201);
    const order = sale.json().order;
    expect(n(order.totalAmount)).toBe(1_000_000);
    expect(order.paymentStatus).toBe("paid");
    const parts = await db.select().from(customerPayments).where(eq(customerPayments.orderId, order.id));
    expect(parts.reduce((sum, part) => sum + n(part.amount), 0), "qismlar yig'indisi = chek").toBe(1_000_000);
    book.grossSales += 1_000_000;
    book.cogs += 800_000;
    cashMove("POS aralash naqd", 300_000);
    bankMove("POS aralash karta+bank", 700_000);
    const dup = await pos(payload);
    expect(dup.statusCode).toBe(409);
    expect(await stockOf(S.p.Y!)).toBe(10);
    await expectMoney("aralash to'lov");
    await expectBalanced("aralash to'lov");
  });

  it("PHASE 9 — nasiya: B limiti 2 mln; 1 mln nasiya o'tadi, keyingi 1.5 mln RAD — ombor, qarz, kassa, jurnal o'zgarmaydi", async () => {
    const customerId = S.c["Customer B"]!;
    const sale = await pos({ customerId, items: [{ productId: S.p.Z!, quantity: "50" }], paymentMethod: "cash", amountPaid: "0", onCredit: true });
    expect(sale.statusCode, sale.body).toBe(201);
    expect(sale.json().order).toMatchObject({ status: "completed", paymentStatus: "unpaid" });
    book.grossSales += 1_000_000;
    book.cogs += 500_000;
    expect(await debtOf(customerId)).toBe(1_000_000);
    const stock = await stockOf(S.p.X!);
    const journals = await journalCount();
    const blocked = await pos({ customerId, items: [{ productId: S.p.X!, quantity: "75" }], paymentMethod: "cash", amountPaid: "0", onCredit: true });
    expect(blocked.statusCode, `limitdan oshgan nasiya rad: ${blocked.body}`).toBeGreaterThanOrEqual(400);
    expect(await stockOf(S.p.X!)).toBe(stock);
    expect(await debtOf(customerId)).toBe(1_000_000);
    expect(await journalCount()).toBe(journals);
    await expectMoney("nasiya");
    await expectBalanced("nasiya");
  });

  it("PHASE 10 — mijoz to'lovi: B 400k naqd + 600k bank → qarz 0, qarz yoshi 0; takror kamaytirmaydi", async () => {
    const customerId = S.c["Customer B"]!;
    const first = await call(S.owner, "POST", "/api/sales/payments", { customerId, amount: "400000", method: "cash", reference: "CP-B-1" });
    expect(first.statusCode, first.body).toBe(201);
    cashMove("B naqd to'lov", 400_000);
    expect(await debtOf(customerId)).toBe(600_000);
    const second = await call(S.owner, "POST", "/api/sales/payments", { customerId, amount: "600000", method: "bank", cashAccountId: S.bank, reference: "CP-B-2" });
    expect(second.statusCode, second.body).toBe(201);
    bankMove("B bank to'lov", 600_000);
    expect(await debtOf(customerId)).toBe(0);
    const dup = await call(S.owner, "POST", "/api/sales/payments", { customerId, amount: "400000", method: "cash", reference: "CP-B-1" });
    expect(dup.statusCode).toBe(200);
    expect(await debtOf(customerId)).toBe(0);
    const statement = (await call(S.owner, "GET", `/api/sales/customers/${customerId}/statement?from=2000-01-01&to=${businessToday()}`)).json();
    expect(statement.reconciliation.ok).toBe(true);
    expect(statement.aging.documents, "ochiq hujjat yo'q").toEqual([]);
    await expectMoney("mijoz to'lovi");
    await expectBalanced("mijoz to'lovi");
  });

  it("PHASE 11 — C: boshlang'ich balans +2 mln (sotuv EMAS, foyda EMAS), nasiya 1 mln, to'lov 500k", async () => {
    await purchase(S.s["Supplier C"]!, [{ productId: S.p.W!, qty: "50", price: "30000" }]);
    const customerId = S.c["Customer C"]!;
    const pnlBefore = (await call(S.owner, "GET", `/api/finance/reports/profit-loss?dateFrom=2000-01-01&dateTo=${businessToday()}`)).json();
    const imported = await call(S.owner, "POST", "/api/sales/customers/balance-import", { rows: [{ name: "Customer C", balance: "2000000", reason: "Eski tizimdan boshlang'ich qoldiq" }] });
    expect(imported.statusCode, imported.body).toBe(200);
    const [row] = await db.select().from(customers).where(eq(customers.id, customerId));
    expect(n(row!.balance), "hamyon (avans) +2 mln").toBe(2_000_000);
    const pnlAfter = (await call(S.owner, "GET", `/api/finance/reports/profit-loss?dateFrom=2000-01-01&dateTo=${businessToday()}`)).json();
    expect(pnlAfter.netProfit, "boshlang'ich qoldiq foyda-zararga TUSHMAYDI").toBe(pnlBefore.netProfit);
    expect(await ledger("2300")).toBe(2_000_000);

    const sale = await pos({ customerId, items: [{ productId: S.p.W!, quantity: "25" }], paymentMethod: "cash", amountPaid: "0", onCredit: true });
    expect(sale.statusCode, sale.body).toBe(201);
    book.grossSales += 1_000_000;
    book.cogs += 750_000;
    expect(await debtOf(customerId)).toBe(1_000_000);
    const paid = await call(S.owner, "POST", "/api/sales/payments", { customerId, amount: "500000", method: "cash", reference: "CP-C-1" });
    expect(paid.statusCode, paid.body).toBe(201);
    cashMove("C naqd to'lov", 500_000);
    expect(await debtOf(customerId)).toBe(500_000);

    const statement = (await call(S.owner, "GET", `/api/sales/customers/${customerId}/statement?from=2000-01-01&to=${businessToday()}`)).json();
    expect(statement.closing).toMatchObject({ debt: "500000.00", wallet: "2000000.00" });
    expect(statement.reconciliation.ok).toBe(true);
    expect(n(statement.totals.debit), "qarz oshdi: faqat sotuv").toBe(1_000_000);
    expect(n(statement.totals.credit), "qarz kamaydi: to'lov").toBe(500_000);
    await expectMoney("C balans");
    await expectBalanced("C balans");
  });

  it("PHASE 12 — qaytarish: A 10 dan 3 tasini qaytaradi; takror — ta'sirsiz; ortiqcha (8) — rad", async () => {
    const orderId = S.orders.A!;
    const [item] = await db.select().from(salesOrderItems).where(eq(salesOrderItems.orderId, orderId));
    const requestId = randomUUID();
    const cogsBefore = await ledger("5000");
    const revenueBefore = await ledger("4000");
    const first = await call(S.owner, "POST", `/api/sales/orders/${orderId}/return-items`, { items: [{ orderItemId: item!.id, quantity: "3" }], refundMethod: "cash", reason: "Mijoz qaytardi", requestId });
    expect(first.statusCode, first.body).toBe(201);
    book.returns += 54_000;
    book.cogs -= 45_000;
    cashMove("Qaytarish A pul", -54_000);
    expect(await stockOf(S.p.X!)).toBe(143);
    expect(cogsBefore - (await ledger("5000")), "tannarx tuzatmasi 3 × 15 000").toBe(45_000);
    expect(revenueBefore - (await ledger("4000")), "tushum tuzatmasi 3 × 18 000").toBe(54_000);
    const payments = await db.select().from(customerPayments).where(eq(customerPayments.orderId, orderId));
    expect(payments.length, "to'lov tarixi o'chmaydi").toBeGreaterThan(0);

    const again = await call(S.owner, "POST", `/api/sales/orders/${orderId}/return-items`, { items: [{ orderItemId: item!.id, quantity: "3" }], refundMethod: "cash", reason: "Mijoz qaytardi", requestId });
    expect(again.statusCode, "takroriy qaytarish — o'sha hujjat").toBe(200);
    expect(await stockOf(S.p.X!)).toBe(143);
    const tooMany = await call(S.owner, "POST", `/api/sales/orders/${orderId}/return-items`, { items: [{ orderItemId: item!.id, quantity: "8" }], refundMethod: "cash" });
    expect(tooMany.statusCode, "7 tadan ortiq qaytarilmaydi").toBeGreaterThanOrEqual(400);
    expect(await db.select().from(salesReturns).where(eq(salesReturns.orderId, orderId))).toHaveLength(1);
    await expectMoney("qaytarish");
    await expectBalanced("qaytarish");
    await expectInventoryValue(null, "qaytarish");
  });

  it("PHASE 14 — xarajat: elektr 500k (kutilmoqda → tasdiq: kassa o'zgarmaydi → to'landi), ijara 1.5 mln bank; takror to'lov yo'q", async () => {
    const create = async (category: string, description: string, amount: string) => {
      const res = await call(S.owner, "POST", "/api/finance/expenses", { category, description, amount, expenseDate: businessToday() });
      expect(res.statusCode, res.body).toBe(201);
      return res.json().expense.id as string;
    };
    const electricity = await create("kommunal", "Elektr energiyasi", "500000");
    expect((await call(S.owner, "POST", `/api/finance/expenses/${electricity}/status`, { status: "approved" })).statusCode).toBe(200);
    await expectMoney("tasdiqlangan xarajat — kassa o'zgarmaydi");
    const paid = await call(S.owner, "POST", `/api/finance/expenses/${electricity}/status`, { status: "paid", cashAccountId: S.cash });
    expect(paid.statusCode, paid.body).toBe(200);
    cashMove("Elektr", -500_000);
    book.opex += 500_000;
    const dup = await call(S.owner, "POST", `/api/finance/expenses/${electricity}/status`, { status: "paid", cashAccountId: S.cash });
    expect(dup.statusCode, "to'langan xarajatni qayta to'lab bo'lmaydi").toBe(400);

    const rent = await create("ijara", "Do'kon ijarasi", "1500000");
    expect((await call(S.owner, "POST", `/api/finance/expenses/${rent}/status`, { status: "approved" })).statusCode).toBe(200);
    expect((await call(S.owner, "POST", `/api/finance/expenses/${rent}/status`, { status: "paid", cashAccountId: S.bank })).statusCode).toBe(200);
    bankMove("Ijara", -1_500_000);
    book.opex += 1_500_000;
    await expectMoney("xarajat");
    await expectBalanced("xarajat");
  });

  it("PHASE 15 — SECOND-WH ga 100 X o'tkazma: jami va qiymat o'zgarmaydi, foyda-zarar o'zgarmaydi; takror — ta'sirsiz", async () => {
    const created = await call(S.owner, "POST", "/api/inventory/warehouses", { name: "SECOND-WH", code: "WH-2" });
    expect(created.statusCode, created.body).toBe(201);
    S.secondWh = created.json().warehouse.id;
    const valueBefore = await ledger("1200");
    const pnlBefore = (await call(S.owner, "GET", `/api/finance/reports/profit-loss?dateFrom=2000-01-01&dateTo=${businessToday()}`)).json().netProfit;
    const requestId = randomUUID();
    const body = { productId: S.p.X, fromWarehouseId: S.mainWh, toWarehouseId: S.secondWh, quantity: "100", requestId };
    const moved = await call(S.owner, "POST", "/api/inventory/stock/transfers", body);
    expect(moved.statusCode, moved.body).toBe(201);
    const dup = await call(S.owner, "POST", "/api/inventory/stock/transfers", body);
    expect(dup.statusCode, "takroriy o'tkazma — o'sha hujjat").toBe(200);
    expect(await stockOf(S.p.X!, S.mainWh)).toBe(43);
    expect(await stockOf(S.p.X!, S.secondWh)).toBe(100);
    expect(await ledger("1200"), "ombor qiymati o'zgarmaydi").toBe(valueBefore);
    expect((await call(S.owner, "GET", `/api/finance/reports/profit-loss?dateFrom=2000-01-01&dateTo=${businessToday()}`)).json().netProfit).toBe(pnlBefore);
    await expectInventoryValue(null, "o'tkazma");
    await expectMoney("o'tkazma");
  });

  it("PHASE 16 — inventarizatsiya: SECOND-WH da X tizimda 100, sanaldi 97 → −3; qiymat −45 000; manfiy qoldiq yo'q", async () => {
    const count = await call(S.owner, "POST", "/api/inventory/counts", { warehouseId: S.secondWh, name: "Physical count" });
    expect(count.statusCode, count.body).toBe(201);
    const countId = count.json().count.id as string;
    // Sanoq varag'i ombordagi mahsulotlar bilan ochiladi — X allaqachon bor (qayta qo'shish 409)
    const added = await call(S.owner, "POST", `/api/inventory/counts/${countId}/items`, { productId: S.p.X });
    expect([200, 201, 409], added.body).toContain(added.statusCode);
    const detail = (await call(S.owner, "GET", `/api/inventory/counts/${countId}`)).json();
    const item = (detail.items ?? detail.count.items) as { id: string; productId: string }[];
    const row = item.find((entry) => entry.productId === S.p.X)!;
    const patched = await call(S.owner, "PATCH", `/api/inventory/counts/${countId}/items/${row.id}`, { countedQty: "97", notes: "Physical count" });
    expect(patched.statusCode, patched.body).toBe(200);
    const valueBefore = await ledger("1200");
    const applied = await call(S.owner, "POST", `/api/inventory/counts/${countId}/apply`);
    expect(applied.statusCode, applied.body).toBe(200);
    book.opex += 45_000;
    expect(await stockOf(S.p.X!, S.secondWh)).toBe(97);
    expect(valueBefore - (await ledger("1200")), "kamomad 3 × 15 000").toBe(45_000);
    const negative = await call(S.owner, "POST", "/api/inventory/stock/movements", { type: "issue", productId: S.p.X, warehouseId: S.secondWh, quantity: "1000" });
    expect(negative.statusCode, "manfiy qoldiq rad").toBe(400);
    expect(await stockOf(S.p.X!, S.secondWh)).toBe(97);
    await expectInventoryValue(null, "inventarizatsiya");
    await expectBalanced("inventarizatsiya");
  });

  it("PHASE 17 — ombor hisobotlari: hisobotdagi qoldiq = baza", async () => {
    const report = await call(S.owner, "GET", "/api/analytics/reports/stock");
    expect(report.statusCode, report.body).toBe(200);
    const exported = (await call(S.owner, "GET", "/api/inventory/stock/export")).json().rows as { productId: string; warehouseId: string; quantity: string }[];
    const levels = await db.select().from(stockLevels).where(eq(stockLevels.companyId, S.companyId));
    expect(exported).toHaveLength(levels.length);
    for (const level of levels) {
      const row = exported.find((entry) => entry.productId === level.productId && entry.warehouseId === level.warehouseId)!;
      expect(n(row.quantity)).toBe(n(level.quantity));
    }
    const velocity = await call(S.owner, "GET", "/api/analytics/reports/stock-velocity?days=30");
    expect(velocity.statusCode, velocity.body).toBe(200);
  });

  it("PHASE 18–19 — kassa va bank: boshlang'ich + kirim − chiqim = ERP qoldig'i (1 so'm aniqlikda)", async () => {
    const expectedCash = book.cashFlow.reduce((sum, row) => sum + row.amount, 0);
    const expectedBank = book.bankFlow.reduce((sum, row) => sum + row.amount, 0);
    expect(expectedCash, `kassa: ${JSON.stringify(book.cashFlow)}`).toBe(10_826_000);
    expect(expectedBank, `bank: ${JSON.stringify(book.bankFlow)}`).toBe(19_200_000);
    await expectMoney("kassa/bank solishtiruvi");
    // Harakatlar yig'indisi = qoldiq (hisob tarixidan)
    for (const [id, expected] of [[S.cash, expectedCash], [S.bank, expectedBank]] as const) {
      const [row] = await db
        .select({ v: sql<string>`coalesce(sum(case when ${cashTransactions.type} = 'in' then ${cashTransactions.amount} else -${cashTransactions.amount} end), 0)::numeric(18,2)` })
        .from(cashTransactions)
        .where(eq(cashTransactions.cashAccountId, id));
      expect(n(row!.v), "harakatlar yig'indisi = qoldiq").toBe(expected);
    }
  });

  it("PHASE 20 — ombor solishtiruvi: har mahsulot harakatlar yig'indisi = qoldiq; kutilgan miqdorlar", async () => {
    const moved = await db
      .select({ productId: stockMovements.productId, warehouseId: stockMovements.warehouseId, qty: sql<string>`sum(${stockMovements.quantity})::numeric(18,4)` })
      .from(stockMovements)
      .where(eq(stockMovements.companyId, S.companyId))
      .groupBy(stockMovements.productId, stockMovements.warehouseId);
    const levels = await db.select().from(stockLevels).where(eq(stockLevels.companyId, S.companyId));
    for (const level of levels) {
      const sum = moved.find((row) => row.productId === level.productId && row.warehouseId === level.warehouseId);
      expect(n(sum?.qty), `harakatlar = qoldiq (${level.productId})`).toBe(n(level.quantity));
    }
    // Kutilgan: X 200 kirim − 50 − 10 + 3 − 100 → MAIN 43; SECOND 100 − 3 = 97; Y 50 − 40; Z 60 − 50; W 50 − 25
    expect(await stockOf(S.p.X!, S.mainWh)).toBe(43);
    expect(await stockOf(S.p.X!, S.secondWh)).toBe(97);
    expect(await stockOf(S.p.Y!)).toBe(10);
    expect(await stockOf(S.p.Z!)).toBe(10);
    expect(await stockOf(S.p.W!)).toBe(25);
    // Qiymat: X 140×15 000 + Y 10×20 000 + Z 10×10 000 + W 25×30 000
    await expectInventoryValue(140 * 15_000 + 10 * 20_000 + 10 * 10_000 + 25 * 30_000, "yakuniy ombor");
  });

  it("PHASE 21–22 — mijoz va ta'minotchi qarzi: kesh = jurnal = akt; qarz yoshi yig'indisi = qarz", async () => {
    const expectedCustomers: Record<string, number> = { "Customer A": 0, "Customer B": 0, "Customer C": 500_000, "Customer D": 0, "Customer E": 0 };
    for (const [name, expected] of Object.entries(expectedCustomers)) {
      const id = S.c[name]!;
      expect(await debtOf(id), name).toBe(expected);
      const statement = (await call(S.owner, "GET", `/api/sales/customers/${id}/statement?from=2000-01-01&to=${businessToday()}`)).json();
      expect(statement.reconciliation.ok, `${name}: akt = kesh`).toBe(true);
      const agingSum = (statement.aging.documents as { outstanding: string }[]).reduce((sum, doc) => sum + n(doc.outstanding), 0) + n(statement.aging.undocumented);
      expect(agingSum, `${name}: qarz yoshi yig'indisi = qarz`).toBe(expected);
    }
    const expectedSuppliers: Record<string, number> = { "Supplier A": 1_000_000, "Supplier B": 2_000_000, "Supplier C": 1_500_000 };
    for (const [name, expected] of Object.entries(expectedSuppliers)) {
      const id = S.s[name]!;
      expect(await supplierDebt(id), name).toBe(expected);
      const statement = await call(S.owner, "GET", `/api/purchase/suppliers/${id}/statement?from=2000-01-01&to=${businessToday()}`);
      expect(statement.statusCode, statement.body).toBe(200);
      expect(statement.json().reconciliation.ok, `${name}: akt = kesh`).toBe(true);
      expect(n(statement.json().closing)).toBe(expected);
    }
    const all = (await call(S.owner, "GET", "/api/purchase/suppliers-reconciliation")).json();
    expect(all.mismatched).toEqual([]);
    expect(await ledger("1100"), "1100 = mijozlar qarzi yig'indisi").toBe(500_000);
    expect(await ledger("2000"), "2000 = ta'minotchilar qarzi yig'indisi").toBe(4_500_000);
  });

  it("PHASE 23–24 — buxgalteriya va foyda: jurnal balanslangan; foyda-zarar = mustaqil hisob", async () => {
    await expectBalanced("yakun");
    const netSales = book.grossSales - book.returns;
    const grossProfit = netSales - book.cogs;
    const net = grossProfit - book.opex;
    expect(book.grossSales, "yalpi sotuv").toBe(4_180_000);
    expect(netSales, "sof sotuv").toBe(4_126_000);
    // 750 000 + 150 000 + 800 000 + 500 000 + 750 000 − 45 000 (qaytgan 3 X)
    expect(book.cogs, "tannarx").toBe(2_905_000);
    const pnl = (await call(S.owner, "GET", `/api/finance/reports/profit-loss?dateFrom=2000-01-01&dateTo=${businessToday()}`)).json();
    expect(await ledger("4000"), "4000 = sof sotuv").toBe(netSales);
    expect(await ledger("5000"), "5000 = tannarx").toBe(book.cogs);
    expect(n(pnl.netProfit), `foyda-zarar: ${JSON.stringify(pnl)}`).toBe(net);
    // Bazadagi sotuv hujjatlaridan: yakunlangan cheklar − qaytarishlar
    const [orders] = await db
      .select({ total: sql<string>`coalesce(sum(${salesOrders.totalAmount}), 0)::numeric(18,2)` })
      .from(salesOrders)
      .where(and(eq(salesOrders.companyId, S.companyId), inArray(salesOrders.status, ["completed", "shipped", "delivered"])));
    const [returned] = await db.select({ total: sql<string>`coalesce(sum(${salesReturns.totalAmount}), 0)::numeric(18,2)` }).from(salesReturns).where(eq(salesReturns.companyId, S.companyId));
    expect(n(orders!.total) - n(returned!.total), "hujjatlar = 4000").toBe(netSales);
  });

  it("PHASE 25 — to'lov usullari: har usul yig'indisi = kassa/bank harakati", async () => {
    const byMethod = await db
      .select({ method: customerPayments.method, total: sql<string>`sum(${customerPayments.amount})::numeric(18,2)` })
      .from(customerPayments)
      .where(and(eq(customerPayments.companyId, S.companyId), eq(customerPayments.status, "posted")))
      .groupBy(customerPayments.method);
    const total = (method: string) => n(byMethod.find((row) => row.method === method)?.total);
    // Naqd: 1 000 000 + 180 000 + 300 000 + 400 000 + 500 000; karta 400 000; bank 300 000 + 600 000
    expect(total("cash")).toBe(2_380_000);
    expect(total("card")).toBe(400_000);
    expect(total("bank")).toBe(900_000);
    const [cashIn] = await db
      .select({ v: sql<string>`coalesce(sum(${cashTransactions.amount}), 0)::numeric(18,2)` })
      .from(cashTransactions)
      .where(and(eq(cashTransactions.cashAccountId, S.cash), eq(cashTransactions.referenceType, "customer_payment"), eq(cashTransactions.type, "in")));
    expect(n(cashIn!.v), "naqd to'lovlar = kassa kirimi").toBe(2_380_000);
  });

  it("PHASE 26–27 — idempotentlik va parallel so'rovlar: ikki marta ta'sir yo'q, manfiy qoldiq yo'q", async () => {
    const debtBefore = await debtOf(S.c["Customer C"]!);
    const cashBefore = await balanceOf(S.cash);
    const payment = { customerId: S.c["Customer C"], amount: "100000", method: "cash", reference: "CP-C-PAR" };
    const results = await Promise.all([call(S.owner, "POST", "/api/sales/payments", payment), call(S.owner, "POST", "/api/sales/payments", payment)]);
    // Bittasi yoziladi; ikkinchisi yo mavjudini qaytaradi (200), yo bazadagi unique kalit to'xtatadi (409) — ta'sir BIR marta
    expect(results.map((res) => res.statusCode).sort()[0], results.map((res) => res.body).join(" | ")).toBe(201);
    expect([200, 409]).toContain(results.map((res) => res.statusCode).sort()[1]);
    cashMove("C parallel to'lov", 100_000);
    expect(await debtOf(S.c["Customer C"]!)).toBe(debtBefore - 100_000);
    expect(await balanceOf(S.cash)).toBe(cashBefore + 100_000);

    // Qolgan 10 Y ni ikki kassir bir vaqtda 8 tadan sotmoqchi — bittasi o'tadi
    const sales = await Promise.all([
      pos({ items: [{ productId: S.p.Y!, quantity: "8" }], paymentMethod: "cash", amountPaid: "200000" }),
      pos({ items: [{ productId: S.p.Y!, quantity: "8" }], paymentMethod: "cash", amountPaid: "200000" }),
    ]);
    const ok = sales.filter((res) => res.statusCode === 201);
    expect(ok, sales.map((res) => res.body).join(" | ")).toHaveLength(1);
    book.grossSales += 200_000;
    book.cogs += 160_000;
    cashMove("parallel Y sotuv", 200_000);
    expect(await stockOf(S.p.Y!)).toBe(2);

    // Bir xil so'rov kaliti bilan ikki parallel chek — bitta hujjat
    const clientRequestId = randomUUID();
    const twin = await Promise.all([
      pos({ items: [{ productId: S.p.NON!, quantity: "1" }], paymentMethod: "cash", amountPaid: "0", clientRequestId }),
      pos({ items: [{ productId: S.p.NON!, quantity: "1" }], paymentMethod: "cash", amountPaid: "0", clientRequestId }),
    ]);
    expect(twin.filter((res) => res.statusCode === 201).length, twin.map((res) => res.body).join(" | ")).toBeLessThanOrEqual(1);
    await expectMoney("parallel");
    await expectBalanced("parallel");
  });

  it("PHASE 28 — tenant izolyatsiyasi: begona kompaniya ID lar bilan 404/403; tanada companyId — 400", async () => {
    const f = S.foreignOwner;
    const probes: [string, string][] = [
      ["GET", `/api/sales/customers/${S.c["Customer C"]}`],
      ["GET", `/api/sales/customers/${S.c["Customer C"]}/statement`],
      ["GET", `/api/catalog/products/${S.p.X}`],
      ["GET", `/api/purchase/suppliers/${S.s["Supplier A"]}`],
      ["GET", `/api/purchase/suppliers/${S.s["Supplier A"]}/statement`],
      ["GET", `/api/sales/orders/${S.orders.A}`],
      ["GET", `/api/inventory/stock/products/${S.p.X}`],
      ["GET", `/api/inventory/warehouses/${S.mainWh}`],
    ];
    for (const [method, url] of probes) {
      const res = await call(f, method as Method, url);
      expect([403, 404], `${url}: ${res.statusCode}`).toContain(res.statusCode);
    }
    const foreignPay = await call(f, "POST", "/api/sales/payments", { customerId: S.c["Customer C"], amount: "1", method: "cash" });
    expect([400, 403, 404]).toContain(foreignPay.statusCode);
    const foreignStock = await call(f, "POST", "/api/inventory/stock/movements", { type: "issue", productId: S.p.X, warehouseId: S.mainWh, quantity: "1" });
    expect([403, 404]).toContain(foreignStock.statusCode);
    const smuggled = await call(S.owner, "POST", "/api/sales/customers", { name: "Hack", companyId: S.foreignCompanyId });
    expect(smuggled.statusCode, "tanadagi companyId rad").toBe(400);
    expect(await debtOf(S.c["Customer C"]!)).toBe(400_000);
  });

  it("PHASE 29 — rollar backendda: kassir sotadi va to'lov oladi; tannarx/moliya/xarid yo'q; omborchi ombor", async () => {
    const pay = await call(S.cashier, "POST", "/api/sales/payments", { customerId: S.c["Customer C"], amount: "50000", method: "cash", reference: "CP-C-CASHIER" });
    expect(pay.statusCode, pay.body).toBe(201);
    cashMove("kassir C to'lov", 50_000);
    expect((await call(S.cashier, "POST", "/api/purchase/payments", { supplierId: S.s["Supplier A"], amount: "1", method: "cash" })).statusCode).toBe(403);
    expect((await call(S.cashier, "POST", "/api/finance/expenses", { category: "boshqa", description: "x", amount: "1", expenseDate: businessToday() })).statusCode).toBe(403);
    expect((await call(S.cashier, "POST", `/api/purchase/payments/00000000-0000-0000-0000-000000000000/reverse`, { reason: "hack" })).statusCode).toBe(403);
    expect((await call(S.storekeeper, "POST", "/api/sales/payments", { customerId: S.c["Customer C"], amount: "1", method: "cash" })).statusCode).toBe(403);
    expect((await call(S.storekeeper, "GET", "/api/catalog/products/costs")).statusCode).toBe(403);
    await expectMoney("rollar");
  });

  it("PHASE 30 — kun yakuni: smena yopiladi (sanalgan naqd = kutilgan), hisobotlar va audit mos", async () => {
    const shift = (await call(S.cashier, "GET", `/api/sales/pos/shifts/${S.shiftId}`)).json().shift;
    const expectedInDrawer = n(shift.expectedCash ?? shift.expectedClosingCash ?? 0) || n(shift.openingCash) + n(shift.totalCash);
    const closed = await call(S.cashier, "POST", `/api/sales/pos/shifts/${S.shiftId}/close`, { closingCash: String(expectedInDrawer) });
    expect(closed.statusCode, closed.body).toBe(200);
    const after = closed.json().shift;
    expect(n(after.difference ?? 0), `smena farqi: ${JSON.stringify(after)}`).toBe(0);
    await expectMoney("kun yakuni");
    await expectBalanced("kun yakuni");

    const sales = (await call(S.owner, "GET", "/api/analytics/reports/sales?days=1")).json();
    const [orders] = await db
      .select({ total: sql<string>`coalesce(sum(${salesOrders.totalAmount}), 0)::numeric(18,2)` })
      .from(salesOrders)
      .where(and(eq(salesOrders.companyId, S.companyId), inArray(salesOrders.status, ["completed", "shipped", "delivered"])));
    expect(n(sales.totalRevenue), "sotuv hisoboti = baza").toBe(n(orders!.total));

    const [audit] = await db.select({ n: sql<number>`count(*)::int` }).from(auditLogs).where(eq(auditLogs.companyId, S.companyId));
    expect(audit!.n, "audit izi bor").toBeGreaterThan(20);

    // Yakuniy javoblar: "pul qayerda, qancha qarz, qancha tovar, qancha foyda"
    const pnl = (await call(S.owner, "GET", `/api/finance/reports/profit-loss?dateFrom=2000-01-01&dateTo=${businessToday()}`)).json();
    const netSales = book.grossSales - book.returns;
    expect(n(pnl.netProfit)).toBe(netSales - book.cogs - book.opex);
    console.log(
      "MINI MARKET YAKUN:",
      JSON.stringify({
        kassa: book.cash,
        bank: book.bank,
        yalpiSotuv: book.grossSales,
        qaytarish: book.returns,
        sofSotuv: netSales,
        tannarx: book.cogs,
        yalpiFoyda: netSales - book.cogs,
        xarajat: book.opex,
        sofNatija: n(pnl.netProfit),
        mijozQarzi: await ledger("1100"),
        taminotchiQarzi: await ledger("2000"),
        ombor: await ledger("1200"),
      }),
    );
  });
});
