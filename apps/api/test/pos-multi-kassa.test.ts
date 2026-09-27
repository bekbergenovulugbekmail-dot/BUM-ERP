/**
 * KO'P KASSA (2026-09-27) — bitta omborda bir nechta kassa (pul qutisi), har kassada bitta ochiq smena.
 *
 * Tekshiriladi: kassa sozlamasi (ombor, kod) → smena kassa bo'yicha (parallel 3 kassa) → naqd pul faqat smena kassasiga
 * (mijoz yuborgan boshqa `cashAccountId` — 403, HIGH xavfsizlik teshigi yopilgan) → karta kassaga tushmaydi → qaytarish shu
 * kassadan → inkassatsiya/almashtirish puli haqiqiy o'tkazma (takror — ikkinchi ta'sir yo'q) → kutilgan = kassa balansi →
 * yopishdagi farq shu kassaga → 1010 = Σ naqd hisoblar → kassasiz (tarixiy) smena avvalgidek.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts, cashAccounts, cashTransactions } from "../src/db/schema/finance.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { employees } from "../src/db/schema/hr.js";
import { users } from "../src/db/schema/platform.js";
import { posSyncConflicts } from "../src/db/schema/pos.js";
import { posShifts } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PATCH";

let app: FastifyInstance;
let company: Company;
let other: Company;
let mainWh: string;
let mainCash: string;
let productId: string;

const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const pos = (cookie: string, method: Method, url: string, payload?: object) => call(cookie, method, `/api/sales/pos${url}`, payload);
const n = (value: string | null | undefined) => Number(value ?? 0);

async function balanceOf(id: string) {
  const [row] = await db.select({ balance: cashAccounts.balance }).from(cashAccounts).where(eq(cashAccounts.id, id));
  return n(row!.balance);
}
async function ledger(companyId: string, code: string) {
  const [row] = await db.select({ balance: accounts.balance }).from(accounts).where(and(eq(accounts.companyId, companyId), eq(accounts.code, code)));
  return n(row?.balance);
}
/** Kassa balansi (kesh) = uning harakatlari yig'indisi (kanonik manba). */
async function balanceFromTransactions(id: string) {
  const [row] = await db
    .select({ sum: sql<string>`coalesce(sum(case when ${cashTransactions.type} = 'in' then ${cashTransactions.amount} else -${cashTransactions.amount} end), 0)::numeric(18,2)` })
    .from(cashTransactions)
    .where(eq(cashTransactions.cashAccountId, id));
  return n(row!.sum);
}
/** 1010 = kompaniyaning barcha asosiy valyutadagi naqd hisoblari yig'indisi (alohida jurnal hisobisiz). */
async function cashTotal(companyId: string) {
  const [row] = await db
    .select({ sum: sql<string>`coalesce(sum(${cashAccounts.balance}), 0)::numeric(18,2)` })
    .from(cashAccounts)
    .where(and(eq(cashAccounts.companyId, companyId), eq(cashAccounts.type, "cash")));
  return n(row!.sum);
}

async function createKassa(cookie: string, name: string, code: string, extra: object = {}) {
  const res = await call(cookie, "POST", "/api/finance/cash-accounts", { name, type: "cash", code, warehouseId: mainWh, ...extra });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().cashAccount.id as string;
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
  other = await createCompany(app, admin.cookie, { name: "Begona do'kon" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  mainCash = (await db.select().from(cashAccounts).where(and(eq(cashAccounts.companyId, company.companyId), eq(cashAccounts.isDefault, true))))[0]!.id;
  const product = await call(company.ownerCookie, "POST", "/api/catalog/products", { name: "Non", sku: "NON", baseUnitId: piece, salesPrice: "5000" });
  productId = product.json().product.id;
  await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", { type: "receive", productId, warehouseId: mainWh, quantity: "1000", costPrice: "3000" });
});

describe("Ko'p kassa", () => {
  it("kassa sozlamasi: ombor, kod yagona, asosiy kassa/bank POS kassa bo'lmaydi, begona ombor — yo'q", async () => {
    const k1 = await createKassa(company.ownerCookie, "Kassa 1", "K1");
    expect((await call(company.ownerCookie, "POST", "/api/finance/cash-accounts", { name: "Takror", type: "cash", code: "K1" })).statusCode).toBe(409);
    expect((await call(company.ownerCookie, "POST", "/api/finance/cash-accounts", { name: "Bank", type: "bank", warehouseId: mainWh })).statusCode).toBe(400);
    expect((await call(company.ownerCookie, "PATCH", `/api/finance/cash-accounts/${mainCash}`, { warehouseId: mainWh })).statusCode).toBe(400);
    const foreignWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, other.companyId)))[0]!.id;
    expect((await call(company.ownerCookie, "PATCH", `/api/finance/cash-accounts/${k1}`, { warehouseId: foreignWh })).statusCode).toBe(404);
    // Begona kompaniya bu kassada smena ocholmaydi
    const otherWh = foreignWh;
    expect((await pos(other.ownerCookie, "POST", "/shifts", { warehouseId: otherWh, cashAccountId: k1 })).statusCode).toBe(404);
  });

  it("3 kassada parallel smena, naqd faqat o'z kassasiga, boshqa kassani ko'rsatish — 403, karta kassaga tushmaydi", async () => {
    const [k1, k2, k3] = [
      await createKassa(company.ownerCookie, "Kassa 1", "K1"),
      await createKassa(company.ownerCookie, "Kassa 2", "K2"),
      await createKassa(company.ownerCookie, "Kassa 3", "K3"),
    ];
    const [ozoda, diana, sanaver] = [await addEmployee(app, company), await addEmployee(app, company), await addEmployee(app, company)];

    // Kassa tanlanmasa — omborda kassalar bor, tanlash majburiy
    const noKassa = await pos(ozoda.cookie, "POST", "/shifts", { warehouseId: mainWh });
    expect(noKassa.statusCode).toBe(400);
    expect(noKassa.body).toContain("kassa_required");

    const kassas = await pos(ozoda.cookie, "GET", `/kassas?warehouseId=${mainWh}`);
    expect(kassas.json().kassas.map((k: { code: string }) => k.code)).toEqual(["K1", "K2", "K3"]);

    const open = async (cookie: string, kassa: string) => {
      const res = await pos(cookie, "POST", "/shifts", { warehouseId: mainWh, cashAccountId: kassa, openingCash: "0" });
      expect(res.statusCode, res.body).toBe(201);
      return res.json().shift.id as string;
    };
    const [s1, s2, s3] = [await open(ozoda.cookie, k1), await open(diana.cookie, k2), await open(sanaver.cookie, k3)];
    // Har kassada bittadan: ikkinchi smena — 409
    expect((await pos(diana.cookie, "POST", "/shifts", { warehouseId: mainWh, cashAccountId: k1 })).statusCode).toBe(409);
    expect((await pos(diana.cookie, "GET", `/shifts/open?warehouseId=${mainWh}`)).json().shift.id).toBe(s2);
    // Smenasiz kassir boshqalarning kassa smenasini "o'ziniki" deb ko'rmaydi
    const fourth = await addEmployee(app, company);
    expect((await pos(fourth.cookie, "GET", `/shifts/open?warehouseId=${mainWh}`)).json().shift).toBeNull();
    expect((await pos(ozoda.cookie, "GET", `/kassas?warehouseId=${mainWh}`)).json().kassas.every((k: { openShift: unknown }) => k.openShift)).toBe(true);

    const sale = (cookie: string, shiftId: string, qty: string, extra: object = {}) =>
      pos(cookie, "POST", "/sales", { shiftId, items: [{ productId, quantity: qty }], paymentMethod: "cash", amountPaid: String(Number(qty) * 5000), ...extra });
    expect((await sale(ozoda.cookie, s1, "2")).statusCode).toBe(201);
    expect((await sale(diana.cookie, s2, "3")).statusCode).toBe(201);
    expect((await sale(sanaver.cookie, s3, "4")).statusCode).toBe(201);

    // HIGH: kassir o'z chekining naqdini boshqa kassaga (yoki asosiy kassaga) yo'naltira olmaydi
    for (const target of [k2, mainCash]) {
      const hacked = await pos(ozoda.cookie, "POST", "/sales", {
        shiftId: s1,
        items: [{ productId, quantity: "1" }],
        payments: [{ method: "cash", amount: "5000", cashAccountId: target }],
      });
      expect(hacked.statusCode, hacked.body).toBe(403);
    }
    // Boshqa kassirning smenasida sotolmaydi
    expect((await sale(ozoda.cookie, s2, "1")).statusCode).toBe(403);

    // Karta — kassaga tushmaydi (bank/terminal hisobiga)
    expect((await sale(diana.cookie, s2, "1", { paymentMethod: "card", amountPaid: "5000" })).statusCode).toBe(201);

    expect(await balanceOf(k1)).toBe(10000);
    expect(await balanceOf(k2)).toBe(15000);
    expect(await balanceOf(k3)).toBe(20000);
    expect(await balanceOf(mainCash)).toBe(0);
    for (const k of [k1, k2, k3, mainCash]) expect(await balanceFromTransactions(k)).toBe(await balanceOf(k));
    expect(await ledger(company.companyId, "1010")).toBe(await cashTotal(company.companyId));
    expect(await ledger(company.companyId, "1010")).toBe(45000);

    // Kutilgan = kassa balansi
    expect(n((await pos(ozoda.cookie, "GET", `/shifts/${s1}`)).json().shift.expectedCash)).toBe(10000);
    expect(n((await pos(diana.cookie, "GET", `/shifts/${s2}`)).json().shift.expectedCash)).toBe(15000);
  });

  it("qaytarish, inkassatsiya, almashtirish puli, xarajat — shu kassada; takror so'rov ikkinchi marta yozilmaydi; yopish farqi kassaga", async () => {
    const k1 = await createKassa(company.ownerCookie, "Kassa 1", "K1");
    // Asosiy kassada almashtirish puli uchun naqd
    await call(company.ownerCookie, "POST", `/api/finance/cash-accounts/${mainCash}/set-balance`, { balance: "50000", reason: "Boshlang'ich naqd" });
    const ozoda = await addEmployee(app, company);
    const shift = (await pos(ozoda.cookie, "POST", "/shifts", { warehouseId: mainWh, cashAccountId: k1 })).json().shift.id as string;

    // Almashtirish puli: asosiy → kassa 20 000
    const changeFund = await pos(ozoda.cookie, "POST", `/shifts/${shift}/cash-movements`, { kind: "change_fund", amount: "20000" });
    expect(changeFund.statusCode, changeFund.body).toBe(201);
    expect(await balanceOf(k1)).toBe(20000);
    expect(await balanceOf(mainCash)).toBe(30000);

    const saleRes = await pos(ozoda.cookie, "POST", "/sales", { shiftId: shift, items: [{ productId, quantity: "6" }], paymentMethod: "cash", amountPaid: "30000" });
    expect(saleRes.statusCode).toBe(201);
    const order = saleRes.json().order as { id: string; items?: { id: string }[] };
    expect(await balanceOf(k1)).toBe(50000);

    // Qaytarish (1 dona) — pul shu kassadan
    const detail = (await call(ozoda.cookie, "GET", `/api/sales/orders/${order.id}`)).json();
    const itemId = (detail.order?.items ?? detail.items)[0].id as string;
    const ret = await call(company.ownerCookie, "POST", `/api/sales/orders/${order.id}/return-items`, {
      items: [{ orderItemId: itemId, quantity: "1" }],
      refundMethod: "cash",
      shiftId: shift,
      reason: "Sifatsiz",
    });
    expect([200, 201], ret.body).toContain(ret.statusCode);
    expect(await balanceOf(k1)).toBe(45000);
    expect(await balanceOf(mainCash)).toBe(30000);

    // Inkassatsiya 25 000: kassa → asosiy; takroriy yuborish ikkinchi o'tkazma bermaydi
    const requestId = randomUUID();
    const collect = () => pos(ozoda.cookie, "POST", `/shifts/${shift}/cash-movements`, { kind: "collection", amount: "25000", requestId });
    expect((await collect()).statusCode).toBe(201);
    expect((await collect()).statusCode).toBe(200);
    expect(await balanceOf(k1)).toBe(20000);
    expect(await balanceOf(mainCash)).toBe(55000);
    // Kassadagidan ko'p olib bo'lmaydi
    expect((await pos(ozoda.cookie, "POST", `/shifts/${shift}/cash-movements`, { kind: "collection", amount: "999999" })).statusCode).toBe(400);
    // Inkassatsiyani bankka — finance.manage kerak
    const bank = (await db.select().from(cashAccounts).where(and(eq(cashAccounts.companyId, company.companyId), eq(cashAccounts.type, "bank"))))[0]!.id;
    expect((await pos(ozoda.cookie, "POST", `/shifts/${shift}/cash-movements`, { kind: "collection", amount: "1000", targetAccountId: bank })).statusCode).toBe(403);

    // Xarajat — shu kassadan (owner — pos.cash.expense bor, lekin smena operatori emas → kassir o'zi; kassirda ruxsat yo'q → 403)
    const expense = await pos(ozoda.cookie, "POST", `/shifts/${shift}/cash-movements`, { kind: "expense", amount: "3000", category: "suv" });
    if (expense.statusCode === 201) {
      expect(await balanceOf(k1)).toBe(17000);
    } else {
      expect(expense.statusCode).toBe(403);
      expect(await balanceOf(k1)).toBe(20000);
    }
    const expectedNow = await balanceOf(k1);
    const view = (await pos(ozoda.cookie, "GET", `/shifts/${shift}`)).json().shift;
    expect(n(view.expectedCash)).toBe(expectedNow);

    // Yopish: 1 000 kam — kamomad shu kassadan yoziladi, kassa = sanalgan
    const close = await pos(ozoda.cookie, "POST", `/shifts/${shift}/close`, { closingCash: String(expectedNow - 1000) });
    expect(close.statusCode, close.body).toBe(200);
    expect(n(close.json().shift.cashDifference)).toBe(-1000);
    expect(await balanceOf(k1)).toBe(expectedNow - 1000);
    expect(n(close.json().shift.expectedCash)).toBe(expectedNow);
    for (const k of [k1, mainCash]) expect(await balanceFromTransactions(k)).toBe(await balanceOf(k));
    expect(await ledger(company.companyId, "1010")).toBe(await cashTotal(company.companyId));

    // Keyingi smena kassaning qoldig'idan boshlanadi
    const next = await pos(ozoda.cookie, "POST", "/shifts", { warehouseId: mainWh, cashAccountId: k1 });
    expect(next.statusCode).toBe(201);
    expect(n(next.json().shift.openingBalance)).toBe(expectedNow - 1000);
    const [row] = await db.select().from(posShifts).where(eq(posShifts.id, shift));
    expect(row!.cashAccountId).toBe(k1);
    // Xarajat (ruxsati bor rahbar o'z smenasida) — shu kassadan, asosiy kassa tegilmaydi
    const k2 = await createKassa(company.ownerCookie, "Kassa 2", "K2");
    const ownerShift = (await pos(company.ownerCookie, "POST", "/shifts", { warehouseId: mainWh, cashAccountId: k2 })).json().shift.id as string;
    await pos(company.ownerCookie, "POST", `/shifts/${ownerShift}/cash-movements`, { kind: "change_fund", amount: "10000" });
    const mainBefore = await balanceOf(mainCash);
    const paidExpense = await pos(company.ownerCookie, "POST", `/shifts/${ownerShift}/cash-movements`, { kind: "expense", amount: "3000", category: "suv" });
    expect(paidExpense.statusCode, paidExpense.body).toBe(201);
    expect(await balanceOf(k2)).toBe(7000);
    expect(await balanceOf(mainCash)).toBe(mainBefore);
    expect(n((await pos(company.ownerCookie, "GET", `/shifts/${ownerShift}`)).json().shift.expectedCash)).toBe(7000);
    expect(await ledger(company.companyId, "1010")).toBe(await cashTotal(company.companyId));
  });

  it("kassaga mas'ul kassir: boshqa kassir shu kassada smena ocholmaydi; rahbar ocha oladi", async () => {
    const ozoda = await addEmployee(app, company);
    const diana = await addEmployee(app, company);
    const [ozodaEmployee] = await db
      .select({ id: employees.id })
      .from(employees)
      .innerJoin(users, eq(users.id, employees.userId))
      .where(and(eq(employees.companyId, company.companyId), eq(users.phone, ozoda.phone)));
    const k1 = await createKassa(company.ownerCookie, "Kassa 1", "K1", { employeeId: ozodaEmployee!.id });
    const denied = await pos(diana.cookie, "POST", "/shifts", { warehouseId: mainWh, cashAccountId: k1 });
    expect(denied.statusCode).toBe(403);
    expect((await pos(diana.cookie, "GET", `/kassas?warehouseId=${mainWh}`)).json().kassas).toEqual([]);
    expect((await pos(ozoda.cookie, "POST", "/shifts", { warehouseId: mainWh, cashAccountId: k1 })).statusCode).toBe(201);
  });

  it("kassasiz ombor — tarixiy xulq: smena kassasiz, naqd asosiy kassaga, kutilgan = hisoblagichlar", async () => {
    const kassir = await addEmployee(app, company);
    const shift = await pos(kassir.cookie, "POST", "/shifts", { warehouseId: mainWh, openingCash: "10000" });
    expect(shift.statusCode).toBe(201);
    const id = shift.json().shift.id as string;
    expect(shift.json().shift.cashAccountId).toBeNull();
    await pos(kassir.cookie, "POST", "/sales", { shiftId: id, items: [{ productId, quantity: "2" }], paymentMethod: "cash", amountPaid: "10000" });
    expect(await balanceOf(mainCash)).toBe(10000);
    expect(n((await pos(kassir.cookie, "GET", `/shifts/${id}`)).json().shift.expectedCash)).toBe(20000);
    // Tarixiy smenada ham boshqa kassaga naqd yo'naltirish — 403
    const k9 = await createKassa(company.ownerCookie, "Boshqa", "K9", { warehouseId: null });
    const hacked = await pos(kassir.cookie, "POST", "/sales", { shiftId: id, items: [{ productId, quantity: "1" }], payments: [{ method: "cash", amount: "5000", cashAccountId: k9 }] });
    expect(hacked.statusCode).toBe(403);
  });

  it("desktop qurilma → kassa deterministik: smena qurilma kassasida, offline chekdagi boshqa kassa — kassaga yo'naltiriladi va nomuvofiqlik", async () => {
    const k1 = await createKassa(company.ownerCookie, "Kassa 1", "K1");
    const k2 = await createKassa(company.ownerCookie, "Kassa 2", "K2");
    const cashier = await addEmployee(app, company);
    const registered = await app.inject({
      method: "POST",
      url: "/api/pos-device/setup/register",
      payload: { phone: company.owner.phone, password: company.owner.password, warehouseId: mainWh, name: "POS-01", appVersion: "0.1.0", platform: "win32" },
    });
    expect(registered.statusCode, registered.body).toBe(201);
    const token = registered.json().token as string;
    const deviceId = registered.json().device.id as string;
    const code = registered.json().device.code as string;
    const device = (method: Method, url: string, payload?: object) =>
      app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });

    // Kassani biriktirish: begona/bank hisobi — rad; K1 — ha
    const bank = (await db.select().from(cashAccounts).where(and(eq(cashAccounts.companyId, company.companyId), eq(cashAccounts.type, "bank"))))[0]!.id;
    expect((await call(company.ownerCookie, "PATCH", `/api/pos/devices/${deviceId}`, { cashAccountId: bank })).statusCode).toBe(400);
    const bound = await call(company.ownerCookie, "PATCH", `/api/pos/devices/${deviceId}`, { cashAccountId: k1 });
    expect(bound.statusCode, bound.body).toBe(200);
    expect(bound.json().device.cashAccountId).toBe(k1);

    const [userRow] = await db.select({ id: users.id }).from(users).where(eq(users.phone, cashier.phone));
    expect((await device("POST", "/api/pos-device/cashiers/login", { phone: cashier.phone, password: "xodim-parol-123" })).statusCode).toBe(200);
    const op = (type: string, payload: object) => ({ opId: randomUUID(), type, cashierId: userRow!.id, createdAt: new Date(Date.now() - 1000).toISOString(), payload });
    const push = async (ops: object[]) => {
      const res = await device("POST", "/api/pos-device/push", { ops });
      expect(res.statusCode, res.body).toBe(200);
      return res.json().results as { status: string; result?: Record<string, unknown> }[];
    };
    const shiftId = randomUUID();
    const [opened] = await push([op("shift.open", { shiftId, openingCash: "0" })]);
    expect(opened!.status, JSON.stringify(opened)).toBe("applied");
    const [shiftRow] = await db.select().from(posShifts).where(eq(posShifts.id, shiftId));
    expect(shiftRow!.cashAccountId).toBe(k1);
    // Ochiq smenada qurilma kassasini almashtirib bo'lmaydi; web shu kassada ikkinchi smena ocholmaydi
    expect((await call(company.ownerCookie, "PATCH", `/api/pos/devices/${deviceId}`, { cashAccountId: k2 })).statusCode).toBe(409);
    expect((await pos(company.ownerCookie, "POST", "/shifts", { warehouseId: mainWh, cashAccountId: k1 })).statusCode).toBe(409);

    // Offline chek naqdini K2 ga yo'naltirmoqchi — pul baribir K1 ga, nomuvofiqlik yoziladi (chek rad etilmaydi)
    const [sold] = await push([
      op("sale.complete", {
        saleId: randomUUID(),
        shiftId,
        number: `${code}-000001`,
        items: [{ id: randomUUID(), productId, unitId: (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id, quantity: "3", unitPrice: "5000" }],
        paymentMethod: "cash",
        amountPaid: "15000",
        payments: [{ method: "cash", amount: "15000", cashAccountId: k2 }],
      }),
    ]);
    expect(sold!.status, JSON.stringify(sold)).toBe("applied");
    expect(await balanceOf(k1)).toBe(15000);
    expect(await balanceOf(k2)).toBe(0);
    const conflicts = await db.select().from(posSyncConflicts).where(eq(posSyncConflicts.deviceId, deviceId));
    expect(conflicts.map((c) => c.kind)).toContain("cash_account_overridden");

    // Inkassatsiya (offline): K1 → asosiy kassa
    const [moved] = await push([op("cash.movement", { movementId: randomUUID(), shiftId, kind: "collection", amount: "10000" })]);
    expect(moved!.status, JSON.stringify(moved)).toBe("applied");
    expect(await balanceOf(k1)).toBe(5000);
    expect(await balanceOf(mainCash)).toBe(10000);
    const [closed] = await push([op("shift.close", { shiftId, closingCash: "5000" })]);
    expect(closed!.status, JSON.stringify(closed)).toBe("applied");
    const [after] = await db.select().from(posShifts).where(eq(posShifts.id, shiftId));
    expect(n(after!.cashDifference)).toBe(0);
    expect(await ledger(company.companyId, "1010")).toBe(await cashTotal(company.companyId));
  });

  it("parallel ikki so'rov bitta kassada smena ochmoqchi — faqat bittasi o'tadi", async () => {
    const k1 = await createKassa(company.ownerCookie, "Kassa 1", "K1");
    const [a, b] = [await addEmployee(app, company), await addEmployee(app, company)];
    const results = await Promise.all([
      pos(a.cookie, "POST", "/shifts", { warehouseId: mainWh, cashAccountId: k1 }),
      pos(b.cookie, "POST", "/shifts", { warehouseId: mainWh, cashAccountId: k1 }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const open = await db.select().from(posShifts).where(and(eq(posShifts.cashAccountId, k1), eq(posShifts.status, "open")));
    expect(open).toHaveLength(1);
  });
});
