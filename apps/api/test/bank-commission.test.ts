import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts, cashAccounts, expenses } from "../src/db/schema/finance.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { suppliers } from "../src/db/schema/purchase.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let piece: string;
let mainWh: string;
let mainCash: string;
let mainBank: string;

const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
  await db.delete(units);
  await seedDefaultUnits(db);
  piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Komissiya do'koni" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  const rows = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));
  mainCash = rows.find((row) => row.type === "cash")!.id;
  mainBank = rows.find((row) => row.type === "bank")!.id;
});

const call = (cookie: string, method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const owner = () => company.ownerCookie;

const ledger = async (code: string) =>
  (await db.select({ balance: accounts.balance }).from(accounts).where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code))))[0]?.balance ?? null;
const balanceOf = async (id: string) => (await db.select({ balance: cashAccounts.balance }).from(cashAccounts).where(eq(cashAccounts.id, id)))[0]!.balance;
const debtOf = async (id: string) => (await db.select({ totalDebt: suppliers.totalDebt }).from(suppliers).where(eq(suppliers.id, id)))[0]!.totalDebt;
const bankFees = () =>
  db
    .select({ amount: expenses.amount, status: expenses.status, referenceType: expenses.referenceType, description: expenses.description })
    .from(expenses)
    .where(and(eq(expenses.companyId, company.companyId), eq(expenses.category, "bank komissiyasi")));

async function fund(cashAccountId: string, amount: string) {
  const capital = (await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, "3000"))))[0]!;
  const res = await call(owner(), "POST", "/api/finance/cash-transactions", { cashAccountId, type: "in", amount, description: "Kirim", counterAccountId: capital.id });
  expect(res.statusCode, res.body).toBe(201);
}

let seq = 0;
async function receivedOrder(qty: string, price: string) {
  seq += 1;
  const product = await call(owner(), "POST", "/api/catalog/products", { name: `P ${seq}`, sku: `P-${seq}`, baseUnitId: piece });
  const supplierId = (await call(owner(), "POST", "/api/purchase/suppliers", { name: `S ${seq}`, code: `S-${seq}` })).json().supplier.id as string;
  const created = await call(owner(), "POST", "/api/purchase/orders", {
    supplierId,
    warehouseId: mainWh,
    orderDate: today,
    items: [{ productId: product.json().product.id, unitId: piece, orderedQty: qty, unitPrice: price }],
  });
  const order = (await call(owner(), "POST", `/api/purchase/orders/${created.json().order.id}/confirm`)).json().order;
  const received = await call(owner(), "POST", `/api/purchase/orders/${order.id}/receipts`, { items: [{ orderItemId: order.items[0].id, receivedQty: qty }] });
  expect(received.statusCode, received.body).toBe(201);
  return { orderId: order.id as string, supplierId };
}

describe("Bank komissiyasi", () => {
  it("ekvayring: UZCARD 0.25% — 100 000 dan bankka 99 750, 250 so'm xarajat; mijoz qarzi to'liq yopiladi; takroriy so'rovda ikkinchi komissiya yo'q; 0% terminal — komissiyasiz", async () => {
    const product = await call(owner(), "POST", "/api/catalog/products", { name: "Televizor", sku: "TV", baseUnitId: piece, salesPrice: "100000", taxRate: "0" });
    const productId = product.json().product.id as string;
    expect((await call(owner(), "POST", "/api/inventory/stock/movements", { type: "receive", productId, warehouseId: mainWh, quantity: "5", costPrice: "50000" })).statusCode).toBe(201);
    const terminal = async (body: object) => {
      const res = await call(owner(), "POST", "/api/finance/terminals", { cashAccountId: mainBank, ...body });
      expect(res.statusCode, res.body).toBe(201);
      return res.json().terminal as { id: string; commissionPercent: string; showInPos: boolean };
    };
    const uzcard = await terminal({ name: "UZCARD", network: "uzcard", commissionPercent: "0.25" });
    const humo = await terminal({ name: "HUMO", network: "humo" });
    expect(uzcard).toMatchObject({ commissionPercent: "0.25", showInPos: true });
    expect((await call(owner(), "PATCH", `/api/finance/terminals/${humo.id}`, { commissionPercent: "150" })).statusCode).toBe(400);

    const kassir = await addEmployee(app, company, "Kassir");
    const shift = await call(kassir.cookie, "POST", "/api/sales/pos/shifts", { warehouseId: mainWh, openingCash: "0" });
    expect(shift.statusCode, shift.body).toBe(201);
    const sell = (terminalId: string, clientRequestId = randomUUID()) =>
      call(kassir.cookie, "POST", "/api/sales/pos/sales", {
        shiftId: shift.json().shift.id,
        items: [{ productId, quantity: "1" }],
        clientRequestId,
        payments: [{ method: "card", amount: "100000", terminalId }],
      });

    const key = randomUUID();
    const sale = await sell(uzcard.id, key);
    expect(sale.statusCode, sale.body).toBe(201);
    expect(sale.json()).toMatchObject({ paid: "100000.00", debt: "0.00" });
    expect(await balanceOf(mainBank)).toBe("99750.00");
    expect(await bankFees()).toMatchObject([{ amount: "250.00", status: "paid", referenceType: "customer_payment" }]);
    expect([await ledger("5800"), await ledger("1020"), await ledger("1100"), await ledger("4000")]).toEqual(["250.00", "99750.00", "0.00", "100000.00"]);
    // Smena karta tushumi — mijoz to'lagan to'liq summa
    expect((await call(kassir.cookie, "GET", `/api/sales/pos/shifts/${shift.json().shift.id}`)).json().shift).toMatchObject({ totalCard: "100000.00" });

    expect((await sell(uzcard.id, key)).statusCode).toBe(409);
    expect(await bankFees()).toHaveLength(1);
    expect(await balanceOf(mainBank)).toBe("99750.00");

    expect((await sell(humo.id)).statusCode).toBe(201);
    expect(await balanceOf(mainBank)).toBe("199750.00");
    expect(await bankFees()).toHaveLength(1);

    // Xarajatlar bo'limida ko'rinadi
    const list = (await call(owner(), "GET", "/api/finance/expenses?category=bank%20komissiyasi")).json().expenses as { amount: string }[];
    expect(list.map((row) => row.amount)).toEqual(["250.00"]);
  });

  it("pul chiqarish 1%: ta'minotchiga 1 000 000 — hisobdan 1 010 000, ta'minotchiga 1 000 000, 10 000 xarajat; xarajat, o'tkazma, qo'lda chiqim; mablag' yetmasa hech narsa; kassadan — komissiyasiz", async () => {
    expect((await call(owner(), "PATCH", `/api/finance/cash-accounts/${mainBank}`, { outgoingCommissionPercent: "1", showInPos: true })).statusCode).toBe(200);
    expect((await call(owner(), "PATCH", `/api/finance/cash-accounts/${mainBank}`, { outgoingCommissionPercent: "101" })).statusCode).toBe(400);
    await fund(mainBank, "2000000");

    const { orderId, supplierId } = await receivedOrder("10", "100000");
    const paid = await call(owner(), "POST", "/api/purchase/payments", { supplierId, orderId, amount: "1000000", method: "bank", cashAccountId: mainBank });
    expect(paid.statusCode, paid.body).toBe(201);
    expect(await balanceOf(mainBank)).toBe("990000.00");
    expect(await debtOf(supplierId)).toBe("0.00");
    expect(await bankFees()).toMatchObject([{ amount: "10000.00", status: "paid", referenceType: "supplier_payment" }]);
    expect([await ledger("5800"), await ledger("2000"), await ledger("1020")]).toEqual(["10000.00", "0.00", "990000.00"]);

    // Xarajat bankdan: 100 000 + 1 000 komissiya
    const expense = await call(owner(), "POST", "/api/finance/expenses", { category: "ijara", description: "Do'kon ijarasi", amount: "100000", expenseDate: today });
    const expenseId = expense.json().expense.id as string;
    expect((await call(owner(), "POST", `/api/finance/expenses/${expenseId}/status`, { status: "approved" })).statusCode).toBe(200);
    expect((await call(owner(), "POST", `/api/finance/expenses/${expenseId}/status`, { status: "paid", cashAccountId: mainBank })).statusCode).toBe(200);
    expect(await balanceOf(mainBank)).toBe("889000.00");

    // Bankdan kassaga: 100 000 + 1 000; qo'lda chiqim 50 000 + 500
    expect((await call(owner(), "POST", "/api/finance/cash-transfers", { fromCashAccountId: mainBank, toCashAccountId: mainCash, amount: "100000" })).statusCode).toBe(201);
    expect([await balanceOf(mainBank), await balanceOf(mainCash)]).toEqual(["788000.00", "100000.00"]);
    expect((await call(owner(), "POST", "/api/finance/cash-transactions", { cashAccountId: mainBank, type: "out", amount: "50000", description: "Bank xizmati" })).statusCode).toBe(201);
    expect(await balanceOf(mainBank)).toBe("737500.00");
    expect((await bankFees()).map((row) => row.amount).sort()).toEqual(["1000.00", "1000.00", "10000.00", "500.00"].sort());
    expect(await ledger("5800")).toBe("12500.00");

    // Asosiy summa yetadi (735 000 ≤ 737 500), komissiya bilan yetmaydi (742 350) — to'lov ham, komissiya ham yozilmaydi
    const second = await receivedOrder("1", "735000");
    const short = await call(owner(), "POST", "/api/purchase/payments", { supplierId: second.supplierId, orderId: second.orderId, amount: "735000", method: "bank", cashAccountId: mainBank });
    expect(short.statusCode).toBe(400);
    expect(await balanceOf(mainBank)).toBe("737500.00");
    expect(await debtOf(second.supplierId)).toBe("735000.00");
    expect(await bankFees()).toHaveLength(4);

    // Kassadan to'lov — bank komissiyasi yo'q
    const third = await receivedOrder("1", "50000");
    expect((await call(owner(), "POST", "/api/purchase/payments", { supplierId: third.supplierId, orderId: third.orderId, amount: "50000", method: "cash" })).statusCode).toBe(201);
    expect(await balanceOf(mainCash)).toBe("50000.00");
    expect(await bankFees()).toHaveLength(4);
  });
});
