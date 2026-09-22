/**
 * Kelishilgan narx (mijoz × mahsulot × birlik) va narx birligi: bir xil biznes konteksti uchun
 * ERP, kassa va savdo agenti BIR XIL narx qaytaradi.
 *
 * Narx hal qilish markazi bitta — `prepareSalesItems`. Bu test uchala kanaldan o'tib, natijani
 * solishtiradi: parallel narx motori paydo bo'lsa test darhol qulaydi.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { cashAccounts } from "../src/db/schema/finance.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { salesOrderItems } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { todayIso } from "../src/modules/finance/cash.service.js";
import { buildServer } from "../src/server.js";
import { setAgentPolicy } from "./agent-policy.js";
import { addEmployee, createCompany, resetDatabase, salesRepOf, signedIn, uniquePhone } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PUT" | "DELETE";

let app: FastifyInstance;
let company: Company;
let other: Company;
let piece: string;
let box: string;
let productId: string;
let secondProductId: string;
let warehouseId: string;
let cashAccountId: string;
let customerA: string;
let customerB: string;
let foreignCustomer: string;

const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

const money = (value: string | number | null | undefined) => Number(value ?? 0);
const shift = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const near = { latitude: 41.3115, longitude: 69.2406, accuracy: 10 };
const shop = { latitude: 41.311081, longitude: 69.240562 };
const iso = () => new Date().toISOString();

const setPrice = (payload: object) => call(company.ownerCookie, "POST", "/api/sales/customer-prices", payload);

/** ERP buyurtmasi: server hisoblagan qator narxi. */
async function erpPrice(customerId: string, quantity: string, unitId = piece, product = productId) {
  const created = await call(company.ownerCookie, "POST", "/api/sales/orders", {
    customerId,
    warehouseId,
    orderDate: todayIso(),
    items: [{ productId: product, unitId, quantity }],
  });
  expect(created.statusCode, created.body).toBe(201);
  const orderId = created.json().order.id as string;
  const [line] = await db
    .select({ unitPrice: salesOrderItems.unitPrice, discountPercent: salesOrderItems.discountPercent, lineTotal: salesOrderItems.lineTotal })
    .from(salesOrderItems)
    .where(eq(salesOrderItems.orderId, orderId));
  return { orderId, ...line! };
}

/** Kassa cheki: server hisoblagan qator narxi. */
async function posPrice(customerId: string | null, quantity: string) {
  const shiftRes = await call(company.ownerCookie, "POST", "/api/sales/pos/shifts", { warehouseId, openingCash: "0" });
  const shiftId = shiftRes.statusCode === 201 ? shiftRes.json().shift.id : (await call(company.ownerCookie, "GET", `/api/sales/pos/shifts/open?warehouseId=${warehouseId}`)).json().shift.id;
  const sale = await call(company.ownerCookie, "POST", "/api/sales/pos/sales", {
    shiftId,
    ...(customerId ? { customerId } : {}),
    items: [{ productId, quantity }],
    paymentMethod: "cash",
    amountPaid: "100000000",
  });
  expect(sale.statusCode, sale.body).toBe(201);
  const [line] = await db
    .select({ unitPrice: salesOrderItems.unitPrice, discountPercent: salesOrderItems.discountPercent, lineTotal: salesOrderItems.lineTotal })
    .from(salesOrderItems)
    .where(eq(salesOrderItems.orderId, sale.json().order.id));
  return line!;
}

/** Agent buyurtmasi: server hisoblagan qator narxi (agent narx yubormaydi). */
async function agentPrice(agent: { cookie: string }, customerId: string, pieces: string) {
  const visit = await call(agent.cookie, "POST", "/api/sales-agent/visits/start", { customerId, ...near, recordedAt: iso() });
  expect(visit.statusCode, visit.body).toBe(201);
  const draft = await call(agent.cookie, "PUT", `/api/sales-agent/orders/drafts/${randomUUID()}`, {
    customerId,
    paymentType: "cash",
    items: [{ productId, pieces }],
  });
  expect(draft.statusCode, draft.body).toBe(200);
  const orderId = draft.json().order.id as string;
  const sent = await call(agent.cookie, "POST", `/api/sales-agent/orders/${orderId}/submit`, { ...near, recordedAt: iso() });
  expect(sent.statusCode, sent.body).toBe(200);
  const [line] = await db
    .select({ unitPrice: salesOrderItems.unitPrice, discountPercent: salesOrderItems.discountPercent, lineTotal: salesOrderItems.lineTotal })
    .from(salesOrderItems)
    .where(eq(salesOrderItems.orderId, orderId));
  return line!;
}

async function makeAgent(customerIds: string[]) {
  const employee = await addEmployee(app, company, "Sotuv agenti");
  const repId = await salesRepOf(app, company.ownerCookie, employee.id, { name: `Agent-${randomUUID().slice(0, 6)}` });
  expect((await call(employee.cookie, "POST", "/api/sales-agent/work-session/start", { ...near, recordedAt: iso() })).statusCode).toBe(201);
  const routeId = (
    await call(company.ownerCookie, "POST", "/api/distribution/routes", { name: `R-${randomUUID().slice(0, 6)}`, salesRepId: repId, days: [0, 1, 2, 3, 4, 5, 6] })
  ).json().route.id as string;
  for (const customerId of customerIds) {
    expect((await call(company.ownerCookie, "POST", `/api/distribution/routes/${routeId}/customers`, { customerId })).statusCode).toBe(201);
  }
  return { cookie: employee.cookie, repId };
}

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app.close();
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
  await db.delete(units);
  await seedDefaultUnits(db);
  piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  box = (await db.select().from(units).where(eq(units.shortName, "bl")))[0]!.id;

  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "PRICING-CO" });
  other = await createCompany(app, admin.cookie, { name: "PRICING-OUTSIDER" });
  await setAgentPolicy(company.companyId, { minVisitMinutes: 0, storefrontPhotoRequired: false, shelfPhotoRequired: false });

  warehouseId = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  expect((await call(company.ownerCookie, "POST", "/api/finance/setup")).statusCode).toBe(200);
  cashAccountId = (await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId))).find((row) => row.type === "cash")!.id;

  productId = (
    await call(company.ownerCookie, "POST", "/api/catalog/products", { name: "Cola 1L", sku: "COLA", baseUnitId: piece, salesPrice: "10000", taxRate: "0" })
  ).json().product.id;
  secondProductId = (
    await call(company.ownerCookie, "POST", "/api/catalog/products", { name: "Fanta 1L", sku: "FANTA", baseUnitId: piece, salesPrice: "9000", taxRate: "0" })
  ).json().product.id;
  // dona ↔ blok: 1 blok = 10 dona
  expect([200, 201]).toContain(
    (await call(company.ownerCookie, "POST", "/api/catalog/unit-conversions", { productId, fromUnitId: box, toUnitId: piece, factor: "10" })).statusCode,
  );

  for (const id of [productId, secondProductId]) {
    expect(
      (await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", { type: "receive", productId: id, warehouseId, quantity: "10000", costPrice: "6000" }))
        .statusCode,
    ).toBe(201);
  }

  customerA = (await call(company.ownerCookie, "POST", "/api/sales/customers", { name: "Mijoz A", phone: uniquePhone("95"), ...shop })).json().customer.id;
  customerB = (await call(company.ownerCookie, "POST", "/api/sales/customers", { name: "Mijoz B", phone: uniquePhone("95"), ...shop })).json().customer.id;
  foreignCustomer = (await call(other.ownerCookie, "POST", "/api/sales/customers", { name: "Begona", phone: uniquePhone("96") })).json().customer.id;
});

describe("Kelishilgan narx va kanallar birligi", () => {
  it("A. prays-list narxi — kelishuv yo'q", async () => {
    expect((await erpPrice(customerA, "5")).unitPrice).toBe("10000.0000");
    expect((await posPrice(customerA, "5")).unitPrice).toBe("10000.0000");
  });

  it("B. mijoz chegirmasi prays-list ustiga qo'llanadi", async () => {
    expect(
      (await call(company.ownerCookie, "PATCH" as Method, `/api/sales/customers/${customerA}`, { discountPercent: "10" })).statusCode,
    ).toBe(200);
    const line = await erpPrice(customerA, "2");
    expect(line.unitPrice, "narx prays-listdan").toBe("10000.0000");
    expect(line.discountPercent, "chegirma mijozdan").toBe("10.00");
    expect(money(line.lineTotal)).toBe(18_000);
  });

  it("C. kelishilgan narx prays-listdan ustun va faqat o'sha mijozga tegishli", async () => {
    expect((await setPrice({ customerId: customerA, productId, unitId: piece, price: "8500" })).statusCode).toBe(201);

    expect((await erpPrice(customerA, "3")).unitPrice, "A uchun kelishilgan").toBe("8500.0000");
    expect((await erpPrice(customerB, "3")).unitPrice, "B uchun prays-list").toBe("10000.0000");
    expect((await erpPrice(customerA, "3", piece, secondProductId)).unitPrice, "boshqa mahsulot — prays-list").toBe("9000.0000");

    // Mahsulot kartochkasi o'zgarmaydi
    expect((await call(company.ownerCookie, "GET", `/api/catalog/products/${productId}`)).json().product.salesPrice).toBe("10000.0000");
  });

  it("D. birlik bo'yicha: dona va blok uchun alohida kelishilgan narx", async () => {
    expect((await setPrice({ customerId: customerA, productId, unitId: piece, price: "8500" })).statusCode).toBe(201);
    expect((await setPrice({ customerId: customerA, productId, unitId: box, price: "80000" })).statusCode).toBe(201);

    expect((await erpPrice(customerA, "3", piece)).unitPrice, "dona").toBe("8500.0000");
    const boxLine = await erpPrice(customerA, "2", box);
    expect(boxLine.unitPrice, "blok — konversiya bilan emas, kelishilgan narx").toBe("80000.0000");
    expect(money(boxLine.lineTotal)).toBe(160_000);

    // Blokka kelishuv yo'q bo'lsa — konversiya bilan prays-listdan
    expect((await erpPrice(customerB, "2", box)).unitPrice).toBe("100000.0000");
  });

  it("E. amal muddati: kelajakdagi narx bugun qo'llanmaydi, tugaganidan keyin prays-listga qaytadi", async () => {
    // Kelajakda boshlanadi
    expect((await setPrice({ customerId: customerA, productId, unitId: piece, price: "7000", effectiveFrom: shift(5) })).statusCode).toBe(201);
    expect((await erpPrice(customerA, "1")).unitPrice, "hali boshlanmagan").toBe("10000.0000");

    // Kecha tugagan
    expect(
      (await setPrice({ customerId: customerB, productId, unitId: piece, price: "7500", effectiveFrom: shift(-10), effectiveTo: shift(-1) })).statusCode,
    ).toBe(201);
    expect((await erpPrice(customerB, "1")).unitPrice, "muddati tugagan").toBe("10000.0000");

    // Bugun amalda
    expect((await setPrice({ customerId: customerB, productId, unitId: piece, price: "7200", effectiveFrom: todayIso() })).statusCode).toBe(201);
    expect((await erpPrice(customerB, "1")).unitPrice).toBe("7200.0000");
  });

  it("F. yangi narx eskisini yopadi — tarix saqlanadi", async () => {
    expect((await setPrice({ customerId: customerA, productId, unitId: piece, price: "8500", effectiveFrom: shift(-10) })).statusCode).toBe(201);
    expect((await setPrice({ customerId: customerA, productId, unitId: piece, price: "8000", effectiveFrom: todayIso() })).statusCode).toBe(201);

    const all = (await call(company.ownerCookie, "GET", `/api/sales/customer-prices?customerId=${customerA}`)).json().prices as
      { price: string; effectiveFrom: string; effectiveTo: string | null }[];
    expect(all, "eski narx o'chirilmaydi").toHaveLength(2);
    const closed = all.find((row) => row.price === "8500.0000")!;
    expect(closed.effectiveTo, "eskisi yopildi").toBe(shift(-1));
    expect((await erpPrice(customerA, "1")).unitPrice).toBe("8000.0000");

    // Bekor qilish — qator qoladi, narx amaldan chiqadi
    const active = all.find((row) => row.price === "8000.0000") as { price: string } & { id?: string };
    const activeId = ((await call(company.ownerCookie, "GET", `/api/sales/customer-prices?customerId=${customerA}&activeOnly=true`)).json().prices as { id: string }[])[0]!.id;
    expect(active).toBeTruthy();
    expect((await call(company.ownerCookie, "DELETE", `/api/sales/customer-prices/${activeId}`)).statusCode).toBe(200);
    expect((await call(company.ownerCookie, "GET", `/api/sales/customer-prices?customerId=${customerA}`)).json().prices, "tarix joyida").toHaveLength(2);
    expect((await erpPrice(customerA, "1")).unitPrice, "prays-listga qaytdi").toBe("10000.0000");
  });

  it("G. miqdor aksiyasi kelishilgan narx USTIGA chegirma bo'lib tushadi", async () => {
    expect((await setPrice({ customerId: customerA, productId, unitId: piece, price: "8000" })).statusCode).toBe(201);
    const promo = await call(company.ownerCookie, "POST", "/api/sales-agent/supervisor/promotions", {
      name: "10 dan 5%",
      type: "percent_discount",
      productId,
      minQuantity: "10",
      discountPercent: "5",
      startsAt: todayIso(),
      endsAt: shift(30),
    });
    expect(promo.statusCode, promo.body).toBe(201);

    const agent = await makeAgent([customerA]);
    const line = await agentPrice(agent, customerA, "10");
    expect(line.unitPrice, "narx — kelishilgan").toBe("8000.0000");
    expect(line.discountPercent, "aksiya chegirmasi").toBe("5.00");
    expect(money(line.lineTotal), "8000 × 10 − 5%").toBe(76_000);
  });

  it("H/I. bir xil kontekst — Agent = ERP = POS", async () => {
    expect((await setPrice({ customerId: customerA, productId, unitId: piece, price: "8750" })).statusCode).toBe(201);
    const agent = await makeAgent([customerA]);

    const fromErp = await erpPrice(customerA, "4");
    const fromPos = await posPrice(customerA, "4");
    const fromAgent = await agentPrice(agent, customerA, "4");

    expect(fromErp.unitPrice).toBe("8750.0000");
    expect(fromPos.unitPrice, "kassa = ERP").toBe(fromErp.unitPrice);
    expect(fromAgent.unitPrice, "agent = ERP").toBe(fromErp.unitPrice);
    expect([fromErp.lineTotal, fromPos.lineTotal, fromAgent.lineTotal], "yakuniy summa bir xil").toEqual([
      fromErp.lineTotal,
      fromErp.lineTotal,
      fromErp.lineTotal,
    ]);

    // Agent katalogi ham shu narxni ko'rsatadi — frontend narx hisoblamaydi
    const catalog = (await call(agent.cookie, "GET", `/api/sales-agent/catalog?customerId=${customerA}`)).json().products as
      { id: string; piecePrice: string; agreedPrice: boolean }[];
    const row = catalog.find((item) => item.id === productId)!;
    expect(row).toMatchObject({ piecePrice: "8750.0000", agreedPrice: true });

    // Mijozsiz katalog — prays-list
    const generic = (await call(agent.cookie, "GET", "/api/sales-agent/catalog")).json().products as { id: string; piecePrice: string }[];
    expect(generic.find((item) => item.id === productId)!.piecePrice).toBe("10000.0000");

    // Mijozsiz kassa cheki ham prays-list narxida
    expect((await posPrice(null, "1")).unitPrice).toBe("10000.0000");
  });

  it("xavfsizlik: tenant izolyatsiyasi, ruxsat va soxta narx", async () => {
    // Begona mijoz / mahsulotga narx yozib bo'lmaydi
    expect((await setPrice({ customerId: foreignCustomer, productId, unitId: piece, price: "1" })).statusCode).toBe(404);
    const foreignProduct = (
      await call(other.ownerCookie, "POST", "/api/catalog/products", { name: "Begona", sku: "X1", baseUnitId: piece, salesPrice: "1000", taxRate: "0" })
    ).json().product.id;
    expect((await setPrice({ customerId: customerA, productId: foreignProduct, unitId: piece, price: "1" })).statusCode).toBe(404);

    // Tanadagi companyId — strict sxema rad etadi
    expect((await setPrice({ customerId: customerA, productId, unitId: piece, price: "1", companyId: other.companyId })).statusCode).toBe(400);

    // Ruxsatsiz rol yoza olmaydi
    expect((await setPrice({ customerId: customerA, productId, unitId: piece, price: "8000" })).statusCode).toBe(201);
    const cashier = await addEmployee(app, company, "Kassir");
    expect((await call(cashier.cookie, "POST", "/api/sales/customer-prices", { customerId: customerA, productId, unitId: piece, price: "1" })).statusCode).toBe(403);

    // Begona tenant ro'yxatda ko'rmaydi
    expect((await call(other.ownerCookie, "GET", "/api/sales/customer-prices")).json().prices).toHaveLength(0);
    expect((await call(other.ownerCookie, "GET", `/api/sales/customer-prices?customerId=${customerA}`)).json().prices).toHaveLength(0);

    // Agent begona do'kon narxini so'ray olmaydi
    const agent = await makeAgent([customerA]);
    expect((await call(agent.cookie, "GET", `/api/sales-agent/catalog?customerId=${customerB}`)).statusCode, "marshrutda yo'q do'kon").toBe(404);
    expect((await call(agent.cookie, "GET", `/api/sales-agent/catalog?customerId=${foreignCustomer}`)).statusCode).toBe(404);

    // Kassir soxta narx yubora olmaydi (sales.edit yo'q) — server narxi kuchda
    const shiftId = (await call(cashier.cookie, "POST", "/api/sales/pos/shifts", { warehouseId, openingCash: "0" })).json().shift.id;
    const fake = await call(cashier.cookie, "POST", "/api/sales/pos/sales", {
      shiftId,
      customerId: customerA,
      items: [{ productId, quantity: "1", unitPrice: "1" }],
      paymentMethod: "cash",
      amountPaid: "1",
    });
    expect(fake.statusCode, "frontend narxi qabul qilinmaydi").toBe(403);
  });
});
