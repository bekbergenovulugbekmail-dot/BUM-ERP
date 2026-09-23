/**
 * YETKAZMA NAKLADNOYI — agentga biriktirilgan kunlik yetkazmalar qog'ozi.
 *
 * Nima tekshiriladi: faqat SHU agentning va SHU kunning yetkazmalari chiqadi, bekor qilingani
 * chiqmaydi, mijoz qarzi faqat moliya ruxsati bilan qo'shiladi va begona kompaniya agenti topilmaydi.
 * Qarz — qog'ozga chiqadigan maxfiy ma'lumot, shuning uchun uning gate'i alohida tekshiriladi.
 */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../src/db/client.js";
import { buildServer } from "../src/server.js";
import {
  caller,
  confirmedOrder,
  deliveryAgent,
  deliveryCompany,
  localToday,
  localTomorrow,
  resetUnits,
  taskForOrder,
  type DeliveryCompany,
} from "./delivery-setup.js";
import { addEmployee, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let call: ReturnType<typeof caller>;
let adminCookie: string;
let company: DeliveryCompany;
let agent: Awaited<ReturnType<typeof deliveryAgent>>;

type WaybillRow = { number: string; customerName: string; orderTotal: string; customerDebt: string | null };
type Waybill = { agent: { code: string; name: string | null }; warehouseName: string | null; tasks: WaybillRow[] };

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
  company = await deliveryCompany(app, adminCookie, "Nakladnoy kompaniyasi");
  agent = await deliveryAgent(app, company);
});

/**
 * Tasdiqlangan buyurtma → yetkazma → agentga biriktirish.
 * Yetkazma BUGUNGI kunga yaratiladi; boshqa kun kerak bo'lsa ko'chiriladi (`reschedule`).
 */
async function assignedTask(date: string) {
  const orderId = await confirmedOrder(app, company);
  const task = await taskForOrder(app, company.ownerCookie, orderId);
  if (date !== localToday()) {
    const moved = await call(company.ownerCookie, "POST", `/api/delivery/tasks/${task.id}/reschedule`, { scheduledDate: date });
    expect(moved.statusCode, moved.body).toBe(200);
  }
  const assigned = await call(company.ownerCookie, "POST", `/api/delivery/tasks/${task.id}/assign`, { deliveryAgentId: agent.id });
  expect(assigned.statusCode, assigned.body).toBe(200);
  return task;
}

const waybill = (cookie: string, date: string, agentId = agent.id) =>
  call(cookie, "GET", `/api/delivery/waybill?agentId=${agentId}&date=${date}`);

describe("Yetkazma nakladnoyi", () => {
  it("faqat shu agentning shu kundagi yetkazmalari chiqadi", async () => {
    const today = localToday();
    await assignedTask(today);
    await assignedTask(today);
    // Ertangi kunga biriktirilgani bugungi qog'ozga tushmaydi
    await assignedTask(localTomorrow());

    const res = await waybill(company.ownerCookie, today);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Waybill;
    expect(body.agent.code).toBe(agent.code);
    expect(body.tasks).toHaveLength(2);
    for (const task of body.tasks) {
      expect(task.customerName, "mijoz nomi qog'ozda").toBeTruthy();
      expect(Number(task.orderTotal), "summa qog'ozda").toBeGreaterThan(0);
    }
  });

  it("bekor qilingan yetkazma qog'ozga chiqmaydi", async () => {
    const today = localToday();
    const keep = await assignedTask(today);
    const cancelled = await assignedTask(today);
    expect(
      (await call(company.ownerCookie, "POST", `/api/delivery/tasks/${cancelled.id}/cancel`, { reason: "Mijoz rad etdi" })).statusCode,
    ).toBe(200);

    const body = (await waybill(company.ownerCookie, today)).json() as Waybill;
    expect(body.tasks.map((task) => task.number)).toEqual([keep.number]);
  });

  it("mijoz qarzi faqat moliya ruxsati bilan qo'shiladi", async () => {
    const today = localToday();
    await assignedTask(today);

    const owner = (await waybill(company.ownerCookie, today)).json() as Waybill;
    expect(owner.tasks[0]!.customerDebt, "egada qarz ko'rinadi").not.toBeNull();

    // Ombor menejerida `finance.view` yo'q — qarz yuborilmaydi
    const warehouse = await addEmployee(app, company, "Ombor menejeri");
    const limited = await waybill(warehouse.cookie, today);
    expect(limited.statusCode, limited.body).toBe(200);
    expect((limited.json() as Waybill).tasks[0]!.customerDebt, "qarz yashirilgan").toBeNull();
  });

  it("begona kompaniyaning agenti topilmaydi", async () => {
    const other = await deliveryCompany(app, adminCookie, "Begona kompaniya");
    const res = await waybill(other.ownerCookie, localToday());
    expect(res.statusCode, res.body).toBe(404);
  });

  it("yetkazmasi yo'q kunda bo'sh ro'yxat qaytadi (xato emas)", async () => {
    const res = await waybill(company.ownerCookie, localTomorrow());
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as Waybill).tasks).toEqual([]);
  });
});
