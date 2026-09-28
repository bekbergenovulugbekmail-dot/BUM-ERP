/**
 * AUD-008 (egasi qarori, 2026-09-28: VARIANT 1 — mijoz avansi / hamyon).
 *
 * To'liq qaytarishda pul fizik qaytarilmasa (`refund:false`), mijoz to'lagan pul 2300 "Mijozlar avanslari" ga (hamyon)
 * o'tadi — web UI'dagi `refundMethod: "balance"` bilan bir xil manba (`refundToBalance`). Qarz manfiy bo'lmaydi:
 *   sotuv 100 000, to'lov 40 000 → to'liq qaytarish → qarz 0, hamyon 40 000, 1100 = 0, 2300 = 40 000, aging 0.
 * Keyingi nasiya sotuv hamyondan ("balance" usuli) to'lanadi — hujjat, kesh va jurnal bir xil.
 */
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts, cashAccounts, journalEntries, journalLines } from "../src/db/schema/finance.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { customerBalanceTransactions, customers, salesOrders } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { todayIso } from "../src/modules/finance/cash.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let company: Awaited<ReturnType<typeof createCompany>>;
let other: Awaited<ReturnType<typeof createCompany>>;
let piece: string;
let mainWh: string;
let productId: string;

const call = (method: "GET" | "POST", url: string, payload?: object, cookie = company.ownerCookie) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

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
  company = await createCompany(app, admin.cookie, { name: "Avans do'koni" });
  other = await createCompany(app, admin.cookie, { name: "Begona" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  productId = (await call("POST", "/api/catalog/products", { name: "Un", sku: "UN", baseUnitId: piece, salesPrice: "100000", taxRate: "0" })).json().product.id;
  await call("POST", "/api/inventory/stock/movements", { type: "receive", productId, warehouseId: mainWh, quantity: "10", costPrice: "60000" });
});

async function newCustomer(name = "Mijoz") {
  return (await call("POST", "/api/sales/customers", { name, paymentTermDays: 0 })).json().customer.id as string;
}

async function creditSale(customerId: string, quantity = "1") {
  const orderId = (await call("POST", "/api/sales/orders", { customerId, warehouseId: mainWh, orderDate: todayIso(), items: [{ productId, quantity }] })).json().order.id as string;
  expect((await call("POST", `/api/sales/orders/${orderId}/confirm`)).statusCode).toBe(200);
  expect((await call("POST", `/api/sales/orders/${orderId}/ship`)).statusCode).toBe(200);
  return orderId;
}

const ledger = async (code: string) =>
  (await db.select().from(accounts).where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code))))[0]!.balance;
const cash = async () => (await db.select().from(cashAccounts).where(and(eq(cashAccounts.companyId, company.companyId), eq(cashAccounts.isDefault, true))))[0]!.balance;
const customerRow = async (id: string) => (await db.select().from(customers).where(eq(customers.id, id)))[0]!;
const agingTotal = async () => (await call("GET", "/api/sales/receivables/aging")).json().totals.total as string;

async function expectTrialBalance() {
  const [row] = await db
    .select({
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)::numeric(18,2)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)::numeric(18,2)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalLines.companyId, company.companyId), eq(journalEntries.status, "posted")));
  expect(row!.debit, "Debit = Credit").toBe(row!.credit);
}

/** Moliyaviy solishtiruv: qarz >= 0, hamyon >= 0, kesh = jurnal (akt), 2300 = hamyonlar yig'indisi, 1100 = hujjatlar. */
async function expectReconciled(customerId: string) {
  const row = await customerRow(customerId);
  expect(Number(row.totalDebt), "qarz manfiy emas").toBeGreaterThanOrEqual(0);
  expect(Number(row.balance), "hamyon manfiy emas").toBeGreaterThanOrEqual(0);
  const statement = (await call("GET", `/api/sales/customers/${customerId}/statement`)).json();
  expect(statement.reconciliation.ok, "kesh = jurnal").toBe(true);
  const wallets = await db.select({ sum: sql<string>`coalesce(sum(${customers.balance}), 0)::numeric(18,2)` }).from(customers).where(eq(customers.companyId, company.companyId));
  expect(await ledger("2300"), "2300 = hamyonlar").toBe(wallets[0]!.sum);
  expect(await ledger("1100"), "1100 = hujjatlar bo'yicha qarz (aging)").toBe(await agingTotal());
  await expectTrialBalance();
}

describe("AUD-008 — to'liq qaytarish, pul qaytarilmadi → mijoz avansi", () => {
  it("100k sotuv, 40k to'lov, to'liq qaytarish refund:false → qarz 0, avans 40k; keyingi sotuv avansdan", async () => {
    const customerId = await newCustomer();
    const first = await creditSale(customerId);
    expect((await call("POST", "/api/sales/payments", { orderId: first, amount: "40000", method: "cash" })).statusCode).toBe(201);
    expect((await customerRow(customerId)).totalDebt).toBe("60000.00");

    const returned = await call("POST", `/api/sales/orders/${first}/return`, { refund: false, reason: "Mijoz rad etdi" });
    expect(returned.statusCode, returned.body).toBe(200);
    expect(returned.json()).toMatchObject({ refunded: "40000.00", order: { status: "returned", paidAmount: "0.00" } });
    expect(await customerRow(customerId)).toMatchObject({ totalDebt: "0.00", balance: "40000.00" });
    expect(await ledger("1100"), "1100 manfiy emas").toBe("0.00");
    expect(await ledger("2300"), "2300 avans").toBe("40000.00");
    expect(await cash(), "kassadan pul chiqmadi").toBe("40000.00");
    expect(await agingTotal()).toBe("0.00");
    const [history] = await db.select().from(customerBalanceTransactions).where(eq(customerBalanceTransactions.customerId, customerId));
    expect(history).toMatchObject({ type: "refund", amount: "40000.00", balanceAfter: "40000.00", orderId: first });
    await expectReconciled(customerId);

    // Idempotentlik: qayta qaytarish rad etiladi, hech narsa ikki marta yozilmaydi
    expect((await call("POST", `/api/sales/orders/${first}/return`, { refund: false })).statusCode).toBe(400);
    expect(await customerRow(customerId)).toMatchObject({ totalDebt: "0.00", balance: "40000.00" });

    // Yangi nasiya sotuv: qarz 100k (avans qarzni o'zi yopmaydi — aging uni qarz deb ko'rsatmaydi)
    const second = await creditSale(customerId);
    expect(await customerRow(customerId)).toMatchObject({ totalDebt: "100000.00", balance: "40000.00" });
    expect(await agingTotal()).toBe("100000.00");
    await expectReconciled(customerId);

    // Avansdan to'lov (balans usuli) → qarz 60k, hamyon 0; qolgani naqd → qarz 0
    const fromWallet = await call("POST", "/api/sales/payments", { orderId: second, amount: "40000", method: "balance" });
    expect(fromWallet.statusCode, fromWallet.body).toBe(201);
    expect(await customerRow(customerId)).toMatchObject({ totalDebt: "60000.00", balance: "0.00" });
    expect(await agingTotal()).toBe("60000.00");
    expect((await call("POST", "/api/sales/payments", { customerId, amount: "60000", method: "cash" })).statusCode).toBe(201);
    expect(await customerRow(customerId)).toMatchObject({ totalDebt: "0.00", balance: "0.00" });
    expect(await agingTotal()).toBe("0.00");
    const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, second));
    expect(order!.paidAmount, "hujjat to'liq to'langan").toBe("100000.00");
    expect(await ledger("2300")).toBe("0.00");
    await expectReconciled(customerId);
  });

  it("hamyon + naqd bilan to'langan chek: ikkalasi ham hamyonga qaytadi, qarz 0", async () => {
    const customerId = await newCustomer();
    expect((await call("POST", `/api/sales/customers/${customerId}/balance-deposit`, { amount: "20000", method: "cash" })).statusCode).toBe(201);
    const orderId = await creditSale(customerId);
    expect((await call("POST", "/api/sales/payments", { orderId, amount: "20000", method: "balance" })).statusCode).toBe(201);
    expect((await call("POST", "/api/sales/payments", { orderId, amount: "30000", method: "cash" })).statusCode).toBe(201);
    expect(await customerRow(customerId)).toMatchObject({ totalDebt: "50000.00", balance: "0.00" });

    const returned = await call("POST", `/api/sales/orders/${orderId}/return`, { refund: false });
    expect(returned.statusCode, returned.body).toBe(200);
    expect(returned.json().refunded).toBe("50000.00");
    expect(await customerRow(customerId)).toMatchObject({ totalDebt: "0.00", balance: "50000.00" });
    await expectReconciled(customerId);
  });

  it("to'lanmagan chek to'liq qaytarilsa hamyonga hech narsa o'tmaydi; refund:true avvalgidek naqd qaytaradi", async () => {
    const unpaidCustomer = await newCustomer("To'lamagan");
    const unpaid = await creditSale(unpaidCustomer);
    expect((await call("POST", `/api/sales/orders/${unpaid}/return`, { refund: false })).json().refunded).toBe("0.00");
    expect(await customerRow(unpaidCustomer)).toMatchObject({ totalDebt: "0.00", balance: "0.00" });

    const cashCustomer = await newCustomer("Naqd qaytarish");
    const paidOrder = await creditSale(cashCustomer);
    await call("POST", "/api/sales/payments", { orderId: paidOrder, amount: "40000", method: "cash" });
    const before = Number(await cash());
    const refunded = await call("POST", `/api/sales/orders/${paidOrder}/return`, { refund: true });
    expect(refunded.json().refunded).toBe("40000.00");
    expect(Number(await cash()), "naqd qaytdi").toBe(before - 40_000);
    expect(await customerRow(cashCustomer)).toMatchObject({ totalDebt: "0.00", balance: "0.00" });
    await expectReconciled(cashCustomer);
    await expectReconciled(unpaidCustomer);
  });

  it("parallel ikki qaytarish: bittasi o'tadi, avans bir marta; tenant va RBAC", async () => {
    const customerId = await newCustomer();
    const orderId = await creditSale(customerId);
    await call("POST", "/api/sales/payments", { orderId, amount: "40000", method: "cash" });
    const results = await Promise.all([
      call("POST", `/api/sales/orders/${orderId}/return`, { refund: false }),
      call("POST", `/api/sales/orders/${orderId}/return`, { refund: false }),
    ]);
    expect(results.map((res) => res.statusCode).sort()).toEqual([200, 400]);
    expect(await customerRow(customerId)).toMatchObject({ totalDebt: "0.00", balance: "40000.00" });
    await expectReconciled(customerId);

    const second = await creditSale(customerId);
    expect((await call("POST", `/api/sales/orders/${second}/return`, { refund: false }, other.ownerCookie)).statusCode).toBe(404);
    const kassir = await addEmployee(app, company, "Kassir");
    expect((await call("POST", `/api/sales/orders/${second}/return`, { refund: false }, kassir.cookie)).statusCode).toBe(403);
    expect((await customerRow(customerId)).totalDebt).toBe("100000.00");
  });
});
