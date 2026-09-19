/**
 * TANNARX VA NARX TAKLIFLARI.
 *
 * Ikki talab bir vaqtda tekshiriladi:
 *   1) narx tavsiyasi MAVJUD hujjatlardan (xarid/sotuv tarixidan) olinadi — parallel narx tizimi yo'q;
 *   2) tannarx `products.view_cost` ruxsatiga bog'langan — kassir uni hatto API orqali ham ko'rmaydi.
 */
import { eq, ne } from "drizzle-orm";
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
let other: Company;
let piece: string;
let box: string;
let mainWh: string;

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
  box = (await db.select().from(units).where(ne(units.shortName, "d")))[0]!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Tannarx kompaniyasi" });
  other = await createCompany(app, admin.cookie, { name: "Begona kompaniya" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
});

const call = (cookie: string, method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const owner = (method: "GET" | "POST" | "PATCH", url: string, payload?: object) => call(company.ownerCookie, method, url, payload);

let seq = 0;

async function product(extra: object = {}, at: Company = company) {
  seq += 1;
  const res = await call(at.ownerCookie, "POST", "/api/catalog/products", {
    name: `Mahsulot ${seq}`,
    sku: `SKU-${seq}`,
    baseUnitId: piece,
    salesPrice: "10000",
    ...extra,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().product.id as string;
}

async function supplier(name: string, at: Company = company) {
  const res = await call(at.ownerCookie, "POST", "/api/purchase/suppliers", { name });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().supplier.id as string;
}

/** To'liq xarid tsikli: buyurtma → tasdiq → qabul (faqat kelgan tovar narx tarixiga kiradi). */
async function purchased(
  input: { productId: string; unitId?: string; qty: string; unitPrice: string; supplierId: string; orderDate?: string },
  at: Company = company,
) {
  const warehouseId = at === company ? mainWh : (await db.select().from(warehouses).where(eq(warehouses.companyId, at.companyId)))[0]!.id;
  const created = await call(at.ownerCookie, "POST", "/api/purchase/orders", {
    supplierId: input.supplierId,
    warehouseId,
    orderDate: input.orderDate ?? today,
    items: [{ productId: input.productId, unitId: input.unitId ?? piece, orderedQty: input.qty, unitPrice: input.unitPrice }],
  });
  expect(created.statusCode, created.body).toBe(201);
  const orderId = created.json().order.id as string;
  expect((await call(at.ownerCookie, "POST", `/api/purchase/orders/${orderId}/confirm`)).statusCode).toBe(200);
  const itemId = created.json().order.items[0].id as string;
  const receipt = await call(at.ownerCookie, "POST", `/api/purchase/orders/${orderId}/receipts`, {
    items: [{ orderItemId: itemId, receivedQty: input.qty }],
  });
  expect(receipt.statusCode, receipt.body).toBe(201);
  return orderId;
}

/** Yakunlangan savdo — "oldingi sotuv narxi" manbai. */
async function sold(productId: string, quantity: string, unitPrice: string) {
  const buyer = await owner("POST", "/api/sales/customers", { name: `Mijoz ${(seq += 1)}` });
  expect(buyer.statusCode, buyer.body).toBe(201);
  const created = await owner("POST", "/api/sales/orders", {
    customerId: buyer.json().customer.id,
    warehouseId: mainWh,
    orderDate: today,
    items: [{ productId, quantity, unitPrice }],
  });
  expect(created.statusCode, created.body).toBe(201);
  const orderId = created.json().order.id as string;
  expect((await owner("POST", `/api/sales/orders/${orderId}/confirm`)).statusCode).toBe(200);
  const shipped = await owner("POST", `/api/sales/orders/${orderId}/ship`);
  expect(shipped.statusCode, shipped.body).toBe(200);
  expect(shipped.json().order.status).toBe("completed");
}

const suggest = (productId: string, query = "", cookie = company.ownerCookie) =>
  call(cookie, "GET", `/api/catalog/products/${productId}/price-suggestions${query}`);

describe("Narx tavsiyalari", () => {
  it("oxirgi xarid narxi, sanasi, ta'minotchisi va o'rtacha xarid narxi tarixdan olinadi", async () => {
    const p = await product();
    const eski = await supplier("Eski ta'minotchi");
    const yangi = await supplier("Yangi ta'minotchi");
    // 10 dona × 1000 (eski sana) va 30 dona × 1400 (bugun) → (10000 + 42000) / 40 = 1300
    await purchased({ productId: p, qty: "10", unitPrice: "1000", supplierId: eski, orderDate: "2026-01-05" });
    await purchased({ productId: p, qty: "30", unitPrice: "1400", supplierId: yangi });
    await sold(p, "2", "2500");

    const res = await suggest(p);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      lastPurchase: { price: "1400.0000", date: today, supplierName: "Yangi ta'minotchi" },
      avgPurchasePrice: "1300.0000",
      lastSalesPrice: "2500.0000",
      currentSalesPrice: "10000.0000",
    });
  });

  it("xarid qilinmagan mahsulotda tavsiya bo'sh bo'ladi (nol yoki taxmin emas)", async () => {
    const res = await suggest(await product());
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ lastPurchase: null, avgPurchasePrice: null, lastSalesPrice: null });
  });

  it("qoralama va bekor qilingan buyurtma narx tavsiyasiga kirmaydi", async () => {
    const p = await product();
    const supplierId = await supplier("Qoralama ta'minotchi");
    const draft = await owner("POST", "/api/purchase/orders", {
      supplierId,
      warehouseId: mainWh,
      orderDate: today,
      items: [{ productId: p, unitId: piece, orderedQty: "5", unitPrice: "9999" }],
    });
    expect(draft.statusCode, draft.body).toBe(201);

    expect((await suggest(p)).json().lastPurchase, "tovar kelmagan — narx yo'q").toBeNull();
  });

  it("qutida xarid dona narxiga keltiriladi, so'ralgan birlikka qaytariladi", async () => {
    const p = await product();
    expect(
      (await owner("POST", "/api/catalog/unit-conversions", { fromUnitId: box, toUnitId: piece, factor: "12", productId: p })).statusCode,
    ).toBe(201);
    // 2 quti × 120000 = 240000 / 24 dona = 10000 dona narxi
    await purchased({ productId: p, unitId: box, qty: "2", unitPrice: "120000", supplierId: await supplier("Quti ta'minotchi") });

    const perPiece = await suggest(p);
    expect(perPiece.json()).toMatchObject({ lastPurchase: { price: "10000.0000" }, avgPurchasePrice: "10000.0000" });

    const perBox = await suggest(p, `?unitId=${box}`);
    expect(perBox.json()).toMatchObject({ unitId: box, lastPurchase: { price: "120000.0000" }, avgPurchasePrice: "120000.0000" });
  });

  it("boshqa biznesning xaridi tavsiyaga ta'sir qilmaydi, begona mahsulot 404", async () => {
    const mine = await product();
    const theirs = await product({}, other);
    await purchased(
      { productId: theirs, qty: "5", unitPrice: "777000", supplierId: await supplier("Begona ta'minotchi", other) },
      other,
    );

    expect((await suggest(mine)).json().lastPurchase, "o'z tarixim bo'sh").toBeNull();
    expect((await suggest(theirs)).statusCode, "begona mahsulot ko'rinmaydi").toBe(404);
  });
});

describe("Tannarx ruxsati", () => {
  it("kassir kirim narxini ro'yxatda, kartochkada va CSV eksportda ko'rmaydi", async () => {
    const p = await product({ purchasePrice: "6000" });
    const kassir = await addEmployee(app, company, "Kassir");

    const list = await call(kassir.cookie, "GET", "/api/catalog/products");
    expect(list.statusCode).toBe(200);
    const row = (list.json().products as { id: string; purchasePrice?: string; salesPrice: string }[]).find((item) => item.id === p)!;
    expect(row.purchasePrice, "tannarx yuborilmaydi").toBeUndefined();
    expect(row.salesPrice, "sotuv narxi ko'rinadi").toBe("10000.0000");

    const card = await call(kassir.cookie, "GET", `/api/catalog/products/${p}`);
    expect(card.statusCode).toBe(200);
    expect(card.json().product.purchasePrice).toBeUndefined();

    const csv = await call(kassir.cookie, "GET", "/api/catalog/products/export");
    expect(csv.statusCode).toBe(200);
    expect(csv.body, "CSV da kirim narxi ustuni yo'q").not.toContain("Kirim narxi");
    expect(csv.body).not.toContain("6000.0000");
  });

  it("kassirga tannarx va narx tavsiyasi endpointlari 403 qaytaradi", async () => {
    const p = await product();
    const kassir = await addEmployee(app, company, "Kassir");
    expect((await call(kassir.cookie, "GET", "/api/catalog/products/costs")).statusCode).toBe(403);
    expect((await suggest(p, "", kassir.cookie)).statusCode).toBe(403);
  });

  it("omborchi tannarxni ko'radi (rolga ruxsat berilgan)", async () => {
    const p = await product({ purchasePrice: "6000" });
    const omborchi = await addEmployee(app, company, "Omborchi");
    const list = await call(omborchi.cookie, "GET", "/api/catalog/products");
    const row = (list.json().products as { id: string; purchasePrice?: string }[]).find((item) => item.id === p)!;
    expect(row.purchasePrice).toBe("6000.0000");
    expect((await call(omborchi.cookie, "GET", "/api/catalog/products/costs")).statusCode).toBe(200);
  });
});

describe("Tannarx ro'yxati", () => {
  it("o'rtacha tannarx, oxirgi xarid va marja ko'rsatiladi", async () => {
    const p = await product({ salesPrice: "2000" });
    await purchased({ productId: p, qty: "10", unitPrice: "1000", supplierId: await supplier("Ta'minotchi") });

    const res = await owner("GET", "/api/catalog/products/costs");
    expect(res.statusCode, res.body).toBe(200);
    const row = (res.json().products as { id: string; avgCost: string | null; lastPurchasePrice: string | null; lastPurchaseDate: string | null; marginPercent: string | null }[]).find(
      (item) => item.id === p,
    )!;
    expect(row).toMatchObject({ lastPurchasePrice: "1000.0000", lastPurchaseDate: today });
    expect(row.avgCost, "qabuldan keyin AVCO shakllanadi").toBe("1000.0000");
    // (2000 − 1000) / 2000 = 50%
    expect(row.marginPercent).toBe("50.00");
  });

  it("ro'yxatda faqat o'z biznesining mahsulotlari bo'ladi", async () => {
    const mine = await product();
    const theirs = await product({}, other);
    const ids = (await owner("GET", "/api/catalog/products/costs")).json().products.map((row: { id: string }) => row.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
  });
});
