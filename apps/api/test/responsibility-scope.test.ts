/**
 * ROLLARDA "MAS'UL BO'LGANLARI" CHEGARASI (5-vazifa).
 *
 * Rol ruxsatiga chegara qo'yilsa (`roles.scopes`), xodim faqat O'ZIGA biriktirilgan yozuvlarni
 * ko'radi. Eng muhimi: frontendda yashirish yetarli emas — API ham cheklashi kerak, begona
 * yozuvga to'g'ridan-to'g'ri murojaat qilinsa TOPILMADI qaytishi kerak (mavjudligi oshkor bo'lmaydi).
 *
 * Mas'uliyat MAVJUD biriktirishlardan o'qiladi:
 *   agent → sales_reps → distribution_routes → route_customers → customers
 */
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { roles, users } from "../src/db/schema/platform.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn, uniquePhone } from "./helpers.js";

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
  company = await createCompany(app, admin.cookie, { name: "Mas'uliyat kompaniyasi" });
});

const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

/** Xodimning tizim foydalanuvchisi (telefon bo'yicha) — agent profilini unga bog'lash uchun. */
async function userIdOf(phone: string) {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.phone, phone));
  return row!.id;
}

async function customer(name: string) {
  const res = await call(company.ownerCookie, "POST", "/api/sales/customers", { name, phone: uniquePhone() });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().customer as { id: string; name: string };
}

/**
 * Sinov roli: mijozlarni ko'rish ruxsati bor, chegara keyin qo'yiladi.
 * Standart "Sotuv agenti" rolida `sales.view` yo'q, shuning uchun alohida rol kerak.
 */
const AGENT_ROLE = "Marshrut agenti";
async function createAgentRole(scopes?: Record<string, "responsible">) {
  const res = await call(company.ownerCookie, "POST", "/api/company/roles", {
    name: AGENT_ROLE,
    permissions: ["sales.view"],
    ...(scopes ? { scopes } : {}),
  });
  expect(res.statusCode, res.body).toBe(201);
}

/** Agent yaratadi va unga marshrut + mijozlarni biriktiradi. */
async function agentWithCustomers(name: string, customerIds: string[]) {
  const employee = await addEmployee(app, company, AGENT_ROLE);
  // Maxsus rolda agent profili avtomatik yaratilmaydi — foydalanuvchiga bog'lab o'zimiz ochamiz
  const rep = await call(company.ownerCookie, "POST", "/api/distribution/sales-reps", {
    name,
    userId: await userIdOf(employee.phone),
  });
  expect(rep.statusCode, rep.body).toBe(201);
  const repId = rep.json().salesRep.id as string;

  const route = await call(company.ownerCookie, "POST", "/api/distribution/routes", {
    name: `${name} marshruti`,
    salesRepId: repId,
    days: [1, 2, 3, 4, 5],
  });
  expect(route.statusCode, route.body).toBe(201);
  const routeId = route.json().route.id as string;

  const added = await call(company.ownerCookie, "POST", `/api/distribution/routes/${routeId}/customers`, {
    customerIds,
  });
  expect(added.statusCode, added.body).toBe(201);
  return employee;
}

/** Rolga chegara qo'yadi — shu nomdagi rol shu kompaniyaniki. */
async function scopeRole(scopes: Record<string, "responsible">) {
  await db.update(roles).set({ scopes }).where(eq(roles.name, AGENT_ROLE));
}

describe("Mas'ul bo'lganlari chegarasi", () => {
  it("chegara yo'q bo'lsa xodim hamma mijozni ko'radi (eski xatti-harakat)", async () => {
    await createAgentRole();
    const a1 = await customer("A1");
    await customer("B1");
    const agent = await agentWithCustomers("Agent A", [a1.id]);

    const list = await call(agent.cookie, "GET", "/api/sales/customers");
    expect(list.statusCode, list.body).toBe(200);
    const names = (list.json().customers as { name: string }[]).map((row) => row.name);
    expect(names, "chegara qo'yilmagan — hammasi ko'rinadi").toEqual(expect.arrayContaining(["A1", "B1"]));
  });

  it("chegara qo'yilsa agent FAQAT o'z mijozlarini ko'radi", async () => {
    await createAgentRole();
    const a1 = await customer("A1");
    const a2 = await customer("A2");
    const b1 = await customer("B1");
    const agentA = await agentWithCustomers("Agent A", [a1.id, a2.id]);
    await agentWithCustomers("Agent B", [b1.id]);

    await scopeRole({ "sales.view": "responsible" });

    const list = await call(agentA.cookie, "GET", "/api/sales/customers");
    expect(list.statusCode, list.body).toBe(200);
    const names = (list.json().customers as { name: string }[]).map((row) => row.name).sort();
    expect(names).toEqual(["A1", "A2"]);
  });

  it("begona mijozni URL orqali ochib bo'lmaydi — TOPILMADI", async () => {
    await createAgentRole();
    const a1 = await customer("A1");
    const b1 = await customer("B1");
    const agentA = await agentWithCustomers("Agent A", [a1.id]);
    await agentWithCustomers("Agent B", [b1.id]);
    await scopeRole({ "sales.view": "responsible" });

    const own = await call(agentA.cookie, "GET", `/api/sales/customers/${a1.id}`);
    expect(own.statusCode, "o'z mijozi ochiladi").toBe(200);

    const foreign = await call(agentA.cookie, "GET", `/api/sales/customers/${b1.id}`);
    expect(foreign.statusCode, "begona mijoz topilmaydi").toBe(404);
  });

  it("mas'ul mijozi yo'q xodimda ro'yxat bo'sh (hamma narsa ochilib ketmaydi)", async () => {
    await createAgentRole();
    await customer("A1");
    await customer("B1");
    // Agent profili bor, lekin marshrutga mijoz biriktirilmagan
    const employee = await addEmployee(app, company, AGENT_ROLE);
    const rep = await call(company.ownerCookie, "POST", "/api/distribution/sales-reps", {
      name: "Bo'sh agent",
      userId: await userIdOf(employee.phone),
    });
    expect(rep.statusCode, rep.body).toBe(201);
    await scopeRole({ "sales.view": "responsible" });

    const list = await call(employee.cookie, "GET", "/api/sales/customers");
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().customers, "chegara bor, mas'uli yo'q — bo'sh").toEqual([]);
  });

  it("kompaniya egasiga chegara qo'llanmaydi", async () => {
    await createAgentRole();
    const a1 = await customer("A1");
    await customer("B1");
    await agentWithCustomers("Agent A", [a1.id]);
    await scopeRole({ "sales.view": "responsible" });

    const list = await call(company.ownerCookie, "GET", "/api/sales/customers");
    const names = (list.json().customers as { name: string }[]).map((row) => row.name);
    expect(names, "ega hammasini ko'radi").toEqual(expect.arrayContaining(["A1", "B1"]));
  });

  it("noma'lum ruxsatga chegara saqlanmaydi (faqat katalogdagilari)", async () => {
    const created = await call(company.ownerCookie, "POST", "/api/company/roles", {
      name: "Sinov roli",
      permissions: ["sales.view"],
      scopes: { "sales.view": "responsible" },
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().role.scopes).toEqual({ "sales.view": "responsible" });

    // Chegara qo'yib bo'lmaydigan ruxsat — so'rov rad etiladi
    const bad = await call(company.ownerCookie, "POST", "/api/company/roles", {
      name: "Yaroqsiz rol",
      permissions: ["settings.manage"],
      scopes: { "settings.manage": "responsible" },
    });
    expect(bad.statusCode, bad.body).toBe(400);
  });
});
