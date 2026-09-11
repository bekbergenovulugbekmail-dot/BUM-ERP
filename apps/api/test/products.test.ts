import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { products, units } from "../src/db/schema/catalog.js";
import { auditLogs } from "../src/db/schema/platform.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let companyA: Company;
let companyB: Company;
let piece: string;

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
  const [unit] = await db.select().from(units).where(eq(units.shortName, "d"));
  piece = unit!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  companyA = await createCompany(app, admin.cookie, { name: "A kompaniya" });
  companyB = await createCompany(app, admin.cookie, { name: "B kompaniya" });
});

const api = (cookie: string, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
  app.inject({ method, url: `/api/catalog${url}`, headers: { cookie }, ...(payload ? { payload } : {}) });

const create = (company: Company, body: Record<string, unknown>) =>
  api(company.ownerCookie, "POST", "/products", { baseUnitId: piece, ...body });

describe("Mahsulot yaratish", () => {
  it("standart qiymatlar, numeric satrlar, audit", async () => {
    const res = await create(companyA, { name: "Olma", sku: "OLMA-1", salesPrice: 12500.5, purchasePrice: "9800" });
    expect(res.statusCode).toBe(201);
    expect(res.json().product).toMatchObject({
      name: "Olma",
      salesPrice: "12500.5000",
      purchasePrice: "9800.0000",
      taxRate: "0.00",
      minStock: "0.0000",
      costingMethod: "average",
      isActive: true,
    });
    expect(res.body).not.toContain("legacyId");
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "PRODUCT_CREATED"))).toHaveLength(1);
  });

  it("SKU kompaniya ichida noyob; begona kategoriya, faol bo'lmagan birlik, FIFO va noto'g'ri narx rad etiladi", async () => {
    expect((await create(companyA, { name: "A", sku: "SKU-1" })).statusCode).toBe(201);
    expect((await create(companyA, { name: "A2", sku: "SKU-1" })).statusCode).toBe(409);
    expect((await create(companyB, { name: "B", sku: "SKU-1" })).statusCode).toBe(201);

    const foreignCategory = (await api(companyB.ownerCookie, "POST", "/categories", { name: "B" })).json().category;
    expect((await create(companyA, { name: "X", sku: "X-1", categoryId: foreignCategory.id })).statusCode).toBe(400);

    await db.update(units).set({ isActive: false }).where(eq(units.shortName, "kg"));
    const [kg] = await db.select().from(units).where(eq(units.shortName, "kg"));
    expect((await create(companyA, { name: "X", sku: "X-2", baseUnitId: kg!.id })).statusCode).toBe(400);

    const fifo = await create(companyA, { name: "X", sku: "X-3", costingMethod: "fifo" });
    expect(fifo.statusCode).toBe(400);
    expect(fifo.json().message).toContain("average");

    expect((await create(companyA, { name: "X", sku: "X-4", salesPrice: "1.23456" })).statusCode).toBe(400);
    expect((await create(companyA, { name: "X", sku: "X-5", salesPrice: -1 })).statusCode).toBe(400);
    expect((await create(companyA, { name: "X", sku: "X-6", imageUrl: "http://evil" })).statusCode).toBe(400);
  });

  it("Kassir yarata olmaydi, lekin ko'ra oladi; HR menejeri ko'ra olmaydi", async () => {
    const kassir = await addEmployee(app, companyA, "Kassir");
    const hr = await addEmployee(app, companyA, "HR menejeri");
    expect((await api(kassir.cookie, "POST", "/products", { name: "X", sku: "K-1", baseUnitId: piece })).statusCode).toBe(403);
    expect((await api(kassir.cookie, "GET", "/products")).statusCode).toBe(200);
    expect((await api(hr.cookie, "GET", "/products")).statusCode).toBe(403);
  });
});

describe("Ro'yxat va qidiruv", () => {
  it("nom bo'yicha kursor bilan to'liq sahifalaydi, qidiradi va kompaniyani ajratadi", async () => {
    for (const name of ["Uzum", "Anor", "Behi", "Olma", "Nok"]) {
      await create(companyA, { name, sku: `SKU-${name}`, barcode: `478${name.length}${name}` });
    }
    await create(companyB, { name: "Begona", sku: "B-1" });

    const names: string[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `/products?limit=2${cursor ? `&cursor=${cursor}` : ""}`;
      const page = (await api(companyA.ownerCookie, "GET", url)).json() as {
        products: { name: string; baseUnitName: string }[];
        nextCursor: string | null;
      };
      names.push(...page.products.map((p) => p.name));
      expect(page.products.every((p) => p.baseUnitName === "d")).toBe(true);
      cursor = page.nextCursor;
    } while (cursor);
    expect(names).toEqual(["Anor", "Behi", "Nok", "Olma", "Uzum"]);

    const bySku = (await api(companyA.ownerCookie, "GET", "/products?search=sku-beh")).json().products;
    expect(bySku.map((p: { name: string }) => p.name)).toEqual(["Behi"]);
    expect((await api(companyA.ownerCookie, "GET", "/products?search=Begona")).json().products).toEqual([]);
    expect((await api(companyA.ownerCookie, "GET", "/products?cursor=buzuq")).statusCode).toBe(400);
  });

  it("shtrix-kod qidiruvi faqat o'z kompaniyasida (Convex xatosi tuzatildi)", async () => {
    const bProduct = (await create(companyB, { name: "B mahsulot", sku: "B-1", barcode: "4780000000001" })).json().product;
    const aProduct = (await create(companyA, { name: "A mahsulot", sku: "A-1", barcode: "4780000000001" })).json().product;

    const aFound = await api(companyA.ownerCookie, "GET", "/products/by-barcode/4780000000001");
    expect(aFound.json().product.id).toBe(aProduct.id);
    const bFound = await api(companyB.ownerCookie, "GET", "/products/by-barcode/4780000000001");
    expect(bFound.json().product.id).toBe(bProduct.id);

    expect((await api(companyA.ownerCookie, "GET", `/products/${bProduct.id}`)).statusCode).toBe(404);
  });
});

describe("Tahrirlash va faolsizlantirish", () => {
  it("PATCH berilmagan maydonlarni tiklamaydi; DELETE faolsizlantiradi", async () => {
    const product = (await create(companyA, { name: "Olma", sku: "O-1", purchasePrice: "9000", salesPrice: "12000" })).json().product;

    const patched = await api(companyA.ownerCookie, "PATCH", `/products/${product.id}`, { salesPrice: "13000" });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().product).toMatchObject({ salesPrice: "13000.0000", purchasePrice: "9000.0000", name: "Olma" });

    const kassir = await addEmployee(app, companyA, "Kassir");
    expect((await api(kassir.cookie, "PATCH", `/products/${product.id}`, { salesPrice: "1" })).statusCode).toBe(403);
    expect((await api(companyB.ownerCookie, "PATCH", `/products/${product.id}`, { salesPrice: "1" })).statusCode).toBe(404);

    expect((await api(companyA.ownerCookie, "DELETE", `/products/${product.id}`)).statusCode).toBe(200);
    const [row] = await db.select().from(products).where(eq(products.id, product.id));
    expect(row!.isActive).toBe(false);
    expect((await api(companyA.ownerCookie, "GET", "/products?isActive=true")).json().products).toEqual([]);
  });
});

describe("Partiyalar", () => {
  it("o'z ombori bilan qo'shiladi; begona ombor va teskari sanalar rad etiladi; muddati yaqinlashganlar ro'yxati", async () => {
    const product = (await create(companyA, { name: "Sut", sku: "SUT-1", trackExpiry: true })).json().product;
    const [ownWarehouse] = await db.select().from(warehouses).where(eq(warehouses.companyId, companyA.companyId));
    const [foreignWarehouse] = await db.select().from(warehouses).where(eq(warehouses.companyId, companyB.companyId));

    const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    const batch = (body: object) => api(companyA.ownerCookie, "POST", `/products/${product.id}/batches`, body);

    const soon = await batch({ batchNumber: "P-1", quantity: "10", unitId: piece, warehouseId: ownWarehouse!.id, expiryDate: inDays(5) });
    expect(soon.statusCode).toBe(201);
    await batch({ batchNumber: "P-2", quantity: "5", unitId: piece, expiryDate: inDays(90) });

    expect((await batch({ batchNumber: "P-3", quantity: "1", unitId: piece, warehouseId: foreignWarehouse!.id })).statusCode).toBe(400);
    expect(
      (await batch({ batchNumber: "P-4", quantity: "1", unitId: piece, manufacturedDate: inDays(10), expiryDate: inDays(1) })).statusCode,
    ).toBe(400);

    const expiring = (await api(companyA.ownerCookie, "GET", "/batches/expiring?daysAhead=30")).json().batches;
    expect(expiring.map((b: { batchNumber: string }) => b.batchNumber)).toEqual(["P-1"]);
    expect(expiring[0]).toMatchObject({ productName: "Sut" });

    const detail = (await api(companyA.ownerCookie, "GET", `/products/${product.id}`)).json().product;
    expect(detail.batches).toHaveLength(2);

    const kassir = await addEmployee(app, companyA, "Kassir");
    expect((await api(kassir.cookie, "POST", `/products/${product.id}/batches`, { batchNumber: "K", quantity: "1", unitId: piece })).statusCode).toBe(403);
  });
});

describe("CSV import va export", () => {
  it("import qatorma-qator xatolar bilan; to'g'ri qatorlar saqlanadi", async () => {
    await create(companyA, { name: "Mavjud", sku: "EXIST-1" });
    await api(companyA.ownerCookie, "POST", "/categories", { name: "Mevalar" });

    const res = await api(companyA.ownerCookie, "POST", "/products/import", {
      rows: [
        { name: "Olma", sku: "IMP-1", unit: "kg", purchasePrice: "12 000,50", salesPrice: 15000, category: "mevalar" },
        { name: "Nok", sku: "IMP-2" },
        { name: "", sku: "IMP-3" },
        { name: "Takror", sku: "EXIST-1" },
        { name: "Fayl ichida takror", sku: "IMP-1" },
        { name: "Noma'lum birlik", sku: "IMP-4", unit: "tonna" },
        { name: "Yomon narx", sku: "IMP-5", salesPrice: "abc" },
      ],
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.created).toBe(2);
    expect(body.errors.map((e: { row: number }) => e.row)).toEqual([3, 4, 5, 6, 7]);

    const [apple] = await db.select().from(products).where(eq(products.sku, "IMP-1"));
    expect(apple).toMatchObject({ purchasePrice: "12000.5000", salesPrice: "15000.0000" });
    expect(apple!.categoryId).not.toBeNull();
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "PRODUCTS_IMPORTED"))).toHaveLength(1);
  });

  it("export: BOM, sarlavha, qo'shtirnoq va formula injection himoyasi", async () => {
    await create(companyA, { name: 'Choy "Ahmad", 100g', sku: "CHOY-1", salesPrice: "25000" });
    await create(companyA, { name: "=HYPERLINK(\"http://evil\")", sku: "EVIL-1" });

    const res = await api(companyA.ownerCookie, "GET", "/products/export");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.body.charCodeAt(0)).toBe(0xfeff);

    const lines = res.body.slice(1).split("\r\n");
    expect(lines[0]).toBe("Nomi,SKU,Shtrix-kod,Kategoriya,Brend,O'lchov birligi,Kirim narxi,Sotuv narxi,Min. qoldiq,Faol");
    expect(lines).toContain('"Choy ""Ahmad"", 100g",CHOY-1,,,,d,0.0000,25000.0000,0.0000,ha');
    expect(lines.some((l) => l.startsWith("\"'=HYPERLINK"))).toBe(true);
  });
});
