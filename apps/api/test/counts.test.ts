import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { stockLevels, stockMovements, warehouses } from "../src/db/schema/inventory.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let companyA: Company;
let piece: string;
let mainA: string;

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
  companyA = await createCompany(app, admin.cookie, { name: "A kompaniya" });
  mainA = (await db.select().from(warehouses).where(eq(warehouses.companyId, companyA.companyId)))[0]!.id;
});

const api = (cookie: string, method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
  app.inject({ method, url: `/api/inventory${url}`, headers: { cookie }, ...(payload ? { payload } : {}) });

async function stocked(sku: string, quantity: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/catalog/products",
    headers: { cookie: companyA.ownerCookie },
    payload: { name: sku, sku, baseUnitId: piece },
  });
  const productId = res.json().product.id as string;
  await api(companyA.ownerCookie, "POST", "/stock/movements", {
    type: "receive",
    productId,
    warehouseId: mainA,
    quantity,
    costPrice: "100",
  });
  return productId;
}

async function quantityOf(productId: string) {
  const [row] = await db
    .select()
    .from(stockLevels)
    .where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, mainA)));
  return row?.quantity;
}

describe("Inventarizatsiya", () => {
  it("hisob qoldiqlardan tuziladi; qo'llash JORIY qoldiqqa nisbatan tuzatadi (orada bo'lgan harakat yo'qolmaydi)", async () => {
    const apple = await stocked("OLMA", "10");
    const pear = await stocked("NOK", "7");

    const created = await api(companyA.ownerCookie, "POST", "/counts", { warehouseId: mainA, name: "Sentabr" });
    expect(created.statusCode).toBe(201);
    const countId = created.json().count.id as string;
    expect(created.json().count.itemCount).toBe(2);

    const detail = (await api(companyA.ownerCookie, "GET", `/counts/${countId}`)).json().count;
    const appleItem = detail.items.find((i: { productId: string }) => i.productId === apple);
    expect(appleItem).toMatchObject({ expectedQty: "10.0000", countedQty: null });

    const counted = await api(companyA.ownerCookie, "PATCH", `/counts/${countId}/items/${appleItem.id}`, { countedQty: "8" });
    expect(counted.json().item).toMatchObject({ countedQty: "8.0000", difference: "-2.0000" });
    expect((await api(companyA.ownerCookie, "GET", `/counts/${countId}`)).json().count.status).toBe("in_progress");

    // Hisob davomida 3 ta sotildi — sanalgan 8 fizik haqiqat bo'lib qoladi
    await api(companyA.ownerCookie, "POST", "/stock/movements", { type: "issue", productId: apple, warehouseId: mainA, quantity: "3" });
    expect(await quantityOf(apple)).toBe("7.0000");

    const applied = await api(companyA.ownerCookie, "POST", `/counts/${countId}/apply`);
    expect(applied.statusCode).toBe(200);
    expect(applied.json()).toMatchObject({ adjusted: 1, count: { status: "completed", adjustmentsMade: true } });
    expect(await quantityOf(apple)).toBe("8.0000");
    expect(await quantityOf(pear)).toBe("7.0000");

    const [adjustment] = await db
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.referenceId, countId), eq(stockMovements.type, "count")));
    expect(adjustment).toMatchObject({ quantity: "1.0000", productId: apple });

    expect((await api(companyA.ownerCookie, "POST", `/counts/${countId}/apply`)).statusCode).toBe(400);
    expect((await api(companyA.ownerCookie, "PATCH", `/counts/${countId}/items/${appleItem.id}`, { countedQty: "1" })).statusCode).toBe(400);
  });

  it("qoldig'i yo'q mahsulotni qo'shib sanash qoldiq yaratadi; bekor qilingan hisob qo'llanmaydi", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/catalog/products",
      headers: { cookie: companyA.ownerCookie },
      payload: { name: "Topilma", sku: "TOPILMA", baseUnitId: piece },
    });
    const found = res.json().product.id as string;

    const countId = (await api(companyA.ownerCookie, "POST", "/counts", { warehouseId: mainA, name: "Topilmalar" })).json().count.id;
    const item = await api(companyA.ownerCookie, "POST", `/counts/${countId}/items`, { productId: found });
    expect(item.statusCode).toBe(201);
    expect((await api(companyA.ownerCookie, "POST", `/counts/${countId}/items`, { productId: found })).statusCode).toBe(409);

    await api(companyA.ownerCookie, "PATCH", `/counts/${countId}/items/${item.json().item.id}`, { countedQty: "4" });
    await api(companyA.ownerCookie, "POST", `/counts/${countId}/apply`);
    expect(await quantityOf(found)).toBe("4.0000");

    const cancelledId = (await api(companyA.ownerCookie, "POST", "/counts", { warehouseId: mainA, name: "Bekor" })).json().count.id;
    expect((await api(companyA.ownerCookie, "POST", `/counts/${cancelledId}/status`, { status: "cancelled" })).statusCode).toBe(200);
    expect((await api(companyA.ownerCookie, "POST", `/counts/${cancelledId}/apply`)).statusCode).toBe(400);

    const list = (await api(companyA.ownerCookie, "GET", "/counts?status=cancelled")).json().counts;
    expect(list.map((c: { id: string }) => c.id)).toEqual([cancelledId]);
  });

  it("ruxsatlar: Omborchi (warehouse.count yo'q) hisob ocha olmaydi; Ombor menejeri ocha va qo'llay oladi", async () => {
    await stocked("R-1", "5");
    const omborchi = await addEmployee(app, companyA, "Omborchi");
    const manager = await addEmployee(app, companyA, "Ombor menejeri");

    expect((await api(omborchi.cookie, "POST", "/counts", { warehouseId: mainA, name: "X" })).statusCode).toBe(403);
    const countId = (await api(manager.cookie, "POST", "/counts", { warehouseId: mainA, name: "M" })).json().count.id;
    expect((await api(manager.cookie, "POST", `/counts/${countId}/apply`)).statusCode).toBe(200);
  });
});
