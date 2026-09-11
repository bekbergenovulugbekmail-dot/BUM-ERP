import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let piece: string;
let mainWh: string;

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
  company = await createCompany(app, admin.cookie, { name: "Do'kon" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
});

const call = (method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie: company.ownerCookie }, ...(payload ? { payload } : {}) });

const setCurrencies = (currencies: object[]) => call("PUT", "/api/finance/currencies", { cbuEnabled: false, currencies });

describe("Mahsulot narxi valyutada", () => {
  it("faqat yoqilgan valyuta; asosiy valyuta null saqlanadi; sotuvda joriy kurs bilan so'mga o'giriladi", async () => {
    expect((await setCurrencies([{ code: "USD", rate: "12500", source: "manual", isActive: true }])).statusCode).toBe(200);

    const create = (body: object) =>
      call("POST", "/api/catalog/products", { name: "Naushnik", baseUnitId: piece, taxRate: "0", ...body });
    const created = await create({ salesPrice: "10", salesCurrency: "usd", purchasePrice: "8", purchaseCurrency: "USD" });
    expect(created.statusCode).toBe(201);
    expect(created.json().product).toMatchObject({ salesCurrency: "USD", purchaseCurrency: "USD", salesPrice: "10.0000" });

    expect((await create({ salesPrice: "10", salesCurrency: "EUR" })).statusCode).toBe(400);
    const inBase = await create({ salesPrice: "5000", salesCurrency: "UZS" });
    expect(inBase.statusCode).toBe(201);
    expect(inBase.json().product.salesCurrency).toBeNull();

    const productId = created.json().product.id as string;
    const order = await call("POST", "/api/sales/orders", {
      warehouseId: mainWh,
      orderDate: "2026-09-12",
      items: [{ productId, quantity: "2" }],
    });
    expect(order.statusCode).toBe(201);
    expect(order.json().order).toMatchObject({ totalAmount: "250000.00" });
    expect(order.json().order.items[0]).toMatchObject({ unitPrice: "125000.0000" });

    // Kurs o'zgarsa yangi hujjat yangi kurs bilan
    await setCurrencies([{ code: "USD", rate: "12600", source: "manual", isActive: true }]);
    const second = await call("POST", "/api/sales/orders", {
      warehouseId: mainWh,
      orderDate: "2026-09-12",
      items: [{ productId, quantity: "1" }],
    });
    expect(second.json().order.totalAmount).toBe("126000.00");

    // Valyuta o'chirilsa — mahsulotni sotib bo'lmaydi, valyutani qo'yib bo'lmaydi
    await setCurrencies([]);
    const blocked = await call("POST", "/api/sales/orders", {
      warehouseId: mainWh,
      orderDate: "2026-09-12",
      items: [{ productId, quantity: "1" }],
    });
    expect(blocked.statusCode).toBe(400);
    expect((await call("PATCH", `/api/catalog/products/${inBase.json().product.id}`, { salesCurrency: "USD" })).statusCode).toBe(400);
    expect((await call("PATCH", `/api/catalog/products/${productId}`, { salesCurrency: null })).json().product.salesCurrency).toBeNull();
  });
});
