import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, DEFAULT_ROLES } from "@bum/shared";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let admin: Awaited<ReturnType<typeof signedIn>>;
let company: Awaited<ReturnType<typeof createCompany>>;
let kg: string;

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
  kg = (await db.select().from(units).where(eq(units.shortName, "kg")))[0]!.id;
  admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Go'sht do'koni" });
});

const create = (cookie: string, body: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie }, payload: { baseUnitId: kg, salesPrice: "95000", taxRate: "0", ...body } });
const patch = (cookie: string, id: string, body: Record<string, unknown>) =>
  app.inject({ method: "PATCH", url: `/api/catalog/products/${id}`, headers: { cookie }, payload: body });

describe("Mahsulot: tarozi maydonlari va ruxsatlar", () => {
  it("tortiladigan va PLU: yaratish, kompaniya ichida unikal, oraliq, tahrirlash, kassaga pull", async () => {
    const owner = company.ownerCookie;
    const beef = await create(owner, { name: "Mol go'shti", sku: "BEEF", isWeighted: true, pluCode: 123 });
    expect(beef.statusCode).toBe(201);
    expect(beef.json().product).toMatchObject({ isWeighted: true, pluCode: 123 });
    const beefId = beef.json().product.id as string;

    const taken = await create(owner, { name: "Qo'y go'shti", sku: "LAMB", isWeighted: true, pluCode: 123 });
    expect(taken.statusCode).toBe(400);
    expect(taken.json().message).toContain("PLU 123 band: Mol go'shti");
    expect((await create(owner, { name: "X", sku: "X0", pluCode: 0 })).statusCode).toBe(400);
    expect((await create(owner, { name: "X", sku: "X1", pluCode: 1_000_000 })).statusCode).toBe(400);
    expect((await create(owner, { name: "X", sku: "X2", pluCode: 1.5 })).statusCode).toBe(400);

    // Boshqa kompaniyada shu PLU — mumkin
    const other = await createCompany(app, admin.cookie, { name: "Boshqa" });
    expect((await create(other.ownerCookie, { name: "Mol go'shti", sku: "BEEF", isWeighted: true, pluCode: 123 })).statusCode).toBe(201);

    const lamb = await create(owner, { name: "Qo'y go'shti", sku: "LAMB", isWeighted: true });
    expect(lamb.json().product).toMatchObject({ isWeighted: true, pluCode: null });
    const lambId = lamb.json().product.id as string;
    expect((await patch(owner, lambId, { pluCode: 123 })).statusCode).toBe(400);
    expect((await patch(owner, lambId, { pluCode: 124 })).json().product).toMatchObject({ pluCode: 124 });
    // O'zining PLU'si bilan saqlash — band emas
    expect((await patch(owner, beefId, { name: "Mol go'shti (yumshoq)", pluCode: 123 })).statusCode).toBe(200);
    expect((await create(owner, { name: "Non", sku: "BREAD", baseUnitId: kg })).json().product).toMatchObject({ isWeighted: false, pluCode: null });

    // Kassa: pull'da tortiladigan va PLU; kassir tarozini ko'radi, sozlay olmaydi
    const warehouseId = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
    const registered = await app.inject({
      method: "POST",
      url: "/api/pos-device/setup/register",
      payload: { phone: company.owner.phone, password: company.owner.password, warehouseId, name: "Kassa 1" },
    });
    const token = registered.json().token as string;
    const pulled = await app.inject({ method: "POST", url: "/api/pos-device/pull", headers: { authorization: `Bearer ${token}` }, payload: {} });
    const rows = pulled.json().entities.products.rows as { id: string; isWeighted: boolean; pluCode: number | null }[];
    expect(rows.find((row) => row.id === beefId)).toMatchObject({ isWeighted: true, pluCode: 123 });
    expect(rows.find((row) => row.id === lambId)).toMatchObject({ isWeighted: true, pluCode: 124 });

    const kassir = await addEmployee(app, company, "Kassir");
    const login = await app.inject({
      method: "POST",
      url: "/api/pos-device/cashiers/login",
      headers: { authorization: `Bearer ${token}` },
      // helpers.addEmployee — xodimlar paroli
      payload: { phone: kassir.phone, password: "xodim-parol-123" },
    });
    const permissions = login.json().cashier.permissions as string[];
    expect(permissions).toContain("scale.view");
    expect(permissions).not.toContain("scale.manage");
    expect(permissions).not.toContain("scale.sync");
  });

  it("standart rollar: tarozi ruxsatlari katalogda va kerakli rollarda", () => {
    expect(ALL_PERMISSIONS).toEqual(expect.arrayContaining(["scale.view", "scale.manage", "scale.sync"]));
    const role = (name: string) => DEFAULT_ROLES.find((item) => item.name === name)!.permissions;
    expect(role("Direktor")).toEqual(expect.arrayContaining(["scale.view", "scale.manage", "scale.sync"]));
    expect(role("Ombor menejeri")).toEqual(expect.arrayContaining(["scale.view", "scale.manage", "scale.sync"]));
    expect(role("Savdo menejeri")).toEqual(expect.arrayContaining(["scale.view", "scale.sync"]));
    expect(role("Savdo menejeri")).not.toContain("scale.manage");
    expect(role("Kassir")).toContain("scale.view");
    expect(role("Ko'ruvchi")).toContain("scale.view");
    expect(role("Ko'ruvchi")).not.toContain("scale.manage");
  });
});
