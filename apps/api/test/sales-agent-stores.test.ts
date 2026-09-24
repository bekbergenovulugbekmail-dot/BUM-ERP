import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { todayIso } from "../src/modules/finance/cash.service.js";
import { buildServer } from "../src/server.js";
import { distanceMeters, isValidCoordinate } from "../src/shared/geo.js";
import { addEmployee, createCompany, resetDatabase, signedIn, salesRepOf } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PATCH" | "DELETE";

let app: FastifyInstance;
let company: Company;
let mainWh: string;
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
  const piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Distribyutor" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  productId = (
    await call(company.ownerCookie, "POST", "/api/catalog/products", { name: "Suv", sku: "SUV", baseUnitId: piece, salesPrice: "5000", taxRate: "0" })
  ).json().product.id;
  await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", {
    type: "receive",
    productId,
    warehouseId: mainWh,
    quantity: "100",
    costPrice: "3000",
  });
});

/** Agent xodimi + unga bog'langan savdo agenti. */
async function agent(name: string) {
  const employee = await addEmployee(app, company, "Sotuv agenti");
  const repId = await salesRepOf(app, company.ownerCookie, employee.id, { name });
  return { cookie: employee.cookie, repId: repId };
}

async function store(body: object) {
  const res = await call(company.ownerCookie, "POST", "/api/sales/customers", body);
  expect(res.statusCode).toBe(201);
  return res.json().customer.id as string;
}

async function route(name: string, salesRepId: string, customerIds: string[]) {
  const id = (await call(company.ownerCookie, "POST", "/api/distribution/routes", { name, salesRepId, days: [] })).json().route.id as string;
  for (const customerId of customerIds) {
    expect((await call(company.ownerCookie, "POST", `/api/distribution/routes/${id}/customers`, { customerId })).statusCode).toBe(201);
  }
  return id;
}

/** Jo'natilgan (qarzga) buyurtma. */
async function shippedOrder(customerId: string, orderDate: string) {
  const order = await call(company.ownerCookie, "POST", "/api/sales/orders", {
    customerId,
    warehouseId: mainWh,
    orderDate,
    items: [{ productId, quantity: "10" }],
  });
  expect(order.statusCode).toBe(201);
  const id = order.json().order.id;
  expect((await call(company.ownerCookie, "POST", `/api/sales/orders/${id}/confirm`)).statusCode).toBe(200);
  expect((await call(company.ownerCookie, "POST", `/api/sales/orders/${id}/ship`)).statusCode).toBe(200);
}

describe("Geo", () => {
  it("haversine masofa va koordinata tekshiruvi", () => {
    const meters = distanceMeters({ latitude: 41.311081, longitude: 69.240562 }, { latitude: 41.312, longitude: 69.241 });
    expect(meters).toBeGreaterThan(100);
    expect(meters).toBeLessThan(115);
    expect(isValidCoordinate({ latitude: 0, longitude: 0 })).toBe(false);
    expect(isValidCoordinate({ latitude: 91, longitude: 10 })).toBe(false);
    expect(isValidCoordinate({ latitude: 41.3, longitude: 69.2 })).toBe(true);
  });
});

describe("Sotuv agenti: hudud, do'konlar, qarzdorlar", () => {
  it("haftalik jadval: agent o'z dasturida shu hafta kunining marshrutini ko'radi", async () => {
    const owner = company.ownerCookie;
    const zamira = await agent("Zamira");
    const shop = await store({ name: "Bog'ot do'koni", phone: "+998901110011" });
    const routeId = await route("Bog'ot tumani", zamira.repId, [shop]);

    const today = todayIso();
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    const otherDay = (weekday + 1) % 7;

    // Boshqa kun belgilangan bo'lsa bugun chiqmaydi
    expect((await call(owner, "PATCH", `/api/distribution/routes/${routeId}`, { days: [otherDay] })).statusCode).toBe(200);
    expect((await call(zamira.cookie, "GET", "/api/sales-agent/today")).json().routes).toEqual([]);

    // Hudud va kun bo'limi aynan shuni yozadi: marshrutga agent va hafta kunlari
    const saved = await call(owner, "PATCH", `/api/distribution/routes/${routeId}`, {
      salesRepId: zamira.repId,
      days: [weekday],
    });
    expect(saved.statusCode, saved.body).toBe(200);

    const plan = (await call(zamira.cookie, "GET", "/api/sales-agent/today")).json();
    expect(plan.routes).toEqual([expect.objectContaining({ id: routeId, name: "Bog'ot tumani", days: [weekday] })]);
    expect(plan.stores.map((row: { name: string }) => row.name)).toEqual(["Bog'ot do'koni"]);

    // Boshqa agentga o'tkazilsa — endi u ko'radi, avvalgisida yo'qoladi
    const dilnoza = await agent("Dilnoza");
    expect((await call(owner, "PATCH", `/api/distribution/routes/${routeId}`, { salesRepId: dilnoza.repId })).statusCode).toBe(200);
    expect((await call(zamira.cookie, "GET", "/api/sales-agent/today")).json().routes).toEqual([]);
    expect((await call(dilnoza.cookie, "GET", "/api/sales-agent/today")).json().routes).toHaveLength(1);
  });

  it("`scope=today` faqat bugungi marshrut, `scope=all` butun hafta", async () => {
    // Agent ilovasidagi "Mijozlar" ro'yxati shu ikki rejim ustida ishlaydi. Ilgari sahifa doim
    // `scope=all` so'rardi va agent bugungi marshrut bilan birga boshqa kunlarning do'konlarini
    // ham ko'rib, "payshanba bilan juma aralashib ketdi" deb hisoblardi.
    const owner = company.ownerCookie;
    const shahnoza = await agent("Shahnoza");
    const bugungi = await store({ name: "Dehqon bozor do'koni", phone: "+998901230001" });
    const jumalik = await store({ name: "Paxtakor do'koni", phone: "+998901230002" });

    const today = todayIso();
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    const boshqaKun = (weekday + 1) % 7;

    const bugungiRoute = await route("Dehqon bozor", shahnoza.repId, [bugungi]);
    const jumaRoute = await route("Paxtakor", shahnoza.repId, [jumalik]);
    expect((await call(owner, "PATCH", `/api/distribution/routes/${bugungiRoute}`, { days: [weekday] })).statusCode).toBe(200);
    expect((await call(owner, "PATCH", `/api/distribution/routes/${jumaRoute}`, { days: [boshqaKun] })).statusCode).toBe(200);

    const names = (res: { json: () => { stores: { name: string }[] } }) => res.json().stores.map((row) => row.name).sort();

    // Sukut — bugungi marshrut (so'rovda `scope` bo'lmasa ham)
    expect(names(await call(shahnoza.cookie, "GET", "/api/sales-agent/stores"))).toEqual(["Dehqon bozor do'koni"]);
    expect(names(await call(shahnoza.cookie, "GET", "/api/sales-agent/stores?scope=today"))).toEqual(["Dehqon bozor do'koni"]);

    // "Hammasi" — ataylab tanlanganda butun hafta
    expect(names(await call(shahnoza.cookie, "GET", "/api/sales-agent/stores?scope=all"))).toEqual([
      "Dehqon bozor do'koni",
      "Paxtakor do'koni",
    ]);

    // Boshqa kunning do'koni bugungi ro'yxatda qidirilsa topilmaydi, "hammasi" da topiladi
    expect(names(await call(shahnoza.cookie, "GET", "/api/sales-agent/stores?scope=today&search=Paxtakor"))).toEqual([]);
    expect(names(await call(shahnoza.cookie, "GET", "/api/sales-agent/stores?scope=all&search=Paxtakor"))).toEqual(["Paxtakor do'koni"]);

    // Ikkalasi ham agentga OCHIQ: boshqa kunning do'koniga kirish mumkin (to'lov qabul qilish uchun)
    expect((await call(shahnoza.cookie, "GET", `/api/sales-agent/stores/${jumalik}`)).statusCode).toBe(200);
  });

  it("bugungi marshrut sanaga biriktirishdan; do'kon va qarzdorlar faqat o'z hududi; masofa serverda", async () => {
    const owner = company.ownerCookie;
    const ali = await agent("Ali");
    const vali = await agent("Vali");

    const baraka = await store({
      name: "Baraka Market",
      phone: "+998901112233",
      address: "Chilonzor 9",
      contactName: "Bahodir",
      latitude: 41.312,
      longitude: 69.241,
      creditLimit: "1000000",
      paymentTermDays: 0,
    });
    const mega = await store({ name: "Mega", phone: "+998935556677", paymentTermDays: 5 });
    const shodlik = await store({ name: "Shodlik" });

    // Koordinata juftligi va chegaralari
    expect((await call(owner, "PATCH", `/api/sales/customers/${mega}`, { latitude: 41.3 })).statusCode).toBe(400);
    expect((await call(owner, "PATCH", `/api/sales/customers/${mega}`, { latitude: 95, longitude: 69 })).statusCode).toBe(400);

    const chilonzor = await route("Chilonzor", ali.repId, [baraka, mega]);
    await route("Yunusobod", vali.repId, [shodlik]);

    // Hafta kuni belgilanmagan marshrut sanaga biriktirilmasa bugun chiqmaydi
    expect((await call(ali.cookie, "GET", "/api/sales-agent/today")).json()).toMatchObject({ routes: [], stores: [] });

    const today = todayIso();
    const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    expect((await call(ali.cookie, "POST", "/api/distribution/assignments", { routeId: chilonzor, salesRepId: ali.repId, assignDate: today })).statusCode).toBe(403);
    expect(
      (await call(owner, "POST", "/api/distribution/assignments", { routeId: chilonzor, salesRepId: ali.repId, assignDate: today, deliveryDate: "2020-01-01" })).statusCode,
    ).toBe(400);
    const assigned = await call(owner, "POST", "/api/distribution/assignments", {
      routeId: chilonzor,
      salesRepId: ali.repId,
      assignDate: today,
      deliveryDate: tomorrow,
    });
    expect(assigned.statusCode).toBe(201);

    const todayRes = await call(ali.cookie, "GET", "/api/sales-agent/today?lat=41.311081&lng=69.240562");
    expect(todayRes.statusCode).toBe(200);
    const plan = todayRes.json();
    expect(plan.routes).toEqual([expect.objectContaining({ id: chilonzor, name: "Chilonzor", deliveryDate: tomorrow })]);
    expect(plan.stores.map((s: { name: string }) => s.name)).toEqual(["Baraka Market", "Mega"]);
    const barakaRow = plan.stores[0];
    expect(barakaRow.distanceMeters).toBeGreaterThan(100);
    expect(barakaRow.distanceMeters).toBeLessThan(115);
    expect(plan.stores[1].distanceMeters).toBeNull();
    expect((await call(ali.cookie, "GET", "/api/sales-agent/today?lat=41.3")).statusCode).toBe(400);

    // Vali bugun marshrutsiz; o'z do'konlari — faqat Shodlik; Alining do'koni unga ko'rinmaydi
    expect((await call(vali.cookie, "GET", "/api/sales-agent/today")).json().routes).toEqual([]);
    expect((await call(vali.cookie, "GET", "/api/sales-agent/stores?scope=all")).json().stores.map((s: { name: string }) => s.name)).toEqual(["Shodlik"]);
    expect((await call(vali.cookie, "GET", `/api/sales-agent/stores/${baraka}`)).statusCode).toBe(404);

    // Qidiruv: telefon raqamlari bo'yicha
    const found = (await call(ali.cookie, "GET", "/api/sales-agent/stores?scope=all&search=555 66")).json().stores;
    expect(found.map((s: { name: string }) => s.name)).toEqual(["Mega"]);

    // Qarz: Baraka — o'tgan sanadagi buyurtma (muddati o'tgan), Mega — bugungi, 5 kunlik muddat (hali vaqti bor)
    await shippedOrder(baraka, "2026-01-05");
    await shippedOrder(mega, today);

    const profile = (await call(ali.cookie, "GET", `/api/sales-agent/stores/${baraka}?lat=41.311081&lng=69.240562`)).json().store;
    expect(profile).toMatchObject({
      name: "Baraka Market",
      contactName: "Bahodir",
      totalDebt: "50000.00",
      availableCredit: "950000.00",
      routes: [{ id: chilonzor, name: "Chilonzor" }],
      ordersLast90Days: { count: expect.any(Number) },
    });
    expect(profile.recentOrders).toHaveLength(1);
    expect(profile.distanceMeters).toBeGreaterThan(100);

    const debtors = (filter: string) => call(ali.cookie, "GET", `/api/sales-agent/debtors?filter=${filter}`);
    const all = (await debtors("all")).json().debtors;
    expect(all.map((d: { name: string; status: string }) => [d.name, d.status])).toEqual([
      ["Baraka Market", "overdue"],
      ["Mega", "later"],
    ]);
    expect(all[0].daysOverdue).toBeGreaterThan(0);
    expect((await debtors("overdue")).json().debtors.map((d: { name: string }) => d.name)).toEqual(["Baraka Market"]);
    expect((await debtors("today")).json().debtors).toEqual([]);
    expect((await call(vali.cookie, "GET", "/api/sales-agent/debtors")).json().debtors).toEqual([]);

    // Marshrut shu kunga Valiga o'tkazildi — Vali uchun bugungi marshrut, Ali uchun bugungi ro'yxat bo'sh
    const moved = await call(owner, "POST", "/api/distribution/assignments", { routeId: chilonzor, salesRepId: vali.repId, assignDate: today });
    expect(moved.statusCode).toBe(201);
    expect(moved.json().assignment.id).toBe(assigned.json().assignment.id);
    expect((await call(vali.cookie, "GET", "/api/sales-agent/today")).json().routes.map((r: { id: string }) => r.id)).toEqual([chilonzor]);
    expect((await call(ali.cookie, "GET", "/api/sales-agent/today")).json().routes).toEqual([]);
    expect((await call(vali.cookie, "GET", `/api/sales-agent/stores/${baraka}`)).statusCode).toBe(200);

    const list = (await call(owner, "GET", `/api/distribution/assignments?dateFrom=${today}&dateTo=${today}`)).json().assignments;
    expect(list).toEqual([expect.objectContaining({ routeName: "Chilonzor", salesRepName: "Vali" })]);
    expect((await call(owner, "DELETE", `/api/distribution/assignments/${list[0].id}`)).statusCode).toBe(204);
    expect((await call(vali.cookie, "GET", `/api/sales-agent/stores/${baraka}`)).statusCode).toBe(404);
  });
});
