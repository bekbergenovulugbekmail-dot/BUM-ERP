/**
 * FOYDANI FAQAT EGA KO'RADI.
 *
 * Kompaniya egasining qarori: sof foyda, yalpi foyda, marja va tovar tannarxi (COGS) xodimlarga
 * ko'rinmasligi kerak. Aylanma (daromad) va xarajat ochiq qoladi — ulardan foydani hisoblab
 * bo'lmaydi, chunki tannarx yashirilgan.
 *
 * Ruxsat: `analytics.view_profit` — hech bir tayyor rolda yo'q, faqat to'liq huquqlilarda
 * (Business Owner, Superadmin). Ega uni kerakli xodimga rollar sozlamasidan beradi.
 */
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_ROLES } from "@bum/shared";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { todayIso } from "../src/modules/finance/cash.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn, uniquePhone } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PUT" | "PATCH";

let app: FastifyInstance;
let company: Company;

const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

const overview = (cookie: string) => call(cookie, "GET", "/api/analytics/reports/overview?days=30");
const dashboard = (cookie: string) => call(cookie, "GET", "/api/analytics/dashboard");
const profitLoss = (cookie: string) => call(cookie, "GET", `/api/finance/reports/profit-loss?dateFrom=2000-01-01&dateTo=${todayIso()}`);

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
  await resetDatabase();
  await db.delete(units);
  await seedDefaultUnits(db);
  const piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;

  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "FOYDA-TEST" });
  const warehouseId = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  expect((await call(company.ownerCookie, "POST", "/api/finance/setup")).statusCode).toBe(200);

  // Bitta sotuv: foyda paydo bo'lsin (tannarx 6 000, sotuv 10 000)
  const productId = (
    await call(company.ownerCookie, "POST", "/api/catalog/products", { name: "Cola", sku: "COLA", baseUnitId: piece, salesPrice: "10000", taxRate: "0" })
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
  const customerId = (
    await call(company.ownerCookie, "POST", "/api/sales/customers", { name: "Mijoz", phone: uniquePhone("95"), creditLimit: "0" })
  ).json().customer.id as string;
  const orderId = (
    await call(company.ownerCookie, "POST", "/api/sales/orders", {
      customerId,
      warehouseId,
      orderDate: todayIso(),
      items: [{ productId, quantity: "10" }],
    })
  ).json().order.id as string;
  expect((await call(company.ownerCookie, "POST", `/api/sales/orders/${orderId}/confirm`)).statusCode).toBe(200);
  expect((await call(company.ownerCookie, "POST", `/api/sales/orders/${orderId}/ship`)).statusCode).toBe(200);
}, 180_000);

afterAll(async () => {
  await app.close();
  await closeDb();
});

describe("Foydani ko'rish ruxsati", () => {
  it("foyda ruxsati faqat ega va superadminda — Direktorda ham yo'q", () => {
    const withProfit = DEFAULT_ROLES.filter((role) => role.permissions.includes("analytics.view_profit")).map((role) => role.name);
    // "Superadmin" va "Business Owner" — to'liq huquqli rollar (kodda ham bypass qilinadi)
    expect(withProfit.sort(), "boshqa hech bir tayyor rolda bo'lmasligi kerak").toEqual(["Business Owner", "Superadmin"]);
  });

  it("ega foydani ko'radi (sof foyda, marja va tannarx)", async () => {
    const res = await overview(company.ownerCookie);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    // 10 × 10 000 = 100 000 aylanma, tannarx 10 × 6 000 = 60 000 → yalpi foyda 40 000
    expect(body).toMatchObject({ profitHidden: false, revenue: "100000.00", cogs: "60000.00", grossProfit: "40000.00" });
    expect(Number(body.netProfit)).toBe(40_000);
    expect(Number(body.grossMargin)).toBeGreaterThan(0);
  });

  it("buxgalter daromad va xarajatni ko'radi, foydani KO'RMAYDI", async () => {
    const accountant = await addEmployee(app, company, "Buxgalter");
    const body = (await overview(accountant.cookie)).json();

    expect(body.profitHidden, "foyda yashirilgan").toBe(true);
    expect(body.cogs, "tannarx yashirilgan").toBeNull();
    expect(body.grossProfit).toBeNull();
    expect(body.netProfit).toBeNull();
    expect(body.grossMargin).toBeNull();
    // Aylanma va xarajat ochiq — ular ish uchun kerak
    expect(body.revenue).toBe("100000.00");
    expect(body.expenses).toBe("0.00");
    expect(body.orderCount).toBe(1);
  });

  it("savdo, ombor, HR va supervayzer ham foydani ko'rmaydi", async () => {
    for (const role of ["Savdo menejeri", "Ombor menejeri", "HR menejeri", "Supervayzer", "Direktor"]) {
      const employee = await addEmployee(app, company, role);
      const res = await overview(employee.cookie);
      expect(res.statusCode, `${role}: ${res.body}`).toBe(200);
      const body = res.json();
      expect(body.profitHidden, `${role} foydani ko'rmasligi kerak`).toBe(true);
      expect(body.netProfit, `${role}: sof foyda`).toBeNull();
      expect(body.cogs, `${role}: tannarx`).toBeNull();
    }
  });

  it("bosh sahifada ham foyda va tannarx yashiriladi", async () => {
    const owner = (await dashboard(company.ownerCookie)).json();
    expect(owner).toMatchObject({ profitHidden: false });
    expect(owner.grossProfit).not.toBeNull();

    const accountant = await addEmployee(app, company, "Buxgalter");
    const body = (await dashboard(accountant.cookie)).json();
    expect(body.profitHidden).toBe(true);
    expect(body.grossProfit, "yalpi foyda yashirilgan").toBeNull();
    expect(body.cogs).toBeNull();
    // Moliya ruxsati bor — kassa va qarzlar ko'rinadi (ular foyda emas)
    expect(body.financeHidden).toBe(false);
    expect(body.cashBalance).not.toBeNull();
  });

  it("foyda-zarar hisoboti: egaga ochiq, buxgalterga 403", async () => {
    const owner = await profitLoss(company.ownerCookie);
    expect(owner.statusCode, owner.body).toBe(200);

    const accountant = await addEmployee(app, company, "Buxgalter");
    const denied = await profitLoss(accountant.cookie);
    expect(denied.statusCode, "foyda-zarar yopiq").toBe(403);

    // Aylanma balans esa ochiq qoladi — u foyda ko'rsatmaydi
    const trial = await call(accountant.cookie, "GET", `/api/finance/reports/trial-balance?dateFrom=2000-01-01&dateTo=${todayIso()}`);
    expect(trial.statusCode, "aylanma balans buxgalterga kerak").toBe(200);
  });

  it("ega ruxsatni bersa — xodim foydani ko'ra boshlaydi", async () => {
    const director = await addEmployee(app, company, "Direktor");
    expect((await overview(director.cookie)).json().profitHidden, "boshida yopiq").toBe(true);

    // Ega "Direktor" roliga foyda ruxsatini qo'shadi
    const roles = (await call(company.ownerCookie, "GET", "/api/company/roles")).json().roles as { id: string; name: string; permissions: string[] }[];
    const role = roles.find((item) => item.name === "Direktor")!;
    const updated = await call(company.ownerCookie, "PATCH", `/api/company/roles/${role.id}`, {
      permissions: [...role.permissions, "analytics.view_profit"],
    });
    expect(updated.statusCode, updated.body).toBe(200);

    const body = (await overview(director.cookie)).json();
    expect(body.profitHidden, "ruxsatdan keyin ochiq").toBe(false);
    expect(body.netProfit).not.toBeNull();
    expect((await profitLoss(director.cookie)).statusCode, "foyda-zarar ham ochiladi").toBe(200);
  });
});
