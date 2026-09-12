import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SALES_AGENT_POLICY } from "@bum/shared";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { auditLogs } from "../src/db/schema/platform.js";
import { agentLocationEvents, agentVisitPhotos, agentVisits } from "../src/db/schema/sales-agent.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { storageProvider } from "../src/shared/storage.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PUT";

let app: FastifyInstance;
let company: Company;
let productId: string;
const originalClient = storageProvider.client;

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
  // Fayl saqlash (S3) yo'q — rasmlar bazaga
  storageProvider.client = null;
  await db.delete(units);
  await seedDefaultUnits(db);
  const piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Distribyutor" });
  const mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  productId = (
    await call(company.ownerCookie, "POST", "/api/catalog/products", { name: "Coca Cola 1L", sku: "COLA", baseUnitId: piece, salesPrice: "10000", taxRate: "0" })
  ).json().product.id;
  await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", { type: "receive", productId, warehouseId: mainWh, quantity: "100", costPrice: "1000" });
});

const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

const iso = () => new Date().toISOString();
const shop = { latitude: 41.311081, longitude: 69.240562 };
/** Do'kondan ~50 m. */
const near = { latitude: 41.3115, longitude: 69.2406 };
/** Do'kondan ~550 m — hududdan tashqarida, lekin "sakrash" emas. */
const outside = { latitude: 41.316, longitude: 69.240562 };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(512, 7)]);
const actionCount = (action: string) => db.$count(auditLogs, eq(auditLogs.action, action));
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

async function agent(name: string) {
  const employee = await addEmployee(app, company, "Sotuv agenti");
  const rep = await call(company.ownerCookie, "POST", "/api/distribution/sales-reps", { name, userId: employee.id });
  const repId = rep.json().salesRep.id as string;
  expect((await call(employee.cookie, "POST", "/api/sales-agent/work-session/start", { ...near, accuracy: 10, recordedAt: iso() })).statusCode).toBe(201);
  return { cookie: employee.cookie, repId };
}

async function storeOnRoute(salesRepId: string) {
  const customerId = (await call(company.ownerCookie, "POST", "/api/sales/customers", { name: "Baraka", ...shop })).json().customer.id as string;
  const routeId = (
    await call(company.ownerCookie, "POST", "/api/distribution/routes", { name: "Chilonzor", salesRepId, days: [0, 1, 2, 3, 4, 5, 6] })
  ).json().route.id as string;
  await call(company.ownerCookie, "POST", `/api/distribution/routes/${routeId}/customers`, { customerId });
  return customerId;
}

function visitActions(cookie: string, customerId: string) {
  return {
    start: () => call(cookie, "POST", "/api/sales-agent/visits/start", { customerId, ...near, accuracy: 10, recordedAt: iso() }),
    photo: (visitId: string, kind: string, point: object = near, data: Buffer = JPEG) =>
      call(cookie, "POST", `/api/sales-agent/visits/${visitId}/photos/direct`, {
        kind,
        contentType: "image/jpeg",
        data: data.toString("base64"),
        ...point,
        accuracy: 10,
        recordedAt: iso(),
      }),
    locate: (point: object) => call(cookie, "POST", "/api/sales-agent/location", { ...point, accuracy: 10, recordedAt: iso() }),
    draft: async () =>
      (await call(cookie, "PUT", `/api/sales-agent/orders/drafts/${randomUUID()}`, { customerId, items: [{ productId, pieces: "2" }] })).json().order
        .id as string,
    submit: (orderId: string) => call(cookie, "POST", `/api/sales-agent/orders/${orderId}/submit`, { ...near, accuracy: 10, recordedAt: iso() }),
    complete: (visitId: string, body: object) =>
      call(cookie, "POST", `/api/sales-agent/visits/${visitId}/complete`, { ...near, accuracy: 10, recordedAt: iso(), ...body }),
    current: async () => (await call(cookie, "GET", "/api/sales-agent/visits/current")).json().visit,
  };
}

describe("Tashrif oqimi (standart siyosat)", () => {
  it("vitrina rasmi taymerni boshlaydi, polka, minimal 10 daqiqa; buyurtma tashrifni yakunlaydi; bazadagi rasm", async () => {
    const ali = await agent("Ali");
    const vali = await agent("Vali");
    const baraka = await storeOnRoute(ali.repId);
    const act = visitActions(ali.cookie, baraka);

    const orderId = await act.draft();
    expect((await act.submit(orderId)).json().details).toEqual({ reason: "visit_required" });

    const visit = (await act.start()).json().visit;
    expect(visit).toMatchObject({ timerStartedAt: null, pausedSeconds: 0, outsideCount: 0, invalidatedAt: null });

    expect((await act.photo(visit.id, "shelf")).json().details).toEqual({ reason: "storefront_photo_required" });
    const farPhoto = await act.photo(visit.id, "storefront", { latitude: 41.36, longitude: 69.24 });
    expect(farPhoto.statusCode).toBe(403);
    expect(farPhoto.json().details).toMatchObject({ reason: "geofence" });
    expect((await act.photo(visit.id, "storefront", near, Buffer.from("%PDF-1.4 hujjat"))).json().details).toEqual({ reason: "photo_invalid" });
    // Mijoz "hududdaman" deb yubora olmaydi
    expect(
      (await call(ali.cookie, "POST", `/api/sales-agent/visits/${visit.id}/photos/direct`, {
        kind: "storefront",
        contentType: "image/jpeg",
        data: JPEG.toString("base64"),
        ...near,
        accuracy: 10,
        insideGeofence: true,
      })).statusCode,
    ).toBe(400);

    const storefront = await act.photo(visit.id, "storefront");
    expect(storefront.statusCode).toBe(201);
    expect((await act.current()).timerStartedAt).not.toBeNull();
    expect((await act.submit(orderId)).json().details).toEqual({ reason: "shelf_photo_required" });

    expect((await act.photo(visit.id, "shelf")).statusCode).toBe(201);
    const tooShort = (await act.submit(orderId)).json().details;
    expect(tooShort).toMatchObject({ reason: "visit_too_short", minVisitMinutes: 10 });
    expect(tooShort.remainingSeconds).toBeGreaterThan(590);
    expect((await act.complete(visit.id, { noOrderReason: "has_stock" })).json().details).toMatchObject({ reason: "visit_too_short" });
    expect((await call(vali.cookie, "GET", `/api/sales-agent/orders/${orderId}`)).statusCode).toBe(404);

    // 11 daqiqa o'tdi
    await db.update(agentVisits).set({ timerStartedAt: minutesAgo(11) }).where(eq(agentVisits.id, visit.id));
    const sent = await act.submit(orderId);
    expect(sent.statusCode).toBe(200);
    expect(sent.json().order.status).toBe("confirmed");
    expect(await act.current()).toBeNull();
    const [closed] = await db.select().from(agentVisits).where(eq(agentVisits.id, visit.id));
    expect(closed).toMatchObject({ status: "completed", result: "ordered" });
    expect(closed!.durationSeconds).toBeGreaterThanOrEqual(660);
    // Takroriy yuborish natijani o'zgartirmaydi
    expect((await act.submit(orderId)).statusCode).toBe(200);

    // Rasmlar bazada; ko'rish — autentifikatsiyali endpoint
    const photos = await db.select().from(agentVisitPhotos).where(eq(agentVisitPhotos.visitId, visit.id));
    expect(photos.map((p) => p.kind).sort()).toEqual(["shelf", "storefront"]);
    expect(photos.every((p) => p.content !== null && p.contentType === "image/jpeg" && p.storageKey.startsWith("db/"))).toBe(true);
    const photoId = photos.find((p) => p.kind === "storefront")!.id;

    const link = (await call(ali.cookie, "GET", `/api/sales-agent/visits/${visit.id}/photos/${photoId}/url`)).json();
    expect(link.url).toBe(`/api/sales-agent/visits/${visit.id}/photos/${photoId}/content`);
    const content = await call(ali.cookie, "GET", link.url);
    expect(content.statusCode).toBe(200);
    expect(content.headers["content-type"]).toBe("image/jpeg");
    expect(content.headers["cache-control"]).toBe("private, no-store");
    expect(content.rawPayload.equals(JPEG)).toBe(true);
    expect((await call(vali.cookie, "GET", link.url)).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: link.url })).statusCode).toBe(401);

    const supervisor = await addEmployee(app, company, "Supervayzer");
    const supervisorLink = (await call(supervisor.cookie, "GET", `/api/sales-agent/supervisor/visits/${visit.id}/photos/${photoId}/url`)).json().url;
    expect((await call(supervisor.cookie, "GET", supervisorLink)).statusCode).toBe(200);
    const kassir = await addEmployee(app, company, "Kassir");
    expect((await call(kassir.cookie, "GET", supervisorLink)).statusCode).toBe(403);
    expect(await actionCount("STORE_PHOTO_ADDED")).toBe(2);
  });

  it("hududdan chiqish: pause vaqtni to'xtatadi, invalidate tashrifni bekor qiladi; 'Do'kon yopiq' va yangi sabablar", async () => {
    const ali = await agent("Ali");
    const baraka = await storeOnRoute(ali.repId);
    const act = visitActions(ali.cookie, baraka);

    const visit = (await act.start()).json().visit;
    await act.photo(visit.id, "storefront");
    await db.update(agentVisits).set({ timerStartedAt: minutesAgo(11) }).where(eq(agentVisits.id, visit.id));

    expect((await act.locate(outside)).json()).toMatchObject({ accepted: true, suspicious: false });
    const away = await act.current();
    expect(away.outsideSince).not.toBeNull();
    expect(away).toMatchObject({ outsideCount: 1, invalidatedAt: null });
    expect(await db.$count(agentLocationEvents, eq(agentLocationEvents.type, "visit_exit"))).toBe(1);
    expect(await actionCount("VISIT_OUTSIDE_GEOFENCE")).toBe(1);

    // 5 daqiqa tashqarida bo'ldi, keyin qaytdi
    await db.update(agentVisits).set({ outsideSince: minutesAgo(5) }).where(eq(agentVisits.id, visit.id));
    await act.locate(near);
    const back = await act.current();
    expect(back.outsideSince).toBeNull();
    expect(back.pausedSeconds).toBeGreaterThanOrEqual(299);

    expect((await act.complete(visit.id, { noOrderReason: "not_needed" })).json().details).toEqual({ reason: "shelf_photo_required" });
    await act.photo(visit.id, "shelf");
    // 11 − 5 = 6 daqiqa < 10
    expect((await act.complete(visit.id, { noOrderReason: "not_needed" })).json().details).toMatchObject({ reason: "visit_too_short" });
    const closedStore = await act.complete(visit.id, { noOrderReason: "store_closed" });
    expect(closedStore.statusCode).toBe(200);
    expect(closedStore.json().visit).toMatchObject({ status: "completed", result: "no_order", noOrderReason: "store_closed" });

    // "invalidate": hududdan chiqish tashrifni bekor qiladi — buyurtma va rasm yo'q, faqat yopiladi
    const supervisor = await addEmployee(app, company, "Supervayzer");
    const policy = { ...DEFAULT_SALES_AGENT_POLICY, visitExitPolicy: "invalidate" };
    expect((await call(supervisor.cookie, "PUT", "/api/sales-agent/policy", policy)).statusCode).toBe(200);
    const second = (await act.start()).json().visit;
    await act.photo(second.id, "storefront");
    await act.locate(outside);
    expect((await act.current()).invalidatedAt).not.toBeNull();
    expect((await act.photo(second.id, "shelf")).json().details).toEqual({ reason: "visit_invalid" });
    expect((await act.submit(await act.draft())).json().details).toEqual({ reason: "visit_invalid" });
    const closed = await act.complete(second.id, {});
    expect(closed.statusCode).toBe(200);
    expect(closed.json().visit.result).toBe("no_order");
    expect(closed.json().visit.invalidatedAt).not.toBeNull();
  });
});
