import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PUT";

let app: FastifyInstance;
let adminCookie: string;
let company: Company;
let productId: string;

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
  adminCookie = (await signedIn(app, { isPlatformAdmin: true })).cookie;
  company = await createCompany(app, adminCookie, { name: "Distribyutor" });
  const mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  productId = (
    await call(company.ownerCookie, "POST", "/api/catalog/products", { name: "Coca Cola 1L", sku: "COLA", baseUnitId: piece, salesPrice: "10000", taxRate: "0" })
  ).json().product.id;
  await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", { type: "receive", productId, warehouseId: mainWh, quantity: "100", costPrice: "1000" });
});

async function agent(owner: Company, name: string) {
  const employee = await addEmployee(app, owner, "Sotuv agenti");
  const rep = await call(owner.ownerCookie, "POST", "/api/distribution/sales-reps", { name, userId: employee.id });
  expect(rep.statusCode).toBe(201);
  return { cookie: employee.cookie, repId: rep.json().salesRep.id as string };
}

async function store(owner: Company, name: string) {
  return (await call(owner.ownerCookie, "POST", "/api/sales/customers", { name, latitude: 41.311081, longitude: 69.240562 })).json().customer.id as string;
}

async function route(owner: Company, salesRepId: string, customerIds: string[]) {
  const id = (await call(owner.ownerCookie, "POST", "/api/distribution/routes", { name: `R-${salesRepId.slice(0, 6)}`, salesRepId, days: [0, 1, 2, 3, 4, 5, 6] }))
    .json().route.id as string;
  for (const customerId of customerIds) await call(owner.ownerCookie, "POST", `/api/distribution/routes/${id}/customers`, { customerId });
}

const iso = () => new Date().toISOString();
const near = { latitude: 41.3115, longitude: 69.2406, accuracy: 10 };
const far = { latitude: 41.35, longitude: 69.24, accuracy: 10 };

describe("Sotuv agenti xavfsizligi", () => {
  it("autentifikatsiya, ERP va supervayzer ma'lumotlariga kirish yo'q", async () => {
    const ali = await agent(company, "Ali");
    const vali = await agent(company, "Vali");

    const agentPaths = ["/me", "/today", "/stores", "/catalog", "/orders", "/dashboard", "/promotions", "/prospects", "/visits/current"];
    const supervisorPaths = ["/agents", "/live", "/events", "/visits", "/orders", "/prospects", "/promotions", `/agents/${vali.repId}`, `/agents/${vali.repId}/history`];
    for (const path of [...agentPaths.map((p) => `/api/sales-agent${p}`), ...supervisorPaths.map((p) => `/api/sales-agent/supervisor${p}`)]) {
      expect((await app.inject({ method: "GET", url: path })).statusCode, path).toBe(401);
    }

    // Agent — faqat o'z ish joyi: supervayzer lokatsiya/nazorat ma'lumotlari va ERP API'lari yopiq
    for (const path of supervisorPaths) {
      expect((await call(ali.cookie, "GET", `/api/sales-agent/supervisor${path}`)).statusCode, path).toBe(403);
    }
    expect((await call(ali.cookie, "PUT", "/api/sales-agent/policy", {})).statusCode).toBe(400);
    for (const path of ["/api/finance/accounts", "/api/finance/journal", "/api/finance/dashboard", "/api/sales/orders", "/api/catalog/products", "/api/distribution/routes"]) {
      expect((await call(ali.cookie, "GET", path)).statusCode, path).toBe(403);
    }
    for (const path of agentPaths) expect((await call(ali.cookie, "GET", `/api/sales-agent${path}`)).statusCode, path).toBe(200);
  });

  it("boshqa agent va kompaniya do'koni, buyurtmasi; soxta geofence maydonlari; boshqa agent lokatsiyasi; lokatsiya cheklovi", async () => {
    const ali = await agent(company, "Ali");
    const vali = await agent(company, "Vali");
    const baraka = await store(company, "Baraka");
    const shodlik = await store(company, "Shodlik");
    await route(company, ali.repId, [baraka]);
    await route(company, vali.repId, [shodlik]);

    const other = await createCompany(app, adminCookie, { name: "Boshqa" });
    const bek = await agent(other, "Bek");
    const begona = await store(other, "Begona");
    await route(other, bek.repId, [begona]);

    // Boshqa hudud va boshqa kompaniya do'koni — mavjudligi ham oshkor qilinmaydi
    for (const customerId of [shodlik, begona]) {
      expect((await call(ali.cookie, "GET", `/api/sales-agent/stores/${customerId}`)).statusCode).toBe(404);
      expect(
        (await call(ali.cookie, "PUT", `/api/sales-agent/orders/drafts/${randomUUID()}`, { customerId, items: [{ productId, pieces: "1" }] })).statusCode,
      ).toBe(404);
      expect((await call(ali.cookie, "POST", "/api/sales-agent/visits/start", { customerId, ...near, recordedAt: iso() })).statusCode).toBe(404);
    }
    expect((await call(ali.cookie, "GET", "/api/sales-agent/stores?scope=all")).json().stores.map((s: { name: string }) => s.name)).toEqual(["Baraka"]);

    // Mijoz "ichida"/masofa yuborolmaydi — faqat koordinata; server hisoblaydi
    const order = (
      await call(ali.cookie, "PUT", `/api/sales-agent/orders/drafts/${randomUUID()}`, { customerId: baraka, items: [{ productId, pieces: "1" }] })
    ).json().order;
    const submit = (cookie: string, body: object) => call(cookie, "POST", `/api/sales-agent/orders/${order.id}/submit`, { ...body, recordedAt: iso() });
    expect((await submit(ali.cookie, { ...far, insideGeofence: true })).statusCode).toBe(400);
    expect((await submit(ali.cookie, { ...far, distanceMeters: 5 })).statusCode).toBe(400);
    expect((await submit(ali.cookie, far)).statusCode).toBe(403);
    expect((await call(ali.cookie, "GET", `/api/sales-agent/orders/${order.id}`)).json().order.status).toBe("draft");

    // Boshqa agent va boshqa kompaniya agenti bu buyurtmaga tega olmaydi
    for (const cookie of [vali.cookie, bek.cookie]) {
      expect((await call(cookie, "GET", `/api/sales-agent/orders/${order.id}`)).statusCode).toBe(404);
      expect((await submit(cookie, near)).statusCode).toBe(404);
      expect((await call(cookie, "POST", `/api/sales-agent/orders/${order.id}/cancel`, {})).statusCode).toBe(404);
    }
    expect((await submit(ali.cookie, near)).json().order.status).toBe("confirmed");

    // Boshqa agent nomidan lokatsiya yozib bo'lmaydi (agent faqat sessiyadan)
    expect((await call(ali.cookie, "POST", "/api/sales-agent/location", { ...near, recordedAt: iso(), salesRepId: vali.repId })).statusCode).toBe(400);

    // Lokatsiya: agentdan daqiqasiga 12 nuqta
    const codes: number[] = [];
    for (let i = 0; i < 13; i++) codes.push((await call(ali.cookie, "POST", "/api/sales-agent/location", { ...near, recordedAt: iso() })).statusCode);
    expect(codes.slice(0, 12).every((code) => code === 200)).toBe(true);
    expect(codes[12]).toBe(429);
  });
});
