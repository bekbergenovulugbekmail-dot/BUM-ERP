import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts, cashAccounts } from "../src/db/schema/finance.js";
import { stockLevels, warehouses } from "../src/db/schema/inventory.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let other: Company;
let mainWh: string;
let mainCash: string;
let productId: string;

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
  const piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Do'kon" });
  other = await createCompany(app, admin.cookie, { name: "Boshqa do'kon" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  const cash = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));
  mainCash = cash.find((c) => c.type === "cash")!.id;

  const product = await call(company.ownerCookie, "POST", "/api/catalog/products", {
    name: "Choy",
    sku: "CHOY",
    baseUnitId: piece,
    salesPrice: "5000",
    taxRate: "12",
    taxIncluded: true,
  });
  productId = product.json().product.id;
  await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", {
    type: "receive",
    productId,
    warehouseId: mainWh,
    quantity: "10",
    costPrice: "3000",
  });
});

function call(cookie: string, method: "GET" | "POST", url: string, payload?: object) {
  return app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
}
const pos = (method: "GET" | "POST", url: string, cookie: string, payload?: object) =>
  call(cookie, method, `/api/sales/pos${url}`, payload);

async function ledger(code: string) {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code)));
  return row!.balance;
}

async function cashBalance() {
  const [row] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, mainCash));
  return row!.balance;
}

async function stockQty() {
  const [row] = await db
    .select()
    .from(stockLevels)
    .where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, mainWh)));
  return row!.quantity;
}

async function openShift(cookie: string) {
  const res = await pos("POST", "/shifts", cookie, { warehouseId: mainWh, openingCash: "0" });
  expect(res.statusCode).toBe(201);
  return res.json().shift as { id: string };
}

async function newCustomer(cookie: string, body: object) {
  const res = await pos("POST", "/customers", cookie, body);
  expect(res.statusCode).toBe(201);
  return res.json().customer as { id: string; code: string };
}

const customerOf = async (id: string) =>
  (await call(company.ownerCookie, "GET", `/api/sales/customers/${id}`)).json().customer;

describe("POS mijozlari", () => {
  it("kassir mijoz qo'shadi; telefon takrori rad; telefon, ism yoki familiya bo'yicha qidiruv", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const created = await pos("POST", "/customers", kassir.cookie, { name: "Valiyev Ali", phone: "+998 90 123 45 67" });
    expect(created.statusCode).toBe(201);
    expect(created.json().customer).toMatchObject({ code: "C-0001", balance: "0.00", totalDebt: "0.00" });
    expect((await pos("POST", "/customers", kassir.cookie, { name: "Boshqa", phone: "901234567" })).statusCode).toBe(409);
    await newCustomer(kassir.cookie, { name: "Karimova Nodira", phone: "+998935550011" });

    const search = async (term: string, cookie = kassir.cookie) => {
      const res = await call(cookie, "GET", `/api/sales/customers?search=${encodeURIComponent(term)}`);
      expect(res.statusCode).toBe(200);
      return res.json().customers.map((c: { name: string }) => c.name);
    };
    expect(await search("ali valiyev")).toEqual(["Valiyev Ali"]);
    expect(await search("Nodira")).toEqual(["Karimova Nodira"]);
    expect(await search("90 123 45")).toEqual(["Valiyev Ali"]);
    expect(await search("5550011")).toEqual(["Karimova Nodira"]);
    expect(await search("777")).toEqual([]);
    expect(await search("Valiyev", other.ownerCookie)).toEqual([]);
  });

  it("balans: to'ldirish, balansdan to'lash, qaytim balansga, qarzga sotuv, qarzni balansdan yopish, tarix", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const shift = await openShift(kassir.cookie);
    const customer = await newCustomer(kassir.cookie, { name: "Doimiy mijoz", phone: "+998971112233" });
    const payCustomer = (body: object) =>
      pos("POST", `/customers/${customer.id}/payments`, kassir.cookie, { shiftId: shift.id, ...body });

    const deposit = await payCustomer({ purpose: "deposit", amount: "50000", method: "cash" });
    expect(deposit.statusCode).toBe(201);
    expect(deposit.json().customer).toMatchObject({ balance: "50000.00", totalDebt: "0.00" });
    expect(await cashBalance()).toBe("50000.00");
    expect(await ledger("2300")).toBe("50000.00");
    expect((await payCustomer({ purpose: "deposit", amount: "1000", method: "balance" })).statusCode).toBe(400);

    // 10 000 lik chek: 3 000 balansdan, 10 000 naqd berildi → 7 000 to'lov, 3 000 qaytim balansga
    const sale = await pos("POST", "/sales", kassir.cookie, {
      shiftId: shift.id,
      customerId: customer.id,
      items: [{ productId, quantity: "2" }],
      paymentMethod: "cash",
      amountPaid: "10000",
      balanceAmount: "3000",
      changeToBalance: true,
    });
    expect(sale.statusCode).toBe(201);
    expect(sale.json()).toMatchObject({
      paid: "7000.00",
      change: "0.00",
      balanceUsed: "3000.00",
      changeToBalance: "3000.00",
      debt: "0.00",
      customer: { balance: "50000.00", totalDebt: "0.00" },
    });
    expect(sale.json().order).toMatchObject({ status: "delivered", totalAmount: "10000.00", paidAmount: "10000.00" });
    expect(await cashBalance()).toBe("60000.00");
    expect(await ledger("2300")).toBe("50000.00");
    expect(await ledger("1100")).toBe("0.00");

    const credit = await pos("POST", "/sales", kassir.cookie, {
      shiftId: shift.id,
      customerId: customer.id,
      items: [{ productId, quantity: "1" }],
      paymentMethod: "cash",
      amountPaid: "0",
      onCredit: true,
    });
    expect(credit.statusCode).toBe(201);
    expect(credit.json()).toMatchObject({ paid: "0.00", debt: "5000.00", customer: { totalDebt: "5000.00" } });
    expect(credit.json().order.status).toBe("shipped");
    expect(await ledger("1100")).toBe("5000.00");

    expect((await payCustomer({ purpose: "debt", amount: "6000", method: "cash" })).statusCode).toBe(400);
    const fromBalance = await payCustomer({ purpose: "debt", amount: "5000", method: "balance" });
    expect(fromBalance.statusCode).toBe(201);
    expect(fromBalance.json().customer).toMatchObject({ balance: "45000.00", totalDebt: "0.00" });
    expect(await ledger("1100")).toBe("0.00");
    expect(await ledger("2300")).toBe("45000.00");

    // Rad etiladi: mijozsiz balans yoki qaytim, chekdan ortiq, balansda yetarli emas
    const poor = await newCustomer(kassir.cookie, { name: "Balansi yo'q" });
    const sell = (body: object) =>
      pos("POST", "/sales", kassir.cookie, {
        shiftId: shift.id,
        items: [{ productId, quantity: "1" }],
        paymentMethod: "cash",
        amountPaid: "5000",
        ...body,
      });
    expect((await sell({ balanceAmount: "1000" })).statusCode).toBe(400);
    expect((await sell({ changeToBalance: true, amountPaid: "6000" })).statusCode).toBe(400);
    expect((await sell({ customerId: customer.id, balanceAmount: "6000" })).statusCode).toBe(400);
    expect((await sell({ customerId: poor.id, balanceAmount: "1000" })).statusCode).toBe(400);

    expect((await pos("GET", `/shifts/${shift.id}`, kassir.cookie)).json().shift).toMatchObject({
      totalSales: "15000.00",
      totalCash: "60000.00",
      receiptCount: 2,
    });

    const history = await call(kassir.cookie, "GET", `/api/sales/customers/${customer.id}/balance`);
    expect(history.statusCode).toBe(200);
    const rows = history.json().transactions as { type: string; amount: string }[];
    expect(rows.map((r) => `${r.type}:${r.amount}`).sort()).toEqual(
      ["change:3000.00", "deposit:50000.00", "sale_payment:-3000.00", "sale_payment:-5000.00"].sort(),
    );
    expect((await call(other.ownerCookie, "GET", `/api/sales/customers/${customer.id}/balance`)).statusCode).toBe(404);
  });

  it("qaytarish: balansdan to'langan qism balansga, naqd qism kassadan qaytadi", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const shift = await openShift(kassir.cookie);
    const customer = await newCustomer(kassir.cookie, { name: "Qaytaruvchi" });
    const deposit = await pos("POST", `/customers/${customer.id}/payments`, kassir.cookie, {
      shiftId: shift.id,
      purpose: "deposit",
      amount: "5000",
      method: "cash",
    });
    expect(deposit.statusCode).toBe(201);

    const sale = await pos("POST", "/sales", kassir.cookie, {
      shiftId: shift.id,
      customerId: customer.id,
      items: [{ productId, quantity: "2" }],
      paymentMethod: "cash",
      amountPaid: "5000",
      balanceAmount: "5000",
    });
    expect(sale.statusCode).toBe(201);
    expect(await cashBalance()).toBe("10000.00");
    expect((await customerOf(customer.id)).balance).toBe("0.00");

    const returned = await call(company.ownerCookie, "POST", `/api/sales/orders/${sale.json().order.id}/return`, { refund: true });
    expect(returned.statusCode).toBe(200);
    expect(returned.json().refunded).toBe("10000.00");
    expect(await customerOf(customer.id)).toMatchObject({ balance: "5000.00", totalDebt: "0.00" });
    expect(await cashBalance()).toBe("5000.00");
    expect(await ledger("2300")).toBe("5000.00");
    expect(await ledger("1100")).toBe("0.00");
    expect(await stockQty()).toBe("10.0000");
    expect((await pos("GET", `/shifts/${shift.id}`, kassir.cookie)).json().shift.totalCash).toBe("5000.00");
  });
});
