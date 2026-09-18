import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SALES_AGENT_POLICY } from "@bum/shared";
import { closeDb, db } from "../src/db/client.js";
import { brands, categories, products, units } from "../src/db/schema/catalog.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { notifications } from "../src/db/schema/notifications.js";
import { auditLogs } from "../src/db/schema/platform.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { LEGACY_VISIT_POLICY, setAgentPolicy } from "./agent-policy.js";
import { addEmployee, createCompany, resetDatabase, signedIn, salesRepOf } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PUT";

let app: FastifyInstance;
let company: Company;
let cola: string;
let chips: string;

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
  const product = async (name: string, sku: string) => {
    const id = (await call(company.ownerCookie, "POST", "/api/catalog/products", { name, sku, baseUnitId: piece, salesPrice: "10000", taxRate: "0" })).json()
      .product.id as string;
    await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", { type: "receive", productId: id, warehouseId: mainWh, quantity: "100", costPrice: "1000" });
    return id;
  };
  cola = await product("Coca Cola 1L", "COLA");
  chips = await product("Lays chips", "LAYS");
  const [drinks, snacks] = await db
    .insert(categories)
    .values([
      { companyId: company.companyId, name: "Ichimliklar" },
      { companyId: company.companyId, name: "Gazaklar" },
    ])
    .returning({ id: categories.id });
  const [coke, lays] = await db
    .insert(brands)
    .values([
      { companyId: company.companyId, name: "Coca-Cola" },
      { companyId: company.companyId, name: "Lays" },
    ])
    .returning({ id: brands.id });
  await db.update(products).set({ categoryId: drinks!.id, brandId: coke!.id }).where(eq(products.id, cola));
  await db.update(products).set({ categoryId: snacks!.id, brandId: lays!.id }).where(eq(products.id, chips));
});

const iso = () => new Date().toISOString();
const near = { latitude: 41.3115, longitude: 69.2406, accuracy: 10 };

async function agentWithStore(customer: object) {
  const employee = await addEmployee(app, company, "Sotuv agenti");
  const repId = await salesRepOf(app, company.ownerCookie, employee.id, { name: "Ali" });
  await call(employee.cookie, "POST", "/api/sales-agent/work-session/start", { ...near, recordedAt: iso() });
  const customerId = (await call(company.ownerCookie, "POST", "/api/sales/customers", { name: "Baraka", latitude: 41.311081, longitude: 69.240562, ...customer }))
    .json().customer.id as string;
  const routeId = (await call(company.ownerCookie, "POST", "/api/distribution/routes", { name: "R", salesRepId: repId, days: [0, 1, 2, 3, 4, 5, 6] })).json().route
    .id as string;
  await call(company.ownerCookie, "POST", `/api/distribution/routes/${routeId}/customers`, { customerId });
  return { cookie: employee.cookie, repId, customerId };
}

const notified = (userId: string, title: string) => db.$count(notifications, and(eq(notifications.userId, userId), eq(notifications.title, title)));

describe("Katalog filtrlari, bildirishnoma oluvchilar va bosh sahifa", () => {
  it("katalog: kategoriya va brend filtrlari, nomlari; rasm havolasi saqlashsiz null", async () => {
    const ali = await agentWithStore({});
    const filters = (await call(ali.cookie, "GET", "/api/sales-agent/catalog/filters")).json();
    expect(filters.categories.map((c: { name: string }) => c.name)).toEqual(["Gazaklar", "Ichimliklar"]);
    expect(filters.brands.map((b: { name: string }) => b.name)).toEqual(["Coca-Cola", "Lays"]);

    const coke = filters.brands.find((b: { name: string }) => b.name === "Coca-Cola").id;
    const byBrand = (await call(ali.cookie, "GET", `/api/sales-agent/catalog?brandId=${coke}`)).json().products;
    expect(byBrand).toEqual([expect.objectContaining({ id: cola, brandName: "Coca-Cola", categoryName: "Ichimliklar", imageUrl: null })]);
    const snacks = filters.categories.find((c: { name: string }) => c.name === "Gazaklar").id;
    expect((await call(ali.cookie, "GET", `/api/sales-agent/catalog?categoryId=${snacks}`)).json().products.map((p: { id: string }) => p.id)).toEqual([chips]);
  });

  it("kredit limiti oshsa bildirishnoma va audit; siyosatda tanlangan oluvchilar; bosh sahifa mijozlari va top mahsulotlar", async () => {
    const ali = await agentWithStore({ creditLimit: "10000" });
    const supervisor = await addEmployee(app, company, "Supervayzer");
    const manager = await addEmployee(app, company, "Savdo menejeri");
    const creditOrder = async () => {
      const order = (
        await call(ali.cookie, "PUT", `/api/sales-agent/orders/drafts/${randomUUID()}`, {
          customerId: ali.customerId,
          paymentType: "credit",
          paymentDueDate: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
          items: [{ productId: cola, pieces: "2" }],
        })
      ).json().order;
      return call(ali.cookie, "POST", `/api/sales-agent/orders/${order.id}/submit`, { ...near, recordedAt: iso() });
    };

    // Standart: supervayzer va savdo menejeri (sales_agent.supervise) oladi; rad etilgan urinish saqlanadi
    const blocked = await creditOrder();
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().details).toMatchObject({ reason: "credit_limit", limit: "10000.00", exposure: "20000.00" });
    expect(await notified(supervisor.id, "Kredit limiti oshdi")).toBe(1);
    expect(await notified(manager.id, "Kredit limiti oshdi")).toBe(1);
    expect(await db.$count(auditLogs, eq(auditLogs.action, "CREDIT_LIMIT_EXCEEDED"))).toBe(1);

    const recipients = await call(supervisor.cookie, "GET", "/api/sales-agent/policy/recipients");
    expect(recipients.statusCode).toBe(200);
    expect(recipients.json().recipients.map((r: { userId: string }) => r.userId)).toEqual(expect.arrayContaining([supervisor.id, manager.id]));
    expect((await call(ali.cookie, "GET", "/api/sales-agent/policy/recipients")).statusCode).toBe(403);

    const policy = (notificationRecipients: object) => ({ ...DEFAULT_SALES_AGENT_POLICY, ...LEGACY_VISIT_POLICY, notificationRecipients });
    expect(
      (await call(supervisor.cookie, "PUT", "/api/sales-agent/policy", policy({ geofence: [randomUUID()], approval: [], creditLimit: [] }))).json().details,
    ).toEqual({ reason: "recipient_invalid" });
    expect(
      (await call(supervisor.cookie, "PUT", "/api/sales-agent/policy", policy({ geofence: [supervisor.id], approval: [], creditLimit: [manager.id] }))).statusCode,
    ).toBe(200);

    await creditOrder();
    expect(await notified(supervisor.id, "Kredit limiti oshdi")).toBe(1);
    expect(await notified(manager.id, "Kredit limiti oshdi")).toBe(2);

    const cashOrder = (
      await call(ali.cookie, "PUT", `/api/sales-agent/orders/drafts/${randomUUID()}`, { customerId: ali.customerId, items: [{ productId: chips, pieces: "3" }] })
    ).json().order;
    const far = await call(ali.cookie, "POST", `/api/sales-agent/orders/${cashOrder.id}/submit`, { latitude: 41.35, longitude: 69.24, accuracy: 10, recordedAt: iso() });
    expect(far.statusCode).toBe(403);
    expect(await notified(supervisor.id, "Geo-fence buzilishi")).toBe(1);
    expect(await notified(manager.id, "Geo-fence buzilishi")).toBe(0);

    expect((await call(ali.cookie, "POST", `/api/sales-agent/orders/${cashOrder.id}/submit`, { ...near, recordedAt: iso() })).statusCode).toBe(200);
    const dashboard = (await call(ali.cookie, "GET", "/api/sales-agent/dashboard")).json();
    expect(dashboard.customers).toMatchObject({ planned: 1, ordered: 1, notOrdered: 0, debtors: 0 });
    expect(dashboard.averageOrderToday).toBe("30000.00");
    expect(dashboard.topProducts).toEqual([expect.objectContaining({ productId: chips, name: "Lays chips", amount: "30000.00" })]);
  });
});
