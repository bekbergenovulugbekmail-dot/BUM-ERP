/**
 * AUDIT AUD-005 — mijoz akti, istalgan sanadagi qarz, oyma-oy aylanma, qarz yoshi (topshiriqning 1-bo'limi).
 *
 * Hisobotlar faqat JURNAL subhisobidan (kontragent = mijoz) hisoblanadi. O'tgan oylarni sinash uchun jurnal
 * yozuvlarining sanasi to'g'ridan-to'g'ri o'zgartiriladi (API sotuvni bugungi sana bilan yozadi) — bu hisobot
 * mantiqini sinaydi: "yanvar: 0 + 1 000 000 − 300 000 = 700 000" va hokazo.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { journalEntries, journalLines } from "../src/db/schema/finance.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { customerPayments } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let piece: string;
let mainWh: string;

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
  await db.delete(units);
  await seedDefaultUnits(db);
  piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Akt kompaniyasi" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
});

const call = (method: "GET" | "POST", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie: company.ownerCookie }, ...(payload ? { payload } : {}) });

let productId = "";
async function setupProduct() {
  const created = await call("POST", "/api/catalog/products", { name: "Un", sku: "UN-1", baseUnitId: piece, salesPrice: "100000", taxRate: "0" });
  productId = created.json().product.id;
  await call("POST", "/api/inventory/stock/movements", { type: "receive", productId, warehouseId: mainWh, quantity: "100", costPrice: "50000" });
}

async function sale(customerId: string, quantity: string) {
  const created = await call("POST", "/api/sales/orders", {
    customerId, warehouseId: mainWh, orderDate: new Date().toISOString().slice(0, 10), items: [{ productId, quantity }],
  });
  const orderId = created.json().order.id as string;
  await call("POST", `/api/sales/orders/${orderId}/confirm`);
  expect((await call("POST", `/api/sales/orders/${orderId}/ship`)).statusCode).toBe(200);
  return { orderId, number: created.json().order.number as string };
}

async function pay(customerId: string, amount: string) {
  const res = await call("POST", "/api/sales/payments", { customerId, amount, method: "cash" });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().payment.id as string;
}

/** Hujjatning jurnal yozuvlarini (asl va teskari) o'sha sanaga ko'chiradi. */
async function dated(referenceId: string, date: string) {
  await db.update(journalEntries).set({ entryDate: date }).where(eq(journalEntries.referenceId, referenceId));
}

describe("Mijoz akti va tarixiy qarz", () => {
  it("oyma-oy: boshlang'ich + sotuv − to'lov = yakuniy; istalgan sanaga qarz; bekor qilingan to'lov tarixi", async () => {
    await setupProduct();
    const customerId = (await call("POST", "/api/sales/customers", { name: "Baraka Market" })).json().customer.id as string;

    const jan = await sale(customerId, "10"); // 1 000 000
    await dated(jan.orderId, "2026-01-10");
    await dated(await pay(customerId, "300000"), "2026-01-20");
    const feb = await sale(customerId, "5"); // 500 000
    await dated(feb.orderId, "2026-02-05");
    await dated(await pay(customerId, "400000"), "2026-02-25");
    const march = await pay(customerId, "200000");
    await dated(march, "2026-03-03");
    // Mart to'lovi xato edi — bekor qilindi (teskari yozuv 4-mart)
    expect((await call("POST", `/api/sales/payments/${march}/reverse`, { reason: "Xato kiritilgan" })).statusCode).toBe(200);
    await dated(march, "2026-03-03");
    await db.update(journalEntries).set({ entryDate: "2026-03-04" }).where(and(eq(journalEntries.referenceId, march), eq(journalEntries.referenceType, "customer_payment_reversal")));

    // ── Akt: 2026-01-01 … 2026-03-31
    const statement = (await call("GET", `/api/sales/customers/${customerId}/statement?from=2026-01-01&to=2026-03-31`)).json();
    expect(statement.opening).toEqual({ debt: "0.00", wallet: "0.00" });
    expect(statement.closing.debt).toBe("800000.00");
    expect(statement.totals).toEqual({ debit: "1700000.00", credit: "900000.00" });
    expect(statement.months).toEqual([
      { month: "2026-01", opening: "0.00", debit: "1000000.00", credit: "300000.00", closing: "700000.00" },
      { month: "2026-02", opening: "700000.00", debit: "500000.00", credit: "400000.00", closing: "800000.00" },
      { month: "2026-03", opening: "800000.00", debit: "200000.00", credit: "200000.00", closing: "800000.00" },
    ]);
    // Har qator: sana, turi, hujjat, summa, qoldiq, kim kiritgan
    expect(statement.lines.map((line: { date: string; kind: string; debit: string; credit: string; balance: string }) =>
      [line.date, line.kind, line.debit, line.credit, line.balance])).toEqual([
      ["2026-01-10", "sale", "1000000.00", "0.00", "1000000.00"],
      ["2026-01-20", "payment", "0.00", "300000.00", "700000.00"],
      ["2026-02-05", "sale", "500000.00", "0.00", "1200000.00"],
      ["2026-02-25", "payment", "0.00", "400000.00", "800000.00"],
      ["2026-03-03", "payment", "0.00", "200000.00", "600000.00"],
      ["2026-03-04", "payment_reversal", "200000.00", "0.00", "800000.00"],
    ]);
    expect(statement.lines[0].document).toMatchObject({ type: "sales_order", number: jan.number });
    expect(statement.lines[4].document).toMatchObject({ type: "customer_payment", status: "reversed" });
    expect(statement.lines[0].createdBy).toBeTruthy();
    expect(statement.reconciliation).toMatchObject({ ledgerDebt: "800000.00", cachedDebt: "800000.00", ok: true });

    // ── FROM → TO: fevraldan — boshlang'ich qoldiq yanvar oxiridagi qarz
    const fromFeb = (await call("GET", `/api/sales/customers/${customerId}/statement?from=2026-02-01&to=2026-02-28`)).json();
    expect(fromFeb.opening.debt).toBe("700000.00");
    expect(fromFeb.closing.debt).toBe("800000.00");
    expect(fromFeb.lines).toHaveLength(2);

    // ── Istalgan sanaga (hamma mijozlar)
    const asOf = async (date: string) => (await call("GET", `/api/sales/receivables/as-of?date=${date}`)).json();
    expect((await asOf("2026-01-15")).customers[0]).toMatchObject({ customerId, debt: "1000000.00" });
    expect((await asOf("2026-01-31")).customers[0]).toMatchObject({ debt: "700000.00" });
    expect((await asOf("2026-03-03")).customers[0]).toMatchObject({ debt: "600000.00" });
    expect((await asOf("2026-03-31")).customers[0]).toMatchObject({ debt: "800000.00" });
    const today = await asOf(new Date().toISOString().slice(0, 10));
    expect(today.ledger).toMatchObject({ account1100: "800000.00", unassigned: "0.00" });

    // ── Oyma-oy tarix: "qaysi oygacha qarzdor bo'lgan"
    const history = (await call("GET", "/api/sales/receivables/history?from=2025-12-01&to=2026-03-31")).json();
    expect(history.months).toEqual(["2025-12", "2026-01", "2026-02", "2026-03"]);
    expect(history.customers[0]).toMatchObject({
      customerId,
      opening: "0.00",
      months: [
        { month: "2025-12", closing: "0.00" },
        { month: "2026-01", closing: "700000.00" },
        { month: "2026-02", closing: "800000.00" },
        { month: "2026-03", closing: "800000.00" },
      ],
      lastInDebt: "2026-03",
    });

    // ── Qarz yoshi (bugungi ochiq hujjatlar): jami = jurnaldagi qarz
    const aging = statement.aging;
    const documented = aging.documents.reduce((sum: number, doc: { outstanding: string }) => sum + Number(doc.outstanding), 0);
    expect(documented).toBe(800000);
    expect(aging.undocumented).toBe("0.00");
    expect(Object.keys(aging.buckets)).toEqual(["not_due", "d0_7", "d8_30", "d31_60", "d61_90", "d90_plus"]);
  });

  it("qarz tuzatish akt'da ko'rinadi va hujjatsiz qarz alohida chiqadi; kesh bilan solishtiruv", async () => {
    await setupProduct();
    const customerId = (await call("POST", "/api/sales/customers", { name: "Eski mijoz" })).json().customer.id as string;
    await sale(customerId, "1"); // 100 000
    const adjust = await call("POST", `/api/sales/customers/${customerId}/balance-adjust`, { totalDebt: "150000", reason: "Eski daftar qarzi" });
    expect(adjust.statusCode, adjust.body).toBe(200);

    const statement = (await call("GET", `/api/sales/customers/${customerId}/statement`)).json();
    expect(statement.lines.map((line: { kind: string }) => line.kind)).toEqual(["sale", "adjustment"]);
    expect(statement.closing.debt).toBe("150000.00");
    expect(statement.aging.undocumented).toBe("50000.00");
    expect(statement.reconciliation.ok).toBe(true);
    const recon = await call("GET", "/api/sales/receivables/reconciliation");
    expect(recon.statusCode, recon.body).toBe(200);
    expect(recon.json().mismatches).toEqual([]);
  });

  it("migratsiya backfill'i: kontragentsiz eski qatorlar mijozga to'g'ri bog'lanadi", async () => {
    await setupProduct();
    const customerId = (await call("POST", "/api/sales/customers", { name: "Eski yozuvlar" })).json().customer.id as string;
    const { orderId } = await sale(customerId, "3");
    const paymentId = await pay(customerId, "120000");
    const before = (await call("GET", `/api/sales/customers/${customerId}/statement`)).json();
    expect(before.closing.debt).toBe("180000.00");

    // 0087 dan oldingi holat: qatorlarda kontragent yo'q
    const entryIds = (await db.select({ id: journalEntries.id }).from(journalEntries).where(inArray(journalEntries.referenceId, [orderId, paymentId]))).map((row) => row.id);
    await db.update(journalLines).set({ partyType: null, partyId: null }).where(inArray(journalLines.entryId, entryIds));
    expect((await call("GET", `/api/sales/customers/${customerId}/statement`)).json().closing.debt).toBe("0.00");

    // Migratsiyadagi backfill SQL'ining o'zi
    const migration = readFileSync(resolve(import.meta.dirname, "../src/db/migrations/0087_finance_party_reversal.sql"), "utf8");
    for (const statement of migration.split("--> statement-breakpoint").filter((part) => part.includes('UPDATE "journal_lines"'))) {
      await db.execute(sql.raw(statement));
    }
    const after = (await call("GET", `/api/sales/customers/${customerId}/statement`)).json();
    expect(after.closing.debt).toBe("180000.00");
    expect(after.lines.map((line: { kind: string }) => line.kind)).toEqual(["sale", "payment"]);
    const [payment] = await db.select().from(customerPayments).where(eq(customerPayments.id, paymentId));
    expect(payment!.customerId).toBe(customerId);
  });
});
