/**
 * F-01: yetkazib bo'lmagan (va qisman yetkazilgan) yetkazmaning tovari yetkazuvchida qoladi —
 * sotuv "yakunlangan" bo'lib turadi va mijozda qarz qoladi. Shuning uchun boshqaruvchi bunday
 * yetkazmalarni ro'yxatda KO'RISHI kerak: `returnPending` belgisi va shu bo'yicha filtr.
 *
 * Qaytarish qabul qilingach belgi o'chadi, sotuv `returned` bo'ladi va qarz yopiladi.
 */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../src/db/client.js";
import { buildServer } from "../src/server.js";
import {
  NO_PROOFS,
  agentAction,
  arrivedTask,
  caller,
  deliveryAgent,
  deliveryCompany,
  near,
  resetUnits,
  setPolicy,
  startShift,
} from "./delivery-setup.js";
import { resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let adminCookie: string;
let company: Awaited<ReturnType<typeof deliveryCompany>>;
let call: ReturnType<typeof caller>;

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
  company = await deliveryCompany(app, adminCookie, "Qaytarish nazorati");
});

const owner = () => company.ownerCookie;

/** Boshqaruvchi ro'yxatidan bitta yetkazma. */
async function taskRow(taskId: string, query = "") {
  const res = await call(owner(), "GET", `/api/delivery/tasks?limit=200${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json().tasks as { id: string; status: string; returnPending: boolean }[]).find((task) => task.id === taskId);
}

describe("Qaytarish kutilmoqda (F-01)", () => {
  it("yetkazib bo'lmagan yetkazma ro'yxatda belgilanadi va filtr bilan topiladi; qabul qilingach belgi o'chadi", async () => {
    await setPolicy(app, owner(), NO_PROOFS);
    const agent = await deliveryAgent(app, company);
    await startShift(app, agent.cookie);
    const { taskId, orderId } = await arrivedTask(app, company, agent);

    // Yetkazib bo'lmadi: tovar yetkazuvchida qoldi
    const failed = await agentAction(app, agent.cookie, taskId, "fail", { reason: "customer_absent", ...near(20) });
    expect(failed.statusCode, failed.body).toBe(200);

    const pending = await taskRow(taskId);
    expect(pending?.status).toBe("failed");
    expect(pending?.returnPending, "yetkazilmagan tovar — qaytarish kutilmoqda").toBe(true);

    // Filtr: faqat qaytarish kutayotganlar
    const filtered = await call(owner(), "GET", "/api/delivery/tasks?returnPending=true&limit=200");
    expect(filtered.statusCode).toBe(200);
    expect((filtered.json().tasks as { id: string }[]).map((task) => task.id)).toEqual([taskId]);

    // Mijozda qarz bor (tovar hali qaytarilmagan)
    const before = await call(owner(), "GET", `/api/sales/customers/${company.customerId}`);
    expect(Number(before.json().customer.totalDebt)).toBeGreaterThan(0);

    // Ombor tovarni qabul qiladi
    const returned = await call(owner(), "POST", `/api/delivery/tasks/${taskId}/return`, { refundMethod: "balance" });
    expect(returned.statusCode, returned.body).toBe(200);

    const after = await taskRow(taskId);
    expect(after?.status).toBe("returned");
    expect(after?.returnPending, "qabul qilingach belgi o'chadi").toBe(false);

    const order = await call(owner(), "GET", `/api/sales/orders/${orderId}`);
    expect(order.json().order.status).toBe("returned");
    const customer = await call(owner(), "GET", `/api/sales/customers/${company.customerId}`);
    expect(Number(customer.json().customer.totalDebt), "qarz yopiladi").toBe(0);

    const empty = await call(owner(), "GET", "/api/delivery/tasks?returnPending=true&limit=200");
    expect((empty.json().tasks as unknown[]).length).toBe(0);
  });

  it("qisman yetkazilgan yetkazma ham qaytarish kutayotganlar ro'yxatida bo'ladi", async () => {
    await setPolicy(app, owner(), NO_PROOFS);
    const agent = await deliveryAgent(app, company);
    await startShift(app, agent.cookie);
    const { taskId } = await arrivedTask(app, company, agent, "10");

    await agentAction(app, agent.cookie, taskId, "delivering");
    const detail = await call(agent.cookie, "GET", `/api/delivery/agent/tasks/${taskId}`);
    const item = (detail.json().task.items as { id: string }[])[0]!;
    const confirmed = await agentAction(app, agent.cookie, taskId, "confirm", {
      ...near(20),
      items: [{ taskItemId: item.id, deliveredQty: "6" }],
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);

    const partial = await taskRow(taskId);
    expect(partial?.status).toBe("partially_delivered");
    expect(partial?.returnPending, "qolgan 4 dona hali omborda emas").toBe(true);

    await call(owner(), "POST", `/api/delivery/tasks/${taskId}/return`, { refundMethod: "balance" });
    expect((await taskRow(taskId))?.returnPending).toBe(false);
  });

  it("yetkazilgan yetkazmada belgi yo'q", async () => {
    await setPolicy(app, owner(), NO_PROOFS);
    const agent = await deliveryAgent(app, company);
    await startShift(app, agent.cookie);
    const { taskId } = await arrivedTask(app, company, agent);
    await agentAction(app, agent.cookie, taskId, "delivering");
    await agentAction(app, agent.cookie, taskId, "confirm", near(20));

    const row = await taskRow(taskId);
    expect(row?.status).toBe("delivered");
    expect(row?.returnPending).toBe(false);
  });
});
