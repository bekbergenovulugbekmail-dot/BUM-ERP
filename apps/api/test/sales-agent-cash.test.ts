/**
 * Savdo agenti mijozdan pul yig'adi: pul agentning "yo'ldagi naqd" hisobiga tushadi
 * (kassaga emas), kassaga topshirilganda agentdan yechilib kassa qoldig'iga qo'shiladi.
 *
 * Yetkazuvchidagi qoida bilan bir xil — yangi parallel tizim emas, o'sha `transferCash` va
 * universal to'lov taqsimoti ishlatiladi.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { cashAccounts } from "../src/db/schema/finance.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { units } from "../src/db/schema/catalog.js";
import { customerPayments, salesOrders } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { LEGACY_VISIT_POLICY, setAgentPolicy } from "./agent-policy.js";
import { addEmployee, createCompany, resetDatabase, signedIn, salesRepOf } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PATCH" | "PUT";

let app: FastifyInstance;
let company: Company;
let productId: string;
let warehouseId: string;

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

const uuid = () => crypto.randomUUID();

beforeEach(async () => {
  await resetDatabase();
  await db.delete(units);
  await seedDefaultUnits(db);
  const piece = (await db.select().from(units)).find((unit) => unit.shortName === "d")!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Agent Naqd" });
  await setAgentPolicy(company.companyId, LEGACY_VISIT_POLICY);
  warehouseId = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;

  const product = await call(company.ownerCookie, "POST", "/api/catalog/products", {
    name: "Un 50kg",
    sku: "UN50",
    baseUnitId: piece,
    salesPrice: "100000",
    taxRate: "0",
  });
  productId = product.json().product.id as string;
  await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", {
    type: "receive",
    productId,
    warehouseId,
    quantity: "100",
    costPrice: "60000",
  });
});

/** Agent + uning logini; ish sessiyasi ochilgan. */
async function agent(name: string) {
  const employee = await addEmployee(app, company, "Sotuv agenti");
  const repId = await salesRepOf(app, company.ownerCookie, employee.id, { name });
  const session = await call(employee.cookie, "POST", "/api/sales-agent/work-session/start", {
    latitude: 41.3115,
    longitude: 69.2406,
    accuracy: 10,
    recordedAt: new Date().toISOString(),
  });
  expect(session.statusCode).toBe(201);
  return { cookie: employee.cookie, repId: repId };
}

/** Qarzga sotilgan buyurtma — mijozda qarz qoladi. */
async function debtOrder(customerId: string, quantity = "2") {
  const res = await call(company.ownerCookie, "POST", "/api/sales/orders", {
    customerId,
    warehouseId,
    orderDate: new Date().toISOString().slice(0, 10),
    items: [{ productId, quantity }],
  });
  expect(res.statusCode).toBe(201);
  const orderId = res.json().order.id as string;
  expect((await call(company.ownerCookie, "POST", `/api/sales/orders/${orderId}/confirm`, {})).statusCode).toBeLessThan(300);
  return orderId;
}

async function shop(name: string) {
  const res = await call(company.ownerCookie, "POST", "/api/sales/customers", { name, phone: `+9989${Math.floor(10000000 + Math.random() * 89999999)}` });
  expect(res.statusCode).toBe(201);
  return res.json().customer.id as string;
}

const repBalance = async (repId: string) => {
  const [row] = await db.select().from(cashAccounts).where(eq(cashAccounts.salesRepId, repId));
  return row ? Number(row.balance) : null;
};

const mainBalance = async () => {
  const [row] = await db
    .select()
    .from(cashAccounts)
    .where(and(eq(cashAccounts.companyId, company.companyId), eq(cashAccounts.isDefault, true)));
  return Number(row!.balance);
};

describe("Mijozdan pul yig'ish", () => {
  it("naqd pul agentning hisobiga tushadi, asosiy kassaga emas", async () => {
    const { cookie, repId } = await agent("Alisher");
    const customerId = await shop("Do'kon 1");
    const orderId = await debtOrder(customerId);
    const before = await mainBalance();

    const res = await call(cookie, "POST", "/api/sales-agent/payments", {
      customerId,
      orderId,
      clientRequestId: uuid(),
      parts: [{ method: "cash", amount: "50000" }],
    });
    expect(res.statusCode).toBe(201);

    expect(await repBalance(repId)).toBe(50000);
    expect(await mainBalance()).toBe(before);

    // Buyurtma to'lovi yozildi
    const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, orderId));
    expect(Number(order!.paidAmount)).toBe(50000);
  });

  it("agent o'zidagi naqdni ko'radi", async () => {
    const { cookie } = await agent("Bobur");
    const customerId = await shop("Do'kon 2");
    const orderId = await debtOrder(customerId);
    await call(cookie, "POST", "/api/sales-agent/payments", {
      customerId,
      orderId,
      clientRequestId: uuid(),
      parts: [{ method: "cash", amount: "30000" }],
    });

    const res = await call(cookie, "GET", "/api/sales-agent/cash");
    expect(res.statusCode).toBe(200);
    expect(Number(res.json().balance)).toBe(30000);
  });

  it("takroriy yuborishda ikkinchi to'lov yozilmaydi", async () => {
    const { cookie, repId } = await agent("Davron");
    const customerId = await shop("Do'kon 3");
    const orderId = await debtOrder(customerId);
    const clientRequestId = uuid();
    const body = { customerId, orderId, clientRequestId, parts: [{ method: "cash", amount: "40000" }] };

    expect((await call(cookie, "POST", "/api/sales-agent/payments", body)).statusCode).toBe(201);
    expect((await call(cookie, "POST", "/api/sales-agent/payments", body)).statusCode).toBe(200);

    expect(await repBalance(repId)).toBe(40000);
    const payments = await db.select().from(customerPayments).where(eq(customerPayments.companyId, company.companyId));
    expect(payments).toHaveLength(1);
  });

  it("qarzdan ortiq to'lov rad etiladi", async () => {
    const { cookie, repId } = await agent("Eldor");
    const customerId = await shop("Do'kon 4");
    const orderId = await debtOrder(customerId, "1");

    const res = await call(cookie, "POST", "/api/sales-agent/payments", {
      customerId,
      orderId,
      clientRequestId: uuid(),
      parts: [{ method: "cash", amount: "500000" }],
    });
    expect(res.statusCode).toBe(400);
    expect(await repBalance(repId)).toBeNull();
  });

  it("boshqa kompaniyaning mijozidan pul olib bo'lmaydi", async () => {
    const { cookie } = await agent("Farrux");
    const admin = await signedIn(app, { isPlatformAdmin: true });
    const other = await createCompany(app, admin.cookie, { name: "Begona" });
    const otherCustomer = (await call(other.ownerCookie, "POST", "/api/sales/customers", { name: "Begona mijoz", phone: "+998907777777" }))
      .json().customer.id as string;

    const res = await call(cookie, "POST", "/api/sales-agent/payments", {
      customerId: otherCustomer,
      clientRequestId: uuid(),
      parts: [{ method: "cash", amount: "10000" }],
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe("Naqdni kassaga topshirish", () => {
  async function collected(name: string, amount: string) {
    const { cookie, repId } = await agent(name);
    const customerId = await shop(`Do'kon ${name}`);
    const orderId = await debtOrder(customerId, "5");
    expect(
      (
        await call(cookie, "POST", "/api/sales-agent/payments", {
          customerId,
          orderId,
          clientRequestId: uuid(),
          parts: [{ method: "cash", amount }],
        })
      ).statusCode,
    ).toBe(201);
    return { cookie, repId };
  }

  it("agentdan yechiladi va kassaga qo'shiladi", async () => {
    const { repId } = await collected("Gulom", "100000");
    const before = await mainBalance();

    const res = await call(company.ownerCookie, "POST", `/api/distribution/sales-reps/${repId}/cash-handover`, {
      amount: "60000",
      notes: "Kechki topshirish",
    });
    expect(res.statusCode).toBe(201);

    expect(await repBalance(repId)).toBe(40000);
    expect(await mainBalance()).toBe(before + 60000);
  });

  it("agentdagi summadan ortiq topshirib bo'lmaydi", async () => {
    const { repId } = await collected("Hasan", "50000");
    const res = await call(company.ownerCookie, "POST", `/api/distribution/sales-reps/${repId}/cash-handover`, { amount: "80000" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error?.details?.reason ?? res.json().details?.reason).toBe("exceeds_agent_cash");
    expect(await repBalance(repId)).toBe(50000);
  });

  it("boshqa agentning hisobiga topshirib bo'lmaydi", async () => {
    const first = await collected("Ibrohim", "50000");
    const second = await collected("Jasur", "20000");
    const [target] = await db.select().from(cashAccounts).where(eq(cashAccounts.salesRepId, second.repId));

    const res = await call(company.ownerCookie, "POST", `/api/distribution/sales-reps/${first.repId}/cash-handover`, {
      amount: "10000",
      toCashAccountId: target!.id,
    });
    expect(res.statusCode).toBe(400);
    expect(await repBalance(first.repId)).toBe(50000);
    expect(await repBalance(second.repId)).toBe(20000);
  });

  it("agentning o'zi topshira olmaydi (distribution.manage kerak)", async () => {
    const { cookie, repId } = await collected("Kamol", "30000");
    const res = await call(cookie, "POST", `/api/distribution/sales-reps/${repId}/cash-handover`, { amount: "10000" });
    expect(res.statusCode).toBe(403);
    expect(await repBalance(repId)).toBe(30000);
  });

  it("topshirilgandan keyin tarix ko'rinadi", async () => {
    const { repId } = await collected("Lutfulla", "70000");
    await call(company.ownerCookie, "POST", `/api/distribution/sales-reps/${repId}/cash-handover`, { amount: "70000" });

    const res = await call(company.ownerCookie, "GET", `/api/distribution/sales-reps/${repId}/cash`);
    expect(res.statusCode).toBe(200);
    expect(Number(res.json().cash.balance)).toBe(0);
    expect(res.json().cash.handovers).toHaveLength(1);
  });
});

describe("Moliyada ko'rinishi", () => {
  it("agent hisobi kassalar ro'yxatida alohida turadi", async () => {
    const { cookie, repId } = await agent("Mansur");
    const customerId = await shop("Do'kon M");
    const orderId = await debtOrder(customerId);
    await call(cookie, "POST", "/api/sales-agent/payments", {
      customerId,
      orderId,
      clientRequestId: uuid(),
      parts: [{ method: "cash", amount: "25000" }],
    });

    const accounts = await db
      .select()
      .from(cashAccounts)
      .where(and(eq(cashAccounts.companyId, company.companyId), isNotNull(cashAccounts.salesRepId)));
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.salesRepId).toBe(repId);
    expect(accounts[0]!.name).toContain("yo'ldagi naqd");
  });

  /**
   * "Pulni qayerda topshiraman?" — sotuv va dostavka agentlari ikki xil bo'limda edi.
   * Moliyadagi yagona ro'yxat shu savolga javob beradi; pul yig'ilmagan bo'lsa ro'yxat bo'sh.
   */
  it("moliyada 'agentlardagi naqd' ro'yxati topshirilmagan pulni ko'rsatadi", async () => {
    const bosh = await call(company.ownerCookie, "GET", "/api/finance/agent-cash");
    expect(bosh.statusCode, bosh.body).toBe(200);
    expect(bosh.json().holders, "pul yig'ilmagan — ro'yxat bo'sh").toEqual([]);

    const { cookie, repId } = await agent("Nodir");
    const customerId = await shop("Do'kon N");
    const orderId = await debtOrder(customerId);
    expect(
      (
        await call(cookie, "POST", "/api/sales-agent/payments", {
          customerId,
          orderId,
          clientRequestId: uuid(),
          parts: [{ method: "cash", amount: "45000" }],
        })
      ).statusCode,
    ).toBe(201);

    const res = await call(company.ownerCookie, "GET", "/api/finance/agent-cash");
    expect(res.statusCode, res.body).toBe(200);
    const holders = res.json().holders as { kind: string; holderId: string; balance: string; name: string }[];
    expect(holders).toHaveLength(1);
    expect(holders[0]).toMatchObject({ kind: "sales_rep", holderId: repId });
    expect(Number(holders[0]!.balance)).toBe(45000);

    // Topshirilgandan keyin ro'yxatdan chiqadi — qoldiq nolga tushadi
    expect(
      (await call(company.ownerCookie, "POST", `/api/distribution/sales-reps/${repId}/cash-handover`, { amount: "45000" })).statusCode,
    ).toBe(201);
    expect((await call(company.ownerCookie, "GET", "/api/finance/agent-cash")).json().holders).toEqual([]);
  });

  it("begona kompaniyaning agenti ro'yxatda ko'rinmaydi", async () => {
    const { cookie } = await agent("Ulug'bek");
    const customerId = await shop("Do'kon U");
    const orderId = await debtOrder(customerId);
    await call(cookie, "POST", "/api/sales-agent/payments", {
      customerId,
      orderId,
      clientRequestId: uuid(),
      parts: [{ method: "cash", amount: "15000" }],
    });

    const admin = await signedIn(app, { isPlatformAdmin: true });
    const other = await createCompany(app, admin.cookie, { name: "Begona kompaniya" });
    const res = await call(other.ownerCookie, "GET", "/api/finance/agent-cash");
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().holders).toEqual([]);
  });
});
