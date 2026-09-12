import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { deliveryLocations, deliveryWorkSessions } from "../src/db/schema/delivery.js";
import { auditLogs } from "../src/db/schema/platform.js";
import { purgeExpired } from "../src/shared/maintenance.js";
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
  iso,
  near,
  northOf,
  resetUnits,
  setPolicy,
  startShift,
  taskForOrder,
  type DeliveryCompany,
} from "./delivery-setup.js";
import { resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
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
  const adminCookie = (await signedIn(app, { isPlatformAdmin: true })).cookie;
  company = await deliveryCompany(app, adminCookie, "Kuzatuv");
});

describe("Dostavka: ish sessiyasi, lokatsiya, hisobotlar", () => {
  it("lokatsiya faqat ish vaqtida; paket (eskirgan va sakrash nuqtalari); supervayzer jonli holati va izi (audit); yakunlangach kuzatuv to'xtaydi", async () => {
    const agent = await deliveryAgent(app, company);
    expect((await call(agent.cookie, "POST", "/api/delivery/agent/locations", { points: [near(10)] })).statusCode).toBe(409);
    expect((await call(agent.cookie, "GET", "/api/delivery/agent/work-session")).json().session).toBeNull();

    const started = await call(agent.cookie, "POST", "/api/delivery/agent/work-session/start", near(30));
    expect(started.statusCode).toBe(201);
    const again = await call(agent.cookie, "POST", "/api/delivery/agent/work-session/start", near(30));
    expect(again.statusCode).toBe(200);
    expect(again.json().session.id).toBe(started.json().session.id);
    expect((await call(agent.cookie, "POST", "/api/delivery/agent/work-session/start", { ...near(30), accuracy: 900 })).statusCode).toBe(200);

    const batch = await call(agent.cookie, "POST", "/api/delivery/agent/locations", {
      points: [near(10, 5), near(15, 40 * 60), { ...northOf(3000), accuracy: 10, recordedAt: iso(0) }],
    });
    expect(batch.statusCode, batch.body).toBe(200);
    expect(batch.json()).toMatchObject({ accepted: 2, suspicious: 1, rejected: [{ index: 1, reason: "stale" }], nextIntervalSeconds: 60 });
    expect((await call(agent.cookie, "POST", "/api/delivery/agent/locations", { points: [{ ...near(10), distanceMeters: 1 }] })).statusCode).toBe(400);

    expect((await call(agent.cookie, "GET", "/api/delivery/agents/live")).statusCode).toBe(403);
    const live = (await call(company.ownerCookie, "GET", "/api/delivery/agents/live")).json().agents;
    expect(live).toMatchObject([{ id: agent.id, onDuty: true, online: true, suspicious: true, today: { total: 0, done: 0 } }]);

    const track = await call(company.ownerCookie, "GET", `/api/delivery/agents/${agent.id}/track`);
    expect(track.statusCode).toBe(200);
    expect(track.json().points).toHaveLength(2);
    expect(track.json().sessions).toHaveLength(1);
    const viewed = await db.select().from(auditLogs).where(and(eq(auditLogs.companyId, company.companyId), eq(auditLogs.action, "LOCATION_HISTORY_VIEWED")));
    expect(viewed).toHaveLength(1);

    // Mijozda topshirilayotgan yetkazma bo'lsa ishni yakunlab bo'lmaydi
    await setPolicy(app, company.ownerCookie, NO_PROOFS);
    const { taskId } = await arrivedTask(app, company, agent, "1");
    expect((await call(agent.cookie, "POST", "/api/delivery/agent/work-session/end", {})).json().details).toMatchObject({ reason: "task_in_progress" });
    await agentAction(app, agent.cookie, taskId, "fail", { reason: "no_answer" });

    const ended = await call(agent.cookie, "POST", "/api/delivery/agent/work-session/end", near(20));
    expect(ended.statusCode, ended.body).toBe(200);
    expect(ended.json().session).toMatchObject({ status: "ended", endReason: "agent" });
    const after = (await call(company.ownerCookie, "GET", "/api/delivery/agents/live")).json().agents[0];
    expect(after).toMatchObject({ onDuty: false, online: false, latitude: null });
    expect((await call(agent.cookie, "POST", "/api/delivery/agent/locations", { points: [near(10)] })).statusCode).toBe(409);
  });

  it("tozalash: saqlash muddatidan eski nuqtalar o'chadi, 16 soatdan uzoq ochiq sessiya avtomatik yopiladi", async () => {
    const agent = await deliveryAgent(app, company);
    const session = await startShift(app, agent.cookie);
    await db.insert(deliveryLocations).values({
      companyId: company.companyId,
      deliveryAgentId: agent.id,
      latitude: "41.311081",
      longitude: "69.240562",
      accuracy: "10",
      recordedAt: new Date(Date.now() - 100 * 86_400_000),
    });
    await call(agent.cookie, "POST", "/api/delivery/agent/locations", { points: [near(10)] });
    await db.update(deliveryWorkSessions).set({ startedAt: new Date(Date.now() - 17 * 3_600_000) }).where(eq(deliveryWorkSessions.id, session.id));

    const result = await purgeExpired();
    expect(result).toMatchObject({ deliveryLocations: 1, deliverySessionsEnded: 1 });
    expect(await db.select().from(deliveryLocations).where(eq(deliveryLocations.deliveryAgentId, agent.id))).toHaveLength(1);
    const [closed] = await db.select().from(deliveryWorkSessions).where(eq(deliveryWorkSessions.id, session.id));
    expect(closed).toMatchObject({ status: "ended", endReason: "auto" });
  });

  it("bosh sahifa va hisobotlar: agent faqat o'z ma'lumoti; supervayzer kesimi (holatlar, yig'ilgan pul, qaytishi kutilayotgan)", async () => {
    await setPolicy(app, company.ownerCookie, NO_PROOFS);
    const ali = await deliveryAgent(app, company, { name: "Ali" });
    const vali = await deliveryAgent(app, company, { name: "Vali" });
    await startShift(app, ali.cookie);
    await startShift(app, vali.cookie);

    const delivered = await arrivedTask(app, company, ali, "10");
    await agentAction(app, ali.cookie, delivered.taskId, "payments", { method: "cash", amount: "50000" });
    expect((await agentAction(app, ali.cookie, delivered.taskId, "confirm", near(20))).statusCode).toBe(200);
    const failed = await arrivedTask(app, company, ali, "2");
    await agentAction(app, ali.cookie, failed.taskId, "fail", { reason: "no_answer" });
    const waiting = await confirmedOrder(app, company, "1");
    await assign(app, company.ownerCookie, (await taskForOrder(app, company.ownerCookie, waiting)).id, vali.id);
    await confirmedOrder(app, company, "1");

    const aliDashboard = (await call(ali.cookie, "GET", "/api/delivery/agent/dashboard")).json().dashboard;
    expect(aliDashboard).toMatchObject({
      tasks: { total: 2, done: 2, remaining: 0, delivered: 1, failed: 1, onRoute: 0 },
      progressPercent: 100,
      collected: { cash: "50000.00", total: "50000.00" },
      workSession: { status: "active" },
    });
    expect((await call(vali.cookie, "GET", "/api/delivery/agent/dashboard")).json().dashboard).toMatchObject({
      tasks: { total: 1, remaining: 1, done: 0 },
      collected: { total: "0.00" },
    });

    const board = (await call(company.ownerCookie, "GET", "/api/delivery/dashboard")).json().dashboard;
    expect(board).toMatchObject({ total: 4, unassigned: 1, waiting: 1, delivered: 1, failed: 1, pendingReturns: 1, collected: { cash: "50000.00" } });
    expect(board.agents).toHaveLength(2);

    const aliReport = (await call(ali.cookie, "GET", "/api/delivery/agent/reports")).json().report;
    expect(aliReport.deliveries).toMatchObject({ total: 2, delivered: 1, failed: 1 });
    expect(aliReport.collected).toMatchObject({ cash: "50000.00" });
    expect(aliReport.failureReasons).toEqual([{ reason: "no_answer", count: 1 }]);
    const report = (await call(company.ownerCookie, "GET", "/api/delivery/reports")).json().report;
    expect(report.agents.map((row: { agent: { name: string } }) => row.agent.name).sort()).toEqual(["Ali", "Vali"]);
    expect((await call(company.ownerCookie, "GET", "/api/delivery/reports?from=2026-01-01&to=2026-12-31")).statusCode).toBe(400);

    const customers = (await call(ali.cookie, "GET", "/api/delivery/agent/customers")).json().customers;
    expect(customers).toHaveLength(1);
    expect(customers[0]).toHaveProperty("totalDebt");
    const debts = (await call(ali.cookie, "GET", "/api/delivery/agent/debts")).json();
    expect(debts.collections).toHaveLength(1);
  });
});
