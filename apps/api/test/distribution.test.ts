import { readFile } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { routeVisits } from "../src/db/schema/crm.js";
import { roles } from "../src/db/schema/platform.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let other: Company;

const today = new Date().toISOString().slice(0, 10);

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
  company = await createCompany(app, admin.cookie, { name: "Distributsiya kompaniyasi" });
  other = await createCompany(app, admin.cookie, { name: "Boshqa kompaniya" });
});

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
const inject = (prefix: string) => (method: Method, url: string, payload?: object, cookie = company.ownerCookie) =>
  app.inject({ method, url: `${prefix}${url}`, headers: { cookie }, ...(payload ? { payload } : {}) });
const dist = inject("/api/distribution");
const crm = inject("/api/crm");

async function customer(name: string, owner = company) {
  const res = await app.inject({
    method: "POST",
    url: "/api/sales/customers",
    headers: { cookie: owner.ownerCookie },
    payload: { name },
  });
  return res.json().customer.id as string;
}

/** Kompaniyada rol yaratib, yangi xodimga beradi. */
async function employeeWithRole(name: string, permissions: string[]) {
  const created = await app.inject({
    method: "POST",
    url: "/api/company/roles",
    headers: { cookie: company.ownerCookie },
    payload: { name, permissions },
  });
  expect(created.statusCode).toBe(201);
  const employee = await addEmployee(app, company);
  const assigned = await app.inject({
    method: "PATCH",
    url: `/api/company/employees/${employee.id}`,
    headers: { cookie: company.ownerCookie },
    payload: { role: name },
  });
  expect(assigned.statusCode).toBe(200);
  return employee;
}

describe("Savdo agentlari", () => {
  it("kod, a'zo tekshiruvi, bog'langan agentni o'chirib bo'lmaydi, statistika va ruxsatlar", async () => {
    const first = await dist("POST", "/sales-reps", { name: "Alisher", monthlyTarget: "5000000", commission: "3" });
    expect(first.statusCode).toBe(201);
    expect(first.json().salesRep).toMatchObject({ code: "SR-001", monthlyTarget: "5000000.00", commission: "3.00" });

    const employee = await addEmployee(app, company, "Savdo menejeri");
    const linked = await dist("POST", "/sales-reps", { name: "Bobur", userId: employee.id });
    expect(linked.json().salesRep).toMatchObject({ code: "SR-002", userId: employee.id });
    expect((await dist("POST", "/sales-reps", { name: "Begona", userId: other.owner.id })).statusCode).toBe(400);

    const repId = first.json().salesRep.id;
    await crm("POST", "/leads", { name: "Lid", salesRepId: repId, estimatedValue: "700000" });
    const lead = (await crm("GET", "/leads")).json().leads[0];
    await crm("POST", `/leads/${lead.id}/stage`, { stage: "won" });

    const stats = (await dist("GET", "/sales-reps/stats")).json().salesReps;
    expect(stats.find((r: { id: string }) => r.id === repId)).toMatchObject({
      leadsThisMonth: 1,
      openLeads: 0,
      wonValueThisMonth: "700000.00",
    });

    expect((await dist("DELETE", `/sales-reps/${repId}`)).statusCode).toBe(409);
    expect((await dist("DELETE", `/sales-reps/${linked.json().salesRep.id}`)).statusCode).toBe(204);

    const kassir = await addEmployee(app, company, "Kassir");
    expect((await dist("GET", "/sales-reps", undefined, kassir.cookie)).statusCode).toBe(403);
    expect((await dist("POST", "/sales-reps", { name: "X" }, employee.cookie)).statusCode).toBe(201);
  });
});

describe("Marshrutlar va tashriflar", () => {
  it("ro'yxatdan ko'p mijozni birdan qo'shish: marshrutdagilari o'tkazib yuboriladi", async () => {
    const routeRes = await dist("POST", "/routes", { name: "Ko'p tanlov", days: [1] });
    expect(routeRes.statusCode, routeRes.body).toBe(201);
    const routeId = routeRes.json().route.id as string;
    const [a, b, c] = [await customer("Ko'p A"), await customer("Ko'p B"), await customer("Ko'p C")];

    const first = await dist("POST", `/routes/${routeId}/customers`, { customerIds: [a, b] });
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json()).toMatchObject({ added: 2, skipped: 0 });
    expect(first.json().members.map((m: { sortOrder: number }) => m.sortOrder)).toEqual([1, 2]);

    // Takroriy tanlov xato bermaydi — bori o'tkazib yuboriladi, yangisi tartib oxiriga tushadi
    const second = await dist("POST", `/routes/${routeId}/customers`, { customerIds: [a, b, c, c] });
    expect(second.statusCode, second.body).toBe(201);
    expect(second.json()).toMatchObject({ added: 1, skipped: 2 });

    const route = (await dist("GET", `/routes/${routeId}`)).json().route;
    expect(route.customers.map((m: { customerName: string }) => m.customerName)).toEqual(["Ko'p A", "Ko'p B", "Ko'p C"]);

    // Begona kompaniya mijozi — 400; ikkala maydon birga — 400
    expect((await dist("POST", `/routes/${routeId}/customers`, { customerIds: [await customer("Begona ko'p", other)] })).statusCode).toBe(400);
    expect((await dist("POST", `/routes/${routeId}/customers`, { customerId: a, customerIds: [a] })).statusCode).toBe(400);
    expect((await dist("POST", `/routes/${routeId}/customers`, {})).statusCode).toBe(400);
  });

  it("kunlar, mijozlar tartibi, tashrif holatlari va ko'rsatkichlar, o'chirish qoidalari", async () => {
    const rep = (await dist("POST", "/sales-reps", { name: "Agent" })).json().salesRep.id;
    expect((await dist("POST", "/routes", { name: "X", days: [7] })).statusCode).toBe(400);

    const created = await dist("POST", "/routes", { name: "Chilonzor", salesRepId: rep, days: [5, 1, 3, 1], color: "#22c55e" });
    expect(created.statusCode).toBe(201);
    const routeId = created.json().route.id;
    expect(created.json().route.days).toEqual([1, 3, 5]);

    const a = await customer("A do'kon");
    const b = await customer("B do'kon");
    const memberA = (await dist("POST", `/routes/${routeId}/customers`, { customerId: a })).json().member;
    const memberB = (await dist("POST", `/routes/${routeId}/customers`, { customerId: b })).json().member;
    expect([memberA.sortOrder, memberB.sortOrder]).toEqual([1, 2]);
    expect((await dist("POST", `/routes/${routeId}/customers`, { customerId: a })).statusCode).toBe(409);
    expect((await dist("POST", `/routes/${routeId}/customers`, { customerId: await customer("Begona", other) })).statusCode).toBe(400);

    expect((await dist("PUT", `/routes/${routeId}/customers/order`, { memberIds: [memberB.id] })).statusCode).toBe(400);
    const reordered = await dist("PUT", `/routes/${routeId}/customers/order`, { memberIds: [memberB.id, memberA.id] });
    expect(reordered.json().route.customers.map((c: { customerName: string }) => c.customerName)).toEqual(["B do'kon", "A do'kon"]);
    expect((await dist("GET", "/routes")).json().routes[0]).toMatchObject({ customerCount: 2, salesRepName: "Agent" });

    const visit = await dist("POST", "/visits", { routeId, visitDate: today });
    expect(visit.statusCode).toBe(201);
    const visitId = visit.json().visit.id;
    expect(visit.json().visit).toMatchObject({ salesRepId: rep, status: "planned" });

    expect((await dist("PATCH", `/visits/${visitId}`, { status: "in_progress", customersVisited: 5 })).statusCode).toBe(400);
    const done = await dist("PATCH", `/visits/${visitId}`, { status: "completed", customersVisited: 2, ordersCreated: 1, totalAmount: "350000" });
    expect(done.json().visit).toMatchObject({ status: "completed", customersVisited: 2, totalAmount: "350000.00" });
    expect((await dist("PATCH", `/visits/${visitId}`, { notes: "X" })).statusCode).toBe(400);

    const repStats = (await dist("GET", "/sales-reps/stats")).json().salesReps[0];
    expect(repStats).toMatchObject({ visitsThisMonth: 1, visitSalesThisMonth: "350000.00" });

    expect((await dist("DELETE", `/routes/${routeId}`)).statusCode).toBe(409);
    expect((await dist("PATCH", `/routes/${routeId}`, { isActive: false })).json().route.isActive).toBe(false);
    expect((await dist("POST", "/visits", { routeId, visitDate: today })).statusCode).toBe(400);

    const empty = (await dist("POST", "/routes", { name: "Bo'sh", days: [] })).json().route.id;
    expect((await dist("DELETE", `/routes/${empty}`)).statusCode).toBe(204);
    expect(await db.select().from(routeVisits).where(eq(routeVisits.routeId, routeId))).toHaveLength(1);
    expect((await dist("GET", `/routes/${routeId}`, undefined, other.ownerCookie)).statusCode).toBe(404);
  });
});

describe("CRM va distributsiya ruxsatlari alohida", () => {
  it("crm.* — lid va faoliyatlar, distribution.* — agentlar, marshrutlar va tashriflar", async () => {
    const crmUser = await employeeWithRole("CRM xodimi", ["crm.view", "crm.manage"]);
    const distUser = await employeeWithRole("Distributor", ["distribution.view", "distribution.manage"]);

    const rep = await dist("POST", "/sales-reps", { name: "Agent", monthlyTarget: "1000000", commission: "2" }, distUser.cookie);
    expect(rep.statusCode).toBe(201);
    const repId = rep.json().salesRep.id;

    // CRM xodimi lidga agent tanlaydi, lekin maqsad va komissiyani ko'rmaydi, distributsiyaga kirmaydi
    expect((await crm("GET", "/sales-reps", undefined, crmUser.cookie)).json().salesReps).toEqual([
      { id: repId, name: "Agent", code: "SR-001" },
    ]);
    expect((await crm("POST", "/leads", { name: "Lid", salesRepId: repId }, crmUser.cookie)).statusCode).toBe(201);
    for (const url of ["/sales-reps", "/sales-reps/stats", "/routes", "/visits"]) {
      expect((await dist("GET", url, undefined, crmUser.cookie)).statusCode).toBe(403);
    }
    expect((await dist("POST", "/routes", { name: "X", days: [] }, crmUser.cookie)).statusCode).toBe(403);

    // Distributor lid va faoliyatlarga kirmaydi
    for (const url of ["/leads", "/leads/stats", "/activities", "/sales-reps"]) {
      expect((await crm("GET", url, undefined, distUser.cookie)).statusCode).toBe(403);
    }
    expect((await dist("POST", "/routes", { name: "Y", days: [1] }, distUser.cookie)).statusCode).toBe(201);

    // Marshrut va tashriflar endi faqat /api/distribution da
    expect((await crm("GET", "/routes")).statusCode).toBe(404);
    expect((await crm("POST", "/sales-reps", { name: "Z" })).statusCode).toBe(404);
  });

  it("0018 migratsiyasi crm.* bor rollarga distribution.* qo'shadi, takror ishlasa o'zgarmaydi", async () => {
    const insert = async (name: string, permissions: string[]) =>
      (await db.insert(roles).values({ companyId: company.companyId, name, permissions }).returning({ id: roles.id }))[0]!.id;
    const manager = await insert("Eski menejer", ["crm.view", "crm.manage", "sales.view"]);
    const viewer = await insert("Eski ko'ruvchi", ["crm.view"]);
    const cashier = await insert("Eski kassir", ["pos.use"]);

    const migration = await readFile(new URL("../src/db/migrations/0018_distribution_permissions.sql", import.meta.url), "utf8");
    const run = async () => {
      for (const statement of migration.split("--> statement-breakpoint")) await db.execute(sql.raw(statement));
    };
    await run();
    await run();

    const permissionsOf = async (id: string) =>
      (await db.select({ permissions: roles.permissions }).from(roles).where(eq(roles.id, id)))[0]!.permissions;
    expect(await permissionsOf(manager)).toEqual(["crm.view", "crm.manage", "sales.view", "distribution.view", "distribution.manage"]);
    expect(await permissionsOf(viewer)).toEqual(["crm.view", "distribution.view"]);
    expect(await permissionsOf(cashier)).toEqual(["pos.use"]);
  });
});
