/**
 * Agent KPI yagona manbadan: agent ilovasi, agent hisoboti va rahbar paneli bir xil raqamni ko'rsatadi.
 *
 * Maydondagi tashrif — `agent_visits` (agent ilovasi shunga yozadi). `route_visits` — marshrut-kun
 * jurnali (qo'lda kiritiladi, boshqa granularlik) va KPI manbai EMAS: u yozilgani rahbar panelidagi
 * tashriflar sonini oshirmasligi kerak.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { agentVisits } from "../src/db/schema/sales-agent.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { salesOrders } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { todayIso } from "../src/modules/finance/cash.service.js";
import { buildServer } from "../src/server.js";
import { setAgentPolicy } from "./agent-policy.js";
import { addEmployee, createCompany, resetDatabase, salesRepOf, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PUT" | "PATCH";

let app: FastifyInstance;
let company: Company;
let other: Company;
let productId: string;

const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

const iso = () => new Date().toISOString();
const near = { latitude: 41.3115, longitude: 69.2406, accuracy: 10 };
const shop = { latitude: 41.311081, longitude: 69.240562 };
const monthStart = () => `${todayIso().slice(0, 7)}-01`;

type Agent = Awaited<ReturnType<typeof makeAgent>>;

async function makeAgent(name: string, stores: number) {
  const employee = await addEmployee(app, company, "Sotuv agenti");
  const repId = await salesRepOf(app, company.ownerCookie, employee.id, { name });
  expect((await call(employee.cookie, "POST", "/api/sales-agent/work-session/start", { ...near, recordedAt: iso() })).statusCode).toBe(201);

  const routeId = (
    await call(company.ownerCookie, "POST", "/api/distribution/routes", { name: `R-${name}`, salesRepId: repId, days: [0, 1, 2, 3, 4, 5, 6] })
  ).json().route.id as string;
  const customerIds: string[] = [];
  for (let index = 0; index < stores; index += 1) {
    const customerId = (
      await call(company.ownerCookie, "POST", "/api/sales/customers", { name: `${name}-do'kon-${index + 1}`, ...shop })
    ).json().customer.id as string;
    expect((await call(company.ownerCookie, "POST", `/api/distribution/routes/${routeId}/customers`, { customerId })).statusCode).toBe(201);
    customerIds.push(customerId);
  }

  /** Tashrif → buyurtma: tashrif "ordered" bilan yopiladi. */
  const visitWithOrder = async (customerId: string, pieces: string) => {
    const visit = (await call(employee.cookie, "POST", "/api/sales-agent/visits/start", { customerId, ...near, recordedAt: iso() })).json().visit;
    const order = (
      await call(employee.cookie, "PUT", `/api/sales-agent/orders/drafts/${randomUUID()}`, {
        customerId,
        paymentType: "cash",
        items: [{ productId, pieces }],
      })
    ).json().order;
    const sent = await call(employee.cookie, "POST", `/api/sales-agent/orders/${order.id}/submit`, { ...near, recordedAt: iso() });
    expect(sent.statusCode, sent.body).toBe(200);
    return { visitId: visit.id as string, orderId: order.id as string };
  };

  /** Buyurtmasiz tashrif: sabab bilan yopiladi. */
  const visitWithoutOrder = async (customerId: string) => {
    const visit = (await call(employee.cookie, "POST", "/api/sales-agent/visits/start", { customerId, ...near, recordedAt: iso() })).json().visit;
    const done = await call(employee.cookie, "POST", `/api/sales-agent/visits/${visit.id}/complete`, {
      ...near,
      recordedAt: iso(),
      noOrderReason: "has_stock",
    });
    expect(done.statusCode, done.body).toBe(200);
    return visit.id as string;
  };

  return { cookie: employee.cookie, repId, routeId, customerIds, visitWithOrder, visitWithoutOrder };
}

/** Bazadagi haqiqat — hisobotlar shunga teng bo'lishi kerak. */
async function dbKpi(salesRepId: string) {
  const [visits] = await db
    .select({
      completed: sql<number>`(count(*) filter (where ${agentVisits.status} = 'completed'))::int`,
      ordered: sql<number>`(count(*) filter (where ${agentVisits.result} = 'ordered'))::int`,
      noOrder: sql<number>`(count(*) filter (where ${agentVisits.result} = 'no_order'))::int`,
    })
    .from(agentVisits)
    .where(and(eq(agentVisits.salesRepId, salesRepId), sql`${agentVisits.visitDate} >= ${monthStart()}::date`));
  const [sales] = await db.execute<{ total: string; orders: number }>(sql`
    select coalesce(sum(o."total_amount"), 0)::numeric(18,2)::text as total, count(*)::int as orders
      from "agent_orders" a join "sales_orders" o on o."id" = a."order_id"
     where a."sales_rep_id" = ${salesRepId} and a."submitted_at" is not null
       and o."status" in ('confirmed', 'completed', 'shipped', 'delivered')
       and o."order_date" >= ${monthStart()}::date`).then((result) => result.rows);
  return { ...visits!, total: sales!.total, orders: sales!.orders };
}

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
  await resetDatabase();
  await db.delete(units);
  await seedDefaultUnits(db);
  const piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "KPI-DISTRIBUTOR" });
  other = await createCompany(app, admin.cookie, { name: "KPI-OUTSIDER" });
  // Rasm va minimal vaqt bu testda tekshirilmaydi (ular `sales-agent-visit-flow` da), lekin buyurtma
  // TASHRIF ichida yuboriladi — KPI aynan shu oqimdan hisoblanadi
  await setAgentPolicy(company.companyId, { minVisitMinutes: 0, storefrontPhotoRequired: false, shelfPhotoRequired: false });
  const mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  productId = (
    await call(company.ownerCookie, "POST", "/api/catalog/products", { name: "Cola 1L", sku: "COLA", baseUnitId: piece, salesPrice: "10000", taxRate: "0" })
  ).json().product.id;
  expect(
    (await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", {
      type: "receive",
      productId,
      warehouseId: mainWh,
      quantity: "1000",
      costPrice: "6000",
    })).statusCode,
  ).toBe(201);
}, 120_000);

afterAll(async () => {
  await app.close();
  await closeDb();
});

describe("Agent KPI — bitta manba (agent_visits + agent_orders)", () => {
  let ali: Agent;
  let vali: Agent;

  it("ikki agent, ikki marshrut: tashrif va buyurtmalar yoziladi", async () => {
    ali = await makeAgent("Ali", 3);
    vali = await makeAgent("Vali", 2);

    // Ali: 2 buyurtmali tashrif + 1 buyurtmasiz
    await ali.visitWithOrder(ali.customerIds[0]!, "5");
    await ali.visitWithOrder(ali.customerIds[1]!, "3");
    await ali.visitWithoutOrder(ali.customerIds[2]!);

    // Vali: 1 buyurtmali tashrif + 1 buyurtmasiz
    await vali.visitWithOrder(vali.customerIds[0]!, "10");
    await vali.visitWithoutOrder(vali.customerIds[1]!);

    const fromDb = await dbKpi(ali.repId);
    expect(fromDb).toMatchObject({ completed: 3, ordered: 2, noOrder: 1, orders: 2, total: "80000.00" });
  });

  it("agent hisoboti = rahbar paneli = baza", async () => {
    const today = todayIso();
    for (const agent of [ali, vali]) {
      const expected = await dbKpi(agent.repId);

      const report = (await call(agent.cookie, "GET", `/api/sales-agent/reports?from=${monthStart()}&to=${today}`)).json();
      expect(report.visits, "agent hisoboti: tashriflar").toMatchObject({
        total: expected.completed,
        ordered: expected.ordered,
        noOrder: expected.noOrder,
      });
      expect(report.sales, "agent hisoboti: savdo").toMatchObject({ orderCount: expected.orders, total: expected.total });

      const stats = (await call(company.ownerCookie, "GET", "/api/distribution/sales-reps/stats")).json().salesReps as Record<string, unknown>[];
      const row = stats.find((item) => item.id === agent.repId)!;
      expect(row, "rahbar paneli = baza").toMatchObject({
        visitsThisMonth: expected.completed,
        orderedVisitsThisMonth: expected.ordered,
        noOrderVisitsThisMonth: expected.noOrder,
        ordersThisMonth: expected.orders,
        visitSalesThisMonth: expected.total,
      });
    }
  });

  it("agent bosh sahifasi ham shu manbadan — tashrif qilingan do'konlar mos", async () => {
    const dashboard = (await call(ali.cookie, "GET", "/api/sales-agent/dashboard")).json();
    const [todayVisits] = await db
      .select({ stores: sql<number>`count(distinct ${agentVisits.customerId})::int` })
      .from(agentVisits)
      .where(and(eq(agentVisits.salesRepId, ali.repId), eq(agentVisits.visitDate, todayIso())));
    expect(dashboard.today.visitedStores, "bosh sahifa = agent_visits").toBe(todayVisits!.stores);
    expect(dashboard.month.achieved, "oylik savdo = baza").toBe((await dbKpi(ali.repId)).total);
  });

  it("marshrut-kun jurnali (route_visits) KPI ni o'zgartirmaydi", async () => {
    const before = (await call(company.ownerCookie, "GET", "/api/distribution/sales-reps/stats")).json().salesReps as { id: string; visitsThisMonth: number }[];
    const beforeAli = before.find((row) => row.id === ali.repId)!.visitsThisMonth;

    const created = await call(company.ownerCookie, "POST", "/api/distribution/visits", {
      routeId: ali.routeId,
      salesRepId: ali.repId,
      visitDate: todayIso(),
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(
      (await call(company.ownerCookie, "PATCH", `/api/distribution/visits/${created.json().visit.id}`, {
        status: "completed",
        customersVisited: 3,
        ordersCreated: 3,
        totalAmount: "9999999.00",
      })).statusCode,
    ).toBe(200);

    const after = (await call(company.ownerCookie, "GET", "/api/distribution/sales-reps/stats")).json().salesReps as
      { id: string; visitsThisMonth: number; visitSalesThisMonth: string }[];
    const afterAli = after.find((row) => row.id === ali.repId)!;
    expect(afterAli.visitsThisMonth, "qo'lda jurnal maydon KPI sini shishirmaydi").toBe(beforeAli);
    expect(afterAli.visitSalesThisMonth).toBe((await dbKpi(ali.repId)).total);
  });

  it("boshqa tenant agent ma'lumotini ko'rmaydi", async () => {
    const foreign = (await call(other.ownerCookie, "GET", "/api/distribution/sales-reps/stats")).json().salesReps as unknown[];
    expect(foreign, "begona kompaniyada agent yo'q").toHaveLength(0);
    expect((await call(other.ownerCookie, "GET", "/api/sales-agent/reports")).statusCode, "agent bo'lmagan foydalanuvchi").toBeGreaterThanOrEqual(400);
  });

  it("agent boshqa agentning tashrifini va do'konini ko'rmaydi", async () => {
    const stores = (await call(ali.cookie, "GET", "/api/sales-agent/stores?scope=all&limit=100")).json().stores as { id: string }[];
    expect(stores.map((row) => row.id).sort()).toEqual([...ali.customerIds].sort());

    const visits = (await call(vali.cookie, "GET", `/api/sales-agent/visits?date=${todayIso()}`)).json().visits as { customerId: string }[];
    expect(visits.every((row) => vali.customerIds.includes(row.customerId)), "faqat o'z tashriflari").toBe(true);

    const [foreignOrder] = await db
      .select({ id: salesOrders.id })
      .from(salesOrders)
      .where(and(eq(salesOrders.companyId, company.companyId), eq(salesOrders.customerId, ali.customerIds[0]!)))
      .limit(1);
    expect((await call(vali.cookie, "GET", `/api/sales-agent/orders/${foreignOrder!.id}`)).statusCode).toBe(404);
  });
});
