import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { products, units } from "../src/db/schema/catalog.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { posSyncConflicts } from "../src/db/schema/pos.js";
import { suppliers } from "../src/db/schema/purchase.js";
import { customers } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PATCH";
type PushResult = { opId: string | null; status: string; result?: Record<string, unknown>; error?: { code: string; message: string; details?: unknown } };

let app: FastifyInstance;
let company: Company;
let piece: string;
let mainWarehouseId: string;

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
  const adminCookie = (await signedIn(app, { isPlatformAdmin: true })).cookie;
  company = await createCompany(app, adminCookie, { name: "Bonnu" });
  mainWarehouseId = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
});

const web = (method: Method, url: string, payload?: object) => app.inject({ method, url, headers: { cookie: company.ownerCookie }, ...(payload ? { payload } : {}) });
const device = (token: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });

async function register() {
  const res = await app.inject({
    method: "POST",
    url: "/api/pos-device/setup/register",
    payload: { phone: company.owner.phone, password: company.owner.password, warehouseId: mainWarehouseId, name: "Kassa 1" },
  });
  expect(res.statusCode).toBe(201);
  const token = (res.json() as { token: string }).token;
  // Ega kassada parol bilan kiradi — qurilma amallari faqat shu qurilmaga bog'langan kassir nomidan qabul qilinadi
  const login = await app.inject({ method: "POST", url: "/api/pos-device/cashiers/login", headers: { authorization: `Bearer ${token}` }, payload: { phone: company.owner.phone, password: company.owner.password } });
  expect(login.statusCode, login.body).toBe(200);
  return token;
}

async function push(token: string, ops: object[]) {
  const res = await device(token, "POST", "/api/pos-device/push", { ops });
  expect(res.statusCode).toBe(200);
  return res.json().results as PushResult[];
}

const op = (type: string, cashierId: string, payload: object) => ({ opId: randomUUID(), type, cashierId, createdAt: new Date(Date.now() - 60_000).toISOString(), payload });

describe("Desktop kassa: ma'lumotnomalar — jismoniy/yuridik shaxslar va narxlar sinxroni", () => {
  it("mijoz: rekvizitlar bilan yaratish, maydon bo'yicha birlashtirish (web o'zgartirgani saqlanadi), web va pull'da yangi maydonlar", async () => {
    const token = await register();
    const owner = company.owner.id;
    const created = await web("POST", "/api/sales/customers", { name: "Vali", phone: "+998901234567" });
    expect(created.statusCode).toBe(201);
    const vali = created.json().customer as { id: string; partyType: string };
    expect(vali.partyType).toBe("individual");

    const legalId = randomUUID();
    const [legal] = await push(token, [
      op("customer.create", owner, { customerId: legalId, name: "MChJ Rizo", phone: null, partyType: "legal", taxId: "302345678", bankAccount: "20208000900123456001", bankMfo: "00873" }),
    ]);
    expect(legal).toMatchObject({ status: "applied" });
    expect((await db.select().from(customers).where(eq(customers.id, legalId)))[0]).toMatchObject({ partyType: "legal", taxId: "302345678", bankMfo: "00873" });

    // Birinchi tahrir: ikkala maydon qurilma ko'rgan holatda — yoziladi
    const [first] = await push(token, [
      op("customer.update", owner, { customerId: vali.id, changes: { phone: { from: "+998901234567", to: "+998901234599" }, address: { from: null, to: "Chilonzor" } } }),
    ]);
    expect(first).toMatchObject({ status: "applied", result: { applied: ["phone", "address"], skipped: [], conflicts: [] } });

    // Orada web manzilni o'zgartirdi; kassa eski manzildan tahrirladi — manzil server qiymatida qoladi, email yoziladi
    expect((await web("PATCH", `/api/sales/customers/${vali.id}`, { address: "Yunusobod", partyType: "legal", bankMfo: "00444" })).statusCode).toBe(200);
    const [second] = await push(token, [
      op("customer.update", owner, { customerId: vali.id, changes: { address: { from: "Chilonzor", to: "Sergeli" }, email: { from: null, to: "vali@bonnu.uz" } } }),
    ]);
    expect(second).toMatchObject({ status: "applied", result: { applied: ["email"], skipped: ["address"], conflicts: ["record_changed"] } });
    expect((await db.select().from(customers).where(eq(customers.id, vali.id)))[0]).toMatchObject({ address: "Yunusobod", email: "vali@bonnu.uz", partyType: "legal", bankMfo: "00444" });
    const [conflict] = await db.select().from(posSyncConflicts).where(eq(posSyncConflicts.kind, "record_changed"));
    expect(conflict).toMatchObject({ referenceType: "customer", referenceId: vali.id, details: { fields: [{ field: "address", base: "Chilonzor", device: "Sergeli", server: "Yunusobod" }] } });

    // Allaqachon shu qiymat — hech narsa; bo'sh o'zgarish va ruxsatsiz kassir — rad
    const kassir = await addEmployee(app, company, "Kassir");
    const rest = await push(token, [
      op("customer.update", owner, { customerId: vali.id, changes: { email: { from: null, to: "vali@bonnu.uz" } } }),
      op("customer.update", owner, { customerId: vali.id, changes: {} }),
      op("customer.update", kassir.id, { customerId: vali.id, changes: { notes: { from: null, to: "x" } } }),
    ]);
    expect(rest[0]).toMatchObject({ status: "applied", result: { applied: [], skipped: [] } });
    expect(rest.slice(1).map((row) => row.error?.code)).toEqual(["BAD_REQUEST", "FORBIDDEN"]);

    const pulled = await device(token, "POST", "/api/pos-device/pull", {});
    expect(pulled.json().entities.customers.rows).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: vali.id, partyType: "legal", email: "vali@bonnu.uz", bankMfo: "00444", address: "Yunusobod" })]),
    );
  });

  it("ta'minotchi va narxlar: jismoniy shaxs ta'minotchi, narxni birlashtirish (4 kasrli taqqoslash), majburiy narx, ruxsatlar, pull", async () => {
    const token = await register();
    const owner = company.owner.id;
    const supplierId = randomUUID();
    const [createdSupplier] = await push(token, [
      op("supplier.create", owner, { supplierId, name: "Karim aka", phone: "+998931112233", partyType: "individual", contactPerson: "Karim" }),
    ]);
    expect(createdSupplier).toMatchObject({ status: "applied" });
    expect((await db.select().from(suppliers).where(eq(suppliers.id, supplierId)))[0]).toMatchObject({ partyType: "individual", contactPerson: "Karim" });
    const [supplierEdit] = await push(token, [op("supplier.update", owner, { supplierId, changes: { bankMfo: { from: null, to: "00444" }, taxId: { from: null, to: "512345678" } } })]);
    expect(supplierEdit).toMatchObject({ status: "applied", result: { applied: ["taxId", "bankMfo"], conflicts: [] } });

    const productRes = await web("POST", "/api/catalog/products", { name: "Cola", sku: "COLA", baseUnitId: piece, salesPrice: "10000", purchasePrice: "7000", taxRate: "0" });
    expect(productRes.statusCode).toBe(201);
    const productId = productRes.json().product.id as string;

    const [priced] = await push(token, [
      op("product.prices", owner, { productId, changes: { salesPrice: { from: "10000.0000", to: "12000" }, wholesalePrice: { from: null, to: "11000" } } }),
    ]);
    expect(priced).toMatchObject({ status: "applied", result: { applied: ["salesPrice", "wholesalePrice"], conflicts: [] } });
    expect((await db.select().from(products).where(eq(products.id, productId)))[0]).toMatchObject({ salesPrice: "12000.0000", wholesalePrice: "11000.0000" });

    // Boshqa kassa eski narxdan o'zgartirdi — server narxi qoladi; sotuv narxini bo'shatib bo'lmaydi
    const stale = await push(token, [
      op("product.prices", owner, { productId, changes: { salesPrice: { from: "10000", to: "13000" }, retailPrice: { from: null, to: "12500" } } }),
      op("product.prices", owner, { productId, changes: { salesPrice: { from: "12000", to: null } } }),
    ]);
    expect(stale[0]).toMatchObject({ status: "applied", result: { applied: ["retailPrice"], skipped: ["salesPrice"], conflicts: ["record_changed"] } });
    expect(stale[1]).toMatchObject({ status: "rejected", error: { code: "BAD_REQUEST" } });
    expect((await db.select().from(products).where(eq(products.id, productId)))[0]).toMatchObject({ salesPrice: "12000.0000", retailPrice: "12500.0000" });

    const kassir = await addEmployee(app, company, "Kassir");
    const denied = await push(token, [
      op("product.prices", kassir.id, { productId, changes: { salesPrice: { from: "12000", to: "1" } } }),
      op("supplier.update", kassir.id, { supplierId, changes: { notes: { from: null, to: "x" } } }),
    ]);
    expect(denied.map((row) => row.error?.code)).toEqual(["FORBIDDEN", "FORBIDDEN"]);

    const pulled = await device(token, "POST", "/api/pos-device/pull", {});
    expect(pulled.json().entities.suppliers.rows).toEqual([expect.objectContaining({ id: supplierId, partyType: "individual", bankMfo: "00444", taxId: "512345678" })]);
    expect(pulled.json().entities.products.rows[0]).toMatchObject({ salesPrice: "12000.0000", wholesalePrice: "11000.0000", retailPrice: "12500.0000" });

    // Web: ta'minotchi rekvizitlari
    const webSupplier = await web("POST", "/api/purchase/suppliers", { name: "MChJ Olma", partyType: "legal", taxId: "301111111", bankAccount: "20208000100000000001", bankMfo: "00873" });
    expect(webSupplier.statusCode).toBe(201);
    expect(webSupplier.json().supplier).toMatchObject({ partyType: "legal", bankMfo: "00873" });
  });
});
