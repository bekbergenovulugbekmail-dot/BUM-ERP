import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { customerPayments, customers } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { todayIso } from "../src/modules/finance/cash.service.js";
import { buildServer } from "../src/server.js";
import { fromMinor } from "../src/shared/decimal.js";
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
  await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", {
    type: "receive",
    productId,
    warehouseId: mainWh,
    quantity: "500",
    costPrice: "1000",
  });
});

async function agent(name: string, monthlyTarget = "0") {
  const employee = await addEmployee(app, company, "Sotuv agenti");
  const rep = await call(company.ownerCookie, "POST", "/api/distribution/sales-reps", { name, userId: employee.id, monthlyTarget });
  expect(rep.statusCode).toBe(201);
  expect(
    (await call(employee.cookie, "POST", "/api/sales-agent/work-session/start", { latitude: 41.3115, longitude: 69.2406, accuracy: 10, recordedAt: new Date().toISOString() }))
      .statusCode,
  ).toBe(201);
  return { cookie: employee.cookie, repId: rep.json().salesRep.id as string };
}

async function store(name: string, latitude: number) {
  return (await call(company.ownerCookie, "POST", "/api/sales/customers", { name, latitude, longitude: 69.240562 })).json().customer.id as string;
}

async function route(salesRepId: string, customerIds: string[]) {
  const id = (await call(company.ownerCookie, "POST", "/api/distribution/routes", { name: `Marshrut ${salesRepId.slice(0, 4)}`, salesRepId, days: [0, 1, 2, 3, 4, 5, 6] }))
    .json().route.id as string;
  for (const customerId of customerIds) await call(company.ownerCookie, "POST", `/api/distribution/routes/${id}/customers`, { customerId });
  return id;
}

const iso = () => new Date().toISOString();
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

async function sell(cookie: string, customerId: string, latitude: number, pieces: string, paymentType = "cash") {
  const order = (
    await call(cookie, "PUT", `/api/sales-agent/orders/drafts/${randomUUID()}`, {
      customerId,
      paymentType,
      paymentDueDate: paymentType === "credit" ? shift(todayIso(), 3) : null,
      items: [{ productId, pieces }],
    })
  ).json().order;
  const sent = await call(cookie, "POST", `/api/sales-agent/orders/${order.id}/submit`, { latitude, longitude: 69.2406, accuracy: 10, recordedAt: iso() });
  expect(sent.statusCode).toBe(200);
  return order.id as string;
}

describe("Agent bosh sahifasi, yangi mijozlar va supervayzer tafsiloti", () => {
  it("bugungi savdo, nasiya, yig'ilgan to'lov, tashriflar, oylik plan va o'rin serverda hisoblanadi", async () => {
    const ali = await agent("Ali", "1000000");
    const vali = await agent("Vali");
    const baraka = await store("Baraka", 41.311081);
    const mega = await store("Mega", 41.321081);
    const shodlik = await store("Shodlik", 41.331081);
    await route(ali.repId, [baraka, mega]);
    await route(vali.repId, [shodlik]);

    const visit = (
      await call(ali.cookie, "POST", "/api/sales-agent/visits/start", { customerId: baraka, latitude: 41.3115, longitude: 69.2406, accuracy: 10, recordedAt: iso() })
    ).json().visit;
    const cashOrder = await sell(ali.cookie, baraka, 41.3115, "20");
    await sell(ali.cookie, baraka, 41.3115, "10", "credit");
    expect(
      (await call(ali.cookie, "POST", `/api/sales-agent/visits/${visit.id}/complete`, { latitude: 41.3115, longitude: 69.2406, accuracy: 10, recordedAt: iso() }))
        .json().visit.result,
    ).toBe("ordered");
    await sell(vali.cookie, shodlik, 41.3315, "50");
    await db.insert(customerPayments).values({ companyId: company.companyId, customerId: baraka, orderId: cashOrder, amount: "50000", paymentDate: todayIso() });

    await call(ali.cookie, "POST", "/api/sales-agent/prospects", { name: "Yangi Market" });

    const res = await call(ali.cookie, "GET", "/api/sales-agent/dashboard");
    expect(res.statusCode).toBe(200);
    const data = res.json();
    const today = todayIso();
    const remainingDays =
      new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate() - Number(today.slice(8, 10)) + 1;
    expect(data.today).toEqual({
      salesAmount: "300000.00",
      orderCount: 2,
      creditSalesAmount: "100000.00",
      collectedAmount: "50000.00",
      plannedStores: 2,
      visitedStores: 1,
      orderedStores: 1,
      remainingStores: 1,
      dailyTarget: fromMinor(100000000n / BigInt(remainingDays)),
      remainingToday: fromMinor(
        100000000n / BigInt(remainingDays) > 30000000n ? 100000000n / BigInt(remainingDays) - 30000000n : 0n,
      ),
    });
    expect(data.month).toEqual({
      target: "1000000.00",
      achieved: "300000.00",
      percent: 30,
      remaining: "700000.00",
      remainingDays,
      requiredDaily: fromMinor(70000000n / BigInt(remainingDays)),
      orderCount: 2,
      bestDay: { date: today, amount: "300000.00" },
    });
    expect(data.rank).toEqual({ position: 2, total: 2 });
    expect(data.prospectsThisMonth).toBe(1);
    expect((await call(vali.cookie, "GET", "/api/sales-agent/dashboard")).json().rank).toEqual({ position: 1, total: 2 });
  });

  it("yangi mijoz: agent yuboradi, supervayzer mijozga aylantiradi (marshrutga) yoki rad etadi; agent tafsiloti", async () => {
    const ali = await agent("Ali");
    const vali = await agent("Vali");
    const baraka = await store("Baraka", 41.311081);
    const mega = await store("Mega", 41.321081);
    const aliRoute = await route(ali.repId, [baraka, mega]);
    const supervisor = await addEmployee(app, company, "Supervayzer");

    const create = (cookie: string, body: object) => call(cookie, "POST", "/api/sales-agent/prospects", body);
    expect((await create(ali.cookie, { name: "Yarim", latitude: 41.3 })).statusCode).toBe(400);
    const kassir = await addEmployee(app, company, "Kassir");
    expect((await create(kassir.cookie, { name: "Kassir do'koni" })).statusCode).toBe(403);

    const created = await create(ali.cookie, {
      name: "Yangi Market",
      phone: "+998901234567",
      address: "Chilonzor 1",
      comment: "Egasi ertaga keladi",
      latitude: 41.32,
      longitude: 69.25,
      accuracy: 20,
    });
    expect(created.statusCode).toBe(201);
    const prospect = created.json().prospect;
    expect(prospect).toMatchObject({ status: "new", salesRepName: "Ali", latitude: "41.320000" });
    const second = (await create(ali.cookie, { name: "Kichik do'kon" })).json().prospect;
    expect((await call(ali.cookie, "GET", "/api/sales-agent/prospects")).json().prospects).toHaveLength(2);
    expect((await call(vali.cookie, "GET", "/api/sales-agent/prospects")).json().prospects).toEqual([]);

    expect((await call(ali.cookie, "GET", "/api/sales-agent/supervisor/prospects")).statusCode).toBe(403);
    expect((await call(supervisor.cookie, "GET", "/api/sales-agent/supervisor/prospects?status=new")).json().prospects).toHaveLength(2);

    const converted = await call(supervisor.cookie, "POST", `/api/sales-agent/supervisor/prospects/${prospect.id}/convert`, { routeId: aliRoute });
    expect(converted.statusCode).toBe(200);
    const customerId = converted.json().customerId as string;
    expect(converted.json().prospect).toMatchObject({ status: "converted", customerId });
    const [customer] = await db.select().from(customers).where(eq(customers.id, customerId));
    expect(customer).toMatchObject({ name: "Yangi Market", phone: "+998901234567", latitude: "41.320000", notes: "Egasi ertaga keladi" });
    const aliStores = (await call(ali.cookie, "GET", "/api/sales-agent/stores?scope=all")).json().stores;
    expect(aliStores.map((s: { name: string }) => s.name)).toContain("Yangi Market");
    expect((await call(supervisor.cookie, "POST", `/api/sales-agent/supervisor/prospects/${prospect.id}/convert`, {})).statusCode).toBe(409);

    const rejected = await call(supervisor.cookie, "POST", `/api/sales-agent/supervisor/prospects/${second.id}/reject`, { reason: "Hududdan tashqarida" });
    expect(rejected.json().prospect).toMatchObject({ status: "rejected", rejectionReason: "Hududdan tashqarida" });

    // Agent tafsiloti: bugungi do'konlar va tashrif holati, savdo
    const visit = (
      await call(ali.cookie, "POST", "/api/sales-agent/visits/start", { customerId: baraka, latitude: 41.3115, longitude: 69.2406, accuracy: 10, recordedAt: iso() })
    ).json().visit;
    await sell(ali.cookie, baraka, 41.3115, "5");
    const detail = await call(supervisor.cookie, "GET", `/api/sales-agent/supervisor/agents/${ali.repId}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      agent: { id: ali.repId, name: "Ali" },
      currentVisit: { id: visit.id, customerName: "Baraka" },
      today: { salesAmount: "50000.00", orderCount: 1, visitsCompleted: 0, visitsRemaining: 3 },
    });
    expect(detail.json().stores.map((s: { name: string; visitStatus: string }) => [s.name, s.visitStatus]).sort()).toEqual([
      ["Baraka", "in_progress"],
      ["Mega", "waiting"],
      ["Yangi Market", "waiting"],
    ]);

    const viewer = await addEmployee(app, company, "Ko'ruvchi");
    expect((await call(viewer.cookie, "GET", `/api/sales-agent/supervisor/agents/${ali.repId}`)).statusCode).toBe(403);
    const other = await createCompany(app, adminCookie, { name: "Boshqa" });
    const foreign = await addEmployee(app, other, "Supervayzer");
    expect((await call(foreign.cookie, "GET", `/api/sales-agent/supervisor/agents/${ali.repId}`)).statusCode).toBe(404);
    expect((await call(foreign.cookie, "POST", `/api/sales-agent/supervisor/prospects/${second.id}/reject`, { reason: "Begona" })).statusCode).toBe(404);
  });
});
