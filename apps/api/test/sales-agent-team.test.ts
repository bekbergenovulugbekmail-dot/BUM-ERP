import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { salesReps } from "../src/db/schema/crm.js";
import { employees } from "../src/db/schema/hr.js";
import { auditLogs, companyMembers } from "../src/db/schema/platform.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, login, resetDatabase, signedIn } from "./helpers.js";

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

const call = (cookie: string | undefined, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: cookie ? { cookie } : {}, ...(payload ? { payload } : {}) });

const PHONE = "+998905551122";
const PASSWORD = "agent-parol-1";

describe("Sotuv agenti qo'shish", () => {
  it("bitta jarayonda login, a'zolik, HR xodimi va agent profili; parol auditda yo'q; takror telefon; ruxsat", async () => {
    const supervisor = await addEmployee(app, company, "Supervayzer");
    const kassir = await addEmployee(app, company, "Kassir");
    const body = {
      name: "Ali Valiyev",
      phone: "+998 90 555 11 22",
      password: PASSWORD,
      region: "Chilonzor",
      supervisorUserId: supervisor.id,
      monthlyTarget: "150000000",
    };

    expect((await call(kassir.cookie, "POST", "/api/sales-agent/team", body)).statusCode).toBe(403);
    expect((await call(supervisor.cookie, "POST", "/api/sales-agent/team", { ...body, password: "123" })).statusCode).toBe(400);

    const created = await call(supervisor.cookie, "POST", "/api/sales-agent/team", body);
    expect(created.statusCode).toBe(201);
    const agent = created.json().agent;
    expect(agent).toMatchObject({
      name: "Ali Valiyev",
      phone: PHONE,
      region: "Chilonzor",
      monthlyTarget: "150000000.00",
      isActive: true,
      loginActive: true,
      positionName: "Sotuv agenti",
      employeeStatus: "active",
      supervisorUserId: supervisor.id,
    });

    const [employee] = await db.select().from(employees).where(eq(employees.userId, agent.userId));
    expect(employee).toMatchObject({ id: agent.employeeId, name: "Ali Valiyev", phone: PHONE, status: "active" });
    const [member] = await db
      .select()
      .from(companyMembers)
      .where(and(eq(companyMembers.userId, agent.userId), eq(companyMembers.companyId, company.companyId)));
    expect(member).toMatchObject({ companyRole: "Sotuv agenti", isActive: true });

    // Takror telefon — hech narsa qo'shimcha yaratilmaydi
    expect((await call(supervisor.cookie, "POST", "/api/sales-agent/team", { ...body, name: "Boshqa" })).statusCode).toBe(409);
    expect(await db.$count(salesReps, eq(salesReps.companyId, company.companyId))).toBe(1);
    // Har bir login ochilgan xodimda HR kartochkasi bor: supervayzer, agentlar menejeri va agentning o'zi
    expect(await db.$count(employees, eq(employees.companyId, company.companyId))).toBe(3);

    const auditRows = await db.select().from(auditLogs).where(eq(auditLogs.companyId, company.companyId));
    expect(auditRows.some((row) => row.action === "SALES_AGENT_CREATED")).toBe(true);
    expect(JSON.stringify(auditRows)).not.toContain(PASSWORD);

    // Telefon + parol bilan kiradi va agent ish joyi ochiladi
    const session = await login(app, PHONE, PASSWORD);
    expect(session.res.statusCode).toBe(200);
    expect((await call(session.cookie, "GET", "/api/sales-agent/me")).json().agent).toMatchObject({ id: agent.id, name: "Ali Valiyev" });

    // Ro'yxatda login ochilgan barcha xodimlar bor; agentning kartochkasida lavozim, holat, hudud va supervayzer
    const hrList = (await call(company.ownerCookie, "GET", "/api/hr/employees")).json().employees as {
      name: string;
      supervisorName: string | null;
    }[];
    const card = hrList.find((row) => row.name === "Ali Valiyev");
    expect(card).toMatchObject({ positionName: "Sotuv agenti", status: "active", salesRepId: agent.id, agentRegion: "Chilonzor" });
    expect(card!.supervisorName).toEqual(expect.any(String));
    const supervisors = (await call(supervisor.cookie, "GET", "/api/sales-agent/team/supervisors")).json().supervisors;
    expect(supervisors.map((s: { userId: string }) => s.userId)).toContain(supervisor.id);
    expect((await call(supervisor.cookie, "GET", "/api/sales-agent/team")).json().agents).toHaveLength(1);
  });

  it("faolsizlantirish va HR ishdan bo'shatish loginni bloklaydi, sessiyalarni yopadi; qayta faollashtirish ochadi", async () => {
    const owner = company.ownerCookie;
    const agent = (
      await call(owner, "POST", "/api/sales-agent/team", { name: "Vali", phone: PHONE, password: PASSWORD })
    ).json().agent;

    const first = await login(app, PHONE, PASSWORD);
    expect((await call(first.cookie, "GET", "/api/sales-agent/me")).statusCode).toBe(200);

    const off = await call(owner, "PATCH", `/api/sales-agent/team/${agent.id}`, { isActive: false });
    expect(off.json().agent).toMatchObject({ isActive: false, loginActive: false, employeeStatus: "terminated" });
    expect((await call(first.cookie, "GET", "/api/sales-agent/me")).statusCode).toBe(401);
    expect((await login(app, PHONE, PASSWORD)).res.statusCode).toBe(403);

    const on = await call(owner, "PATCH", `/api/sales-agent/team/${agent.id}`, { isActive: true });
    expect(on.json().agent).toMatchObject({ isActive: true, loginActive: true, employeeStatus: "active" });
    const second = await login(app, PHONE, PASSWORD);
    expect((await call(second.cookie, "GET", "/api/sales-agent/me")).statusCode).toBe(200);

    // HR bo'limida ishdan bo'shatish ham xuddi shunday
    expect((await call(owner, "PATCH", `/api/hr/employees/${agent.employeeId}`, { status: "terminated" })).statusCode).toBe(200);
    expect((await call(second.cookie, "GET", "/api/sales-agent/me")).statusCode).toBe(401);
    expect((await login(app, PHONE, PASSWORD)).res.statusCode).toBe(403);
    const [rep] = await db.select().from(salesReps).where(eq(salesReps.id, agent.id));
    expect(rep!.isActive).toBe(false);
  });
});
