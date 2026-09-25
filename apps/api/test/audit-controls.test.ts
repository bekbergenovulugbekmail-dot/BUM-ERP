/**
 * AUDIT nazoratlari:
 *  - AUD-011: foydalanuvchi sana tanlaydigan hujjatlar yopilgan davrga yozilmaydi (xarid qabuli, ta'minotchi to'lovi,
 *    xarajat to'lovi, o'tkazma, mijoz to'lovi);
 *  - AUD-012: qo'lda kassa harakati nazorat hisoblariga (1100/2000/1200/boshqa kassa) yozilmaydi;
 *  - AUD-021: inventarizatsiyadan keyin kech kelgan hujjat tuzatmasi 1200 ga ham tushadi — ombor qiymati = 1200.
 */
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts, cashAccounts } from "../src/db/schema/finance.js";
import { stockLevels, warehouses } from "../src/db/schema/inventory.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let piece: string;
let mainWh: string;
let mainCash: string;
let bank: string;

const iso = (offsetDays: number) => new Date(Date.now() + 5 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
const today = iso(0);
const yesterday = iso(-1);

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
  company = await createCompany(app, admin.cookie, { name: "Nazorat" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  const list = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));
  mainCash = list.find((row) => row.isDefault)!.id;
  bank = list.find((row) => row.type === "bank")!.id;
});

const call = (method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie: company.ownerCookie }, ...(payload ? { payload } : {}) });

async function account(code: string) {
  const [row] = await db.select().from(accounts).where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code)));
  return row!;
}

async function product(name: string) {
  const created = await call("POST", "/api/catalog/products", { name, sku: name, baseUnitId: piece, salesPrice: "2000", taxRate: "0" });
  return created.json().product.id as string;
}

describe("AUD-012: qo'lda kassa harakati", () => {
  it("nazorat hisoblari rad etiladi, kapital/boshqa daromad qabul qilinadi", async () => {
    const record = (counterAccountId: string) =>
      call("POST", "/api/finance/cash-transactions", { cashAccountId: mainCash, type: "in", amount: "1000", counterAccountId, description: "Sinov" });
    for (const code of ["1100", "2000", "1200", "1020", "2300"]) {
      const res = await record((await account(code)).id);
      expect(res.statusCode, `${code}: ${res.body}`).toBe(400);
    }
    expect((await record((await account("3000")).id)).statusCode).toBe(201);
    expect((await account("1100")).balance).toBe("0.00");
    expect((await account("2000")).balance).toBe("0.00");
  });
});

describe("AUD-011: yopilgan davr", () => {
  it("foydalanuvchi sanasi yopilgan davrga tushsa — o'tkazma, ta'minotchi to'lovi, xarajat to'lovi va mijoz to'lovi rad etiladi", async () => {
    // Pul va qarz tayyorlaymiz (bugungi sana — ochiq)
    await call("POST", "/api/finance/cash-transactions", {
      cashAccountId: mainCash, type: "in", amount: "5000000", counterAccountId: (await account("3000")).id, description: "Kapital",
    });
    const supplier = (await call("POST", "/api/purchase/suppliers", { name: "Ta'minotchi" })).json().supplier.id as string;
    await call("POST", `/api/purchase/suppliers/${supplier}/set-debt`, { totalDebt: "100000", reason: "Boshlang'ich" });
    const expense = (await call("POST", "/api/finance/expenses", { category: "Ijara", description: "Ijara", amount: "1000", expenseDate: today })).json().expense;
    await call("POST", `/api/finance/expenses/${expense.id}/status`, { status: "approved" });

    const customer = (await call("POST", "/api/sales/customers", { name: "Qarzdor" })).json().customer.id as string;
    await call("POST", `/api/sales/customers/${customer}/balance-adjust`, { totalDebt: "50000", reason: "Boshlang'ich" });

    const lock = await call("PUT", "/api/finance/lock-date", { lockDate: yesterday });
    expect(lock.statusCode, lock.body).toBe(200);

    const attempts = {
      transfer: await call("POST", "/api/finance/cash-transfers", { fromCashAccountId: mainCash, toCashAccountId: bank, amount: "100", txDate: yesterday }),
      supplierPayment: await call("POST", "/api/purchase/payments", { supplierId: supplier, amount: "1000", method: "cash", paymentDate: yesterday }),
      expensePaid: await call("POST", `/api/finance/expenses/${expense.id}/status`, { status: "paid", paidDate: yesterday }),
      customerPayment: await call("POST", "/api/sales/payments", { customerId: customer, amount: "1000", method: "cash", paymentDate: yesterday }),
    };
    for (const [name, res] of Object.entries(attempts)) {
      expect(res.statusCode, `${name}: ${res.body}`).toBe(400);
      expect(res.json().message, name).toContain("yopilgan");
    }
    // Ochiq sana bilan — o'tadi
    expect((await call("POST", "/api/finance/cash-transfers", { fromCashAccountId: mainCash, toCashAccountId: bank, amount: "100", txDate: today })).statusCode).toBe(201);
  });
});

describe("AUD-021: inventarizatsiya tuzatmasi jurnalga tushadi", () => {
  it("sanashdan keyin kech kelgan kirim — ombor qiymati 1200 hisobiga teng bo'lib qoladi", async () => {
    const productId = await product("SHAKAR");
    await call("POST", "/api/inventory/stock/movements", { type: "receive", productId, warehouseId: mainWh, quantity: "10", costPrice: "1000" });

    // Sanash: 10 ta bor, farqsiz yakunlanadi
    const count = (await call("POST", "/api/inventory/counts", { warehouseId: mainWh, name: "Oy oxiri" })).json().count;
    const detail = (await call("GET", `/api/inventory/counts/${count.id}`)).json().count;
    const item = detail.items.find((row: { productId: string }) => row.productId === productId);
    await call("PATCH", `/api/inventory/counts/${count.id}/items/${item.id}`, { countedQty: "10" });
    expect((await call("POST", `/api/inventory/counts/${count.id}/apply`)).statusCode).toBe(200);

    // Sanashdan OLDINGI vaqt bilan kech kiritilgan kirim — sanash buni allaqachon "ko'rgan", tuzatma qaytaradi
    const late = await call("POST", "/api/inventory/stock/movements", {
      type: "receive", productId, warehouseId: mainWh, quantity: "5", costPrice: "1000",
      occurredAt: new Date(Date.now() - 3600_000).toISOString(),
    });
    expect(late.statusCode, late.body).toBe(201);

    const [level] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, mainWh)));
    expect(level!.quantity).toBe("10.0000");
    const [value] = await db
      .select({ value: sql<string>`sum(${stockLevels.quantity} * ${stockLevels.avgCostPrice})::numeric(18,2)` })
      .from(stockLevels)
      .where(eq(stockLevels.companyId, company.companyId));
    expect((await account("1200")).balance, "1200 = ombor qiymati").toBe(value!.value);
  });
});
