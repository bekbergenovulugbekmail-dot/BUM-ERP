import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { activities, leads, routeVisits } from "../src/db/schema/crm.js";
import { customers } from "../src/db/schema/sales.js";
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
  company = await createCompany(app, admin.cookie, { name: "CRM kompaniyasi" });
  other = await createCompany(app, admin.cookie, { name: "Boshqa kompaniya" });
});

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
const crm = (method: Method, url: string, payload?: object, cookie = company.ownerCookie) =>
  app.inject({ method, url: `/api/crm${url}`, headers: { cookie }, ...(payload ? { payload } : {}) });

async function customer(name: string, owner = company) {
  const res = await app.inject({
    method: "POST",
    url: "/api/sales/customers",
    headers: { cookie: owner.ownerCookie },
    payload: { name },
  });
  return res.json().customer.id as string;
}

describe("Savdo agentlari", () => {
  it("kod, a'zo tekshiruvi, bog'langan agentni o'chirib bo'lmaydi, statistika va ruxsatlar", async () => {
    const first = await crm("POST", "/sales-reps", { name: "Alisher", monthlyTarget: "5000000", commission: "3" });
    expect(first.statusCode).toBe(201);
    expect(first.json().salesRep).toMatchObject({ code: "SR-001", monthlyTarget: "5000000.00", commission: "3.00" });

    const employee = await addEmployee(app, company, "Savdo menejeri");
    const linked = await crm("POST", "/sales-reps", { name: "Bobur", userId: employee.id });
    expect(linked.json().salesRep).toMatchObject({ code: "SR-002", userId: employee.id });
    expect((await crm("POST", "/sales-reps", { name: "Begona", userId: other.owner.id })).statusCode).toBe(400);

    const repId = first.json().salesRep.id;
    await crm("POST", "/leads", { name: "Lid", salesRepId: repId, estimatedValue: "700000" });
    const lead = (await crm("GET", "/leads")).json().leads[0];
    await crm("POST", `/leads/${lead.id}/stage`, { stage: "won" });

    const stats = (await crm("GET", "/sales-reps/stats")).json().salesReps;
    expect(stats.find((r: { id: string }) => r.id === repId)).toMatchObject({
      leadsThisMonth: 1,
      openLeads: 0,
      wonValueThisMonth: "700000.00",
    });

    expect((await crm("DELETE", `/sales-reps/${repId}`)).statusCode).toBe(409);
    expect((await crm("DELETE", `/sales-reps/${linked.json().salesRep.id}`)).statusCode).toBe(204);

    const kassir = await addEmployee(app, company, "Kassir");
    expect((await crm("GET", "/sales-reps", undefined, kassir.cookie)).statusCode).toBe(403);
    expect((await crm("POST", "/sales-reps", { name: "X" }, employee.cookie)).statusCode).toBe(201);
  });
});

describe("Lidlar va faoliyatlar", () => {
  it("bosqichlar: yutilganda mijozga aylantirish, yo'qotish sababi, begona agent/mijoz; faoliyatlar", async () => {
    const foreignRep = (await crm("POST", "/sales-reps", { name: "F" }, other.ownerCookie)).json().salesRep.id;
    expect((await crm("POST", "/leads", { name: "X", salesRepId: foreignRep })).statusCode).toBe(400);

    const created = await crm("POST", "/leads", {
      name: "Jasur",
      companyName: "Jasur Trade MChJ",
      phone: "+998901234567",
      source: "referral",
      estimatedValue: "1500000",
    });
    expect(created.statusCode).toBe(201);
    const leadId = created.json().lead.id;
    expect(created.json().lead).toMatchObject({ stage: "new", source: "referral" });

    const task = await crm("POST", "/activities", { type: "task", title: "Qayta qo'ng'iroq", leadId, activityDate: today, dueDate: today });
    expect(task.json().activity.status).toBe("planned");
    const call = await crm("POST", "/activities", { type: "call", title: "Tanishuv", leadId, activityDate: today });
    expect(call.json().activity.status).toBe("done");
    expect((await crm("PATCH", `/activities/${task.json().activity.id}`, { status: "done", outcome: "Rozi" })).json().activity).toMatchObject({
      status: "done",
      outcome: "Rozi",
    });
    const foreignCustomer = await customer("Begona", other);
    expect((await crm("POST", "/activities", { type: "note", title: "X", customerId: foreignCustomer, activityDate: today })).statusCode).toBe(400);
    expect((await crm("GET", `/activities?leadId=${leadId}`)).json().activities).toHaveLength(2);

    expect((await crm("POST", `/leads/${leadId}/stage`, { stage: "lost" })).statusCode).toBe(400);
    expect((await crm("POST", `/leads/${leadId}/stage`, { stage: "contacted", convertToCustomer: true })).statusCode).toBe(400);
    expect((await crm("POST", `/leads/${leadId}/stage`, { stage: "won", customerId: foreignCustomer })).statusCode).toBe(400);

    const won = await crm("POST", `/leads/${leadId}/stage`, { stage: "won", convertToCustomer: true });
    expect(won.statusCode).toBe(200);
    const [converted] = await db.select().from(customers).where(eq(customers.id, won.json().lead.customerId));
    expect(converted).toMatchObject({ name: "Jasur Trade MChJ", phone: "+998901234567", code: "C-0001" });

    const lostLead = (await crm("POST", "/leads", { name: "Sardor", estimatedValue: "200000" })).json().lead.id;
    expect((await crm("POST", `/leads/${lostLead}/stage`, { stage: "lost", lostReason: "Qimmat" })).json().lead.lostReason).toBe("Qimmat");
    expect((await crm("POST", `/leads/${lostLead}/stage`, { stage: "contacted" })).json().lead.lostReason).toBeNull();

    const stats = (await crm("GET", "/leads/stats")).json();
    expect(stats).toMatchObject({ total: 2, openValue: "200000.00", wonValue: "1500000.00" });

    expect((await crm("DELETE", `/leads/${leadId}`)).statusCode).toBe(204);
    expect(await db.select().from(activities).where(eq(activities.leadId, leadId))).toHaveLength(0);
    expect(await db.select().from(leads).where(eq(leads.companyId, company.companyId))).toHaveLength(1);
  });
});

describe("Marshrutlar va tashriflar", () => {
  it("kunlar, mijozlar tartibi, tashrif holatlari va ko'rsatkichlar, o'chirish qoidalari", async () => {
    const rep = (await crm("POST", "/sales-reps", { name: "Agent" })).json().salesRep.id;
    expect((await crm("POST", "/routes", { name: "X", days: [7] })).statusCode).toBe(400);

    const created = await crm("POST", "/routes", { name: "Chilonzor", salesRepId: rep, days: [5, 1, 3, 1], color: "#22c55e" });
    expect(created.statusCode).toBe(201);
    const routeId = created.json().route.id;
    expect(created.json().route.days).toEqual([1, 3, 5]);

    const a = await customer("A do'kon");
    const b = await customer("B do'kon");
    const memberA = (await crm("POST", `/routes/${routeId}/customers`, { customerId: a })).json().member;
    const memberB = (await crm("POST", `/routes/${routeId}/customers`, { customerId: b })).json().member;
    expect([memberA.sortOrder, memberB.sortOrder]).toEqual([1, 2]);
    expect((await crm("POST", `/routes/${routeId}/customers`, { customerId: a })).statusCode).toBe(409);
    expect((await crm("POST", `/routes/${routeId}/customers`, { customerId: await customer("Begona", other) })).statusCode).toBe(400);

    expect((await crm("PUT", `/routes/${routeId}/customers/order`, { memberIds: [memberB.id] })).statusCode).toBe(400);
    const reordered = await crm("PUT", `/routes/${routeId}/customers/order`, { memberIds: [memberB.id, memberA.id] });
    expect(reordered.json().route.customers.map((c: { customerName: string }) => c.customerName)).toEqual(["B do'kon", "A do'kon"]);
    expect((await crm("GET", "/routes")).json().routes[0]).toMatchObject({ customerCount: 2, salesRepName: "Agent" });

    const visit = await crm("POST", "/visits", { routeId, visitDate: today });
    expect(visit.statusCode).toBe(201);
    const visitId = visit.json().visit.id;
    expect(visit.json().visit).toMatchObject({ salesRepId: rep, status: "planned" });

    expect((await crm("PATCH", `/visits/${visitId}`, { status: "in_progress", customersVisited: 5 })).statusCode).toBe(400);
    const done = await crm("PATCH", `/visits/${visitId}`, { status: "completed", customersVisited: 2, ordersCreated: 1, totalAmount: "350000" });
    expect(done.json().visit).toMatchObject({ status: "completed", customersVisited: 2, totalAmount: "350000.00" });
    expect((await crm("PATCH", `/visits/${visitId}`, { notes: "X" })).statusCode).toBe(400);

    const repStats = (await crm("GET", "/sales-reps/stats")).json().salesReps[0];
    expect(repStats).toMatchObject({ visitsThisMonth: 1, visitSalesThisMonth: "350000.00" });

    expect((await crm("DELETE", `/routes/${routeId}`)).statusCode).toBe(409);
    expect((await crm("PATCH", `/routes/${routeId}`, { isActive: false })).json().route.isActive).toBe(false);
    expect((await crm("POST", "/visits", { routeId, visitDate: today })).statusCode).toBe(400);

    const empty = (await crm("POST", "/routes", { name: "Bo'sh", days: [] })).json().route.id;
    expect((await crm("DELETE", `/routes/${empty}`)).statusCode).toBe(204);
    expect(await db.select().from(routeVisits).where(eq(routeVisits.routeId, routeId))).toHaveLength(1);
    expect((await crm("GET", `/routes/${routeId}`, undefined, other.ownerCookie)).statusCode).toBe(404);
  });
});
