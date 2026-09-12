import { readFile } from "node:fs/promises";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ROLES } from "@bum/shared";
import { closeDb, db } from "../src/db/client.js";
import { roles } from "../src/db/schema/platform.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

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

type Method = "GET" | "POST" | "PATCH";
const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

describe("Sotuv agenti roli va ish joyi", () => {
  it("rol faqat agent ish joyiga ruxsat beradi; profil bog'langan faol agentdan; ERP API'lari 403", async () => {
    // Faqat agent ish joyi va o'z mijozining aloqa/joylashuv/rasm amallari (spetsifikatsiya RBAC) — ERP ruxsati yo'q
    expect(DEFAULT_ROLES.find((role) => role.name === "Sotuv agenti")!.permissions).toEqual([
      "sales_agent.use",
      "sales_agent.customer.edit",
      "sales_agent.customer.location.edit",
      "sales_agent.customer.photo.create",
    ]);
    const owner = company.ownerCookie;
    const agent = await addEmployee(app, company, "Sotuv agenti");

    // Bog'lanmagan — 403
    expect((await call(agent.cookie, "GET", "/api/sales-agent/me")).statusCode).toBe(403);

    const rep = await call(owner, "POST", "/api/distribution/sales-reps", {
      name: "Ali Valiyev",
      userId: agent.id,
      region: "Chilonzor",
      monthlyTarget: "150000000",
    });
    expect(rep.statusCode).toBe(201);
    const me = await call(agent.cookie, "GET", "/api/sales-agent/me");
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      agent: { name: "Ali Valiyev", code: "SR-001", region: "Chilonzor", monthlyTarget: "150000000.00" },
      company: { name: "Distribyutor" },
    });

    // Bitta foydalanuvchi — bitta agent
    expect((await call(owner, "POST", "/api/distribution/sales-reps", { name: "Ikkinchi", userId: agent.id })).statusCode).toBe(409);
    const second = (await call(owner, "POST", "/api/distribution/sales-reps", { name: "Ikkinchi" })).json().salesRep.id;
    expect((await call(owner, "PATCH", `/api/distribution/sales-reps/${second}`, { userId: agent.id })).statusCode).toBe(409);

    // Agent ERP bo'limlariga kira olmaydi
    for (const url of [
      "/api/sales/customers",
      "/api/sales/orders",
      "/api/catalog/products",
      "/api/finance/dashboard",
      "/api/distribution/routes",
      "/api/crm/leads",
      "/api/company/employees",
    ]) {
      expect((await call(agent.cookie, "GET", url)).statusCode, url).toBe(403);
    }

    // Faolsizlantirilgan agent — 403; ruxsati yo'q xodim — 403
    expect((await call(owner, "PATCH", `/api/distribution/sales-reps/${rep.json().salesRep.id}`, { isActive: false })).statusCode).toBe(200);
    expect((await call(agent.cookie, "GET", "/api/sales-agent/me")).statusCode).toBe(403);
    const kassir = await addEmployee(app, company, "Kassir");
    expect((await call(kassir.cookie, "GET", "/api/sales-agent/me")).statusCode).toBe(403);
  });

  it("supervayzer va lokatsiya ruxsatlari: faqat o'qish rollari lokatsiyani ko'rmaydi", async () => {
    const role = (name: string) => DEFAULT_ROLES.find((r) => r.name === name)!.permissions as string[];
    expect(role("Supervayzer")).toEqual(
      expect.arrayContaining(["sales_agent.supervise", "sales_agent.location.view", "sales_agent.location.history", "promotions.manage"]),
    );
    for (const name of ["Ko'ruvchi", "Auditor", "Savdo menejeri"]) {
      expect(role(name).filter((p) => p.startsWith("sales_agent.location.")), name).toEqual([]);
    }
    expect(role("Savdo menejeri")).toEqual(expect.arrayContaining(["sales_agent.supervise", "promotions.manage"]));
  });

  it("0020 migratsiyasi mavjud kompaniyaga agent rollarini qo'shadi va Direktor ruxsatlarini kengaytiradi (takror — o'zgarmaydi)", async () => {
    await db.delete(roles).where(and(eq(roles.companyId, company.companyId), inArray(roles.name, ["Sotuv agenti", "Supervayzer"])));
    await db
      .update(roles)
      .set({ permissions: ["crm.view"] })
      .where(and(eq(roles.companyId, company.companyId), eq(roles.name, "Direktor")));

    // 0020 (rollar) va 0027 (agent qo'shish ruxsati) — ketma-ket, ikki marta
    const migrations = await Promise.all(
      ["0020_sales_agent_roles.sql", "0027_sales_agent_team.sql", "0030_customer_photos.sql"].map((file) =>
        readFile(new URL(`../src/db/migrations/${file}`, import.meta.url), "utf8"),
      ),
    );
    const permissionStatements = (sqlText: string) =>
      sqlText.split("--> statement-breakpoint").filter((statement) => !/ALTER TABLE|CREATE (TABLE|INDEX|TYPE)/i.test(statement));
    const run = async () => {
      for (const migration of migrations) {
        for (const statement of permissionStatements(migration)) await db.execute(sql.raw(statement));
      }
    };
    await run();
    await run();

    const companyRoles = await db.select().from(roles).where(eq(roles.companyId, company.companyId));
    const byName = new Map(companyRoles.map((r) => [r.name, r]));
    // 0030 mavjud rolga mijoz ruxsatlarini qo'shadi — takror ishlaganda ikkilanmaydi
    expect(byName.get("Sotuv agenti")).toMatchObject({ isSystem: true });
    expect([...byName.get("Sotuv agenti")!.permissions].sort()).toEqual(
      [...DEFAULT_ROLES.find((r) => r.name === "Sotuv agenti")!.permissions].sort(),
    );
    expect([...byName.get("Supervayzer")!.permissions].sort()).toEqual(
      [...DEFAULT_ROLES.find((r) => r.name === "Supervayzer")!.permissions].sort(),
    );
    const direktor = byName.get("Direktor")!.permissions;
    expect(direktor[0]).toBe("crm.view");
    expect(direktor.filter((p) => p === "sales_agent.supervise")).toHaveLength(1);
    expect(direktor.filter((p) => p === "sales_agent.agents.manage")).toHaveLength(1);
    expect(direktor).toEqual(
      expect.arrayContaining(["sales_agent.location.history", "promotions.manage", "sales_agent.customer.location.edit"]),
    );
  });
});
