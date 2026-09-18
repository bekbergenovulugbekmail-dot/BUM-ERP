import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { auditLogs, roles } from "../src/db/schema/platform.js";
import { customerPayments, customers } from "../src/db/schema/sales.js";
import { customerPhotos } from "../src/db/schema/sales-agent.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { todayIso } from "../src/modules/finance/cash.service.js";
import { buildServer } from "../src/server.js";
import { LEGACY_VISIT_POLICY, setAgentPolicy } from "./agent-policy.js";
import { addEmployee, createCompany, resetDatabase, signedIn, salesRepOf } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PUT" | "PATCH";

let app: FastifyInstance;
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
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Distribyutor" });
  await setAgentPolicy(company.companyId, LEGACY_VISIT_POLICY);
  const mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  productId = (
    await call(company.ownerCookie, "POST", "/api/catalog/products", { name: "Coca Cola 1L", sku: "COLA", baseUnitId: piece, salesPrice: "10000", taxRate: "0" })
  ).json().product.id;
  await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", { type: "receive", productId, warehouseId: mainWh, quantity: "100", costPrice: "1000" });
});

const iso = () => new Date().toISOString();
const shop = { latitude: 41.311081, longitude: 69.240562 };
const near = { latitude: 41.3115, longitude: 69.2406 };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(256, 3)]);
const actionCount = (action: string) => db.$count(auditLogs, eq(auditLogs.action, action));

async function agent(name: string) {
  const employee = await addEmployee(app, company, "Sotuv agenti");
  const repId = await salesRepOf(app, company.ownerCookie, employee.id, { name });
  expect((await call(employee.cookie, "POST", "/api/sales-agent/work-session/start", { ...near, accuracy: 10, recordedAt: iso() })).statusCode).toBe(201);
  return { cookie: employee.cookie, repId: repId };
}

async function customerOnRoute(salesRepId: string, body: object) {
  const customerId = (await call(company.ownerCookie, "POST", "/api/sales/customers", body)).json().customer.id as string;
  const routeId = (
    await call(company.ownerCookie, "POST", "/api/distribution/routes", { name: `R-${randomUUID().slice(0, 6)}`, salesRepId, days: [0, 1, 2, 3, 4, 5, 6] })
  ).json().route.id as string;
  await call(company.ownerCookie, "POST", `/api/distribution/routes/${routeId}/customers`, { customerId });
  return customerId;
}

describe("Mijozlar bo'limi", () => {
  it("tarix va o'rtachalar; aloqa ma'lumotlarini tahrirlash — faqat o'z mijozi, moliyaviy maydonlarsiz, ruxsat bilan", async () => {
    const ali = await agent("Ali");
    const vali = await agent("Vali");
    const baraka = await customerOnRoute(ali.repId, { name: "Baraka", ...shop });

    for (const pieces of ["2", "4"]) {
      const order = (await call(ali.cookie, "PUT", `/api/sales-agent/orders/drafts/${randomUUID()}`, { customerId: baraka, items: [{ productId, pieces }] })).json()
        .order;
      expect((await call(ali.cookie, "POST", `/api/sales-agent/orders/${order.id}/submit`, { ...near, accuracy: 10, recordedAt: iso() })).statusCode).toBe(200);
    }
    await db.insert(customerPayments).values({ companyId: company.companyId, customerId: baraka, amount: "15000", paymentDate: todayIso() });

    const history = await call(ali.cookie, "GET", `/api/sales-agent/customers/${baraka}/history`);
    expect(history.statusCode).toBe(200);
    expect(history.json().stats).toMatchObject({
      orderCount: 2,
      myOrderCount: 2,
      salesTotal: "60000.00",
      averageOrder: "30000.00",
      averageIntervalDays: 0,
      paymentsTotal: "15000.00",
      lastPaymentDate: todayIso(),
      visitCount: 0,
    });
    expect(history.json().orders.every((order: { byMe: boolean }) => order.byMe)).toBe(true);
    expect(history.json().payments).toHaveLength(1);
    expect((await call(vali.cookie, "GET", `/api/sales-agent/customers/${baraka}/history`)).statusCode).toBe(404);

    const patch = (cookie: string, body: object) => call(cookie, "PATCH", `/api/sales-agent/customers/${baraka}`, body);
    const updated = await patch(ali.cookie, { contactName: "Akmal", phone: "+998901112233", address: "Chilonzor 5", notes: "" });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().store).toMatchObject({ contactName: "Akmal", phone: "+998901112233", address: "Chilonzor 5" });
    expect((await db.select({ notes: customers.notes }).from(customers).where(eq(customers.id, baraka)))[0]!.notes).toBeNull();
    expect((await patch(ali.cookie, { creditLimit: "99999999" })).statusCode).toBe(400);
    expect((await patch(vali.cookie, { contactName: "Begona" })).statusCode).toBe(404);
    expect(await actionCount("CUSTOMER_UPDATED")).toBe(1);

    // Kompaniya ruxsatni olib qo'ysa — 403
    await db
      .update(roles)
      .set({ permissions: ["sales_agent.use"] })
      .where(and(eq(roles.companyId, company.companyId), eq(roles.name, "Sotuv agenti")));
    expect((await patch(ali.cookie, { contactName: "Boshqa" })).statusCode).toBe(403);
    expect((await call(ali.cookie, "PUT", `/api/sales-agent/customers/${baraka}/location`, { ...near, accuracy: 10, recordedAt: iso() })).statusCode).toBe(403);
  });

  it("joylashuv faqat mijoz yonida va ish vaqtida; vitrina rasmi (kamera, hududda, oxirgi 5 tasi)", async () => {
    const ali = await agent("Ali");
    const vali = await agent("Vali");
    const mega = await customerOnRoute(ali.repId, { name: "Mega" });
    const locate = (point: object, accuracy = 10) =>
      call(ali.cookie, "PUT", `/api/sales-agent/customers/${mega}/location`, { ...point, accuracy, recordedAt: iso() });

    expect((await locate(near, 500)).json().details).toEqual({ reason: "low_accuracy" });
    const first = await locate(near);
    expect(first.statusCode).toBe(200);
    expect(first.json().store).toMatchObject({ latitude: "41.311500", longitude: "69.240600" });
    // Mavjud koordinatadan uzoqda — rad; yonida aniqlashtirish — mumkin
    const far = await locate({ latitude: 41.317, longitude: 69.2406 });
    expect(far.statusCode).toBe(403);
    expect(far.json().details).toMatchObject({ reason: "geofence" });
    expect((await locate({ latitude: 41.31175, longitude: 69.2406 })).statusCode).toBe(200);
    expect(await actionCount("CUSTOMER_LOCATION_UPDATE")).toBe(2);
    expect((await call(vali.cookie, "PUT", `/api/sales-agent/customers/${mega}/location`, { ...near, accuracy: 10, recordedAt: iso() })).statusCode).toBe(404);

    const photo = (point: object, data: Buffer = JPEG) =>
      call(ali.cookie, "POST", `/api/sales-agent/customers/${mega}/photo`, { ...point, accuracy: 10, recordedAt: iso(), contentType: "image/jpeg", data: data.toString("base64") });
    expect((await photo({ latitude: 41.317, longitude: 69.2406 })).statusCode).toBe(403);
    expect((await photo(near, Buffer.from("not an image at all"))).json().details).toEqual({ reason: "photo_invalid" });
    for (let i = 0; i < 6; i++) expect((await photo(near)).statusCode).toBe(201);
    expect(await db.$count(customerPhotos, eq(customerPhotos.customerId, mega))).toBe(5);

    expect((await call(ali.cookie, "GET", `/api/sales-agent/customers/${mega}/history`)).json().photo).not.toBeNull();
    const image = await call(ali.cookie, "GET", `/api/sales-agent/customers/${mega}/photo`);
    expect(image.statusCode).toBe(200);
    expect(image.headers["content-type"]).toBe("image/jpeg");
    expect((await call(vali.cookie, "GET", `/api/sales-agent/customers/${mega}/photo`)).statusCode).toBe(404);

    // Ish vaqti tugagach joylashuv saqlanmaydi
    expect((await call(ali.cookie, "POST", "/api/sales-agent/work-session/end", {})).statusCode).toBe(200);
    expect((await locate(near)).statusCode).toBe(409);
  });
});
