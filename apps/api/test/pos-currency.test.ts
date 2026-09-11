import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts, cashAccounts } from "../src/db/schema/finance.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let mainWh: string;
let mainCash: string;
let usdCash: string;
let headphones: string;
let cable: string;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

const call = (cookie: string, method: "GET" | "POST" | "PUT", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

beforeEach(async () => {
  await resetDatabase();
  await db.delete(units);
  await seedDefaultUnits(db);
  const piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Valyuta do'kon" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  mainCash = (await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId))).find(
    (c) => c.type === "cash",
  )!.id;
  const owner = company.ownerCookie;

  expect(
    (await call(owner, "PUT", "/api/finance/currencies", {
      cbuEnabled: false,
      currencies: [{ code: "USD", rate: "12500", source: "manual", isActive: true }],
    })).statusCode,
  ).toBe(200);
  usdCash = (await call(owner, "POST", "/api/finance/cash-accounts", { name: "Dollar kassa", type: "cash", currency: "USD" })).json()
    .cashAccount.id;

  const product = async (body: object) => {
    const id = (await call(owner, "POST", "/api/catalog/products", { baseUnitId: piece, taxRate: "0", ...body })).json().product.id;
    await call(owner, "POST", "/api/inventory/stock/movements", {
      type: "receive",
      productId: id,
      warehouseId: mainWh,
      quantity: "20",
      costPrice: "1000",
    });
    return id as string;
  };
  headphones = await product({ name: "Naushnik", sku: "NAUSH", salesPrice: "10", salesCurrency: "USD" });
  cable = await product({ name: "Kabel", sku: "KABEL", salesPrice: "5000" });
});

async function cashBalance(id: string) {
  return (await db.select().from(cashAccounts).where(eq(cashAccounts.id, id)))[0]!.balance;
}

async function ledger(code: string) {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code)));
  return row!.balance;
}

async function openShift(cookie: string) {
  const res = await call(cookie, "POST", "/api/sales/pos/shifts", { warehouseId: mainWh, openingCash: "0" });
  expect(res.statusCode).toBe(201);
  return res.json().shift.id as string;
}

describe("POS: sotuv valyutalari", () => {
  it("ikki valyutada chek: har mahsulot o'z valyutasida, valyuta bo'yicha jami va to'lov, dollar kassaga, qaytim dollarda", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const shiftId = await openShift(kassir.cookie);

    const sale = await call(kassir.cookie, "POST", "/api/sales/pos/sales", {
      shiftId,
      saleCurrencies: ["UZS", "USD"],
      items: [{ productId: headphones, quantity: "2" }, { productId: cable, quantity: "1" }],
      paymentMethod: "cash",
      amountPaid: "5000",
      currencyPayments: [{ currency: "USD", amount: "25" }],
    });
    expect(sale.statusCode).toBe(201);
    const body = sale.json();
    expect(body.order).toMatchObject({ totalAmount: "255000.00", paidAmount: "255000.00", status: "delivered" });
    expect(body.currencyTotals).toEqual(
      expect.arrayContaining([
        { currency: "USD", total: "20.00", covered: "0.00", paid: "20.00", change: "5.00" },
        { currency: "UZS", total: "5000.00", covered: "0.00", paid: "5000.00", change: "0.00" },
      ]),
    );
    const headphoneLine = body.order.items.find((item: { productId: string }) => item.productId === headphones);
    expect(headphoneLine).toMatchObject({ priceCurrency: "USD", currencyTotal: "20.00", lineTotal: "250000.00" });
    expect(body.order.currencyTotals).toEqual(
      expect.arrayContaining([
        { currency: "USD", totalAmount: "20.00", paidAmount: "20.00" },
        { currency: "UZS", totalAmount: "5000.00", paidAmount: "5000.00" },
      ]),
    );

    expect(await cashBalance(usdCash)).toBe("20.00");
    expect(await cashBalance(mainCash)).toBe("5000.00");
    expect(await ledger("1010")).toBe("255000.00");
    expect(await ledger("1100")).toBe("0.00");

    // Asosiy valyutadagi to'lov valyuta maydonida yuborilmaydi; chekda yo'q valyuta rad
    const bad = (payload: object) =>
      call(kassir.cookie, "POST", "/api/sales/pos/sales", {
        shiftId,
        saleCurrencies: ["UZS", "USD"],
        items: [{ productId: cable, quantity: "1" }],
        paymentMethod: "cash",
        amountPaid: "5000",
        ...payload,
      });
    expect((await bad({ currencyPayments: [{ currency: "UZS", amount: "5000" }] })).statusCode).toBe(400);
    expect((await bad({ currencyPayments: [{ currency: "USD", amount: "1" }] })).statusCode).toBe(400);
    expect((await bad({ saleCurrencies: ["EUR"] })).statusCode).toBe(400);
  });

  it("bitta chet valyutada: narx kurs bilan dollarda; mijozsiz to'liq, mijozga qisman — qarz; qaytarish dollar kassadan", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const shiftId = await openShift(kassir.cookie);
    const sell = (payload: object) =>
      call(kassir.cookie, "POST", "/api/sales/pos/sales", {
        shiftId,
        saleCurrencies: ["USD"],
        paymentMethod: "cash",
        amountPaid: "0",
        ...payload,
      });

    // Kabel 5 000 so'm = 0,40 $
    expect((await sell({ items: [{ productId: cable, quantity: "1" }], currencyPayments: [{ currency: "USD", amount: "0.3" }] })).statusCode).toBe(400);
    expect((await sell({ items: [{ productId: cable, quantity: "1" }], amountPaid: "5000" })).statusCode).toBe(400);
    const usdOnly = await sell({ items: [{ productId: cable, quantity: "1" }], currencyPayments: [{ currency: "USD", amount: "0.40" }] });
    expect(usdOnly.statusCode).toBe(201);
    expect(usdOnly.json().currencyTotals).toEqual([{ currency: "USD", total: "0.40", covered: "0.00", paid: "0.40", change: "0.00" }]);
    expect(usdOnly.json().order).toMatchObject({ totalAmount: "5000.00", paidAmount: "5000.00", status: "delivered" });

    const customer = (await call(kassir.cookie, "POST", "/api/sales/pos/customers", { name: "Dollar mijoz" })).json().customer;

    // 10 $ lik chekdan 4 $ to'landi → qarz 6 $ × 12 500 = 75 000
    const credit = await sell({
      customerId: customer.id,
      items: [{ productId: headphones, quantity: "1" }],
      currencyPayments: [{ currency: "USD", amount: "4" }],
    });
    expect(credit.statusCode).toBe(201);
    expect(credit.json()).toMatchObject({ debt: "75000.00", customer: { totalDebt: "75000.00" } });
    expect(credit.json().order).toMatchObject({ totalAmount: "125000.00", paidAmount: "50000.00", status: "shipped" });

    const usdBefore = Number(await cashBalance(usdCash));
    const returned = await call(company.ownerCookie, "POST", `/api/sales/orders/${credit.json().order.id}/return`, { refund: true });
    expect(returned.statusCode).toBe(200);
    expect(returned.json().refunded).toBe("50000.00");
    expect(usdBefore - Number(await cashBalance(usdCash))).toBe(4);
    expect((await call(company.ownerCookie, "GET", `/api/sales/customers/${customer.id}`)).json().customer.totalDebt).toBe("0.00");
    expect(await ledger("1100")).toBe("0.00");
  });

  it("smena valyuta bo'yicha: dollar naqd va karta, balans dollar qismini yopadi, qaytarish smenadan ayiradi, yopishda sanash", async () => {
    const owner = company.ownerCookie;
    expect((await call(owner, "POST", "/api/finance/cash-accounts", { name: "Dollar bank", type: "bank", currency: "USD" })).statusCode).toBe(201);
    const kassir = await addEmployee(app, company, "Kassir");

    const opened = await call(kassir.cookie, "POST", "/api/sales/pos/shifts", {
      warehouseId: mainWh,
      openingCash: "0",
      openingForeignCash: [{ currency: "USD", amount: "50" }],
    });
    expect(opened.statusCode).toBe(201);
    const shiftId = opened.json().shift.id as string;
    expect(opened.json().shift.openingForeignCash).toEqual({ USD: "50.00" });

    const sale = (payload: object) =>
      call(kassir.cookie, "POST", "/api/sales/pos/sales", { shiftId, saleCurrencies: ["USD"], paymentMethod: "cash", amountPaid: "0", ...payload });

    // Naqd: 10 $ lik chekka 15 $ — kassaga 10 $, qaytim 5 $
    const cashSale = await sale({ items: [{ productId: headphones, quantity: "1" }], currencyPayments: [{ currency: "USD", amount: "15" }] });
    expect(cashSale.statusCode).toBe(201);
    expect(cashSale.json().currencyTotals).toEqual([{ currency: "USD", total: "10.00", covered: "0.00", paid: "10.00", change: "5.00" }]);

    // Karta: qoldiqdan ortig'i rad, aniq summa dollar bankka
    const cardItems = [{ productId: headphones, quantity: "2" }];
    expect((await sale({ items: cardItems, currencyPayments: [{ currency: "USD", amount: "25", method: "card" }] })).statusCode).toBe(400);
    expect((await sale({ items: cardItems, currencyPayments: [{ currency: "USD", amount: "20", method: "card" }] })).statusCode).toBe(201);
    const usdBank = (await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId))).find(
      (account) => account.type === "bank" && account.currency === "USD",
    )!;
    expect(usdBank.balance).toBe("20.00");

    // Balans 62 500 so'm (5 $) 10 $ lik chekning yarmini yopadi, qolgan 5 $ naqd
    const customer = (await call(kassir.cookie, "POST", "/api/sales/pos/customers", { name: "Balansli" })).json().customer;
    expect(
      (await call(kassir.cookie, "POST", `/api/sales/pos/customers/${customer.id}/payments`, {
        shiftId,
        purpose: "deposit",
        amount: "62500",
        method: "cash",
      })).statusCode,
    ).toBe(201);
    const covered = await sale({
      customerId: customer.id,
      items: [{ productId: headphones, quantity: "1" }],
      balanceAmount: "62500",
      currencyPayments: [{ currency: "USD", amount: "5" }],
    });
    expect(covered.statusCode).toBe(201);
    expect(covered.json()).toMatchObject({ debt: "0.00", balanceUsed: "62500.00", customer: { balance: "0.00", totalDebt: "0.00" } });
    expect(covered.json().currencyTotals).toEqual([{ currency: "USD", total: "10.00", covered: "5.00", paid: "5.00", change: "0.00" }]);
    expect(covered.json().order).toMatchObject({ paidAmount: "125000.00", status: "delivered" });

    let shift = (await call(kassir.cookie, "GET", `/api/sales/pos/shifts/${shiftId}`)).json().shift;
    expect(shift).toMatchObject({ foreignCash: { USD: "15.00" }, foreignCard: { USD: "20.00" }, totalCash: "62500.00" });

    // Naqd dollar chek qaytarildi — smenadagi dollar naqd kamayadi
    expect((await call(owner, "POST", `/api/sales/orders/${cashSale.json().order.id}/return`, { refund: true })).statusCode).toBe(200);
    shift = (await call(kassir.cookie, "GET", `/api/sales/pos/shifts/${shiftId}`)).json().shift;
    expect(shift.foreignCash).toEqual({ USD: "5.00" });

    // Yopish: dollar sanog'i majburiy; kutilgan 50 + 5 = 55
    const close = (payload: object) => call(kassir.cookie, "POST", `/api/sales/pos/shifts/${shiftId}/close`, { closingCash: "62500", ...payload });
    expect((await close({})).statusCode).toBe(400);
    const closed = await close({ closingForeignCash: [{ currency: "USD", amount: "54" }] });
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toMatchObject({
      difference: "0.00",
      foreignCash: [{ currency: "USD", expected: "55.00", counted: "54.00", difference: "-1.00" }],
    });
    expect(closed.json().shift.closingForeignCash).toEqual({ USD: "54.00" });
  });
});
