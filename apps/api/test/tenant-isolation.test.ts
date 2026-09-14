/**
 * Kompaniyalararo izolyatsiya (IDOR): B kompaniyasi foydalanuvchisi A kompaniyasi resurslarining ID'sini qo'lda
 * yuborib o'qiy, o'zgartira, o'chira yoki o'z hujjatiga bog'lay olmaydi; A ma'lumoti o'zgarmaydi. Biznes sarlavhasi
 * orqali A kontekstiga o'tish ham rad etiladi.
 */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../src/db/client.js";
import { buildServer } from "../src/server.js";
import { caller, confirmedOrder, deliveryCompany, localToday, resetUnits, taskForOrder, type DeliveryCompany, type Method } from "./delivery-setup.js";
import { resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let call: ReturnType<typeof caller>;
let adminCookie: string;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
  call = caller(app);
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
  await resetUnits();
  adminCookie = (await signedIn(app, { isPlatformAdmin: true })).cookie;
});

const DENIED = [403, 404];

async function ok(cookie: string, method: Method, url: string, payload?: object, status = 201) {
  const res = await call(cookie, method, url, payload);
  expect(res.statusCode, `${method} ${url}: ${res.body}`).toBe(status);
  return res.json();
}

/** A kompaniyasining turli modullardagi resurslari. */
async function seedCompanyA(a: DeliveryCompany) {
  const supplierId = (await ok(a.ownerCookie, "POST", "/api/purchase/suppliers", { name: "A ta'minotchi", code: "A-SUP" })).supplier.id as string;
  const employeeId = (await ok(a.ownerCookie, "POST", "/api/hr/employees", { name: "A xodimi", hireDate: "2020-01-01", baseSalary: "1000000", salaryType: "monthly" }))
    .employee.id as string;
  const expenseId = (await ok(a.ownerCookie, "POST", "/api/finance/expenses", { category: "boshqa", description: "A xarajati", amount: "1000", expenseDate: localToday() }))
    .expense.id as string;
  const leadId = (await ok(a.ownerCookie, "POST", "/api/crm/leads", { name: "A lead" })).lead.id as string;
  const orderId = await confirmedOrder(app, a, "1");
  const taskId = (await taskForOrder(app, a.ownerCookie, orderId)).id;
  const routeId = (await ok(a.ownerCookie, "POST", "/api/distribution/routes", { name: "A marshruti", days: [1] })).route.id as string;
  return { supplierId, employeeId, expenseId, leadId, orderId, taskId, routeId };
}

describe("Kompaniyalararo izolyatsiya (IDOR)", () => {
  it("B egasi A resurslarini ID bilan o'qiy, o'zgartira va o'chira olmaydi; A ma'lumoti o'zgarmaydi", async () => {
    const a = await deliveryCompany(app, adminCookie, "Bonnu Market");
    const b = await deliveryCompany(app, adminCookie, "Hadicha Market");
    const ids = await seedCompanyA(a);

    const reads = [
      `/api/sales/customers/${a.customerId}`,
      `/api/sales/orders/${ids.orderId}`,
      `/api/catalog/products/${a.productId}`,
      `/api/inventory/warehouses/${a.warehouseId}`,
      `/api/purchase/suppliers/${ids.supplierId}`,
      `/api/hr/employees/${ids.employeeId}`,
      `/api/delivery/tasks/${ids.taskId}`,
      `/api/distribution/routes/${ids.routeId}`,
    ];
    const before = new Map<string, string>();
    for (const url of reads) before.set(url, (await call(a.ownerCookie, "GET", url)).body);

    for (const url of reads) {
      const res = await call(b.ownerCookie, "GET", url);
      expect(DENIED, `GET ${url} -> ${res.statusCode} ${res.body}`).toContain(res.statusCode);
      expect(res.body).not.toContain("Bonnu Market");
      expect(res.body).not.toContain(a.companyId);
    }

    const writes: [Method, string, object | undefined][] = [
      ["PATCH", `/api/sales/customers/${a.customerId}`, { name: "Buzildi" }],
      ["PATCH", `/api/sales/orders/${ids.orderId}`, { notes: "Buzildi" }],
      ["PATCH", `/api/catalog/products/${a.productId}`, { name: "Buzildi" }],
      ["DELETE", `/api/catalog/products/${a.productId}`, undefined],
      ["PATCH", `/api/inventory/warehouses/${a.warehouseId}`, { name: "Buzildi" }],
      ["PATCH", `/api/purchase/suppliers/${ids.supplierId}`, { name: "Buzildi" }],
      ["PATCH", `/api/hr/employees/${ids.employeeId}`, { name: "Buzildi" }],
      ["DELETE", `/api/hr/employees/${ids.employeeId}`, undefined],
      ["PATCH", `/api/finance/expenses/${ids.expenseId}`, { description: "Buzildi" }],
      ["DELETE", `/api/finance/expenses/${ids.expenseId}`, undefined],
      ["PATCH", `/api/crm/leads/${ids.leadId}`, { name: "Buzildi" }],
      ["DELETE", `/api/crm/leads/${ids.leadId}`, undefined],
      ["POST", `/api/delivery/tasks/${ids.taskId}/cancel`, { reason: "Buzish urinishi" }],
      ["POST", `/api/distribution/routes/${ids.routeId}/optimize`, { apply: true }],
      ["DELETE", `/api/distribution/routes/${ids.routeId}`, undefined],
    ];
    for (const [method, url, payload] of writes) {
      const res = await call(b.ownerCookie, method, url, payload);
      expect(DENIED, `${method} ${url} -> ${res.statusCode} ${res.body}`).toContain(res.statusCode);
    }

    // A ning ma'lumoti o'zgarmagan
    for (const url of reads) expect((await call(a.ownerCookie, "GET", url)).body, `A: ${url}`).toBe(before.get(url));
    const expenses = (await call(a.ownerCookie, "GET", "/api/finance/expenses")).json().expenses as { id: string; description: string }[];
    expect(expenses.find((item) => item.id === ids.expenseId)?.description).toBe("A xarajati");
    const leads = (await call(a.ownerCookie, "GET", "/api/crm/leads")).json().leads as { id: string; name: string }[];
    expect(leads.find((item) => item.id === ids.leadId)?.name).toBe("A lead");
  });

  it("B o'z hujjatiga A ning mijozi, mahsuloti yoki omborini bog'lay olmaydi; biznes sarlavhasi bilan A ga o'tolmaydi", async () => {
    const a = await deliveryCompany(app, adminCookie, "Bonnu Market");
    const b = await deliveryCompany(app, adminCookie, "Hadicha Market");
    const order = (overrides: object) => ({
      customerId: b.customerId,
      warehouseId: b.warehouseId,
      orderDate: localToday(),
      items: [{ productId: b.productId, quantity: "1" }],
      ...overrides,
    });
    for (const [label, body] of [
      ["A mijozi", order({ customerId: a.customerId })],
      ["A ombori", order({ warehouseId: a.warehouseId })],
      ["A mahsuloti", order({ items: [{ productId: a.productId, quantity: "1" }] })],
    ] as const) {
      const res = await call(b.ownerCookie, "POST", "/api/sales/orders", body);
      expect([400, 403, 404], `${label} -> ${res.statusCode} ${res.body}`).toContain(res.statusCode);
    }
    expect((await call(b.ownerCookie, "GET", "/api/sales/orders")).json().orders).toHaveLength(0);

    const dispatch = await call(b.ownerCookie, "POST", "/api/distribution/routes", { name: "B marshruti", days: [1] });
    const routeId = dispatch.json().route.id as string;
    const foreignMember = await call(b.ownerCookie, "POST", `/api/distribution/routes/${routeId}/customers`, { customerId: a.customerId });
    expect([400, 403, 404], `A mijozi B marshrutiga -> ${foreignMember.statusCode}`).toContain(foreignMember.statusCode);

    const viaHeader = await app.inject({ method: "GET", url: "/api/sales/customers", headers: { cookie: b.ownerCookie, "x-bum-company": a.slug } });
    expect(viaHeader.statusCode).toBe(403);
    const viaId = await app.inject({ method: "GET", url: "/api/sales/customers", headers: { cookie: b.ownerCookie, "x-bum-company": a.companyId } });
    expect(viaId.statusCode).toBe(403);
  });
});
