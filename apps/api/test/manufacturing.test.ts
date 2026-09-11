import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts } from "../src/db/schema/finance.js";
import { stockLevels, warehouses } from "../src/db/schema/inventory.js";
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
  company = await createCompany(app, admin.cookie, { name: "Novvoyxona" });
  other = await createCompany(app, admin.cookie, { name: "Boshqa kompaniya" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
});

type Method = "GET" | "POST" | "PATCH" | "DELETE";
const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const mfg = (method: Method, url: string, payload?: object, cookie = company.ownerCookie) =>
  call(cookie, method, `/api/manufacturing${url}`, payload);

async function product(sku: string, owner = company) {
  const res = await call(owner.ownerCookie, "POST", "/api/catalog/products", { name: `Mahsulot ${sku}`, sku, baseUnitId: piece });
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

async function stock(productId: string) {
  const [row] = await db
    .select()
    .from(stockLevels)
    .where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, mainWh)));
  return row;
}

async function ledger(code: string) {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code)));
  return row!.balance;
}

/** Non: 10 dona uchun 5 un (+10% chiqindi) va 1 shakar. */
async function breadRecipe() {
  const bread = await product("NON");
  const flour = await product("UN");
  const sugar = await product("SHAKAR");
  const bom = await mfg("POST", "/boms", { productId: bread, name: "Non retsepti", quantity: "10" });
  expect(bom.statusCode).toBe(201);
  const bomId = bom.json().bom.id as string;
  expect((await mfg("POST", `/boms/${bomId}/items`, { productId: flour, quantity: "5", scrapPercent: "10" })).statusCode).toBe(201);
  expect((await mfg("POST", `/boms/${bomId}/items`, { productId: sugar, quantity: "1" })).statusCode).toBe(201);
  return { bread, flour, sugar, bomId };
}

describe("Retseptlar va ish markazlari", () => {
  it("o'zi tarkib bo'lolmaydi, sikl, begona mahsulot, versiya noyobligi, ruxsatlar; ish markazi kodi", async () => {
    const { bread, flour, bomId } = await breadRecipe();

    expect((await mfg("POST", `/boms/${bomId}/items`, { productId: bread, quantity: "1" })).statusCode).toBe(400);
    const flourBom = (await mfg("POST", "/boms", { productId: flour, name: "Un retsepti", quantity: "1" })).json().bom.id;
    const cycle = await mfg("POST", `/boms/${flourBom}/items`, { productId: bread, quantity: "1" });
    expect(cycle.statusCode).toBe(400);
    expect(cycle.json().message).toContain("sikl");
    expect((await mfg("POST", `/boms/${bomId}/items`, { productId: await product("F", other), quantity: "1" })).statusCode).toBe(400);
    expect((await mfg("POST", "/boms", { productId: bread, name: "Takror" })).statusCode).toBe(409);

    const detail = (await mfg("GET", `/boms/${bomId}`)).json().bom;
    expect(detail).toMatchObject({ version: "1", quantity: "10.0000", unitName: "d" });
    expect(detail.items.map((i: { componentName: string }) => i.componentName)).toEqual(["Mahsulot SHAKAR", "Mahsulot UN"]);
    const flourItem = detail.items.find((i: { productId: string }) => i.productId === flour);
    expect((await mfg("PATCH", `/boms/${bomId}/items/${flourItem.id}`, { scrapPercent: "5" })).json().item.scrapPercent).toBe("5.00");
    expect((await mfg("GET", "/boms")).json().boms).toHaveLength(2);

    const kassir = await addEmployee(app, company, "Kassir");
    expect((await mfg("GET", "/boms", undefined, kassir.cookie)).statusCode).toBe(403);

    const first = await mfg("POST", "/work-centers", { name: "Pech", type: "machine", costPerHour: "15000" });
    expect(first.json().workCenter).toMatchObject({ code: "WC-001", costPerHour: "15000.00" });
    const second = await mfg("POST", "/work-centers", { name: "Novvoy", type: "labor" });
    expect(second.json().workCenter.code).toBe("WC-002");
    expect((await mfg("DELETE", `/work-centers/${second.json().workCenter.id}`)).statusCode).toBe(204);
  });
});

describe("Ishlab chiqarish buyurtmalari", () => {
  it("xomashyo AVCO da chiqadi, mehnat tannarxga qo'shiladi, tayyor mahsulot tannarxi va jurnal", async () => {
    const { bread, flour, sugar, bomId } = await breadRecipe();
    await receive(flour, "100", "2000");
    await receive(sugar, "50", "5000");
    const oven = (await mfg("POST", "/work-centers", { name: "Pech", costPerHour: "15000" })).json().workCenter.id;

    const created = await mfg("POST", "/orders", { bomId, warehouseId: mainWh, plannedQty: "20", plannedDate: today });
    expect(created.statusCode).toBe(201);
    const order = created.json().order;
    expect(order).toMatchObject({ number: `MO-${year}-0001`, status: "draft", totalMaterialCost: "32000.00", unitCost: "1600.0000" });
    const flourMaterial = order.materials.find((m: { productId: string }) => m.productId === flour);
    expect(flourMaterial).toMatchObject({ plannedQty: "11.0000", unitCost: "2000.0000", totalCost: "22000.00" });

    expect((await mfg("POST", `/orders/${order.id}/complete`, { producedQty: "20" })).statusCode).toBe(400);
    expect((await mfg("POST", `/orders/${order.id}/confirm`)).json().order.status).toBe("confirmed");
    expect((await mfg("POST", `/orders/${order.id}/start`)).json().order.status).toBe("in_progress");

    const time = await mfg("POST", `/orders/${order.id}/time-lines`, { workCenterId: oven, plannedHours: "2", actualHours: "2" });
    expect(time.json().timeLine.totalCost).toBe("30000.00");
    expect((await mfg("GET", `/orders/${order.id}`)).json().order).toMatchObject({ totalLaborCost: "30000.00", totalCost: "62000.00" });
    expect((await mfg("DELETE", `/work-centers/${oven}`)).statusCode).toBe(409);

    const draft = (await mfg("POST", "/orders", { bomId, warehouseId: mainWh, plannedQty: "10", plannedDate: today })).json().order;
    const foreignMaterial = [{ materialId: draft.materials[0].id, actualQty: "1" }];
    expect((await mfg("POST", `/orders/${order.id}/complete`, { producedQty: "20", actualMaterials: foreignMaterial })).statusCode).toBe(400);

    const completed = await mfg("POST", `/orders/${order.id}/complete`, {
      producedQty: "20",
      actualMaterials: [{ materialId: flourMaterial.id, actualQty: "12" }],
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().order).toMatchObject({
      status: "completed",
      producedQty: "20.0000",
      totalMaterialCost: "34000.00",
      totalLaborCost: "30000.00",
      totalCost: "64000.00",
      unitCost: "3200.0000",
    });
    expect(await stock(bread)).toMatchObject({ quantity: "20.0000", avgCostPrice: "3200.0000" });
    expect(await stock(flour)).toMatchObject({ quantity: "88.0000" });
    expect(await stock(sugar)).toMatchObject({ quantity: "48.0000" });
    expect(await ledger("1200")).toBe("30000.00");
    expect(await ledger("5100")).toBe("-30000.00");

    expect((await mfg("POST", `/orders/${order.id}/complete`, { producedQty: "1" })).statusCode).toBe(400);
    expect((await mfg("POST", `/orders/${order.id}/time-lines`, { workCenterId: oven, actualHours: "1" })).statusCode).toBe(400);
    expect((await mfg("POST", `/orders/${order.id}/cancel`)).statusCode).toBe(400);
    expect((await mfg("DELETE", `/boms/${bomId}`)).statusCode).toBe(409);

    const stats = (await mfg("GET", "/orders/stats")).json();
    expect(stats).toMatchObject({ total: 2, completedCost: "64000.00", completedThisMonth: 1 });
  });

  it("xomashyo yetmasa hech narsa yozilmaydi; ishlab chiqarish menejeri ruxsatlari", async () => {
    const { bread, flour, sugar, bomId } = await breadRecipe();
    await receive(flour, "5", "2000");
    await receive(sugar, "50", "5000");

    const manager = await addEmployee(app, company, "Ishlab chiqarish menejeri");
    const created = await mfg("POST", "/orders", { bomId, warehouseId: mainWh, plannedQty: "20", plannedDate: today }, manager.cookie);
    expect(created.statusCode).toBe(201);
    const orderId = created.json().order.id;
    expect((await mfg("POST", `/orders/${orderId}/confirm`, undefined, manager.cookie)).statusCode).toBe(200);
    expect((await mfg("POST", `/orders/${orderId}/start`, undefined, manager.cookie)).statusCode).toBe(200);

    const failed = await mfg("POST", `/orders/${orderId}/complete`, { producedQty: "20" }, manager.cookie);
    expect(failed.statusCode).toBe(400);
    expect(failed.json().message).toContain("zaxira");
    expect(await stock(flour)).toMatchObject({ quantity: "5.0000" });
    expect(await stock(sugar)).toMatchObject({ quantity: "50.0000" });
    expect(await stock(bread)).toBeUndefined();
    expect((await mfg("GET", `/orders/${orderId}`)).json().order.status).toBe("in_progress");

    expect((await mfg("POST", `/orders/${orderId}/cancel`, undefined, manager.cookie)).json().order.status).toBe("cancelled");
    const kassir = await addEmployee(app, company, "Kassir");
    expect((await mfg("GET", "/orders", undefined, kassir.cookie)).statusCode).toBe(403);
    expect((await mfg("GET", `/orders/${orderId}`, undefined, other.ownerCookie)).statusCode).toBe(404);
  });
});
