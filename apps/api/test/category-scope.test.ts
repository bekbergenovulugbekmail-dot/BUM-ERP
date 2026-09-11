import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, login, me, resetDatabase, signedIn, uniquePhone } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PATCH" | "DELETE";

let app: FastifyInstance;
let admin: Awaited<ReturnType<typeof signedIn>>;
let company: Company;
let piece: string;
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
  admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Kategoriya cheklovi" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
});

const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

async function ok(cookie: string, method: Method, url: string, payload?: object) {
  const res = await call(cookie, method, url, payload);
  if (res.statusCode >= 300) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body}`);
  return res.json();
}

/** Ichimliklar → Sharbatlar (ichki), Shirinliklar va kategoriyasiz mahsulot; har biri omborda 20 dona. */
async function catalog() {
  const owner = company.ownerCookie;
  const drinks = (await ok(owner, "POST", "/api/catalog/categories", { name: "Ichimliklar" })).category.id as string;
  const juices = (await ok(owner, "POST", "/api/catalog/categories", { name: "Sharbatlar", parentId: drinks })).category.id as string;
  const sweets = (await ok(owner, "POST", "/api/catalog/categories", { name: "Shirinliklar" })).category.id as string;

  const product = async (sku: string, categoryId: string | null) =>
    (
      await ok(owner, "POST", "/api/catalog/products", {
        name: `Mahsulot ${sku}`,
        sku,
        baseUnitId: piece,
        salesPrice: "1000",
        purchasePrice: "600",
        taxRate: "0",
        ...(categoryId ? { categoryId } : {}),
      })
    ).product.id as string;
  const juice = await product("JUICE", juices);
  const candy = await product("CANDY", sweets);
  const loose = await product("LOOSE", null);
  for (const productId of [juice, candy, loose]) {
    await ok(owner, "POST", "/api/inventory/stock/movements", {
      type: "receive",
      productId,
      warehouseId: mainWh,
      quantity: "20",
      costPrice: "600",
    });
  }
  return { drinks, juices, sweets, juice, candy, loose };
}

async function scopedWorker(categoryIds: string[], role = "Direktor") {
  const worker = await addEmployee(app, company, role);
  await ok(company.ownerCookie, "PATCH", `/api/company/employees/${worker.id}`, { allowedCategoryIds: categoryIds });
  return worker;
}

describe("Mas'ul kategoriyalar", () => {
  it("katalog: faqat biriktirilgan kategoriya (ichkilari bilan); boshqasi ko'rinmaydi va o'zgartirilmaydi", async () => {
    const c = await catalog();
    const worker = await scopedWorker([c.drinks]);

    const listed = await ok(worker.cookie, "GET", "/api/catalog/products?limit=50");
    expect(listed.products.map((p: { id: string }) => p.id)).toEqual([c.juice]);
    const categories = await ok(worker.cookie, "GET", "/api/catalog/categories");
    expect(categories.categories.map((x: { id: string }) => x.id).sort()).toEqual([c.drinks, c.juices].sort());
    expect((await call(worker.cookie, "GET", `/api/catalog/products/${c.candy}`)).statusCode).toBe(404);

    const create = (body: object) =>
      call(worker.cookie, "POST", "/api/catalog/products", { name: "Yangi", baseUnitId: piece, ...body });
    expect((await create({ sku: "NEW-1", categoryId: c.sweets })).statusCode).toBe(403);
    expect((await create({ sku: "NEW-2" })).statusCode).toBe(403);
    expect((await create({ sku: "NEW-3", categoryId: c.juices })).statusCode).toBe(201);

    expect((await call(worker.cookie, "PATCH", `/api/catalog/products/${c.candy}`, { name: "O'zgardi" })).statusCode).toBe(403);
    expect((await call(worker.cookie, "PATCH", `/api/catalog/products/${c.juice}`, { categoryId: c.sweets })).statusCode).toBe(403);
    expect((await call(worker.cookie, "PATCH", `/api/catalog/products/${c.juice}`, { name: "Olma sharbati" })).statusCode).toBe(200);
    expect((await call(worker.cookie, "POST", "/api/catalog/categories", { name: "Ildiz" })).statusCode).toBe(403);
    expect((await call(worker.cookie, "POST", "/api/catalog/categories", { name: "Nektarlar", parentId: c.drinks })).statusCode).toBe(201);

    // Egasi va cheklovsiz xodim — hammasini ko'radi
    expect((await ok(company.ownerCookie, "GET", "/api/catalog/products?limit=50")).products).toHaveLength(4);
    const free = await addEmployee(app, company, "Direktor");
    expect((await ok(free.cookie, "GET", "/api/catalog/products?limit=50")).products).toHaveLength(4);
  });

  it("ombor, xarid va savdo: boshqa kategoriya mahsuloti bilan amal rad etiladi, ro'yxatlarda ko'rinmaydi", async () => {
    const c = await catalog();
    const worker = await scopedWorker([c.drinks]);

    const stock = await ok(worker.cookie, "GET", `/api/inventory/stock?warehouseId=${mainWh}`);
    expect(stock.stock.map((s: { productId: string }) => s.productId)).toEqual([c.juice]);
    const history = await ok(worker.cookie, "GET", `/api/inventory/stock/movements?warehouseId=${mainWh}&limit=50`);
    expect([...new Set(history.movements.map((m: { productId: string }) => m.productId))]).toEqual([c.juice]);

    const issue = (productId: string) =>
      call(worker.cookie, "POST", "/api/inventory/stock/movements", { type: "issue", productId, warehouseId: mainWh, quantity: "1" });
    expect((await issue(c.candy)).statusCode).toBe(403);
    expect((await issue(c.loose)).statusCode).toBe(403);
    expect((await issue(c.juice)).statusCode).toBe(201);

    // Inventarizatsiya: xodim ochgan hisobga faqat uning mahsulotlari kiradi
    const count = await ok(worker.cookie, "POST", "/api/inventory/counts", { warehouseId: mainWh, name: "Sharbatlar" });
    const countDetail = await ok(worker.cookie, "GET", `/api/inventory/counts/${count.count.id}`);
    expect(countDetail.count.items.map((i: { productId: string }) => i.productId)).toEqual([c.juice]);

    // Xarid
    const supplier = (await ok(company.ownerCookie, "POST", "/api/purchase/suppliers", { name: "Ta'minotchi", code: "SUP-1" })).supplier.id;
    const purchase = (productId: string) => ({
      supplierId: supplier,
      warehouseId: mainWh,
      orderDate: today,
      items: [{ productId, unitId: piece, orderedQty: "5", unitPrice: "500" }],
    });
    expect((await call(worker.cookie, "POST", "/api/purchase/orders", purchase(c.candy))).statusCode).toBe(403);
    expect((await call(worker.cookie, "POST", "/api/purchase/orders", purchase(c.juice))).statusCode).toBe(201);
    const ownerPurchase = (await ok(company.ownerCookie, "POST", "/api/purchase/orders", purchase(c.candy))).order.id;
    expect((await call(worker.cookie, "GET", `/api/purchase/orders/${ownerPurchase}`)).statusCode).toBe(404);
    const purchases = await ok(worker.cookie, "GET", "/api/purchase/orders");
    expect(purchases.orders.map((o: { id: string }) => o.id)).not.toContain(ownerPurchase);
    expect(purchases.orders).toHaveLength(1);
    expect((await call(worker.cookie, "POST", `/api/purchase/orders/${ownerPurchase}/confirm`)).statusCode).toBe(403);

    // Savdo
    const sale = (productId: string) => ({ warehouseId: mainWh, orderDate: today, items: [{ productId, quantity: "1" }] });
    expect((await call(worker.cookie, "POST", "/api/sales/orders", sale(c.candy))).statusCode).toBe(403);
    expect((await call(worker.cookie, "POST", "/api/sales/orders", sale(c.juice))).statusCode).toBe(201);
    const ownerSale = (await ok(company.ownerCookie, "POST", "/api/sales/orders", sale(c.candy))).order.id;
    await ok(company.ownerCookie, "POST", `/api/sales/orders/${ownerSale}/confirm`);
    expect((await call(worker.cookie, "POST", `/api/sales/orders/${ownerSale}/ship`)).statusCode).toBe(403);
    const sales = await ok(worker.cookie, "GET", "/api/sales/orders");
    expect(sales.orders.map((o: { id: string }) => o.id)).not.toContain(ownerSale);

    // Egasi uchun cheklov yo'q
    expect((await ok(company.ownerCookie, "GET", "/api/purchase/orders")).orders).toHaveLength(2);
  });

  it("egasi xodimning ism, telefon va kategoriyalarini o'zgartiradi; telefon o'zgarsa sessiyalar yopiladi", async () => {
    const c = await catalog();
    const worker = await addEmployee(app, company, "Kassir");
    const newPhone = uniquePhone("97");

    const res = await call(company.ownerCookie, "PATCH", `/api/company/employees/${worker.id}`, {
      name: "Yangi ism",
      phone: newPhone,
      allowedCategoryIds: [c.sweets],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().member.allowedCategoryIds).toEqual([c.sweets]);

    expect((await me(app, worker.cookie)).statusCode).toBe(401);
    expect((await login(app, worker.phone, "xodim-parol-123")).res.statusCode).toBe(401);
    const relogin = await login(app, newPhone, "xodim-parol-123");
    expect(relogin.res.statusCode).toBe(200);
    expect(relogin.res.json().user.name).toBe("Yangi ism");

    const listed = (await ok(company.ownerCookie, "GET", "/api/company/employees")).employees.find(
      (e: { id: string }) => e.id === worker.id,
    );
    expect(listed).toMatchObject({ name: "Yangi ism", phone: newPhone, allowedCategoryIds: [c.sweets] });

    const patch = (body: object, cookie = company.ownerCookie) =>
      call(cookie, "PATCH", `/api/company/employees/${worker.id}`, body);
    expect((await patch({ phone: company.owner.phone })).statusCode).toBe(409);
    expect((await patch({ phone: "123" })).statusCode).toBe(400);

    const other = await createCompany(app, admin.cookie, { name: "Boshqa" });
    const foreign = (await ok(other.ownerCookie, "POST", "/api/catalog/categories", { name: "Begona" })).category.id;
    expect((await patch({ allowedCategoryIds: [foreign] })).statusCode).toBe(400);

    // Xodim o'z ruxsatlarini o'zi o'zgartira olmaydi; kategoriyani olib tashlash — cheklov yo'qoladi
    expect((await patch({ allowedCategoryIds: [] }, relogin.cookie!)).statusCode).toBe(403);
    expect((await patch({ allowedCategoryIds: [] })).statusCode).toBe(200);
  });
});
