/**
 * SUPERVAYZER HAM ZAKAZ OLADI.
 *
 * Kompaniya egasining talabi: supervayzer agentlarni nazorat qilish bilan birga o'zi ham do'kondan
 * buyurtma olishi kerak. Ilgari "Supervayzer" rolida `sales_agent.use` yo'q edi — agent ish joyi
 * unga umuman ochilmasdi.
 *
 * Qoida o'zgarmadi: ruxsatning o'zi yetmaydi — hisob FAOL savdo agentiga bog'langan bo'lishi kerak
 * (`sales_reps.user_id`), aks holda agent API'lari "Hisobingiz faol savdo agentiga bog'lanmagan" deydi.
 * Bog'lash "Distribyutsiya → Sotuv agentlari" da bir marta bajariladi.
 */
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ROLES } from "@bum/shared";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PATCH";

let app: FastifyInstance;
let company: Company;

const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

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
  const piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Supervayzer kompaniyasi" });
  const warehouseId = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  const productId = (
    await call(company.ownerCookie, "POST", "/api/catalog/products", {
      name: "Cola 1L",
      sku: "COLA",
      baseUnitId: piece,
      salesPrice: "10000",
      taxRate: "0",
    })
  ).json().product.id as string;
  expect(
    (await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", {
      type: "receive",
      productId,
      warehouseId,
      quantity: "100",
      costPrice: "6000",
    })).statusCode,
  ).toBe(201);
});

/**
 * Mavjud xodimni savdo agentiga bog'lash — egasi buni "Distribyutsiya → Sotuv agentlari" da qiladi.
 * ("Sotuv agenti" rolidan farqli: supervayzer uchun agent profili avtomatik yaratilmaydi.)
 */
async function linkAsAgent(userId: string, name: string): Promise<string> {
  const res = await call(company.ownerCookie, "POST", "/api/distribution/sales-reps", { name, userId });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().salesRep.id as string;
}

describe("Supervayzer zakaz oladi", () => {
  it("tayyor rolda agent ish joyi ruxsati bor", () => {
    const supervisor = DEFAULT_ROLES.find((role) => role.name === "Supervayzer")!;
    expect(supervisor.permissions).toContain("sales_agent.use");
    // Nazorat ruxsati ham o'z joyida qoladi
    expect(supervisor.permissions).toContain("sales_agent.supervise");
  });

  it("agentga bog'langandan keyin agent ish joyi ochiladi", async () => {
    const supervisor = await addEmployee(app, company, "Supervayzer");

    // Bog'lanmagan holatda: ruxsat bor, lekin agent profili yo'q
    const before = await call(supervisor.cookie, "GET", "/api/sales-agent/me");
    expect(before.statusCode, before.body).toBe(403);
    expect(before.json().message).toMatch(/savdo agentiga bog'lanmagan/i);

    // Ega uni savdo agenti sifatida bog'laydi (mavjud xodimga agent yozuvi)
    await linkAsAgent(supervisor.id, "Supervayzer Aziz");

    const after = await call(supervisor.cookie, "GET", "/api/sales-agent/me");
    expect(after.statusCode, after.body).toBe(200);
    expect(after.json().agent.name).toBe("Supervayzer Aziz");
  });

  it("do'kon ro'yxati va buyurtma berish ishlaydi", async () => {
    const supervisor = await addEmployee(app, company, "Supervayzer");
    const repId = await linkAsAgent(supervisor.id, "Supervayzer Aziz");

    const customerId = (
      await call(company.ownerCookie, "POST", "/api/sales/customers", {
        name: "Do'kon",
        latitude: 41.311081,
        longitude: 69.240562,
      })
    ).json().customer.id as string;
    const routeId = (
      await call(company.ownerCookie, "POST", "/api/distribution/routes", {
        name: "Supervayzer marshruti",
        salesRepId: repId,
        days: [0, 1, 2, 3, 4, 5, 6],
      })
    ).json().route.id as string;
    expect((await call(company.ownerCookie, "POST", `/api/distribution/routes/${routeId}/customers`, { customerId })).statusCode).toBe(201);

    // Agent ish joyining asosiy sahifalari supervayzerga ham ochiq
    const stores = await call(supervisor.cookie, "GET", "/api/sales-agent/stores?scope=all");
    expect(stores.statusCode, stores.body).toBe(200);
    expect((stores.json().stores as { id: string }[]).some((store) => store.id === customerId), "o'z marshrutidagi do'kon ko'rinadi").toBe(true);

    const dashboard = await call(supervisor.cookie, "GET", "/api/sales-agent/dashboard");
    expect(dashboard.statusCode, dashboard.body).toBe(200);
  });

  it("boshqa rollar agent ish joyini ochmaydi (ruxsat kengayib ketmadi)", async () => {
    for (const role of ["Buxgalter", "Ombor menejeri", "Kassir"]) {
      const employee = await addEmployee(app, company, role);
      const res = await call(employee.cookie, "GET", "/api/sales-agent/me");
      expect(res.statusCode, `${role}: ${res.body}`).toBe(403);
    }
  });
});
