import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { cashAccounts } from "../src/db/schema/finance.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { customerCashbackTransactions } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let mainWh: string;
let usdCash: string;
let headphones: string;
let cable: string;

const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

const call = (method: "GET" | "POST" | "PUT", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie: company.ownerCookie }, ...(payload ? { payload } : {}) });

beforeEach(async () => {
  await resetDatabase();
  await db.delete(units);
  await seedDefaultUnits(db);
  const piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Ulgurji savdo" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;

  expect(
    (await call("PUT", "/api/finance/currencies", {
      cbuEnabled: false,
      currencies: [{ code: "USD", rate: "12500", source: "manual", isActive: true }],
    })).statusCode,
  ).toBe(200);
  usdCash = (await call("POST", "/api/finance/cash-accounts", { name: "Dollar kassa", type: "cash", currency: "USD" })).json()
    .cashAccount.id;

  const product = async (body: object) => {
    const id = (await call("POST", "/api/catalog/products", { baseUnitId: piece, taxRate: "0", ...body })).json().product.id;
    await call("POST", "/api/inventory/stock/movements", {
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

const cashback = (payload: object) =>
  call("PUT", "/api/sales/cashback/settings", { enabled: true, categoryRates: [], ...payload });

async function cashBalance(id: string) {
  return (await db.select().from(cashAccounts).where(eq(cashAccounts.id, id)))[0]!.balance;
}

describe("Savdo buyurtmasi valyutalarda", () => {
  it("valyuta bo'yicha jami, dollar to'lovi buyurtma kursida, keshbekdan to'lov chegarasi, keshbek jo'natishda bir marta", async () => {
    expect((await cashback({ accrualBase: "total", maxUsagePercent: 50, tiers: [{ minAmount: 0, percent: 2 }] })).statusCode).toBe(200);
    const customerId = (await call("POST", "/api/sales/customers", { name: "Ulgurji mijoz" })).json().customer.id;

    const created = await call("POST", "/api/sales/orders", {
      customerId,
      warehouseId: mainWh,
      orderDate: today,
      saleCurrencies: ["UZS", "USD"],
      items: [{ productId: headphones, quantity: "2" }, { productId: cable, quantity: "1" }],
    });
    expect(created.statusCode).toBe(201);
    const order = created.json().order;
    expect(order.totalAmount).toBe("255000.00");
    expect(order.currencyTotals).toEqual(
      expect.arrayContaining([
        { currency: "USD", totalAmount: "20.00", paidAmount: "0.00" },
        { currency: "UZS", totalAmount: "5000.00", paidAmount: "0.00" },
      ]),
    );

    expect((await call("POST", `/api/sales/orders/${order.id}/confirm`)).statusCode).toBe(200);
    const shipped = await call("POST", `/api/sales/orders/${order.id}/ship`);
    expect(shipped.statusCode).toBe(200);
    // 2% × 255 000
    expect(shipped.json().order).toMatchObject({ status: "completed", paymentStatus: "unpaid", cashbackEarned: "5100.00" });

    const pay = (payload: object) => call("POST", "/api/sales/payments", { orderId: order.id, ...payload });
    expect((await pay({ amount: "21", currency: "USD" })).statusCode).toBe(400);
    const usd = await pay({ amount: "20", currency: "USD", reference: "USD-1" });
    expect(usd.statusCode).toBe(201);
    expect(usd.json().payment).toMatchObject({ currency: "USD", foreignAmount: "20.00", amount: "250000.00" });
    expect((await pay({ amount: "20", currency: "USD", reference: "USD-1" })).statusCode).toBe(200);
    expect(await cashBalance(usdCash)).toBe("20.00");
    // Moliya dashboardida dollar tushumi asosiy valyutada: 20 $ × 12 500
    expect((await call("GET", "/api/finance/dashboard")).json().monthIncome).toBe("250000.00");

    // Keshbekdan: chegara 50% — mijozda 5 100, qoldiq 5 000
    expect((await pay({ amount: "5000", method: "cashback", currency: "USD" })).statusCode).toBe(400);
    expect((await pay({ amount: "5000", method: "cashback" })).statusCode).toBe(201);

    const detail = (await call("GET", `/api/sales/orders/${order.id}`)).json().order;
    expect(detail).toMatchObject({ paidAmount: "255000.00", status: "completed", paymentStatus: "paid", cashbackEarned: "5100.00" });
    expect(detail.currencyTotals).toEqual(
      expect.arrayContaining([
        { currency: "USD", totalAmount: "20.00", paidAmount: "20.00" },
        { currency: "UZS", totalAmount: "5000.00", paidAmount: "5000.00" },
      ]),
    );
    const earned = (await db.select().from(customerCashbackTransactions).where(eq(customerCashbackTransactions.orderId, order.id))).filter(
      (row) => row.type === "earn",
    );
    expect(earned).toHaveLength(1);
    expect((await call("GET", `/api/sales/customers/${customerId}`)).json().customer).toMatchObject({
      totalDebt: "0.00",
      cashbackBalance: "100.00",
    });
  });

  it("paid rejimi: keshbek to'liq to'langanda; balansdan to'lov; buyurtmada yo'q valyutada — joriy kurs bilan", async () => {
    expect((await cashback({ accrualBase: "paid", maxUsagePercent: 100, tiers: [{ minAmount: 0, percent: 1 }] })).statusCode).toBe(200);
    const customerId = (await call("POST", "/api/sales/customers", { name: "Balansli mijoz" })).json().customer.id;

    const shiftId = (await call("POST", "/api/sales/pos/shifts", { warehouseId: mainWh, openingCash: "0" })).json().shift.id;
    expect(
      (await call("POST", `/api/sales/pos/customers/${customerId}/payments`, {
        shiftId,
        purpose: "deposit",
        amount: "50000",
        method: "cash",
      })).statusCode,
    ).toBe(201);

    const order = (
      await call("POST", "/api/sales/orders", {
        customerId,
        warehouseId: mainWh,
        orderDate: today,
        items: [{ productId: cable, quantity: "20" }],
      })
    ).json().order;
    expect(order.currencyTotals).toEqual([]);
    await call("POST", `/api/sales/orders/${order.id}/confirm`);
    expect((await call("POST", `/api/sales/orders/${order.id}/ship`)).json().order.cashbackEarned).toBe("0.00");

    const pay = (payload: object) => call("POST", "/api/sales/payments", { orderId: order.id, ...payload });
    expect((await pay({ amount: "50000", method: "balance" })).statusCode).toBe(201);
    // 4 $ × 12 500 = 50 000 — qoldiqni yopadi
    const usd = await pay({ amount: "4", currency: "USD" });
    expect(usd.statusCode).toBe(201);
    expect(usd.json().payment).toMatchObject({ amount: "50000.00", foreignAmount: "4.00", currency: "USD" });
    expect((await pay({ amount: "1000" })).statusCode).toBe(400);

    const detail = (await call("GET", `/api/sales/orders/${order.id}`)).json().order;
    expect(detail).toMatchObject({ status: "completed", paymentStatus: "paid", paidAmount: "100000.00", cashbackEarned: "1000.00" });
    expect(detail.currencyTotals).toEqual([{ currency: "UZS", totalAmount: "100000.00", paidAmount: "100000.00" }]);
    expect((await call("GET", `/api/sales/customers/${customerId}`)).json().customer).toMatchObject({
      balance: "0.00",
      totalDebt: "0.00",
      cashbackBalance: "1000.00",
    });
  });
});
