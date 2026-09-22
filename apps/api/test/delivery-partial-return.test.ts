/**
 * NAKLADNOYDAN QISMAN QAYTARISH: dostavchi yetkazgan hujjatdan aynan kerakli mahsulot va miqdor
 * qaytariladi — butun nakladnoyni qaytarish shart emas.
 *
 * Bu yangi "RMA tizimi" emas: mavjud savdo qaytarish oqimi (`POST /orders/:id/return-items`)
 * qatorlar bo'yicha tekshiriladi — zaxira, qarz va buxgalteriya o'sha yagona yo'ldan o'tadi.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { cashAccounts, journalLines } from "../src/db/schema/finance.js";
import { stockLevels, warehouses } from "../src/db/schema/inventory.js";
import { customers, salesOrderItems, salesOrders } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { todayIso } from "../src/modules/finance/cash.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn, uniquePhone } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PATCH";

let app: FastifyInstance;
let company: Company;
let other: Company;
let piece: string;
let box: string;
let warehouseId: string;
let cashAccountId: string;
let customerId: string;
/** Nakladnoy tarkibi: Coca Cola 10, Pechenye 5, Shampun 3. */
let cola: string;
let pechenye: string;
let shampun: string;

const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

const money = (value: string | number | null | undefined) => Number(value ?? 0);

/** Qoldiq invarianti — har tekshiruvdan keyin. */
async function stockOf(productId: string) {
  const [row] = await db
    .select({ quantity: stockLevels.quantity, reserved: stockLevels.reservedQty })
    .from(stockLevels)
    .where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, warehouseId)));
  const quantity = money(row?.quantity);
  const reserved = money(row?.reserved);
  expect(quantity, "qoldiq manfiy").toBeGreaterThanOrEqual(0);
  expect(reserved, "reserved_qty > quantity").toBeLessThanOrEqual(quantity);
  return { quantity, reserved };
}

const debtOf = async (id: string) =>
  money((await db.select({ debt: customers.totalDebt }).from(customers).where(eq(customers.id, id)))[0]!.debt);

async function expectBalanced(label: string) {
  const [totals] = await db
    .select({
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)::numeric(18,2)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)::numeric(18,2)`,
    })
    .from(journalLines)
    .where(eq(journalLines.companyId, company.companyId));
  expect(totals!.debit, `${label}: debet ≠ kredit`).toBe(totals!.credit);
  const unbalanced = await db
    .select({ entryId: journalLines.entryId })
    .from(journalLines)
    .where(eq(journalLines.companyId, company.companyId))
    .groupBy(journalLines.entryId)
    .having(sql`sum(${journalLines.debit}) <> sum(${journalLines.credit})`);
  expect(unbalanced, `${label}: balanslanmagan yozuv`).toHaveLength(0);
}

const product = async (name: string, sku: string, salesPrice: string) =>
  (await call(company.ownerCookie, "POST", "/api/catalog/products", { name, sku, baseUnitId: piece, salesPrice, taxRate: "0" })).json().product.id as string;

const receive = (productId: string, quantity: string, costPrice: string) =>
  call(company.ownerCookie, "POST", "/api/inventory/stock/movements", { type: "receive", productId, warehouseId, quantity, costPrice });

/** Nakladnoy: yaratish → tasdiq → jo'natish (nasiya, tovar mijozda). */
async function waybill(lines: { productId: string; quantity: string; unitId?: string }[]) {
  const created = await call(company.ownerCookie, "POST", "/api/sales/orders", {
    customerId,
    warehouseId,
    orderDate: todayIso(),
    items: lines.map((line) => ({ productId: line.productId, quantity: line.quantity, ...(line.unitId ? { unitId: line.unitId } : {}) })),
  });
  expect(created.statusCode, created.body).toBe(201);
  const orderId = created.json().order.id as string;
  expect((await call(company.ownerCookie, "POST", `/api/sales/orders/${orderId}/confirm`)).statusCode).toBe(200);
  expect((await call(company.ownerCookie, "POST", `/api/sales/orders/${orderId}/ship`)).statusCode).toBe(200);
  return orderId;
}

const orderOf = async (orderId: string, cookie = company.ownerCookie) =>
  (await call(cookie, "GET", `/api/sales/orders/${orderId}`)).json().order;

/** Qator id'si mahsulot bo'yicha. */
async function itemIdOf(orderId: string, productId: string) {
  const [row] = await db
    .select({ id: salesOrderItems.id })
    .from(salesOrderItems)
    .where(and(eq(salesOrderItems.orderId, orderId), eq(salesOrderItems.productId, productId)));
  return row!.id;
}

const returnItems = (orderId: string, items: { orderItemId: string; quantity: string }[], extra: object = {}, cookie = company.ownerCookie) =>
  call(cookie, "POST", `/api/sales/orders/${orderId}/return-items`, { items, refundMethod: "cash", reason: "Mijoz qaytardi", ...extra });

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
  company = await createCompany(app, admin.cookie, { name: "NAKLADNOY-CO" });
  other = await createCompany(app, admin.cookie, { name: "NAKLADNOY-OUTSIDER" });

  warehouseId = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  expect((await call(company.ownerCookie, "POST", "/api/finance/setup")).statusCode).toBe(200);
  cashAccountId = (await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId))).find((row) => row.type === "cash")!.id;

  cola = await product("Coca Cola 1L", "COLA", "10000");
  pechenye = await product("Pechenye", "PECH", "6000");
  shampun = await product("Shampun", "SHAM", "30000");
  for (const [id, cost] of [[cola, "7000"], [pechenye, "4000"], [shampun, "20000"]] as const) {
    expect((await receive(id, "1000", cost)).statusCode).toBe(201);
  }

  customerId = (
    await call(company.ownerCookie, "POST", "/api/sales/customers", { name: "Do'kon", phone: uniquePhone("95"), creditLimit: "0", paymentTermDays: 10 })
  ).json().customer.id;
});

describe("Nakladnoydan qisman qaytarish", () => {
  it("uch mahsulotli nakladnoydan ikkitasidan qisman qaytariladi", async () => {
    const orderId = await waybill([
      { productId: cola, quantity: "10" },
      { productId: pechenye, quantity: "5" },
      { productId: shampun, quantity: "3" },
    ]);
    // 10×10000 + 5×6000 + 3×30000 = 220 000
    expect(money((await orderOf(orderId)).totalAmount)).toBe(220_000);
    expect(await debtOf(customerId)).toBe(220_000);
    const beforePech = await stockOf(pechenye);
    const beforeSham = await stockOf(shampun);
    const beforeCola = await stockOf(cola);

    // Dostavchi 2 Pechenye va 1 Shampunni qaytarib keldi — Coca Cola'ga tegilmaydi
    const returned = await returnItems(orderId, [
      { orderItemId: await itemIdOf(orderId, pechenye), quantity: "2" },
      { orderItemId: await itemIdOf(orderId, shampun), quantity: "1" },
    ]);
    expect(returned.statusCode, returned.body).toBe(201);
    expect(money(returned.json().return.totalAmount), "2×6000 + 1×30000").toBe(42_000);

    // Zaxira: faqat qaytgan miqdor omborga qaytdi
    expect((await stockOf(pechenye)).quantity).toBe(beforePech.quantity + 2);
    expect((await stockOf(shampun)).quantity).toBe(beforeSham.quantity + 1);
    expect((await stockOf(cola)).quantity, "tegilmagan mahsulot o'zgarmaydi").toBe(beforeCola.quantity);

    // Qarz shu qism uchun kamaydi
    expect(await debtOf(customerId)).toBe(220_000 - 42_000);

    // Hujjat qatorlarida qaytarilgan miqdor ko'rinadi
    const order = await orderOf(orderId);
    const line = (productId: string) => order.items.find((item: { productId: string }) => item.productId === productId);
    expect(line(pechenye).returnedQty).toBe("2.0000");
    expect(line(shampun).returnedQty).toBe("1.0000");
    expect(line(cola).returnedQty).toBe("0.0000");
    expect(order.status, "hujjat ochiq qoladi").toBe("completed");
    await expectBalanced("qisman qaytarish");
  });

  it("birinchi qaytarishdan keyin qolganini qaytarish mumkin, ortig'i rad etiladi", async () => {
    const orderId = await waybill([{ productId: pechenye, quantity: "5" }]);
    const itemId = await itemIdOf(orderId, pechenye);

    expect((await returnItems(orderId, [{ orderItemId: itemId, quantity: "2" }])).statusCode).toBe(201);

    // Endi maksimal 3 ta
    const tooMany = await returnItems(orderId, [{ orderItemId: itemId, quantity: "4" }]);
    expect(tooMany.statusCode, "qolganidan ko'p qaytarilmaydi").toBeGreaterThanOrEqual(400);
    expect(tooMany.json().message).toContain("qolgan");
    expect((await orderOf(orderId)).items[0].returnedQty, "rad etilgan so'rov hech narsa yozmaydi").toBe("2.0000");

    // Qolgan 3 ta — o'tadi va hujjat to'liq qaytarilgan bo'ladi
    expect((await returnItems(orderId, [{ orderItemId: itemId, quantity: "3" }])).statusCode).toBe(201);
    const order = await orderOf(orderId);
    expect(order.items[0].returnedQty).toBe("5.0000");
    expect(order.status, "hammasi qaytgach hujjat yopiladi").toBe("returned");
    expect(await debtOf(customerId)).toBe(0);
    await expectBalanced("to'liq qaytarish");
  });

  it("noto'g'ri miqdor: 0, manfiy va berilganidan ko'p", async () => {
    const orderId = await waybill([{ productId: pechenye, quantity: "5" }]);
    const itemId = await itemIdOf(orderId, pechenye);

    for (const quantity of ["0", "-1", "6"]) {
      const res = await returnItems(orderId, [{ orderItemId: itemId, quantity }]);
      expect(res.statusCode, `miqdor ${quantity} rad etilishi kerak`).toBeGreaterThanOrEqual(400);
    }
    expect((await orderOf(orderId)).items[0].returnedQty).toBe("0.0000");
    expect(await debtOf(customerId), "rad etilgan so'rovlar qarzni o'zgartirmaydi").toBe(30_000);
  });

  it("qator takrorlansa va begona qator bo'lsa rad etiladi", async () => {
    const orderId = await waybill([{ productId: cola, quantity: "10" }, { productId: pechenye, quantity: "5" }]);
    const itemId = await itemIdOf(orderId, cola);

    const duplicated = await returnItems(orderId, [
      { orderItemId: itemId, quantity: "1" },
      { orderItemId: itemId, quantity: "1" },
    ]);
    expect(duplicated.statusCode, "bir qator ikki marta").toBeGreaterThanOrEqual(400);

    // Boshqa nakladnoyning qatori
    const another = await waybill([{ productId: shampun, quantity: "3" }]);
    const foreignLine = await itemIdOf(another, shampun);
    const wrongOrder = await returnItems(orderId, [{ orderItemId: foreignLine, quantity: "1" }]);
    expect(wrongOrder.statusCode, "boshqa hujjat qatori").toBeGreaterThanOrEqual(400);
    expect((await orderOf(another)).items[0].returnedQty).toBe("0.0000");
  });

  it("blok birligidagi qator: qaytarish qator birligida hisoblanadi", async () => {
    expect(
      [200, 201].includes(
        (await call(company.ownerCookie, "POST", "/api/catalog/unit-conversions", { productId: cola, fromUnitId: box, toUnitId: piece, factor: "10" })).statusCode,
      ),
    ).toBe(true);

    const before = await stockOf(cola);
    const orderId = await waybill([{ productId: cola, quantity: "4", unitId: box }]); // 4 blok = 40 dona
    expect((await stockOf(cola)).quantity, "jo'natishda 40 dona chiqdi").toBe(before.quantity - 40);

    const itemId = await itemIdOf(orderId, cola);
    // 5 blok qaytarib bo'lmaydi (4 ta berilgan)
    expect((await returnItems(orderId, [{ orderItemId: itemId, quantity: "5" }])).statusCode).toBeGreaterThanOrEqual(400);

    // 1 blok qaytadi → omborga 10 dona
    expect((await returnItems(orderId, [{ orderItemId: itemId, quantity: "1" }])).statusCode).toBe(201);
    expect((await stockOf(cola)).quantity, "1 blok = 10 dona omborga").toBe(before.quantity - 30);
    expect((await orderOf(orderId)).items[0].returnedQty).toBe("1.0000");
    await expectBalanced("blok qaytarish");
  });

  it("to'langan nakladnoydan qaytarish: pul qaytadi, buxgalteriya mos", async () => {
    const orderId = await waybill([{ productId: shampun, quantity: "3" }]); // 90 000
    expect(
      (await call(company.ownerCookie, "POST", "/api/sales/payments", {
        orderId,
        amount: "90000",
        method: "cash",
        cashAccountId,
        paymentDate: todayIso(),
      })).statusCode,
    ).toBe(201);
    expect(await debtOf(customerId)).toBe(0);

    const itemId = await itemIdOf(orderId, shampun);
    const returned = await returnItems(orderId, [{ orderItemId: itemId, quantity: "1" }]);
    expect(returned.statusCode, returned.body).toBe(201);
    expect(money(returned.json().return.refundAmount), "bir dona uchun pul qaytdi").toBe(30_000);
    expect(await debtOf(customerId), "qarz paydo bo'lmaydi").toBe(0);

    const order = await orderOf(orderId);
    expect(money(order.paidAmount), "to'langan summa qaytarilgan qismga kamaydi").toBe(60_000);
    await expectBalanced("pul qaytarish");
  });

  it("qaytarish tarixi: kim, qachon, qaysi mahsulotdan qancha", async () => {
    const orderId = await waybill([{ productId: cola, quantity: "10" }, { productId: pechenye, quantity: "5" }]);
    expect((await returnItems(orderId, [{ orderItemId: await itemIdOf(orderId, pechenye), quantity: "2" }], { reason: "Sifat" })).statusCode).toBe(201);
    expect((await returnItems(orderId, [{ orderItemId: await itemIdOf(orderId, cola), quantity: "3" }], { reason: "Muddat" })).statusCode).toBe(201);

    const order = await orderOf(orderId);
    expect(order.returns, "ikki qaytarish hujjati").toHaveLength(2);
    expect(order.returns[0]).toMatchObject({ reason: "Sifat", createdByName: expect.any(String) });
    expect(order.returns[0].items).toHaveLength(1);
    expect(order.returns[0].items[0]).toMatchObject({ productName: "Pechenye", quantity: "2.0000" });
    expect(order.returns[1].items[0]).toMatchObject({ productName: "Coca Cola 1L", quantity: "3.0000" });
    expect(new Date(order.returns[0].createdAt).getTime()).toBeLessThanOrEqual(new Date(order.returns[1].createdAt).getTime());
  });

  it("takroriy so'rov zaxira va qarzga ikki marta ta'sir qilmaydi", async () => {
    const orderId = await waybill([{ productId: pechenye, quantity: "5" }]);
    const itemId = await itemIdOf(orderId, pechenye);
    const before = await stockOf(pechenye);

    const first = await returnItems(orderId, [{ orderItemId: itemId, quantity: "5" }]);
    expect(first.statusCode).toBe(201);
    const stockAfter = await stockOf(pechenye);
    const debtAfter = await debtOf(customerId);

    // Aynan shu so'rov qayta yuborildi — qolgan 0, shuning uchun rad etiladi
    const second = await returnItems(orderId, [{ orderItemId: itemId, quantity: "5" }]);
    expect(second.statusCode, "ikkinchi marta qaytarilmaydi").toBeGreaterThanOrEqual(400);
    expect(await stockOf(pechenye), "zaxira ikki marta oshmaydi").toEqual(stockAfter);
    expect(await debtOf(customerId), "qarz ikki marta kamaymaydi").toBe(debtAfter);
    expect(before.quantity + 5).toBe(stockAfter.quantity);
    await expectBalanced("takroriy so'rov");
  });

  it("jo'natilmagan (tasdiqlangan) nakladnoydan qaytarib bo'lmaydi", async () => {
    const created = await call(company.ownerCookie, "POST", "/api/sales/orders", {
      customerId,
      warehouseId,
      orderDate: todayIso(),
      items: [{ productId: cola, quantity: "5" }],
    });
    const orderId = created.json().order.id as string;
    expect((await call(company.ownerCookie, "POST", `/api/sales/orders/${orderId}/confirm`)).statusCode).toBe(200);

    const itemId = await itemIdOf(orderId, cola);
    const res = await returnItems(orderId, [{ orderItemId: itemId, quantity: "1" }]);
    expect(res.statusCode, "tovar hali berilmagan").toBeGreaterThanOrEqual(400);
  });

  it("xavfsizlik: tenant izolyatsiyasi, begona hujjat va ruxsat", async () => {
    const orderId = await waybill([{ productId: cola, quantity: "10" }]);
    const itemId = await itemIdOf(orderId, cola);

    // Begona tenant bu hujjatni ko'rmaydi va qaytara olmaydi
    expect((await call(other.ownerCookie, "GET", `/api/sales/orders/${orderId}`)).statusCode).toBe(404);
    const foreign = await returnItems(orderId, [{ orderItemId: itemId, quantity: "1" }], {}, other.ownerCookie);
    expect(foreign.statusCode, "begona tenant").toBe(404);

    // Mavjud bo'lmagan hujjat va qator
    expect((await returnItems(randomUUID(), [{ orderItemId: itemId, quantity: "1" }])).statusCode).toBe(404);
    expect((await returnItems(orderId, [{ orderItemId: randomUUID(), quantity: "1" }])).statusCode).toBeGreaterThanOrEqual(400);

    // Tanadagi companyId — strict sxema rad etadi
    expect((await returnItems(orderId, [{ orderItemId: itemId, quantity: "1" }], { companyId: other.companyId })).statusCode).toBe(400);

    // Ruxsatsiz rol (`sales.refund` yo'q)
    const warehouseUser = await addEmployee(app, company, "Omborchi");
    expect((await returnItems(orderId, [{ orderItemId: itemId, quantity: "1" }], {}, warehouseUser.cookie)).statusCode).toBe(403);

    expect((await orderOf(orderId)).items[0].returnedQty, "hech biri yozilmadi").toBe("0.0000");
    await expectBalanced("xavfsizlik");
  });

  it("qisman qaytarishdan keyin qarz, qoldiq va buxgalteriya solishtiruvi", async () => {
    const orderId = await waybill([
      { productId: cola, quantity: "10" },
      { productId: pechenye, quantity: "5" },
      { productId: shampun, quantity: "3" },
    ]);
    expect((await returnItems(orderId, [{ orderItemId: await itemIdOf(orderId, pechenye), quantity: "2" }])).statusCode).toBe(201);
    expect((await returnItems(orderId, [{ orderItemId: await itemIdOf(orderId, shampun), quantity: "1" }])).statusCode).toBe(201);

    // Qarz = sof summa (220 000 − 42 000), qarz yoshi hisoboti bilan bir xil
    const debt = await debtOf(customerId);
    expect(debt).toBe(178_000);
    const aging = (await call(company.ownerCookie, "GET", "/api/sales/receivables/aging")).json();
    expect(money(aging.totals.total), "qarz yoshi = mijoz qarzi").toBe(debt);
    expect(aging.items[0]).toMatchObject({ totalAmount: "220000.00", netAmount: "178000.00", remaining: "178000.00" });

    const stats = (await call(company.ownerCookie, "GET", "/api/sales/orders/stats")).json();
    expect(money(stats.totalDebt), "sotuv statistikasi ham mos").toBe(debt);

    // Qolgan qarzni to'lash hujjatni yopadi
    expect(
      (await call(company.ownerCookie, "POST", "/api/sales/payments", {
        customerId,
        amount: String(debt),
        method: "cash",
        cashAccountId,
        paymentDate: todayIso(),
      })).statusCode,
    ).toBe(201);
    expect(await debtOf(customerId)).toBe(0);
    expect((await call(company.ownerCookie, "GET", "/api/sales/receivables/aging")).json().items).toHaveLength(0);
    await expectBalanced("yakuniy solishtiruv");
  });

  it("dostavchi qaytarib olgan tovar ham shu yagona oqimdan o'tadi", async () => {
    const orderId = await waybill([{ productId: cola, quantity: "10" }]);
    const [row] = await db.select({ id: salesOrders.id }).from(salesOrders).where(eq(salesOrders.id, orderId));
    expect(row).toBeTruthy();

    // Dostavchi qaytarib olish ro'yxatida shu hujjat qatori ko'rinadi (qaytarish mumkin bo'lgan miqdor bilan)
    const itemId = await itemIdOf(orderId, cola);
    expect((await returnItems(orderId, [{ orderItemId: itemId, quantity: "4" }])).statusCode).toBe(201);

    // Qolgani 6 ta — dostavchi keyin yana olib kelsa shu yerdan davom etadi
    const order = await orderOf(orderId);
    expect(money(order.items[0].quantity) - money(order.items[0].returnedQty)).toBe(6);
    expect((await returnItems(orderId, [{ orderItemId: itemId, quantity: "7" }])).statusCode).toBeGreaterThanOrEqual(400);
    expect((await returnItems(orderId, [{ orderItemId: itemId, quantity: "6" }])).statusCode).toBe(201);
    expect((await orderOf(orderId)).status).toBe("returned");
    await expectBalanced("dostavchi qaytarishi");
  });
});
