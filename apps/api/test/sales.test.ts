import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts } from "../src/db/schema/finance.js";
import { stockLevels, warehouses } from "../src/db/schema/inventory.js";
import { customers } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let other: Company;
let piece: string;
let mainWh: string;

const today = new Date().toISOString().slice(0, 10);
const year = today.slice(0, 4);

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
  company = await createCompany(app, admin.cookie, { name: "Savdo kompaniyasi" });
  other = await createCompany(app, admin.cookie, { name: "Boshqa kompaniya" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
});

const call = (cookie: string, method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const sales = (method: "GET" | "POST" | "PATCH", url: string, payload?: object, cookie = company.ownerCookie) =>
  call(cookie, method, `/api/sales${url}`, payload);

async function product(sku: string, extra: object) {
  const res = await call(company.ownerCookie, "POST", "/api/catalog/products", { name: `Mahsulot ${sku}`, sku, baseUnitId: piece, ...extra });
  expect(res.statusCode).toBe(201);
  return res.json().product.id as string;
}

async function receive(productId: string, quantity: string, costPrice: string) {
  const res = await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", {
    type: "receive",
    productId,
    warehouseId: mainWh,
    quantity,
    costPrice,
  });
  expect(res.statusCode).toBe(201);
}

let seq = 0;
async function customer(extra: object = {}) {
  seq += 1;
  const res = await sales("POST", "/customers", { name: `Mijoz ${seq}`, ...extra });
  expect(res.statusCode).toBe(201);
  return res.json().customer as { id: string; code: string };
}

async function confirmed(body: object) {
  const created = await sales("POST", "/orders", { warehouseId: mainWh, orderDate: today, ...body });
  expect(created.statusCode).toBe(201);
  const res = await sales("POST", `/orders/${created.json().order.id}/confirm`);
  expect(res.statusCode).toBe(200);
  return res.json().order;
}

async function ledger(code: string) {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code)));
  return row!.balance;
}

async function stock(productId: string) {
  const [row] = await db
    .select()
    .from(stockLevels)
    .where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, mainWh)));
  return row;
}

describe("Mijozlar", () => {
  it("avtomatik kod, qidiruv, tahrir, qarzli mijozni faolsizlantirib bo'lmaydi, ruxsatlar", async () => {
    const first = await sales("POST", "/customers", { name: "Anvar", phone: "+998901112233", discountPercent: "5", creditLimit: "1000000" });
    expect(first.statusCode).toBe(201);
    const id = first.json().customer.id;
    expect(first.json().customer).toMatchObject({
      code: "C-0001",
      discountPercent: "5.00",
      creditLimit: "1000000.00",
      totalDebt: "0.00",
      currency: "UZS",
    });
    expect((await customer()).code).toBe("C-0002");

    const found = (await sales("GET", "/customers?search=anvar")).json().customers;
    expect(found.map((c: { id: string }) => c.id)).toEqual([id]);
    expect((await sales("PATCH", `/customers/${id}`, { phone: "+998909998877" })).json().customer.phone).toBe("+998909998877");

    await db.update(customers).set({ totalDebt: "10" }).where(eq(customers.id, id));
    expect((await sales("PATCH", `/customers/${id}`, { isActive: false })).statusCode).toBe(409);
    expect((await sales("GET", `/customers/${id}`)).json().customer).toMatchObject({ orders: [], payments: [] });

    const kassir = await addEmployee(app, company, "Kassir");
    expect((await sales("GET", "/customers", undefined, kassir.cookie)).statusCode).toBe(200);
    expect((await sales("POST", "/customers", { name: "X" }, kassir.cookie)).statusCode).toBe(403);
    expect((await sales("GET", `/customers/${id}`, undefined, other.ownerCookie)).statusCode).toBe(404);
  });
});

describe("Savdo buyurtmalari", () => {
  it("soliq narx ichida va ustiga; kassir narxni o'zgartira olmaydi; jo'natish — zaxira, tannarx, jurnal, qarz", async () => {
    const included = await product("A", { salesPrice: "11200", taxRate: "12", taxIncluded: true });
    const onTop = await product("B", { salesPrice: "1000", taxRate: "12", taxIncluded: false });
    const buyer = await customer();

    const created = await sales("POST", "/orders", {
      customerId: buyer.id,
      warehouseId: mainWh,
      orderDate: today,
      items: [
        { productId: included, quantity: "2" },
        { productId: onTop, quantity: "3", discountPercent: "10" },
      ],
    });
    expect(created.statusCode).toBe(201);
    const order = created.json().order;
    expect(order).toMatchObject({
      number: `SO-${year}-0001`,
      status: "draft",
      subtotal: "22700.00",
      taxAmount: "2724.00",
      discountAmount: "300.00",
      totalAmount: "25424.00",
    });

    const kassir = await addEmployee(app, company, "Kassir");
    const base = { customerId: buyer.id, warehouseId: mainWh, orderDate: today };
    const override = await sales("POST", "/orders", { ...base, items: [{ productId: included, quantity: "1", unitPrice: "1" }] }, kassir.cookie);
    expect(override.statusCode).toBe(403);
    const kassirOrder = await sales("POST", "/orders", { ...base, items: [{ productId: included, quantity: "1" }] }, kassir.cookie);
    expect(kassirOrder.statusCode).toBe(201);

    expect((await sales("POST", `/orders/${order.id}/confirm`)).statusCode).toBe(200);
    await receive(included, "5", "7000");
    await receive(onTop, "10", "500");

    const shipped = await sales("POST", `/orders/${order.id}/ship`);
    expect(shipped.statusCode).toBe(200);
    expect(shipped.json().order.status).toBe("completed");
    const items = shipped.json().order.items as { productId: string; costPrice: string }[];
    expect(items.find((i) => i.productId === included)!.costPrice).toBe("7000.0000");
    expect(await stock(included)).toMatchObject({ quantity: "3.0000" });
    expect(await stock(onTop)).toMatchObject({ quantity: "7.0000" });

    expect(await ledger("1100")).toBe("25424.00");
    expect(await ledger("4000")).toBe("25424.00");
    expect(await ledger("5000")).toBe("15500.00");
    const [row] = await db.select().from(customers).where(eq(customers.id, buyer.id));
    expect(row).toMatchObject({ totalDebt: "25424.00", totalPurchased: "25424.00" });

    expect((await sales("POST", `/orders/${order.id}/cancel`)).statusCode).toBe(400);
    const kassirOrderId = kassirOrder.json().order.id;
    await sales("POST", `/orders/${kassirOrderId}/confirm`);
    expect((await sales("POST", `/orders/${kassirOrderId}/ship`, undefined, kassir.cookie)).statusCode).toBe(403);

    const stats = (await sales("GET", "/orders/stats")).json();
    expect(stats).toMatchObject({ totalThisMonth: "36624.00", countThisMonth: 2, totalDebt: "25424.00" });
  });

  it("jo'natish rad etiladi: kredit limiti, zaxira yetmasa, mijozsiz to'lanmagan; bekor qilish", async () => {
    const item = await product("P", { salesPrice: "1000", taxRate: "0" });
    await receive(item, "5", "600");

    const limited = await customer({ creditLimit: "3000" });
    const big = await confirmed({ customerId: limited.id, items: [{ productId: item, quantity: "4" }] });
    const overLimit = await sales("POST", `/orders/${big.id}/ship`);
    expect(overLimit.statusCode).toBe(400);
    expect(overLimit.json().message).toContain("limit");

    const short = await confirmed({ customerId: (await customer()).id, items: [{ productId: item, quantity: "6" }] });
    const shortage = await sales("POST", `/orders/${short.id}/ship`);
    expect(shortage.statusCode).toBe(400);
    expect(shortage.json().message).toContain("zaxira");
    expect(await stock(item)).toMatchObject({ quantity: "5.0000" });
    expect((await sales("GET", `/orders/${short.id}`)).json().order.status).toBe("confirmed");

    const walkIn = await confirmed({ items: [{ productId: item, quantity: "1" }] });
    expect((await sales("POST", `/orders/${walkIn.id}/ship`)).statusCode).toBe(400);
    expect((await sales("POST", `/orders/${walkIn.id}/cancel`, { reason: "Mijoz kelmadi" })).json().order.status).toBe("cancelled");

    const list = (await sales("GET", "/orders?status=confirmed")).json().orders;
    expect(list).toHaveLength(2);
  });
});
