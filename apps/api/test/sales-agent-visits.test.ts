import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SALES_AGENT_POLICY } from "@bum/shared";
import { closeDb, db } from "../src/db/client.js";
import { auditLogs } from "../src/db/schema/platform.js";
import { agentLocationEvents } from "../src/db/schema/sales-agent.js";
import { todayIso } from "../src/modules/finance/cash.service.js";
import { buildServer } from "../src/server.js";
import { storageProvider, type StorageClient, type StoredObject } from "../src/shared/storage.js";
import { LEGACY_VISIT_POLICY, setAgentPolicy } from "./agent-policy.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PUT";

let app: FastifyInstance;
let adminCookie: string;
let company: Company;
let objects: Map<string, StoredObject>;
const originalClient = storageProvider.client;

const fakeStorage: StorageClient = {
  signedUrl: (method, key, expires) => `http://storage.test/bum-erp/${key}?method=${method}&expires=${expires}`,
  head: async (key) => objects.get(key) ?? null,
  remove: async (key) => {
    objects.delete(key);
  },
};

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  storageProvider.client = originalClient;
  await app.close();
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
  adminCookie = (await signedIn(app, { isPlatformAdmin: true })).cookie;
  company = await createCompany(app, adminCookie, { name: "Distribyutor" });
  // Boshlash/yakunlash va S3 rasm qoidalari; vitrina, minimal vaqt, hududdan chiqish — sales-agent-visit-flow
  await setAgentPolicy(company.companyId, LEGACY_VISIT_POLICY);
  objects = new Map();
  storageProvider.client = fakeStorage;
});

const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

async function agent(name: string) {
  const employee = await addEmployee(app, company, "Sotuv agenti");
  const rep = await call(company.ownerCookie, "POST", "/api/distribution/sales-reps", { name, userId: employee.id });
  expect(rep.statusCode).toBe(201);
  expect(
    (await call(employee.cookie, "POST", "/api/sales-agent/work-session/start", { latitude: 41.3115, longitude: 69.2406, accuracy: 10, recordedAt: new Date().toISOString() }))
      .statusCode,
  ).toBe(201);
  return { cookie: employee.cookie, repId: rep.json().salesRep.id as string };
}

async function store(body: object) {
  const res = await call(company.ownerCookie, "POST", "/api/sales/customers", body);
  expect(res.statusCode).toBe(201);
  return res.json().customer.id as string;
}

/** Har kuni ishlaydigan marshrut — bugungi marshrutga tushadi. */
async function route(salesRepId: string, customerIds: string[]) {
  const res = await call(company.ownerCookie, "POST", "/api/distribution/routes", { name: "Chilonzor", salesRepId, days: [0, 1, 2, 3, 4, 5, 6] });
  expect(res.statusCode).toBe(201);
  const id = res.json().route.id as string;
  for (const customerId of customerIds) {
    expect((await call(company.ownerCookie, "POST", `/api/distribution/routes/${id}/customers`, { customerId })).statusCode).toBe(201);
  }
}

const iso = () => new Date().toISOString();
const shop = { latitude: 41.311081, longitude: 69.240562 };
/** Do'kondan ~50 m. */
const near = { latitude: 41.3115, longitude: 69.2406 };
const actionCount = (action: string) => db.$count(auditLogs, eq(auditLogs.action, action));

describe("Tashriflar", () => {
  it("boshlash: hudud, geofence va joy sifati; bitta ochiq tashrif; yakunlash sabab bilan; bugungi holat", async () => {
    const ali = await agent("Ali");
    const vali = await agent("Vali");
    const baraka = await store({ name: "Baraka", ...shop });
    const mega = await store({ name: "Mega" });
    const begona = await store({ name: "Begona" });
    await route(ali.repId, [baraka, mega]);

    const start = (cookie: string, customerId: string, point = near, accuracy = 15) =>
      call(cookie, "POST", "/api/sales-agent/visits/start", { customerId, ...point, accuracy, recordedAt: iso() });

    expect((await start(ali.cookie, begona)).statusCode).toBe(404);

    const far = await start(ali.cookie, baraka, { latitude: 41.36, longitude: 69.24 });
    expect(far.statusCode).toBe(403);
    expect(far.json().details).toMatchObject({ reason: "geofence", radiusMeters: 200 });
    expect(far.json().details.distanceMeters).toBeGreaterThan(5000);
    // Rad etilgan urinish saqlanadi (tranzaksiya bekor qilinmaydi)
    expect(await db.$count(agentLocationEvents, eq(agentLocationEvents.type, "geofence_block"))).toBe(1);
    expect(await actionCount("GEOFENCE_BLOCK")).toBe(1);

    const blurry = await start(ali.cookie, baraka, near, 500);
    expect(blurry.statusCode).toBe(400);
    expect(blurry.json().details).toEqual({ reason: "low_accuracy" });

    const started = await start(ali.cookie, baraka);
    expect(started.statusCode).toBe(201);
    const visit = started.json().visit;
    expect(visit).toMatchObject({ customerName: "Baraka", salesRepName: "Ali", status: "in_progress", result: null, photos: [] });
    expect(visit.startDistanceMeters).toBeGreaterThan(30);
    expect(visit.startDistanceMeters).toBeLessThan(80);

    expect((await start(ali.cookie, mega)).statusCode).toBe(409);
    expect((await call(ali.cookie, "GET", "/api/sales-agent/visits/current")).json().visit.id).toBe(visit.id);
    expect((await call(vali.cookie, "GET", "/api/sales-agent/visits/current")).json().visit).toBeNull();

    const plan = (await call(ali.cookie, "GET", "/api/sales-agent/today")).json();
    expect(plan.stores.map((s: { name: string; visitStatus: string }) => [s.name, s.visitStatus])).toEqual([
      ["Baraka", "in_progress"],
      ["Mega", "waiting"],
    ]);

    const complete = (cookie: string, body: object) =>
      call(cookie, "POST", `/api/sales-agent/visits/${visit.id}/complete`, { ...near, accuracy: 20, recordedAt: iso(), ...body });
    expect((await complete(ali.cookie, {})).json().details).toEqual({ reason: "no_order_reason_required" });
    expect((await complete(ali.cookie, { noOrderReason: "other", noOrderComment: " " })).json().details).toEqual({ reason: "comment_required" });
    expect((await complete(vali.cookie, { noOrderReason: "price" })).statusCode).toBe(404);

    const done = await complete(ali.cookie, { noOrderReason: "has_stock", notes: "Keyingi hafta" });
    expect(done.statusCode).toBe(200);
    expect(done.json().visit).toMatchObject({ status: "completed", result: "no_order", noOrderReason: "has_stock", notes: "Keyingi hafta" });
    expect(done.json().visit.durationSeconds).toBeGreaterThanOrEqual(0);
    expect(done.json().visit.endDistanceMeters).toBeLessThan(80);
    expect((await complete(ali.cookie, { noOrderReason: "price" })).statusCode).toBe(409);

    expect((await call(ali.cookie, "GET", "/api/sales-agent/today")).json().stores[0].visitStatus).toBe("visited_no_order");
    expect((await call(ali.cookie, "GET", `/api/sales-agent/stores/${baraka}`)).json().store.todayVisit).toMatchObject({
      id: visit.id,
      noOrderReason: "has_stock",
    });
    for (const action of ["VISIT_START", "VISIT_END", "NO_ORDER"]) expect(await actionCount(action)).toBe(1);

    // Koordinatasiz do'kon — geofence yo'q, masofa noma'lum
    const second = await start(ali.cookie, mega);
    expect(second.statusCode).toBe(201);
    expect(second.json().visit.startDistanceMeters).toBeNull();
    expect((await call(ali.cookie, "GET", "/api/sales-agent/visits")).json().visits).toHaveLength(2);

    const kassir = await addEmployee(app, company, "Kassir");
    expect((await start(kassir.cookie, baraka)).statusCode).toBe(403);
  });

  it("rasmlar: saqlash, kalit va fayl tekshiruvi, siyosat bo'yicha majburiy; supervayzer ro'yxati va sabablar", async () => {
    const ali = await agent("Ali");
    const vali = await agent("Vali");
    const baraka = await store({ name: "Baraka", ...shop });
    await route(ali.repId, [baraka]);
    const supervisor = await addEmployee(app, company, "Supervayzer");
    expect((await call(supervisor.cookie, "PUT", "/api/sales-agent/policy", { ...DEFAULT_SALES_AGENT_POLICY, ...LEGACY_VISIT_POLICY, shelfPhotoRequired: true })).statusCode).toBe(200);

    const visit = (
      await call(ali.cookie, "POST", "/api/sales-agent/visits/start", { customerId: baraka, ...near, accuracy: 10, recordedAt: iso() })
    ).json().visit;
    const finish = () =>
      call(ali.cookie, "POST", `/api/sales-agent/visits/${visit.id}/complete`, { ...near, accuracy: 10, recordedAt: iso(), noOrderReason: "price" });
    expect((await finish()).json().details).toEqual({ reason: "shelf_photo_required" });

    const uploads = `/api/sales-agent/visits/${visit.id}/photos/uploads`;
    expect((await call(ali.cookie, "POST", uploads, { contentType: "application/pdf", size: 100 })).statusCode).toBe(400);
    expect((await call(ali.cookie, "POST", uploads, { contentType: "image/jpeg", size: 9 * 1024 * 1024 })).statusCode).toBe(400);
    expect((await call(vali.cookie, "POST", uploads, { contentType: "image/jpeg", size: 100 })).statusCode).toBe(404);
    storageProvider.client = null;
    expect((await call(ali.cookie, "POST", uploads, { contentType: "image/jpeg", size: 100 })).statusCode).toBe(503);
    storageProvider.client = fakeStorage;

    const upload = await call(ali.cookie, "POST", uploads, { contentType: "image/jpeg", size: 2048 });
    expect(upload.statusCode).toBe(201);
    const key = upload.json().key as string;
    expect(key.startsWith(`companies/${company.companyId}/visit-photo/`)).toBe(true);

    const attach = (body: object) => call(ali.cookie, "POST", `/api/sales-agent/visits/${visit.id}/photos`, { kind: "shelf", ...near, accuracy: 10, ...body });
    expect((await attach({ key })).statusCode).toBe(400); // hali yuklanmagan
    objects.set(key, { size: 2048, contentType: "image/jpeg" });
    expect((await attach({ key: `companies/${randomUUID()}/visit-photo/${randomUUID()}.jpg` })).statusCode).toBe(400);
    const attached = await attach({ key });
    expect(attached.statusCode).toBe(201);
    const photoId = attached.json().photo.id as string;
    expect((await attach({ key })).statusCode).toBe(409);
    expect(await actionCount("SHELF_PHOTO")).toBe(1);

    expect((await finish()).statusCode).toBe(200);
    expect((await attach({ key })).statusCode).toBe(409); // yakunlangan tashrif

    const photoUrl = `/api/sales-agent/visits/${visit.id}/photos/${photoId}/url`;
    const url = await call(ali.cookie, "GET", photoUrl);
    expect(url.statusCode).toBe(200);
    expect(url.json().url).toContain(key);
    expect((await call(vali.cookie, "GET", photoUrl)).statusCode).toBe(404);

    const list = await call(supervisor.cookie, "GET", `/api/sales-agent/supervisor/visits?date=${todayIso()}`);
    expect(list.statusCode).toBe(200);
    expect(list.json().summary).toEqual({ total: 1, inProgress: 0, ordered: 0, noOrder: 1, reasons: { price: 1 } });
    expect(list.json().visits).toEqual([
      expect.objectContaining({
        salesRepName: "Ali",
        customerName: "Baraka",
        result: "no_order",
        photos: [expect.objectContaining({ id: photoId, kind: "shelf" })],
      }),
    ]);
    expect((await call(supervisor.cookie, "GET", `/api/sales-agent/supervisor/visits/${visit.id}/photos/${photoId}/url`)).statusCode).toBe(200);

    const manager = await addEmployee(app, company, "Savdo menejeri");
    expect((await call(manager.cookie, "GET", "/api/sales-agent/supervisor/visits")).statusCode).toBe(200);
    const viewer = await addEmployee(app, company, "Ko'ruvchi");
    for (const cookie of [viewer.cookie, ali.cookie]) {
      expect((await call(cookie, "GET", "/api/sales-agent/supervisor/visits")).statusCode).toBe(403);
    }

    const foreign = await createCompany(app, adminCookie, { name: "Boshqa" });
    const foreignSupervisor = await addEmployee(app, foreign, "Supervayzer");
    expect((await call(foreignSupervisor.cookie, "GET", `/api/sales-agent/supervisor/visits/${visit.id}/photos/${photoId}/url`)).statusCode).toBe(404);
    expect((await call(foreignSupervisor.cookie, "GET", "/api/sales-agent/supervisor/visits")).json().summary.total).toBe(0);
  });
});
