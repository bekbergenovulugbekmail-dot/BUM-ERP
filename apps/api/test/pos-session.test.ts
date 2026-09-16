/**
 * KASSA SESSIYASI — barcha to'lov usullari sessiyaga bog'lanishi va yopishda solishtirish.
 *
 * Naqd uchun fizik qoldiq sanaladi; karta/terminal uchun "naqd qoldiq" so'ralmaydi, lekin sessiya
 * bo'yicha summa, tranzaksiyalar soni va pul tushgan bank hisobi ko'rinadi.
 */
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { cashAccounts } from "../src/db/schema/finance.js";
import { customerPayments } from "../src/db/schema/sales.js";
import { buildServer } from "../src/server.js";
import { caller, deliveryCompany, resetUnits, type DeliveryCompany } from "./delivery-setup.js";
import { addEmployee, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let call: ReturnType<typeof caller>;
let company: DeliveryCompany;
let mainCash: string;
let mainBank: string;
let secondBank: string;
let uzcard: { id: string };
let humo: { id: string };
let kassir: { cookie: string };

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
  call = caller(app);
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
  await resetUnits();
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await deliveryCompany(app, admin.cookie, "Sessiya do'koni");
  const accounts = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));
  mainCash = accounts.find((row) => row.type === "cash")!.id;
  mainBank = accounts.find((row) => row.type === "bank")!.id;
  secondBank = (await call(owner(), "POST", "/api/finance/cash-accounts", { name: "Ikkinchi bank", type: "bank", bankName: "Hamkorbank" })).json()
    .cashAccount.id as string;
  uzcard = (await call(owner(), "POST", "/api/finance/terminals", { name: "UZCARD #01", network: "uzcard", cashAccountId: mainBank })).json().terminal;
  humo = (await call(owner(), "POST", "/api/finance/terminals", { name: "HUMO #01", network: "humo", cashAccountId: secondBank })).json().terminal;
  kassir = await addEmployee(app, company, "Kassir");
});

const owner = () => company.ownerCookie;

/** Sessiyani boshlang'ich naqd bilan ochadi. */
async function openSession(openingCash: string) {
  const res = await call(kassir.cookie, "POST", "/api/sales/pos/shifts", { warehouseId: company.warehouseId, openingCash });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().shift as { id: string; openingCash: string };
}

/** 20 × 5 000 = 100 000 so'mlik chek. */
const sell = (shiftId: string, payload: object) =>
  call(kassir.cookie, "POST", "/api/sales/pos/sales", {
    shiftId,
    items: [{ productId: company.productId, quantity: "20" }],
    ...payload,
  });

const shiftOf = async (shiftId: string) => (await call(kassir.cookie, "GET", `/api/sales/pos/shifts/${shiftId}`)).json().shift;

describe("Kassa sessiyasi: to'lov usullari sessiyaga bog'lanadi", () => {
  it("naqd + UZCARD: ikkala qism ham sessiyaga bog'lanadi, terminal va bank ko'rinadi", async () => {
    const shift = await openSession("500000");

    const sale = await sell(shift.id, {
      payments: [
        { method: "cash", amount: "50000" },
        { method: "card", amount: "50000", terminalId: uzcard.id },
      ],
    });
    expect(sale.statusCode, sale.body).toBe(201);

    // Har ikkala to'lov yozuvi sessiyaga bog'langan
    const rows = await db
      .select({ method: customerPayments.method, amount: customerPayments.amount, shiftId: customerPayments.posShiftId })
      .from(customerPayments)
      .where(and(eq(customerPayments.companyId, company.companyId), eq(customerPayments.posShiftId, shift.id)));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.shiftId === shift.id)).toBe(true);

    // Sessiya javobida usul va terminal kesimi
    const detail = await shiftOf(shift.id);
    expect(detail).toMatchObject({ totalCash: "50000.00", totalCard: "50000.00", totalSales: "100000.00", receiptCount: 1 });

    const cash = detail.payments.find((row: { method: string }) => row.method === "cash");
    expect(cash).toMatchObject({ amount: "50000.00", count: 1, accountName: "Asosiy kassa" });

    const card = detail.payments.find((row: { method: string }) => row.method === "card");
    expect(card).toMatchObject({ amount: "50000.00", count: 1, terminalName: "UZCARD #01", network: "uzcard" });
    // Pul AYNAN terminalga bog'langan bank hisobiga tushdi
    expect(card.accountName).toBe((await db.select().from(cashAccounts).where(eq(cashAccounts.id, mainBank)))[0]!.name);
  });

  it("uch usulli to'lov: naqd + UZCARD + HUMO — uchala qism bitta sessiyada, uch xil hisobda", async () => {
    const shift = await openSession("0");

    const sale = await sell(shift.id, {
      payments: [
        { method: "cash", amount: "40000" },
        { method: "card", amount: "30000", terminalId: uzcard.id },
        { method: "card", amount: "30000", terminalId: humo.id },
      ],
    });
    expect(sale.statusCode, sale.body).toBe(201);

    const detail = await shiftOf(shift.id);
    expect(detail.payments).toHaveLength(3);
    const byTerminal = Object.fromEntries(
      detail.payments.filter((row: { terminalName: string | null }) => row.terminalName).map((row: { terminalName: string; amount: string }) => [row.terminalName, row.amount]),
    );
    expect(byTerminal).toEqual({ "UZCARD #01": "30000.00", "HUMO #01": "30000.00" });
    expect(detail.totalCash).toBe("40000.00");
    expect(detail.totalCard).toBe("60000.00");

    // Har terminal o'z bankiga
    const balances = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));
    expect(balances.find((row) => row.id === mainBank)!.balance).toBe("30000.00");
    expect(balances.find((row) => row.id === secondBank)!.balance).toBe("30000.00");
    expect(balances.find((row) => row.id === mainCash)!.balance).toBe("40000.00");
  });
});

describe("Kassa sessiyasini yopish", () => {
  it("kutilayotgan naqd = boshlang'ich + naqd savdo; karta alohida ko'rinadi", async () => {
    const shift = await openSession("500000");
    await sell(shift.id, {
      payments: [
        { method: "cash", amount: "50000" },
        { method: "card", amount: "50000", terminalId: uzcard.id },
      ],
    });

    const before = await shiftOf(shift.id);
    // Kutilayotgan naqd kartani O'Z ICHIGA OLMAYDI
    expect(before.expectedCash).toBe("550000.00");

    const closed = await call(kassir.cookie, "POST", `/api/sales/pos/shifts/${shift.id}/close`, { closingCash: "550000" });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json().shift).toMatchObject({ status: "closed", closingCash: "550000.00", cashDifference: "0.00" });
  });

  it("naqd kam bo'lsa farq yoziladi va yashirib bo'lmaydi", async () => {
    const shift = await openSession("500000");
    await sell(shift.id, { paymentMethod: "cash", amountPaid: "100000" });

    const closed = await call(kassir.cookie, "POST", `/api/sales/pos/shifts/${shift.id}/close`, { closingCash: "580000" });
    expect(closed.statusCode, closed.body).toBe(200);
    // Kutilgan 600 000, sanalgan 580 000 → farq −20 000
    expect(closed.json().shift.cashDifference).toBe("-20000.00");
  });

  it("sessiya yopilgandan keyin yangi sotuv SERVER tomonidan rad etiladi", async () => {
    const shift = await openSession("0");
    await sell(shift.id, { paymentMethod: "cash", amountPaid: "100000" });
    expect((await call(kassir.cookie, "POST", `/api/sales/pos/shifts/${shift.id}/close`, { closingCash: "100000" })).statusCode).toBe(200);

    const after = await sell(shift.id, { paymentMethod: "cash", amountPaid: "100000" });
    expect(after.statusCode).toBe(400);
    expect(after.json().message).toContain("Smena yopilgan");
  });

  it("parallel ikki marta yopishga urinish — bir marta yopiladi", async () => {
    const shift = await openSession("0");
    const body = { closingCash: "0" };
    const results = await Promise.all([
      call(kassir.cookie, "POST", `/api/sales/pos/shifts/${shift.id}/close`, body),
      call(kassir.cookie, "POST", `/api/sales/pos/shifts/${shift.id}/close`, body),
    ]);
    expect(results.filter((res) => res.statusCode === 200)).toHaveLength(1);
  });

  it("bitta omborda ikkita ochiq sessiya bo'lmaydi", async () => {
    await openSession("0");
    const second = await call(kassir.cookie, "POST", "/api/sales/pos/shifts", { warehouseId: company.warehouseId, openingCash: "0" });
    expect(second.statusCode).toBe(409);
  });
});
