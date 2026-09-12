import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../src/db/client.js";
import { buildServer } from "../src/server.js";
import {
  NO_PROOFS,
  agentAction,
  assign,
  caller,
  confirmedOrder,
  deliveryAgent,
  deliveryCompany,
  near,
  resetUnits,
  setPolicy,
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
  company = await deliveryCompany(app, adminCookie, "Asosiy");
});

async function taskFor(target: DeliveryCompany, agentId: string, extra: Record<string, unknown> = {}) {
  const orderId = await confirmedOrder(app, target, "2", extra);
  const { id } = await taskForOrder(app, target.ownerCookie, orderId);
  await assign(app, target.ownerCookie, id, agentId);
  return id;
}

describe("Dostavka: xavfsizlik va tenant chegarasi", () => {
  it("agent A agent B yetkazmasi va mijozini ko'rmaydi; kompaniya A kompaniya B ni ko'rmaydi; soxta ID'lar e'tiborsiz yoki rad", async () => {
    await setPolicy(app, company.ownerCookie, NO_PROOFS);
    const ali = await deliveryAgent(app, company, { name: "Ali" });
    const vali = await deliveryAgent(app, company, { name: "Vali" });
    const otherCustomer = (await call(company.ownerCookie, "POST", "/api/sales/customers", { name: "Valining do'koni", phone: uniquePhone("95"), ...shop })).json()
      .customer.id as string;
    const aliTask = await taskFor(company, ali.id);
    const valiTask = await taskFor(company, vali.id, { customerId: otherCustomer });

    const other = await deliveryCompany(app, adminCookie, "Boshqa");
    const bek = await deliveryAgent(app, other, { name: "Bek" });
    const bekTask = await taskFor(other, bek.id);

    expect((await call(ali.cookie, "GET", "/api/delivery/agent/tasks")).json().tasks.map((task: { id: string }) => task.id)).toEqual([aliTask]);
    for (const taskId of [valiTask, bekTask]) {
      expect((await call(ali.cookie, "GET", `/api/delivery/agent/tasks/${taskId}`)).statusCode).toBe(404);
      for (const action of ["accept", "start", "arrive", "fail"]) {
        const res = await agentAction(app, ali.cookie, taskId, action, action === "arrive" ? near(10) : action === "fail" ? { reason: "no_answer" } : {});
        expect(res.statusCode, `${action} ${taskId}`).toBe(404);
      }
      expect((await call(ali.cookie, "GET", `/api/delivery/agent/tasks/${taskId}/proofs/${randomUUID()}`)).statusCode).toBe(404);
    }

    // Soxta agent/kompaniya ID'si: so'rovda e'tiborsiz (sessiyadagi agent), tanada — 400
    const spoofed = await call(ali.cookie, "GET", `/api/delivery/agent/tasks?deliveryAgentId=${vali.id}&companyId=${other.companyId}`);
    expect(spoofed.json().tasks.map((task: { id: string }) => task.id)).toEqual([aliTask]);
    for (const extra of [{ deliveryAgentId: vali.id }, { companyId: other.companyId }, { customerId: otherCustomer }]) {
      expect((await agentAction(app, ali.cookie, aliTask, "accept", extra)).statusCode).toBe(400);
    }
    expect((await call(ali.cookie, "GET", `/api/delivery/agent/reports?agentId=${vali.id}`)).statusCode).toBe(200);

    // Mijoz: faqat o'z yetkazmasidagi
    expect((await call(ali.cookie, "GET", `/api/delivery/agent/customers/${company.customerId}`)).statusCode).toBe(200);
    expect((await call(ali.cookie, "GET", `/api/delivery/agent/customers/${otherCustomer}`)).statusCode).toBe(404);
    expect((await call(ali.cookie, "GET", `/api/delivery/agent/customers/${other.customerId}`)).statusCode).toBe(404);
    expect((await call(ali.cookie, "GET", "/api/delivery/agent/customers")).json().customers.map((customer: { id: string }) => customer.id)).toEqual([company.customerId]);

    // Kompaniya A boshqaruvchisi B yetkazmasini ko'rmaydi
    expect((await call(company.ownerCookie, "GET", `/api/delivery/tasks/${bekTask}`)).statusCode).toBe(404);
    expect((await call(company.ownerCookie, "GET", "/api/delivery/tasks")).json().tasks.some((task: { id: string }) => task.id === bekTask)).toBe(false);
    expect((await call(company.ownerCookie, "POST", `/api/delivery/tasks/${bekTask}/assign`, { deliveryAgentId: ali.id })).statusCode).toBe(404);
    // Boshqa kompaniya agentiga biriktirib bo'lmaydi
    expect((await call(company.ownerCookie, "POST", `/api/delivery/tasks/${aliTask}/assign`, { deliveryAgentId: bek.id })).statusCode).toBe(400);
    expect((await call(company.ownerCookie, "GET", `/api/delivery/agents/${bek.id}/track`)).statusCode).toBe(404);

    for (const url of ["/api/delivery/tasks", "/api/delivery/agents", "/api/delivery/agents/live", "/api/delivery/dashboard", "/api/delivery/ready-orders", `/api/delivery/tasks/${aliTask}`]) {
      expect((await call(ali.cookie, "GET", url)).statusCode, url).toBe(403);
    }
  });

  it("ish sessiyasisiz lokatsiya va yetkazish amallari rad; RBAC: Ko'ruvchi lokatsiyani ko'rmaydi, Ombor menejeri biriktira olmaydi, Supervayzer ko'radi", async () => {
    const agent = await deliveryAgent(app, company);
    const taskId = await taskFor(company, agent.id);
    expect((await agentAction(app, agent.cookie, taskId, "accept")).statusCode).toBe(200);
    const noSession = await agentAction(app, agent.cookie, taskId, "start");
    expect(noSession.statusCode).toBe(409);
    expect(noSession.json().details).toMatchObject({ reason: "work_session_required" });
    const locations = await call(agent.cookie, "POST", "/api/delivery/agent/locations", { points: [near(10)] });
    expect(locations.statusCode).toBe(409);
    expect(locations.json().details).toMatchObject({ reason: "work_session_required" });
    await startShift(app, agent.cookie);
    expect((await agentAction(app, agent.cookie, taskId, "start")).statusCode).toBe(200);

    const viewer = await addEmployee(app, company, "Ko'ruvchi");
    expect((await call(viewer.cookie, "GET", "/api/delivery/tasks")).statusCode).toBe(200);
    expect((await call(viewer.cookie, "GET", "/api/delivery/agents/live")).statusCode).toBe(403);
    expect((await call(viewer.cookie, "GET", `/api/delivery/agents/${agent.id}/track`)).statusCode).toBe(403);
    expect((await call(viewer.cookie, "POST", `/api/delivery/tasks/${taskId}/cancel`, { reason: "Ko'ruvchi bekor qiladi" })).statusCode).toBe(403);

    const warehouse = await addEmployee(app, company, "Ombor menejeri");
    const secondTask = (await taskForOrder(app, company.ownerCookie, await confirmedOrder(app, company, "1"))).id;
    expect((await call(warehouse.cookie, "POST", `/api/delivery/tasks/${secondTask}/assign`, { deliveryAgentId: agent.id })).statusCode).toBe(403);
    expect((await call(warehouse.cookie, "POST", `/api/delivery/tasks/${secondTask}/return`, {})).json().details).toMatchObject({ reason: "invalid_transition" });

    const supervisor = await addEmployee(app, company, "Supervayzer");
    const live = await call(supervisor.cookie, "GET", "/api/delivery/agents/live");
    expect(live.statusCode).toBe(200);
    expect(live.json().agents[0]).toMatchObject({ id: agent.id, onDuty: true, currentTask: { id: taskId, status: "out_for_delivery" } });

    const salesManager = await addEmployee(app, company, "Savdo menejeri");
    expect((await call(salesManager.cookie, "POST", `/api/delivery/tasks/${secondTask}/assign`, { deliveryAgentId: agent.id })).statusCode).toBe(200);
    expect((await call(salesManager.cookie, "GET", "/api/delivery/agents/live")).statusCode).toBe(403);
    // Umumiy sozlama API'si orqali dostavka siyosatini tekshiruvsiz yozib bo'lmaydi
    expect((await call(company.ownerCookie, "PUT", "/api/company/settings/delivery.policy", { value: "{}" })).statusCode).toBe(400);
  });
});
