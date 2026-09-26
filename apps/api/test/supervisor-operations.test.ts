/**
 * SUPERVAYZER OPERATSIYALARI — biznes test (2026-09-26).
 *
 * Aktorlar: Supervayzer A ("mas'ul bo'lganlari" chegarasi yoqilgan rol), Agent 1 (A jamoasi), Agent 2 (boshqa
 * supervayzer), Yetkazuvchi 1 (A jamoasi), Yetkazuvchi 2 (boshqa), Marshrut A (Agent 1 → Mijoz A), Marshrut B
 * (Agent 2 → Mijoz B), begona tenant.
 *
 * Tekshiriladi: jamoa chegarasi SERVERDA (ro'yxat, bitta yozuv, o'zgartirish), agent nomidan buyurtma MAVJUD agent
 * oqimi orqali (created_by = supervayzer, sales_rep_id = agent, audit actingAs), GPS/tashrif shartini chetlab o'tish
 * faqat sabab bilan va alohida audit, yetkazish (biriktirish, qayta biriktirish, yetkazildi/bajarilmadi, naqd,
 * topshirish), zanjir va KPI mavjud manbadan.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_ROLES } from "@bum/shared";
import { closeDb, db } from "../src/db/client.js";
import { stockLevels } from "../src/db/schema/inventory.js";
import { auditLogs } from "../src/db/schema/platform.js";
import { salesOrders } from "../src/db/schema/sales.js";
import { agentOrders } from "../src/db/schema/sales-agent.js";
import { buildServer } from "../src/server.js";
import { setAgentPolicy } from "./agent-policy.js";
import { NO_PROOFS, agentAction, deliveryAgent, deliveryCompany, iso, near, resetUnits, setPolicy, shop, startShift, type DeliveryCompany } from "./delivery-setup.js";
import { addEmployee, login, resetDatabase, signedIn, uniquePhone } from "./helpers.js";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
let app: FastifyInstance;
const call = (cookie: string, method: Method, url: string, payload?: object, headers: Record<string, string> = {}) =>
  app.inject({ method, url, headers: { cookie, ...headers }, ...(payload ? { payload } : {}) });

let company: DeliveryCompany;
let foreign: DeliveryCompany;
const S = {
  supervisor: { id: "", cookie: "" },
  otherSupervisor: { id: "", cookie: "" },
  agent1: { id: "", cookie: "", repId: "" },
  agent2: { id: "", cookie: "", repId: "" },
  delivery1: { id: "", cookie: "" },
  delivery2: { id: "", cookie: "" },
  routeA: "",
  routeB: "",
  customerA: "",
  customerB: "",
  order1: "",
  task1: "",
  order2: "",
  task2: "",
};
/** Supervayzer ofisda (do'kondan ~5 km) — haqiqiy joylashuvi soxtalashtirilmaydi. */
const office = { latitude: shop.latitude + 0.045, longitude: shop.longitude, accuracy: 12, recordedAt: iso() };
const actAs = (repId: string) => ({ "x-act-as-sales-rep": repId });

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
  await resetDatabase();
  await resetUnits();
  const admin = (await signedIn(app, { isPlatformAdmin: true })).cookie;
  company = await deliveryCompany(app, admin, "SUPERVISOR-CO");
  foreign = await deliveryCompany(app, admin, "SUPERVISOR-FOREIGN");
  await setPolicy(app, company.ownerCookie, { ...NO_PROOFS, deliveryRequiredByDefault: true });
  await setAgentPolicy(company.companyId, { creditLimitPolicy: "approval" });
}, 120_000);

afterAll(async () => {
  await app.close();
  await closeDb();
});

describe("Supervayzer operatsiyalari", () => {
  it("1 — rol: Supervayzer ruxsatlari + 'mas'ul bo'lganlari' chegarasi (sales_agent.supervise, sales.view, delivery.view)", async () => {
    const base = DEFAULT_ROLES.find((role) => role.name === "Supervayzer")!;
    const role = await call(company.ownerCookie, "POST", "/api/company/roles", {
      name: "Supervayzer (jamoa)",
      permissions: base.permissions,
      scopes: { "sales_agent.supervise": "responsible", "sales.view": "responsible", "delivery.view": "responsible" },
    });
    expect(role.statusCode, role.body).toBe(201);
    S.supervisor = await addEmployee(app, company, "Supervayzer (jamoa)");
    S.otherSupervisor = await addEmployee(app, company, "Supervayzer");
  });

  it("2 — jamoa: Agent 1 va Yetkazuvchi 1 — A ga; Agent 2 va Yetkazuvchi 2 — boshqa supervayzerga", async () => {
    const newAgent = async (name: string, supervisorUserId: string) => {
      const phone = uniquePhone("90");
      const res = await call(company.ownerCookie, "POST", "/api/sales-agent/team", { name, phone, password: "agent-parol-123", supervisorUserId });
      expect(res.statusCode, res.body).toBe(201);
      const { cookie } = await login(app, phone, "agent-parol-123");
      const agent = res.json().agent as { id: string; userId: string };
      return { id: agent.userId, cookie: cookie!, repId: agent.id };
    };
    S.agent1 = await newAgent("Agent 1", S.supervisor.id);
    S.agent2 = await newAgent("Agent 2", S.otherSupervisor.id);
    expect(S.agent1.repId).toBeTruthy();
    const d1 = await deliveryAgent(app, company, { name: "Yetkazuvchi 1", supervisorUserId: S.supervisor.id });
    const d2 = await deliveryAgent(app, company, { name: "Yetkazuvchi 2", supervisorUserId: S.otherSupervisor.id });
    S.delivery1 = { id: d1.id, cookie: d1.cookie };
    S.delivery2 = { id: d2.id, cookie: d2.cookie };

    // Mijoz A = kompaniya do'koni (koordinatali), Mijoz B — yangi
    S.customerA = company.customerId;
    const b = await call(company.ownerCookie, "POST", "/api/sales/customers", { name: "Mijoz B", phone: uniquePhone("95"), latitude: shop.latitude + 0.01, longitude: shop.longitude });
    S.customerB = b.json().customer.id;
    for (const [key, name, repId, customerId] of [["routeA", "Marshrut A", S.agent1.repId, S.customerA], ["routeB", "Marshrut B", S.agent2.repId, S.customerB]] as const) {
      const route = await call(company.ownerCookie, "POST", "/api/distribution/routes", { name, salesRepId: repId, days: [0, 1, 2, 3, 4, 5, 6] });
      expect(route.statusCode, route.body).toBe(201);
      S[key] = route.json().route.id;
      expect((await call(company.ownerCookie, "POST", `/api/distribution/routes/${S[key]}/customers`, { customerId })).statusCode).toBe(201);
    }
  });

  it("3 — agentlar: faqat o'z jamoasi; boshqa agent detali/tarixi TOPILMADI", async () => {
    const list = await call(S.supervisor.cookie, "GET", "/api/sales-agent/supervisor/agents");
    expect(list.statusCode, list.body).toBe(200);
    expect((list.json().agents as { id: string }[]).map((row) => row.id)).toEqual([S.agent1.repId]);
    expect((await call(S.supervisor.cookie, "GET", `/api/sales-agent/supervisor/agents/${S.agent2.repId}`)).statusCode).toBe(404);
    expect((await call(S.supervisor.cookie, "GET", `/api/sales-agent/supervisor/agents/${S.agent2.repId}/history`)).statusCode).toBe(404);
    expect((await call(S.supervisor.cookie, "GET", `/api/sales-agent/supervisor/agents/${S.agent1.repId}`)).statusCode).toBe(200);
    // Chegarasiz supervayzer hammani ko'radi (eski xatti-harakat)
    const all = (await call(S.otherSupervisor.cookie, "GET", "/api/sales-agent/supervisor/agents")).json().agents as unknown[];
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it("4 — marshrut va mijozlar: faqat jamoa; boshqa marshrutni o'zgartirish TOPILMADI", async () => {
    const routes = (await call(S.supervisor.cookie, "GET", "/api/distribution/routes")).json().routes as { id: string }[];
    expect(routes.map((route) => route.id)).toEqual([S.routeA]);
    expect((await call(S.supervisor.cookie, "PATCH", `/api/distribution/routes/${S.routeB}`, { name: "Buzildi" })).statusCode).toBe(404);
    expect((await call(S.supervisor.cookie, "POST", `/api/distribution/routes/${S.routeB}/customers`, { customerId: S.customerA })).statusCode).toBe(404);
    expect((await call(S.supervisor.cookie, "POST", "/api/distribution/routes", { name: "Yangi", salesRepId: S.agent2.repId, days: [1] })).statusCode).toBe(404);
    expect((await call(S.supervisor.cookie, "PATCH", `/api/distribution/routes/${S.routeA}`, { name: "Marshrut A (yangilandi)" })).statusCode).toBe(200);
    expect((await call(S.supervisor.cookie, "GET", "/api/distribution/routes/export")).statusCode).toBe(403);
    const customers = (await call(S.supervisor.cookie, "GET", "/api/sales/customers")).json().customers as { id: string }[];
    expect(customers.map((row) => row.id)).toContain(S.customerA);
    expect(customers.map((row) => row.id)).not.toContain(S.customerB);
  });

  it("5 — agent nomidan: faqat jamoa agenti; GPS, ish vaqti, naqd — agent nomidan BLOK", async () => {
    const stores = await call(S.supervisor.cookie, "GET", "/api/sales-agent/stores?scope=all", undefined, actAs(S.agent1.repId));
    expect(stores.statusCode, stores.body).toBe(200);
    expect((stores.json().stores as { id: string }[]).map((row) => row.id)).toEqual([S.customerA]);
    expect((await call(S.supervisor.cookie, "GET", "/api/sales-agent/stores", undefined, actAs(S.agent2.repId))).statusCode).toBe(404);
    expect((await call(S.supervisor.cookie, "GET", "/api/sales-agent/stores", undefined, actAs(randomUUID()))).statusCode).toBe(404);
    expect((await call(S.supervisor.cookie, "POST", "/api/sales-agent/work-session/start", { ...office }, actAs(S.agent1.repId))).statusCode).toBe(403);
    expect((await call(S.supervisor.cookie, "POST", "/api/sales-agent/location", { ...office }, actAs(S.agent1.repId))).statusCode).toBe(403);
    expect((await call(S.supervisor.cookie, "POST", "/api/sales-agent/visits/start", { customerId: S.customerA, ...office }, actAs(S.agent1.repId))).statusCode).toBe(403);
    // Oddiy agent (supervise ruxsatisiz) boshqa agent nomidan ishlay olmaydi
    expect((await call(S.agent2.cookie, "GET", "/api/sales-agent/stores", undefined, actAs(S.agent1.repId))).statusCode).toBe(403);
  });

  it("6 — agent nomidan qoralama: mavjud agent oqimi, sales_rep_id = Agent 1, created_by = supervayzer; boshqa marshrut mijozi — yo'q", async () => {
    const id = randomUUID();
    const draft = await call(S.supervisor.cookie, "PUT", `/api/sales-agent/orders/drafts/${id}`, { customerId: S.customerA, paymentType: "cash", items: [{ productId: company.productId, pieces: "4" }] }, actAs(S.agent1.repId));
    expect(draft.statusCode, draft.body).toBe(200);
    S.order1 = draft.json().order.id;
    const [row] = await db.select().from(agentOrders).where(eq(agentOrders.orderId, S.order1));
    expect(row).toMatchObject({ salesRepId: S.agent1.repId, actingUserId: S.supervisor.id });
    const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, S.order1));
    expect(order!.createdBy, "created_by = supervayzer").toBe(S.supervisor.id);
    expect(order!.source).toBe("sales_agent");
    const foreignCustomer = await call(S.supervisor.cookie, "PUT", `/api/sales-agent/orders/drafts/${randomUUID()}`, { customerId: S.customerB, paymentType: "cash", items: [{ productId: company.productId, pieces: "1" }] }, actAs(S.agent1.repId));
    expect(foreignCustomer.statusCode).toBe(404);
    expect((await call(S.supervisor.cookie, "PUT", `/api/sales-agent/orders/drafts/${randomUUID()}`, { customerId: S.customerA, paymentType: "cash", items: [{ productId: company.productId, pieces: "1" }], companyId: foreign.companyId }, actAs(S.agent1.repId))).statusCode).toBe(400);
  });

  it("7 — yuborish: GPS/ish vaqti/tashrif sharti sababsiz BLOK; soxta GPS — sabab bilan ham BLOK; agent o'zi chetlab o'ta olmaydi", async () => {
    const noReason = await call(S.supervisor.cookie, "POST", `/api/sales-agent/orders/${S.order1}/submit`, office, actAs(S.agent1.repId));
    expect(noReason.statusCode).toBeGreaterThanOrEqual(400);
    expect(noReason.json().details).toMatchObject({ overrideAvailable: true });
    const mocked = await call(S.supervisor.cookie, "POST", `/api/sales-agent/orders/${S.order1}/submit`, { ...office, mocked: true, overrideReason: "Telefon orqali buyurtma" }, actAs(S.agent1.repId));
    expect(mocked.statusCode).toBe(403);
    expect(mocked.json().details).toMatchObject({ reason: "mock_location" });
    const byAgent = await call(S.agent1.cookie, "POST", `/api/sales-agent/orders/${S.order1}/submit`, { ...near(10), overrideReason: "Men o'zim chetlab o'taman" });
    expect(byAgent.statusCode).toBe(403);
    expect(byAgent.json().details).toMatchObject({ reason: "override_forbidden" });
  });

  it("8 — sabab bilan yuborildi: tasdiqlandi, yetkazma ochildi; alohida audit (override) va actingAs", async () => {
    const res = await call(S.supervisor.cookie, "POST", `/api/sales-agent/orders/${S.order1}/submit`, { ...office, recordedAt: iso(), overrideReason: "Mijoz telefon orqali buyurtma berdi" }, actAs(S.agent1.repId));
    expect(res.statusCode, res.body).toBe(200);
    const [row] = await db.select().from(agentOrders).where(eq(agentOrders.orderId, S.order1));
    expect(row!.submitOverrideReason).toBe("Mijoz telefon orqali buyurtma berdi");
    expect(row!.submitDistanceMeters!, "haqiqiy masofa saqlandi").toBeGreaterThan(4000);
    const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, S.order1));
    expect(order!.status).toBe("confirmed");
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.resourceId, S.order1)).orderBy(desc(auditLogs.createdAt));
    const override = logs.find((log) => log.action === "AGENT_ORDER_SUPERVISOR_OVERRIDE")!;
    expect(override.userId).toBe(S.supervisor.id);
    expect(override.details).toMatchObject({ conditions: expect.arrayContaining(["work_session", "geofence", "visit"]), actingAs: { salesRepId: S.agent1.repId } });
    const submit = logs.find((log) => log.action === "ORDER_SUBMIT")!;
    expect(submit.userId, "audit: bajaruvchi — supervayzer").toBe(S.supervisor.id);
    expect(submit.details).toMatchObject({ actingAs: { salesRepId: S.agent1.repId, supervisorUserId: S.supervisor.id } });
  });

  it("9 — KPI: buyurtma AGENT 1 ga yoziladi (agent paneli, rahbar statistikasi, supervayzer paneli bir xil)", async () => {
    const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, S.order1));
    const overview = await call(S.supervisor.cookie, "GET", "/api/sales-agent/supervisor/overview");
    expect(overview.statusCode, overview.body).toBe(200);
    const body = overview.json();
    expect(body.scoped).toBe(true);
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0]).toMatchObject({ id: S.agent1.repId, ordersToday: 1, salesToday: order!.totalAmount, ordersThisMonth: 1, salesThisMonth: order!.totalAmount });
    const stats = (await call(company.ownerCookie, "GET", "/api/distribution/sales-reps/stats")).json().salesReps as { id: string; ordersThisMonth: number; visitSalesThisMonth: string }[];
    expect(stats.find((row) => row.id === S.agent1.repId)).toMatchObject({ ordersThisMonth: 1, visitSalesThisMonth: order!.totalAmount });
    expect(stats.find((row) => row.id === S.agent2.repId)).toMatchObject({ ordersThisMonth: 0 });
    const agentDashboard = await call(S.agent1.cookie, "GET", "/api/sales-agent/dashboard");
    expect(agentDashboard.statusCode, agentDashboard.body).toBe(200);
    expect(JSON.stringify(agentDashboard.json())).toContain(order!.totalAmount);
  });

  it("10 — yetkazish: jamoa buyurtmasi ko'rinadi; boshqa yetkazuvchiga biriktirish BLOK, o'zinikiga — ha", async () => {
    const tasks = (await call(S.supervisor.cookie, "GET", "/api/delivery/tasks?limit=100")).json().tasks as { id: string; orderId: string }[];
    const task = tasks.find((row) => row.orderId === S.order1);
    expect(task, "jamoa agenti buyurtmasining yetkazmasi ko'rinadi").toBeTruthy();
    S.task1 = task!.id;
    expect((await call(S.supervisor.cookie, "POST", `/api/delivery/tasks/${S.task1}/assign`, { deliveryAgentId: S.delivery2.id })).statusCode).toBe(404);
    const assigned = await call(S.supervisor.cookie, "POST", `/api/delivery/tasks/${S.task1}/assign`, { deliveryAgentId: S.delivery1.id });
    expect(assigned.statusCode, assigned.body).toBe(200);
    expect(assigned.json().task.status).toBe("assigned");
  });

  it("11 — qayta biriktirish (unassign → assign) va holatlar mavjud hayot sikli bo'yicha", async () => {
    expect((await call(S.supervisor.cookie, "POST", `/api/delivery/tasks/${S.task1}/unassign`)).statusCode).toBe(200);
    const again = await call(S.supervisor.cookie, "POST", `/api/delivery/tasks/${S.task1}/assign`, { deliveryAgentId: S.delivery1.id });
    expect(again.statusCode, again.body).toBe(200);
    // Supervayzer GPS'ni soxtalashtira olmaydi: yetkazuvchi amallari faqat yetkazuvchi o'zida
    expect((await call(S.supervisor.cookie, "POST", `/api/delivery/agent/tasks/${S.task1}/accept`, { clientRequestId: randomUUID() })).statusCode).toBe(403);
  });

  it("12 — Yetkazuvchi 1: qabul → yo'lga → yetib keldi → naqd (qisman) → yetkazildi; ombor kamaydi", async () => {
    const before = (await db.select().from(stockLevels).where(and(eq(stockLevels.productId, company.productId), eq(stockLevels.warehouseId, company.warehouseId))))[0]!;
    await startShift(app, S.delivery1.cookie);
    for (const [action, body] of [["accept", {}], ["start", {}], ["arrive", near(30)]] as const) {
      const res = await agentAction(app, S.delivery1.cookie, S.task1, action, body);
      expect(res.statusCode, `${action}: ${res.body}`).toBe(200);
    }
    const after = (await db.select().from(stockLevels).where(and(eq(stockLevels.productId, company.productId), eq(stockLevels.warehouseId, company.warehouseId))))[0]!;
    expect(Number(before.quantity) - Number(after.quantity), "yo'lga chiqishda 4 dona chiqdi").toBe(4);
    const paid = await agentAction(app, S.delivery1.cookie, S.task1, "payments", { method: "cash", amount: "15000" });
    expect(paid.statusCode, paid.body).toBe(201);
    const done = await agentAction(app, S.delivery1.cookie, S.task1, "confirm", near(30));
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().task.status).toBe("delivered");
  });

  it("13 — zanjir: Agent → Buyurtma → Ombor → Yetkazish → To'lov → Qarz → Topshirish", async () => {
    const res = await call(S.supervisor.cookie, "GET", `/api/sales-agent/supervisor/orders/${S.order1}/chain`);
    expect(res.statusCode, res.body).toBe(200);
    const chain = res.json();
    expect(chain.agent).toMatchObject({ salesRepId: S.agent1.repId, actingUserId: S.supervisor.id, overrideReason: "Mijoz telefon orqali buyurtma berdi" });
    expect(chain.order.number).toBeTruthy();
    expect(chain.warehouse.movements.length, "ombordan chiqim bor").toBeGreaterThan(0);
    expect(chain.delivery[0]).toMatchObject({ id: S.task1, status: "delivered", deliveryAgentId: S.delivery1.id, collectedAmount: "15000.00" });
    expect(chain.payments.collected[0]).toMatchObject({ method: "cash", amount: "15000.00" });
    expect(chain.payments.customerPayments.length).toBeGreaterThan(0);
    // Buyurtma 4 × 5000 = 20 000, to'landi 15 000 → buyurtma qoldig'i 5 000, mijoz qarzi (jurnal keshi) 5 000
    expect(chain.debt).toMatchObject({ orderBalance: "5000.00", totalDebt: "5000.00" });
    const holder = (chain.handover as { deliveryAgentId: string | null; balance: string }[]).find((row) => row.deliveryAgentId === S.delivery1.id)!;
    expect(holder.balance, "yetkazuvchidagi naqd — topshirilmagan").toBe("15000.00");
  });

  it("14 — naqdni kassaga topshirish: o'z yetkazuvchisi — ha, boshqasi — TOPILMADI", async () => {
    expect((await call(S.supervisor.cookie, "GET", `/api/delivery/agents/${S.delivery2.id}/cash`)).statusCode).toBe(404);
    expect((await call(S.supervisor.cookie, "POST", `/api/delivery/agents/${S.delivery2.id}/cash-handover`, { amount: "1" })).statusCode).toBe(404);
    const handover = await call(S.supervisor.cookie, "POST", `/api/delivery/agents/${S.delivery1.id}/cash-handover`, { amount: "15000" });
    expect(handover.statusCode, handover.body).toBe(201);
    const cash = (await call(S.supervisor.cookie, "GET", `/api/delivery/agents/${S.delivery1.id}/cash`)).json().cash;
    expect(Number(cash.balance ?? cash.account?.balance ?? 0)).toBe(0);
  });

  it("15 — bajarilmagan yetkazma: agent nomidan 2-buyurtma → Yetkazuvchi 1 → 'bajarilmadi'; panelda ko'rinadi", async () => {
    const id = randomUUID();
    const draft = await call(S.supervisor.cookie, "PUT", `/api/sales-agent/orders/drafts/${id}`, { customerId: S.customerA, paymentType: "cash", items: [{ productId: company.productId, pieces: "2" }] }, actAs(S.agent1.repId));
    S.order2 = draft.json().order.id;
    const submit = await call(S.supervisor.cookie, "POST", `/api/sales-agent/orders/${S.order2}/submit`, { ...office, recordedAt: iso(), overrideReason: "Telefon orqali takroriy buyurtma" }, actAs(S.agent1.repId));
    expect(submit.statusCode, submit.body).toBe(200);
    const task = ((await call(S.supervisor.cookie, "GET", "/api/delivery/tasks?limit=100")).json().tasks as { id: string; orderId: string }[]).find((row) => row.orderId === S.order2)!;
    S.task2 = task.id;
    expect((await call(S.supervisor.cookie, "POST", `/api/delivery/tasks/${S.task2}/assign`, { deliveryAgentId: S.delivery1.id })).statusCode).toBe(200);
    for (const [action, body] of [["accept", {}], ["start", {}], ["arrive", near(30)]] as const) {
      expect((await agentAction(app, S.delivery1.cookie, S.task2, action, body)).statusCode).toBe(200);
    }
    const failed = await agentAction(app, S.delivery1.cookie, S.task2, "fail", { reason: "customer_refused", comment: "Do'kon yopiq", ...near(20) });
    expect(failed.statusCode, failed.body).toBe(200);
    expect(failed.json().task.status).toBe("failed");
    const dashboard = (await call(S.supervisor.cookie, "GET", "/api/delivery/dashboard")).json().dashboard;
    expect(dashboard.failed).toBe(1);
    expect(dashboard.delivered).toBe(1);
    expect((dashboard.agents as { deliveryAgentId: string }[]).every((row) => row.deliveryAgentId === S.delivery1.id)).toBe(true);
  });

  it("16 — yetkazish ro'yxatlari chegarada: boshqa jamoaning yetkazmasi va yetkazuvchisi ko'rinmaydi", async () => {
    // Boshqa jamoa: egasi Mijoz B ga oddiy buyurtma (Agent 2 marshruti) → Yetkazuvchi 2
    const created = await call(company.ownerCookie, "POST", "/api/sales/orders", { customerId: S.customerB, warehouseId: company.warehouseId, orderDate: new Date().toISOString().slice(0, 10), deliveryRequired: true, items: [{ productId: company.productId, quantity: "1" }] });
    const otherOrder = created.json().order.id;
    await call(company.ownerCookie, "POST", `/api/sales/orders/${otherOrder}/confirm`);
    const otherTask = ((await call(company.ownerCookie, "GET", "/api/delivery/tasks?limit=100")).json().tasks as { id: string; orderId: string }[]).find((row) => row.orderId === otherOrder)!;
    await call(company.ownerCookie, "POST", `/api/delivery/tasks/${otherTask.id}/assign`, { deliveryAgentId: S.delivery2.id });
    const mine = (await call(S.supervisor.cookie, "GET", "/api/delivery/tasks?limit=100")).json().tasks as { id: string }[];
    expect(mine.map((row) => row.id)).not.toContain(otherTask.id);
    expect((await call(S.supervisor.cookie, "GET", `/api/delivery/tasks/${otherTask.id}`)).statusCode).toBe(404);
    expect((await call(S.supervisor.cookie, "POST", `/api/delivery/tasks/${otherTask.id}/unassign`)).statusCode).toBe(404);
    expect((await call(S.supervisor.cookie, "POST", `/api/delivery/tasks/${otherTask.id}/cancel`, { reason: "buzish urinishi" })).statusCode).toBe(404);
    const agents = (await call(S.supervisor.cookie, "GET", "/api/delivery/agents")).json().agents as { id: string }[];
    expect(agents.map((row) => row.id)).toEqual([S.delivery1.id]);
    expect((await call(S.supervisor.cookie, "POST", "/api/delivery/auto-assign/preview", { date: new Date().toISOString().slice(0, 10) })).statusCode).toBe(403);
    // Chegarasiz supervayzer — hammasini ko'radi
    const all = (await call(S.otherSupervisor.cookie, "GET", "/api/delivery/tasks?limit=100")).json().tasks as { id: string }[];
    expect(all.map((row) => row.id)).toContain(otherTask.id);
  });

  it("17 — o'zi (agent nomidan) kiritgan nasiya buyurtmasini o'zi tasdiqlay olmaydi; boshqa supervayzer tasdiqlaydi", async () => {
    await call(company.ownerCookie, "PATCH", `/api/sales/customers/${S.customerA}`, { creditLimit: "1000" });
    const id = randomUUID();
    const draft = await call(S.supervisor.cookie, "PUT", `/api/sales-agent/orders/drafts/${id}`, { customerId: S.customerA, paymentType: "credit", paymentDueDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10), items: [{ productId: company.productId, pieces: "1" }] }, actAs(S.agent1.repId));
    expect(draft.statusCode, draft.body).toBe(200);
    const orderId = draft.json().order.id;
    const submit = await call(S.supervisor.cookie, "POST", `/api/sales-agent/orders/${orderId}/submit`, { ...office, recordedAt: iso(), overrideReason: "Telefon orqali nasiya buyurtma" }, actAs(S.agent1.repId));
    expect(submit.statusCode, submit.body).toBe(200);
    expect(submit.json().order.approvalStatus).toBe("pending");
    const self = await call(S.supervisor.cookie, "POST", `/api/sales-agent/supervisor/orders/${orderId}/approve`);
    expect(self.statusCode).toBe(403);
    expect(self.json().details).toMatchObject({ reason: "self_approval" });
    expect((await call(S.otherSupervisor.cookie, "POST", `/api/sales-agent/supervisor/orders/${orderId}/approve`)).statusCode).toBe(200);
  });

  it("18 — boshqa jamoa buyurtmasi: zanjir, tasdiq, tashrif rasmlari — TOPILMADI", async () => {
    const otherDraft = await call(S.agent2.cookie, "PUT", `/api/sales-agent/orders/drafts/${randomUUID()}`, { customerId: S.customerB, paymentType: "cash", items: [{ productId: company.productId, pieces: "1" }] });
    expect(otherDraft.statusCode, otherDraft.body).toBe(200);
    const otherOrder = otherDraft.json().order.id;
    expect((await call(S.supervisor.cookie, "GET", `/api/sales-agent/supervisor/orders/${otherOrder}/chain`)).statusCode).toBe(404);
    expect((await call(S.supervisor.cookie, "POST", `/api/sales-agent/supervisor/orders/${otherOrder}/reject`, { reason: "buzish urinishi" })).statusCode).toBe(404);
    const orders = (await call(S.supervisor.cookie, "GET", "/api/sales-agent/supervisor/orders")).json().orders as { orderId?: string; id?: string }[];
    expect(orders.map((row) => row.orderId ?? row.id)).not.toContain(otherOrder);
  });

  it("19 — begona tenant: agent, marshrut, yetkazma, zanjir, ombor — ko'rinmaydi; agent nomidan — yo'q", async () => {
    const foreignSupervisor = await addEmployee(app, foreign, "Supervayzer");
    expect((await call(foreignSupervisor.cookie, "GET", "/api/sales-agent/stores", undefined, actAs(S.agent1.repId))).statusCode).toBe(404);
    expect((await call(foreignSupervisor.cookie, "GET", `/api/sales-agent/supervisor/agents/${S.agent1.repId}`)).statusCode).toBe(404);
    expect((await call(foreignSupervisor.cookie, "GET", `/api/sales-agent/supervisor/orders/${S.order1}/chain`)).statusCode).toBe(404);
    expect((await call(foreignSupervisor.cookie, "GET", `/api/delivery/tasks/${S.task1}`)).statusCode).toBe(404);
    expect((await call(foreignSupervisor.cookie, "POST", `/api/delivery/tasks/${S.task1}/assign`, { deliveryAgentId: S.delivery1.id })).statusCode).toBe(404);
    expect((await call(foreignSupervisor.cookie, "PATCH", `/api/distribution/routes/${S.routeA}`, { name: "x" })).statusCode).toBe(404);
    const agents = (await call(foreignSupervisor.cookie, "GET", "/api/sales-agent/supervisor/agents")).json().agents as { id: string }[];
    expect(agents.map((row) => row.id)).not.toContain(S.agent1.repId);
    const overview = (await call(foreignSupervisor.cookie, "GET", "/api/sales-agent/supervisor/overview")).json();
    expect(overview.agents).toHaveLength(0);
  });
});
