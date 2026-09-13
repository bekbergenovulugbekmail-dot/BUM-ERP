/**
 * Dostavka taqsimoti va marshrut: hudud bo'yicha ro'yxat → hammasini bitta yetkazuvchiga (eng qisqa tartib bilan),
 * supervayzer kunlik marshrut rejasi va saqlash, yetkazuvchining tavsiya marshruti, distribyutsiya xaritasi va
 * marshrut tartibini optimallashtirish; ruxsat va kompaniya izolyatsiyasi. Tashqi marshrut xizmati testda o'chiq
 * (to'g'ri chiziq bo'yicha taxmin) — tartib baribir hisoblanadi.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { deliveryTasks } from "../src/db/schema/delivery.js";
import { auditLogs } from "../src/db/schema/platform.js";
import { buildServer } from "../src/server.js";
import {
  caller,
  confirmedOrder,
  deliveryAgent,
  deliveryCompany,
  iso,
  localToday,
  northOf,
  resetUnits,
  shop,
  startShift,
  taskForOrder,
  type DeliveryCompany,
} from "./delivery-setup.js";
import { addEmployee, resetDatabase, signedIn, uniquePhone } from "./helpers.js";

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
  company = await deliveryCompany(app, adminCookie, "Bonnu Market");
});

const owner = () => company.ownerCookie;

async function customerAt(name: string, meters: number | null, region: { city?: string; district?: string } = {}) {
  const res = await call(owner(), "POST", "/api/sales/customers", {
    name,
    phone: uniquePhone("95"),
    ...(meters === null ? {} : northOf(meters)),
    ...region,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().customer.id as string;
}

type DispatchItem = { key: string; kind: "order" | "task"; orderId: string; taskId: string | null; customerName: string; city: string | null; district: string | null; routes: { id: string }[] };

async function board() {
  const res = await call(owner(), "GET", "/api/delivery/dispatch");
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { items: DispatchItem[]; routes: { id: string; name: string }[] };
}

async function routeOrders(agentId: string) {
  return db
    .select({ id: deliveryTasks.id, routeOrder: deliveryTasks.routeOrder, status: deliveryTasks.status })
    .from(deliveryTasks)
    .where(and(eq(deliveryTasks.deliveryAgentId, agentId), eq(deliveryTasks.scheduledDate, localToday())))
    .orderBy(asc(deliveryTasks.routeOrder));
}

describe("Hudud bo'yicha taqsimot", () => {
  it("Urganch → Luchevoy: do'konlar ro'yxati → «Barchasini dostavshikka biriktirish» — yaratiladi, biriktiriladi, eng qisqa tartibda", async () => {
    await call(owner(), "PATCH", `/api/sales/customers/${company.customerId}`, { city: "Urganch", district: "Luchevoy" });
    const far = await customerAt("Magazin 3 km", 3000, { city: "Urganch", district: "Luchevoy" });
    const near = await customerAt("Magazin 1 km", 1000, { city: "Urganch", district: "Luchevoy" });
    const other = await customerAt("Xiva do'koni", 2000, { city: "Xiva", district: "Markaz" });

    const shopOrder = await confirmedOrder(app, company, "1");
    const farOrder = await confirmedOrder(app, company, "1", { customerId: far, deliveryRequired: false });
    const nearOrder = await confirmedOrder(app, company, "1", { customerId: near });
    await confirmedOrder(app, company, "1", { customerId: other });

    const { items } = await board();
    expect(items).toHaveLength(4);
    const luchevoy = items.filter((item) => item.city === "Urganch" && item.district === "Luchevoy");
    expect(luchevoy.map((item) => item.customerName).sort()).toEqual(["Bonnu Market do'koni", "Magazin 1 km", "Magazin 3 km"]);
    // Yetkazmasi yaratilmagan buyurtma ham, avtomatik yaratilgan "tayyor" yetkazma ham ro'yxatda
    expect(luchevoy.find((item) => item.orderId === farOrder)).toMatchObject({ kind: "order", taskId: null });
    expect(luchevoy.find((item) => item.orderId === nearOrder)?.kind).toBe("task");

    const agent = await deliveryAgent(app, company);
    const res = await call(owner(), "POST", "/api/delivery/dispatch/assign", {
      orderIds: luchevoy.filter((item) => item.kind === "order").map((item) => item.orderId),
      taskIds: luchevoy.filter((item) => item.kind === "task").map((item) => item.taskId),
      deliveryAgentId: agent.id,
    });
    expect(res.statusCode, res.body).toBe(200);
    const result = res.json();
    expect(result).toMatchObject({ created: 1, assigned: 2, optimized: true, optimizeError: null, dates: [localToday()] });
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].route.source).toBe("straight");

    // Chiziqdagi do'konlar: 0 → 1 km → 3 km (yoki teskari) — sakrab o'tilmaydi
    const shopTask = (await taskForOrder(app, owner(), shopOrder)).id;
    const nearTask = (await taskForOrder(app, owner(), nearOrder)).id;
    const farTask = (await taskForOrder(app, owner(), farOrder)).id;
    expect([[shopTask, nearTask, farTask], [farTask, nearTask, shopTask]]).toContainEqual(result.routes[0].taskIds);

    const saved = await routeOrders(agent.id);
    expect(saved.map((row) => row.id)).toEqual(result.routes[0].taskIds);
    expect(saved.map((row) => row.routeOrder)).toEqual([1, 2, 3]);
    expect(saved.every((row) => row.status === "assigned")).toBe(true);

    // Taqsimotda faqat boshqa hudud qoldi
    expect((await board()).items.map((item) => item.customerName)).toEqual(["Xiva do'koni"]);
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "DELIVERY_BULK_ASSIGNED"));
    expect(audit?.details).toMatchObject({ deliveryAgentId: agent.id, created: 1, assigned: 2 });
  });

  it("biri xato bo'lsa hech biri yozilmaydi; takrorlangan va bo'sh ro'yxat — 400; tartibsiz biriktirish ham mumkin", async () => {
    const agent = await deliveryAgent(app, company);
    const good = await confirmedOrder(app, company, "1", { deliveryRequired: false });
    const task = (await taskForOrder(app, owner(), await confirmedOrder(app, company, "1"))).id;

    const bad = await call(owner(), "POST", "/api/delivery/dispatch/assign", { orderIds: [good], taskIds: [task, randomUUID()], deliveryAgentId: agent.id });
    expect(bad.statusCode).toBe(404);
    expect(await routeOrders(agent.id)).toHaveLength(0);
    expect((await board()).items).toHaveLength(2);

    expect((await call(owner(), "POST", "/api/delivery/dispatch/assign", { taskIds: [task, task], deliveryAgentId: agent.id })).statusCode).toBe(400);
    expect((await call(owner(), "POST", "/api/delivery/dispatch/assign", { deliveryAgentId: agent.id })).statusCode).toBe(400);

    const plain = await call(owner(), "POST", "/api/delivery/dispatch/assign", { orderIds: [good], taskIds: [task], deliveryAgentId: agent.id, optimize: false });
    expect(plain.statusCode, plain.body).toBe(200);
    expect(plain.json()).toMatchObject({ created: 1, assigned: 1, optimized: false, routes: [] });
  });
});

describe("Kunlik marshrut", () => {
  async function threeStops(agentId: string) {
    const ids: Record<number, string> = {};
    for (const meters of [3000, 1000, 2000]) {
      const customerId = await customerAt(`Do'kon ${meters}`, meters);
      const orderId = await confirmedOrder(app, company, "1", { customerId });
      ids[meters] = (await taskForOrder(app, owner(), orderId)).id;
    }
    const res = await call(owner(), "POST", "/api/delivery/dispatch/assign", { taskIds: [ids[3000], ids[1000], ids[2000]], deliveryAgentId: agentId, optimize: false });
    expect(res.statusCode, res.body).toBe(200);
    return ids;
  }

  it("supervayzer: ombordan boshlab reja (saqlanmaydi), keyin saqlash; koordinatasiz mijoz oxirida", async () => {
    const agent = await deliveryAgent(app, company);
    const ids = await threeStops(agent.id);
    const noCoords = await customerAt("Manzilsiz do'kon", null);
    const lost = (await taskForOrder(app, owner(), await confirmedOrder(app, company, "1", { customerId: noCoords }))).id;
    await call(owner(), "POST", `/api/delivery/tasks/${lost}/assign`, { deliveryAgentId: agent.id });
    const before = (await routeOrders(agent.id)).map((row) => row.id);

    const preview = await call(owner(), "POST", "/api/delivery/route-plan", { deliveryAgentId: agent.id, date: localToday(), origin: shop });
    expect(preview.statusCode, preview.body).toBe(200);
    const plan = preview.json();
    expect(plan).toMatchObject({ applied: false, originSource: "given", unlocatedTaskIds: [lost] });
    expect(plan.taskIds).toEqual([ids[1000], ids[2000], ids[3000], lost]);
    expect(plan.route.stops.map((stop: { legMeters: number }) => Math.round(stop.legMeters / 100) * 100)).toEqual([1300, 1300, 1300]);
    expect(plan.tasks.map((task: { id: string }) => task.id)).toEqual(plan.taskIds);
    expect((await routeOrders(agent.id)).map((row) => row.id)).toEqual(before);

    const applied = await call(owner(), "POST", "/api/delivery/route-plan", { deliveryAgentId: agent.id, date: localToday(), origin: shop, apply: true });
    expect(applied.statusCode, applied.body).toBe(200);
    expect(applied.json().applied).toBe(true);
    expect((await routeOrders(agent.id)).map((row) => row.id)).toEqual([ids[1000], ids[2000], ids[3000], lost]);
  });

  it("yetkazuvchi: o'z joyidan tavsiya (yozilmaydi); joy berilmasa — oxirgi GPS nuqtasidan", async () => {
    const agent = await deliveryAgent(app, company);
    const ids = await threeStops(agent.id);
    const before = (await routeOrders(agent.id)).map((row) => row.id);

    const fromNorth = northOf(4000);
    const res = await call(agent.cookie, "GET", `/api/delivery/agent/route?lat=${fromNorth.latitude}&lng=${fromNorth.longitude}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ originSource: "given", taskIds: [ids[3000], ids[2000], ids[1000]] });
    expect((await routeOrders(agent.id)).map((row) => row.id)).toEqual(before);

    expect((await call(agent.cookie, "GET", "/api/delivery/agent/route")).json().originSource).toBe("none");

    await startShift(app, agent.cookie);
    const point = await call(agent.cookie, "POST", "/api/delivery/agent/locations", { points: [{ ...northOf(500), accuracy: 10, recordedAt: iso() }] });
    expect(point.statusCode, point.body).toBe(200);
    const fromGps = (await call(agent.cookie, "GET", "/api/delivery/agent/route")).json();
    expect(fromGps).toMatchObject({ originSource: "agent_location", taskIds: [ids[1000], ids[2000], ids[3000]] });
  });

  it("ruxsat va izolyatsiya: yetkazuvchi va kassir taqsimotni ko'rmaydi; boshqa kompaniya agenti — 404; qator o'zga kompaniyaniki — 404", async () => {
    const agent = await deliveryAgent(app, company);
    expect((await call(agent.cookie, "GET", "/api/delivery/dispatch")).statusCode).toBe(403);
    expect((await call(agent.cookie, "POST", "/api/delivery/dispatch/assign", { taskIds: [randomUUID()], deliveryAgentId: agent.id })).statusCode).toBe(403);
    const kassir = await addEmployee(app, { ownerCookie: owner() }, "Kassir");
    expect((await call(kassir.cookie, "GET", "/api/delivery/dispatch")).statusCode).toBe(403);
    expect((await call(kassir.cookie, "POST", "/api/delivery/route-plan", { deliveryAgentId: agent.id, date: localToday() })).statusCode).toBe(403);

    const rival = await deliveryCompany(app, adminCookie, "Hadicha Market");
    const rivalAgent = await deliveryAgent(app, rival);
    const rivalTask = (await taskForOrder(app, rival.ownerCookie, await confirmedOrder(app, rival, "1"))).id;
    expect((await call(owner(), "POST", "/api/delivery/route-plan", { deliveryAgentId: rivalAgent.id, date: localToday() })).statusCode).toBe(404);
    expect((await call(owner(), "POST", "/api/delivery/dispatch/assign", { taskIds: [rivalTask], deliveryAgentId: agent.id })).statusCode).toBe(404);
    expect((await call(owner(), "POST", "/api/delivery/dispatch/assign", { taskIds: [(await taskForOrder(app, owner(), await confirmedOrder(app, company, "1"))).id], deliveryAgentId: rivalAgent.id })).statusCode).toBe(400);
    expect((await board()).items.some((item) => item.taskId === rivalTask)).toBe(false);
  });
});

describe("Distribyutsiya xaritasi va marshrut tartibi", () => {
  it("xarita: marshrut do'konlari tartibda, marshrutsizlar alohida; optimallashtirish — ko'rish va saqlash", async () => {
    const far = await customerAt("Uzoq", 3000, { city: "Urganch" });
    const middle = await customerAt("O'rta", 1000, { city: "Urganch" });
    const noCoords = await customerAt("Koordinatasiz", null);
    const loose = await customerAt("Marshrutsiz", 2000);

    const created = await call(owner(), "POST", "/api/distribution/routes", { name: "Luchevoy marshruti", days: [1, 3], color: "#22c55e" });
    expect(created.statusCode, created.body).toBe(201);
    const routeId = created.json().route.id as string;
    for (const customerId of [far, company.customerId, noCoords, middle]) {
      expect((await call(owner(), "POST", `/api/distribution/routes/${routeId}/customers`, { customerId })).statusCode).toBe(201);
    }

    const map = await call(owner(), "GET", "/api/distribution/map");
    expect(map.statusCode, map.body).toBe(200);
    const [route] = map.json().routes as { id: string; color: string; customers: { customerId: string; latitude: string | null; city: string | null }[] }[];
    expect(route).toMatchObject({ id: routeId, color: "#22c55e" });
    expect(route!.customers.map((member) => member.customerId)).toEqual([far, company.customerId, noCoords, middle]);
    expect(route!.customers[0]).toMatchObject({ city: "Urganch" });
    expect((map.json().unrouted as { customerId: string }[]).map((item) => item.customerId)).toEqual([loose]);

    const preview = await call(owner(), "POST", `/api/distribution/routes/${routeId}/optimize`, { apply: false });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().applied).toBe(false);
    expect(preview.json().plan.stops).toHaveLength(3);
    expect(preview.json().route.customers.map((member: { customerId: string }) => member.customerId)).toEqual([far, company.customerId, noCoords, middle]);

    const applied = await call(owner(), "POST", `/api/distribution/routes/${routeId}/optimize`);
    expect(applied.statusCode, applied.body).toBe(200);
    const order = applied.json().route.customers.map((member: { customerId: string }) => member.customerId);
    expect([[company.customerId, middle, far, noCoords], [far, middle, company.customerId, noCoords]]).toContainEqual(order);

    const kassir = await addEmployee(app, { ownerCookie: owner() }, "Kassir");
    expect((await call(kassir.cookie, "POST", `/api/distribution/routes/${routeId}/optimize`)).statusCode).toBe(403);
  });
});
