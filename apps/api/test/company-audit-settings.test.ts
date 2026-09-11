import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { auditLogs, settings } from "../src/db/schema/platform.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let companyA: Company;
let companyB: Company;

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
  companyA = await createCompany(app, admin.cookie, { name: "A kompaniya" });
  companyB = await createCompany(app, admin.cookie, { name: "B kompaniya" });
});

const api = (cookie: string, method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: object) =>
  app.inject({ method, url: `/api/company${url}`, headers: { cookie }, ...(payload ? { payload } : {}) });

describe("Kompaniya audit jurnali", () => {
  it("faqat o'z kompaniyasi yozuvlari; audit.view yo'q bo'lsa 403", async () => {
    await api(companyB.ownerCookie, "POST", "/branches", { name: "B filial", code: "BR-B" });

    const res = await api(companyA.ownerCookie, "GET", "/audit-logs");
    expect(res.statusCode).toBe(200);
    const logs = res.json().logs as { companyId: string; companyName: string }[];
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((l) => l.companyId === companyA.companyId && l.companyName === "A kompaniya")).toBe(true);

    const kassir = await addEmployee(app, companyA, "Kassir");
    const buxgalter = await addEmployee(app, companyA, "Buxgalter");
    expect((await api(kassir.cookie, "GET", "/audit-logs")).statusCode).toBe(403);
    expect((await api(buxgalter.cookie, "GET", "/audit-logs")).statusCode).toBe(200);
  });

  it("resource bo'yicha filtr va kursor bilan sahifalash", async () => {
    for (const code of ["BR-2", "BR-3", "BR-4"]) {
      await api(companyA.ownerCookie, "POST", "/branches", { name: code, code });
    }

    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `/audit-logs?resource=branches&limit=2${cursor ? `&cursor=${cursor}` : ""}`;
      const page = (await api(companyA.ownerCookie, "GET", url)).json() as {
        logs: { id: string; resource: string }[];
        nextCursor: string | null;
      };
      expect(page.logs.every((l) => l.resource === "branches")).toBe(true);
      ids.push(...page.logs.map((l) => l.id));
      cursor = page.nextCursor;
    } while (cursor);

    expect(new Set(ids).size).toBe(3);
  });
});

describe("Kompaniya sozlamalari", () => {
  it("saqlaydi, takroriy saqlash yangilaydi, kompaniyalar ajratilgan, audit qiymatsiz", async () => {
    const first = await api(companyA.ownerCookie, "PUT", "/settings/receipt.footer", { value: "Rahmat!", group: "pos" });
    expect(first.statusCode).toBe(200);
    expect(first.json().setting).toMatchObject({ key: "receipt.footer", value: "Rahmat!", group: "pos" });

    await api(companyA.ownerCookie, "PUT", "/settings/receipt.footer", { value: "Yana keling", group: "pos" });
    const rows = await db
      .select()
      .from(settings)
      .where(and(eq(settings.companyId, companyA.companyId), eq(settings.key, "receipt.footer")));
    expect(rows).toHaveLength(1);

    const list = (await api(companyA.ownerCookie, "GET", "/settings?group=pos")).json().settings;
    expect(list).toEqual([expect.objectContaining({ key: "receipt.footer", value: "Yana keling" })]);
    expect((await api(companyB.ownerCookie, "GET", "/settings")).json().settings).toEqual([]);

    const audits = await db.select().from(auditLogs).where(eq(auditLogs.action, "SETTING_UPDATED"));
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toContain("Yana keling");
  });

  it("settings.view / settings.manage: Kassir o'qiy olmaydi, Ko'ruvchi o'qiydi lekin yoza olmaydi", async () => {
    const kassir = await addEmployee(app, companyA, "Kassir");
    const koruvchi = await addEmployee(app, companyA, "Ko'ruvchi");
    expect((await api(kassir.cookie, "GET", "/settings")).statusCode).toBe(403);
    expect((await api(koruvchi.cookie, "GET", "/settings")).statusCode).toBe(200);
    expect((await api(koruvchi.cookie, "PUT", "/settings/theme", { value: "dark", group: "ui" })).statusCode).toBe(403);
  });

  it("modules guruhi alohida modules.manage talab qiladi", async () => {
    await api(companyA.ownerCookie, "POST", "/roles", { name: "Sozlovchi", permissions: ["settings.view", "settings.manage"] });
    const xodim = await addEmployee(app, companyA);
    await api(companyA.ownerCookie, "PATCH", `/employees/${xodim.id}`, { role: "Sozlovchi" });

    expect((await api(xodim.cookie, "PUT", "/settings/crm", { value: "false", group: "modules" })).statusCode).toBe(403);
    expect((await api(xodim.cookie, "PUT", "/settings/theme", { value: "dark", group: "ui" })).statusCode).toBe(200);
    expect((await api(companyA.ownerCookie, "PUT", "/settings/crm", { value: "false", group: "modules" })).statusCode).toBe(200);
  });

  it("noto'g'ri kalit va guruhsiz so'rovni rad etadi", async () => {
    expect((await api(companyA.ownerCookie, "PUT", "/settings/yomon%20kalit", { value: "x", group: "ui" })).statusCode).toBe(400);
    expect((await api(companyA.ownerCookie, "PUT", "/settings/theme", { value: "x" })).statusCode).toBe(400);
  });
});
