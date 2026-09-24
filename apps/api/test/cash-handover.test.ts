/**
 * PUL TOPSHIRISH: SUBMIT → ACCEPT / REJECT (6-vazifa).
 *
 * Asosiy moliyaviy qoida: pul FAQAT qabul qilinganda ko'chadi. Shuning uchun rad etishda
 * qaytariladigan yozuv yo'q — summa o'z-o'zidan agentda qoladi va u qayta topshira oladi.
 * Hech qanday bosqichda pul IKKI MARTA hisoblanmasligi kerak.
 */
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { cashAccounts } from "../src/db/schema/finance.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { LEGACY_VISIT_POLICY, setAgentPolicy } from "./agent-policy.js";
import { addEmployee, createCompany, resetDatabase, salesRepOf, signedIn, uniquePhone } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST";

let app: FastifyInstance;
let company: Company;
let warehouseId: string;
let productId: string;
let mainCash: string;

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
  const piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Topshirish kompaniyasi" });
  await setAgentPolicy(company.companyId, LEGACY_VISIT_POLICY);
  warehouseId = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  mainCash = (await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId)))
    .find((row) => row.type === "cash")!.id;

  const product = await call(company.ownerCookie, "POST", "/api/catalog/products", {
    name: "Un", sku: "UN", baseUnitId: piece, salesPrice: "100000", taxRate: "0",
  });
  productId = product.json().product.id as string;
  await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", {
    type: "receive", productId, warehouseId, quantity: "100", costPrice: "60000",
  });
});

/** Agent yaratadi va mijozdan naqd yig'adi — pul agentning "yo'ldagi naqd" hisobiga tushadi. */
async function agentWithCash(amount: string) {
  const employee = await addEmployee(app, company, "Sotuv agenti");
  const repId = await salesRepOf(app, company.ownerCookie, employee.id, { name: "Naqd agenti" });

  const customer = await call(company.ownerCookie, "POST", "/api/sales/customers", {
    name: "Do'kon", phone: uniquePhone(),
  });
  const customerId = customer.json().customer.id as string;

  const order = await call(company.ownerCookie, "POST", "/api/sales/orders", {
    customerId, warehouseId, orderDate: new Date().toISOString().slice(0, 10),
    items: [{ productId, quantity: "5", unitPrice: "100000" }],
  });
  const orderId = order.json().order.id as string;
  expect((await call(company.ownerCookie, "POST", `/api/sales/orders/${orderId}/confirm`)).statusCode).toBe(200);
  expect((await call(company.ownerCookie, "POST", `/api/sales/orders/${orderId}/ship`)).statusCode).toBe(200);

  const paid = await call(employee.cookie, "POST", "/api/sales-agent/payments", {
    customerId, orderId, clientRequestId: uuid(), parts: [{ method: "cash", amount }],
  });
  expect(paid.statusCode, paid.body).toBe(201);
  return { employee, repId };
}

const agentCash = async (repId: string) => {
  const [row] = await db
    .select({ balance: cashAccounts.balance })
    .from(cashAccounts)
    .where(and(eq(cashAccounts.companyId, company.companyId), eq(cashAccounts.salesRepId, repId)));
  return Number(row?.balance ?? 0);
};

const mainCashBalance = async () => {
  const [row] = await db.select({ balance: cashAccounts.balance }).from(cashAccounts).where(eq(cashAccounts.id, mainCash));
  return Number(row!.balance);
};

describe("Pul topshirish hayot sikli", () => {
  it("topshirishda pul KO'CHMAYDI — faqat hujjat yaratiladi", async () => {
    const { employee, repId } = await agentWithCash("300000");
    const before = { agent: await agentCash(repId), kassa: await mainCashBalance() };

    const res = await call(employee.cookie, "POST", "/api/finance/handovers", {
      cashAmount: "300000", cardAmount: "200000", notes: "Kunlik tushum",
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().handover).toMatchObject({
      status: "submitted", cashAmount: "300000.00", cardAmount: "200000.00", totalAmount: "500000.00",
    });

    expect(await agentCash(repId), "agentdagi naqd o'zgarmadi").toBe(before.agent);
    expect(await mainCashBalance(), "kassa o'zgarmadi").toBe(before.kassa);
  });

  it("qabul qilinganda naqd kassaga ko'chadi (karta ikkinchi marta hisoblanmaydi)", async () => {
    const { employee, repId } = await agentWithCash("300000");
    const kassaBefore = await mainCashBalance();

    const submitted = await call(employee.cookie, "POST", "/api/finance/handovers", {
      cashAmount: "300000", cardAmount: "200000",
    });
    const id = submitted.json().handover.id as string;

    const accepted = await call(company.ownerCookie, "POST", `/api/finance/handovers/${id}/accept`);
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json().handover).toMatchObject({ status: "accepted", acceptedCashAmount: "300000.00" });

    expect(await agentCash(repId), "agentda naqd qolmadi").toBe(0);
    // FAQAT naqd ko'chadi: karta puli allaqachon bank/karta hisobida, ikkinchi marta qo'shilmaydi
    expect(await mainCashBalance() - kassaBefore, "kassaga faqat naqd tushdi").toBe(300_000);
  });

  it("rad etilsa pul agentda qoladi va u QAYTA topshira oladi — ikki marta hisoblanmaydi", async () => {
    const { employee, repId } = await agentWithCash("300000");
    const kassaBefore = await mainCashBalance();

    const first = await call(employee.cookie, "POST", "/api/finance/handovers", { cashAmount: "300000" });
    const firstId = first.json().handover.id as string;

    const rejected = await call(company.ownerCookie, "POST", `/api/finance/handovers/${firstId}/reject`, {
      reason: "Kassada 280 000 chiqdi",
    });
    expect(rejected.statusCode, rejected.body).toBe(200);
    expect(rejected.json().handover.status).toBe("rejected");
    expect(await agentCash(repId), "pul agentda qoldi").toBe(300_000);
    expect(await mainCashBalance(), "kassa tegilmadi").toBe(kassaBefore);

    // Qayta topshiradi va bu safar qabul qilinadi
    const second = await call(employee.cookie, "POST", "/api/finance/handovers", { cashAmount: "300000" });
    expect(second.statusCode, second.body).toBe(201);
    const secondId = second.json().handover.id as string;
    expect((await call(company.ownerCookie, "POST", `/api/finance/handovers/${secondId}/accept`)).statusCode).toBe(200);

    expect(await agentCash(repId)).toBe(0);
    expect(await mainCashBalance() - kassaBefore, "pul BIR marta ko'chdi").toBe(300_000);
    // Rad etilgan hujjat tarixda qoladi
    const list = (await call(company.ownerCookie, "GET", "/api/finance/handovers")).json().handovers as
      { status: string }[];
    expect(list.map((row) => row.status).sort()).toEqual(["accepted", "rejected"]);
  });

  it("sanoqda farq bo'lsa kamroq qabul qilinadi; qolgani agentda qoladi", async () => {
    const { employee, repId } = await agentWithCash("300000");
    const kassaBefore = await mainCashBalance();

    const submitted = await call(employee.cookie, "POST", "/api/finance/handovers", { cashAmount: "300000" });
    const id = submitted.json().handover.id as string;

    const accepted = await call(company.ownerCookie, "POST", `/api/finance/handovers/${id}/accept`, {
      acceptedCashAmount: "280000", notes: "20 000 farq",
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json().handover.acceptedCashAmount).toBe("280000.00");
    expect(await mainCashBalance() - kassaBefore).toBe(280_000);
    expect(await agentCash(repId), "farq agentda qoldi").toBe(20_000);
  });

  it("topshirilganidan ortiq qabul qilib bo'lmaydi", async () => {
    const { employee } = await agentWithCash("300000");
    const submitted = await call(employee.cookie, "POST", "/api/finance/handovers", { cashAmount: "300000" });
    const id = submitted.json().handover.id as string;

    const res = await call(company.ownerCookie, "POST", `/api/finance/handovers/${id}/accept`, {
      acceptedCashAmount: "400000",
    });
    expect(res.statusCode, res.body).toBe(400);
  });

  it("bitta topshirish ikki marta qabul qilinmaydi (idempotentlik)", async () => {
    const { employee, repId } = await agentWithCash("300000");
    const kassaBefore = await mainCashBalance();
    const submitted = await call(employee.cookie, "POST", "/api/finance/handovers", { cashAmount: "300000" });
    const id = submitted.json().handover.id as string;

    expect((await call(company.ownerCookie, "POST", `/api/finance/handovers/${id}/accept`)).statusCode).toBe(200);
    const again = await call(company.ownerCookie, "POST", `/api/finance/handovers/${id}/accept`);
    expect(again.statusCode, "takroriy qabul rad etiladi").toBe(409);

    expect(await mainCashBalance() - kassaBefore, "pul bir marta ko'chdi").toBe(300_000);
    expect(await agentCash(repId)).toBe(0);
  });

  it("ko'rib chiqilmagan topshirish turganda ikkinchisi yaratilmaydi", async () => {
    const { employee } = await agentWithCash("300000");
    expect((await call(employee.cookie, "POST", "/api/finance/handovers", { cashAmount: "100000" })).statusCode).toBe(201);
    const second = await call(employee.cookie, "POST", "/api/finance/handovers", { cashAmount: "100000" });
    expect(second.statusCode, second.body).toBe(409);
  });

  it("agentdagi naqddan ortiq topshirib bo'lmaydi", async () => {
    const { employee } = await agentWithCash("300000");
    const res = await call(employee.cookie, "POST", "/api/finance/handovers", { cashAmount: "500000" });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().details.reason).toBe("exceeds_agent_cash");
  });

  it("rad etishda sabab majburiy", async () => {
    const { employee } = await agentWithCash("300000");
    const submitted = await call(employee.cookie, "POST", "/api/finance/handovers", { cashAmount: "300000" });
    const id = submitted.json().handover.id as string;
    expect((await call(company.ownerCookie, "POST", `/api/finance/handovers/${id}/reject`, { reason: "" })).statusCode).toBe(400);
  });

  it("solishtirish: qo'ldagi, topshirilgan va qabul qilingan summalar ko'rinadi", async () => {
    const { employee } = await agentWithCash("300000");
    const before = (await call(employee.cookie, "GET", "/api/finance/handovers/mine")).json().summaries as
      { summary: { cashOnHand: string; outstandingCash: string; submittedCash: string } }[];
    expect(before[0]!.summary).toMatchObject({ cashOnHand: "300000.00", submittedCash: "0.00", outstandingCash: "300000.00" });

    const submitted = await call(employee.cookie, "POST", "/api/finance/handovers", { cashAmount: "300000" });
    const pending = (await call(employee.cookie, "GET", "/api/finance/handovers/mine")).json().summaries as
      { summary: { submittedCash: string; outstandingCash: string } }[];
    expect(pending[0]!.summary, "topshirilgan, lekin hali qabul qilinmagan").toMatchObject({
      submittedCash: "300000.00", outstandingCash: "0.00",
    });

    const id = submitted.json().handover.id as string;
    expect((await call(company.ownerCookie, "POST", `/api/finance/handovers/${id}/accept`)).statusCode).toBe(200);
    const after = (await call(employee.cookie, "GET", "/api/finance/handovers/mine")).json().summaries as
      { summary: { cashOnHand: string; acceptedCash: string } }[];
    expect(after[0]!.summary).toMatchObject({ cashOnHand: "0.00", acceptedCash: "300000.00" });
  });
});
