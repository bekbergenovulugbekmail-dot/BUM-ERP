/**
 * Nasiya to'xtatish (credit hold) — bitta server qoidasi ERP, kassa va savdo agenti uchun.
 *
 * Asosiy qoida: QARZ QOLDIRADIGAN sotuv to'xtaydi; naqd sotuv va mijozning qarzni to'lashi
 * hech qachon to'xtamaydi. Chegaralar kompaniya siyosatida (`sales.policy`), kodda emas.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { auditLogs } from "../src/db/schema/platform.js";
import { units } from "../src/db/schema/catalog.js";
import { cashAccounts } from "../src/db/schema/finance.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { customers } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { DEFAULT_SALES_POLICY } from "../src/modules/sales/sales-policy.service.js";
import { todayIso } from "../src/modules/finance/cash.service.js";
import { buildServer } from "../src/server.js";
import { setAgentPolicy } from "./agent-policy.js";
import { addEmployee, createCompany, resetDatabase, salesRepOf, signedIn, uniquePhone } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PUT" | "PATCH";

let app: FastifyInstance;
let company: Company;
let other: Company;
let productId: string;
let warehouseId: string;
let cashAccountId: string;
let customerId: string;
let foreignCustomerId: string;

const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

const shift = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const money = (value: string | number | null | undefined) => Number(value ?? 0);
const near = { latitude: 41.3115, longitude: 69.2406, accuracy: 10 };
const shop = { latitude: 41.311081, longitude: 69.240562 };
const iso = () => new Date().toISOString();

const setPolicy = (patch: object) =>
  call(company.ownerCookie, "PUT", "/api/sales/policy", { ...DEFAULT_SALES_POLICY, ...patch });

/** Nasiya sotuv: yaratish → tasdiq → jo'natish (qarz shu bosqichda yoziladi). */
async function creditSale(orderDate: string, quantity: string, targetCustomer = customerId) {
  const created = await call(company.ownerCookie, "POST", "/api/sales/orders", {
    customerId: targetCustomer,
    warehouseId,
    orderDate,
    items: [{ productId, quantity }],
  });
  expect(created.statusCode, created.body).toBe(201);
  const orderId = created.json().order.id as string;
  expect((await call(company.ownerCookie, "POST", `/api/sales/orders/${orderId}/confirm`)).statusCode).toBe(200);
  return { orderId, ship: () => call(company.ownerCookie, "POST", `/api/sales/orders/${orderId}/ship`) };
}

const creditStatusOf = async (id: string) =>
  (await db.select({ status: customers.creditStatus, reason: customers.creditHoldReason }).from(customers).where(eq(customers.id, id)))[0]!;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
}, 120_000);

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
  company = await createCompany(app, admin.cookie, { name: "CREDIT-HOLD-CO" });
  other = await createCompany(app, admin.cookie, { name: "CREDIT-OUTSIDER" });

  warehouseId = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  expect((await call(company.ownerCookie, "POST", "/api/finance/setup")).statusCode).toBe(200);
  cashAccountId = (await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId))).find((row) => row.type === "cash")!.id;

  productId = (
    await call(company.ownerCookie, "POST", "/api/catalog/products", { name: "Shakar 50kg", sku: "SH50", baseUnitId: piece, salesPrice: "100000", taxRate: "0" })
  ).json().product.id;
  expect(
    (await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", {
      type: "receive",
      productId,
      warehouseId,
      quantity: "1000",
      costPrice: "70000",
    })).statusCode,
  ).toBe(201);

  customerId = (
    await call(company.ownerCookie, "POST", "/api/sales/customers", {
      name: "QARZDOR MIJOZ",
      phone: uniquePhone("95"),
      creditLimit: "0",
      paymentTermDays: 10,
      ...shop,
    })
  ).json().customer.id;
  foreignCustomerId = (await call(other.ownerCookie, "POST", "/api/sales/customers", { name: "Begona", phone: uniquePhone("96") })).json().customer.id;
});

describe("Kredit to'xtatish (credit hold)", () => {
  it("standart holatda hech narsa o'zgarmaydi — nasiya sotuv o'tadi", async () => {
    const sale = await creditSale(todayIso(), "2");
    expect((await sale.ship()).statusCode).toBe(200);
    expect((await creditStatusOf(customerId)).status).toBe("ok");
    expect((await call(company.ownerCookie, "GET", `/api/sales/customers/${customerId}/credit`)).json().credit).toMatchObject({ allowed: true, status: "ok" });
  });

  it("qo'lda to'xtatish: nasiya rad etiladi, naqd sotuv va qarz to'lash ishlaydi", async () => {
    const first = await creditSale(todayIso(), "3");
    expect((await first.ship()).statusCode).toBe(200); // 300 000 qarz

    const held = await call(company.ownerCookie, "POST", `/api/sales/customers/${customerId}/credit`, {
      status: "hold",
      reason: "To'lov intizomi buzilgan",
    });
    expect(held.statusCode, held.body).toBe(200);
    expect(held.json().customer).toMatchObject({ creditStatus: "hold", creditHoldReason: "To'lov intizomi buzilgan" });

    // Nasiya — rad
    const blocked = await creditSale(todayIso(), "1");
    const shipped = await blocked.ship();
    expect(shipped.statusCode, "nasiya to'xtatilgan").toBe(403);
    expect(shipped.json().details.reason).toBe("credit_hold");

    // Naqd chek — o'tadi (mijoz ko'rsatilgan bo'lsa ham)
    const shift = await call(company.ownerCookie, "POST", "/api/sales/pos/shifts", { warehouseId, openingCash: "0" });
    expect(shift.statusCode, shift.body).toBe(201);
    const pos = await call(company.ownerCookie, "POST", "/api/sales/pos/sales", {
      shiftId: shift.json().shift.id,
      customerId,
      items: [{ productId, quantity: "1" }],
      paymentMethod: "cash",
      amountPaid: "100000",
    });
    expect(pos.statusCode, `naqd sotuv to'xtamaydi: ${pos.body}`).toBe(201);

    // Qarzni to'lash — o'tadi
    const payment = await call(company.ownerCookie, "POST", "/api/sales/payments", {
      customerId,
      amount: "300000",
      method: "cash",
      cashAccountId,
      paymentDate: todayIso(),
    });
    expect(payment.statusCode, "qarz to'lash to'xtamaydi").toBe(201);
  });

  it("siyosat chegarasi: muddati o'tgan kun soni oshsa avtomatik to'xtaydi", async () => {
    const old = await creditSale(shift(-40), "2");
    expect((await old.ship()).statusCode).toBe(200); // muddat 30 kun oldin o'tgan

    expect((await setPolicy({ creditHoldOverdueDays: 15 })).statusCode).toBe(200);

    const next = await creditSale(todayIso(), "1");
    const blocked = await next.ship();
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().details).toMatchObject({ reason: "credit_hold", autoHold: true, maxDaysOverdue: 30 });

    // Siyosat to'xtatishi HOSILAVIY: bazada qo'lda qo'yilgan holat saqlanadi, siyosat esa har
    // chaqiruvda qayta hisoblanadi — mijoz to'lagach to'xtatish o'zi ochiladi
    expect((await creditStatusOf(customerId)).status, "siyosat qo'lda holatni yozmaydi").toBe("ok");
    const credit = (await call(company.ownerCookie, "GET", `/api/sales/customers/${customerId}/credit`)).json().credit;
    expect(credit, "rahbar sababni ko'radi").toMatchObject({ allowed: false, status: "hold", autoHold: true, maxDaysOverdue: 30 });
    expect(credit.reason).toContain("30 kun");

    // Qarz to'langach — to'xtatish o'zi ochiladi
    expect(
      (await call(company.ownerCookie, "POST", "/api/sales/payments", {
        customerId,
        amount: "200000",
        method: "cash",
        cashAccountId,
        paymentDate: todayIso(),
      })).statusCode,
    ).toBe(201);
    expect((await call(company.ownerCookie, "GET", `/api/sales/customers/${customerId}/credit`)).json().credit).toMatchObject({ allowed: true });
    expect((await (await creditSale(todayIso(), "1")).ship()).statusCode, "to'lovdan keyin nasiya ochiladi").toBe(200);
  });

  it("siyosat chegarasi: muddati o'tgan summa oshsa to'xtaydi, chegara ostida o'tadi", async () => {
    const old = await creditSale(shift(-40), "3");
    expect((await old.ship()).statusCode).toBe(200); // 300 000 muddati o'tgan

    expect((await setPolicy({ creditHoldOverdueAmount: "500000" })).statusCode).toBe(200);
    const under = await creditSale(todayIso(), "1");
    expect((await under.ship()).statusCode, "chegara ostida o'tadi").toBe(200);

    expect((await setPolicy({ creditHoldOverdueAmount: "100000" })).statusCode).toBe(200);
    const over = await creditSale(todayIso(), "1");
    expect((await over.ship()).statusCode, "chegaradan oshdi").toBe(403);
  });

  it("rahbar ochadi (override) — audit yoziladi, sotuv davom etadi", async () => {
    const old = await creditSale(shift(-40), "2");
    expect((await old.ship()).statusCode).toBe(200);
    expect((await setPolicy({ creditHoldOverdueDays: 15 })).statusCode).toBe(200);
    expect((await (await creditSale(todayIso(), "1")).ship()).statusCode).toBe(403);

    // Qo'lda "ok" qo'yish siyosat chegarasini bekor qilmaydi — qoida saqlanadi
    expect((await call(company.ownerCookie, "POST", `/api/sales/customers/${customerId}/credit`, { status: "ok", reason: "Kelishildi" })).statusCode).toBe(200);
    expect((await (await creditSale(todayIso(), "1")).ship()).statusCode, "siyosat kuchda").toBe(403);

    // Rahbar chegarani o'chiradi — sotuv davom etadi
    expect((await setPolicy({ creditHoldOverdueDays: null })).statusCode).toBe(200);
    expect((await (await creditSale(todayIso(), "1")).ship()).statusCode).toBe(200);

    // Qo'lda to'xtatish va ochish — ikkalasi ham auditda
    expect(
      (await call(company.ownerCookie, "POST", `/api/sales/customers/${customerId}/credit`, { status: "hold", reason: "Rahbar qarori" })).statusCode,
    ).toBe(200);
    expect((await (await creditSale(todayIso(), "1")).ship()).statusCode).toBe(403);
    expect((await call(company.ownerCookie, "POST", `/api/sales/customers/${customerId}/credit`, { status: "ok", reason: "Rahbar ruxsati" })).statusCode).toBe(200);
    expect((await (await creditSale(todayIso(), "1")).ship()).statusCode).toBe(200);

    const audits = await db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.companyId, company.companyId));
    expect(audits.filter((row) => row.action === "CUSTOMER_CREDIT_RELEASE").length, "ochish auditda").toBeGreaterThanOrEqual(2);
    expect(audits.filter((row) => row.action === "CUSTOMER_CREDIT_HOLD").length, "to'xtatish auditda").toBe(1);
  });

  it("savdo agenti ham chetlab o'ta olmaydi", async () => {
    await setAgentPolicy(company.companyId, { minVisitMinutes: 0, storefrontPhotoRequired: false, shelfPhotoRequired: false, creditDueDateRequired: false });
    const employee = await addEmployee(app, company, "Sotuv agenti");
    const repId = await salesRepOf(app, company.ownerCookie, employee.id, { name: "Agent-1" });
    expect((await call(employee.cookie, "POST", "/api/sales-agent/work-session/start", { ...near, recordedAt: iso() })).statusCode).toBe(201);
    const routeId = (
      await call(company.ownerCookie, "POST", "/api/distribution/routes", { name: "R1", salesRepId: repId, days: [0, 1, 2, 3, 4, 5, 6] })
    ).json().route.id as string;
    expect((await call(company.ownerCookie, "POST", `/api/distribution/routes/${routeId}/customers`, { customerId })).statusCode).toBe(201);

    expect(
      (await call(company.ownerCookie, "POST", `/api/sales/customers/${customerId}/credit`, { status: "hold", reason: "Qarz yig'ilib qoldi" })).statusCode,
    ).toBe(200);

    expect((await call(employee.cookie, "POST", "/api/sales-agent/visits/start", { customerId, ...near, recordedAt: iso() })).statusCode).toBe(201);
    const draft = await call(employee.cookie, "PUT", `/api/sales-agent/orders/drafts/${randomUUID()}`, {
      customerId,
      paymentType: "credit",
      items: [{ productId, pieces: "2" }],
    });
    expect(draft.statusCode, draft.body).toBe(200);
    const submit = await call(employee.cookie, "POST", `/api/sales-agent/orders/${draft.json().order.id}/submit`, { ...near, recordedAt: iso() });
    expect(submit.statusCode, "agent nasiyasi ham to'xtaydi").toBe(403);
    expect(submit.json().details.reason).toBe("credit_hold");

    // Naqd buyurtma esa o'tadi
    const cash = await call(employee.cookie, "PUT", `/api/sales-agent/orders/drafts/${randomUUID()}`, {
      customerId,
      paymentType: "cash",
      items: [{ productId, pieces: "2" }],
    });
    const cashSubmit = await call(employee.cookie, "POST", `/api/sales-agent/orders/${cash.json().order.id}/submit`, { ...near, recordedAt: iso() });
    expect(cashSubmit.statusCode, `agent naqd buyurtmasi: ${cashSubmit.body}`).toBe(200);
  });

  it("xavfsizlik: ruxsatsiz o'zgartirish va begona mijoz", async () => {
    const cashier = await addEmployee(app, company, "Kassir");
    expect(
      (await call(cashier.cookie, "POST", `/api/sales/customers/${customerId}/credit`, { status: "hold", reason: "ruxsatsiz" })).statusCode,
    ).toBe(403);

    expect((await call(company.ownerCookie, "GET", `/api/sales/customers/${foreignCustomerId}/credit`)).statusCode, "begona mijoz").toBe(404);
    expect(
      (await call(company.ownerCookie, "POST", `/api/sales/customers/${foreignCustomerId}/credit`, { status: "hold", reason: "begona" })).statusCode,
    ).toBe(404);

    // Sabab majburiy — sxema rad etadi
    expect((await call(company.ownerCookie, "POST", `/api/sales/customers/${customerId}/credit`, { status: "hold" })).statusCode).toBe(400);
    expect(
      (await call(company.ownerCookie, "POST", `/api/sales/customers/${customerId}/credit`, { status: "hold", reason: "ok", companyId: other.companyId })).statusCode,
    ).toBe(400);
    expect(money((await creditStatusOf(customerId)).status === "hold" ? 1 : 0), "rad etilgan so'rov holatni o'zgartirmaydi").toBe(0);
  });
});
