import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { activities, leads } from "../src/db/schema/crm.js";
import { customers } from "../src/db/schema/sales.js";
import { buildServer } from "../src/server.js";
import { createCompany, resetDatabase, signedIn } from "./helpers.js";

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

describe("Lidlar va faoliyatlar", () => {
  it("bosqichlar: yutilganda mijozga aylantirish, yo'qotish sababi, begona agent/mijoz; faoliyatlar", async () => {
    const foreignRep = (
      await app.inject({
        method: "POST",
        url: "/api/distribution/sales-reps",
        headers: { cookie: other.ownerCookie },
        payload: { name: "F" },
      })
    ).json().salesRep.id;
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
