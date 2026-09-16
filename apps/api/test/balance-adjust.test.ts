/**
 * Balanslarni to'g'rilash: mijoz balansi/qarzi/keshbegi, ta'minotchi qarzi va kassa qoldig'i noto'g'ri bo'lsa —
 * to'g'ri qiymatga o'rnatiladi. Farq jurnalda "Boshqa daromadlar" / "Boshqa xarajatlar" bilan yopiladi.
 */
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { accounts, cashAccounts } from "../src/db/schema/finance.js";
import { supplierBalances, suppliers } from "../src/db/schema/purchase.js";
import { customers } from "../src/db/schema/sales.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let mainCash: string;
let customerId: string;

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
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "To'g'rilash do'koni" });
  const rows = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));
  mainCash = rows.find((row) => row.type === "cash")!.id;
  const created = await call(company.ownerCookie, "POST", "/api/sales/customers", { name: "Mijoz 1" });
  expect(created.statusCode, created.body).toBe(201);
  customerId = created.json().customer.id as string;
});

const call = (cookie: string, method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const owner = () => company.ownerCookie;

const ledger = async (code: string) =>
  (await db.select({ balance: accounts.balance }).from(accounts).where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code))))[0]?.balance ?? null;
const customerRow = async () =>
  (await db.select().from(customers).where(eq(customers.id, customerId)))[0]!;

describe("Balanslarni to'g'rilash", () => {
  it("mijoz balansi, qarzi va keshbegi to'g'ri qiymatga o'rnatiladi; sabab majburiy", async () => {
    const adjust = (body: object) => call(owner(), "POST", `/api/sales/customers/${customerId}/balance-adjust`, body);

    // Balans 0 → 50 000: DR 5500 boshqa xarajat / CR 2300 avanslar
    const up = await adjust({ balance: "50000", reason: "Inventarizatsiya farqi" });
    expect(up.statusCode, up.body).toBe(200);
    expect((await customerRow()).balance).toBe("50000.00");
    expect([await ledger("2300"), await ledger("5500")]).toEqual(["50000.00", "50000.00"]);

    // Tarixda `adjustment` qatori — sabab bilan
    const history = (await call(owner(), "GET", `/api/sales/customers/${customerId}/balance`)).json().transactions as {
      type: string;
      amount: string;
      balanceAfter: string;
      notes: string | null;
    }[];
    expect(history[0]).toMatchObject({ type: "adjustment", amount: "50000.00", balanceAfter: "50000.00", notes: "Inventarizatsiya farqi" });

    // Balans 50 000 → 20 000: DR 2300 / CR 4100 boshqa daromad
    expect((await adjust({ balance: "20000", reason: "Ortiqcha yozilgan" })).statusCode).toBe(200);
    expect((await customerRow()).balance).toBe("20000.00");
    expect([await ledger("2300"), await ledger("4100")]).toEqual(["20000.00", "30000.00"]);

    // Qarz 0 → 10 000: DR 1100 debitorlar / CR 4100
    expect((await adjust({ totalDebt: "10000", reason: "Eski qarz" })).statusCode).toBe(200);
    expect((await customerRow()).totalDebt).toBe("10000.00");
    expect([await ledger("1100"), await ledger("4100")]).toEqual(["10000.00", "40000.00"]);

    // Keshbek 0 → 5 000: DR 5600 keshbek xarajati / CR 2400 majburiyat
    const cashback = await adjust({ cashback: "5000", reason: "Keshbek xato hisoblangan" });
    expect(cashback.statusCode, cashback.body).toBe(200);
    expect((await customerRow()).cashbackBalance).toBe("5000.00");
    expect([await ledger("2400"), await ledger("5600")]).toEqual(["5000.00", "5000.00"]);
    expect(cashback.json().cashbackTransaction).toMatchObject({ type: "adjustment", amount: "5000.00", balanceAfter: "5000.00" });

    // Bir xil qiymat — o'zgarish yo'q (yozuv yozilmaydi)
    expect((await adjust({ balance: "20000", reason: "O'zgarishsiz" })).statusCode).toBe(200);
    expect((await call(owner(), "GET", `/api/sales/customers/${customerId}/balance`)).json().transactions).toHaveLength(2);

    // Qoidalar: sabab qisqa, manfiy qiymat, bo'sh so'rov — rad
    expect((await adjust({ balance: "100", reason: "yo" })).statusCode).toBe(400);
    expect((await adjust({ balance: "-5", reason: "Manfiy balans" })).statusCode).toBe(400);
    expect((await adjust({ reason: "Hech nima tanlanmadi" })).statusCode).toBe(400);
    // Kassirda moliyaviy tasdiq ruxsati yo'q
    const kassir = await addEmployee(app, company, "Kassir");
    expect((await call(kassir.cookie, "POST", `/api/sales/customers/${customerId}/balance-adjust`, { balance: "1", reason: "Ruxsatsiz" })).statusCode).toBe(403);
  });

  it("ta'minotchi qarzi to'g'rilanadi — kreditorlar va valyuta qoldig'i bilan", async () => {
    const supplierId = (await call(owner(), "POST", "/api/purchase/suppliers", { name: "Ta'minotchi 1", code: "S-1" })).json().supplier.id as string;
    const setDebt = (body: object) => call(owner(), "POST", `/api/purchase/suppliers/${supplierId}/set-debt`, body);
    const debtOf = async () => (await db.select({ totalDebt: suppliers.totalDebt }).from(suppliers).where(eq(suppliers.id, supplierId)))[0]!.totalDebt;

    // 0 → 70 000: DR 5500 / CR 2000 kreditorlar
    const up = await setDebt({ totalDebt: "70000", reason: "Ochilish qoldig'i" });
    expect(up.statusCode, up.body).toBe(200);
    expect(await debtOf()).toBe("70000.00");
    expect([await ledger("2000"), await ledger("5500")]).toEqual(["70000.00", "70000.00"]);
    const [balanceRow] = await db.select().from(supplierBalances).where(eq(supplierBalances.supplierId, supplierId));
    expect(balanceRow).toMatchObject({ debt: "70000.00", bookValue: "70000.00" });

    // 70 000 → 20 000: DR 2000 / CR 4100
    expect((await setDebt({ totalDebt: "20000", reason: "Ikki marta yozilgan" })).statusCode).toBe(200);
    expect(await debtOf()).toBe("20000.00");
    expect([await ledger("2000"), await ledger("4100")]).toEqual(["20000.00", "50000.00"]);

    expect((await setDebt({ totalDebt: "-1", reason: "Manfiy qarz" })).statusCode).toBe(400);
    expect((await setDebt({ totalDebt: "100", reason: "x" })).statusCode).toBe(400);
  });

  it("kassa qoldig'i to'g'rilanadi — farq kirim/chiqim bo'lib tarixda ko'rinadi", async () => {
    const setBalance = (body: object) => call(owner(), "POST", `/api/finance/cash-accounts/${mainCash}/set-balance`, body);
    const balanceOf = async () => (await db.select({ balance: cashAccounts.balance }).from(cashAccounts).where(eq(cashAccounts.id, mainCash)))[0]!.balance;

    // 0 → 123 000: kirim, DR 1010 naqd / CR 4100
    const up = await setBalance({ balance: "123000", reason: "Kassada sanoq" });
    expect(up.statusCode, up.body).toBe(200);
    expect(up.json()).toMatchObject({ delta: "123000.00" });
    expect(await balanceOf()).toBe("123000.00");
    expect([await ledger("1010"), await ledger("4100")]).toEqual(["123000.00", "123000.00"]);

    // 123 000 → 100 000: chiqim, DR 5500 / CR 1010
    expect((await setBalance({ balance: "100000", reason: "Kam chiqdi" })).statusCode).toBe(200);
    expect(await balanceOf()).toBe("100000.00");
    expect([await ledger("1010"), await ledger("5500")]).toEqual(["100000.00", "23000.00"]);

    const history = (await call(owner(), "GET", `/api/finance/cash-accounts/${mainCash}/transactions`)).json().transactions as {
      type: string;
      amount: string;
      category: string | null;
      description: string;
    }[];
    expect(history.some((tx) => tx.type === "out" && tx.amount === "23000.00" && tx.category === "tuzatish")).toBe(true);
    expect(history.some((tx) => tx.type === "in" && tx.amount === "123000.00" && tx.description.startsWith("Qoldiq to'g'rilandi"))).toBe(true);

    // O'zgarishsiz — yangi tranzaksiya yo'q
    const same = await setBalance({ balance: "100000", reason: "O'zgarishsiz" });
    expect(same.statusCode).toBe(200);
    expect(same.json()).toMatchObject({ delta: "0.00", transaction: null });

    expect((await setBalance({ balance: "-1", reason: "Manfiy qoldiq" })).statusCode).toBe(400);
    const kassir = await addEmployee(app, company, "Kassir");
    expect((await call(kassir.cookie, "POST", `/api/finance/cash-accounts/${mainCash}/set-balance`, { balance: "1", reason: "Ruxsatsiz" })).statusCode).toBe(403);
  });
});
