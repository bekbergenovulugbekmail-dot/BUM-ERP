/**
 * AUD-015 va AUD-014 (egasi qarori, 2026-09-28): ta'minotchi qarzi har valyutada alohida; valyutalararo jim o'zgarish yo'q.
 *
 * AUD-015: USD xarid qaytarilganda ta'minotchi qaytargan pul — USD da, USD kassaga, USD qoldig'iga. Kitob qiymati
 *   to'lovdagi kabi ulushda; kurs farqi 4200/5700 da alohida. UZS qoldig'iga yozilmaydi.
 * AUD-014: qarzni to'g'rilash — ko'rsatilgan valyuta qoldig'ida; valyutali qoldig'i bor ta'minotchida valyutasiz
 *   to'g'rilash rad etiladi (barcha valyutalar yig'indisi UZS ga yozilmaydi).
 */
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts, cashAccounts, journalEntries, journalLines } from "../src/db/schema/finance.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { supplierBalances, suppliers } from "../src/db/schema/purchase.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { todayIso } from "../src/modules/finance/cash.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let company: Awaited<ReturnType<typeof createCompany>>;
let piece: string;
let mainWh: string;
let productId: string;
let localProduct: string;

const call = (method: "GET" | "POST" | "PUT", url: string, payload?: object, cookie = company.ownerCookie) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

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
  company = await createCompany(app, admin.cookie, { name: "Valyuta" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  await setUsdRate("12500");
  productId = (await call("POST", "/api/catalog/products", { name: "Import", sku: "IMP", baseUnitId: piece })).json().product.id;
  localProduct = (await call("POST", "/api/catalog/products", { name: "Mahalliy", sku: "LOC", baseUnitId: piece })).json().product.id;
});

async function setUsdRate(rate: string) {
  const res = await call("PUT", "/api/finance/currencies", { cbuEnabled: false, currencies: [{ code: "USD", rate, source: "manual", isActive: true }] });
  expect(res.statusCode, res.body).toBe(200);
}
const ledger = async (code: string) =>
  (await db.select().from(accounts).where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code))))[0]?.balance ?? "0.00";
const balancesOf = async (supplierId: string) =>
  Object.fromEntries((await db.select().from(supplierBalances).where(eq(supplierBalances.supplierId, supplierId))).map((row) => [row.currency, [row.debt, row.bookValue]]));
const totalDebt = async (supplierId: string) => (await db.select().from(suppliers).where(eq(suppliers.id, supplierId)))[0]!.totalDebt;

async function expectBalanced() {
  const [row] = await db
    .select({
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)::numeric(18,2)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)::numeric(18,2)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalLines.companyId, company.companyId), eq(journalEntries.status, "posted")));
  expect(row!.debit, "Debit = Credit").toBe(row!.credit);
  const [sum] = await db.select({ total: sql<string>`coalesce(sum(${suppliers.totalDebt}), 0)::numeric(18,2)` }).from(suppliers).where(eq(suppliers.companyId, company.companyId));
  expect(await ledger("2000"), "2000 = ta'minotchilar qarzi (kitob)").toBe(sum!.total);
}

type Order = { id: string; items: { id: string }[] };
async function usdPurchase(supplierId: string, extraUzsLine = false): Promise<Order> {
  const created = await call("POST", "/api/purchase/orders", {
    supplierId,
    warehouseId: mainWh,
    orderDate: todayIso(),
    items: [
      { productId, unitId: piece, orderedQty: "10", unitPrice: "10", currency: "USD" },
      ...(extraUzsLine ? [{ productId: localProduct, unitId: piece, orderedQty: "2", unitPrice: "10000" }] : []),
    ],
  });
  expect(created.statusCode, created.body).toBe(201);
  const order = created.json().order as Order;
  expect((await call("POST", `/api/purchase/orders/${order.id}/confirm`)).statusCode).toBe(200);
  const received = await call("POST", `/api/purchase/orders/${order.id}/receipts`, { items: order.items.map((item, index) => ({ orderItemId: item.id, receivedQty: index === 0 ? "10" : "2" })) });
  expect(received.statusCode, received.body).toBe(201);
  return order;
}

describe("AUD-015 — valyutali xarid qaytarishida qaytgan pul o'z valyutasida", () => {
  it("USD xarid to'langan, keyin to'liq qaytarilib 100 $ qaytdi: USD kassa +100 $, USD qoldiq 0, UZS ga yozuv yo'q, kurs farqi alohida", async () => {
    const usdCash = await call("POST", "/api/finance/cash-accounts", { name: "Dollar kassa", type: "cash", currency: "USD", openingBalance: "100" });
    expect(usdCash.statusCode, usdCash.body).toBe(201);
    const usdCashId = usdCash.json().cashAccount.id as string;
    const supplierId = (await call("POST", "/api/purchase/suppliers", { name: "Import ta'minotchi", code: "IMP" })).json().supplier.id as string;
    const order = await usdPurchase(supplierId);
    expect(await balancesOf(supplierId)).toEqual({ USD: ["100.00", "1250000.00"] });
    const pay = await call("POST", "/api/purchase/payments", { supplierId, orderId: order.id, method: "cash", currency: "USD", amount: "100" });
    expect(pay.statusCode, pay.body).toBe(201);
    expect(await balancesOf(supplierId)).toEqual({ USD: ["0.00", "0.00"] });

    await setUsdRate("12600");
    const back = await call("POST", `/api/purchase/orders/${order.id}/returns`, { items: [{ orderItemId: order.items[0]!.id, quantity: "10" }], reason: "Brak", refund: { amount: "100", method: "cash" } });
    expect(back.statusCode, back.body).toBe(201);
    expect(back.json().return).toMatchObject({ totalAmount: "1250000.00", refundAmount: "100.00", cashAccountId: usdCashId });
    const balances = await balancesOf(supplierId);
    expect(balances.USD, "USD qoldiq yopildi").toEqual(["0.00", "0.00"]);
    expect(balances.UZS ?? ["0.00", "0.00"], "UZS qoldig'iga yozilmadi").toEqual(["0.00", "0.00"]);
    expect(await totalDebt(supplierId)).toBe("0.00");
    const [cashRow] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, usdCashId));
    expect(cashRow!.balance, "USD kassaga 100 $").toBe("100.00");
    // 100 $ × 12 600 = 1 260 000 kassaga (kitob), kreditorlar kitobida 1 250 000 → 10 000 kurs farqi daromadi
    expect(await ledger("4200")).toBe("10000.00");
    expect(await ledger("2000")).toBe("0.00");
    await expectBalanced();
  });

  it("qaytgan pul qaytarilgan tovar qiymatidan (valyutada) oshmaydi; aralash valyutali qaytarishda pul qaytarish rad", async () => {
    const supplierId = (await call("POST", "/api/purchase/suppliers", { name: "Aralash", code: "MIX" })).json().supplier.id as string;
    const order = await usdPurchase(supplierId, true);
    const over = await call("POST", `/api/purchase/orders/${order.id}/returns`, { items: [{ orderItemId: order.items[0]!.id, quantity: "5" }], refund: { amount: "60", method: "cash" } });
    expect(over.statusCode, "50 $ tovar — 60 $ qaytmaydi").toBe(400);
    const mixed = await call("POST", `/api/purchase/orders/${order.id}/returns`, {
      items: [{ orderItemId: order.items[0]!.id, quantity: "1" }, { orderItemId: order.items[1]!.id, quantity: "1" }],
      refund: { amount: "10", method: "cash" },
    });
    expect(mixed.statusCode, "USD va UZS qatorlari bitta pulga aralashmaydi").toBe(400);
    expect(await balancesOf(supplierId)).toEqual({ USD: ["100.00", "1250000.00"], UZS: ["20000.00", "20000.00"] });
    // Pulsiz aralash qaytarish — ruxsat: har valyuta o'z qoldig'idan
    const plain = await call("POST", `/api/purchase/orders/${order.id}/returns`, { items: [{ orderItemId: order.items[0]!.id, quantity: "1" }, { orderItemId: order.items[1]!.id, quantity: "1" }] });
    expect(plain.statusCode, plain.body).toBe(201);
    expect(await balancesOf(supplierId)).toEqual({ USD: ["90.00", "1125000.00"], UZS: ["10000.00", "10000.00"] });
    await expectBalanced();
  });
});

describe("AUD-014 — ta'minotchi qarzini to'g'rilash valyuta bo'yicha", () => {
  it("valyutali qoldig'i bor ta'minotchida valyutasiz to'g'rilash rad; UZS va USD alohida to'g'rilanadi", async () => {
    const supplierId = (await call("POST", "/api/purchase/suppliers", { name: "Ikki valyuta", code: "TWO" })).json().supplier.id as string;
    await usdPurchase(supplierId);
    expect(await totalDebt(supplierId)).toBe("1250000.00");

    const silent = await call("POST", `/api/purchase/suppliers/${supplierId}/set-debt`, { totalDebt: "500000", reason: "Boshlang'ich qoldiq" });
    expect(silent.statusCode, "valyutasiz — barcha valyutalar UZS ga aralashmaydi").toBe(400);
    expect(await balancesOf(supplierId)).toEqual({ USD: ["100.00", "1250000.00"] });

    const uzs = await call("POST", `/api/purchase/suppliers/${supplierId}/set-debt`, { currency: "UZS", totalDebt: "500000", reason: "Boshlang'ich qoldiq", counter: "equity" });
    expect(uzs.statusCode, uzs.body).toBe(200);
    expect(await balancesOf(supplierId)).toEqual({ USD: ["100.00", "1250000.00"], UZS: ["500000.00", "500000.00"] });
    expect(await totalDebt(supplierId)).toBe("1750000.00");

    await setUsdRate("12600");
    const usd = await call("POST", `/api/purchase/suppliers/${supplierId}/set-debt`, { currency: "USD", totalDebt: "80", reason: "Akt bo'yicha tuzatish" });
    expect(usd.statusCode, usd.body).toBe(200);
    // 20 $ kamaydi — kitob qiymatining ulushi (1 250 000 × 20/100 = 250 000), kurs farqi emas
    expect(await balancesOf(supplierId)).toEqual({ USD: ["80.00", "1000000.00"], UZS: ["500000.00", "500000.00"] });
    expect(await totalDebt(supplierId)).toBe("1500000.00");
    expect(await ledger("4100"), "tuzatish — boshqa daromad").toBe("250000.00");
    await expectBalanced();

    // USD ko'paytirish — joriy kursda: 80 → 90 $ = +10 × 12 600 = 126 000
    expect((await call("POST", `/api/purchase/suppliers/${supplierId}/set-debt`, { currency: "USD", totalDebt: "90", reason: "Qo'shimcha hujjat" })).statusCode).toBe(200);
    expect(await balancesOf(supplierId)).toMatchObject({ USD: ["90.00", "1126000.00"] });
    await expectBalanced();
  });

  it("faqat UZS qoldig'i bor ta'minotchi — avvalgidek valyutasiz to'g'rilanadi; RBAC", async () => {
    const supplierId = (await call("POST", "/api/purchase/suppliers", { name: "Mahalliy", code: "LOC" })).json().supplier.id as string;
    const res = await call("POST", `/api/purchase/suppliers/${supplierId}/set-debt`, { totalDebt: "300000", reason: "Boshlang'ich qoldiq", counter: "equity" });
    expect(res.statusCode, res.body).toBe(200);
    expect(await balancesOf(supplierId)).toEqual({ UZS: ["300000.00", "300000.00"] });
    const kassir = await addEmployee(app, company, "Kassir");
    expect((await call("POST", `/api/purchase/suppliers/${supplierId}/set-debt`, { currency: "UZS", totalDebt: "1", reason: "Urinish" }, kassir.cookie)).statusCode).toBe(403);
    await expectBalanced();
  });
});
