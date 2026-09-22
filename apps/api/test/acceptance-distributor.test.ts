/**
 * REAL BIZNES SIMULATSIYASI — BUSINESS 04: DISTRIBUTOR (`TEST-04-DISTRIBUTOR`).
 *
 * Zanjir: TA'MINOTCHI → OMBOR → SAVDO AGENTI → HUDUD → MARSHRUT → MIJOZ → TASHRIF → BUYURTMA →
 * OMBOR JO'NATISHI → YETKAZUVCHI → YETKAZISH → TO'LOV → QARZ → BUXGALTERIYA → HISOBOT.
 *
 * Arxitektura qoidalari tekshiriladi: SOTUV ≠ YETKAZISH ≠ TO'LOV (har biri o'z hayot sikli bilan),
 * `reserved_qty <= quantity`, tenant va agentlararo izolyatsiya, jurnalda debet = kredit.
 *
 * Production bazasiga aloqasi yo'q: `resetDatabase` faqat `_test` bazada ishlaydi.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { deliveryTasks } from "../src/db/schema/delivery.js";
import { cashAccounts, journalEntries, journalLines } from "../src/db/schema/finance.js";
import { stockLevels, warehouses } from "../src/db/schema/inventory.js";
import { agentVisits } from "../src/db/schema/sales-agent.js";
import { customers, salesOrders } from "../src/db/schema/sales.js";
import { buildServer } from "../src/server.js";
import { JPEG, NO_PROOFS, agentAction, assign, deliveryAgent, iso, near, resetUnits, setPolicy, shop, startShift, taskForOrder } from "./delivery-setup.js";
import { addEmployee, createCompany, login, resetDatabase, salesRepOf, signedIn, uniquePhone } from "./helpers.js";

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

let app: FastifyInstance;
let adminCookie: string;
let piece: string;
let box: string | null = null;

const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const money = (value: string | number | null | undefined) => Number(value ?? 0);

type Distributor = {
  companyId: string;
  ownerCookie: string;
  managerCookie: string;
  accountantCookie: string;
  warehouseCookie: string;
  warehouseId: string;
  cashAccountId: string;
  bankAccountId: string;
  products: Record<string, string>;
  suppliers: Record<string, string>;
  territories: Record<string, string>;
  routes: Record<string, string>;
  customers: Record<string, string>;
};

let dx: Distributor;
let agent1: { repId: string; cookie: string; userId: string };
let agent2: { repId: string; cookie: string; userId: string };
let courier: { id: string; cookie: string };
let outsider: { companyId: string; ownerCookie: string; customerId: string };

// ─── Baza holati ─────────────────────────────────────────────────────────────

async function stockRow(productId: string) {
  const [row] = await db
    .select({ quantity: stockLevels.quantity, reserved: stockLevels.reservedQty })
    .from(stockLevels)
    .where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, dx.warehouseId)));
  if (!row) return { quantity: 0, reserved: 0 };
  const quantity = money(row.quantity);
  const reserved = money(row.reserved);
  expect(quantity, "qoldiq manfiy").toBeGreaterThanOrEqual(0);
  expect(reserved, "reserved_qty > quantity").toBeLessThanOrEqual(quantity);
  return { quantity, reserved };
}

const debtOf = async (customerId: string) =>
  money((await db.select({ debt: customers.totalDebt }).from(customers).where(eq(customers.id, customerId)))[0]!.debt);

async function expectBalanced(label: string) {
  const [totals] = await db
    .select({
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)::numeric(18,2)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)::numeric(18,2)`,
      entries: sql<number>`(select count(*)::int from ${journalEntries} je where je.company_id = ${dx.companyId})`,
    })
    .from(journalLines)
    .where(eq(journalLines.companyId, dx.companyId));
  expect(totals!.debit, `${label}: debet ≠ kredit`).toBe(totals!.credit);
  const unbalanced = await db
    .select({ entryId: journalLines.entryId })
    .from(journalLines)
    .where(eq(journalLines.companyId, dx.companyId))
    .groupBy(journalLines.entryId)
    .having(sql`sum(${journalLines.debit}) <> sum(${journalLines.credit})`);
  expect(unbalanced, `${label}: balanslanmagan yozuv`).toHaveLength(0);
}

// ─── Amallar ─────────────────────────────────────────────────────────────────

async function addProduct(name: string, sku: string, salesPrice: string, extra: object = {}) {
  const res = await call(dx.ownerCookie, "POST", "/api/catalog/products", {
    name,
    sku,
    baseUnitId: piece,
    salesPrice,
    taxRate: "0",
    ...extra,
  });
  expect(res.statusCode, `${sku}: ${res.body}`).toBe(201);
  const id = res.json().product.id as string;
  dx.products[sku] = id;
  return id;
}

async function purchase(supplierId: string, lines: { productId: string; quantity: string; unitPrice: string }[]) {
  const created = await call(dx.managerCookie, "POST", "/api/purchase/orders", {
    supplierId,
    warehouseId: dx.warehouseId,
    orderDate: today(),
    items: lines.map((line) => ({ productId: line.productId, unitId: piece, orderedQty: line.quantity, unitPrice: line.unitPrice })),
  });
  expect(created.statusCode, created.body).toBe(201);
  const order = created.json().order as { id: string; items: { id: string; productId: string }[] };
  expect((await call(dx.managerCookie, "POST", `/api/purchase/orders/${order.id}/confirm`)).statusCode).toBe(200);
  const receipt = await call(dx.managerCookie, "POST", `/api/purchase/orders/${order.id}/receipts`, {
    receiptDate: today(),
    items: order.items.map((item) => ({
      orderItemId: item.id,
      receivedQty: lines.find((line) => line.productId === item.productId)!.quantity,
    })),
  });
  expect(receipt.statusCode, receipt.body).toBe(201);
}

/** Do'kon (mijoz) — koordinatasi bilan, chunki tashrif geofence bilan boshlanadi. */
async function addCustomer(name: string, territory: string, extra: object = {}) {
  const res = await call(dx.ownerCookie, "POST", "/api/sales/customers", {
    name,
    phone: uniquePhone("95"),
    partyType: "legal",
    city: territory,
    creditLimit: "50000000",
    paymentTermDays: 7,
    ...shop,
    ...extra,
  });
  expect(res.statusCode, res.body).toBe(201);
  const id = res.json().customer.id as string;
  dx.customers[name] = id;
  return id;
}

/** Agent buyurtmasi: qoralama → yuborish (do'kon yonidan). */
async function agentOrder(
  agent: { cookie: string },
  customerId: string,
  items: { productId: string; pieces: string }[],
  meters = 20,
) {
  const clientRequestId = randomUUID();
  const draft = await call(agent.cookie, "PUT", `/api/sales-agent/orders/drafts/${clientRequestId}`, {
    customerId,
    paymentType: "credit",
    paymentDueDate: inDays(7),
    items,
  });
  expect(draft.statusCode, draft.body).toBe(200);
  const orderId = draft.json().order.id as string;

  const submit = await call(agent.cookie, "POST", `/api/sales-agent/orders/${orderId}/submit`, {
    ...near(meters),
    accuracy: 15,
    recordedAt: iso(),
  });
  expect(submit.statusCode, submit.body).toBe(200);
  return { orderId, status: submit.json().order.status as string };
}

/** Tashrif rasmi — S3 sozlanmagan, shuning uchun bazaga to'g'ridan-to'g'ri. */
async function visitPhoto(agent: { cookie: string }, visitId: string, kind: "storefront" | "shelf") {
  const res = await call(agent.cookie, "POST", `/api/sales-agent/visits/${visitId}/photos/direct`, {
    kind,
    contentType: "image/jpeg",
    data: JPEG,
    ...near(20),
    accuracy: 15,
    recordedAt: iso(),
  });
  expect(res.statusCode, `${kind}: ${res.body}`).toBe(201);
}

/** Do'konda o'tkazilgan vaqt — siyosatdagi minimal tashrif davomiyligi (10 daqiqa) uchun. */
const spendMinutesInStore = (visitId: string, minutes = 11) =>
  db.update(agentVisits).set({ timerStartedAt: new Date(Date.now() - minutes * 60_000) }).where(eq(agentVisits.id, visitId));

/** Do'konga tashrif boshlanadi: kirish → vitrina rasmi → polka rasmi → do'konda o'tgan vaqt. */
async function startVisit(agent: { cookie: string }, customerId: string) {
  const started = await call(agent.cookie, "POST", "/api/sales-agent/visits/start", {
    customerId,
    ...near(20),
    accuracy: 15,
    recordedAt: iso(),
  });
  expect(started.statusCode, started.body).toBe(201);
  const visitId = started.json().visit.id as string;
  await visitPhoto(agent, visitId, "storefront");
  await visitPhoto(agent, visitId, "shelf");
  await spendMinutesInStore(visitId);
  return visitId;
}

/** To'liq tashrif: buyurtma yuborilganda tashrif "ordered" bilan yopiladi. */
async function visitAndOrder(agent: { cookie: string }, customerId: string, items: { productId: string; pieces: string }[]) {
  const visitId = await startVisit(agent, customerId);
  return { visitId, ...(await agentOrder(agent, customerId, items)) };
}

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
  await resetDatabase();
  await resetUnits();
  adminCookie = (await signedIn(app, { isPlatformAdmin: true })).cookie;
  piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  box = (await db.select().from(units).where(eq(units.shortName, "blok")))[0]?.id ?? null;
}, 120_000);

afterAll(async () => {
  await app.close();
  await closeDb();
});

describe("BUSINESS 04 — DISTRIBUTOR (TEST-04-DISTRIBUTOR)", () => {
  it("PHASE 0 — kompaniya, ombor, olti rol va sessiya", async () => {
    const company = await createCompany(app, adminCookie, { name: "TEST-04-DISTRIBUTOR" });
    const warehouseId = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
    expect((await call(company.ownerCookie, "POST", "/api/finance/setup")).statusCode).toBe(200);
    const accounts = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));

    const manager = await addEmployee(app, company, "Direktor");
    const accountant = await addEmployee(app, company, "Buxgalter");
    const warehouseUser = await addEmployee(app, company, "Ombor menejeri");

    dx = {
      companyId: company.companyId,
      ownerCookie: company.ownerCookie,
      managerCookie: manager.cookie,
      accountantCookie: accountant.cookie,
      warehouseCookie: warehouseUser.cookie,
      warehouseId,
      cashAccountId: accounts.find((row) => row.type === "cash")!.id,
      bankAccountId: accounts.find((row) => row.type === "bank")!.id,
      products: {},
      suppliers: {},
      territories: {},
      routes: {},
      customers: {},
    };
    expect((await call(dx.ownerCookie, "PATCH", `/api/inventory/warehouses/${warehouseId}`, { name: "DISTRIBUTOR MAIN WAREHOUSE" })).statusCode).toBe(200);

    // Boshlang'ich mablag'
    const chart = (await call(dx.ownerCookie, "GET", "/api/finance/accounts")).json().accounts as { id: string; code: string }[];
    const capitalId = chart.find((row) => row.code === "3000")!.id;
    for (const [accountId, amount] of [[dx.cashAccountId, "30000000"], [dx.bankAccountId, "200000000"]] as const) {
      expect(
        (await call(dx.ownerCookie, "POST", "/api/finance/cash-transactions", {
          cashAccountId: accountId,
          type: "in",
          amount,
          description: "Boshlang'ich mablag'",
          counterAccountId: capitalId,
          txDate: today(),
        })).statusCode,
      ).toBe(201);
    }

    // Sotuv agentlari (xodim + agent profili) va yetkazuvchi
    const employee1 = await addEmployee(app, company, "Sotuv agenti");
    const employee2 = await addEmployee(app, company, "Sotuv agenti");
    agent1 = { cookie: employee1.cookie, userId: employee1.id, repId: await salesRepOf(app, dx.ownerCookie, employee1.id, { name: "TEST-AGENT-01" }) };
    agent2 = { cookie: employee2.cookie, userId: employee2.id, repId: await salesRepOf(app, dx.ownerCookie, employee2.id, { name: "TEST-AGENT-02" }) };
    const delivery = await deliveryAgent(app, company, { name: "TEST-COURIER-01" });
    courier = { id: delivery.id, cookie: delivery.cookie };

    // Isbot talablarini o'chiramiz (rasm/imzo/OTP test doirasidan tashqarida)
    await setPolicy(app, dx.ownerCookie, NO_PROOFS);

    // Begona tenant
    const other = await createCompany(app, adminCookie, { name: "TEST-04-OUTSIDER" });
    const foreign = await call(other.ownerCookie, "POST", "/api/sales/customers", { name: "Begona do'kon", phone: uniquePhone("96") });
    outsider = { companyId: other.companyId, ownerCookie: other.ownerCookie, customerId: foreign.json().customer.id as string };

    expect((await call(agent1.cookie, "GET", "/api/sales-agent/me")).statusCode).toBe(200);
    expect((await call(courier.cookie, "GET", "/api/delivery/agent/me")).statusCode).toBe(200);
    await expectBalanced("bootstrap");
  });

  it("PHASE 1 — 50 mahsulot, birlik konversiyasi (dona/blok)", async () => {
    const groups = ["Ichimliklar", "Oziq-ovqat", "Shirinlik", "Maishiy", "Gigiyena"];
    const categoryIds: string[] = [];
    for (const name of groups) {
      const res = await call(dx.ownerCookie, "POST", "/api/catalog/categories", { name });
      expect(res.statusCode, res.body).toBe(201);
      categoryIds.push(res.json().category.id as string);
    }
    for (let index = 0; index < 50; index += 1) {
      await addProduct(
        `${groups[index % 5]} ${index + 1}`,
        `DX-${String(index + 1).padStart(2, "0")}`,
        String(8_000 + index * 200),
        { categoryId: categoryIds[index % 5], barcode: `400${String(index + 1).padStart(4, "0")}` },
      );
    }
    expect(Object.keys(dx.products)).toHaveLength(50);

    if (box) {
      for (let index = 0; index < 10; index += 1) {
        const res = await call(dx.ownerCookie, "POST", "/api/catalog/unit-conversions", {
          productId: dx.products[`DX-${String(index + 1).padStart(2, "0")}`]!,
          unitId: box,
          factor: "10",
        });
        expect([200, 201]).toContain(res.statusCode);
      }
      const list = await call(dx.ownerCookie, "GET", `/api/catalog/unit-conversions?productId=${dx.products["DX-01"]}`);
      expect(list.json().conversions.length, "dona/blok konversiyasi").toBeGreaterThan(0);
    }
  });

  it("PHASE 2 — uch ta'minotchi va katta qabul", async () => {
    for (const name of ["DX-SUPPLIER-A", "DX-SUPPLIER-B", "DX-SUPPLIER-C"]) {
      const res = await call(dx.managerCookie, "POST", "/api/purchase/suppliers", { name, phone: uniquePhone("94") });
      expect(res.statusCode, res.body).toBe(201);
      dx.suppliers[name] = res.json().supplier.id as string;
    }

    await purchase(dx.suppliers["DX-SUPPLIER-A"]!, [
      { productId: dx.products["DX-01"]!, quantity: "3000", unitPrice: "5000" },
      { productId: dx.products["DX-02"]!, quantity: "2000", unitPrice: "6000" },
    ]);
    await purchase(dx.suppliers["DX-SUPPLIER-B"]!, [
      { productId: dx.products["DX-03"]!, quantity: "2000", unitPrice: "4000" },
      { productId: dx.products["DX-04"]!, quantity: "1000", unitPrice: "7000" },
    ]);
    await purchase(dx.suppliers["DX-SUPPLIER-C"]!, [
      { productId: dx.products["DX-05"]!, quantity: "1000", unitPrice: "9000" },
      { productId: dx.products["DX-06"]!, quantity: "1000", unitPrice: "3000" },
    ]);

    expect((await stockRow(dx.products["DX-01"]!)).quantity).toBe(3000);
    expect((await stockRow(dx.products["DX-04"]!)).quantity).toBe(1000);
    await expectBalanced("xaridlar");
  });

  it("PHASE 3 — hududlar: viloyat → shahar/tuman ma'lumotnomasi", async () => {
    const region = await call(dx.ownerCookie, "POST", "/api/distribution/territories", { name: "Xorazm viloyati", kind: "region" });
    expect(region.statusCode, region.body).toBe(201);
    const regionId = region.json().territory.id as string;

    for (const name of ["Urganch", "Xiva", "Xonqa", "Shovot"]) {
      const res = await call(dx.ownerCookie, "POST", "/api/distribution/territories", {
        name,
        kind: "district",
        parentId: regionId,
      });
      expect(res.statusCode, res.body).toBe(201);
      dx.territories[name] = res.json().territory.id as string;
    }

    const list = (await call(dx.managerCookie, "GET", "/api/distribution/territories?kind=district")).json().territories as
      { name: string; parentId: string | null }[];
    expect(list.map((row) => row.name).sort()).toEqual(["Shovot", "Urganch", "Xiva", "Xonqa"]);
    expect(list.every((row) => row.parentId === regionId), "tumanlar viloyat ichida").toBe(true);
  });

  it("PHASE 4 — marshrutlar: har hududga marshrut va agent biriktiriladi", async () => {
    const plan: [string, string, { repId: string }][] = [
      ["Urganch-01", "Urganch", agent1],
      ["Urganch-02", "Urganch", agent1],
      ["Xiva-01", "Xiva", agent2],
      ["Xonqa-01", "Xonqa", agent2],
      ["Shovot-01", "Shovot", agent1],
    ];
    const weekday = new Date(`${today()}T00:00:00Z`).getUTCDay();
    for (const [name, territory, agent] of plan) {
      const res = await call(dx.ownerCookie, "POST", "/api/distribution/routes", {
        name,
        territoryId: dx.territories[territory]!,
        salesRepId: agent.repId,
        days: [weekday],
      });
      expect(res.statusCode, res.body).toBe(201);
      dx.routes[name] = res.json().route.id as string;
    }

    const routes = (await call(dx.managerCookie, "GET", "/api/distribution/routes")).json().routes as
      { name: string; territoryName: string | null; salesRepId: string | null }[];
    expect(routes).toHaveLength(5);
    expect(routes.find((row) => row.name === "Xiva-01")).toMatchObject({ territoryName: "Xiva", salesRepId: agent2.repId });
  });

  it("PHASE 5 — 20 mijoz: marshrutlarga biriktiriladi, import va tezkor qo'shish ishlaydi", async () => {
    const byRoute: [string, string][] = [
      ["Urganch-01", "Urganch"],
      ["Urganch-02", "Urganch"],
      ["Xiva-01", "Xiva"],
      ["Xonqa-01", "Xonqa"],
    ];
    let index = 0;
    for (const [routeName, territory] of byRoute) {
      const ids: string[] = [];
      for (let shopIndex = 0; shopIndex < 5; shopIndex += 1) {
        index += 1;
        ids.push(await addCustomer(`DX-CUSTOMER-${String(index).padStart(2, "0")}`, territory));
      }
      const added = await call(dx.ownerCookie, "POST", `/api/distribution/routes/${dx.routes[routeName]}/customers`, {
        customerIds: ids,
      });
      expect(added.statusCode, added.body).toBe(201);
      expect(added.json()).toMatchObject({ added: 5, skipped: 0 });
    }
    expect(Object.keys(dx.customers)).toHaveLength(20);

    // Import (CSV qatorlari) — mavjud oqim
    const imported = await call(dx.ownerCookie, "POST", "/api/sales/customers/import", {
      rows: [
        { name: "DX-IMPORT-01", phone: uniquePhone("95"), city: "Shovot", territory: "Shovot" },
        { name: "DX-IMPORT-02", phone: uniquePhone("95"), city: "Shovot" },
      ],
    });
    expect(imported.statusCode, imported.body).toBe(200);
    expect(imported.json().created).toBe(2);

    // Tezkor qo'shish (bitta qator, telefon majburiy)
    const quick = await call(dx.ownerCookie, "POST", "/api/sales/customers/import", {
      requirePhone: true,
      rows: [{ name: "DX-QUICK-01", phone: uniquePhone("95"), city: "Shovot", territory: "Shovot" }],
    });
    expect(quick.statusCode, quick.body).toBe(200);
    expect(quick.json().created).toBe(1);

    const total = (await call(dx.ownerCookie, "GET", "/api/sales/customers?limit=200")).json().customers as unknown[];
    expect(total.length).toBe(23);
  });

  it("PHASE 6 — agent ish joyi: ish boshlanadi, faqat o'z marshruti va do'konlari ko'rinadi", async () => {
    const today1 = await call(agent1.cookie, "GET", "/api/sales-agent/today");
    expect(today1.statusCode, today1.body).toBe(200);
    const routes1 = today1.json().routes as { name: string }[];
    expect(routes1.map((row) => row.name).sort(), "agent-1 marshrutlari").toEqual(["Shovot-01", "Urganch-01", "Urganch-02"]);

    // Ish boshlanmaguncha maydon amallari yopiq
    const beforeWork = await call(agent1.cookie, "POST", "/api/sales-agent/visits/start", {
      customerId: dx.customers["DX-CUSTOMER-01"]!,
      ...near(20),
      accuracy: 15,
      recordedAt: iso(),
    });
    expect(beforeWork.statusCode, "ishni boshlamasdan tashrif yo'q").toBe(409);
    expect(beforeWork.json().details.reason).toBe("work_session_required");

    for (const agent of [agent1, agent2]) {
      const started = await call(agent.cookie, "POST", "/api/sales-agent/work-session/start", { ...near(20), accuracy: 15, recordedAt: iso() });
      expect(started.statusCode, started.body).toBe(201);
    }

    const stores1 = (await call(agent1.cookie, "GET", "/api/sales-agent/stores?scope=all&limit=100")).json().stores as { id: string }[];
    const stores2 = (await call(agent2.cookie, "GET", "/api/sales-agent/stores?scope=all&limit=100")).json().stores as { id: string }[];
    // Urganch-01/02 dagi 10 ta + import qilinganda hududi ko'rsatilgani uchun Shovot-01 ga tushgan 2 ta do'kon
    expect(stores1.length, "agent-1 do'konlari (Urganch 10 + Shovot 2)").toBe(12);
    expect(stores2.length, "agent-2 do'konlari (Xiva + Xonqa)").toBe(10);
    const overlap = stores1.filter((row) => stores2.some((other) => other.id === row.id));
    expect(overlap, "agentlar do'konlari kesishmaydi").toHaveLength(0);

    // Agentga boshqa bo'limlar yopiq
    expect((await call(agent1.cookie, "GET", "/api/purchase/orders")).statusCode).toBe(403);
    expect((await call(agent1.cookie, "GET", "/api/finance/journal")).statusCode).toBe(403);
    expect((await call(agent1.cookie, "GET", "/api/catalog/products/costs")).statusCode).toBe(403);
  });

  it("PHASE 7 — tashriflar: geofence tekshiriladi, tashrif boshlanadi va yakunlanadi", async () => {
    const customerId = dx.customers["DX-CUSTOMER-01"]!;

    // Do'kondan uzoqda — tashrif boshlanmaydi
    const far = await call(agent1.cookie, "POST", "/api/sales-agent/visits/start", {
      customerId,
      latitude: 41.5,
      longitude: 69.5,
      accuracy: 15,
      recordedAt: iso(),
    });
    expect(far.statusCode, "geofence tashqarisida tashrif boshlanmaydi").toBe(403);
    expect(far.json().details.reason).toBe("geofence");

    // Boshqa agentning do'koni — ko'rinmaydi
    const foreignStore = await call(agent2.cookie, "POST", "/api/sales-agent/visits/start", {
      customerId,
      ...near(20),
      accuracy: 15,
      recordedAt: iso(),
    });
    expect(foreignStore.statusCode, "begona do'konga tashrif yo'q").toBe(404);

    const started = await call(agent1.cookie, "POST", "/api/sales-agent/visits/start", {
      customerId,
      ...near(20),
      accuracy: 15,
      recordedAt: iso(),
    });
    expect(started.statusCode, started.body).toBe(201);
    const visitId = started.json().visit.id as string;

    // Buyurtma qoralamasi tashrif ichida to'ldiriladi
    const clientRequestId = randomUUID();
    const draft = await call(agent1.cookie, "PUT", `/api/sales-agent/orders/drafts/${clientRequestId}`, {
      customerId,
      paymentType: "credit",
      paymentDueDate: inDays(7),
      items: [
        { productId: dx.products["DX-01"]!, pieces: "100" },
        { productId: dx.products["DX-02"]!, pieces: "50" },
        { productId: dx.products["DX-03"]!, pieces: "20" },
      ],
    });
    expect(draft.statusCode, draft.body).toBe(200);
    const orderId = draft.json().order.id as string;
    const submit = () =>
      call(agent1.cookie, "POST", `/api/sales-agent/orders/${orderId}/submit`, { ...near(20), accuracy: 15, recordedAt: iso() });

    // Siyosat bosqichlari: vitrina rasmi → polka rasmi → do'konda minimal vaqt
    expect((await submit()).json().details, "vitrina rasmisiz yuborilmaydi").toMatchObject({ reason: "storefront_photo_required" });
    await visitPhoto(agent1, visitId, "storefront");
    expect((await submit()).json().details, "polka rasmisiz yuborilmaydi").toMatchObject({ reason: "shelf_photo_required" });
    await visitPhoto(agent1, visitId, "shelf");
    expect((await submit()).json().details, "qisqa tashrifdan buyurtma yo'q").toMatchObject({ reason: "visit_too_short", minVisitMinutes: 10 });

    // Do'konda 11 daqiqa o'tdi — buyurtma yuboriladi va tashrifni yopadi
    await spendMinutesInStore(visitId);
    const sent = await submit();
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json().order.status, "yuborilgan buyurtma tasdiqlanadi").toBe("confirmed");

    expect((await call(agent1.cookie, "GET", "/api/sales-agent/visits/current")).json().visit, "buyurtma tashrifni yopadi").toBeNull();
    const [closed] = await db.select().from(agentVisits).where(eq(agentVisits.id, visitId));
    expect(closed).toMatchObject({ status: "completed", result: "ordered" });

    const order = (await call(dx.managerCookie, "GET", `/api/sales/orders/${orderId}`)).json().order;
    expect(order.customerId).toBe(customerId);
    expect(order.status).toBe("confirmed");
    await expectBalanced("tashrif va buyurtma");
  });

  it("PHASE 8 — agent buyurtmalari: uch do'kon, zaxira band bo'ladi", async () => {
    const before1 = await stockRow(dx.products["DX-01"]!);
    const before4 = await stockRow(dx.products["DX-04"]!);

    const second = await visitAndOrder(agent1, dx.customers["DX-CUSTOMER-02"]!, [
      { productId: dx.products["DX-04"]!, pieces: "200" },
      { productId: dx.products["DX-05"]!, pieces: "100" },
    ]);
    const third = await visitAndOrder(agent1, dx.customers["DX-CUSTOMER-03"]!, [
      { productId: dx.products["DX-01"]!, pieces: "300" },
      { productId: dx.products["DX-02"]!, pieces: "150" },
      { productId: dx.products["DX-03"]!, pieces: "100" },
    ]);
    expect(second.status).toBe("confirmed");
    expect(third.status).toBe("confirmed");

    const after1 = await stockRow(dx.products["DX-01"]!);
    const after4 = await stockRow(dx.products["DX-04"]!);
    expect(after1.reserved - before1.reserved, "DX-01 uchun band qilingan").toBe(300);
    expect(after4.reserved - before4.reserved, "DX-04 uchun band qilingan").toBe(200);
    expect(after1.quantity, "band qilish qoldiqni kamaytirmaydi").toBe(before1.quantity);

    // Agent faqat o'z buyurtmalarini ko'radi
    const mine = (await call(agent1.cookie, "GET", "/api/sales-agent/orders")).json().orders as { id: string }[];
    expect(mine.length).toBeGreaterThanOrEqual(3);
    const other = (await call(agent2.cookie, "GET", "/api/sales-agent/orders")).json().orders as { id: string }[];
    expect(other.some((row) => mine.some((item) => item.id === row.id)), "agentlar buyurtmalari aralashmaydi").toBe(false);
  });

  it("PHASE 9 — ombor jo'natishi: zaxira bo'shaydi, qoldiq kamayadi, qarz yoziladi", async () => {
    const customerId = dx.customers["DX-CUSTOMER-02"]!;
    const orders = (await call(dx.managerCookie, "GET", `/api/sales/orders?customerId=${customerId}&limit=10`)).json().orders as
      { id: string; status: string }[];
    const orderId = orders.find((row) => row.status === "confirmed")!.id;

    const before4 = await stockRow(dx.products["DX-04"]!);
    const debtBefore = await debtOf(customerId);

    const shipped = await call(dx.managerCookie, "POST", `/api/sales/orders/${orderId}/ship`);
    expect(shipped.statusCode, shipped.body).toBe(200);

    const after4 = await stockRow(dx.products["DX-04"]!);
    expect(after4.quantity, "jo'natishda qoldiq kamayadi").toBe(before4.quantity - 200);
    expect(after4.reserved, "band qilingan bo'shaydi").toBe(before4.reserved - 200);
    expect(await debtOf(customerId), "jo'natilgan tovar qarzga yoziladi").toBeGreaterThan(debtBefore);
    await expectBalanced("ombor jo'natishi");
  });

  it("PHASE 10 — yetkazish: READY → ASSIGNED → ACCEPTED → OUT → ARRIVED → DELIVERED", async () => {
    const customerId = dx.customers["DX-CUSTOMER-04"]!;
    const created = await call(dx.managerCookie, "POST", "/api/sales/orders", {
      customerId,
      warehouseId: dx.warehouseId,
      orderDate: today(),
      deliveryRequired: true,
      items: [{ productId: dx.products["DX-06"]!, quantity: "100" }],
    });
    expect(created.statusCode, created.body).toBe(201);
    const orderId = created.json().order.id as string;
    expect((await call(dx.managerCookie, "POST", `/api/sales/orders/${orderId}/confirm`)).statusCode).toBe(200);

    const task = await taskForOrder(app, dx.managerCookie, orderId);
    expect(task).toMatchObject({ status: "ready" });

    await assign(app, dx.ownerCookie, task.id, courier.id);
    expect((await call(dx.managerCookie, "GET", `/api/delivery/tasks/${task.id}`)).json().task.status).toBe("assigned");

    const accepted = await agentAction(app, courier.cookie, task.id, "accept");
    expect(accepted.statusCode, accepted.body).toBe(200);

    // Yetkazuvchi ham ishni boshlamaguncha yo'lga chiqmaydi
    const beforeShift = await agentAction(app, courier.cookie, task.id, "start");
    expect(beforeShift.statusCode, "ishni boshlamasdan yo'lga chiqilmaydi").toBe(409);
    expect(beforeShift.json().details.reason).toBe("work_session_required");
    await startShift(app, courier.cookie);

    for (const [action, body] of [
      ["start", {}],
      ["arrive", near(30)],
      ["delivering", {}],
    ] as const) {
      const res = await agentAction(app, courier.cookie, task.id, action, body);
      expect(res.statusCode, `${action}: ${res.body}`).toBe(200);
    }

    const before6 = await stockRow(dx.products["DX-06"]!);
    const confirmed = await agentAction(app, courier.cookie, task.id, "confirm", near(20));
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().summary.status).toBe("delivered");

    // Yetkazish sotuvdan alohida: buyurtma holati va yetkazma holati mos
    const order = (await call(dx.managerCookie, "GET", `/api/sales/orders/${orderId}`)).json().order;
    expect(["shipped", "completed", "delivered"]).toContain(order.status);
    expect(order.deliveryStatus).toBe("delivered");
    expect((await stockRow(dx.products["DX-06"]!)).quantity, "yetkazilgan tovar omborda qolmaydi").toBeLessThanOrEqual(before6.quantity);
    await expectBalanced("yetkazish");
  });

  it("PHASE 11 — yetkazilmagan buyurtma: FAILED, qoldiq va qarz buzilmaydi", async () => {
    const customerId = dx.customers["DX-CUSTOMER-05"]!;
    const created = await call(dx.managerCookie, "POST", "/api/sales/orders", {
      customerId,
      warehouseId: dx.warehouseId,
      orderDate: today(),
      deliveryRequired: true,
      items: [{ productId: dx.products["DX-06"]!, quantity: "50" }],
    });
    expect(created.statusCode, created.body).toBe(201);
    const orderId = created.json().order.id as string;
    expect((await call(dx.managerCookie, "POST", `/api/sales/orders/${orderId}/confirm`)).statusCode).toBe(200);

    const task = await taskForOrder(app, dx.managerCookie, orderId);
    await assign(app, dx.ownerCookie, task.id, courier.id);
    for (const [action, body] of [["accept", {}], ["start", {}], ["arrive", near(30)]] as const) {
      expect((await agentAction(app, courier.cookie, task.id, action, body)).statusCode).toBe(200);
    }

    const stockBefore = await stockRow(dx.products["DX-06"]!);
    const debtBefore = await debtOf(customerId);

    const failed = await agentAction(app, courier.cookie, task.id, "fail", {
      reason: "customer_absent",
      comment: "Do'kon yopiq",
      ...near(25),
    });
    expect(failed.statusCode, failed.body).toBe(200);
    const [taskRow] = await db.select({ status: deliveryTasks.status }).from(deliveryTasks).where(eq(deliveryTasks.id, task.id));
    expect(taskRow!.status).toBe("failed");

    expect((await stockRow(dx.products["DX-06"]!)).quantity, "yetkazilmagan tovar qoldiqni o'zgartirmaydi").toBe(stockBefore.quantity);
    expect(await debtOf(customerId), "yetkazilmagan buyurtma qarz yozmaydi").toBe(debtBefore);
    await expectBalanced("yetkazilmadi");
  });

  it("PHASE 12 — qisman yetkazish: PARTIALLY_DELIVERED va qoldiq uchun qayta yetkazma", async () => {
    const customerId = dx.customers["DX-CUSTOMER-06"]!;
    const created = await call(dx.managerCookie, "POST", "/api/sales/orders", {
      customerId,
      warehouseId: dx.warehouseId,
      orderDate: today(),
      deliveryRequired: true,
      items: [{ productId: dx.products["DX-03"]!, quantity: "100" }],
    });
    expect(created.statusCode, created.body).toBe(201);
    const orderId = created.json().order.id as string;
    expect((await call(dx.managerCookie, "POST", `/api/sales/orders/${orderId}/confirm`)).statusCode).toBe(200);

    const task = await taskForOrder(app, dx.managerCookie, orderId);
    await assign(app, dx.ownerCookie, task.id, courier.id);
    for (const [action, body] of [["accept", {}], ["start", {}], ["arrive", near(30)], ["delivering", {}]] as const) {
      expect((await agentAction(app, courier.cookie, task.id, action, body)).statusCode).toBe(200);
    }

    const detail = (await call(courier.cookie, "GET", `/api/delivery/agent/tasks/${task.id}`)).json().task as
      { items: { id: string }[] };
    const partial = await agentAction(app, courier.cookie, task.id, "confirm", {
      ...near(20),
      items: [{ taskItemId: detail.items[0]!.id, deliveredQty: "70" }],
    });
    expect(partial.statusCode, partial.body).toBe(200);
    expect(partial.json().summary.status, "qisman yetkazildi").toBe("partially_delivered");

    // Qolgan 30 dona uchun qayta yetkazma ochiladi
    const redelivery = await call(dx.managerCookie, "POST", `/api/delivery/tasks/${task.id}/redeliver`, {
      reason: "Qolgani ertaga",
    });
    expect(redelivery.statusCode, redelivery.body).toBe(201);
    expect(redelivery.json().task.status).toBe("ready");
    await expectBalanced("qisman yetkazish");
  });

  it("PHASE 13 — to'lov: qisman, keyin to'liq — qarz nolga tushadi", async () => {
    const customerId = dx.customers["DX-CUSTOMER-02"]!;
    const debt = await debtOf(customerId);
    expect(debt, "jo'natilgan buyurtmadan qarz bor").toBeGreaterThan(0);

    const half = Math.floor(debt / 2);
    const first = await call(dx.accountantCookie, "POST", "/api/sales/payments", {
      customerId,
      amount: String(half),
      method: "cash",
      cashAccountId: dx.cashAccountId,
      paymentDate: today(),
    });
    expect(first.statusCode, first.body).toBe(201);
    expect(await debtOf(customerId)).toBe(debt - half);

    const rest = await debtOf(customerId);
    const second = await call(dx.accountantCookie, "POST", "/api/sales/payments", {
      customerId,
      amount: String(rest),
      method: "bank",
      cashAccountId: dx.bankAccountId,
      paymentDate: today(),
    });
    expect(second.statusCode, second.body).toBe(201);
    expect(await debtOf(customerId), "qarz to'liq yopildi").toBe(0);
    await expectBalanced("to'lovlar");
  });

  it("PHASE 14 — buyurtmasiz tashrif: sabab bilan yakunlanadi va hisobotga tushadi", async () => {
    const customerId = dx.customers["DX-CUSTOMER-07"]!;
    const visitId = await startVisit(agent1, customerId);

    const noReason = await call(agent1.cookie, "POST", `/api/sales-agent/visits/${visitId}/complete`, {
      ...near(20),
      accuracy: 15,
      recordedAt: iso(),
    });
    expect(noReason.json().details, "sababsiz yopib bo'lmaydi").toMatchObject({ reason: "no_order_reason_required" });

    const done = await call(agent1.cookie, "POST", `/api/sales-agent/visits/${visitId}/complete`, {
      ...near(20),
      accuracy: 15,
      recordedAt: iso(),
      noOrderReason: "has_stock",
      notes: "Tovari bor",
    });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().visit).toMatchObject({ status: "completed", result: "no_order", noOrderReason: "has_stock" });

    const visits = (await call(agent1.cookie, "GET", `/api/sales-agent/visits?date=${today()}`)).json().visits as
      { result: string }[];
    expect(visits.some((row) => row.result === "no_order"), "buyurtmasiz tashrif hisobotda").toBe(true);
  });

  it("PHASE 15 — marshrut va agent hisobotlari baza bilan mos", async () => {
    const report = await call(agent1.cookie, "GET", `/api/sales-agent/reports?from=${today()}&to=${today()}`);
    expect(report.statusCode, report.body).toBe(200);

    const visitsApi = (await call(dx.managerCookie, "GET", `/api/distribution/visits?limit=100`)).json().visits as unknown[];
    expect(Array.isArray(visitsApi)).toBe(true);

    const [dbOrders] = await db
      .select({ total: sql<string>`coalesce(sum(${salesOrders.totalAmount}), 0)::numeric(18,2)`, count: sql<number>`count(*)::int` })
      .from(salesOrders)
      .where(and(eq(salesOrders.companyId, dx.companyId), sql`${salesOrders.status} in ('completed','shipped','delivered')`));
    const sales = (await call(dx.managerCookie, "GET", "/api/analytics/reports/sales?days=30")).json();
    expect(money(sales.totalRevenue), "sotuv hisoboti = baza").toBe(money(dbOrders!.total));
    expect(sales.totalOrders).toBe(dbOrders!.count);

    const deliveryReports = await call(dx.managerCookie, "GET", `/api/delivery/reports?from=${today()}&to=${today()}`);
    expect(deliveryReports.statusCode, deliveryReports.body).toBe(200);
  });

  it("PHASE 16 — buxgalteriya: jurnal va aylanma balans teng", async () => {
    await expectBalanced("yakuniy");
    const trial = await call(dx.accountantCookie, "GET", `/api/finance/reports/trial-balance?dateFrom=2000-01-01&dateTo=${today()}`);
    expect(trial.statusCode, trial.body).toBe(200);
    const rows = trial.json().rows as { debit: string; credit: string }[];
    expect(rows.length).toBeGreaterThan(0);
    const debit = rows.reduce((sum, row) => sum + money(row.debit), 0);
    const credit = rows.reduce((sum, row) => sum + money(row.credit), 0);
    expect(Math.round(debit)).toBe(Math.round(credit));
  });

  it("PHASE 17 — xavfsizlik: agentlar, yetkazuvchi va tenantlar bir-biriga kira olmaydi", async () => {
    // Agent-2 agent-1 do'koniga buyurtma yoza olmaydi
    const foreignDraft = await call(agent2.cookie, "PUT", `/api/sales-agent/orders/drafts/${randomUUID()}`, {
      customerId: dx.customers["DX-CUSTOMER-01"]!,
      paymentType: "credit",
      items: [{ productId: dx.products["DX-01"]!, pieces: "10" }],
    });
    expect(foreignDraft.statusCode, "begona do'konga buyurtma yo'q").toBeGreaterThanOrEqual(400);

    // Agent boshqa agentning marshrutini o'zgartira olmaydi
    const routePatch = await call(agent2.cookie, "PATCH", `/api/distribution/routes/${dx.routes["Urganch-01"]}`, { name: "Buzildi" });
    expect(routePatch.statusCode).toBe(403);

    // Begona tenant mijoziga buyurtma — rad etiladi
    const foreignCustomer = await call(dx.managerCookie, "POST", "/api/sales/orders", {
      customerId: outsider.customerId,
      warehouseId: dx.warehouseId,
      orderDate: today(),
      items: [{ productId: dx.products["DX-01"]!, quantity: "1" }],
    });
    expect(foreignCustomer.statusCode).toBeGreaterThanOrEqual(400);

    // Tanadagi companyId — sxema rad etadi
    const spoof = await call(dx.ownerCookie, "POST", "/api/sales/customers", { name: "Spoof", companyId: outsider.companyId });
    expect(spoof.statusCode).toBe(400);

    // Begona tenant distributor ma'lumotini ko'rmaydi
    expect((await call(outsider.ownerCookie, "GET", "/api/distribution/routes")).json().routes).toHaveLength(0);
    expect((await call(outsider.ownerCookie, "GET", "/api/sales/customers")).json().customers).toHaveLength(1);

    // Yetkazuvchi boshqa kompaniya yetkazmasini ko'rmaydi
    const courierTasks = (await call(courier.cookie, "GET", "/api/delivery/agent/tasks?scope=today")).json().tasks as
      { companyId?: string }[];
    expect(Array.isArray(courierTasks)).toBe(true);

    // Agent moliyaviy ma'lumotga kira olmaydi
    expect((await call(agent1.cookie, "GET", "/api/finance/expenses")).statusCode).toBe(403);
    expect((await call(agent1.cookie, "GET", "/api/company/employees")).statusCode).toBe(403);
  });

  it("PHASE 18 — to'liq ish kuni: buyurtmadan yetkazish va to'lovgacha bir zanjirda", async () => {
    const customerId = dx.customers["DX-CUSTOMER-08"]!;

    // 1) Agent tashrifi va buyurtma (buyurtma tashrifni yopadi)
    const { visitId, orderId } = await visitAndOrder(agent1, customerId, [{ productId: dx.products["DX-02"]!, pieces: "60" }]);
    const [dayVisit] = await db.select().from(agentVisits).where(eq(agentVisits.id, visitId));
    expect(dayVisit).toMatchObject({ status: "completed", result: "ordered" });

    // 2) Ombor jo'natishi
    const before = await stockRow(dx.products["DX-02"]!);
    const shipped = await call(dx.managerCookie, "POST", `/api/sales/orders/${orderId}/ship`);
    expect(shipped.statusCode, shipped.body).toBe(200);
    const after = await stockRow(dx.products["DX-02"]!);
    expect(after.quantity).toBe(before.quantity - 60);

    // 3) Qarz va to'lov
    const debt = await debtOf(customerId);
    expect(debt).toBeGreaterThan(0);
    const payment = await call(dx.accountantCookie, "POST", "/api/sales/payments", {
      customerId,
      amount: String(debt),
      method: "cash",
      cashAccountId: dx.cashAccountId,
      paymentDate: today(),
    });
    expect(payment.statusCode, payment.body).toBe(201);
    expect(await debtOf(customerId)).toBe(0);

    // 4) Kun yakuni: hisobotlar va buxgalteriya
    const [dbToday] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(salesOrders)
      .where(and(eq(salesOrders.companyId, dx.companyId), eq(salesOrders.orderDate, today())));
    expect(dbToday!.count).toBeGreaterThan(0);

    const dashboard = await call(dx.managerCookie, "GET", "/api/delivery/dashboard");
    expect(dashboard.statusCode, dashboard.body).toBe(200);
    await expectBalanced("ish kuni");
  });
});
