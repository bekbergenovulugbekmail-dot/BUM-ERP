/**
 * Dostavchi mijozdan ilgari sotilgan tovarni QAYTARIB OLADI.
 *
 * Tekshiriladi:
 *  - dostavchi mijozning oldingi xaridlarini qachon va qanday narxda olganini ko'radi;
 *  - standart siyosat: so'rov `pending` bo'lib turadi — zaxira va qarz TEGILMAYDI; supervayzer qabul qilganda yoziladi;
 *  - `returnPickupApproval: false`: dostavchi tasdiqlashi bilan darhol yoziladi;
 *  - qolganidan ko'p qaytarib bo'lmaydi (kutilayotgan so'rov ham band qiladi);
 *  - begona mijoz va ruxsatsiz dostavchi — yopiq.
 */
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { stockLevels } from "../src/db/schema/inventory.js";
import { customers, salesOrderItems, salesOrders, salesReturns } from "../src/db/schema/sales.js";
import { buildServer } from "../src/server.js";
import {
  NO_PROOFS,
  agentAction,
  arrivedTask,
  caller,
  deliveryAgent,
  deliveryCompany,
  resetUnits,
  setPolicy,
  startShift,
  type DeliveryCompany,
} from "./delivery-setup.js";
import { addEmployee, resetDatabase, signedIn } from "./helpers.js";

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
  company = await deliveryCompany(app, adminCookie, "Qaytarib olish");
  await setPolicy(app, company.ownerCookie, NO_PROOFS);
});

const owner = () => company.ownerCookie;

const stock = async () =>
  (
    await db
      .select({ quantity: stockLevels.quantity })
      .from(stockLevels)
      .where(and(eq(stockLevels.productId, company.productId), eq(stockLevels.warehouseId, company.warehouseId)))
  )[0]!.quantity;

const debt = async () =>
  (await db.select({ totalDebt: customers.totalDebt }).from(customers).where(eq(customers.id, company.customerId)))[0]!.totalDebt;

const returnedQty = async (orderId: string) =>
  (await db.select({ returnedQty: salesOrderItems.returnedQty }).from(salesOrderItems).where(eq(salesOrderItems.orderId, orderId)))[0]!.returnedQty;

/** Yetkazilgan (yakunlangan) sotuv: keyinchalik shu chekdan tovar qaytariladi. */
async function deliveredOrder(agent: { id: string; cookie: string }, quantity = "10") {
  await startShift(app, agent.cookie);
  const { orderId, taskId } = await arrivedTask(app, company, agent, quantity);
  const confirmed = await agentAction(app, agent.cookie, taskId, "confirm", { latitude: 41.311081, longitude: 69.240562, accuracy: 10, recordedAt: new Date().toISOString() });
  expect(confirmed.statusCode, confirmed.body).toBe(200);
  return { orderId, taskId };
}

type PurchaseOrder = {
  id: string;
  number: string;
  orderDate: string;
  items: { orderItemId: string; productName: string; unitPrice: string; quantity: string; returnableQty: string; pendingQty: string }[];
};

const purchases = async (cookie: string) => {
  const res = await call(cookie, "GET", `/api/delivery/agent/customers/${company.customerId}/purchases`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().orders as PurchaseOrder[];
};

describe("Dostavchi mijozdan tovarni qaytarib oladi", () => {
  it("oldingi xaridlar ko'rinadi: qachon, qanday narxda va qancha qaytarish mumkin", async () => {
    const agent = await deliveryAgent(app, company);
    const { orderId } = await deliveredOrder(agent, "10");

    const orders = await purchases(agent.cookie);
    expect(orders).toHaveLength(1);
    expect(orders[0]!.id).toBe(orderId);
    expect(orders[0]!.orderDate, "qachon olingani").toBe(new Date().toISOString().slice(0, 10));
    const line = orders[0]!.items[0]!;
    expect(Number(line.unitPrice), "firmadan qanday narxda olgani").toBeGreaterThan(0);
    expect(Number(line.returnableQty)).toBe(10);
    expect(Number(line.pendingQty)).toBe(0);
  });

  it("standart: so'rov qabul kutadi — zaxira va qarz tegilmaydi; supervayzer qabul qilganda yoziladi", async () => {
    const agent = await deliveryAgent(app, company);
    const { orderId } = await deliveredOrder(agent, "10");
    const stockAfterSale = await stock();
    const debtAfterSale = await debt();
    const [line] = (await purchases(agent.cookie))[0]!.items;

    const created = await call(agent.cookie, "POST", "/api/delivery/agent/returns", {
      customerId: company.customerId,
      orderId,
      items: [{ orderItemId: line!.orderItemId, quantity: "3" }],
      reason: "Mijozga yaroqsiz chiqdi",
      refundMethod: "balance",
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().pickup).toMatchObject({ status: "pending" });
    const pickupId = created.json().pickup.id as string;

    // Tovar hali mashinada: hech narsa o'zgarmaydi
    expect(await stock(), "zaxira o'zgarmaydi").toBe(stockAfterSale);
    expect(await debt(), "qarz o'zgarmaydi").toBe(debtAfterSale);
    expect(await returnedQty(orderId)).toBe("0.0000");
    expect(await db.select().from(salesReturns).where(eq(salesReturns.orderId, orderId))).toHaveLength(0);

    // Kutilayotgan so'rov qoldiqni band qiladi
    const afterRequest = (await purchases(agent.cookie))[0]!.items[0]!;
    expect(Number(afterRequest.pendingQty)).toBe(3);
    expect(Number(afterRequest.returnableQty)).toBe(7);

    // Supervayzer ro'yxatda ko'radi
    const pending = await call(owner(), "GET", "/api/delivery/returns/pickups?status=pending");
    expect(pending.statusCode, pending.body).toBe(200);
    expect(pending.json().pickups).toHaveLength(1);
    expect(pending.json().pickups[0]).toMatchObject({ id: pickupId, reason: "Mijozga yaroqsiz chiqdi" });
    expect(pending.json().pickups[0].items).toHaveLength(1);

    // Qabul qilinganda — zaxira qaytadi, qarz kamayadi
    const accepted = await call(owner(), "POST", `/api/delivery/returns/pickups/${pickupId}/accept`, {});
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json().pickup).toMatchObject({ status: "accepted" });
    expect(accepted.json().return.id).toBeTruthy();

    expect(Number(await stock()), "3 dona omborga qaytdi").toBe(Number(stockAfterSale) + 3);
    expect(Number(await debt())).toBeLessThan(Number(debtAfterSale));
    expect(await returnedQty(orderId)).toBe("3.0000");
    expect(await db.select().from(salesReturns).where(eq(salesReturns.orderId, orderId))).toHaveLength(1);

    // Ikkinchi marta qabul qilib bo'lmaydi
    const again = await call(owner(), "POST", `/api/delivery/returns/pickups/${pickupId}/accept`, {});
    expect(again.statusCode).toBe(409);
  });

  it("dostavchi o'z so'rovlarini ko'radi, begonasini ko'rmaydi", async () => {
    const agent = await deliveryAgent(app, company);
    const { orderId } = await deliveredOrder(agent, "10");
    const [line] = (await purchases(agent.cookie))[0]!.items;
    const created = await call(agent.cookie, "POST", "/api/delivery/agent/returns", {
      customerId: company.customerId,
      orderId,
      items: [{ orderItemId: line!.orderItemId, quantity: "1" }],
      refundMethod: "balance",
    });
    expect(created.statusCode, created.body).toBe(201);

    const mine = await call(agent.cookie, "GET", "/api/delivery/agent/returns");
    expect(mine.statusCode, mine.body).toBe(200);
    expect(mine.json().pickups).toHaveLength(1);
    expect(mine.json().pickups[0]).toMatchObject({ status: "pending", customerId: company.customerId });

    const other = await deliveryAgent(app, company);
    expect((await call(other.cookie, "GET", "/api/delivery/agent/returns")).json().pickups).toHaveLength(0);
  });

  it("rad etilsa hech narsa yozilmaydi va qoldiq bo'shaydi", async () => {
    const agent = await deliveryAgent(app, company);
    const { orderId } = await deliveredOrder(agent, "10");
    const before = await stock();
    const [line] = (await purchases(agent.cookie))[0]!.items;

    const created = await call(agent.cookie, "POST", "/api/delivery/agent/returns", {
      customerId: company.customerId,
      orderId,
      items: [{ orderItemId: line!.orderItemId, quantity: "4" }],
      refundMethod: "balance",
    });
    const pickupId = created.json().pickup.id as string;

    const rejected = await call(owner(), "POST", `/api/delivery/returns/pickups/${pickupId}/reject`, { note: "Tovar buzilgan, qabul qilinmadi" });
    expect(rejected.statusCode, rejected.body).toBe(200);
    expect(rejected.json().pickup).toMatchObject({ status: "rejected", note: "Tovar buzilgan, qabul qilinmadi" });

    expect(await stock()).toBe(before);
    expect(await returnedQty(orderId)).toBe("0.0000");
    // Rad etilgach qoldiq yana to'liq qaytariladigan bo'ladi
    expect(Number((await purchases(agent.cookie))[0]!.items[0]!.returnableQty)).toBe(10);
  });

  it("siyosat tasdiqsiz bo'lsa — dostavchining o'zida darhol yoziladi", async () => {
    await setPolicy(app, owner(), { ...NO_PROOFS, returnPickupApproval: false });
    const agent = await deliveryAgent(app, company);
    const { orderId } = await deliveredOrder(agent, "10");
    const before = await stock();
    const [line] = (await purchases(agent.cookie))[0]!.items;

    const created = await call(agent.cookie, "POST", "/api/delivery/agent/returns", {
      customerId: company.customerId,
      orderId,
      items: [{ orderItemId: line!.orderItemId, quantity: "2" }],
      refundMethod: "balance",
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().pickup).toMatchObject({ status: "accepted" });
    expect(Number(await stock())).toBe(Number(before) + 2);
    expect(await returnedQty(orderId)).toBe("2.0000");
  });

  it("qolganidan ko'p qaytarib bo'lmaydi", async () => {
    const agent = await deliveryAgent(app, company);
    const { orderId } = await deliveredOrder(agent, "10");
    const [line] = (await purchases(agent.cookie))[0]!.items;

    const tooMuch = await call(agent.cookie, "POST", "/api/delivery/agent/returns", {
      customerId: company.customerId,
      orderId,
      items: [{ orderItemId: line!.orderItemId, quantity: "11" }],
      refundMethod: "balance",
    });
    expect(tooMuch.statusCode).toBe(400);
    expect(tooMuch.json().message).toContain("qolganidan ko'p");

    // 8 ta kutilmoqda + yana 3 ta — o'tmaydi
    const first = await call(agent.cookie, "POST", "/api/delivery/agent/returns", {
      customerId: company.customerId,
      orderId,
      items: [{ orderItemId: line!.orderItemId, quantity: "8" }],
      refundMethod: "balance",
    });
    expect(first.statusCode, first.body).toBe(201);
    const second = await call(agent.cookie, "POST", "/api/delivery/agent/returns", {
      customerId: company.customerId,
      orderId,
      items: [{ orderItemId: line!.orderItemId, quantity: "3" }],
      refundMethod: "balance",
    });
    expect(second.statusCode, "kutilayotgan so'rov qoldiqni band qiladi").toBe(400);
  });

  it("boshqa dostavchining mijozi va ruxsatsiz xodim — yopiq", async () => {
    const agent = await deliveryAgent(app, company);
    const { orderId } = await deliveredOrder(agent, "10");
    const [line] = (await purchases(agent.cookie))[0]!.items;

    // Yetkazma qilmagan boshqa dostavchi bu mijozni ko'rmaydi
    const stranger = await deliveryAgent(app, company);
    const hidden = await call(stranger.cookie, "GET", `/api/delivery/agent/customers/${company.customerId}/purchases`);
    expect(hidden.statusCode).toBe(404);
    const blocked = await call(stranger.cookie, "POST", "/api/delivery/agent/returns", {
      customerId: company.customerId,
      orderId,
      items: [{ orderItemId: line!.orderItemId, quantity: "1" }],
      refundMethod: "balance",
    });
    expect(blocked.statusCode).toBe(404);

    // Kassirda dostavka ish joyi ham, qabul qilish ham yo'q
    const kassir = await addEmployee(app, company, "Kassir");
    expect((await call(kassir.cookie, "GET", "/api/delivery/returns/pickups")).statusCode).toBe(403);
    const created = await call(agent.cookie, "POST", "/api/delivery/agent/returns", {
      customerId: company.customerId,
      orderId,
      items: [{ orderItemId: line!.orderItemId, quantity: "1" }],
      refundMethod: "balance",
    });
    const pickupId = created.json().pickup.id as string;
    expect((await call(kassir.cookie, "POST", `/api/delivery/returns/pickups/${pickupId}/accept`, {})).statusCode).toBe(403);
  });

  it("boshqa kompaniyaning so'rovi ko'rinmaydi va qabul qilinmaydi", async () => {
    const agent = await deliveryAgent(app, company);
    const { orderId } = await deliveredOrder(agent, "10");
    const [line] = (await purchases(agent.cookie))[0]!.items;
    const created = await call(agent.cookie, "POST", "/api/delivery/agent/returns", {
      customerId: company.customerId,
      orderId,
      items: [{ orderItemId: line!.orderItemId, quantity: "1" }],
      refundMethod: "balance",
    });
    const pickupId = created.json().pickup.id as string;

    const other = await deliveryCompany(app, adminCookie, "Begona kompaniya");
    expect((await call(other.ownerCookie, "GET", "/api/delivery/returns/pickups")).json().pickups).toHaveLength(0);
    expect((await call(other.ownerCookie, "POST", `/api/delivery/returns/pickups/${pickupId}/accept`, {})).statusCode).toBe(404);
  });

  it("yakunlanmagan (qoralama) chekdan qaytarib bo'lmaydi", async () => {
    const agent = await deliveryAgent(app, company);
    await deliveredOrder(agent, "10");
    // Yangi buyurtma — hali yetkazilmagan
    const draft = await call(owner(), "POST", "/api/sales/orders", {
      customerId: company.customerId,
      warehouseId: company.warehouseId,
      orderDate: new Date().toISOString().slice(0, 10),
      items: [{ productId: company.productId, quantity: "2" }],
    });
    expect(draft.statusCode, draft.body).toBe(201);
    const draftId = draft.json().order.id as string;
    const [item] = await db.select({ id: salesOrderItems.id }).from(salesOrderItems).where(eq(salesOrderItems.orderId, draftId));

    const res = await call(agent.cookie, "POST", "/api/delivery/agent/returns", {
      customerId: company.customerId,
      orderId: draftId,
      items: [{ orderItemId: item!.id, quantity: "1" }],
      refundMethod: "balance",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("yakunlangan");

    // Qoralama chek xaridlar ro'yxatida ham ko'rinmaydi
    const orders = await purchases(agent.cookie);
    expect(orders.every((order) => order.id !== draftId)).toBe(true);
    expect(await db.select().from(salesOrders).where(eq(salesOrders.id, draftId))).toHaveLength(1);
  });
});
