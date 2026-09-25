/**
 * Qisman yetkazilgan QOLDIQNI qayta yetkazish (ORDER ≠ DELIVERY).
 *
 * Shu paytgacha qoldiq uchun yagona yo'l — omborga qabul qilish edi (sotuv va qarz kamayadi). Endi mijoz
 * "qolganini ertaga olib keling" desa, qoldiq uchun YANGI yetkazma ochiladi: buyurtma, zaxira, qarz va jurnal
 * o'zgarmaydi (tovar allaqachon jo'natilgan va yetkazuvchida).
 *
 * Asosiy invariant: qoldiq bir vaqtda faqat BITTA tirik yetkazmada. Qayta yetkazma ochiq bo'lsa, asl yetkazmadan
 * omborga qabul qilinmaydi; qoldiq omborga qabul qilingan bo'lsa, qayta yetkazma ochilmaydi.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../src/db/client.js";
import { buildServer } from "../src/server.js";
import {
  NO_PROOFS,
  agentAction,
  arrivedTask,
  assign,
  caller,
  deliveryAgent,
  deliveryCompany,
  localToday,
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
  company = await deliveryCompany(app, adminCookie, "Qayta yetkazish");
  await setPolicy(app, company.ownerCookie, NO_PROOFS);
});

const owner = () => company.ownerCookie;

type TaskRow = { id: string; status: string; returnPending: boolean; expectedAmount: string; orderId: string };

async function taskRow(taskId: string) {
  const res = await call(owner(), "GET", "/api/delivery/tasks?limit=200");
  expect(res.statusCode, res.body).toBe(200);
  return (res.json().tasks as TaskRow[]).find((task) => task.id === taskId);
}

async function detail(taskId: string) {
  const res = await call(owner(), "GET", `/api/delivery/tasks/${taskId}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().task as {
    id: string;
    number: string;
    status: string;
    expectedAmount: string;
    returnPending: boolean;
    originTask: { id: string; number: string } | null;
    redelivery: { id: string; number: string; status: string } | null;
    items: { id: string; productId: string; quantity: string; deliveredQty: string | null; returnedQty: string }[];
    events: { action: string; details: Record<string, unknown> | null }[];
  };
}

/** Bitta qatorli buyurtma: `quantity` dan `deliveredQty` yetkaziladi, qolgani yetkazuvchida qoladi. */
async function partiallyDelivered(agent: { id: string; cookie: string }, quantity = "10", deliveredQty = "6") {
  const { taskId, orderId } = await arrivedTask(app, company, agent, quantity);
  await agentAction(app, agent.cookie, taskId, "delivering");
  const view = await call(agent.cookie, "GET", `/api/delivery/agent/tasks/${taskId}`);
  const item = (view.json().task.items as { id: string }[])[0]!;
  const confirmed = await agentAction(app, agent.cookie, taskId, "confirm", { ...near(20), items: [{ taskItemId: item.id, deliveredQty }] });
  expect(confirmed.statusCode, confirmed.body).toBe(200);
  expect(confirmed.json().summary.status).toBe("partially_delivered");
  return { taskId, orderId };
}

const redeliver = (taskId: string, body: Record<string, unknown> = {}) => call(owner(), "POST", `/api/delivery/tasks/${taskId}/redeliver`, body);

async function stockQty() {
  const res = await call(owner(), "GET", `/api/inventory/stock?warehouseId=${company.warehouseId}`);
  const row = (res.json().stock as { productId: string; quantity: string }[]).find((item) => item.productId === company.productId);
  return Number(row?.quantity ?? 0);
}

async function readyAgent() {
  const agent = await deliveryAgent(app, company);
  await startShift(app, agent.cookie);
  return agent;
}

describe("Qoldiqni qayta yetkazish", () => {
  it("nakladnoy (bulk) qayta yetkazmada faqat QOLDIQ miqdor va summani ko'rsatadi, yetkazuvchi telefoni bilan", async () => {
    const agent = await readyAgent();
    const { taskId } = await partiallyDelivered(agent);
    const child = (await redeliver(taskId, { deliveryAgentId: agent.id })).json().task as { id: string };

    const res = await call(owner(), "POST", "/api/delivery/waybills/bulk", { taskIds: [child.id] });
    expect(res.statusCode, res.body).toBe(200);
    const [row] = res.json().tasks as {
      orderTotal: string; taskTotal: string; agentName: string | null; agentPhone: string | null;
      salesRepName: string | null; salesRepPhone: string | null;
      items: { quantity: string; lineTotal: string }[];
    }[];
    expect(row!.items).toHaveLength(1);
    expect(Number(row!.items[0]!.quantity), "buyurtmaning 10 tasi emas — qoldiq 4").toBe(4);
    expect(Number(row!.items[0]!.lineTotal)).toBe(20_000);
    expect(Number(row!.taskTotal), "reys summasi").toBe(20_000);
    expect(Number(row!.orderTotal), "buyurtma summasi alohida").toBe(50_000);
    expect(row!.agentName).toBeTruthy();
    expect(row!.agentPhone, "yetkazuvchi telefoni nakladnoyda").toBeTruthy();
    // Menejer yaratgan buyurtma — savdo agenti yo'q, boshqa buyurtmanikidan olinmaydi
    expect(row!.salesRepName).toBeNull();
    expect(row!.salesRepPhone).toBeNull();

    // Asl (to'liq) yetkazma yopilgan — bulk faqat ochiqlarini beradi
    const origin = await call(owner(), "POST", "/api/delivery/waybills/bulk", { taskIds: [taskId] });
    expect(origin.json().tasks).toEqual([]);
  });

  it("qoldiq uchun yangi yetkazma ochiladi: faqat qolgan miqdor, qoldiq summasi; buyurtma, zaxira va qarz o'zgarmaydi", async () => {
    const agent = await readyAgent();
    const { taskId, orderId } = await partiallyDelivered(agent);
    const stockAfterShip = await stockQty();
    const debtBefore = Number((await call(owner(), "GET", `/api/sales/customers/${company.customerId}`)).json().customer.totalDebt);

    const res = await redeliver(taskId, { reason: "Mijoz qolganini ertaga so'radi" });
    expect(res.statusCode, res.body).toBe(201);
    const child = res.json().task as Awaited<ReturnType<typeof detail>>;
    expect(child.status).toBe("ready");
    expect(child.originTask?.id).toBe(taskId);
    expect(child.items).toHaveLength(1);
    expect(Number(child.items[0]!.quantity), "faqat qoldiq: 10 − 6").toBe(4);
    expect(Number(child.expectedAmount), "qoldiq qiymati: 4 × 5000").toBe(20_000);

    // Buyurtma o'zgarmadi, zaxira qayta chiqmadi, qarz o'sib ketmadi
    const order = (await call(owner(), "GET", `/api/sales/orders/${orderId}`)).json().order as { totalAmount: string; items: { quantity: string }[] };
    expect(Number(order.totalAmount)).toBe(50_000);
    expect(Number(order.items[0]!.quantity)).toBe(10);
    expect(await stockQty(), "tovar allaqachon jo'natilgan — ikkinchi chiqim yo'q").toBe(stockAfterShip);
    expect(Number((await call(owner(), "GET", `/api/sales/customers/${company.customerId}`)).json().customer.totalDebt)).toBe(debtBefore);

    // Asl yetkazma endi "tovar qaytarilmagan" deb belgilanmaydi — qoldiq yangi yetkazmada
    expect((await taskRow(taskId))?.returnPending, "qoldiq qayta yetkazmada").toBe(false);
    const filtered = await call(owner(), "GET", "/api/delivery/tasks?returnPending=true&limit=200");
    expect((filtered.json().tasks as TaskRow[]).map((task) => task.id)).toEqual([]);
    const dashboard = await call(owner(), "GET", "/api/delivery/dashboard");
    expect(dashboard.json().dashboard.pendingReturns).toBe(0);

    // Ikkala tomonda ham havola va tarix bor
    const origin = await detail(taskId);
    expect(origin.redelivery?.id).toBe(child.id);
    expect(origin.events.some((event) => event.action === "REDELIVERY_CREATED")).toBe(true);
    expect(child.events.find((event) => event.action === "CREATED")?.details?.source).toBe("redelivery");
  });

  it("qayta yetkazma ochiq ekan, asl yetkazmadan omborga qabul qilinmaydi; bekor qilinsa — yana mumkin", async () => {
    const agent = await readyAgent();
    const { taskId } = await partiallyDelivered(agent);
    const child = (await redeliver(taskId)).json().task as { id: string; number: string };

    const blocked = await call(owner(), "POST", `/api/delivery/tasks/${taskId}/return`, { refundMethod: "balance" });
    expect(blocked.statusCode, blocked.body).toBe(409);
    expect(blocked.json().details.reason).toBe("redelivery_open");
    expect(blocked.json().details.number).toBe(child.number);

    const cancelled = await call(owner(), "POST", `/api/delivery/tasks/${child.id}/cancel`, { reason: "Mijoz keyinroq oladi" });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect((await taskRow(taskId))?.returnPending, "bekor qilingach qoldiq yana omborni kutadi").toBe(true);

    const returned = await call(owner(), "POST", `/api/delivery/tasks/${taskId}/return`, { refundMethod: "balance" });
    expect(returned.statusCode, returned.body).toBe(200);
    expect((await taskRow(taskId))?.returnPending).toBe(false);
  });

  it("bitta yetkazmaga ikkinchi qayta yetkazma ochilmaydi; omborga qabul qilingandan keyin ham ochilmaydi", async () => {
    const agent = await readyAgent();
    const { taskId } = await partiallyDelivered(agent);
    expect((await redeliver(taskId)).statusCode).toBe(201);

    const again = await redeliver(taskId);
    expect(again.statusCode, again.body).toBe(409);
    expect(again.json().details.reason).toBe("redelivery_exists");

    const other = await partiallyDelivered(await readyAgent());
    expect((await call(owner(), "POST", `/api/delivery/tasks/${other.taskId}/return`, { refundMethod: "balance" })).statusCode).toBe(200);
    const late = await redeliver(other.taskId);
    expect(late.statusCode, late.body).toBe(409);
    expect(late.json().details.reason).toBe("already_returned");
  });

  it("faqat qisman yetkazilgan yetkazmaning qoldig'i qayta yetkaziladi", async () => {
    const agent = await readyAgent();
    const { taskId } = await arrivedTask(app, company, agent);
    const early = await redeliver(taskId);
    expect(early.statusCode, early.body).toBe(409);
    expect(early.json().details.reason).toBe("invalid_transition");

    await agentAction(app, agent.cookie, taskId, "delivering");
    expect((await agentAction(app, agent.cookie, taskId, "confirm", near(20))).statusCode).toBe(200);
    const done = await redeliver(taskId);
    expect(done.statusCode, done.body).toBe(409);
    expect(done.json().details.reason).toBe("invalid_transition");
  });

  it("qayta yetkazmani agent yetkazadi: qoldiq mijozda, to'lov qarzni kamaytiradi, ombor tovar kutmaydi", async () => {
    const agent = await readyAgent();
    const { taskId, orderId } = await partiallyDelivered(agent);
    const stockAfterShip = await stockQty();
    const child = (await redeliver(taskId, { deliveryAgentId: agent.id })).json().task as { id: string; status: string; expectedAmount: string };
    expect(child.status, "agent bilan yaratilsa darhol biriktiriladi").toBe("assigned");

    for (const [action, body] of [
      ["accept", {}],
      ["start", {}],
      ["arrive", near(25)],
      ["delivering", {}],
    ] as const) {
      const step = await agentAction(app, agent.cookie, child.id, action, body);
      expect(step.statusCode, `${action}: ${step.body}`).toBe(200);
    }
    expect(await stockQty(), "qayta yo'lga chiqish zaxirani qayta kamaytirmaydi").toBe(stockAfterShip);

    const paid = await agentAction(app, agent.cookie, child.id, "payments", { method: "cash", amount: "20000" });
    expect(paid.statusCode, paid.body).toBe(201);
    const confirmed = await agentAction(app, agent.cookie, child.id, "confirm", near(25));
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().summary.status).toBe("delivered");

    const customer = (await call(owner(), "GET", `/api/sales/customers/${company.customerId}`)).json().customer as { totalDebt: string };
    expect(Number(customer.totalDebt), "50 000 dan 20 000 to'landi").toBe(30_000);
    const order = (await call(owner(), "GET", `/api/sales/orders/${orderId}`)).json().order as { paidAmount: string };
    expect(Number(order.paidAmount)).toBe(20_000);
    expect((await taskRow(taskId))?.returnPending).toBe(false);
    expect((await taskRow(child.id))?.returnPending).toBe(false);
  });

  it("qayta yetkazma ham qisman bo'lsa — zanjir davom etadi, qoldiq bir marta omborga qaytadi", async () => {
    const agent = await readyAgent();
    const { taskId } = await partiallyDelivered(agent);
    const child = (await redeliver(taskId, { deliveryAgentId: agent.id })).json().task as { id: string };

    for (const [action, body] of [
      ["accept", {}],
      ["start", {}],
      ["arrive", near(25)],
      ["delivering", {}],
    ] as const) {
      expect((await agentAction(app, agent.cookie, child.id, action, body)).statusCode).toBe(200);
    }
    const view = await call(agent.cookie, "GET", `/api/delivery/agent/tasks/${child.id}`);
    const item = (view.json().task.items as { id: string }[])[0]!;
    const confirmed = await agentAction(app, agent.cookie, child.id, "confirm", { ...near(25), items: [{ taskItemId: item.id, deliveredQty: "3" }] });
    expect(confirmed.statusCode, confirmed.body).toBe(200);

    // Endi qaytarishni KUTAYOTGANI — faqat oxirgi yetkazma (1 dona)
    const pending = await call(owner(), "GET", "/api/delivery/tasks?returnPending=true&limit=200");
    expect((pending.json().tasks as TaskRow[]).map((task) => task.id)).toEqual([child.id]);

    const stockBefore = await stockQty();
    expect((await call(owner(), "POST", `/api/delivery/tasks/${child.id}/return`, { refundMethod: "balance" })).statusCode).toBe(200);
    expect(await stockQty(), "faqat 1 dona omborga qaytadi").toBe(stockBefore + 1);
    // Asl yetkazmadan ikkinchi marta qaytarib bo'lmaydi (qoldig'i zanjirda hal qilingan)
    const twice = await call(owner(), "POST", `/api/delivery/tasks/${taskId}/return`, { refundMethod: "balance" });
    expect(twice.statusCode, twice.body).toBe(409);
  });

  it("qoldiq hal qilinmaguncha, o'sha buyurtmaga oddiy yangi yetkazma ochilmaydi", async () => {
    const agent = await readyAgent();
    const { taskId, orderId } = await partiallyDelivered(agent);

    const direct = await call(owner(), "POST", "/api/delivery/tasks", { orderId });
    expect(direct.statusCode, direct.body).toBe(409);
    expect(direct.json().details.reason).toBe("redelivery_required");
    expect(direct.json().details.taskId).toBe(taskId);

    // Qoldiq omborga qabul qilingach — buyurtmada yetkaziladigan mahsulot qolmaydi
    expect((await call(owner(), "POST", `/api/delivery/tasks/${taskId}/return`, { refundMethod: "balance" })).statusCode).toBe(200);
    const after = await call(owner(), "POST", "/api/delivery/tasks", { orderId });
    expect(after.statusCode, after.body).toBe(400);
  });

  it("so'rov tanasi qat'iy: noma'lum maydon, o'tgan sana va buyurtma qoldig'idan katta summa rad etiladi", async () => {
    const agent = await readyAgent();
    const { taskId } = await partiallyDelivered(agent);

    expect((await redeliver(taskId, { companyId: randomUUID() })).statusCode).toBe(400);
    expect((await redeliver(taskId, { scheduledDate: "2020-01-01" })).statusCode).toBe(400);
    const tooMuch = await redeliver(taskId, { expectedAmount: "60000" });
    expect(tooMuch.statusCode, tooMuch.body).toBe(400);

    const ok = await redeliver(taskId, { scheduledDate: localToday(), expectedAmount: "15000", priority: "high" });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(Number(ok.json().task.expectedAmount)).toBe(15_000);
    expect(ok.json().task.priority).toBe("high");
  });

  it("ruxsatlar: yetkazuvchiga va sessiyasizga berilmaydi, boshqa kompaniya yetkazmasi topilmaydi", async () => {
    const agent = await readyAgent();
    const { taskId } = await partiallyDelivered(agent);

    expect((await redeliver(taskId).then((res) => res)).statusCode).toBe(201);
    const second = await partiallyDelivered(await readyAgent());
    expect((await call(agent.cookie, "POST", `/api/delivery/tasks/${second.taskId}/redeliver`, {})).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/api/delivery/tasks/${second.taskId}/redeliver`, payload: {} })).statusCode).toBe(401);

    const stranger = await deliveryCompany(app, adminCookie, "Begona kompaniya");
    const foreign = await call(stranger.ownerCookie, "POST", `/api/delivery/tasks/${second.taskId}/redeliver`, {});
    expect(foreign.statusCode, foreign.body).toBe(404);
  });

  it("qayta yetkazma kunlik marshrutga tushadi va boshqa agentga biriktiriladi", async () => {
    const agent = await readyAgent();
    const { taskId } = await partiallyDelivered(agent);
    const other = await deliveryAgent(app, company, { name: "Ikkinchi kuryer" });

    const child = (await redeliver(taskId, { scheduledDate: localToday() })).json().task as { id: string; status: string };
    expect(child.status).toBe("ready");
    const assigned = await assign(app, owner(), child.id, other.id);
    expect(assigned.deliveryAgentId).toBe(other.id);
    expect(assigned.routeOrder).toBe(1);
  });
});
