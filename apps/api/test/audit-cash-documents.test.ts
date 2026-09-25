/**
 * KASSALAR VA KASSA HUJJATLARI (egasining vazifasi, Z4): mas'ul xodim, o'tkazma, to'lov usulini tuzatish va
 * ayirboshlash, valyuta ayirboshlash (kurs snapshoti, kurs farqi), kategoriyali kirim/chiqim, bekor qilish va
 * kassa hisoboti (boshlang'ich + kirim − chiqim ± … = yakuniy).
 *
 * Har qadamda: kassa qoldig'i = harakatlar yig'indisi, buxgalteriya (1010/1020) = kassalar yig'indisi (asosiy valyutada),
 * aylanma balans teng. Mas'ul faqat o'z kassasini ko'radi va ishlatadi; kassani ochish, qoldiqni o'rnatish, tuzatish va
 * bekor qilish — rahbar.
 */
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts, cashAccounts, cashDocuments, journalEntries, journalLines } from "../src/db/schema/finance.js";
import { employees } from "../src/db/schema/hr.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let mainCash: string;
let bank: string;

const localIso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const today = localIso(new Date());

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
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Kassa kompaniyasi" });
  const list = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));
  mainCash = list.find((row) => row.isDefault)!.id;
  bank = list.find((row) => row.type === "bank")!.id;
});

const call = (cookie: string, method: "GET" | "POST" | "PATCH" | "PUT", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const fin = (method: "GET" | "POST" | "PATCH" | "PUT", url: string, payload?: object, cookie = company.ownerCookie) =>
  call(cookie, method, `/api/finance${url}`, payload);

async function balance(id: string) {
  const [row] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, id));
  return row!.balance;
}

async function ledger(code: string) {
  const [row] = await db.select().from(accounts).where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code)));
  return row!.balance;
}

async function expectTrialBalance() {
  const [row] = await db
    .select({
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)::numeric(18,2)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)::numeric(18,2)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalLines.companyId, company.companyId), eq(journalEntries.status, "posted")));
  expect(row!.debit).toBe(row!.credit);
}

async function register(name: string, extra: object = {}) {
  const res = await fin("POST", "/cash-accounts", { name, type: "cash", ...extra });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().cashAccount.id as string;
}

/** Xodim (foydalanuvchi + HR kartasi) — kassaga mas'ul qilib biriktiriladi. */
async function cashierWithCard(role = "Kassir") {
  const user = await addEmployee(app, company, role);
  const [card] = await db.select().from(employees).where(and(eq(employees.companyId, company.companyId), eq(employees.userId, user.id)));
  expect(card, "xodimning HR kartasi").toBeTruthy();
  return { ...user, employeeId: card!.id };
}

/** Ta'sischi puli (Ustav kapitali) bilan kirim — test uchun boshlang'ich pul. */
async function topUp(accountId: string, amount: string) {
  const [capital] = await db.select().from(accounts).where(and(eq(accounts.companyId, company.companyId), eq(accounts.subtype, "capital")));
  const res = await fin("POST", "/cash-transactions", { cashAccountId: accountId, type: "in", amount, description: "Boshlang'ich pul", counterAccountId: capital!.id });
  expect(res.statusCode, res.body).toBe(201);
}

const doc = (payload: object, cookie = company.ownerCookie) => fin("POST", "/cash-documents", payload, cookie);

describe("Kassa hujjatlari", () => {
  it("o'tkazma: atomar, sabab/raqam/mas'ul bilan; bekor qilish teskari yozadi, qayta bekor qilinmaydi", async () => {
    const diana = await register("Kassir Diana");
    await topUp(mainCash, "1000000");

    const res = await doc({ kind: "transfer", fromCashAccountId: mainCash, toCashAccountId: diana, amount: "300000", reason: "Smena uchun maydalik", reference: "T-1" });
    expect(res.statusCode, res.body).toBe(201);
    const created = res.json().document as { id: string; number: string; approvedBy: string | null; createdByName: string | null };
    expect(created.number).toMatch(/^KH-\d{4}-\d{5}$/);
    expect(created.approvedBy, "rahbar kiritgan — o'zi tasdiqlagan").toBeTruthy();
    expect(await balance(mainCash)).toBe("700000.00");
    expect(await balance(diana)).toBe("300000.00");
    expect(await ledger("1010"), "ikkalasi naqd — 1010 o'zgarmaydi").toBe("1000000.00");
    await expectTrialBalance();

    const reversed = await fin("POST", `/cash-documents/${created.id}/reverse`, { reason: "Noto'g'ri kassa" });
    expect(reversed.statusCode, reversed.body).toBe(200);
    expect(reversed.json().document.status).toBe("reversed");
    expect(await balance(mainCash)).toBe("1000000.00");
    expect(await balance(diana)).toBe("0.00");
    expect((await fin("POST", `/cash-documents/${created.id}/reverse`, { reason: "yana bir bor" })).statusCode).toBe(409);
    const [row] = await db.select().from(cashDocuments).where(eq(cashDocuments.id, created.id));
    expect(row, "hujjat o'chirilmaydi").toBeTruthy();
  });

  it("qabul qilgan kassada pul qolmagan bo'lsa bekor qilish rad etiladi va hech narsa o'zgarmaydi", async () => {
    const diana = await register("Kassir Diana");
    await topUp(mainCash, "500000");
    const created = (await doc({ kind: "transfer", fromCashAccountId: mainCash, toCashAccountId: diana, amount: "200000", reason: "Maydalik" })).json().document as { id: string };
    await doc({ kind: "transfer", fromCashAccountId: diana, toCashAccountId: bank, amount: "150000", reason: "Bankka topshirildi" });

    const preview = await fin("GET", `/cash-documents/${created.id}/reversal`);
    expect(preview.json().blockers.join(" ")).toContain("yetarli pul yo'q");
    const blocked = await fin("POST", `/cash-documents/${created.id}/reverse`, { reason: "Xato" });
    expect(blocked.statusCode).toBe(400);
    expect(await balance(diana)).toBe("50000.00");
    expect(await balance(mainCash)).toBe("300000.00");
    await expectTrialBalance();
  });

  it("to'lov usulini tuzatish: karta to'lovi naqd deb kiritilgan — pul bankka o'tadi, asl to'lov o'zgarmaydi, ikki marta tuzatilmaydi", async () => {
    const customer = (await call(company.ownerCookie, "POST", "/api/sales/customers", { name: "Test Market" })).json().customer.id as string;
    await call(company.ownerCookie, "POST", `/api/sales/customers/${customer}/balance-deposit`, { amount: "1", method: "cash" });
    // Qarzsiz to'lov yo'li yo'q — avans kirimi bilan emas, oddiy naqd to'lov bilan: avval qarz hosil qilinadi
    await call(company.ownerCookie, "POST", `/api/sales/customers/${customer}/balance-adjust`, { totalDebt: "90000", reason: "Boshlang'ich qarz" });
    const paid = await call(company.ownerCookie, "POST", "/api/sales/payments", { customerId: customer, amount: "90000", method: "cash" });
    expect(paid.statusCode, paid.body).toBe(201);
    const paymentId = paid.json().payment.id as string;
    expect(await balance(mainCash)).toBe("90001.00");

    const fixed = await doc({ kind: "method_correction", fromCashAccountId: mainCash, toCashAccountId: bank, amount: "90000", reason: "Aslida karta orqali to'langan", correctsPaymentId: paymentId });
    expect(fixed.statusCode, fixed.body).toBe(201);
    expect(fixed.json().document).toMatchObject({ kind: "method_correction", correctsType: "customer_payment", correctsId: paymentId });
    expect(await balance(mainCash)).toBe("1.00");
    expect(await balance(bank)).toBe("90000.00");
    expect(await ledger("1020")).toBe("90000.00");
    await expectTrialBalance();

    const again = await doc({ kind: "method_correction", fromCashAccountId: mainCash, toCashAccountId: bank, amount: "1", reason: "Yana", correctsPaymentId: paymentId });
    expect(again.statusCode).toBe(409);
    const wrongAccount = await doc({ kind: "method_correction", fromCashAccountId: bank, toCashAccountId: mainCash, amount: "1", reason: "Teskari", correctsPaymentId: paymentId });
    expect(wrongAccount.statusCode, "to'lov bu hisobga tushmagan").toBe(400);
  });

  it("to'lov usulini ayirboshlash: naqd 100 000 → karta hisobiga 99 000 — farq boshqa xarajat", async () => {
    await topUp(mainCash, "100000");
    const res = await doc({ kind: "method_exchange", fromCashAccountId: mainCash, toCashAccountId: bank, amount: "100000", toAmount: "99000", reason: "Naqdni kartaga o'tkazish" });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().document.difference).toBe("-1000.00");
    expect(await balance(mainCash)).toBe("0.00");
    expect(await balance(bank)).toBe("99000.00");
    await expectTrialBalance();
  });

  it("valyuta ayirboshlash: kurs snapshoti, kurs farqi 4200/5700, bekor qilish asl kursda", async () => {
    expect((await fin("PUT", "/currencies", { cbuEnabled: false, currencies: [{ code: "USD", rate: "12500", source: "manual", isActive: true }] })).statusCode).toBe(200);
    const usdCash = await register("Dollar kassa", { currency: "USD" });
    await topUp(usdCash, "100");
    expect(await ledger("1010"), "100 USD × 12 500").toBe("1250000.00");

    // 100 USD sotildi, 1 270 000 so'm olindi (bozor kursi 12 700) — hisob kursi 12 500 → 20 000 kurs daromadi
    const res = await doc({ kind: "currency_exchange", fromCashAccountId: usdCash, toCashAccountId: mainCash, amount: "100", toAmount: "1270000", reason: "Dollar sotildi" });
    expect(res.statusCode, res.body).toBe(201);
    const exchanged = res.json().document as { id: string; dealRate: string; bookRateFrom: string; difference: string; currency: string; toCurrency: string };
    expect(exchanged).toMatchObject({ dealRate: "12700.000000", bookRateFrom: "12500.0000", difference: "20000.00", currency: "USD", toCurrency: "UZS" });
    expect(await balance(usdCash)).toBe("0.00");
    expect(await balance(mainCash)).toBe("1270000.00");
    expect(await ledger("4200")).toBe("20000.00");
    expect(await ledger("1010")).toBe("1270000.00");
    await expectTrialBalance();

    // Kurs o'zgargach bekor qilinsa ham — asl yozuvning aynan teskarisi (snapshot kursda)
    await fin("PUT", "/currencies", { cbuEnabled: false, currencies: [{ code: "USD", rate: "13000", source: "manual", isActive: true }] });
    expect((await fin("POST", `/cash-documents/${exchanged.id}/reverse`, { reason: "Kelishuv bekor" })).statusCode).toBe(200);
    expect(await balance(usdCash)).toBe("100.00");
    expect(await balance(mainCash)).toBe("0.00");
    expect(await ledger("4200")).toBe("0.00");
    expect(await ledger("1010")).toBe("1250000.00");
    await expectTrialBalance();

    expect((await doc({ kind: "currency_exchange", fromCashAccountId: usdCash, toCashAccountId: mainCash, amount: "10", reason: "Summasiz" })).statusCode).toBe(400);
    expect((await doc({ kind: "transfer", fromCashAccountId: usdCash, toCashAccountId: mainCash, amount: "10", reason: "Turli valyuta" })).statusCode).toBe(400);
  });

  it("kategoriyali kirim va chiqim: qarshi hisob kategoriyadan; nazorat hisobi kategoriya bo'la olmaydi; mijoz kontragent emas", async () => {
    const categories = (await fin("GET", "/cash-categories")).json().categories as { name: string }[];
    expect(categories.map((row) => row.name).sort(), "standart kategoriyalar birinchi ochilishda").toEqual(["Boshqa chiqim", "Boshqa kirim", "Ta'sischi puli"]);
    const [rentIncomeAccount] = await db.select().from(accounts).where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, "4100")));
    const rent = await fin("POST", "/cash-categories", { name: "Ijara daromadi", direction: "in", counterAccountId: rentIncomeAccount!.id });
    expect(rent.statusCode, rent.body).toBe(201);
    const [receivable] = await db.select().from(accounts).where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, "1100")));
    expect((await fin("POST", "/cash-categories", { name: "Debitor", direction: "in", counterAccountId: receivable!.id })).statusCode).toBe(400);

    const income = await doc({ kind: "income", toCashAccountId: mainCash, amount: "400000", categoryId: rent.json().category.id, counterpartyType: "person", counterpartyName: "Ijarachi Ali", reason: "Sentabr ijarasi" });
    expect(income.statusCode, income.body).toBe(201);
    expect(income.json().document).toMatchObject({ categoryName: "Ijara daromadi", counterpartyName: "Ijarachi Ali" });
    expect(await ledger("4100")).toBe("400000.00");

    const outCategory = (await fin("GET", "/cash-categories")).json().categories.find((row: { name: string }) => row.name === "Boshqa chiqim") as { id: string };
    const expense = await doc({ kind: "expense", fromCashAccountId: mainCash, amount: "50000", categoryId: outCategory.id, counterpartyType: "other", reason: "Suv" });
    expect(expense.statusCode, expense.body).toBe(201);
    expect(await balance(mainCash)).toBe("350000.00");
    await expectTrialBalance();

    const customerCounterparty = await doc({ kind: "income", toCashAccountId: mainCash, amount: "1", categoryId: rent.json().category.id, counterpartyType: "customer", reason: "Mijozdan" });
    expect(customerCounterparty.statusCode, "mijoz puli — to'lov hujjati orqali").toBe(400);
    const wrongDirection = await doc({ kind: "expense", fromCashAccountId: mainCash, amount: "1", categoryId: rent.json().category.id, reason: "Yo'nalish" });
    expect(wrongDirection.statusCode).toBe(400);
  });

  it("idempotentlik: bitta requestId — bitta hujjat", async () => {
    const diana = await register("Kassir Diana");
    await topUp(mainCash, "100000");
    const requestId = crypto.randomUUID();
    const first = await doc({ kind: "transfer", fromCashAccountId: mainCash, toCashAccountId: diana, amount: "10000", reason: "Maydalik", requestId });
    const second = await doc({ kind: "transfer", fromCashAccountId: mainCash, toCashAccountId: diana, amount: "10000", reason: "Maydalik", requestId });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().document.id).toBe(first.json().document.id);
    expect(await balance(diana)).toBe("10000.00");
  });
});

describe("Kassa mas'uliyati (cash.own)", () => {
  it("mas'ul faqat o'z kassasini ko'radi va ishlatadi; ochish, qoldiqni o'rnatish, tuzatish va bekor qilish — rahbar", async () => {
    const diana = await cashierWithCard("Kassir");
    const other = await cashierWithCard("Kassir");
    const dianaCash = await register("Kassir Diana", { employeeId: diana.employeeId });
    const otherCash = await register("Kassir Bobur", { employeeId: other.employeeId });
    await topUp(dianaCash, "200000");
    await topUp(otherCash, "100000");

    const visible = (await fin("GET", "/cash/registers", undefined, diana.cookie)).json() as { registers: { id: string }[]; scope: string };
    expect(visible.scope).toBe("own");
    expect(visible.registers.map((row) => row.id)).toEqual([dianaCash]);
    expect((await fin("GET", `/cash/registers/${otherCash}/report?from=${today}&to=${today}`, undefined, diana.cookie)).statusCode).toBe(403);
    expect((await fin("GET", "/cash-accounts", undefined, diana.cookie)).statusCode, "barcha kassalar ro'yxati — rahbar").toBe(403);

    // O'z kassasidan asosiy kassaga topshiradi — mumkin; tasdiqlanmagan bo'lib qoladi
    const handed = await doc({ kind: "transfer", fromCashAccountId: dianaCash, toCashAccountId: mainCash, amount: "150000", reason: "Kun oxiri topshirish" }, diana.cookie);
    expect(handed.statusCode, handed.body).toBe(201);
    const handedDoc = handed.json().document as { id: string; approvedBy: string | null };
    expect(handedDoc.approvedBy).toBeNull();
    // Boshqa kassadan chiqara olmaydi
    expect((await doc({ kind: "transfer", fromCashAccountId: otherCash, toCashAccountId: dianaCash, amount: "1000", reason: "Olib qo'yish" }, diana.cookie)).statusCode).toBe(403);
    // Tuzatish, qoldiqni o'rnatish, kassa ochish, bekor qilish — yo'q
    expect((await doc({ kind: "method_correction", fromCashAccountId: dianaCash, toCashAccountId: bank, amount: "1000", reason: "Tuzatish" }, diana.cookie)).statusCode).toBe(403);
    expect((await fin("POST", `/cash-accounts/${dianaCash}/set-balance`, { balance: "999999", reason: "Qo'lda" }, diana.cookie)).statusCode).toBe(403);
    expect((await fin("POST", "/cash-accounts", { name: "Yangi", type: "cash" }, diana.cookie)).statusCode).toBe(403);
    expect((await fin("POST", `/cash-documents/${handedDoc.id}/reverse`, { reason: "O'zim" }, diana.cookie)).statusCode).toBe(403);

    // Rahbar tasdiqlaydi (imzo)
    const approved = await fin("POST", `/cash-documents/${handedDoc.id}/approve`);
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json().document.approvedByName).toBeTruthy();

    // Hisobot: boshlang'ich + kirim − chiqim − o'tkazma = yakuniy = haqiqiy qoldiq
    const report = (await fin("GET", `/cash/registers/${dianaCash}/report?from=${today}&to=${today}`, undefined, diana.cookie)).json();
    expect(report).toMatchObject({ opening: "0.00", closing: "50000.00", currentBalance: "50000.00", consistent: true });
    expect(report.totals).toMatchObject({ in: "200000.00", out: "150000.00", transferOut: "150000.00" });
  });

  it("rahbar o'zi mas'ul bo'lgan kassaning qoldig'ini o'rnata olmaydi va mas'ulini almashtira olmaydi (ega — istisno)", async () => {
    const director = await cashierWithCard("Direktor");
    const directorCash = await register("Direktor kassasi", { employeeId: director.employeeId });
    await topUp(directorCash, "10000");
    const setBalance = await fin("POST", `/cash-accounts/${directorCash}/set-balance`, { balance: "5000000", reason: "O'zim" }, director.cookie);
    expect([403], setBalance.body).toContain(setBalance.statusCode);
    const reassign = await fin("PATCH", `/cash-accounts/${directorCash}`, { employeeId: null }, director.cookie);
    expect(reassign.statusCode, reassign.body).toBe(403);
    // Ega (boshqa rahbar) qila oladi — audit izi bilan
    expect((await fin("POST", `/cash-accounts/${directorCash}/set-balance`, { balance: "9000", reason: "Sanoq farqi" })).statusCode).toBe(200);
    expect(await balance(directorCash)).toBe("9000.00");
    await expectTrialBalance();
  });

  it("begona kompaniya kassasi va hujjati ko'rinmaydi", async () => {
    await topUp(mainCash, "10000");
    const created = (await doc({ kind: "transfer", fromCashAccountId: mainCash, toCashAccountId: bank, amount: "1000", reason: "Bankka" })).json().document as { id: string };
    const admin = await signedIn(app, { isPlatformAdmin: true });
    const other = await createCompany(app, admin.cookie, { name: "Begona" });
    expect((await fin("GET", `/cash-documents/${created.id}`, undefined, other.ownerCookie)).statusCode).toBe(404);
    expect((await doc({ kind: "transfer", fromCashAccountId: mainCash, toCashAccountId: bank, amount: "1", reason: "O'g'irlik" }, other.ownerCookie)).statusCode).toBe(404);
    expect((await fin("POST", `/cash-documents/${created.id}/reverse`, { reason: "Begona" }, other.ownerCookie)).statusCode).toBe(404);
  });
});
