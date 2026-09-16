/**
 * QABUL TESTI — to'lovlar (foydalanuvchi ssenariylari bo'yicha).
 *
 * Bu fayl API + baza + buxgalteriya darajasida ishlaydi (haqiqiy Fastify server va haqiqiy PostgreSQL test bazasi).
 * Brauzer UI bu yerda tekshirilmaydi.
 *
 * Ssenariylar: 100 000 so'mlik xarid — (A) faqat naqd, (B) naqd + UZCARD, (C) naqd + UZCARD + bank;
 * har qism alohida "Saqlash" bilan (aralash to'lov alohida funksiya emas). Shuningdek: kam/ortiqcha to'lov,
 * takroriy bosish (idempotentlik), qaytarish va Debit = Kredit tengligi.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts, cashAccounts } from "../src/db/schema/finance.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let piece: string;
let mainWh: string;
let mainCash: string;
let mainBank: string;
let productId: string;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

const call = (cookie: string, method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const owner = () => company.ownerCookie;

const balanceOf = async (id: string) =>
  (await db.select({ balance: cashAccounts.balance }).from(cashAccounts).where(eq(cashAccounts.id, id)))[0]!.balance;
const ledger = async (code: string) =>
  (await db.select({ balance: accounts.balance }).from(accounts).where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code))))[0]?.balance ?? null;

/** Buxgalteriya tengligi: har yozuvda va umumiy — Debit = Kredit. */
async function assertLedgerBalanced() {
  const totals = await db.execute<{ debit: string; credit: string }>(
    sql`select coalesce(sum(debit), 0)::numeric(18,2) as debit, coalesce(sum(credit), 0)::numeric(18,2) as credit
        from journal_lines where company_id = ${company.companyId}`,
  );
  expect(totals.rows[0]!.debit).toBe(totals.rows[0]!.credit);

  const unbalanced = await db.execute<{ entry_id: string }>(
    sql`select entry_id from journal_lines where company_id = ${company.companyId}
        group by entry_id having sum(debit) <> sum(credit)`,
  );
  expect(unbalanced.rows).toHaveLength(0);
}

beforeEach(async () => {
  await resetDatabase();
  await db.delete(units);
  await seedDefaultUnits(db);
  piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Qabul testi do'koni" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  const rows = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));
  mainCash = rows.find((row) => row.type === "cash")!.id;
  mainBank = rows.find((row) => row.type === "bank")!.id;

  const product = await call(owner(), "POST", "/api/catalog/products", {
    name: "Televizor",
    sku: "TV-100",
    baseUnitId: piece,
    salesPrice: "100000",
    taxRate: "0",
  });
  expect(product.statusCode, product.body).toBe(201);
  productId = product.json().product.id;
  expect(
    (await call(owner(), "POST", "/api/inventory/stock/movements", {
      type: "receive",
      productId,
      warehouseId: mainWh,
      quantity: "20",
      costPrice: "50000",
    })).statusCode,
  ).toBe(201);
});

/** UZCARD #01 → alohida "X Bank" hisobi (komissiyasiz — pul to'liq o'sha hisobga). */
async function uzcardTerminal() {
  const bank = await call(owner(), "POST", "/api/finance/cash-accounts", {
    name: "X Bank UZS",
    type: "bank",
    bankName: "X Bank",
    showInPos: true,
  });
  expect(bank.statusCode, bank.body).toBe(201);
  const bankId = bank.json().cashAccount.id as string;
  const terminal = await call(owner(), "POST", "/api/finance/terminals", {
    name: "UZCARD #01",
    network: "uzcard",
    cashAccountId: bankId,
    commissionPercent: "0",
  });
  expect(terminal.statusCode, terminal.body).toBe(201);
  return { bankId, terminalId: terminal.json().terminal.id as string };
}

async function openShift(cookie: string) {
  const shift = await call(cookie, "POST", "/api/sales/pos/shifts", { warehouseId: mainWh, openingCash: "0" });
  expect(shift.statusCode, shift.body).toBe(201);
  return shift.json().shift.id as string;
}

describe("QABUL: kassada to'lov (100 000 so'm)", () => {
  it("A — faqat naqd 100 000: chek yakunlanadi, pul naqd kassaga, jurnal balansli", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const shiftId = await openShift(kassir.cookie);

    const sale = await call(kassir.cookie, "POST", "/api/sales/pos/sales", {
      shiftId,
      items: [{ productId, quantity: "1" }],
      clientRequestId: randomUUID(),
      payments: [{ method: "cash", amount: "100000" }],
    });
    expect(sale.statusCode, sale.body).toBe(201);
    expect(sale.json()).toMatchObject({ paid: "100000.00", change: "0.00", debt: "0.00" });

    expect(await balanceOf(mainCash)).toBe("100000.00");
    expect(await ledger("4000")).toBe("100000.00");
    await assertLedgerBalanced();
  });

  it("B — naqd 50 000 + UZCARD 50 000: har qism o'z hisobiga, alohida 'aralash to'lov' amali kerak emas", async () => {
    const { bankId, terminalId } = await uzcardTerminal();
    const kassir = await addEmployee(app, company, "Kassir");
    const shiftId = await openShift(kassir.cookie);

    const sale = await call(kassir.cookie, "POST", "/api/sales/pos/sales", {
      shiftId,
      items: [{ productId, quantity: "1" }],
      clientRequestId: randomUUID(),
      payments: [
        { method: "cash", amount: "50000" },
        { method: "card", amount: "50000", terminalId },
      ],
    });
    expect(sale.statusCode, sale.body).toBe(201);
    expect(sale.json()).toMatchObject({ paid: "100000.00", change: "0.00", debt: "0.00" });

    expect(await balanceOf(mainCash)).toBe("50000.00");
    // Terminal puli aynan o'ziga bog'langan bank hisobiga tushadi, asosiy bankka emas
    expect(await balanceOf(bankId)).toBe("50000.00");
    expect(await balanceOf(mainBank)).toBe("0.00");
    await assertLedgerBalanced();
  });

  it("C — naqd 30 000 + UZCARD 30 000 + bank 40 000: uchala hisob ham to'g'ri", async () => {
    const { bankId, terminalId } = await uzcardTerminal();
    const kassir = await addEmployee(app, company, "Kassir");
    const shiftId = await openShift(kassir.cookie);

    const sale = await call(kassir.cookie, "POST", "/api/sales/pos/sales", {
      shiftId,
      items: [{ productId, quantity: "1" }],
      clientRequestId: randomUUID(),
      payments: [
        { method: "cash", amount: "30000" },
        { method: "card", amount: "30000", terminalId },
        { method: "bank", amount: "40000", cashAccountId: mainBank },
      ],
    });
    expect(sale.statusCode, sale.body).toBe(201);
    expect(sale.json()).toMatchObject({ paid: "100000.00", change: "0.00", debt: "0.00" });

    expect(await balanceOf(mainCash)).toBe("30000.00");
    expect(await balanceOf(bankId)).toBe("30000.00");
    expect(await balanceOf(mainBank)).toBe("40000.00");
    await assertLedgerBalanced();

    const shift = await call(kassir.cookie, "GET", `/api/sales/pos/shifts/${shiftId}`);
    expect(shift.json().shift).toMatchObject({ totalCash: "30000.00", totalCard: "30000.00", totalBank: "40000.00" });
  });

  it("kam to'lov, ortiqcha to'lov, takroriy bosish va qaytarish", async () => {
    const { bankId, terminalId } = await uzcardTerminal();
    const kassir = await addEmployee(app, company, "Kassir");
    const shiftId = await openShift(kassir.cookie);
    const sell = (payments: object[], clientRequestId = randomUUID(), extra: object = {}) =>
      call(kassir.cookie, "POST", "/api/sales/pos/sales", {
        shiftId,
        items: [{ productId, quantity: "1" }],
        clientRequestId,
        payments,
        ...extra,
      });

    // Kam to'lov: mijozsiz — rad
    const under = await sell([{ method: "cash", amount: "60000" }]);
    expect(under.statusCode, under.body).toBe(400);
    expect(under.json().message).toContain("Mijozsiz");

    // Ortiqcha: naqdsiz (karta) ortiqcha to'lov — qaytim bo'lmaydi, rad
    const over = await sell([{ method: "card", amount: "120000", terminalId }]);
    expect(over.statusCode, over.body).toBe(400);
    expect(over.json().details).toMatchObject({ reason: "overpayment" });

    // Naqd qism bo'lsa ortig'i qaytim bo'ladi
    const change = await sell([
      { method: "cash", amount: "80000" },
      { method: "card", amount: "30000", terminalId },
    ]);
    expect(change.statusCode, change.body).toBe(201);
    expect(change.json()).toMatchObject({ paid: "100000.00", change: "10000.00", debt: "0.00" });
    expect(await balanceOf(mainCash)).toBe("70000.00");
    expect(await balanceOf(bankId)).toBe("30000.00");

    // Takroriy bosish — ikkinchi chek yaratilmaydi
    const key = randomUUID();
    const first = await sell([{ method: "cash", amount: "100000" }], key);
    expect(first.statusCode, first.body).toBe(201);
    const repeat = await sell([{ method: "cash", amount: "100000" }], key);
    expect(repeat.statusCode).toBe(409);
    expect(await balanceOf(mainCash)).toBe("170000.00");

    // Qaytarish — pul asl hisobdan qaytadi
    const orderId = first.json().order.id as string;
    const refund = await call(owner(), "POST", `/api/sales/orders/${orderId}/return`, {});
    expect([200, 201], refund.body).toContain(refund.statusCode);
    expect(refund.json()).toMatchObject({ refunded: "100000.00" });
    expect(await balanceOf(mainCash)).toBe("70000.00");
    await assertLedgerBalanced();
  });
});

describe("QABUL: universal to'lov taqsimoti (kassadan tashqari)", () => {
  it("mijoz qarzini aralash usulda to'lash: qism hisoblarga, ortiqcha rad, takroriy so'rov bir marta", async () => {
    const { bankId, terminalId } = await uzcardTerminal();
    const customerId = (await call(owner(), "POST", "/api/sales/customers", { name: "Qarzdor mijoz" })).json().customer.id as string;

    // Nasiya chek — mijozda 100 000 qarz
    const kassir = await addEmployee(app, company, "Kassir");
    const shiftId = await openShift(kassir.cookie);
    const credit = await call(kassir.cookie, "POST", "/api/sales/pos/sales", {
      shiftId,
      items: [{ productId, quantity: "1" }],
      clientRequestId: randomUUID(),
      customerId,
      onCredit: true,
      // Nasiya: to'lov yo'q — sxema `amountPaid` yoki `payments` dan birini talab qiladi
      amountPaid: "0",
    });
    expect(credit.statusCode, credit.body).toBe(201);
    expect(credit.json()).toMatchObject({ debt: "100000.00" });

    // Qarzdan ortiq to'lov — rad
    const tooMuch = await call(owner(), "POST", "/api/sales/payments", {
      customerId,
      parts: [{ method: "cash", amount: "150000" }],
    });
    expect(tooMuch.statusCode, tooMuch.body).toBe(400);

    // 50 000 naqd + 50 000 UZCARD — bitta so'rovda
    const reference = randomUUID();
    const paid = await call(owner(), "POST", "/api/sales/payments", {
      customerId,
      reference,
      parts: [
        { method: "cash", amount: "50000" },
        { method: "card", amount: "50000", terminalId },
      ],
    });
    expect(paid.statusCode, paid.body).toBe(201);
    expect(await balanceOf(mainCash)).toBe("50000.00");
    expect(await balanceOf(bankId)).toBe("50000.00");

    // Takroriy so'rov (bir xil reference) — ikkinchi marta yozilmaydi
    const again = await call(owner(), "POST", "/api/sales/payments", {
      customerId,
      reference,
      parts: [
        { method: "cash", amount: "50000" },
        { method: "card", amount: "50000", terminalId },
      ],
    });
    expect([200, 409]).toContain(again.statusCode);
    expect(await balanceOf(mainCash)).toBe("50000.00");
    await assertLedgerBalanced();
  });
});
