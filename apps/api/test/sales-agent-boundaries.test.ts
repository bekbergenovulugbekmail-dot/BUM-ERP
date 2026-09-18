import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { journalEntries } from "../src/db/schema/finance.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { customers } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { LEGACY_VISIT_POLICY, setAgentPolicy } from "./agent-policy.js";
import { addEmployee, createCompany, resetDatabase, signedIn, salesRepOf } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PUT" | "PATCH";

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
  await setAgentPolicy(company.companyId, LEGACY_VISIT_POLICY);
  const mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  productId = (
    await call(company.ownerCookie, "POST", "/api/catalog/products", { name: "Coca Cola 1L", sku: "COLA", baseUnitId: piece, salesPrice: "10000", taxRate: "0" })
  ).json().product.id;
  await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", { type: "receive", productId, warehouseId: mainWh, quantity: "100", costPrice: "1000" });
});

/** Server bilan bir xil Yer radiusi — meridian bo'ylab `meters` shimolga nuqta (haversine aynan shu masofani beradi). */
const EARTH_RADIUS_M = 6_371_008.8;
const shop = { latitude: 41.311081, longitude: 69.240562 };
const northOf = (meters: number) => ({ latitude: shop.latitude + (meters / EARTH_RADIUS_M) * (180 / Math.PI), longitude: shop.longitude });
const iso = (secondsAgo = 0) => new Date(Date.now() - secondsAgo * 1000).toISOString();

async function agent(owner: Company, name: string) {
  const employee = await addEmployee(app, owner, "Sotuv agenti");
  const repId = await salesRepOf(app, owner.ownerCookie, employee.id, { name });
  expect((await call(employee.cookie, "POST", "/api/sales-agent/work-session/start", { ...northOf(10), accuracy: 10, recordedAt: iso() })).statusCode).toBe(201);
  const customerId = (await call(owner.ownerCookie, "POST", "/api/sales/customers", { name: `${name} do'koni`, ...shop })).json().customer.id as string;
  const routeId = (await call(owner.ownerCookie, "POST", "/api/distribution/routes", { name: `R-${name}`, salesRepId: repId, days: [0, 1, 2, 3, 4, 5, 6] })).json()
    .route.id as string;
  await call(owner.ownerCookie, "POST", `/api/distribution/routes/${routeId}/customers`, { customerId });
  return { cookie: employee.cookie, repId, customerId };
}

describe("Sotuv agenti: chegaralar, xavfsizlik va buxgalteriya", () => {
  it("geofence 200 m: 199 va 200 m — ruxsat, 201 m — rad (tashrif va buyurtma); eskirgan va aniqligi past joy — rad", async () => {
    const ali = await agent(company, "Ali");
    const start = (meters: number, extra: object = {}) =>
      call(ali.cookie, "POST", "/api/sales-agent/visits/start", { customerId: ali.customerId, ...northOf(meters), accuracy: 10, recordedAt: iso(), ...extra });
    const close = (visitId: string) =>
      call(ali.cookie, "POST", `/api/sales-agent/visits/${visitId}/complete`, { ...northOf(10), accuracy: 10, recordedAt: iso(), noOrderReason: "has_stock" });

    const denied = await start(201);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().details).toEqual({ reason: "geofence", distanceMeters: 201, radiusMeters: 200 });
    for (const meters of [199, 200]) {
      const allowed = await start(meters);
      expect(allowed.statusCode, `${meters} m`).toBe(201);
      expect(allowed.json().visit.startDistanceMeters).toBe(meters);
      expect((await close(allowed.json().visit.id)).statusCode).toBe(200);
    }
    // Eskirgan (siyosat — 120 s) va aniqligi past (siyosat — 100 m) joy — qayta aniqlash talab qilinadi
    expect((await start(50, { recordedAt: iso(600) })).json().details).toEqual({ reason: "stale" });
    expect((await start(50, { accuracy: 500 })).json().details).toEqual({ reason: "low_accuracy" });

    const order = (await call(ali.cookie, "PUT", `/api/sales-agent/orders/drafts/${randomUUID()}`, { customerId: ali.customerId, items: [{ productId, pieces: "1" }] }))
      .json().order;
    const submit = (meters: number, extra: object = {}) =>
      call(ali.cookie, "POST", `/api/sales-agent/orders/${order.id}/submit`, { ...northOf(meters), accuracy: 10, recordedAt: iso(), ...extra });
    // Mijoz yuborgan masofa yoki "ichida" belgisi qabul qilinmaydi
    expect((await submit(201, { distanceMeters: 10 })).statusCode).toBe(400);
    expect((await submit(201, { insideGeofence: true })).statusCode).toBe(400);
    expect((await submit(50, { recordedAt: iso(600) })).json().details).toEqual({ reason: "stale" });
    expect((await submit(201)).json().details).toEqual({ reason: "geofence", distanceMeters: 201, radiusMeters: 200 });
    const sent = await submit(200);
    expect(sent.statusCode).toBe(200);
    expect(sent.json().order).toMatchObject({ status: "confirmed", submitDistanceMeters: 200 });
  });

  it("xavfsizlik: HR, admin va moliya API'lari; soxta companyId/agentId; boshqa agent va kompaniya ma'lumoti", async () => {
    const ali = await agent(company, "Ali");
    const vali = await agent(company, "Vali");
    const other = await createCompany(app, adminCookie, { name: "Boshqa" });
    const bek = await agent(other, "Bek");

    for (const url of ["/api/hr/employees", "/api/finance/journal", "/api/finance/accounts", "/api/platform/companies", "/api/platform/users"]) {
      expect((await call(ali.cookie, "GET", url)).statusCode, url).toBe(403);
    }

    // Boshqa agentning va boshqa kompaniyaning mijozi, tarixi, lokatsiya tarixi — ko'rinmaydi
    for (const customerId of [vali.customerId, bek.customerId]) {
      expect((await call(ali.cookie, "GET", `/api/sales-agent/customers/${customerId}/history`)).statusCode).toBe(404);
      expect((await call(ali.cookie, "PATCH", `/api/sales-agent/customers/${customerId}`, { contactName: "X" })).statusCode).toBe(404);
    }
    expect((await call(ali.cookie, "GET", `/api/sales-agent/supervisor/agents/${vali.repId}/history`)).statusCode).toBe(403);
    expect((await call(ali.cookie, "GET", "/api/sales-agent/team")).statusCode).toBe(403);

    // Soxta companyId/agentId: so'rovda e'tiborsiz (sessiyadagi agent va kompaniya), tanada — 400
    const foreignOrders = (await call(ali.cookie, "GET", `/api/sales-agent/orders?companyId=${other.companyId}&salesRepId=${bek.repId}`)).json().orders;
    expect(foreignOrders).toEqual([]);
    expect((await call(ali.cookie, "GET", `/api/sales-agent/reports?agentId=${vali.repId}&companyId=${other.companyId}`)).json().sales.orderCount).toBe(0);
    for (const extra of [{ companyId: other.companyId }, { salesRepId: vali.repId }, { agentId: vali.repId }]) {
      expect(
        (await call(ali.cookie, "PUT", `/api/sales-agent/orders/drafts/${randomUUID()}`, { customerId: ali.customerId, items: [{ productId, pieces: "1" }], ...extra }))
          .statusCode,
      ).toBe(400);
    }
    expect((await call(ali.cookie, "POST", "/api/sales-agent/location", { ...northOf(10), accuracy: 10, recordedAt: iso(), companyId: other.companyId })).statusCode).toBe(400);
  });

  it("buxgalteriya: agentning nasiya buyurtmasi mavjud jo'natish oqimida — bitta qarz va bitta jurnal yozuvi, takror jo'natish yo'q", async () => {
    const ali = await agent(company, "Ali");
    const dueDate = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const order = (
      await call(ali.cookie, "PUT", `/api/sales-agent/orders/drafts/${randomUUID()}`, {
        customerId: ali.customerId,
        paymentType: "credit",
        paymentDueDate: dueDate,
        items: [{ productId, pieces: "3" }],
      })
    ).json().order;
    const submit = () => call(ali.cookie, "POST", `/api/sales-agent/orders/${order.id}/submit`, { ...northOf(20), accuracy: 10, recordedAt: iso() });
    expect((await submit()).json().order).toMatchObject({ status: "confirmed", totalAmount: "30000.00" });
    // Takroriy yuborish yangi buyurtma yoki qarz yaratmaydi
    expect((await submit()).json().order.id).toBe(order.id);
    expect((await db.select({ debt: customers.totalDebt }).from(customers).where(eq(customers.id, ali.customerId)))[0]!.debt).toBe("0.00");

    // Jo'natish — mavjud savdo oqimi (ombor chiqimi, qarz, jurnal)
    const ship = () => call(company.ownerCookie, "POST", `/api/sales/orders/${order.id}/ship`, {});
    expect((await ship()).statusCode).toBe(200);
    expect((await ship()).statusCode).not.toBe(200);
    expect((await db.select({ debt: customers.totalDebt }).from(customers).where(eq(customers.id, ali.customerId)))[0]!.debt).toBe("30000.00");
    const entries = await db
      .select({ id: journalEntries.id, totalDebit: journalEntries.totalDebit, totalCredit: journalEntries.totalCredit })
      .from(journalEntries)
      .where(and(eq(journalEntries.companyId, company.companyId), eq(journalEntries.referenceId, order.id)));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.totalDebit).toBe(entries[0]!.totalCredit);
  });
});
