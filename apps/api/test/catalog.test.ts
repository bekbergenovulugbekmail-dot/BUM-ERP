import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { auditLogs } from "../src/db/schema/platform.js";
import { DEFAULT_UNITS, seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let admin: Awaited<ReturnType<typeof signedIn>>;
let companyA: Company;
let companyB: Company;

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
  admin = await signedIn(app, { isPlatformAdmin: true });
  companyA = await createCompany(app, admin.cookie, { name: "A kompaniya" });
  companyB = await createCompany(app, admin.cookie, { name: "B kompaniya" });
});

const api = (cookie: string | undefined, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
  app.inject({
    method,
    url: `/api/catalog${url}`,
    ...(cookie ? { headers: { cookie } } : {}),
    ...(payload ? { payload } : {}),
  });

async function unitId(shortName: string): Promise<string> {
  const [unit] = await db.select().from(units).where(eq(units.shortName, shortName));
  return unit!.id;
}

async function createProduct(company: Company, sku: string) {
  const res = await api(company.ownerCookie, "POST", "/products", { name: `Mahsulot ${sku}`, sku, baseUnitId: await unitId("d") });
  if (res.statusCode !== 201) throw new Error(res.body);
  return res.json().product as { id: string };
}

describe("O'lchov birliklari", () => {
  it("o'qish — har qanday kirgan foydalanuvchi; yozish — faqat platforma admini", async () => {
    expect((await api(undefined, "GET", "/units")).statusCode).toBe(401);
    const list = await api(companyA.ownerCookie, "GET", "/units");
    expect(list.json().units).toHaveLength(DEFAULT_UNITS.length);

    const body = { name: "Karobka", shortName: "krb", isBase: false };
    expect((await api(companyA.ownerCookie, "POST", "/units", body)).statusCode).toBe(403);
    const created = await api(admin.cookie, "POST", "/units", body);
    expect(created.statusCode).toBe(201);
    expect((await api(admin.cookie, "POST", "/units", body)).statusCode).toBe(409);

    const id = created.json().unit.id as string;
    expect((await api(admin.cookie, "PATCH", `/units/${id}`, { isActive: false })).statusCode).toBe(200);
    const names = ((await api(companyA.ownerCookie, "GET", "/units")).json().units as { name: string }[]).map((u) => u.name);
    expect(names).not.toContain("Karobka");
  });

  it("seed takroriy chaqiruvda dublikat yaratmaydi", async () => {
    expect(await seedDefaultUnits(db)).toBe(0);
    expect(await db.select().from(units)).toHaveLength(DEFAULT_UNITS.length);
  });
});

describe("Kategoriyalar", () => {
  it("ichma-ich kategoriya, sikl va begona ota rad etiladi, o'chirish tekshiruvlari", async () => {
    const parent = (await api(companyA.ownerCookie, "POST", "/categories", { name: "Ichimliklar" })).json().category;
    const child = await api(companyA.ownerCookie, "POST", "/categories", { name: "Sharbatlar", parentId: parent.id });
    expect(child.statusCode).toBe(201);
    const childId = child.json().category.id as string;

    const foreign = (await api(companyB.ownerCookie, "POST", "/categories", { name: "B toifa" })).json().category;
    expect((await api(companyA.ownerCookie, "POST", "/categories", { name: "X", parentId: foreign.id })).statusCode).toBe(400);

    // Sikl: otani o'z bolasiga joylashtirish
    expect((await api(companyA.ownerCookie, "PATCH", `/categories/${parent.id}`, { parentId: childId })).statusCode).toBe(400);
    expect((await api(companyA.ownerCookie, "PATCH", `/categories/${parent.id}`, { parentId: parent.id })).statusCode).toBe(400);

    expect((await api(companyA.ownerCookie, "DELETE", `/categories/${parent.id}`)).statusCode).toBe(409);
    expect((await api(companyA.ownerCookie, "DELETE", `/categories/${childId}`)).statusCode).toBe(200);
    expect((await api(companyA.ownerCookie, "DELETE", `/categories/${parent.id}`)).statusCode).toBe(200);

    const bList = (await api(companyB.ownerCookie, "GET", "/categories")).json().categories as { name: string }[];
    expect(bList.map((c) => c.name)).toEqual(["B toifa"]);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "CATEGORY_CREATED"))).toHaveLength(3);
  });

  it("products.manage yo'q — 403; mahsulotli kategoriya o'chmaydi", async () => {
    const kassir = await addEmployee(app, companyA, "Kassir");
    expect((await api(kassir.cookie, "POST", "/categories", { name: "X" })).statusCode).toBe(403);
    expect((await api(kassir.cookie, "GET", "/categories")).statusCode).toBe(200);

    const category = (await api(companyA.ownerCookie, "POST", "/categories", { name: "Non" })).json().category;
    await api(companyA.ownerCookie, "POST", "/products", {
      name: "Non",
      sku: "NON-1",
      baseUnitId: await unitId("d"),
      categoryId: category.id,
    });
    expect((await api(companyA.ownerCookie, "DELETE", `/categories/${category.id}`)).statusCode).toBe(409);
  });
});

describe("Brendlar", () => {
  it("nom takrorlanmaydi, begona brend 404, ishlatilayotgan brend o'chmaydi", async () => {
    const brand = (await api(companyA.ownerCookie, "POST", "/brands", { name: "Coca-Cola" })).json().brand;
    expect((await api(companyA.ownerCookie, "POST", "/brands", { name: "Coca-Cola" })).statusCode).toBe(409);
    expect((await api(companyB.ownerCookie, "POST", "/brands", { name: "Coca-Cola" })).statusCode).toBe(201);
    expect((await api(companyB.ownerCookie, "PATCH", `/brands/${brand.id}`, { name: "Egallandi" })).statusCode).toBe(404);

    const product = await createProduct(companyA, "CC-1");
    await api(companyA.ownerCookie, "PATCH", `/products/${product.id}`, { brandId: brand.id });
    expect((await api(companyA.ownerCookie, "DELETE", `/brands/${brand.id}`)).statusCode).toBe(409);

    const unused = (await api(companyA.ownerCookie, "POST", "/brands", { name: "Pepsi" })).json().brand;
    expect((await api(companyA.ownerCookie, "DELETE", `/brands/${unused.id}`)).statusCode).toBe(200);
  });
});

describe("Birlik konversiyalari", () => {
  it("kompaniyaga tegishli; noto'g'ri koeffitsient, o'ziga konversiya, dublikat va begona mahsulot rad etiladi", async () => {
    const box = await unitId("qt");
    const piece = await unitId("d");
    const body = { fromUnitId: box, toUnitId: piece, factor: "24" };

    const created = await api(companyA.ownerCookie, "POST", "/unit-conversions", body);
    expect(created.statusCode).toBe(201);
    expect(created.json().conversion.factor).toBe("24.0000");

    expect((await api(companyA.ownerCookie, "POST", "/unit-conversions", body)).statusCode).toBe(409);
    expect((await api(companyA.ownerCookie, "POST", "/unit-conversions", { ...body, factor: "0" })).statusCode).toBe(400);
    expect((await api(companyA.ownerCookie, "POST", "/unit-conversions", { ...body, toUnitId: box })).statusCode).toBe(400);

    const foreignProduct = await createProduct(companyB, "B-1");
    expect(
      (await api(companyA.ownerCookie, "POST", "/unit-conversions", { ...body, productId: foreignProduct.id })).statusCode,
    ).toBe(400);

    expect((await api(companyB.ownerCookie, "GET", "/unit-conversions")).json().conversions).toEqual([]);
    const id = created.json().conversion.id as string;
    expect((await api(companyB.ownerCookie, "DELETE", `/unit-conversions/${id}`)).statusCode).toBe(404);
    expect((await api(companyA.ownerCookie, "DELETE", `/unit-conversions/${id}`)).statusCode).toBe(200);
  });
});
