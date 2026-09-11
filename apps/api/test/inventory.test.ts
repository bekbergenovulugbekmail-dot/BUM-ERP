import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { stockLevels, stockMovements, warehouses } from "../src/db/schema/inventory.js";
import { auditLogs, companyMembers } from "../src/db/schema/platform.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let companyA: Company;
let companyB: Company;
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
  companyB = await createCompany(app, admin.cookie, { name: "B kompaniya" });
  mainA = (await db.select().from(warehouses).where(eq(warehouses.companyId, companyA.companyId)))[0]!.id;
});

const api = (cookie: string, method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
  app.inject({ method, url: `/api/inventory${url}`, headers: { cookie }, ...(payload ? { payload } : {}) });

async function product(company: Company, sku: string, extra: object = {}) {
  const res = await app.inject({
    method: "POST",
    url: "/api/catalog/products",
    headers: { cookie: company.ownerCookie },
    payload: { name: `Mahsulot ${sku}`, sku, baseUnitId: piece, ...extra },
  });
  return res.json().product.id as string;
}

const move = (cookie: string, body: object) => api(cookie, "POST", "/stock/movements", body);

async function level(productId: string, warehouseId: string) {
  const [row] = await db
    .select()
    .from(stockLevels)
    .where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, warehouseId)));
  return row;
}

describe("Omborlar", () => {
  it("yaratish, bitta asosiy ombor, kod noyobligi, zaxirali omborni faolsizlantirib bo'lmaydi", async () => {
    const second = await api(companyA.ownerCookie, "POST", "/warehouses", { name: "Chilonzor", code: "WH-002", isDefault: true });
    expect(second.statusCode).toBe(201);
    const defaults = await db
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.companyId, companyA.companyId), eq(warehouses.isDefault, true)));
    expect(defaults.map((w) => w.code)).toEqual(["WH-002"]);

    expect((await api(companyA.ownerCookie, "POST", "/warehouses", { name: "X", code: "WH-002" })).statusCode).toBe(409);
    expect((await api(companyA.ownerCookie, "PATCH", `/warehouses/${second.json().warehouse.id}`, { isActive: false })).statusCode).toBe(400);

    const productId = await product(companyA, "P-1");
    await move(companyA.ownerCookie, { type: "receive", productId, warehouseId: mainA, quantity: "5", costPrice: "100" });
    expect((await api(companyA.ownerCookie, "PATCH", `/warehouses/${mainA}`, { isActive: false })).statusCode).toBe(409);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "WAREHOUSE_CREATED"))).toHaveLength(1);
  });

  it("warehouses.manage: Ombor menejeri ombor ocha olmaydi, Direktor ocha oladi; begona ombor 404", async () => {
    const manager = await addEmployee(app, companyA, "Ombor menejeri");
    const direktor = await addEmployee(app, companyA, "Direktor");
    expect((await api(manager.cookie, "POST", "/warehouses", { name: "X", code: "WH-X" })).statusCode).toBe(403);
    expect((await api(direktor.cookie, "POST", "/warehouses", { name: "D", code: "WH-D" })).statusCode).toBe(201);

    const [foreign] = await db.select().from(warehouses).where(eq(warehouses.companyId, companyB.companyId));
    expect((await api(companyA.ownerCookie, "GET", `/warehouses/${foreign!.id}`)).statusCode).toBe(404);
  });
});

describe("Zaxira harakatlari", () => {
  it("kirim AVCO ni hisoblaydi, chiqim o'rtacha tannarxda, yetmasa 400 va hech narsa yozilmaydi", async () => {
    const productId = await product(companyA, "OLMA");
    const base = { productId, warehouseId: mainA };

    expect((await move(companyA.ownerCookie, { ...base, type: "receive", quantity: "10", costPrice: "1000" })).statusCode).toBe(201);
    await move(companyA.ownerCookie, { ...base, type: "receive", quantity: "10", costPrice: "2000" });
    expect(await level(productId, mainA)).toMatchObject({ quantity: "20.0000", avgCostPrice: "1500.0000" });

    const issue = await move(companyA.ownerCookie, { ...base, type: "issue", quantity: "5" });
    expect(issue.json().movement).toMatchObject({ quantity: "-5.0000", costPrice: "1500.0000" });

    const tooMuch = await move(companyA.ownerCookie, { ...base, type: "issue", quantity: "100" });
    expect(tooMuch.statusCode).toBe(400);
    expect(tooMuch.json().message).toContain("Yetarli zaxira");
    expect(await level(productId, mainA)).toMatchObject({ quantity: "15.0000" });
    expect(await db.select().from(stockMovements).where(eq(stockMovements.productId, productId))).toHaveLength(3);

    await move(companyA.ownerCookie, { ...base, type: "adjust", quantity: "-3" });
    await move(companyA.ownerCookie, { ...base, type: "writeoff", quantity: "2" });
    expect(await level(productId, mainA)).toMatchObject({ quantity: "10.0000", avgCostPrice: "1500.0000" });

    expect((await move(companyA.ownerCookie, { ...base, type: "issue", quantity: "-1" })).statusCode).toBe(400);
    expect((await move(companyA.ownerCookie, { ...base, type: "transfer_in", quantity: "1" })).statusCode).toBe(400);
  });

  it("parallel chiqimlar qoldiqni manfiyga tushirmaydi (qator qulfi)", async () => {
    const productId = await product(companyA, "PARALLEL");
    await move(companyA.ownerCookie, { type: "receive", productId, warehouseId: mainA, quantity: "10", costPrice: "10" });

    const results = await Promise.all(
      [1, 2, 3].map(() => move(companyA.ownerCookie, { type: "issue", productId, warehouseId: mainA, quantity: "4" })),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 201, 400]);
    expect(await level(productId, mainA)).toMatchObject({ quantity: "2.0000" });
  });

  it("ruxsatlar: Kassir harakat qila olmaydi, Omborchi kirim qiladi; begona mahsulot/ombor 404", async () => {
    const productId = await product(companyA, "RUXSAT");
    const kassir = await addEmployee(app, companyA, "Kassir");
    const omborchi = await addEmployee(app, companyA, "Omborchi");
    const body = { type: "receive", productId, warehouseId: mainA, quantity: "1", costPrice: "5" };

    expect((await move(kassir.cookie, body)).statusCode).toBe(403);
    expect((await move(omborchi.cookie, body)).statusCode).toBe(201);

    const foreignProduct = await product(companyB, "B-1");
    const [foreignWarehouse] = await db.select().from(warehouses).where(eq(warehouses.companyId, companyB.companyId));
    expect((await move(companyA.ownerCookie, { ...body, productId: foreignProduct })).statusCode).toBe(404);
    expect((await move(companyA.ownerCookie, { ...body, warehouseId: foreignWarehouse!.id })).statusCode).toBe(404);
  });

  it("a'zoning ombor ruxsati: faqat ruxsat etilgan omborda ishlaydi va ko'radi", async () => {
    const second = (await api(companyA.ownerCookie, "POST", "/warehouses", { name: "Ikkinchi", code: "WH-002" })).json().warehouse;
    const productId = await product(companyA, "CHEK");
    const manager = await addEmployee(app, companyA, "Ombor menejeri");
    await db
      .update(companyMembers)
      .set({ allowedWarehouseIds: [mainA] })
      .where(eq(companyMembers.userId, manager.id));

    const body = { type: "receive", productId, quantity: "1", costPrice: "1" };
    expect((await move(manager.cookie, { ...body, warehouseId: mainA })).statusCode).toBe(201);
    expect((await move(manager.cookie, { ...body, warehouseId: second.id })).statusCode).toBe(403);

    const visible = (await api(manager.cookie, "GET", "/warehouses")).json().warehouses as { id: string }[];
    expect(visible.map((w) => w.id)).toEqual([mainA]);
    expect((await api(manager.cookie, "GET", `/stock?warehouseId=${second.id}`)).statusCode).toBe(403);
  });
});

describe("O'tkazmalar", () => {
  it("manba o'rtacha tannarxida o'tkazadi; bir xil ombor va yetmagan miqdor rad etiladi", async () => {
    const second = (await api(companyA.ownerCookie, "POST", "/warehouses", { name: "Ikkinchi", code: "WH-002" })).json().warehouse;
    const productId = await product(companyA, "TRF");
    await move(companyA.ownerCookie, { type: "receive", productId, warehouseId: mainA, quantity: "10", costPrice: "1000" });
    await move(companyA.ownerCookie, { type: "receive", productId, warehouseId: second.id, quantity: "10", costPrice: "4000" });

    const res = await api(companyA.ownerCookie, "POST", "/stock/transfers", {
      productId,
      fromWarehouseId: mainA,
      toWarehouseId: second.id,
      quantity: "10",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().costPrice).toBe("1000.0000");
    expect(await level(productId, mainA)).toMatchObject({ quantity: "0.0000" });
    // (10·4000 + 10·1000) / 20 = 2500
    expect(await level(productId, second.id)).toMatchObject({ quantity: "20.0000", avgCostPrice: "2500.0000" });

    const pair = await db.select().from(stockMovements).where(eq(stockMovements.referenceId, res.json().referenceId));
    expect(pair.map((m) => m.type).sort()).toEqual(["transfer_in", "transfer_out"]);

    const same = { productId, fromWarehouseId: mainA, toWarehouseId: mainA, quantity: "1" };
    expect((await api(companyA.ownerCookie, "POST", "/stock/transfers", same)).statusCode).toBe(400);
    const tooMuch = { productId, fromWarehouseId: second.id, toWarehouseId: mainA, quantity: "999" };
    expect((await api(companyA.ownerCookie, "POST", "/stock/transfers", tooMuch)).statusCode).toBe(400);
    expect(await level(productId, second.id)).toMatchObject({ quantity: "20.0000" });
  });

  it("boshqa o'lchov birligida: miqdor va narx asosiy birlikka o'tadi, o'tkazma sanasi saqlanadi", async () => {
    const box = (await db.select().from(units).where(eq(units.shortName, "qt")))[0]!.id;
    const kg = (await db.select().from(units).where(eq(units.shortName, "kg")))[0]!.id;
    const second = (await api(companyA.ownerCookie, "POST", "/warehouses", { name: "Ikkinchi", code: "WH-002" })).json().warehouse;
    const productId = await product(companyA, "BOX");
    const conversion = await app.inject({
      method: "POST",
      url: "/api/catalog/unit-conversions",
      headers: { cookie: companyA.ownerCookie },
      payload: { fromUnitId: box, toUnitId: piece, factor: "12", productId },
    });
    expect(conversion.statusCode).toBe(201);

    // 2 quti × 12 = 24 dona; quti narxi 24000 → dona narxi 2000
    const received = await move(companyA.ownerCookie, { type: "receive", productId, warehouseId: mainA, quantity: "2", unitId: box, costPrice: "24000" });
    expect(received.statusCode).toBe(201);
    expect(received.json().movement).toMatchObject({ quantity: "24.0000", unitId: piece, costPrice: "2000.0000" });
    expect(await level(productId, mainA)).toMatchObject({ quantity: "24.0000", avgCostPrice: "2000.0000" });

    const occurredAt = "2026-09-01T09:30:00.000Z";
    const transfer = await api(companyA.ownerCookie, "POST", "/stock/transfers", {
      productId,
      fromWarehouseId: mainA,
      toWarehouseId: second.id,
      quantity: "0.5",
      unitId: box,
      occurredAt,
    });
    expect(transfer.statusCode).toBe(201);
    expect(await level(productId, second.id)).toMatchObject({ quantity: "6.0000", avgCostPrice: "2000.0000" });
    const pair = await db.select().from(stockMovements).where(eq(stockMovements.referenceId, transfer.json().referenceId));
    expect(pair.map((m) => m.occurredAt.toISOString())).toEqual([occurredAt, occurredAt]);

    // Asosiy birlikka konversiyasi yo'q birlik — rad, qoldiq o'zgarmaydi
    const noConversion = await move(companyA.ownerCookie, { type: "issue", productId, warehouseId: mainA, quantity: "1", unitId: kg });
    expect(noConversion.statusCode).toBe(400);
    expect(await level(productId, mainA)).toMatchObject({ quantity: "18.0000" });
  });
});

describe("Qoldiq, statistika va harakatlar jurnali", () => {
  it("qoldiq ro'yxati, kam qolganlar, statistika va kursorli jurnal", async () => {
    const low = await product(companyA, "KAM", { minStock: "5" });
    const plenty = await product(companyA, "KOP", { minStock: "1" });
    await move(companyA.ownerCookie, { type: "receive", productId: low, warehouseId: mainA, quantity: "3", costPrice: "100" });
    await move(companyA.ownerCookie, { type: "receive", productId: plenty, warehouseId: mainA, quantity: "50", costPrice: "10" });

    const stock = (await api(companyA.ownerCookie, "GET", `/stock?warehouseId=${mainA}`)).json().stock;
    expect(stock).toHaveLength(2);
    const lowOnly = (await api(companyA.ownerCookie, "GET", `/stock?warehouseId=${mainA}&lowStockOnly=true`)).json().stock;
    expect(lowOnly.map((s: { productSku: string }) => s.productSku)).toEqual(["KAM"]);
    expect(lowOnly[0]).toMatchObject({ isLow: true, availableQty: "3.0000", unitName: "d" });

    const stats = (await api(companyA.ownerCookie, "GET", `/stock/stats?warehouseId=${mainA}`)).json();
    expect(stats).toEqual({ totalValue: "800.00", totalItems: 2, lowStockCount: 1, zeroStockCount: 0 });

    for (let i = 0; i < 3; i++) {
      await move(companyA.ownerCookie, { type: "issue", productId: plenty, warehouseId: mainA, quantity: "1" });
    }
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `/stock/movements?warehouseId=${mainA}&limit=2${cursor ? `&cursor=${cursor}` : ""}`;
      const page = (await api(companyA.ownerCookie, "GET", url)).json() as { movements: { id: string }[]; nextCursor: string | null };
      ids.push(...page.movements.map((m) => m.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(new Set(ids).size).toBe(5);

    const kassir = await addEmployee(app, companyA, "Kassir");
    expect((await api(kassir.cookie, "GET", `/stock?warehouseId=${mainA}`)).statusCode).toBe(200);
    const hr = await addEmployee(app, companyA, "HR menejeri");
    expect((await api(hr.cookie, "GET", `/stock?warehouseId=${mainA}`)).statusCode).toBe(403);
  });
});
