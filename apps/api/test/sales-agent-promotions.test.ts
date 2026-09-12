import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { auditLogs } from "../src/db/schema/platform.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { todayIso } from "../src/modules/finance/cash.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

let app: FastifyInstance;
let company: Company;
let cola: string;
let pepsi: string;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

beforeEach(async () => {
  await resetDatabase();
  await db.delete(units);
  await seedDefaultUnits(db);
  const piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Distribyutor" });
  const mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  const product = async (name: string, sku: string, salesPrice: string) => {
    const id = (await call(company.ownerCookie, "POST", "/api/catalog/products", { name, sku, baseUnitId: piece, salesPrice, taxRate: "0" })).json()
      .product.id as string;
    await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", {
      type: "receive",
      productId: id,
      warehouseId: mainWh,
      quantity: "100",
      costPrice: "1000",
    });
    return id;
  };
  cola = await product("Coca Cola 1L", "COLA", "10000");
  pepsi = await product("Pepsi 1L", "PEPSI", "5000");
});

async function agent(name: string) {
  const employee = await addEmployee(app, company, "Sotuv agenti");
  const rep = await call(company.ownerCookie, "POST", "/api/distribution/sales-reps", { name, userId: employee.id });
  return { cookie: employee.cookie, repId: rep.json().salesRep.id as string };
}

async function storeOnRoute(salesRepId: string) {
  const customerId = (
    await call(company.ownerCookie, "POST", "/api/sales/customers", { name: "Baraka", latitude: 41.311081, longitude: 69.240562 })
  ).json().customer.id as string;
  const routeId = (
    await call(company.ownerCookie, "POST", "/api/distribution/routes", { name: "Chilonzor", salesRepId, days: [0, 1, 2, 3, 4, 5, 6] })
  ).json().route.id as string;
  await call(company.ownerCookie, "POST", `/api/distribution/routes/${routeId}/customers`, { customerId });
  return customerId;
}

const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const near = { latitude: 41.3115, longitude: 69.2406 };
const actionCount = (action: string) => db.$count(auditLogs, eq(auditLogs.action, action));
const createPromotion = (cookie: string, body: object) => call(cookie, "POST", "/api/sales-agent/supervisor/promotions", body);

describe("Aksiyalar", () => {
  it("boshqarish: ruxsat va qoidalar; agent ro'yxati (faol, yaqinlashayotgan, tugayotgan) va katalog belgisi", async () => {
    const ali = await agent("Ali");
    const supervisor = await addEmployee(app, company, "Supervayzer");
    const today = todayIso();
    const bxgy = {
      name: "10 + 1 bepul",
      type: "buy_x_get_y",
      productId: cola,
      minQuantity: "10",
      freeQuantity: "1",
      startsAt: today,
      endsAt: shift(today, 2),
    };

    expect((await createPromotion(ali.cookie, bxgy)).statusCode).toBe(403);
    expect((await createPromotion(supervisor.cookie, { ...bxgy, freeQuantity: null })).statusCode).toBe(400);
    expect((await createPromotion(supervisor.cookie, { ...bxgy, endsAt: shift(today, -1) })).statusCode).toBe(400);
    expect((await createPromotion(supervisor.cookie, { ...bxgy, productId: randomUUID() })).statusCode).toBe(400);

    const created = await createPromotion(supervisor.cookie, bxgy);
    expect(created.statusCode).toBe(201);
    expect(created.json().promotion).toMatchObject({
      productName: "Coca Cola 1L",
      minQuantity: "10.0000",
      freeQuantity: "1.0000",
      discountPercent: null,
      isActive: true,
    });
    await createPromotion(supervisor.cookie, {
      name: "Pepsi -10%",
      type: "percent_discount",
      productId: pepsi,
      minQuantity: "5",
      freeQuantity: "3",
      discountPercent: "10",
      startsAt: today,
      endsAt: shift(today, 30),
    });
    await createPromotion(supervisor.cookie, {
      name: "Kelasi hafta",
      type: "percent_discount",
      productId: cola,
      minQuantity: "1",
      discountPercent: "5",
      startsAt: shift(today, 1),
      endsAt: shift(today, 7),
    });

    const names = async (filter: string) =>
      (await call(ali.cookie, "GET", `/api/sales-agent/promotions?filter=${filter}`)).json().promotions.map((p: { name: string }) => p.name);
    expect((await names("active")).sort()).toEqual(["10 + 1 bepul", "Pepsi -10%"]);
    expect(await names("upcoming")).toEqual(["Kelasi hafta"]);
    expect(await names("ending_soon")).toEqual(["10 + 1 bepul"]);

    const all = (await call(supervisor.cookie, "GET", "/api/sales-agent/supervisor/promotions")).json().promotions;
    // Foizli aksiyada bepul miqdor saqlanmaydi
    expect(all.find((p: { name: string }) => p.name === "Pepsi -10%")).toMatchObject({ freeQuantity: null, discountPercent: "10.00" });

    const colaRow = (await call(ali.cookie, "GET", "/api/sales-agent/catalog?search=cola")).json().products[0];
    expect(colaRow.promotions.map((p: { name: string }) => p.name)).toEqual(["10 + 1 bepul"]);

    const manager = await addEmployee(app, company, "Savdo menejeri");
    expect((await call(manager.cookie, "GET", "/api/sales-agent/supervisor/promotions?status=all")).json().promotions).toHaveLength(3);
    const viewer = await addEmployee(app, company, "Ko'ruvchi");
    expect((await call(viewer.cookie, "GET", "/api/sales-agent/supervisor/promotions")).statusCode).toBe(403);
    expect(await actionCount("PROMOTION_CREATED")).toBe(3);
  });

  it("buyurtmada serverda hisoblash: bepul miqdor va foiz, qoldiq bepul bilan, audit; faolsizlantirish va o'chirish", async () => {
    const ali = await agent("Ali");
    const supervisor = await addEmployee(app, company, "Supervayzer");
    const baraka = await storeOnRoute(ali.repId);
    const today = todayIso();
    const bxgyId = (
      await createPromotion(supervisor.cookie, {
        name: "10 + 1 bepul",
        type: "buy_x_get_y",
        productId: cola,
        minQuantity: "10",
        freeQuantity: "1",
        startsAt: today,
        endsAt: shift(today, 5),
      })
    ).json().promotion.id as string;
    await createPromotion(supervisor.cookie, {
      name: "Pepsi -10%",
      type: "percent_discount",
      productId: pepsi,
      minQuantity: "5",
      discountPercent: "10",
      startsAt: today,
      endsAt: shift(today, 5),
    });

    const save = (items: object[]) =>
      call(ali.cookie, "PUT", `/api/sales-agent/orders/drafts/${randomUUID()}`, { customerId: baraka, paymentType: "cash", items });
    const submit = (id: string) =>
      call(ali.cookie, "POST", `/api/sales-agent/orders/${id}/submit`, { ...near, accuracy: 10, recordedAt: new Date().toISOString() });

    const draft = (await save([{ productId: cola, pieces: "23" }, { productId: pepsi, pieces: "5" }])).json().order;
    expect(draft.totalAmount).toBe("252500.00");
    expect(draft.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productId: cola, quantity: "23.0000", unitPrice: "10000.0000", lineTotal: "230000.00" }),
        expect.objectContaining({ productId: cola, quantity: "2.0000", unitPrice: "0.0000", lineTotal: "0.00" }),
        expect.objectContaining({ productId: pepsi, quantity: "5.0000", discountPercent: "10.00", lineTotal: "22500.00" }),
      ]),
    );
    expect(draft.promotions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productId: cola, paidQuantity: "23.0000", freeQuantity: "2.0000", discountAmount: "20000.00" }),
        expect.objectContaining({ productId: pepsi, paidQuantity: "5.0000", freeQuantity: "0.0000", discountAmount: "2500.00" }),
      ]),
    );

    const sent = await submit(draft.id);
    expect(sent.statusCode).toBe(200);
    expect(sent.json().order).toMatchObject({ status: "confirmed", totalAmount: "252500.00" });
    expect(sent.json().order.promotions).toHaveLength(2);
    expect(await actionCount("PROMOTION_APPLIED")).toBe(2);

    // 95 + 9 bepul = 104 > 100
    const big = (await save([{ productId: cola, pieces: "95" }])).json().order;
    expect(big.items.find((item: { unitPrice: string }) => item.unitPrice === "0.0000").quantity).toBe("9.0000");
    expect((await submit(big.id)).json().details).toMatchObject({ reason: "out_of_stock", productId: cola, available: "100.0000" });

    const off = await call(supervisor.cookie, "PATCH", `/api/sales-agent/supervisor/promotions/${bxgyId}`, { isActive: false });
    expect(off.json().promotion.isActive).toBe(false);
    const plain = (await save([{ productId: cola, pieces: "10" }])).json().order;
    expect(plain.items).toHaveLength(1);
    expect(plain.promotions).toEqual([]);

    expect((await call(supervisor.cookie, "DELETE", `/api/sales-agent/supervisor/promotions/${bxgyId}`)).statusCode).toBe(409);
    const unused = (
      await createPromotion(supervisor.cookie, {
        name: "Sinov",
        type: "percent_discount",
        productId: pepsi,
        minQuantity: "1",
        discountPercent: "1",
        startsAt: shift(today, 10),
        endsAt: shift(today, 11),
      })
    ).json().promotion.id as string;
    expect((await call(supervisor.cookie, "DELETE", `/api/sales-agent/supervisor/promotions/${unused}`)).statusCode).toBe(204);
  });
});
