import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts, cashAccounts } from "../src/db/schema/finance.js";
import { stockLevels, warehouses } from "../src/db/schema/inventory.js";
import { customers } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let piece: string;
let mainWh: string;
let mainCash: string;

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
  company = await createCompany(app, admin.cookie, { name: "To'lov kompaniyasi" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  const [cash] = await db
    .select()
    .from(cashAccounts)
    .where(and(eq(cashAccounts.companyId, company.companyId), eq(cashAccounts.isDefault, true)));
  mainCash = cash!.id;
});

const call = (cookie: string, method: "GET" | "POST", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const sales = (method: "GET" | "POST", url: string, payload?: object, cookie = company.ownerCookie) =>
  call(cookie, method, `/api/sales${url}`, payload);

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

async function customerRow(id: string) {
  const [row] = await db.select().from(customers).where(eq(customers.id, id));
  return row!;
}

let seq = 0;
async function shippedOrder(quantity: string, options: { receiveQty?: string; cost?: string } = {}) {
  seq += 1;
  const product = await call(company.ownerCookie, "POST", "/api/catalog/products", {
    name: `P ${seq}`,
    sku: `P-${seq}`,
    baseUnitId: piece,
    salesPrice: "10000",
    taxRate: "0",
  });
  const productId = product.json().product.id as string;
  await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", {
    type: "receive",
    productId,
    warehouseId: mainWh,
    quantity: options.receiveQty ?? "10",
    costPrice: options.cost ?? "6000",
  });
  const buyer = (await sales("POST", "/customers", { name: `Mijoz ${seq}` })).json().customer;
  const created = await sales("POST", "/orders", {
    customerId: buyer.id,
    warehouseId: mainWh,
    orderDate: today,
    items: [{ productId, quantity }],
  });
  const orderId = created.json().order.id as string;
  await sales("POST", `/orders/${orderId}/confirm`);
  const shipped = await sales("POST", `/orders/${orderId}/ship`);
  expect(shipped.statusCode).toBe(200);
  return { orderId, customerId: buyer.id as string, productId };
}

describe("Mijoz to'lovlari", () => {
  it("qisman → yetkazildi; ortiqcha to'lov rad; reference takrorlanmaydi; qarz va jurnal", async () => {
    const { orderId, customerId } = await shippedOrder("3");
    expect((await customerRow(customerId)).totalDebt).toBe("30000.00");

    const first = await sales("POST", "/payments", { orderId, amount: "10000", method: "cash" });
    expect(first.statusCode).toBe(201);
    expect(first.json().payment).toMatchObject({ amount: "10000.00", cashAccountId: mainCash, customerId });
    expect(await cashBalance()).toBe("10000.00");
    expect(await ledger("1010")).toBe("10000.00");
    expect(await ledger("1100")).toBe("20000.00");
    expect((await sales("GET", `/orders/${orderId}`)).json().order).toMatchObject({ status: "shipped", paidAmount: "10000.00" });
    expect((await customerRow(customerId)).totalDebt).toBe("20000.00");

    expect((await sales("POST", "/payments", { orderId, amount: "20000.01" })).statusCode).toBe(400);

    const rest = await sales("POST", "/payments", { orderId, amount: "20000", reference: "R-1" });
    expect(rest.statusCode).toBe(201);
    expect((await sales("GET", `/orders/${orderId}`)).json().order.status).toBe("delivered");
    expect((await customerRow(customerId)).totalDebt).toBe("0.00");

    const repeat = await sales("POST", "/payments", { orderId, amount: "20000", reference: "R-1" });
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json().created).toBe(false);
    expect(await cashBalance()).toBe("30000.00");

    expect((await sales("POST", "/payments", { customerId, amount: "1" })).statusCode).toBe(400);
    const salesManager = await addEmployee(app, company, "Savdo menejeri");
    expect((await sales("POST", "/payments", { orderId, amount: "1" }, salesManager.cookie)).statusCode).toBe(403);
    expect((await sales("GET", `/payments?customerId=${customerId}`)).json().payments).toHaveLength(2);
  });
});

describe("Qaytarish", () => {
  it("zaxira sotuvdagi tannarxda qaytadi, tushum va tannarx teskari, pul qaytariladi", async () => {
    const { orderId, customerId, productId } = await shippedOrder("2");
    await sales("POST", "/payments", { orderId, amount: "20000" });
    expect(await cashBalance()).toBe("20000.00");

    // Keyingi kirim o'rtacha tannarxni o'zgartiradi — qaytarish esa sotuvdagi 6000 da kiradi
    await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", {
      type: "receive",
      productId,
      warehouseId: mainWh,
      quantity: "10",
      costPrice: "9000",
    });

    const returned = await sales("POST", `/orders/${orderId}/return`, { reason: "Nuqsonli" });
    expect(returned.statusCode).toBe(200);
    expect(returned.json()).toMatchObject({ refunded: "20000.00", order: { status: "returned", paidAmount: "0.00" } });

    const [level] = await db
      .select()
      .from(stockLevels)
      .where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, mainWh)));
    expect(level).toMatchObject({ quantity: "20.0000", avgCostPrice: "7500.0000" });

    expect(await ledger("4000")).toBe("0.00");
    expect(await ledger("5000")).toBe("0.00");
    expect(await ledger("1100")).toBe("0.00");
    expect(await ledger("1010")).toBe("0.00");
    expect(await cashBalance()).toBe("0.00");
    expect(await customerRow(customerId)).toMatchObject({ totalDebt: "0.00", totalPurchased: "0.00" });

    expect((await sales("POST", `/orders/${orderId}/return`)).statusCode).toBe(400);
    const kassir = await addEmployee(app, company, "Kassir");
    expect((await sales("POST", `/orders/${orderId}/return`, undefined, kassir.cookie)).statusCode).toBe(403);
  });

  it("pul qaytarilmasa mijozga avans (manfiy qarz) bo'lib qoladi", async () => {
    const { orderId, customerId } = await shippedOrder("1");
    await sales("POST", "/payments", { orderId, amount: "10000" });

    const returned = await sales("POST", `/orders/${orderId}/return`, { refund: false });
    expect(returned.json()).toMatchObject({ refunded: "0.00", order: { status: "returned", paidAmount: "10000.00" } });
    expect((await customerRow(customerId)).totalDebt).toBe("-10000.00");
    expect(await cashBalance()).toBe("10000.00");
    expect(await ledger("1100")).toBe("-10000.00");
  });
});
