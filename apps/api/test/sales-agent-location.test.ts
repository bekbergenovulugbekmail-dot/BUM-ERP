import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SALES_AGENT_POLICY } from "@bum/shared";
import { closeDb, db } from "../src/db/client.js";
import { auditLogs } from "../src/db/schema/platform.js";
import { agentLocationEvents, agentLocationLatest, agentLocations } from "../src/db/schema/sales-agent.js";
import { buildServer } from "../src/server.js";
import { purgeExpired } from "../src/shared/maintenance.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PUT";

let app: FastifyInstance;
let admin: Awaited<ReturnType<typeof signedIn>>;
let company: Company;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
  admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Distribyutor" });
});

const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

async function agent(name: string, owner = company) {
  const employee = await addEmployee(app, owner, "Sotuv agenti");
  const rep = await call(owner.ownerCookie, "POST", "/api/distribution/sales-reps", { name, userId: employee.id });
  expect(rep.statusCode).toBe(201);
  expect(
    (await call(employee.cookie, "POST", "/api/sales-agent/work-session/start", { latitude: 41.3115, longitude: 69.2406, accuracy: 10, recordedAt: new Date().toISOString() }))
      .statusCode,
  ).toBe(201);
  return { cookie: employee.cookie, userId: employee.id, repId: rep.json().salesRep.id as string };
}

const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
const send = (cookie: string, body: object) => call(cookie, "POST", "/api/sales-agent/location", body);
const tashkent = { latitude: 41.311081, longitude: 69.240562 };
/** Mahalliy (UTC+5) bugungi sana. */
const localToday = () => new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);

describe("Agent lokatsiyasi", () => {
  it("sifat: noto'g'ri, kelajak vaqt, eskirgan, aniqligi past — rad va hodisa; sakrash — shubhali; oxirgi joy", async () => {
    const ali = await agent("Ali");
    const vali = await agent("Vali");

    const accepted = await send(ali.cookie, { ...tashkent, accuracy: 15, recordedAt: iso() });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ accepted: true, suspicious: false, flags: [], nextIntervalSeconds: 60 });

    const reject = async (body: object, reason: string) => {
      const res = await send(ali.cookie, { ...tashkent, accuracy: 15, recordedAt: iso(), ...body });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ accepted: false, reason });
    };
    await reject({ latitude: 0, longitude: 0 }, "invalid");
    await reject({ recordedAt: iso(10 * 60_000) }, "invalid");
    await reject({ recordedAt: iso(-10 * 60_000) }, "stale");
    await reject({ accuracy: 500 }, "low_accuracy");
    expect((await send(ali.cookie, { ...tashkent, latitude: 95, accuracy: 10, recordedAt: iso() })).statusCode).toBe(400);

    // 30 soniyada Samarqandga — imkonsiz tezlik: saqlanadi, lekin shubhali
    const jump = await send(ali.cookie, { latitude: 39.65, longitude: 66.96, accuracy: 20, recordedAt: iso(30_000) });
    expect(jump.json()).toMatchObject({ accepted: true, suspicious: true, flags: ["jump"] });

    const events = await db.select().from(agentLocationEvents).where(eq(agentLocationEvents.salesRepId, ali.repId));
    const count = (type: string) => events.filter((event) => event.type === type).length;
    expect([count("invalid"), count("stale"), count("low_accuracy"), count("jump")]).toEqual([2, 1, 1, 1]);
    expect(await db.$count(agentLocations, eq(agentLocations.salesRepId, ali.repId))).toBe(2);
    const [latest] = await db.select().from(agentLocationLatest).where(eq(agentLocationLatest.salesRepId, ali.repId));
    expect(latest).toMatchObject({ latitude: "39.650000", suspicious: true });

    // Vali o'z nuqtasini yozadi — Alining oxirgi joyi o'zgarmaydi
    await send(vali.cookie, { ...tashkent, accuracy: 10, recordedAt: iso() });
    const [aliAgain] = await db.select().from(agentLocationLatest).where(eq(agentLocationLatest.salesRepId, ali.repId));
    expect(aliAgain!.latitude).toBe("39.650000");

    // Ruxsatsiz: kassir va bog'lanmagan agent
    const kassir = await addEmployee(app, company, "Kassir");
    expect((await send(kassir.cookie, { ...tashkent, accuracy: 10, recordedAt: iso() })).statusCode).toBe(403);
    const unlinked = await addEmployee(app, company, "Sotuv agenti");
    expect((await send(unlinked.cookie, { ...tashkent, accuracy: 10, recordedAt: iso() })).statusCode).toBe(403);

    // Qurilma ruxsat bermadi — hodisa va audit
    expect((await call(ali.cookie, "POST", "/api/sales-agent/location/events", { type: "permission_denied" })).statusCode).toBe(204);
    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "LOCATION_PERMISSION_DENIED"), eq(auditLogs.userId, ali.userId)));
    expect(audit).toBeDefined();
  });

  it("supervayzer: holat va oxirgi joy, jonli, tarix (audit), hodisalar; ruxsat va kompaniya chegarasi", async () => {
    const ali = await agent("Ali");
    await agent("Vali");
    await send(ali.cookie, { ...tashkent, accuracy: 12, recordedAt: iso() });
    await send(ali.cookie, { ...tashkent, accuracy: 900, recordedAt: iso() });

    const supervisor = await addEmployee(app, company, "Supervayzer");
    const agents = await call(supervisor.cookie, "GET", "/api/sales-agent/supervisor/agents");
    expect(agents.statusCode).toBe(200);
    const byName = new Map(agents.json().agents.map((row: { name: string }) => [row.name, row]));
    expect(byName.get("Ali")).toMatchObject({ online: true, latitude: "41.311081", hasLogin: true, todayRoutes: [] });
    expect(byName.get("Vali")).toMatchObject({ online: false, latitude: null });

    const live = await call(supervisor.cookie, "GET", `/api/sales-agent/supervisor/live?since=${encodeURIComponent(iso(-60_000))}`);
    expect(live.json().locations.map((row: { name: string }) => row.name)).toEqual(["Ali"]);

    const history = await call(supervisor.cookie, "GET", `/api/sales-agent/supervisor/agents/${ali.repId}/history?date=${localToday()}`);
    expect(history.statusCode).toBe(200);
    expect(history.json()).toMatchObject({ agent: { name: "Ali" }, truncated: false });
    expect(history.json().points).toHaveLength(1);
    expect(history.json().events.map((event: { type: string }) => event.type)).toEqual(["low_accuracy"]);
    expect(await db.$count(auditLogs, eq(auditLogs.action, "LOCATION_HISTORY_VIEWED"))).toBe(1);

    const events = await call(supervisor.cookie, "GET", `/api/sales-agent/supervisor/events?date=${localToday()}&type=low_accuracy`);
    expect(events.json().events).toEqual([expect.objectContaining({ salesRepName: "Ali", type: "low_accuracy" })]);

    // Lokatsiyani faqat lokatsiya ruxsati bor ko'radi: agent, ko'ruvchi, kassir, savdo menejeri — 403
    const viewer = await addEmployee(app, company, "Ko'ruvchi");
    const manager = await addEmployee(app, company, "Savdo menejeri");
    for (const cookie of [ali.cookie, viewer.cookie, manager.cookie]) {
      expect((await call(cookie, "GET", "/api/sales-agent/supervisor/agents")).statusCode).toBe(403);
      expect((await call(cookie, "GET", `/api/sales-agent/supervisor/agents/${ali.repId}/history`)).statusCode).toBe(403);
    }
    expect((await call(manager.cookie, "GET", "/api/sales-agent/supervisor/live")).statusCode).toBe(403);
    // Savdo menejerida nazorat bor — hodisalarni ko'radi
    expect((await call(manager.cookie, "GET", "/api/sales-agent/supervisor/events")).statusCode).toBe(200);

    // Boshqa kompaniya supervayzeri bu agentni ko'rmaydi
    const other = await createCompany(app, admin.cookie, { name: "Boshqa" });
    const foreign = await addEmployee(app, other, "Supervayzer");
    expect((await call(foreign.cookie, "GET", `/api/sales-agent/supervisor/agents/${ali.repId}/history`)).statusCode).toBe(404);
    expect((await call(foreign.cookie, "GET", "/api/sales-agent/supervisor/agents")).json().agents).toEqual([]);
  });

  it("siyosat: standart, saqlash va chegaralar; umumiy sozlama yo'li rad; saqlash muddati bo'yicha tozalash", async () => {
    const ali = await agent("Ali");
    const supervisor = await addEmployee(app, company, "Supervayzer");

    expect((await call(ali.cookie, "GET", "/api/sales-agent/policy")).json().policy).toEqual(DEFAULT_SALES_AGENT_POLICY);
    const policy = { ...DEFAULT_SALES_AGENT_POLICY, geofenceRadiusMeters: 150, maxAccuracyMeters: 50, locationRetentionDays: 30 };
    expect((await call(supervisor.cookie, "PUT", "/api/sales-agent/policy", policy)).statusCode).toBe(200);
    expect((await call(supervisor.cookie, "PUT", "/api/sales-agent/policy", { ...policy, geofenceRadiusMeters: 5 })).statusCode).toBe(400);
    expect((await call(ali.cookie, "PUT", "/api/sales-agent/policy", policy)).statusCode).toBe(403);
    expect((await call(ali.cookie, "GET", "/api/sales-agent/policy")).json().policy.geofenceRadiusMeters).toBe(150);
    expect(
      (await call(company.ownerCookie, "PUT", "/api/company/settings/sales_agent.policy", { value: "{}", group: "sales_agent" })).statusCode,
    ).toBe(400);

    // Aniqlik chegarasi endi 50 m
    expect((await send(ali.cookie, { ...tashkent, accuracy: 60, recordedAt: iso() })).json()).toMatchObject({ accepted: false, reason: "low_accuracy" });

    // Saqlash muddati 30 kun: 40 kunlik nuqta o'chadi, 20 kunlik qoladi
    const day = 86_400_000;
    await db.insert(agentLocations).values(
      [40, 20].map((days) => ({
        companyId: company.companyId,
        salesRepId: ali.repId,
        latitude: "41.311081",
        longitude: "69.240562",
        accuracy: "10.00",
        recordedAt: new Date(Date.now() - days * day),
      })),
    );
    const purged = await purgeExpired(new Date());
    expect(purged).toMatchObject({ agentLocations: 1, agentLocationEvents: 0 });
    expect(await db.$count(agentLocations, eq(agentLocations.salesRepId, ali.repId))).toBe(1);
  });
});
