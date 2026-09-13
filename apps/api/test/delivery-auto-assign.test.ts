import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_DELIVERY_POLICY, type DeliveryAutoAssignPolicy } from "@bum/shared";
import { closeDb, db } from "../src/db/client.js";
import { deliveryEvents, deliveryTasks } from "../src/db/schema/delivery.js";
import { auditLogs } from "../src/db/schema/platform.js";
import { compareCandidates, evaluateCandidate, weekdayOf, weightToKg } from "../src/modules/delivery/auto-assign.service.js";
import { buildServer } from "../src/server.js";
import {
  assign,
  caller,
  confirmedOrder,
  deliveryAgent,
  deliveryCompany,
  localToday,
  northOf,
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
  company = await deliveryCompany(app, adminCookie, "Taqsimot");
});

const owner = () => company.ownerCookie;
const auto = (patch: Partial<DeliveryAutoAssignPolicy> = {}) => ({ autoAssign: { ...DEFAULT_DELIVERY_POLICY.autoAssign, enabled: true, ...patch } });

type Plan = {
  proposals: { taskId: string; deliveryAgentId: string; distanceMeters: number | null }[];
  skipped: { taskId: string; reason: string; counts?: Record<string, number> }[];
};

async function preview(body: Record<string, unknown> = {}, cookie = owner()) {
  return call(cookie, "POST", "/api/delivery/auto-assign/preview", { date: localToday(), ...body });
}

async function planOf(body: Record<string, unknown> = {}) {
  const res = await preview(body);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().plan as Plan;
}

async function farCustomer(meters: number) {
  const res = await call(owner(), "POST", "/api/sales/customers", { name: `Uzoq ${meters}`, phone: uniquePhone("95"), ...northOf(meters) });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().customer.id as string;
}

async function readyTask(extra: Record<string, unknown> = {}) {
  const orderId = await confirmedOrder(app, company, "2", extra);
  return (await taskForOrder(app, owner(), orderId)).id;
}

describe("avtomatik biriktirish qoidalari (sof)", () => {
  const rules = { ...DEFAULT_DELIVERY_POLICY.autoAssign, enabled: true };
  const agent = { schedule: null, onDuty: false, openTasks: 0, branchId: null, maxLoadKg: null, loadKg: 0, origin: null };
  const task = { branchId: null, weightKg: null, point: null };

  it("og'irlik birligi, hafta kuni, jadval, sessiya, limit, filial, yuk va masofa", () => {
    expect(weightToKg("2.5", "kg")).toBe(2.5);
    expect(weightToKg("500", "g")).toBe(0.5);
    expect(weightToKg("1", "T")).toBe(1000);
    expect(weightToKg("1", null)).toBeNull();
    expect(weightToKg("1", "lb")).toBeNull();
    expect(weekdayOf("2026-09-13")).toBe(0);
    expect(weekdayOf("2026-09-14")).toBe(1);

    const sunday = "2026-09-13";
    const monday = "2026-09-14";
    expect(evaluateCandidate({ ...agent, schedule: { days: [1], start: "09:00", end: "18:00" } }, task, rules, sunday, sunday)).toEqual({ ok: false, reason: "schedule" });
    expect(evaluateCandidate({ ...agent, schedule: { days: [1], start: "09:00", end: "18:00" } }, task, rules, monday, sunday)).toEqual({ ok: true, distance: null });
    expect(evaluateCandidate(agent, task, { ...rules, respectSchedule: false, requireOnDuty: true }, sunday, sunday)).toEqual({ ok: false, reason: "off_duty" });
    expect(evaluateCandidate(agent, task, { ...rules, requireOnDuty: true }, monday, sunday).ok).toBe(true);
    expect(evaluateCandidate({ ...agent, openTasks: 3 }, task, { ...rules, maxTasksPerAgent: 3 }, monday, sunday)).toEqual({ ok: false, reason: "task_limit" });
    expect(evaluateCandidate({ ...agent, branchId: "b1" }, { ...task, branchId: "b2" }, rules, monday, sunday)).toEqual({ ok: false, reason: "branch" });
    expect(evaluateCandidate({ ...agent, branchId: "b1" }, { ...task, branchId: "b2" }, { ...rules, respectBranch: false }, monday, sunday).ok).toBe(true);
    expect(evaluateCandidate({ ...agent, maxLoadKg: 10, loadKg: 8 }, { ...task, weightKg: 3 }, rules, monday, sunday)).toEqual({ ok: false, reason: "load_limit" });
    expect(evaluateCandidate({ ...agent, maxLoadKg: 10, loadKg: 8 }, { ...task, weightKg: 2 }, rules, monday, sunday).ok).toBe(true);
    expect(evaluateCandidate({ ...agent, maxLoadKg: 10, loadKg: 8 }, task, rules, monday, sunday).ok).toBe(true);
    expect(evaluateCandidate({ ...agent, origin: shop }, { ...task, point: northOf(1500) }, { ...rules, maxDistanceKm: 1 }, monday, sunday)).toEqual({ ok: false, reason: "too_far" });
    expect(evaluateCandidate({ ...agent, origin: shop }, { ...task, point: northOf(900) }, { ...rules, maxDistanceKm: 1 }, monday, sunday)).toEqual({ ok: true, distance: 900 });
  });

  it("strategiya: balanced — kam yuklangan, nearest — yaqini; noma'lum masofa yutqazadi; teng — kod", () => {
    const near = { agent: { openTasks: 3, code: "DA-002" }, distance: 100 };
    const light = { agent: { openTasks: 1, code: "DA-003" }, distance: 5000 };
    expect(compareCandidates(light, near, "balanced")).toBeLessThan(0);
    expect(compareCandidates(near, light, "nearest")).toBeLessThan(0);
    expect(compareCandidates({ agent: { openTasks: 1, code: "DA-009" }, distance: 50 }, { agent: { openTasks: 1, code: "DA-001" }, distance: null }, "balanced")).toBeLessThan(0);
    expect(compareCandidates({ agent: { openTasks: 1, code: "DA-001" }, distance: null }, { agent: { openTasks: 1, code: "DA-002" }, distance: null }, "nearest")).toBeLessThan(0);
  });
});

describe("avtomatik biriktirish (API)", () => {
  it("reja hech narsa yozmaydi; qo'llash teng taqsimlaydi, hodisa va audit bilan; qayta qo'llash — o'tkazib yuboriladi", async () => {
    await setPolicy(app, owner(), auto());
    const first = await deliveryAgent(app, company);
    const second = await deliveryAgent(app, company);
    const taskIds = [await readyTask(), await readyTask(), await readyTask(), await readyTask()];

    const plan = await planOf();
    expect(plan.proposals).toHaveLength(4);
    expect(plan.skipped).toEqual([]);
    const perAgent = (agentId: string) => plan.proposals.filter((item) => item.deliveryAgentId === agentId).length;
    expect([perAgent(first.id), perAgent(second.id)]).toEqual([2, 2]);
    const statuses = await db.select({ status: deliveryTasks.status }).from(deliveryTasks).where(eq(deliveryTasks.companyId, company.companyId));
    expect(statuses.every((row) => row.status === "ready")).toBe(true);

    const assignments = plan.proposals.map((item) => ({ taskId: item.taskId, deliveryAgentId: item.deliveryAgentId }));
    const applied = await call(owner(), "POST", "/api/delivery/auto-assign", { date: localToday(), assignments });
    expect(applied.statusCode, applied.body).toBe(200);
    expect(applied.json().result.assigned).toHaveLength(4);
    const rows = await db
      .select({ id: deliveryTasks.id, status: deliveryTasks.status, agentId: deliveryTasks.deliveryAgentId, routeOrder: deliveryTasks.routeOrder })
      .from(deliveryTasks)
      .where(eq(deliveryTasks.companyId, company.companyId));
    expect(rows.every((row) => row.status === "assigned")).toBe(true);
    expect(rows.filter((row) => row.agentId === first.id).map((row) => row.routeOrder).sort()).toEqual([1, 2]);
    const events = await db.select().from(deliveryEvents).where(and(eq(deliveryEvents.companyId, company.companyId), eq(deliveryEvents.action, "ASSIGNED")));
    expect(events).toHaveLength(4);
    expect(events.every((event) => (event.details as { auto?: { trigger: string } }).auto?.trigger === "manual")).toBe(true);
    const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.companyId, company.companyId), eq(auditLogs.action, "DELIVERY_AUTO_ASSIGNED")));
    expect(audits).toHaveLength(4);

    const again = await call(owner(), "POST", "/api/delivery/auto-assign", { date: localToday(), assignments });
    expect(again.statusCode).toBe(200);
    expect(again.json().result.assigned).toEqual([]);
    expect(again.json().result.skipped.map((item: { taskId: string; reason: string }) => item.reason)).toEqual(Array(4).fill("task_not_ready"));
    expect(taskIds.every((id) => rows.some((row) => row.id === id))).toBe(true);
  });

  it("nearest va balanced boshlang'ich nuqtaga qarab farq qiladi; masofa chegarasi; kunlik limit va jadval; ishdagi agent", async () => {
    await setPolicy(app, owner(), auto());
    const local = await deliveryAgent(app, company);
    const remote = await deliveryAgent(app, company);
    const farId = await farCustomer(5000);
    // local: 1 ta yetkazma do'konda; remote: 2 ta yetkazma uzoqdagi mijozda
    await assign(app, owner(), await readyTask(), local.id);
    await assign(app, owner(), await readyTask({ customerId: farId }), remote.id);
    await assign(app, owner(), await readyTask({ customerId: farId }), remote.id);
    const target = await readyTask({ customerId: farId });

    const nearest = await planOf({ strategy: "nearest" });
    expect(nearest.proposals).toMatchObject([{ taskId: target, deliveryAgentId: remote.id, distanceMeters: 0 }]);
    const balanced = await planOf({ strategy: "balanced" });
    expect(balanced.proposals).toMatchObject([{ taskId: target, deliveryAgentId: local.id, distanceMeters: 5000 }]);

    await setPolicy(app, owner(), auto({ maxDistanceKm: 1 }));
    expect((await planOf({ strategy: "balanced" })).proposals).toMatchObject([{ deliveryAgentId: remote.id }]);

    // limit 2: remote to'la, local jadvalida bugun yo'q → biriktirilmaydi, sabablar sanog'i bilan
    const today = weekdayOf(localToday());
    const patch = await call(owner(), "PATCH", `/api/delivery/agents/${local.id}`, { workingSchedule: { days: [(today + 1) % 7], start: "09:00", end: "18:00" } });
    expect(patch.statusCode, patch.body).toBe(200);
    await setPolicy(app, owner(), auto({ maxTasksPerAgent: 2 }));
    const limited = await planOf();
    expect(limited.proposals).toEqual([]);
    expect(limited.skipped).toMatchObject([{ taskId: target, counts: { schedule: 1, task_limit: 1 } }]);

    // Faqat ishdagi agent: jadval va limit o'chirilgan, local ish sessiyasini boshlaydi
    await setPolicy(app, owner(), auto({ requireOnDuty: true, respectSchedule: false, maxTasksPerAgent: 30 }));
    expect((await planOf()).skipped).toMatchObject([{ taskId: target, reason: "off_duty" }]);
    await startShift(app, local.cookie);
    expect((await planOf()).proposals).toMatchObject([{ taskId: target, deliveryAgentId: local.id }]);
  });

  it("yaratilganda darhol biriktirish (siyosat bo'yicha); mos agent bo'lmasa — tayyor qoladi va buyurtma tasdiqlanadi", async () => {
    await setPolicy(app, owner(), auto({ onCreate: true }));
    const withoutAgents = await readyTask();
    expect((await db.select({ status: deliveryTasks.status }).from(deliveryTasks).where(eq(deliveryTasks.id, withoutAgents)))[0]!.status).toBe("ready");

    const agent = await deliveryAgent(app, company);
    const created = await readyTask();
    const [row] = await db.select({ status: deliveryTasks.status, agentId: deliveryTasks.deliveryAgentId }).from(deliveryTasks).where(eq(deliveryTasks.id, created));
    expect(row).toEqual({ status: "assigned", agentId: agent.id });
    const [event] = await db.select().from(deliveryEvents).where(and(eq(deliveryEvents.taskId, created), eq(deliveryEvents.action, "ASSIGNED")));
    expect((event!.details as { auto: { trigger: string } }).auto.trigger).toBe("on_create");

    await setPolicy(app, owner(), auto({ onCreate: false }));
    const manual = await readyTask();
    expect((await db.select({ status: deliveryTasks.status }).from(deliveryTasks).where(eq(deliveryTasks.id, manual)))[0]!.status).toBe("ready");
  });

  it("xavfsizlik: siyosat o'chiq, ruxsat, o'tgan sana, qat'iy tana, boshqa kompaniya ma'lumoti", async () => {
    const agent = await deliveryAgent(app, company);
    const taskId = await readyTask();
    const disabled = await preview();
    expect(disabled.statusCode).toBe(409);
    expect(disabled.json().details.reason).toBe("auto_assign_disabled");

    await setPolicy(app, owner(), auto());
    expect((await preview({}, agent.cookie)).statusCode).toBe(403);
    const cashier = await addEmployee(app, company, "Kassir");
    expect((await preview({}, cashier.cookie)).statusCode).toBe(403);
    const past = await preview({ date: "2020-01-01" });
    expect(past.statusCode).toBe(400);
    expect(past.json().details.reason).toBe("date_in_past");
    expect((await preview({ deliveryAgentId: agent.id })).statusCode).toBe(400);
    const duplicate = await call(owner(), "POST", "/api/delivery/auto-assign", {
      date: localToday(),
      assignments: [
        { taskId, deliveryAgentId: agent.id },
        { taskId, deliveryAgentId: agent.id },
      ],
    });
    expect(duplicate.statusCode).toBe(400);

    const other = await deliveryCompany(app, adminCookie, "Boshqa taqsimot");
    await setPolicy(app, other.ownerCookie, auto());
    const otherAgent = await deliveryAgent(app, other);
    const otherOrder = await confirmedOrder(app, other, "1");
    const otherTask = (await taskForOrder(app, other.ownerCookie, otherOrder)).id;

    const res = await call(owner(), "POST", "/api/delivery/auto-assign", {
      date: localToday(),
      assignments: [
        { taskId: otherTask, deliveryAgentId: agent.id },
        { taskId, deliveryAgentId: otherAgent.id },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().result.assigned).toEqual([]);
    expect(res.json().result.skipped).toEqual([
      { taskId: otherTask, number: null, customerName: null, reason: "task_not_ready" },
      expect.objectContaining({ taskId, reason: "agent_unavailable" }),
    ]);
    const [foreign] = await db.select({ status: deliveryTasks.status }).from(deliveryTasks).where(eq(deliveryTasks.id, otherTask));
    expect(foreign!.status).toBe("ready");
    // Reja faqat o'z kompaniyasi yetkazmalari
    expect((await planOf()).proposals.map((item) => item.taskId)).toEqual([taskId]);
  });
});
