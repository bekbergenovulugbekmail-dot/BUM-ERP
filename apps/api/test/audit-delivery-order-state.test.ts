/**
 * AUD-007 va AUD-023: buyurtma holati va yetkazma vazifasi mosligi.
 *  - AUD-007: tasdiqlangan buyurtma bekor qilinsa, uning ochiq (hali yo'lga chiqmagan) yetkazma vazifasi ham bekor bo'ladi —
 *    haydovchi ro'yxatida zombi vazifa qolmaydi; voqea va audit yoziladi.
 *  - AUD-023: yo'ldagi buyurtma idorada to'liq qaytarilsa, haydovchi uni "yetkazildi" deb tasdiqlay olmaydi (409) —
 *    haydovchidan mavjud bo'lmagan pul kutilmaydi.
 */
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { deliveryEvents, deliveryTasks } from "../src/db/schema/delivery.js";
import { auditLogs } from "../src/db/schema/platform.js";
import { salesOrders } from "../src/db/schema/sales.js";
import { buildServer } from "../src/server.js";
import {
  NO_PROOFS,
  agentAction,
  arrivedTask,
  assign,
  caller,
  confirmedOrder,
  deliveryAgent,
  deliveryCompany,
  near,
  resetUnits,
  setPolicy,
  startShift,
  taskForOrder,
} from "./delivery-setup.js";
import { resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
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
  const adminCookie = (await signedIn(app, { isPlatformAdmin: true })).cookie;
  company = await deliveryCompany(app, adminCookie, "Yetkazma holati");
  await setPolicy(app, company.ownerCookie, NO_PROOFS);
});

const taskStatus = async (taskId: string) => (await db.select({ status: deliveryTasks.status }).from(deliveryTasks).where(eq(deliveryTasks.id, taskId)))[0]!.status;

describe("Buyurtma holati ↔ yetkazma (AUD-007, AUD-023)", () => {
  it("AUD-007: bekor qilingan buyurtmaning ochiq vazifalari bekor bo'ladi (ready va qabul qilingan)", async () => {
    const agent = await deliveryAgent(app, company);
    // 1) hali biriktirilmagan (ready)
    const orderA = await confirmedOrder(app, company, "2");
    const taskA = (await taskForOrder(app, company.ownerCookie, orderA)).id;
    expect(await taskStatus(taskA)).toBe("ready");
    // 2) biriktirilgan va agent qabul qilgan (accepted)
    const orderB = await confirmedOrder(app, company, "3");
    const taskB = (await taskForOrder(app, company.ownerCookie, orderB)).id;
    await assign(app, company.ownerCookie, taskB, agent.id);
    await startShift(app, agent.cookie);
    expect((await agentAction(app, agent.cookie, taskB, "accept")).statusCode).toBe(200);
    expect(await taskStatus(taskB)).toBe("accepted");

    for (const [orderId, taskId] of [[orderA, taskA], [orderB, taskB]] as const) {
      const cancelled = await call(company.ownerCookie, "POST", `/api/sales/orders/${orderId}/cancel`, { reason: "Mijoz voz kechdi" });
      expect(cancelled.statusCode, cancelled.body).toBe(200);
      expect(await taskStatus(taskId), "vazifa ham bekor").toBe("cancelled");
      const events = await db.select().from(deliveryEvents).where(and(eq(deliveryEvents.taskId, taskId), eq(deliveryEvents.action, "CANCELLED")));
      expect(events).toHaveLength(1);
      const audit = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "DELIVERY_CANCELLED"), eq(auditLogs.resourceId, taskId)));
      expect(audit).toHaveLength(1);
    }
    // Haydovchi ro'yxatida bekor qilingan vazifa amal qilmaydi
    expect((await agentAction(app, agent.cookie, taskB, "start")).statusCode).toBe(409);
  });

  it("AUD-023: yo'ldagi buyurtma to'liq qaytarilgach, yetkazildi deb tasdiqlab bo'lmaydi", async () => {
    const agent = await deliveryAgent(app, company);
    await startShift(app, agent.cookie);
    const { orderId, taskId } = await arrivedTask(app, company, agent, "4");
    const [shipped] = await db.select({ status: salesOrders.status }).from(salesOrders).where(eq(salesOrders.id, orderId));
    expect(shipped!.status, "yo'lga chiqishda buyurtma jo'natiladi").not.toBe("confirmed");

    const returned = await call(company.ownerCookie, "POST", `/api/sales/orders/${orderId}/return`, { refund: false, reason: "Mijoz rad etdi (idora)" });
    expect(returned.statusCode, returned.body).toBe(200);

    const confirm = await agentAction(app, agent.cookie, taskId, "confirm", near(20));
    expect(confirm.statusCode, confirm.body).toBe(409);
    expect(confirm.json().details).toMatchObject({ reason: "order_not_deliverable", orderStatus: "returned" });
    expect(await taskStatus(taskId), "vazifa yetkazildi bo'lmadi").toBe("arrived");
  });
});
