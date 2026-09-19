/**
 * F-03: kassir mijoz qarzini ERP "To'lovlar" bo'limidan ham qabul qila oladi
 * (`sales.collect_payment`), lekin moliyani boshqarish (kassa ochish, o'tkazma) unda yo'q.
 */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { eq } from "drizzle-orm";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let company: Awaited<ReturnType<typeof createCompany>>;
let cashier: Awaited<ReturnType<typeof addEmployee>>;
let customerId: string;
let orderId: string;

const call = (cookie: string, method: "GET" | "POST", url: string, payload?: object) =>
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
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Kassir to'lovi" });
  cashier = await addEmployee(app, company, "Kassir");

  const unitId = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const warehouseId = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  const product = await call(company.ownerCookie, "POST", "/api/catalog/products", {
    name: "Suv 1L",
    sku: "SUV1",
    baseUnitId: unitId,
    salesPrice: "10000",
    taxRate: "0",
  });
  const productId = product.json().product.id as string;
  await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", {
    type: "receive",
    productId,
    warehouseId,
    quantity: "100",
    costPrice: "5000",
  });
  const customer = await call(company.ownerCookie, "POST", "/api/sales/customers", { name: "Qarzdor mijoz", creditLimit: "1000000" });
  customerId = customer.json().customer.id as string;

  // Nasiya sotuv: jo'natilgan, to'lanmagan — mijozda qarz paydo bo'ladi
  const order = await call(company.ownerCookie, "POST", "/api/sales/orders", {
    customerId,
    warehouseId,
    orderDate: new Date().toISOString().slice(0, 10),
    items: [{ productId, quantity: "10" }],
  });
  orderId = order.json().order.id as string;
  await call(company.ownerCookie, "POST", `/api/sales/orders/${orderId}/confirm`, {});
  await call(company.ownerCookie, "POST", `/api/sales/orders/${orderId}/ship`, {});
});

const debt = async () => Number((await call(company.ownerCookie, "GET", `/api/sales/customers/${customerId}`)).json().customer.totalDebt);

describe("Kassir mijozdan to'lov qabul qiladi (F-03)", () => {
  it("bitta usul va aralash to'lov: kassir qarzni yopadi, moliya sozlamalari esa yopiq qoladi", async () => {
    expect(await debt()).toBe(100_000);

    // Bitta usul
    const single = await call(cashier.cookie, "POST", "/api/sales/payments", {
      customerId,
      orderId,
      amount: "40000",
      method: "cash",
      paymentDate: new Date().toISOString().slice(0, 10),
      reference: "kassir-1",
    });
    expect(single.statusCode, single.body).toBe(201);
    expect(await debt()).toBe(60_000);

    // Aralash to'lov (parts)
    const mixed = await call(cashier.cookie, "POST", "/api/sales/payments", {
      customerId,
      orderId,
      parts: [{ method: "cash", amount: "60000" }],
      paymentDate: new Date().toISOString().slice(0, 10),
      reference: "kassir-2",
    });
    expect(mixed.statusCode, mixed.body).toBe(201);
    expect(await debt(), "qarz to'liq yopildi").toBe(0);

    // Takroriy yuborish yangi yozuv yaratmaydi
    const again = await call(cashier.cookie, "POST", "/api/sales/payments", {
      customerId,
      orderId,
      parts: [{ method: "cash", amount: "60000" }],
      paymentDate: new Date().toISOString().slice(0, 10),
      reference: "kassir-2",
    });
    expect(again.statusCode).toBe(200);
    expect(await debt()).toBe(0);

    // Kassirda moliyani boshqarish yo'q: yangi kassa ocha olmaydi
    const account = await call(cashier.cookie, "POST", "/api/finance/cash-accounts", { name: "Yangi kassa", type: "cash" });
    expect(account.statusCode, "kassir kassa ocha olmasligi kerak").toBe(403);
  });

  it("ruxsatsiz xodim (omborchi) mijozdan to'lov qabul qila olmaydi", async () => {
    const keeper = await addEmployee(app, company, "Omborchi");
    const res = await call(keeper.cookie, "POST", "/api/sales/payments", {
      customerId,
      orderId,
      amount: "1000",
      method: "cash",
      paymentDate: new Date().toISOString().slice(0, 10),
      reference: "omborchi-1",
    });
    expect(res.statusCode).toBe(403);
  });
});
