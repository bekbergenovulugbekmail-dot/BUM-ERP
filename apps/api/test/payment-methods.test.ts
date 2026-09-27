/**
 * BOSHQARILADIGAN TO'LOV USULLARI (2026-09-27) — sozlama qatlami: usul mavjud terminal/hisobga havola, yangi pul hisobi
 * yaratilmaydi; usul → kassa ruxsati serverda; mijoz yuborgan terminal usulga zid bo'lsa — rad; to'lov qatorida usul ID'si.
 */
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts, cashAccounts } from "../src/db/schema/finance.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { customerPayments } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PATCH";

let app: FastifyInstance;
let company: Company;
let other: Company;
let mainWh: string;
let bank: string;
let productId: string;
let uzcardTerminal: string;
let humoTerminal: string;

const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const n = (value: string | null | undefined) => Number(value ?? 0);
async function balanceOf(id: string) {
  const [row] = await db.select({ balance: cashAccounts.balance }).from(cashAccounts).where(eq(cashAccounts.id, id));
  return n(row!.balance);
}
async function ledger(code: string) {
  const [row] = await db.select({ balance: accounts.balance }).from(accounts).where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code)));
  return n(row?.balance);
}
async function accountCount(companyId: string) {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(cashAccounts).where(eq(cashAccounts.companyId, companyId));
  return row!.n;
}

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
  const piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Bonnu Market" });
  other = await createCompany(app, admin.cookie, { name: "Begona" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  bank = (await db.select().from(cashAccounts).where(and(eq(cashAccounts.companyId, company.companyId), eq(cashAccounts.type, "bank"))))[0]!.id;
  const product = await call(company.ownerCookie, "POST", "/api/catalog/products", { name: "Non", sku: "NON", baseUnitId: piece, salesPrice: "5000" });
  productId = product.json().product.id;
  await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", { type: "receive", productId, warehouseId: mainWh, quantity: "1000", costPrice: "3000" });
  uzcardTerminal = (await call(company.ownerCookie, "POST", "/api/finance/terminals", { name: "UZCARD", network: "uzcard", cashAccountId: bank })).json().terminal.id;
  humoTerminal = (await call(company.ownerCookie, "POST", "/api/finance/terminals", { name: "HUMO", network: "humo", cashAccountId: bank })).json().terminal.id;
});

describe("To'lov usullari", () => {
  it("bootstrap — mavjud terminallardan havola, yangi hisob yaratilmaydi, takror chaqirish xavfsiz; sozlama tekshiruvlari", async () => {
    const before = await accountCount(company.companyId);
    const first = await call(company.ownerCookie, "POST", "/api/finance/payment-methods/bootstrap");
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().created.map((m: { name: string }) => m.name)).toEqual(["Naqd", "HUMO", "UZCARD"]);
    expect((await call(company.ownerCookie, "POST", "/api/finance/payment-methods/bootstrap")).json().created).toEqual([]);
    expect(await accountCount(company.companyId)).toBe(before);
    const list = (await call(company.ownerCookie, "GET", "/api/finance/payment-methods")).json().paymentMethods as { name: string; terminalId: string | null; kind: string }[];
    expect(list.find((m) => m.name === "UZCARD")).toMatchObject({ kind: "card", terminalId: uzcardTerminal });

    const create = (body: object) => call(company.ownerCookie, "POST", "/api/finance/payment-methods", body);
    expect((await create({ name: "Payme", kind: "bank", cashAccountId: bank })).statusCode).toBe(201);
    expect((await create({ name: "Payme", kind: "bank", cashAccountId: bank })).statusCode).toBe(409);
    expect((await create({ name: "Naqd 2", kind: "cash", cashAccountId: bank })).statusCode).toBe(400);
    expect((await create({ name: "X", kind: "bank", terminalId: uzcardTerminal })).statusCode).toBe(400);
    const cashAcc = (await db.select().from(cashAccounts).where(and(eq(cashAccounts.companyId, company.companyId), eq(cashAccounts.type, "cash"))))[0]!.id;
    expect((await create({ name: "Y", kind: "card", cashAccountId: cashAcc })).statusCode).toBe(400);
    // Begona kompaniya terminali/hisobi — topilmaydi
    const otherBank = (await db.select().from(cashAccounts).where(and(eq(cashAccounts.companyId, other.companyId), eq(cashAccounts.type, "bank"))))[0]!.id;
    expect((await create({ name: "Z", kind: "bank", cashAccountId: otherBank })).statusCode).toBe(404);
    // Kassir usul yarata olmaydi
    const kassir = await addEmployee(app, company);
    expect((await call(kassir.cookie, "POST", "/api/finance/payment-methods", { name: "Q", kind: "transfer" })).statusCode).toBe(403);
  });

  it("usul → kassa ruxsati, mijoz terminali usulga zid — rad, aralash to'lov: naqd kassaga, karta terminal hisobiga, usul ID'si saqlanadi", async () => {
    const mk = async (name: string, code: string) =>
      (await call(company.ownerCookie, "POST", "/api/finance/cash-accounts", { name, type: "cash", code, warehouseId: mainWh })).json().cashAccount.id as string;
    const [k1, k2] = [await mk("Kassa 1", "K1"), await mk("Kassa 2", "K2")];
    await call(company.ownerCookie, "POST", "/api/finance/payment-methods/bootstrap");
    const methods = (await call(company.ownerCookie, "GET", "/api/finance/payment-methods")).json().paymentMethods as { id: string; name: string }[];
    const id = (name: string) => methods.find((m) => m.name === name)!.id;
    // HUMO faqat Kassa 2 da
    expect((await call(company.ownerCookie, "PATCH", `/api/finance/payment-methods/${id("HUMO")}`, { kassaIds: [k2] })).statusCode).toBe(200);

    const [ozoda, diana] = [await addEmployee(app, company), await addEmployee(app, company)];
    const s1 = (await call(ozoda.cookie, "POST", "/api/sales/pos/shifts", { warehouseId: mainWh, cashAccountId: k1 })).json().shift.id as string;
    const s2 = (await call(diana.cookie, "POST", "/api/sales/pos/shifts", { warehouseId: mainWh, cashAccountId: k2 })).json().shift.id as string;

    const options1 = (await call(ozoda.cookie, "GET", `/api/sales/pos/payment-options?shiftId=${s1}`)).json().paymentMethods as { name: string }[];
    expect(options1.map((m) => m.name)).toEqual(["Naqd", "UZCARD"]);
    const options2 = (await call(diana.cookie, "GET", `/api/sales/pos/payment-options?shiftId=${s2}`)).json().paymentMethods as { name: string }[];
    expect(options2.map((m) => m.name)).toEqual(["Naqd", "HUMO", "UZCARD"]);

    const sell = (cookie: string, shiftId: string, payments: object[]) =>
      call(cookie, "POST", "/api/sales/pos/sales", { shiftId, items: [{ productId, quantity: "2" }], paymentMethod: "cash", payments });
    // HUMO Kassa 1 da — 403
    const denied = await sell(ozoda.cookie, s1, [{ method: "card", amount: "10000", paymentMethodId: id("HUMO") }]);
    expect(denied.statusCode, denied.body).toBe(403);
    expect(denied.body).toContain("payment_method_not_allowed_for_kassa");
    // Usul UZCARD, terminal HUMO — zid, 400
    expect((await sell(ozoda.cookie, s1, [{ method: "card", amount: "10000", paymentMethodId: id("UZCARD"), terminalId: humoTerminal }])).statusCode).toBe(400);
    // Usul turi va qism turi zid — 400
    expect((await sell(ozoda.cookie, s1, [{ method: "cash", amount: "10000", paymentMethodId: id("UZCARD") }])).statusCode).toBe(400);
    // Begona kompaniya usuli — 404
    await call(other.ownerCookie, "POST", "/api/finance/payment-methods/bootstrap");
    const foreignNaqd = ((await call(other.ownerCookie, "GET", "/api/finance/payment-methods")).json().paymentMethods as { id: string }[])[0]!.id;
    expect((await sell(ozoda.cookie, s1, [{ method: "cash", amount: "10000", paymentMethodId: foreignNaqd }])).statusCode).toBe(404);

    const bankBefore = await balanceOf(bank);
    // Aralash: 4 000 naqd + 6 000 UZCARD (Kassa 1)
    const mixed = await sell(ozoda.cookie, s1, [
      { method: "cash", amount: "4000", paymentMethodId: id("Naqd") },
      { method: "card", amount: "6000", paymentMethodId: id("UZCARD") },
    ]);
    expect(mixed.statusCode, mixed.body).toBe(201);
    // HUMO Kassa 2 da — ruxsat
    const humo = await sell(diana.cookie, s2, [{ method: "card", amount: "10000", paymentMethodId: id("HUMO") }]);
    expect(humo.statusCode, humo.body).toBe(201);

    expect(await balanceOf(k1)).toBe(4000);
    expect(await balanceOf(k2)).toBe(0);
    expect(await balanceOf(bank)).toBe(bankBefore + 16000);
    expect(await ledger("1010")).toBe(4000);

    const rows = await db
      .select({ method: customerPayments.method, amount: customerPayments.amount, paymentMethodId: customerPayments.paymentMethodId, terminalId: customerPayments.terminalId, cashAccountId: customerPayments.cashAccountId })
      .from(customerPayments)
      .where(eq(customerPayments.companyId, company.companyId));
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.paymentMethodId === id("UZCARD"))).toMatchObject({ method: "card", terminalId: uzcardTerminal, amount: "6000.00" });
    expect(rows.find((r) => r.paymentMethodId === id("HUMO"))).toMatchObject({ method: "card", terminalId: humoTerminal, amount: "10000.00" });
    expect(rows.find((r) => r.paymentMethodId === id("Naqd"))).toMatchObject({ method: "cash", cashAccountId: k1, amount: "4000.00" });

    // Usulni o'chirish — keyingi sotuvda rad (tarixiy to'lov qatori saqlanadi)
    await call(company.ownerCookie, "PATCH", `/api/finance/payment-methods/${id("UZCARD")}`, { isActive: false });
    expect((await sell(ozoda.cookie, s1, [{ method: "card", amount: "10000", paymentMethodId: id("UZCARD") }])).statusCode).toBe(400);
    expect((await db.select().from(customerPayments).where(eq(customerPayments.paymentMethodId, id("UZCARD"))))).toHaveLength(1);
  });

  it("usulsiz (tarixiy) to'lov avvalgidek ishlaydi", async () => {
    const kassir = await addEmployee(app, company);
    const shift = (await call(kassir.cookie, "POST", "/api/sales/pos/shifts", { warehouseId: mainWh })).json().shift.id as string;
    const sale = await call(kassir.cookie, "POST", "/api/sales/pos/sales", {
      shiftId: shift,
      items: [{ productId, quantity: "1" }],
      paymentMethod: "card",
      payments: [{ method: "card", amount: "5000", terminalId: uzcardTerminal }],
    });
    expect(sale.statusCode, sale.body).toBe(201);
    const [row] = await db.select().from(customerPayments).where(eq(customerPayments.companyId, company.companyId));
    expect(row!.paymentMethodId).toBeNull();
    expect(row!.terminalId).toBe(uzcardTerminal);
  });
});
