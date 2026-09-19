import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SALES_AGENT_POLICY } from "@bum/shared";
import { closeDb, db } from "../src/db/client.js";
import { unitConversions, units } from "../src/db/schema/catalog.js";
import { stockLevels, warehouses } from "../src/db/schema/inventory.js";
import { notifications } from "../src/db/schema/notifications.js";
import { auditLogs } from "../src/db/schema/platform.js";
import { salesOrders } from "../src/db/schema/sales.js";
import { agentLocationEvents } from "../src/db/schema/sales-agent.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { todayIso } from "../src/modules/finance/cash.service.js";
import { buildServer } from "../src/server.js";
import { LEGACY_VISIT_POLICY, setAgentPolicy } from "./agent-policy.js";
import { addEmployee, createCompany, resetDatabase, signedIn, salesRepOf } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PUT";

let app: FastifyInstance;
let company: Company;
let blok: string;
let productId: string;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

beforeEach(async () => {
  await resetDatabase();
  await db.delete(units);
  await seedDefaultUnits(db);
  const unitRows = await db.select().from(units);
  const piece = unitRows.find((unit) => unit.shortName === "d")!.id;
  blok = unitRows.find((unit) => unit.shortName === "bl")!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Distribyutor" });
  // Buyurtma qoidalari tashrif oqimisiz sinaladi (tashrif oqimi — sales-agent-visit-flow)
  await setAgentPolicy(company.companyId, LEGACY_VISIT_POLICY);
  const mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  productId = (
    await call(company.ownerCookie, "POST", "/api/catalog/products", { name: "Coca Cola 1L", sku: "COLA", baseUnitId: piece, salesPrice: "10000", taxRate: "0" })
  ).json().product.id;
  await db.insert(unitConversions).values({ companyId: company.companyId, fromUnitId: blok, toUnitId: piece, factor: "10", productId });
  await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", {
    type: "receive",
    productId,
    warehouseId: mainWh,
    quantity: "100",
    costPrice: "6000",
  });
});

async function agent(name: string) {
  const employee = await addEmployee(app, company, "Sotuv agenti");
  const repId = await salesRepOf(app, company.ownerCookie, employee.id, { name });
  expect(
    (await call(employee.cookie, "POST", "/api/sales-agent/work-session/start", { latitude: 41.3115, longitude: 69.2406, accuracy: 10, recordedAt: new Date().toISOString() }))
      .statusCode,
  ).toBe(201);
  return { cookie: employee.cookie, repId: repId };
}

async function store(body: object) {
  const res = await call(company.ownerCookie, "POST", "/api/sales/customers", body);
  expect(res.statusCode).toBe(201);
  return res.json().customer.id as string;
}

async function route(salesRepId: string, customerIds: string[]) {
  const res = await call(company.ownerCookie, "POST", "/api/distribution/routes", { name: "Chilonzor", salesRepId, days: [0, 1, 2, 3, 4, 5, 6] });
  const id = res.json().route.id as string;
  for (const customerId of customerIds) {
    expect((await call(company.ownerCookie, "POST", `/api/distribution/routes/${id}/customers`, { customerId })).statusCode).toBe(201);
  }
  return id;
}

const iso = () => new Date().toISOString();
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const shop = { latitude: 41.311081, longitude: 69.240562 };
const near = { latitude: 41.3115, longitude: 69.2406 };
const actionCount = (action: string) => db.$count(auditLogs, eq(auditLogs.action, action));

describe("Agent buyurtmalari", () => {
  it("katalog (dona/blok), idempotent qoralama, geofence bilan yuborish, qoldiq va bekor qilish", async () => {
    const ali = await agent("Ali");
    const supervisor = await addEmployee(app, company, "Supervayzer");
    const baraka = await store({ name: "Baraka", ...shop });
    const mega = await store({ name: "Mega" });
    const begona = await store({ name: "Begona", ...shop });
    await route(ali.repId, [baraka, mega]);

    const catalog = await call(ali.cookie, "GET", "/api/sales-agent/catalog?search=cola");
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json()).toEqual({
      products: [
        expect.objectContaining({
          id: productId,
          name: "Coca Cola 1L",
          unitName: "d",
          piecePrice: "10000.0000",
          available: "100.0000",
          hasImage: false,
          box: { unitId: blok, unitName: "bl", factor: "10.0000", price: "100000.0000" },
        }),
      ],
      nextOffset: null,
    });

    const requestId = randomUUID();
    const save = (body: object, id = requestId) =>
      call(ali.cookie, "PUT", `/api/sales-agent/orders/drafts/${id}`, { customerId: baraka, paymentType: "cash", ...body });

    const first = await save({ items: [{ productId, pieces: "3", boxes: "2" }] });
    expect(first.statusCode).toBe(200);
    const order = first.json().order;
    expect(order).toMatchObject({
      status: "draft",
      totalAmount: "230000.00",
      submittedAt: null,
      lines: [{ productId, pieces: "3.0000", boxes: "2.0000", boxUnitId: blok, boxFactor: "10.0000" }],
    });
    expect(order.items).toEqual([expect.objectContaining({ quantity: "23.0000", unitPrice: "10000.0000" })]);

    // Qayta urinish — o'sha buyurtma yangilanadi, takror yaratilmaydi
    const retry = await save({ items: [{ productId, pieces: "5", boxes: "2" }] });
    expect(retry.json().order).toMatchObject({ id: order.id, totalAmount: "250000.00" });
    expect(await db.$count(salesOrders, eq(salesOrders.companyId, company.companyId))).toBe(1);
    expect((await save({ customerId: begona, items: [{ productId, pieces: "1" }] }, randomUUID())).statusCode).toBe(404);
    expect((await save({ customerId: mega, items: [{ productId, pieces: "1" }] })).statusCode).toBe(409);
    expect((await save({ items: [{ productId, pieces: "0", boxes: "0" }] }, randomUUID())).json().details).toEqual({ reason: "empty_order" });

    const submit = (id: string, point = near, accuracy = 15, cookie = ali.cookie) =>
      call(cookie, "POST", `/api/sales-agent/orders/${id}/submit`, { ...point, accuracy, recordedAt: iso() });

    const far = await submit(order.id, { latitude: 41.33, longitude: 69.24 });
    expect(far.statusCode).toBe(403);
    expect(far.json().details).toMatchObject({ reason: "geofence", radiusMeters: 200 });
    // Buyurtma yaratilmaydi, lekin urinish, audit va supervayzer bildirishnomasi saqlanadi
    expect(await actionCount("GEOFENCE_ORDER_ATTEMPT")).toBe(1);
    expect(await db.$count(agentLocationEvents, eq(agentLocationEvents.type, "geofence_block"))).toBe(1);
    const [alert] = await db.select().from(notifications).where(eq(notifications.userId, supervisor.id));
    expect(alert).toMatchObject({ title: "Geo-fence buzilishi", relatedId: order.id, isGlobal: false });
    expect(alert!.message).toContain("Baraka");
    expect((await call(ali.cookie, "GET", `/api/sales-agent/orders/${order.id}`)).json().order.status).toBe("draft");

    expect((await submit(order.id, near, 500)).json().details).toEqual({ reason: "low_accuracy" });

    const sent = await submit(order.id);
    expect(sent.statusCode).toBe(200);
    expect(sent.json().order).toMatchObject({ status: "confirmed", approvalStatus: null });
    expect(sent.json().order.submitDistanceMeters).toBeLessThan(80);
    expect((await submit(order.id)).json().order.status).toBe("confirmed");
    expect(await actionCount("ORDER_SUBMIT")).toBe(1);
    expect((await save({ items: [{ productId, pieces: "1" }] })).statusCode).toBe(409);

    // Koordinatasiz do'kon — geofence tekshirib bo'lmaydi
    const megaOrder = (await save({ customerId: mega, items: [{ productId, pieces: "1" }] }, randomUUID())).json().order;
    expect((await submit(megaOrder.id)).json().details).toEqual({ reason: "store_location_missing" });

    // Qoldiq: 20 blok = 200 dona > 100 — qoralamaning o'zida rad etiladi (agent darhol biladi)
    const big = await save({ items: [{ productId, boxes: "20" }] }, randomUUID());
    expect(big.statusCode).toBe(400);
    expect(big.json().details).toMatchObject({ reason: "out_of_stock", productId });

    const extra = (await save({ items: [{ productId, pieces: "1" }] }, randomUUID())).json().order;
    const cancelled = await call(ali.cookie, "POST", `/api/sales-agent/orders/${extra.id}/cancel`, {});
    expect(cancelled.json().order.status).toBe("cancelled");
    expect(await actionCount("ORDER_CANCEL")).toBe(1);
    expect((await call(ali.cookie, "POST", `/api/sales-agent/orders/${order.id}/cancel`, {})).statusCode).toBe(409);

    const drafts = (await call(ali.cookie, "GET", "/api/sales-agent/orders?state=draft")).json().orders;
    expect(drafts.map((o: { id: string }) => o.id)).toEqual([megaOrder.id]);

    const vali = await agent("Vali");
    expect((await call(vali.cookie, "GET", `/api/sales-agent/orders/${order.id}`)).statusCode).toBe(404);
    expect((await submit(megaOrder.id, near, 15, vali.cookie)).statusCode).toBe(404);
    const kassir = await addEmployee(app, company, "Kassir");
    expect((await call(kassir.cookie, "GET", "/api/sales-agent/catalog")).statusCode).toBe(403);
  });

  it("bir agent olgan zakaz omborda band qilinadi — ikkinchi agent qolganidan ortig'ini ololmaydi", async () => {
    // Omborda 100 dona; Bekzod 80 dona zakaz oladi, Mansurga 20 dona qoladi
    const bekzod = await agent("Bekzod");
    const mansur = await agent("Mansur");
    const baraka = await store({ name: "Baraka", ...shop, creditLimit: "100000000" });
    const mega = await store({ name: "Mega", ...shop, creditLimit: "100000000" });
    await route(bekzod.repId, [baraka]);
    await route(mansur.repId, [mega]);

    const draft = (cookie: string, customerId: string, pieces: string, id = randomUUID()) =>
      call(cookie, "PUT", `/api/sales-agent/orders/drafts/${id}`, {
        customerId,
        paymentType: "cash",
        items: [{ productId, pieces }],
      });
    const submit = (cookie: string, id: string) =>
      call(cookie, "POST", `/api/sales-agent/orders/${id}/submit`, { ...near, accuracy: 15, recordedAt: iso() });

    const first = (await draft(bekzod.cookie, baraka, "80")).json().order;
    expect((await submit(bekzod.cookie, first.id)).json().order.status).toBe("confirmed");

    // Tovar hali omborda, lekin 80 donasi band
    const [level] = await db
      .select({ quantity: stockLevels.quantity, reservedQty: stockLevels.reservedQty })
      .from(stockLevels)
      .where(eq(stockLevels.productId, productId));
    expect(level).toMatchObject({ quantity: "100.0000", reservedQty: "80.0000" });

    // Mansur 30 dona ololmaydi — bo'sh qoldiq 20 ta
    const tooMuch = await draft(mansur.cookie, mega, "30");
    expect(tooMuch.statusCode, tooMuch.body).toBe(400);
    expect(tooMuch.json().details).toMatchObject({ reason: "out_of_stock", available: "20.0000" });

    // 20 dona — o'tadi
    const second = (await draft(mansur.cookie, mega, "20")).json().order;
    expect((await submit(mansur.cookie, second.id)).json().order.status).toBe("confirmed");
    expect(
      (await db.select({ reservedQty: stockLevels.reservedQty }).from(stockLevels).where(eq(stockLevels.productId, productId)))[0]!.reservedQty,
    ).toBe("100.0000");
  });

  it("PARALLEL: ikki agent bir vaqtda yuborsa — faqat qoldiq yetadigani o'tadi", async () => {
    // Omborda 100 dona; ikkala agent ham 80 donadan yuboradi — faqat bittasi o'tishi kerak
    const bekzod = await agent("Bekzod");
    const mansur = await agent("Mansur");
    const baraka = await store({ name: "Baraka", ...shop, creditLimit: "100000000" });
    const mega = await store({ name: "Mega", ...shop, creditLimit: "100000000" });
    await route(bekzod.repId, [baraka]);
    await route(mansur.repId, [mega]);

    const draft = async (cookie: string, customerId: string) => {
      const res = await call(cookie, "PUT", `/api/sales-agent/orders/drafts/${randomUUID()}`, {
        customerId,
        paymentType: "cash",
        items: [{ productId, pieces: "80" }],
      });
      expect(res.statusCode, res.body).toBe(200);
      return res.json().order.id as string;
    };
    // Qoralamalar ketma-ket yoziladi (ikkalasi ham hali band qilmaydi)
    const first = await draft(bekzod.cookie, baraka);
    const second = await draft(mansur.cookie, mega);

    const submit = (cookie: string, id: string) =>
      call(cookie, "POST", `/api/sales-agent/orders/${id}/submit`, { ...near, accuracy: 15, recordedAt: iso() });
    const [a, b] = await Promise.all([submit(bekzod.cookie, first), submit(mansur.cookie, second)]);

    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses, "bittasi o'tadi, ikkinchisi qoldiq yetmagani uchun rad etiladi").toEqual([200, 400]);
    const rejected = a.statusCode === 400 ? a : b;
    expect(rejected.json().details).toMatchObject({ reason: "out_of_stock" });

    const [level] = await db
      .select({ quantity: stockLevels.quantity, reservedQty: stockLevels.reservedQty })
      .from(stockLevels)
      .where(eq(stockLevels.productId, productId));
    expect(Number(level!.reservedQty), "band qoldiqdan oshmaydi").toBeLessThanOrEqual(Number(level!.quantity));
    expect(level!.reservedQty).toBe("80.0000");
  });

  it("nasiya muddati, kredit limiti (rad va tasdiq), yetkazish kuni siyosati, tashrif natijasi", async () => {
    const ali = await agent("Ali");
    const supervisor = await addEmployee(app, company, "Supervayzer");
    const baraka = await store({ name: "Baraka", ...shop, creditLimit: "300000" });
    const routeId = await route(ali.repId, [baraka]);
    const today = todayIso();
    const tomorrow = shift(today, 1);
    expect(
      (await call(company.ownerCookie, "POST", "/api/distribution/assignments", { routeId, salesRepId: ali.repId, assignDate: today, deliveryDate: tomorrow }))
        .statusCode,
    ).toBe(201);

    const visit = (
      await call(ali.cookie, "POST", "/api/sales-agent/visits/start", { customerId: baraka, ...near, accuracy: 10, recordedAt: iso() })
    ).json().visit;

    const save = (id: string, body: object) => call(ali.cookie, "PUT", `/api/sales-agent/orders/drafts/${id}`, { customerId: baraka, ...body });
    const submit = (id: string) => call(ali.cookie, "POST", `/api/sales-agent/orders/${id}/submit`, { ...near, accuracy: 10, recordedAt: iso() });

    // Supervayzer belgilagan yetkazish kuni — agent o'zgartira olmaydi
    const creditId = randomUUID();
    const draft = (await save(creditId, { paymentType: "credit", deliveryDate: "2030-01-01", items: [{ productId, pieces: "20" }] })).json().order;
    expect(draft.deliveryDate).toBe(tomorrow);
    expect((await submit(draft.id)).json().details).toEqual({ reason: "due_date_required" });
    await save(creditId, { paymentType: "credit", paymentDueDate: tomorrow, items: [{ productId, pieces: "20" }] });
    const credit = await submit(draft.id);
    expect(credit.statusCode).toBe(200);
    expect(credit.json().order).toMatchObject({
      status: "confirmed",
      paymentType: "credit",
      paymentDueDate: tomorrow,
      deliveryDate: tomorrow,
      visitId: visit.id,
    });
    expect(await actionCount("CREDIT_ORDER")).toBe(1);

    // Ochiq 200 000 + 150 000 > limit 300 000
    const over = (await save(randomUUID(), { paymentType: "credit", paymentDueDate: tomorrow, items: [{ productId, pieces: "15" }] })).json().order;
    expect((await submit(over.id)).json().details).toEqual({ reason: "credit_limit", limit: "300000.00", exposure: "350000.00" });

    expect((await call(supervisor.cookie, "PUT", "/api/sales-agent/policy", { ...DEFAULT_SALES_AGENT_POLICY, ...LEGACY_VISIT_POLICY, creditLimitPolicy: "approval" })).statusCode).toBe(200);
    const pending = await submit(over.id);
    expect(pending.statusCode).toBe(200);
    expect(pending.json().order).toMatchObject({ status: "draft", approvalStatus: "pending" });
    expect(
      await db.$count(notifications, and(eq(notifications.userId, supervisor.id), eq(notifications.title, "Buyurtma tasdiq kutmoqda"))),
    ).toBe(1);

    expect((await call(ali.cookie, "POST", `/api/sales-agent/supervisor/orders/${over.id}/approve`)).statusCode).toBe(403);
    const queue = (await call(supervisor.cookie, "GET", "/api/sales-agent/supervisor/orders?approval=pending")).json().orders;
    expect(queue.map((o: { id: string }) => o.id)).toEqual([over.id]);
    const approved = await call(supervisor.cookie, "POST", `/api/sales-agent/supervisor/orders/${over.id}/approve`);
    expect(approved.statusCode).toBe(200);
    expect(approved.json().order).toMatchObject({ status: "confirmed", approvalStatus: "approved" });
    expect((await call(supervisor.cookie, "POST", `/api/sales-agent/supervisor/orders/${over.id}/approve`)).statusCode).toBe(409);

    // Rad etish
    const third = (await save(randomUUID(), { paymentType: "credit", paymentDueDate: tomorrow, items: [{ productId, pieces: "10" }] })).json().order;
    expect((await submit(third.id)).json().order.approvalStatus).toBe("pending");
    const rejected = await call(supervisor.cookie, "POST", `/api/sales-agent/supervisor/orders/${third.id}/reject`, { reason: "Qarz yopilmagan" });
    expect(rejected.json().order).toMatchObject({ status: "cancelled", approvalStatus: "rejected", rejectionReason: "Qarz yopilmagan" });

    // Tashrifda buyurtma bor — sababsiz yakunlanadi
    const done = await call(ali.cookie, "POST", `/api/sales-agent/visits/${visit.id}/complete`, { ...near, accuracy: 10, recordedAt: iso() });
    expect(done.statusCode).toBe(200);
    expect(done.json().visit).toMatchObject({ result: "ordered", noOrderReason: null });
    expect(await actionCount("NO_ORDER")).toBe(0);

    // Agent yetkazish kunini tanlaydi — faqat ruxsat etilgan oraliqda
    await call(supervisor.cookie, "PUT", "/api/sales-agent/policy", { ...DEFAULT_SALES_AGENT_POLICY, ...LEGACY_VISIT_POLICY, deliveryDateMode: "choose", maxDeliveryDays: 2 });
    const outOfRange = await save(randomUUID(), { paymentType: "cash", deliveryDate: shift(today, 5), items: [{ productId, pieces: "1" }] });
    expect(outOfRange.json().details).toEqual({ reason: "delivery_date_out_of_range" });
    const chosenId = randomUUID();
    const noDate = (await save(chosenId, { paymentType: "cash", items: [{ productId, pieces: "1" }] })).json().order;
    expect((await submit(noDate.id)).json().details).toEqual({ reason: "delivery_date_required" });
    await save(chosenId, { paymentType: "cash", deliveryDate: shift(today, 2), items: [{ productId, pieces: "1" }] });
    expect((await submit(noDate.id)).json().order).toMatchObject({ status: "confirmed", deliveryDate: shift(today, 2) });
  });
});
