import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { deliveryEvents, deliveryPayments, deliveryWorkSessions } from "../src/db/schema/delivery.js";
import { journalEntries } from "../src/db/schema/finance.js";
import { stockLevels } from "../src/db/schema/inventory.js";
import { notifications } from "../src/db/schema/notifications.js";
import { auditLogs } from "../src/db/schema/platform.js";
import { customerPayments, customers, salesOrderItems, salesOrders } from "../src/db/schema/sales.js";
import { buildServer } from "../src/server.js";
import {
  JPEG,
  NO_PROOFS,
  PNG,
  agentAction,
  arrivedTask,
  assign,
  caller,
  confirmedOrder,
  deliveryAgent,
  deliveryCompany,
  localToday,
  localTomorrow,
  near,
  northOf,
  resetUnits,
  setPolicy,
  shop,
  startShift,
  taskForOrder,
  type DeliveryCompany,
} from "./delivery-setup.js";
import { resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let adminCookie: string;
let company: DeliveryCompany;
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
  company = await deliveryCompany(app, adminCookie, "Yetkazuvchi");
});

const owner = () => company.ownerCookie;
const stock = async () =>
  (
    await db
      .select({ quantity: stockLevels.quantity })
      .from(stockLevels)
      .where(and(eq(stockLevels.productId, company.productId), eq(stockLevels.warehouseId, company.warehouseId)))
  )[0]!.quantity;
const journalCount = async (referenceType: string, referenceId: string) =>
  (await db.select().from(journalEntries).where(and(eq(journalEntries.referenceType, referenceType), eq(journalEntries.referenceId, referenceId)))).length;
const orderStatus = async (orderId: string) => (await db.select({ status: salesOrders.status }).from(salesOrders).where(eq(salesOrders.id, orderId)))[0]!.status;
const managerTask = async (taskId: string) => (await call(owner(), "GET", `/api/delivery/tasks/${taskId}`)).json().task;
const alertsFor = (taskId: string) =>
  db.select().from(notifications).where(and(eq(notifications.companyId, company.companyId), eq(notifications.relatedId, taskId)));
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

describe("Dostavka: to'liq oqim (API darajasida E2E)", () => {
  it("TEST 1: buyurtma → avtomatik yetkazma → biriktirish → qabul → yo'lga (zaxira va jurnal bir marta) → 199 m → rasm → naqd → tasdiqlash → DELIVERED; takroriy bosishlar bitta natija", async () => {
    const agent = await deliveryAgent(app, company);
    await startShift(app, agent.cookie);
    const orderId = await confirmedOrder(app, company, "10");
    const { id: taskId } = await taskForOrder(app, owner(), orderId);

    const created = await managerTask(taskId);
    expect(created).toMatchObject({ status: "ready", paymentType: "cash", expectedAmount: "50000.00", paymentStatus: "pending", deliveryAgentId: null });
    expect(created.number).toMatch(/^DL-\d{4}-0001$/);
    expect(created.scheduledDate).toBe(localToday());
    expect(created.items).toMatchObject([{ quantity: "10.0000", deliveredQty: null, value: "50000.00" }]);
    // Biriktirilmagan yetkazma agentga ko'rinmaydi
    expect((await call(agent.cookie, "GET", "/api/delivery/agent/tasks")).json().tasks).toEqual([]);

    await call(owner(), "PATCH", `/api/delivery/tasks/${taskId}`, { supervisorNote: "Ichki izoh", deliveryNote: "Orqa eshikdan", priority: "high" });
    await assign(app, owner(), taskId, agent.id);
    const mine = (await call(agent.cookie, "GET", `/api/delivery/agent/tasks?lat=${shop.latitude}&lng=${shop.longitude}`)).json().tasks;
    expect(mine).toMatchObject([{ id: taskId, status: "assigned", priority: "high", expectedAmount: "50000.00", distanceMeters: 0, routeOrder: 1 }]);
    const view = (await call(agent.cookie, "GET", `/api/delivery/agent/tasks/${taskId}`)).json().task;
    expect(view.deliveryNote).toBe("Orqa eshikdan");
    expect(view).not.toHaveProperty("supervisorNote");
    expect(view).not.toHaveProperty("otpHash");
    expect(view.customer).toMatchObject({ phone: expect.any(String), latitude: "41.311081" });

    const acceptKey = randomUUID();
    expect((await agentAction(app, agent.cookie, taskId, "accept", { clientRequestId: acceptKey })).json().task.status).toBe("accepted");
    expect((await agentAction(app, agent.cookie, taskId, "accept", { clientRequestId: acceptKey })).statusCode).toBe(200);
    const doubleAccept = await agentAction(app, agent.cookie, taskId, "accept");
    expect(doubleAccept.statusCode).toBe(409);
    expect(doubleAccept.json().details).toMatchObject({ reason: "invalid_transition" });

    const startKey = randomUUID();
    expect((await agentAction(app, agent.cookie, taskId, "start", { clientRequestId: startKey })).json().task.status).toBe("out_for_delivery");
    expect((await agentAction(app, agent.cookie, taskId, "start", { clientRequestId: startKey })).statusCode).toBe(200);
    expect(await stock()).toBe("90.0000");
    expect(await orderStatus(orderId)).toBe("shipped");
    expect(await journalCount("sales_order", orderId)).toBe(1);

    const arrived = await agentAction(app, agent.cookie, taskId, "arrive", near(199));
    expect(arrived.statusCode, arrived.body).toBe(200);
    expect(arrived.json().task).toMatchObject({ status: "arrived", arrivalDistanceMeters: 199 });

    // Standart siyosat: topshirish rasmi majburiy
    expect((await agentAction(app, agent.cookie, taskId, "confirm", near(30))).json().details).toMatchObject({ reason: "photo_required" });
    const photo = await agentAction(app, agent.cookie, taskId, "proofs", { kind: "photo", contentType: "image/jpeg", data: JPEG, ...near(25) });
    expect(photo.statusCode, photo.body).toBe(201);

    const payKey = randomUUID();
    const paid = await agentAction(app, agent.cookie, taskId, "payments", { clientRequestId: payKey, method: "cash", amount: "50000" });
    expect(paid.statusCode, paid.body).toBe(201);
    expect(paid.json().task.collectedAmount).toBe("50000.00");
    expect((await agentAction(app, agent.cookie, taskId, "payments", { clientRequestId: payKey, method: "cash", amount: "50000" })).statusCode).toBe(200);
    const orderPayments = await db.select().from(customerPayments).where(eq(customerPayments.orderId, orderId));
    expect(orderPayments).toHaveLength(1);

    const confirmKey = randomUUID();
    const done = await agentAction(app, agent.cookie, taskId, "confirm", { clientRequestId: confirmKey, ...near(35) });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().summary).toMatchObject({
      status: "delivered",
      orderTotal: "50000.00",
      deliveredValue: "50000.00",
      expectedAmount: "50000.00",
      collectedAmount: "50000.00",
      mismatchAmount: "0.00",
      paymentStatus: "paid",
      orderBalance: "0.00",
      customerDebt: "0.00",
    });
    const repeat = await agentAction(app, agent.cookie, taskId, "confirm", { clientRequestId: confirmKey, ...near(35) });
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json().summary.status).toBe("delivered");
    expect((await agentAction(app, agent.cookie, taskId, "confirm", near(35))).statusCode).toBe(409);

    // Buxgalteriya va zaxira: sotuv jurnali 1, to'lov jurnali 1, zaxira chiqimi bir marta
    expect(await journalCount("sales_order", orderId)).toBe(1);
    expect(await journalCount("customer_payment", orderPayments[0]!.id)).toBe(1);
    expect(await stock()).toBe("90.0000");
    expect(await orderStatus(orderId)).toBe("delivered");

    const final = await managerTask(taskId);
    expect(final.events.map((event: { action: string }) => event.action)).toEqual(
      expect.arrayContaining(["CREATED", "UPDATED", "ASSIGNED", "ACCEPTED", "OUT_FOR_DELIVERY", "ARRIVED", "PHOTO", "PAYMENT", "DELIVERED"]),
    );
    expect(final.items[0]).toMatchObject({ deliveredQty: "10.0000" });
    expect(final.supervisorNote).toBe("Ichki izoh");
    const proof = await call(owner(), "GET", `/api/delivery/tasks/${taskId}/proofs/${final.proofs[0].id}`);
    expect(proof.statusCode).toBe(200);
    expect(proof.headers["content-type"]).toBe("image/jpeg");
    const actions = (await db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.companyId, company.companyId))).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(["DELIVERY_TASK_CREATED", "DELIVERY_ASSIGNED", "DELIVERY_STARTED", "DELIVERY_PAYMENT_COLLECTED", "DELIVERY_CONFIRMED"]));
  });

  it("TEST 2: geofence 200 m — 199 va 200 ruxsat, 201 rad (hodisa, bildirishnoma); eskirgan va aniqligi past GPS; soxta masofa", async () => {
    await setPolicy(app, owner(), NO_PROOFS);
    const agent = await deliveryAgent(app, company);
    await startShift(app, agent.cookie);
    const orderA = await confirmedOrder(app, company, "5");
    const { id: taskA } = await taskForOrder(app, owner(), orderA);
    await assign(app, owner(), taskA, agent.id);
    await agentAction(app, agent.cookie, taskA, "accept");
    await agentAction(app, agent.cookie, taskA, "start");

    const far = await agentAction(app, agent.cookie, taskA, "arrive", near(201));
    expect(far.statusCode).toBe(403);
    expect(far.json().details).toEqual({ reason: "geofence", distanceMeters: 201, radiusMeters: 200 });
    const blocked = await managerTask(taskA);
    expect(blocked.status).toBe("out_for_delivery");
    expect(blocked.events.find((event: { action: string }) => event.action === "GEOFENCE_BLOCK")).toMatchObject({ distanceMeters: 201 });
    const alerts = await alertsFor(taskA);
    expect(alerts.map((alert) => alert.title)).toContain("Geofence buzilishi");

    expect((await agentAction(app, agent.cookie, taskA, "arrive", near(50, 600))).json().details).toEqual({ reason: "stale" });
    const poor = await agentAction(app, agent.cookie, taskA, "arrive", { ...near(50), accuracy: 500 });
    expect(poor.statusCode).toBe(400);
    expect(poor.json()).toMatchObject({ message: "GPS aniqligi yetarli emas. Iltimos, qayta urinib ko'ring.", details: { reason: "low_accuracy" } });
    // Mijoz yuborgan masofa yoki "ichida" belgisi qabul qilinmaydi
    expect((await agentAction(app, agent.cookie, taskA, "arrive", { ...near(500), distanceMeters: 5 })).statusCode).toBe(400);
    expect((await agentAction(app, agent.cookie, taskA, "arrive", { ...near(500), insideGeofence: true })).statusCode).toBe(400);
    expect((await agentAction(app, agent.cookie, taskA, "arrive", near(200))).json().task.arrivalDistanceMeters).toBe(200);

    const orderB = await confirmedOrder(app, company, "5");
    const { id: taskB } = await taskForOrder(app, owner(), orderB);
    await assign(app, owner(), taskB, agent.id);
    await agentAction(app, agent.cookie, taskB, "accept");
    await agentAction(app, agent.cookie, taskB, "start");
    expect((await agentAction(app, agent.cookie, taskB, "arrive", near(199))).json().task.arrivalDistanceMeters).toBe(199);

    // Tasdiqlashda geofence qayta tekshiriladi
    expect((await agentAction(app, agent.cookie, taskA, "confirm", near(201))).statusCode).toBe(403);
    expect((await agentAction(app, agent.cookie, taskA, "confirm", near(200))).json().summary.status).toBe("delivered");
  });

  it("TEST 3: qisman yetkazish 7/10 → PARTIALLY_DELIVERED; buyurtma o'zgarmaydi; qolgan 3 omborga qaytadi (bir marta), qarz to'g'ri", async () => {
    await setPolicy(app, owner(), NO_PROOFS);
    const agent = await deliveryAgent(app, company);
    await startShift(app, agent.cookie);
    const { orderId, taskId } = await arrivedTask(app, company, agent, "10");
    const itemId = (await call(agent.cookie, "GET", `/api/delivery/agent/tasks/${taskId}`)).json().task.items[0].id;

    expect((await agentAction(app, agent.cookie, taskId, "confirm", { ...near(20), items: [{ taskItemId: itemId, deliveredQty: "11" }] })).json().details).toMatchObject({
      reason: "quantity_range",
    });
    expect((await agentAction(app, agent.cookie, taskId, "confirm", { ...near(20), items: [{ taskItemId: itemId, deliveredQty: "0" }] })).json().details).toMatchObject({
      reason: "nothing_delivered",
    });
    expect((await agentAction(app, agent.cookie, taskId, "payments", { method: "cash", amount: "35000" })).statusCode).toBe(201);
    const done = await agentAction(app, agent.cookie, taskId, "confirm", { ...near(20), items: [{ taskItemId: itemId, deliveredQty: "7" }] });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().summary).toMatchObject({
      status: "partially_delivered",
      deliveredValue: "35000.00",
      expectedAmount: "35000.00",
      collectedAmount: "35000.00",
      paymentStatus: "paid",
    });
    const [orderItem] = await db.select().from(salesOrderItems).where(eq(salesOrderItems.orderId, orderId));
    expect(orderItem).toMatchObject({ quantity: "10.0000", returnedQty: "0.0000" });
    expect(await stock()).toBe("90.0000");

    expect((await call(agent.cookie, "POST", `/api/delivery/tasks/${taskId}/return`, {})).statusCode).toBe(403);
    const returned = await call(owner(), "POST", `/api/delivery/tasks/${taskId}/return`, { refundMethod: "balance", reason: "Mijoz 3 tasini olmadi" });
    expect(returned.statusCode, returned.body).toBe(200);
    expect(returned.json().task).toMatchObject({ status: "partially_delivered", items: [{ deliveredQty: "7.0000", returnedQty: "3.0000" }] });
    expect(returned.json().task.returnedAt).not.toBeNull();
    expect(await stock()).toBe("93.0000");
    const [afterItem] = await db.select().from(salesOrderItems).where(eq(salesOrderItems.orderId, orderId));
    expect(afterItem!.returnedQty).toBe("3.0000");
    const [customer] = await db.select().from(customers).where(eq(customers.id, company.customerId));
    expect(customer!.totalDebt).toBe("0.00");
    const second = await call(owner(), "POST", `/api/delivery/tasks/${taskId}/return`, {});
    expect(second.statusCode).toBe(409);
    expect(second.json().details).toMatchObject({ reason: "already_returned" });
    expect(await stock()).toBe("93.0000");
  });

  it("TEST 4: mijoz qabul qilmadi → FAILED (sabab majburiy, bildirishnoma) → qaytarish: zaxira to'liq, buyurtma qaytarilgan, qarz 0", async () => {
    await setPolicy(app, owner(), NO_PROOFS);
    const agent = await deliveryAgent(app, company);
    await startShift(app, agent.cookie);
    const { orderId, taskId } = await arrivedTask(app, company, agent, "10");

    expect((await agentAction(app, agent.cookie, taskId, "fail", { reason: "other" })).json().details).toMatchObject({ reason: "comment_required" });
    expect((await agentAction(app, agent.cookie, taskId, "fail", { reason: "unknown" })).statusCode).toBe(400);
    const failed = await agentAction(app, agent.cookie, taskId, "fail", { reason: "customer_refused", comment: "Mahsulot kerak emas dedi", ...near(20) });
    expect(failed.statusCode, failed.body).toBe(200);
    expect(failed.json().task).toMatchObject({ status: "failed", failureReason: "customer_refused", failureComment: "Mahsulot kerak emas dedi" });
    expect((await alertsFor(taskId)).map((alert) => alert.title)).toContain("Yetkazib bo'lmadi");
    expect((await agentAction(app, agent.cookie, taskId, "confirm", near(20))).statusCode).toBe(409);
    expect(await stock()).toBe("90.0000");

    const back = await call(owner(), "POST", `/api/delivery/tasks/${taskId}/return`, { reason: "Omborga qaytdi" });
    expect(back.statusCode, back.body).toBe(200);
    expect(back.json().task).toMatchObject({ status: "returned", items: [{ returnedQty: "10.0000" }] });
    expect(await stock()).toBe("100.0000");
    expect(await orderStatus(orderId)).toBe("returned");
    const [customer] = await db.select().from(customers).where(eq(customers.id, company.customerId));
    expect(customer!.totalDebt).toBe("0.00");
    const again = await call(owner(), "POST", `/api/delivery/tasks/${taskId}/return`, {});
    expect(again.statusCode).toBe(409);
    expect(await stock()).toBe("100.0000");
  });

  it("TEST 5: kutilgan 50 000, yig'ilgan 48 000 → farq 2 000, supervayzer ko'rib chiqadi; block siyosatida tasdiqlanmaydi; debt — qarzga", async () => {
    await setPolicy(app, owner(), NO_PROOFS);
    const agent = await deliveryAgent(app, company);
    await startShift(app, agent.cookie);

    const first = await arrivedTask(app, company, agent, "10");
    expect((await agentAction(app, agent.cookie, first.taskId, "payments", { method: "cash", amount: "48000" })).statusCode).toBe(201);
    const mismatch = await agentAction(app, agent.cookie, first.taskId, "confirm", near(20));
    expect(mismatch.json().summary).toMatchObject({
      status: "delivered",
      expectedAmount: "50000.00",
      collectedAmount: "48000.00",
      mismatchAmount: "2000.00",
      paymentStatus: "mismatch",
      paymentReview: "pending",
      orderBalance: "2000.00",
    });
    expect((await alertsFor(first.taskId)).map((alert) => alert.title)).toContain("To'lov farqi");
    expect((await call(owner(), "GET", "/api/delivery/dashboard")).json().dashboard.pendingReviews).toBe(1);
    expect((await call(agent.cookie, "POST", `/api/delivery/tasks/${first.taskId}/payment-review`, { decision: "approved", note: "Qarzga" })).statusCode).toBe(403);
    const reviewed = await call(owner(), "POST", `/api/delivery/tasks/${first.taskId}/payment-review`, { decision: "approved", note: "Mijoz ertaga to'laydi" });
    expect(reviewed.json().task).toMatchObject({ paymentReview: "approved", paymentReviewNote: "Mijoz ertaga to'laydi" });
    expect((await call(owner(), "POST", `/api/delivery/tasks/${first.taskId}/payment-review`, { decision: "rejected", note: "Takror" })).statusCode).toBe(409);

    await setPolicy(app, owner(), { ...NO_PROOFS, mismatchPolicy: "block" });
    const second = await arrivedTask(app, company, agent, "10");
    await agentAction(app, agent.cookie, second.taskId, "payments", { method: "cash", amount: "48000" });
    const refused = await agentAction(app, agent.cookie, second.taskId, "confirm", near(20));
    expect(refused.statusCode).toBe(400);
    expect(refused.json().details).toEqual({ reason: "payment_mismatch", expectedAmount: "50000.00", collectedAmount: "48000.00", mismatchAmount: "2000.00" });
    await agentAction(app, agent.cookie, second.taskId, "payments", { method: "cash", amount: "2000" });
    expect((await agentAction(app, agent.cookie, second.taskId, "confirm", near(20))).json().summary).toMatchObject({ paymentStatus: "paid", mismatchAmount: "0.00" });

    await setPolicy(app, owner(), { ...NO_PROOFS, mismatchPolicy: "debt" });
    const third = await arrivedTask(app, company, agent, "10");
    expect((await agentAction(app, agent.cookie, third.taskId, "confirm", near(20))).json().summary).toMatchObject({
      paymentStatus: "partial",
      paymentReview: "none",
      mismatchAmount: "50000.00",
    });
    // To'lov ortig'i qabul qilinmaydi (buyurtma qoldig'idan ko'p)
    const overpaid = await arrivedTask(app, company, agent, "1");
    expect((await agentAction(app, agent.cookie, overpaid.taskId, "payments", { method: "cash", amount: "9000" })).statusCode).toBe(400);
  });

  it("OTP va imzo: kod faqat hash, noto'g'ri kod urinish sanaladi, supervayzer yangi kod beradi; imzo PNG va ism majburiy", async () => {
    await setPolicy(app, owner(), { confirmation: { otp: true, signature: true, photo: false } });
    const agent = await deliveryAgent(app, company);
    await startShift(app, agent.cookie);
    const { taskId } = await arrivedTask(app, company, agent, "2");
    expect((await call(agent.cookie, "GET", `/api/delivery/agent/tasks/${taskId}`)).json().task).toMatchObject({ otpIssued: true, otpVerified: false });
    await agentAction(app, agent.cookie, taskId, "payments", { method: "cash", amount: "10000" });

    expect((await agentAction(app, agent.cookie, taskId, "confirm", near(20))).json().details).toMatchObject({ reason: "signature_required" });
    expect((await agentAction(app, agent.cookie, taskId, "proofs", { kind: "signature", contentType: "image/png", data: PNG })).json().details).toMatchObject({
      reason: "signer_required",
    });
    expect(
      (await agentAction(app, agent.cookie, taskId, "proofs", { kind: "signature", contentType: "image/png", data: JPEG, signerName: "Olim Karimov" })).json().details,
    ).toMatchObject({ reason: "proof_invalid" });
    const signature = await agentAction(app, agent.cookie, taskId, "proofs", { kind: "signature", contentType: "image/png", data: PNG, signerName: "Olim Karimov" });
    expect(signature.statusCode, signature.body).toBe(201);

    const wrong = await agentAction(app, agent.cookie, taskId, "confirm", { ...near(20), otp: "000000" });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().details).toMatchObject({ reason: "otp_invalid", attemptsLeft: 4 });
    expect((await agentAction(app, agent.cookie, taskId, "confirm", near(20))).json().details).toMatchObject({ reason: "otp_invalid", attemptsLeft: 3 });

    expect((await call(agent.cookie, "POST", `/api/delivery/tasks/${taskId}/otp`)).statusCode).toBe(403);
    const issued = await call(owner(), "POST", `/api/delivery/tasks/${taskId}/otp`);
    expect(issued.statusCode).toBe(200);
    expect(issued.json().otp).toMatchObject({ code: expect.stringMatching(/^\d{6}$/), smsSent: false });
    const code = issued.json().otp.code as string;
    // SMS sozlanmagan — agent qayta yubora olmaydi
    expect((await call(agent.cookie, "POST", `/api/delivery/agent/tasks/${taskId}/otp/resend`)).json().details).toMatchObject({ reason: "sms_unavailable" });

    const ok = await agentAction(app, agent.cookie, taskId, "confirm", { ...near(20), otp: code });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().task).toMatchObject({ status: "delivered", otpVerified: true, signerName: "Olim Karimov" });
    const events = await db.select({ action: deliveryEvents.action }).from(deliveryEvents).where(eq(deliveryEvents.taskId, taskId));
    expect(events.filter((event) => event.action === "OTP_FAILED")).toHaveLength(2);
    // Kodning o'zi audit jurnalida yo'q
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.companyId, company.companyId));
    expect(JSON.stringify(logs)).not.toContain(`"${code}"`);
  });

  it("TEST 6: oflayn navbat — o'tgan vaqt bilan amallar serverda qayta tekshiriladi; juda eski, kelajakdagi, sessiyadan tashqari va o'chirilgan siyosat — rad", async () => {
    await setPolicy(app, owner(), NO_PROOFS);
    const agent = await deliveryAgent(app, company);
    const session = await startShift(app, agent.cookie);
    await db.update(deliveryWorkSessions).set({ startedAt: new Date(Date.now() - 2 * 3_600_000) }).where(eq(deliveryWorkSessions.id, session.id));

    const orderId = await confirmedOrder(app, company, "10");
    const { id: taskId } = await taskForOrder(app, owner(), orderId);
    await assign(app, owner(), taskId, agent.id);
    const offlinePlace = (minutes: number) => ({ ...northOf(20), accuracy: 12, recordedAt: minutesAgo(minutes), occurredAt: minutesAgo(minutes) });

    expect((await agentAction(app, agent.cookie, taskId, "accept", { occurredAt: minutesAgo(30) })).statusCode).toBe(200);
    expect((await agentAction(app, agent.cookie, taskId, "start", { occurredAt: minutesAgo(25) })).statusCode).toBe(200);
    // GPS amal vaqtiga nisbatan: amaldan 10 daqiqa oldingi o'lchov — eskirgan
    expect((await agentAction(app, agent.cookie, taskId, "arrive", { ...offlinePlace(20), recordedAt: minutesAgo(30) })).json().details).toEqual({ reason: "stale" });
    expect((await agentAction(app, agent.cookie, taskId, "arrive", offlinePlace(20))).statusCode).toBe(200);
    expect((await agentAction(app, agent.cookie, taskId, "payments", { method: "cash", amount: "50000", occurredAt: minutesAgo(18) })).statusCode).toBe(201);
    const confirmed = await agentAction(app, agent.cookie, taskId, "confirm", offlinePlace(15));
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().summary).toMatchObject({ status: "delivered", paymentStatus: "paid" });

    const events = await db.select().from(deliveryEvents).where(eq(deliveryEvents.taskId, taskId));
    expect(events.filter((event) => ["ACCEPTED", "OUT_FOR_DELIVERY", "ARRIVED", "PAYMENT", "DELIVERED"].includes(event.action)).every((event) => event.offline)).toBe(true);
    const [payment] = await db.select().from(deliveryPayments).where(eq(deliveryPayments.taskId, taskId));
    expect(payment!.offline).toBe(true);
    const task = await managerTask(taskId);
    expect(Math.abs(new Date(task.deliveredAt).getTime() - Date.parse(offlinePlace(15).occurredAt))).toBeLessThan(2000);

    const otherOrder = await confirmedOrder(app, company, "1");
    const { id: other } = await taskForOrder(app, owner(), otherOrder);
    await assign(app, owner(), other, agent.id);
    expect((await agentAction(app, agent.cookie, other, "accept", { occurredAt: minutesAgo(30 * 60) })).json().details).toEqual({ reason: "offline_too_old" });
    expect((await agentAction(app, agent.cookie, other, "accept", { occurredAt: new Date(Date.now() + 10 * 60_000).toISOString() })).json().details).toEqual({
      reason: "clock_skew",
    });
    expect((await agentAction(app, agent.cookie, other, "accept", { occurredAt: minutesAgo(10) })).statusCode).toBe(200);
    // Sessiya boshlanishidan oldingi amal
    expect((await agentAction(app, agent.cookie, other, "start", { occurredAt: minutesAgo(180) })).json().details).toEqual({ reason: "work_session_required" });
    await setPolicy(app, owner(), { ...NO_PROOFS, offlineActionsAllowed: false });
    expect((await agentAction(app, agent.cookie, other, "start", { occurredAt: minutesAgo(10) })).json().details).toEqual({ reason: "offline_disabled" });
    expect((await agentAction(app, agent.cookie, other, "start")).statusCode).toBe(200);
  });

  it("boshqaruv: holat o'tishlari serverda, qayta rejalash, boshqa agentga o'tkazish, bekor qilish, tartib, takror yetkazma, qo'lda yaratish", async () => {
    await setPolicy(app, owner(), NO_PROOFS);
    const ali = await deliveryAgent(app, company, { name: "Ali" });
    const vali = await deliveryAgent(app, company, { name: "Vali" });
    await startShift(app, ali.cookie);
    await startShift(app, vali.cookie);
    const orderId = await confirmedOrder(app, company, "3");
    const { id: taskId } = await taskForOrder(app, owner(), orderId);
    await assign(app, owner(), taskId, ali.id);

    for (const action of ["start", "arrive", "confirm"]) {
      const res = await agentAction(app, ali.cookie, taskId, action, near(10));
      expect(res.statusCode, action).toBe(409);
      expect(res.json().details, action).toMatchObject({ reason: "invalid_transition" });
    }
    await agentAction(app, ali.cookie, taskId, "accept");
    const moved = await call(owner(), "POST", `/api/delivery/tasks/${taskId}/reschedule`, { scheduledDate: localTomorrow(), windowStart: "14:00", windowEnd: "16:00", reason: "Mijoz ertaga" });
    expect(moved.json().task).toMatchObject({ status: "assigned", scheduledDate: localTomorrow(), windowStart: "14:00", windowEnd: "16:00" });
    expect((await call(owner(), "POST", `/api/delivery/tasks/${taskId}/reschedule`, { scheduledDate: "2020-01-01" })).json().details).toMatchObject({ reason: "date_in_past" });
    expect((await call(owner(), "POST", `/api/delivery/tasks/${taskId}/reschedule`, { scheduledDate: localTomorrow(), windowStart: "16:00", windowEnd: "14:00" })).statusCode).toBe(400);

    const reassigned = await call(owner(), "POST", `/api/delivery/tasks/${taskId}/assign`, { deliveryAgentId: vali.id });
    expect(reassigned.json().task).toMatchObject({ deliveryAgentId: vali.id, status: "assigned" });
    expect(reassigned.json().task.events.map((event: { action: string }) => event.action)).toContain("REASSIGNED");
    expect((await call(ali.cookie, "GET", `/api/delivery/agent/tasks/${taskId}`)).statusCode).toBe(404);
    expect((await call(vali.cookie, "GET", "/api/delivery/agent/tasks?scope=upcoming")).json().tasks.map((task: { id: string }) => task.id)).toEqual([taskId]);

    // Ochiq yetkazmali agentni faolsizlantirib bo'lmaydi
    expect((await call(owner(), "PATCH", `/api/delivery/agents/${vali.id}`, { isActive: false })).json().details).toMatchObject({ reason: "open_tasks" });

    expect((await call(owner(), "POST", "/api/delivery/tasks", { orderId })).json().details).toMatchObject({ reason: "task_exists" });
    expect((await call(owner(), "POST", `/api/delivery/tasks/${taskId}/unassign`)).json().task).toMatchObject({ status: "ready", deliveryAgentId: null });
    expect((await call(owner(), "POST", `/api/delivery/tasks/${taskId}/cancel`, { reason: "x" })).statusCode).toBe(400);
    expect((await call(owner(), "POST", `/api/delivery/tasks/${taskId}/cancel`, { reason: "Mijoz buyurtmani bekor qildi" })).json().task.status).toBe("cancelled");
    expect((await call(owner(), "POST", `/api/delivery/tasks/${taskId}/assign`, { deliveryAgentId: ali.id })).statusCode).toBe(409);

    // Qo'lda yaratish: "yetkazish kerak" belgilanmagan buyurtma — avtomatik yaratilmaydi
    const manualOrder = await confirmedOrder(app, company, "1", { deliveryRequired: false });
    expect((await call(owner(), "GET", "/api/delivery/tasks")).json().tasks.some((task: { orderId: string }) => task.orderId === manualOrder)).toBe(false);
    expect((await call(owner(), "GET", "/api/delivery/ready-orders")).json().orders.map((order: { id: string }) => order.id)).toContain(manualOrder);
    const manual = await call(owner(), "POST", "/api/delivery/tasks", {
      orderId: manualOrder,
      scheduledDate: localToday(),
      priority: "urgent",
      paymentType: "credit",
      deliveryAgentId: ali.id,
      deliveryNote: "Qo'ng'iroq qiling",
    });
    expect(manual.statusCode, manual.body).toBe(201);
    expect(manual.json().task).toMatchObject({ status: "assigned", priority: "urgent", paymentType: "credit", expectedAmount: "0.00", paymentStatus: "not_required" });
    // Bekor qilingan buyurtmaning yangi yetkazmasi yaratiladi (ochiq yetkazma yo'q)
    expect((await call(owner(), "POST", "/api/delivery/tasks", { orderId })).statusCode).toBe(201);

    // Yetkazish tartibi
    const secondOrder = await confirmedOrder(app, company, "1", { deliveryRequired: false });
    const second = (await call(owner(), "POST", "/api/delivery/tasks", { orderId: secondOrder, deliveryAgentId: ali.id })).json().task;
    const order = await call(owner(), "PUT", "/api/delivery/route-order", { deliveryAgentId: ali.id, date: localToday(), taskIds: [second.id, manual.json().task.id] });
    expect(order.statusCode, order.body).toBe(200);
    const today = (await call(ali.cookie, "GET", "/api/delivery/agent/tasks")).json().tasks;
    expect(today.map((task: { id: string; routeOrder: number }) => [task.id, task.routeOrder])).toEqual([
      [second.id, 1],
      [manual.json().task.id, 2],
    ]);
    expect((await call(ali.cookie, "PUT", "/api/delivery/route-order", { deliveryAgentId: ali.id, date: localToday(), taskIds: [second.id] })).statusCode).toBe(403);
  });
});
