/**
 * QABUL TESTI — barcha rollar uchun to'g'ridan-to'g'ri API ruxsati (UI yashirish hisobga olinmaydi).
 *
 * Kutilma qo'lda yozilmaydi: har rol uchun `GET /api/company` dan haqiqiy ruxsatlar ro'yxati olinadi va
 * har endpoint bo'yicha tekshiriladi — ruxsat bo'lmasa **403**, bo'lsa 403 bo'lmasligi shart. Shu bilan rol
 * ta'riflari o'zgarsa ham test to'g'ri qoladi va "ruxsat yo'q, lekin ochiq" holati albatta tutiladi.
 *
 * Shuningdek IDOR/BOLA: boshqa kompaniya yozuvini ID bilan so'rash — 403 yoki 404.
 */
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let adminCookie: string;

/** Sinaladigan rollar (egasi alohida — u barcha ruxsatlarga ega). */
const ROLES = [
  "Direktor",
  "Buxgalter",
  "Moliya menejeri",
  "Savdo menejeri",
  "Xarid menejeri",
  "Kassir",
  "Sotuv agenti",
  "Dostavka agenti",
] as const;

/** Endpoint va u talab qiladigan ruxsat (`null` — har a'zoga ochiq). */
const ENDPOINTS: { method: "GET" | "POST" | "PUT"; url: string; permission: string | null; payload?: object }[] = [
  { method: "GET", url: "/api/finance/cash-accounts", permission: "finance.view" },
  { method: "GET", url: "/api/finance/expenses", permission: "finance.view" },
  { method: "GET", url: "/api/hr/employees", permission: "hr.view" },
  { method: "GET", url: "/api/hr/employees/export", permission: "hr.view" },
  { method: "GET", url: "/api/purchase/suppliers", permission: "purchase.view" },
  { method: "GET", url: "/api/purchase/orders", permission: "purchase.view" },
  { method: "GET", url: "/api/purchase/orders/export", permission: "purchase.view" },
  { method: "GET", url: "/api/sales/customers", permission: "sales.view" },
  { method: "GET", url: "/api/sales/customers/export", permission: "sales.view" },
  { method: "GET", url: "/api/distribution/routes", permission: "distribution.view" },
  { method: "GET", url: "/api/company/audit-logs", permission: "audit.view" },
  // Bosh sahifa modul guardidan ozod, lekin ruxsat talab qiladi: `analytics.view` yo'q rolda — 403
  { method: "GET", url: "/api/analytics/dashboard", permission: "analytics.view" },
  { method: "PUT", url: "/api/company/modules/hr", permission: "modules.manage", payload: { enabled: true } },
  {
    method: "POST",
    url: "/api/sales/customers/import",
    permission: "crm.manage",
    payload: { dryRun: true, rows: [{ name: "RBAC sinov" }] },
  },
  {
    method: "POST",
    url: "/api/purchase/suppliers/import",
    permission: "purchase.create",
    payload: { dryRun: true, rows: [{ name: "RBAC sinov" }] },
  },
  {
    method: "POST",
    url: "/api/hr/employees/import",
    permission: "hr.manage",
    payload: { dryRun: true, rows: [{ name: "RBAC sinov", hireDate: "2026-01-01" }] },
  },
];

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
  const admin = await signedIn(app, { isPlatformAdmin: true });
  adminCookie = admin.cookie;
  company = await createCompany(app, adminCookie, { name: "RBAC do'koni" });
});

const call = (cookie: string, method: "GET" | "POST" | "PUT", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

async function permissionsOf(cookie: string): Promise<string[]> {
  const res = await call(cookie, "GET", "/api/company");
  expect(res.statusCode, res.body).toBe(200);
  return res.json().permissions as string[];
}

describe("QABUL: rollar bo'yicha API ruxsati", () => {
  for (const role of ROLES) {
    it(`${role}: ruxsat yo'q endpointlar 403, ruxsat borlari ochiq`, async () => {
      const employee = await addEmployee(app, company, role);
      const permissions = await permissionsOf(employee.cookie);
      expect(permissions.length).toBeGreaterThan(0);

      for (const endpoint of ENDPOINTS) {
        const allowed = endpoint.permission === null || permissions.includes(endpoint.permission);
        const res = await call(employee.cookie, endpoint.method, endpoint.url, endpoint.payload);
        if (allowed) {
          // Ruxsat bor — RBAC bloklamasligi kerak (400 bo'lishi mumkin: ma'lumot xatosi, lekin 403 emas)
          expect(res.statusCode, `${role} ${endpoint.method} ${endpoint.url}: ${res.body}`).not.toBe(403);
        } else {
          expect(res.statusCode, `${role} ${endpoint.method} ${endpoint.url}: ${res.body}`).toBe(403);
        }
      }
    });
  }

  it("kompaniya egasi: barcha sinaladigan endpointlar ochiq", async () => {
    const permissions = await permissionsOf(company.ownerCookie);
    for (const endpoint of ENDPOINTS) {
      expect(permissions.includes(endpoint.permission ?? "") || endpoint.permission === null).toBe(true);
      const res = await call(company.ownerCookie, endpoint.method, endpoint.url, endpoint.payload);
      expect(res.statusCode, `${endpoint.method} ${endpoint.url}: ${res.body}`).not.toBe(403);
    }
  });

  it("platforma marshrutlari kompaniya foydalanuvchilariga yopiq", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    for (const cookie of [company.ownerCookie, kassir.cookie]) {
      expect((await call(cookie, "GET", "/api/platform/companies")).statusCode).toBe(403);
    }
  });
});

describe("QABUL: IDOR / BOLA — begona kompaniya yozuvi", () => {
  it("boshqa kompaniya mijozi, ta'minotchisi, xaridi va marshrutini ID bilan olib bo'lmaydi", async () => {
    const other = await createCompany(app, adminCookie, { name: "Begona kompaniya" });
    const [otherWarehouse] = await db.select().from(warehouses).where(eq(warehouses.companyId, other.companyId));
    const otherCustomer = (await call(other.ownerCookie, "POST", "/api/sales/customers", { name: "B mijoz" })).json().customer.id as string;
    const otherSupplier = (await call(other.ownerCookie, "POST", "/api/purchase/suppliers", { name: "B ta'minotchi", code: "B-1" })).json().supplier.id as string;
    const otherRoute = (await call(other.ownerCookie, "POST", "/api/distribution/routes", { name: "B marshrut", days: [1] })).json().route.id as string;
    const otherProduct = (await call(other.ownerCookie, "POST", "/api/catalog/products", {
      name: "B mahsulot",
      sku: "B-SKU",
      baseUnitId: (await call(other.ownerCookie, "GET", "/api/catalog/units")).json().units[0].id,
    })).json().product.id as string;

    const savdo = await addEmployee(app, company, "Savdo menejeri");
    const xarid = await addEmployee(app, company, "Xarid menejeri");

    const cases: { cookie: string; url: string }[] = [
      { cookie: company.ownerCookie, url: `/api/sales/customers/${otherCustomer}` },
      { cookie: savdo.cookie, url: `/api/sales/customers/${otherCustomer}` },
      { cookie: company.ownerCookie, url: `/api/purchase/suppliers/${otherSupplier}` },
      { cookie: xarid.cookie, url: `/api/purchase/suppliers/${otherSupplier}` },
      { cookie: company.ownerCookie, url: `/api/distribution/routes/${otherRoute}` },
      { cookie: company.ownerCookie, url: `/api/catalog/products/${otherProduct}` },
      { cookie: company.ownerCookie, url: `/api/inventory/warehouses/${otherWarehouse!.id}` },
    ];
    for (const item of cases) {
      const res = await call(item.cookie, "GET", item.url);
      expect([403, 404], `${item.url}: ${res.statusCode} ${res.body}`).toContain(res.statusCode);
    }

    // Yozish ham yopiq: begona mijozga to'lov va begona ta'minotchi qarzini to'g'rilash
    const payment = await call(company.ownerCookie, "POST", "/api/sales/payments", {
      customerId: otherCustomer,
      parts: [{ method: "cash", amount: "1000" }],
    });
    expect([403, 404]).toContain(payment.statusCode);
    const debt = await call(company.ownerCookie, "POST", `/api/purchase/suppliers/${otherSupplier}/set-debt`, {
      totalDebt: "1000",
      reason: "Begona ta'minotchi",
    });
    expect([403, 404]).toContain(debt.statusCode);
  });
});
