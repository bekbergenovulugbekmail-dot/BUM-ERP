import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { todayIso } from "../src/modules/finance/cash.service.js";
import { proratedTarget } from "../src/modules/sales-agent/reports.service.js";
import { buildServer } from "../src/server.js";
import { fromMinor } from "../src/shared/decimal.js";
import { LEGACY_VISIT_POLICY, setAgentPolicy } from "./agent-policy.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PUT";

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
const near = { latitude: 41.3115, longitude: 69.2406, accuracy: 10 };
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

async function agent(name: string, monthlyTarget = "0") {
  const employee = await addEmployee(app, company, "Sotuv agenti");
  const rep = await call(company.ownerCookie, "POST", "/api/distribution/sales-reps", { name, userId: employee.id, monthlyTarget });
  const repId = rep.json().salesRep.id as string;
  await call(employee.cookie, "POST", "/api/sales-agent/work-session/start", { ...near, recordedAt: iso() });
  const customerId = (await call(company.ownerCookie, "POST", "/api/sales/customers", { name: `${name} do'koni`, latitude: 41.311081, longitude: 69.240562 })).json()
    .customer.id as string;
  const routeId = (await call(company.ownerCookie, "POST", "/api/distribution/routes", { name: `R-${name}`, salesRepId: repId, days: [0, 1, 2, 3, 4, 5, 6] })).json()
    .route.id as string;
  await call(company.ownerCookie, "POST", `/api/distribution/routes/${routeId}/customers`, { customerId });
  const sell = async (pieces: string, paymentType = "cash") => {
    const order = (
      await call(employee.cookie, "PUT", `/api/sales-agent/orders/drafts/${randomUUID()}`, {
        customerId,
        paymentType,
        paymentDueDate: paymentType === "credit" ? shift(todayIso(), 5) : null,
        items: [{ productId, pieces }],
      })
    ).json().order;
    expect((await call(employee.cookie, "POST", `/api/sales-agent/orders/${order.id}/submit`, { ...near, recordedAt: iso() })).statusCode).toBe(200);
  };
  return { cookie: employee.cookie, repId, customerId, sell };
}

describe("Agent hisobotlari", () => {
  it("davr bo'yicha sotuv, tashrif, plan va top ro'yxatlar — faqat agentning o'zi", async () => {
    const ali = await agent("Ali", "3000000");
    const vali = await agent("Vali");
    await ali.sell("2");
    await ali.sell("3", "credit");
    await vali.sell("10");

    const visit = (await call(ali.cookie, "POST", "/api/sales-agent/visits/start", { customerId: ali.customerId, ...near, recordedAt: iso() })).json().visit;
    await call(ali.cookie, "POST", `/api/sales-agent/visits/${visit.id}/complete`, { ...near, recordedAt: iso(), noOrderReason: "price" });

    const today = todayIso();
    const report = await call(ali.cookie, "GET", `/api/sales-agent/reports?from=${today}&to=${today}`);
    expect(report.statusCode).toBe(200);
    const data = report.json();
    expect(data.sales).toMatchObject({ orderCount: 2, total: "50000.00", cash: "20000.00", card: "0.00", credit: "30000.00", averageOrder: "25000.00", customerCount: 1 });
    expect(data.sales.byDay).toEqual([{ date: today, amount: "50000.00", orders: 2 }]);
    expect(data.sales.topProducts).toEqual([expect.objectContaining({ name: "Coca Cola 1L", quantity: "5.0000", amount: "50000.00" })]);
    expect(data.sales.topCustomers).toEqual([expect.objectContaining({ name: "Ali do'koni", orders: 2 })]);
    expect(data.visits).toMatchObject({ total: 1, ordered: 0, noOrder: 1, invalid: 0, reasons: { price: 1 } });
    expect(data.plan).toMatchObject({ target: fromMinor(proratedTarget(300000000n, today, today)), achieved: "50000.00" });
    expect(data.debt).toMatchObject({ collected: "0.00" });

    // Boshqa agent — faqat o'z savdosi; standart davr — joriy oy
    const valiReport = (await call(vali.cookie, "GET", "/api/sales-agent/reports")).json();
    expect(valiReport).toMatchObject({ from: `${today.slice(0, 7)}-01`, to: today });
    expect(valiReport.sales).toMatchObject({ orderCount: 1, total: "100000.00" });
    expect(valiReport.visits.total).toBe(0);

    expect((await call(ali.cookie, "GET", `/api/sales-agent/reports?from=${today}&to=${shift(today, -1)}`)).json().details).toEqual({ reason: "range_invalid" });
    expect((await call(ali.cookie, "GET", `/api/sales-agent/reports?from=${shift(today, -100)}&to=${today}`)).json().details).toMatchObject({
      reason: "range_too_long",
    });
    // Soxta agentId/salesRepId e'tiborsiz — hisobot sessiyadagi agentniki
    expect((await call(ali.cookie, "GET", `/api/sales-agent/reports?salesRepId=${vali.repId}`)).json().sales.total).toBe("50000.00");
    const kassir = await addEmployee(app, company, "Kassir");
    expect((await call(kassir.cookie, "GET", "/api/sales-agent/reports")).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/sales-agent/reports" })).statusCode).toBe(401);
  });

  it("oylik rejani davrga taqsimlash", () => {
    // 30 kunlik oyning 10 kuni — 1/3
    expect(proratedTarget(3000n, "2026-09-01", "2026-09-10")).toBe(1000n);
    // oy chegarasidan o'tadi: sentyabr 21–30 (10/30) + oktyabr 1–31 (31/31)
    expect(proratedTarget(3100n, "2026-09-21", "2026-10-31")).toBe(1033n + 3100n);
    expect(proratedTarget(0n, "2026-09-01", "2026-09-30")).toBe(0n);
  });
});
