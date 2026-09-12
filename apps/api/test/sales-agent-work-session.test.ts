import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { auditLogs } from "../src/db/schema/platform.js";
import { agentLocationLatest, agentLocations, agentWorkSessions } from "../src/db/schema/sales-agent.js";
import { buildServer } from "../src/server.js";
import { purgeExpired } from "../src/shared/maintenance.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PATCH";

let app: FastifyInstance;
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
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Distribyutor" });
});

const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

const point = (accuracy = 10) => ({ latitude: 41.3115, longitude: 69.2406, accuracy, recordedAt: new Date().toISOString() });
const actionCount = (action: string) => db.$count(auditLogs, eq(auditLogs.action, action));

async function agent() {
  const employee = await addEmployee(app, company, "Sotuv agenti");
  const rep = await call(company.ownerCookie, "POST", "/api/distribution/sales-reps", { name: "Ali", userId: employee.id });
  return { cookie: employee.cookie, repId: rep.json().salesRep.id as string };
}

describe("Ish sessiyasi va lokatsiya maxfiyligi", () => {
  it("ish vaqtidan tashqari lokatsiya qabul qilinmaydi; boshlash/yakunlash, jonli joy o'chadi, audit", async () => {
    const ali = await agent();

    // Shaxsiy vaqt: nuqta saqlanmaydi, tashrif boshlanmaydi
    const offDuty = await call(ali.cookie, "POST", "/api/sales-agent/location", point());
    expect(offDuty.statusCode).toBe(409);
    expect(offDuty.json().details).toEqual({ reason: "work_session_required" });
    expect(await db.$count(agentLocations)).toBe(0);
    expect((await call(ali.cookie, "GET", "/api/sales-agent/work-session")).json().session).toBeNull();

    expect((await call(ali.cookie, "POST", "/api/sales-agent/work-session/start", point(500))).json().details).toEqual({ reason: "low_accuracy" });
    const started = await call(ali.cookie, "POST", "/api/sales-agent/work-session/start", point());
    expect(started.statusCode).toBe(201);
    const session = started.json().session;
    expect(session).toMatchObject({ status: "active", endedAt: null });
    // Takror bosish — o'sha sessiya
    const again = await call(ali.cookie, "POST", "/api/sales-agent/work-session/start", point());
    expect(again.statusCode).toBe(200);
    expect(again.json().session.id).toBe(session.id);

    expect((await call(ali.cookie, "POST", "/api/sales-agent/location", point())).json()).toMatchObject({ accepted: true });
    const [stored] = await db.select().from(agentLocations).where(eq(agentLocations.salesRepId, ali.repId));
    expect(stored!.workSessionId).toBe(session.id);

    const supervisor = await addEmployee(app, company, "Supervayzer");
    const onDuty = (await call(supervisor.cookie, "GET", "/api/sales-agent/supervisor/agents")).json().agents[0];
    expect(onDuty).toMatchObject({ online: true });
    expect(onDuty.workSessionStartedAt).not.toBeNull();

    const ended = await call(ali.cookie, "POST", "/api/sales-agent/work-session/end", point());
    expect(ended.statusCode).toBe(200);
    expect(ended.json().session).toMatchObject({ id: session.id, status: "ended", endReason: "agent" });
    expect(await db.$count(agentLocationLatest, eq(agentLocationLatest.salesRepId, ali.repId))).toBe(0);
    expect((await call(ali.cookie, "POST", "/api/sales-agent/location", point())).statusCode).toBe(409);
    expect((await call(ali.cookie, "POST", "/api/sales-agent/work-session/end", {})).statusCode).toBe(409);

    const offDutyNow = (await call(supervisor.cookie, "GET", "/api/sales-agent/supervisor/agents")).json().agents[0];
    expect(offDutyNow).toMatchObject({ online: false, latitude: null, workSessionStartedAt: null });
    expect(await actionCount("WORK_SESSION_START")).toBe(1);
    expect(await actionCount("WORK_SESSION_END")).toBe(1);
  });

  it("uzoq ochiq sessiya avtomatik yopiladi; agent faolsizlantirilsa sessiya yopiladi", async () => {
    const ali = await agent();
    await call(ali.cookie, "POST", "/api/sales-agent/work-session/start", point());
    await db.update(agentWorkSessions).set({ startedAt: new Date(Date.now() - 17 * 3_600_000) }).where(eq(agentWorkSessions.salesRepId, ali.repId));

    expect(await purgeExpired(new Date())).toMatchObject({ workSessionsEnded: 1 });
    const [auto] = await db.select().from(agentWorkSessions).where(eq(agentWorkSessions.salesRepId, ali.repId));
    expect(auto).toMatchObject({ status: "ended", endReason: "auto" });

    await call(ali.cookie, "POST", "/api/sales-agent/work-session/start", point());
    const team = await call(company.ownerCookie, "PATCH", `/api/sales-agent/team/${ali.repId}`, { isActive: false });
    expect(team.statusCode).toBe(200);
    expect(await db.$count(agentWorkSessions, eq(agentWorkSessions.status, "active"))).toBe(0);
  });
});
