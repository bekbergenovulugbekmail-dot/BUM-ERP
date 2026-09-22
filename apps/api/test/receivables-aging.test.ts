/**
 * Debitorlik: mijoz darajasidagi to'lov ochiq hujjatlarga taqsimlanadi va qarz yoshi (0–30 / 31–60 /
 * 61–90 / 90+) baza bilan aynan mos keladi.
 *
 * Asosiy invariant: `customers.total_debt` = ochiq hujjatlar qoldig'ining yig'indisi = qarz yoshi jami.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { cashAccounts, journalLines } from "../src/db/schema/finance.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { customerPayments, customers, salesOrderItems, salesOrders } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { todayIso } from "../src/modules/finance/cash.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn, uniquePhone } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PATCH";

let app: FastifyInstance;
let company: Company;
let other: Company;
let productId: string;
let warehouseId: string;
let cashAccountId: string;
let customerId: string;

const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

const money = (value: string | number | null | undefined) => Number(value ?? 0);
const shift = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const debtOf = async (id: string) =>
  (await db.select({ debt: customers.totalDebt }).from(customers).where(eq(customers.id, id)))[0]!.debt;

/** Ochiq qarz — hisobot bilan bir xil ta'rif: yakunlangan sotuvning to'lanmagan qoldig'i. */
async function openReceivables(id: string) {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${salesOrders.totalAmount} - ${salesOrders.paidAmount}), 0)::numeric(18,2)` })
    .from(salesOrders)
    .where(
      and(
        eq(salesOrders.customerId, id),
        sql`${salesOrders.status} in ('completed', 'shipped', 'delivered')`,
        sql`${salesOrders.totalAmount} > ${salesOrders.paidAmount}`,
      ),
    );
  return row!.total;
}

async function journalTotals(companyId: string) {
  const [row] = await db
    .select({
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)::numeric(18,2)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)::numeric(18,2)`,
    })
    .from(journalLines)
    .where(eq(journalLines.companyId, companyId));
  return row!;
}

/** Sotuv: yaratish → tasdiq → jo'natish. Qarz shundan keyin paydo bo'ladi. */
async function sellOnCredit(orderDate: string, quantity: string) {
  const created = await call(company.ownerCookie, "POST", "/api/sales/orders", {
    customerId,
    warehouseId,
    orderDate,
    items: [{ productId, quantity }],
  });
  expect(created.statusCode, created.body).toBe(201);
  const orderId = created.json().order.id as string;
  expect((await call(company.ownerCookie, "POST", `/api/sales/orders/${orderId}/confirm`)).statusCode).toBe(200);
  const shipped = await call(company.ownerCookie, "POST", `/api/sales/orders/${orderId}/ship`);
  expect(shipped.statusCode, shipped.body).toBe(200);
  return orderId;
}

const pay = (payload: object) => call(company.ownerCookie, "POST", "/api/sales/payments", { method: "cash", cashAccountId, paymentDate: todayIso(), ...payload });

const aging = async (query = "") => (await call(company.ownerCookie, "GET", `/api/sales/receivables/aging${query}`)).json();

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
  const piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "AGING-WHOLESALE" });
  other = await createCompany(app, admin.cookie, { name: "AGING-OUTSIDER" });

  warehouseId = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  expect((await call(company.ownerCookie, "POST", "/api/finance/setup")).statusCode).toBe(200);
  cashAccountId = (await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId))).find((row) => row.type === "cash")!.id;

  productId = (
    await call(company.ownerCookie, "POST", "/api/catalog/products", { name: "Un 50kg", sku: "UN50", baseUnitId: piece, salesPrice: "100000", taxRate: "0" })
  ).json().product.id;
  expect(
    (await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", {
      type: "receive",
      productId,
      warehouseId,
      quantity: "1000",
      costPrice: "70000",
    })).statusCode,
  ).toBe(201);

  // To'lov muddati 10 kun — muddat sanasi = hujjat sanasi + 10
  customerId = (
    await call(company.ownerCookie, "POST", "/api/sales/customers", {
      name: "ULGURJI MIJOZ",
      phone: uniquePhone("95"),
      creditLimit: "0",
      paymentTermDays: 10,
    })
  ).json().customer.id;
});

describe("Debitorlik: to'lov taqsimoti va qarz yoshi", () => {
  it("to'rt hujjat turli muddat bilan — har biri o'z yosh guruhiga tushadi", async () => {
    await sellOnCredit(shift(-120), "1"); // muddat 110 kun oldin → 90+
    await sellOnCredit(shift(-80), "2"); //  muddat 70 kun oldin  → 61–90
    await sellOnCredit(shift(-45), "3"); //  muddat 35 kun oldin  → 31–60
    await sellOnCredit(shift(-15), "4"); //  muddat 5 kun oldin   → 0–30
    await sellOnCredit(todayIso(), "5"); //  muddati kelmagan     → current

    const report = await aging();
    expect(report.totals).toMatchObject({
      d90_plus: "100000.00",
      d61_90: "200000.00",
      d31_60: "300000.00",
      d0_30: "400000.00",
      current: "500000.00",
      total: "1500000.00",
    });
    expect(report.totals.total, "yosh jami = ochiq hujjatlar").toBe(await openReceivables(customerId));
    expect(report.totals.total, "yosh jami = mijoz qarzi").toBe(await debtOf(customerId));
    expect(report.items).toHaveLength(5);
    expect(report.customers).toHaveLength(1);
    expect(report.customers[0]).toMatchObject({ customerId, maxDaysOverdue: 110 });

    const overdue = await aging("?overdueOnly=true");
    expect(overdue.items, "muddati o'tganlar").toHaveLength(4);
    expect(overdue.totals.total).toBe("1000000.00");
    expect((await aging("?bucket=d90_plus")).items).toHaveLength(1);
  });

  it("mijoz darajasidagi to'lov eng eski muddatdan boshlab taqsimlanadi", async () => {
    const oldest = await sellOnCredit(shift(-120), "1"); // 100 000
    const middle = await sellOnCredit(shift(-45), "3"); //  300 000
    const newest = await sellOnCredit(todayIso(), "5"); //  500 000

    // 250 000: eng eskisi to'liq (100 000), keyingisidan 150 000
    const payment = await pay({ customerId, amount: "250000" });
    expect(payment.statusCode, payment.body).toBe(201);

    const rows = await db.select({ id: salesOrders.id, paid: salesOrders.paidAmount }).from(salesOrders).where(eq(salesOrders.customerId, customerId));
    const paidOf = (id: string) => rows.find((row) => row.id === id)!.paid;
    expect(paidOf(oldest), "eng eski hujjat to'liq yopildi").toBe("100000.00");
    expect(paidOf(middle), "keyingisi qisman").toBe("150000.00");
    expect(paidOf(newest), "eng yangisiga tegilmaydi").toBe("0.00");

    const report = await aging();
    expect(report.totals.total).toBe("650000.00");
    expect(report.totals.total, "yosh jami = mijoz qarzi").toBe(await debtOf(customerId));
    expect(report.totals.d90_plus, "yopilgan hujjat yoshdan chiqdi").toBe("0.00");
    expect(report.items.map((row: { number: string }) => row.number), "yopilgan hujjat ro'yxatda yo'q").toHaveLength(2);
  });

  it("qisman va to'liq to'lov: qarz nolga tushganda ochiq hujjat qolmaydi", async () => {
    await sellOnCredit(shift(-30), "2"); // 200 000
    await sellOnCredit(shift(-5), "1"); //  100 000

    expect((await pay({ customerId, amount: "120000" })).statusCode).toBe(201);
    expect(money(await debtOf(customerId))).toBe(180_000);
    expect(await openReceivables(customerId)).toBe(await debtOf(customerId));

    expect((await pay({ customerId, amount: "180000" })).statusCode).toBe(201);
    expect(money(await debtOf(customerId)), "qarz to'liq yopildi").toBe(0);
    const report = await aging();
    expect(report.items, "ochiq hujjat qolmadi").toHaveLength(0);
    expect(report.totals.total).toBe("0.00");
  });

  it("takroriy to'lov (bir xil reference) ikki marta taqsimlanmaydi va ikkinchi jurnal yozmaydi", async () => {
    const orderId = await sellOnCredit(shift(-20), "3"); // 300 000
    const reference = `PAY-${randomUUID()}`;

    const first = await pay({ customerId, amount: "100000", reference });
    expect(first.statusCode).toBe(201);
    const afterFirst = await journalTotals(company.companyId);

    const second = await pay({ customerId, amount: "100000", reference });
    expect(second.statusCode, "takroriy so'rov mavjud to'lovni qaytaradi").toBe(200);
    expect(second.json().payment.id).toBe(first.json().payment.id);

    expect(money(await debtOf(customerId)), "qarz ikki marta kamaymaydi").toBe(200_000);
    const [order] = await db.select({ paid: salesOrders.paidAmount }).from(salesOrders).where(eq(salesOrders.id, orderId));
    expect(order!.paid, "hujjat ikki marta yopilmaydi").toBe("100000.00");
    expect(await journalTotals(company.companyId), "ikkinchi jurnal yozuvi yo'q").toEqual(afterFirst);
    expect(await db.$count(customerPayments, eq(customerPayments.reference, reference))).toBe(1);
  });

  it("buyurtmaga to'g'ridan-to'g'ri to'lov taqsimotni chetlab o'tmaydi", async () => {
    const oldest = await sellOnCredit(shift(-60), "1"); // 100 000
    const newest = await sellOnCredit(todayIso(), "2"); // 200 000

    // Ataylab yangi hujjatga to'laymiz — taqsimot buni bosib o'tmaydi
    expect((await pay({ orderId: newest, amount: "200000" })).statusCode).toBe(201);
    const rows = await db.select({ id: salesOrders.id, paid: salesOrders.paidAmount }).from(salesOrders).where(eq(salesOrders.customerId, customerId));
    expect(rows.find((row) => row.id === newest)!.paid).toBe("200000.00");
    expect(rows.find((row) => row.id === oldest)!.paid).toBe("0.00");
    expect(money(await debtOf(customerId))).toBe(100_000);
    expect(await openReceivables(customerId)).toBe(await debtOf(customerId));
  });

  it("buxgalteriya: taqsimot jurnalga tegmaydi, debet = kredit", async () => {
    await sellOnCredit(shift(-40), "2");
    await sellOnCredit(shift(-10), "3");
    expect((await pay({ customerId, amount: "350000" })).statusCode).toBe(201);

    const totals = await journalTotals(company.companyId);
    expect(totals.debit, "debet = kredit").toBe(totals.credit);
    const unbalanced = await db
      .select({ entryId: journalLines.entryId })
      .from(journalLines)
      .where(eq(journalLines.companyId, company.companyId))
      .groupBy(journalLines.entryId)
      .having(sql`sum(${journalLines.debit}) <> sum(${journalLines.credit})`);
    expect(unbalanced, "balanslanmagan yozuv yo'q").toHaveLength(0);
  });

  it("qisman qaytarish: qarz yoshi mijoz qarzi bilan mos qoladi", async () => {
    const orderId = await sellOnCredit(shift(-20), "3"); // 300 000, nasiya
    expect(money(await debtOf(customerId))).toBe(300_000);

    const [item] = await db.select({ id: salesOrderItems.id }).from(salesOrderItems).where(eq(salesOrderItems.orderId, orderId));
    const returned = await call(company.ownerCookie, "POST", `/api/sales/orders/${orderId}/return-items`, {
      items: [{ orderItemId: item!.id, quantity: "1" }],
      reason: "Sifat",
    });
    expect(returned.statusCode, returned.body).toBe(201);

    // Mijoz endi faqat qolgan 2 dona uchun qarzdor
    expect(money(await debtOf(customerId)), "qaytarish qarzni kamaytiradi").toBe(200_000);
    const report = await aging();
    expect(report.totals.total, "qarz yoshi = mijoz qarzi").toBe(await debtOf(customerId));
    expect(report.items[0]).toMatchObject({ totalAmount: "300000.00", netAmount: "200000.00", remaining: "200000.00" });

    // Qolganiga to'lov — hujjat yopiladi
    expect((await pay({ customerId, amount: "200000" })).statusCode).toBe(201);
    expect(money(await debtOf(customerId))).toBe(0);
    expect((await aging()).items, "hujjat yopildi").toHaveLength(0);

    const stats = (await call(company.ownerCookie, "GET", "/api/sales/orders/stats")).json();
    expect(stats.totalDebt, "sotuv statistikasi ham mos").toBe("0.00");
  });

  it("tenant izolyatsiyasi va ruxsat", async () => {
    await sellOnCredit(shift(-40), "2");

    const foreign = await call(other.ownerCookie, "GET", "/api/sales/receivables/aging");
    expect(foreign.statusCode).toBe(200);
    expect(foreign.json().items, "begona tenant qarzni ko'rmaydi").toHaveLength(0);

    const byForeignCustomer = await call(other.ownerCookie, "GET", `/api/sales/receivables/aging?customerId=${customerId}`);
    expect(byForeignCustomer.json().items, "begona mijoz id bo'yicha ham bo'sh").toHaveLength(0);

    const warehouseUser = await addEmployee(app, company, "Ombor menejeri");
    expect((await call(warehouseUser.cookie, "GET", "/api/sales/receivables/aging")).statusCode, "ruxsatsiz rol").toBe(403);

    expect((await call(company.ownerCookie, "GET", "/api/sales/receivables/aging?customerId=not-a-uuid")).statusCode).toBe(400);
  });
});
