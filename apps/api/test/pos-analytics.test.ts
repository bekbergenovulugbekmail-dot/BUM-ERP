import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let piece: string;
let mainWarehouseId: string;

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
  const adminCookie = (await signedIn(app, { isPlatformAdmin: true })).cookie;
  company = await createCompany(app, adminCookie, { name: "Bonnu" });
  mainWarehouseId = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
});

const web = (method: "GET" | "POST", url: string, payload?: object) => app.inject({ method, url, headers: { cookie: company.ownerCookie }, ...(payload ? { payload } : {}) });

describe("Desktop kassa: analitika (serverdan)", () => {
  it("ombor savdosi: tushum, qaytarish, AVCO tannarx va foyda, to'lov turlari, mahsulot va kategoriya, qarzlar; ruxsat va davr tekshiruvi", async () => {
    const registered = await app.inject({
      method: "POST",
      url: "/api/pos-device/setup/register",
      payload: { phone: company.owner.phone, password: company.owner.password, warehouseId: mainWarehouseId, name: "Kassa 1" },
    });
    const token = (registered.json() as { token: string }).token;
    // Ega kassada parol bilan kiradi (qurilma amallari bog'langan kassir nomidan)
    const login = await app.inject({ method: "POST", url: "/api/pos-device/cashiers/login", headers: { authorization: `Bearer ${token}` }, payload: { phone: company.owner.phone, password: company.owner.password } });
    expect(login.statusCode, login.body).toBe(200);
    const device = (url: string) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
    const owner = company.owner.id;

    const productRes = await web("POST", "/api/catalog/products", { name: "Cola", sku: "COLA", baseUnitId: piece, salesPrice: "10000", taxRate: "0" });
    const cola = productRes.json().product.id as string;
    const tea = (await web("POST", "/api/catalog/products", { name: "Choy", sku: "TEA", baseUnitId: piece, salesPrice: "5000", taxRate: "0" })).json().product.id as string;
    for (const [productId, quantity, costPrice] of [
      [cola, "10", "6000"],
      [tea, "4", "2500"],
    ] as const) {
      expect((await web("POST", "/api/inventory/stock/movements", { type: "receive", productId, warehouseId: mainWarehouseId, quantity, costPrice })).statusCode).toBe(201);
    }
    expect((await web("POST", "/api/purchase/suppliers", { name: "Olma" })).statusCode).toBe(201);

    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
    const op = (type: string, payload: object, minutesAgo: number) => ({ opId: randomUUID(), type, cashierId: owner, createdAt: at(minutesAgo), payload });
    const shiftId = randomUUID();
    const firstSale = { saleId: randomUUID(), lineId: randomUUID() };
    const push = await app.inject({
      method: "POST",
      url: "/api/pos-device/push",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ops: [
          op("shift.open", { shiftId, openingCash: "0" }, 30),
          op(
            "sale.complete",
            { saleId: firstSale.saleId, shiftId, number: "K01-000001", items: [{ id: firstSale.lineId, productId: cola, unitId: piece, quantity: "3", unitPrice: "10000" }], paymentMethod: "cash", amountPaid: "30000" },
            20,
          ),
          op("sale.complete", { saleId: randomUUID(), shiftId, number: "K01-000002", items: [{ id: randomUUID(), productId: cola, unitId: piece, quantity: "1", unitPrice: "10000" }], paymentMethod: "card", amountPaid: "10000" }, 15),
          op("sale.return", { returnId: randomUUID(), orderId: firstSale.saleId, shiftId, number: "K01-Q000001", items: [{ orderItemId: firstSale.lineId, quantity: "1" }], refundMethod: "cash" }, 10),
        ],
      },
    });
    expect(push.json().results.map((row: { status: string }) => row.status)).toEqual(["applied", "applied", "applied", "applied"]);

    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const url = `/api/pos-device/analytics?from=${yesterday}&to=${today}&cashierId=${owner}`;
    const res = await device(url);
    expect(res.statusCode).toBe(200);
    const report = res.json();
    // 4 × 10000 − 1 × 10000; tannarx (4 − 1) × 6000
    expect(report.kpis).toMatchObject({
      revenue: "40000.00",
      returns: "10000.00",
      netRevenue: "30000.00",
      cogs: "18000.00",
      grossProfit: "12000.00",
      margin: "40.00",
      receipts: 2,
      averageReceipt: "15000.00",
      itemsSold: "3.0000",
      stockValue: "52000.00",
    });
    expect(report.payments).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "cash", amount: "20000.00" }), expect.objectContaining({ key: "card", amount: "10000.00" })]),
    );
    expect(report.products.top).toEqual([expect.objectContaining({ productId: cola, quantity: "3.0000", revenue: "30000.00", cogs: "18000.00", profit: "12000.00" })]);
    expect(report.products.slow).toEqual([expect.objectContaining({ productId: tea, stock: "4.0000", value: "10000.00" })]);
    expect(report.categories).toEqual([expect.objectContaining({ categoryId: null, name: "Kategoriyasiz", revenue: "30000.00", stockValue: "52000.00" })]);
    expect(report.daily.reduce((sum: number, row: { receipts: number }) => sum + row.receipts, 0)).toBe(2);
    expect(report.cashiers).toEqual([expect.objectContaining({ receipts: 2, revenue: "40000.00" })]);
    expect(report).toMatchObject({ receivables: { total: "0.00", count: 0 }, payables: { count: 0 }, cashFlow: { totalIncome: expect.any(String) } });

    // Ruxsat va davr
    const kassir = await addEmployee(app, company, "Kassir");
    expect((await device(`/api/pos-device/analytics?from=${yesterday}&to=${today}&cashierId=${kassir.id}`)).statusCode).toBe(403);
    expect((await device(`/api/pos-device/analytics?from=${today}&to=${yesterday}&cashierId=${owner}`)).statusCode).toBe(400);
    expect((await device(`/api/pos-device/analytics?from=${yesterday}&to=${today}`)).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
  });
});
