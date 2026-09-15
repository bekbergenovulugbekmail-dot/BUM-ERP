import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { products } from "../src/db/schema/catalog.js";
import { deliveryPayments } from "../src/db/schema/delivery.js";
import { accounts, cashAccounts, cashTransactions, paymentTerminals } from "../src/db/schema/finance.js";
import { customerPayments, customers, payments, salesOrderItems, salesReturns } from "../src/db/schema/sales.js";
import { buildServer } from "../src/server.js";
import { NO_PROOFS, arrivedTask, caller, deliveryAgent, deliveryCompany, resetUnits, setPolicy, startShift, type DeliveryCompany } from "./delivery-setup.js";
import { addEmployee, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let call: ReturnType<typeof caller>;
let adminCookie: string;
let company: DeliveryCompany;
let mainCash: string;
let mainBank: string;
let secondBank: string;

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
  adminCookie = (await signedIn(app, { isPlatformAdmin: true })).cookie;
  company = await deliveryCompany(app, adminCookie, "Terminal do'kon");
  const rows = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));
  mainCash = rows.find((row) => row.type === "cash")!.id;
  mainBank = rows.find((row) => row.type === "bank")!.id;
  const bank = await call(company.ownerCookie, "POST", "/api/finance/cash-accounts", { name: "Hamkorbank hisobi", type: "bank", bankName: "Hamkorbank" });
  expect(bank.statusCode, bank.body).toBe(201);
  secondBank = bank.json().cashAccount.id;
});

const owner = () => company.ownerCookie;
const balanceOf = async (id: string) => (await db.select({ balance: cashAccounts.balance }).from(cashAccounts).where(eq(cashAccounts.id, id)))[0]!.balance;
const ledger = async (companyId: string, code: string) =>
  (await db.select({ balance: accounts.balance }).from(accounts).where(and(eq(accounts.companyId, companyId), eq(accounts.code, code))))[0]!.balance;
const debtOf = async (customerId: string) => (await db.select({ totalDebt: customers.totalDebt }).from(customers).where(eq(customers.id, customerId)))[0]!.totalDebt;

async function terminal(cookie: string, body: Record<string, unknown>) {
  const res = await call(cookie, "POST", "/api/finance/terminals", body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json().terminal as { id: string; cashAccountId: string };
}

/** UZCARD → asosiy bank (buxgalteriyada alohida 1021), HUMO → Hamkorbank (umumiy 1020). */
async function twoTerminals() {
  const ledgerAccount = await call(owner(), "POST", "/api/finance/accounts", { code: "1021", name: "Asosiy bank UZS", type: "asset" });
  expect(ledgerAccount.statusCode, ledgerAccount.body).toBe(201);
  const linked = await call(owner(), "PATCH", `/api/finance/cash-accounts/${mainBank}`, { ledgerAccountId: ledgerAccount.json().account.id });
  expect(linked.statusCode, linked.body).toBe(200);
  const uzcard = await terminal(owner(), { name: "UZCARD kassa 1", network: "uzcard", provider: "Asosiy bank", cashAccountId: mainBank, terminalIdentifier: "TID-0001" });
  const humo = await terminal(owner(), { name: "HUMO kassa 1", network: "humo", cashAccountId: secondBank });
  return { uzcard, humo };
}

async function openShift(cookie: string) {
  const res = await call(cookie, "POST", "/api/sales/pos/shifts", { warehouseId: company.warehouseId, openingCash: "0" });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().shift.id as string;
}

describe("To'lov terminallari va universal aralash to'lov", () => {
  it("terminal: bank hisobiga bog'lanadi, noto'g'ri hisob/kompaniya rad, kassir faqat ro'yxatni ko'radi, faolsizlantirish", async () => {
    const other = await deliveryCompany(app, adminCookie, "Boshqa kompaniya");
    const otherBank = (await db.select().from(cashAccounts).where(and(eq(cashAccounts.companyId, other.companyId), eq(cashAccounts.type, "bank"))))[0]!.id;
    const { uzcard, humo } = await twoTerminals();

    expect((await call(owner(), "POST", "/api/finance/terminals", { name: "Naqd kassaga", network: "visa", cashAccountId: mainCash })).statusCode).toBe(400);
    expect((await call(owner(), "POST", "/api/finance/terminals", { name: "Begona bank", network: "uzcard", cashAccountId: otherBank })).statusCode).toBe(404);
    expect((await call(owner(), "POST", "/api/finance/terminals", { name: "UZCARD kassa 1", network: "uzcard", cashAccountId: mainBank })).statusCode).toBe(409);
    expect((await call(owner(), "POST", "/api/finance/terminals", { name: "Takror TID", network: "uzcard", cashAccountId: mainBank, terminalIdentifier: "TID-0001" })).statusCode).toBe(409);
    expect((await call(owner(), "POST", "/api/finance/terminals", { name: "Noma'lum", network: "amex", cashAccountId: mainBank })).statusCode).toBe(400);

    const list = (await call(owner(), "GET", "/api/finance/terminals")).json().terminals;
    expect(list).toMatchObject([
      { name: "HUMO kassa 1", network: "humo", cashAccountId: secondBank, bankName: "Hamkorbank", isActive: true },
      { name: "UZCARD kassa 1", network: "uzcard", cashAccountId: mainBank, terminalIdentifier: "TID-0001" },
    ]);

    // Boshqa kompaniya A terminalini ko'rmaydi va o'zgartira olmaydi
    expect((await call(other.ownerCookie, "GET", "/api/finance/terminals")).json().terminals).toEqual([]);
    expect((await call(other.ownerCookie, "PATCH", `/api/finance/terminals/${uzcard.id}`, { isActive: false })).statusCode).toBe(404);
    expect((await call(other.ownerCookie, "GET", `/api/finance/terminals/${uzcard.id}`)).statusCode).toBe(404);

    // Kassir: moliya ruxsatisiz — hisob tafsilotisiz faol terminallar ro'yxati
    const kassir = await addEmployee(app, company, "Kassir");
    expect((await call(kassir.cookie, "GET", "/api/finance/terminals")).statusCode).toBe(403);
    expect((await call(kassir.cookie, "POST", "/api/finance/terminals", { name: "Kassir", network: "uzcard", cashAccountId: mainBank })).statusCode).toBe(403);
    const options = (await call(kassir.cookie, "GET", "/api/sales/pos/payment-options")).json();
    expect(options.terminals).toHaveLength(2);
    expect(options.terminals[0]).not.toHaveProperty("cashAccountId");

    expect((await call(owner(), "PATCH", `/api/finance/terminals/${humo.id}`, { isActive: false })).statusCode).toBe(200);
    expect((await call(kassir.cookie, "GET", "/api/sales/pos/payment-options")).json().terminals).toMatchObject([{ id: uzcard.id }]);
    // O'chirilmaydi — faolsizlantirilgan terminal saqlanadi
    expect(await db.select().from(paymentTerminals).where(eq(paymentTerminals.companyId, company.companyId))).toHaveLength(2);
  });

  it("POS: naqd + UZCARD + HUMO — har qism o'z hisobiga va buxgalteriyasiga; kam/ortiq to'lov, nasiya, takroriy bosish, begona terminal; qaytarish asl hisobdan", async () => {
    const other = await deliveryCompany(app, adminCookie, "Boshqa kompaniya");
    const foreignTerminal = await terminal(other.ownerCookie, {
      name: "Begona UZCARD",
      network: "uzcard",
      cashAccountId: (await db.select().from(cashAccounts).where(and(eq(cashAccounts.companyId, other.companyId), eq(cashAccounts.type, "bank"))))[0]!.id,
    });
    const { uzcard, humo } = await twoTerminals();
    const kassir = await addEmployee(app, company, "Kassir");
    const shiftId = await openShift(kassir.cookie);
    const sell = (body: Record<string, unknown>) =>
      call(kassir.cookie, "POST", "/api/sales/pos/sales", { shiftId, items: [{ productId: company.productId, quantity: "4" }], ...body });
    const MIXED = [
      { method: "cash", amount: "5000" },
      { method: "card", amount: "8000", terminalId: uzcard.id },
      { method: "card", amount: "7000", terminalId: humo.id },
    ];

    // 4 × 5000 = 20000. Rad etiladiganlar — hech narsa yozilmaydi
    const rejected = [
      [{ method: "cash", amount: "5000", terminalId: uzcard.id }],
      [{ method: "card", amount: "20000", terminalId: foreignTerminal.id }],
      [{ method: "card", amount: "20000", cashAccountId: mainCash }],
      [{ method: "card", amount: "10000", terminalId: uzcard.id }, { method: "card", amount: "10000", terminalId: uzcard.id }],
    ];
    expect((await sell({ payments: rejected[0] })).statusCode).toBe(400);
    expect((await sell({ payments: rejected[1] })).statusCode).toBe(404);
    expect((await sell({ payments: rejected[2] })).statusCode).toBe(400);
    expect((await sell({ payments: rejected[3] })).statusCode).toBe(400);
    const over = await sell({ payments: [...MIXED.slice(0, 2), { method: "card", amount: "9000", terminalId: humo.id }] });
    expect(over.statusCode).toBe(400);
    expect(over.json().details).toMatchObject({ reason: "overpayment" });
    const under = await sell({ payments: MIXED.slice(0, 2) });
    expect(under.statusCode).toBe(400);
    expect(under.json().message).toContain("Mijozsiz");
    const underWithCustomer = await sell({ customerId: company.customerId, payments: MIXED.slice(0, 2) });
    expect(underWithCustomer.statusCode).toBe(400);
    expect(underWithCustomer.json().details).toMatchObject({ reason: "underpayment", remaining: "7000.00" });
    expect(await db.select().from(payments).where(eq(payments.companyId, company.companyId))).toHaveLength(0);

    const clientRequestId = randomUUID();
    const sale = await sell({ clientRequestId, payments: MIXED });
    expect(sale.statusCode, sale.body).toBe(201);
    expect(sale.json()).toMatchObject({
      paid: "20000.00",
      change: "0.00",
      debt: "0.00",
      payments: [
        { method: "cash", amount: "5000.00" },
        { method: "card", amount: "8000.00", terminalId: uzcard.id },
        { method: "card", amount: "7000.00", terminalId: humo.id },
      ],
    });
    const orderId = sale.json().order.id as string;
    // Ikki marta bosish / tarmoq qayta urinishi — ikkinchi chek va to'lov yo'q
    expect((await sell({ clientRequestId, payments: MIXED })).statusCode).toBe(409);

    const [header] = await db.select().from(payments).where(eq(payments.orderId, orderId));
    expect(header).toMatchObject({ source: "pos", totalAmount: "20000.00", idempotencyKey: `pos:${clientRequestId}` });
    const rows = await db.select().from(customerPayments).where(eq(customerPayments.orderId, orderId));
    expect(rows.map((row) => [row.method, row.amount, row.terminalId, row.cashAccountId, row.paymentId]).sort()).toEqual(
      [
        ["card", "7000.00", humo.id, secondBank, header!.id],
        ["card", "8000.00", uzcard.id, mainBank, header!.id],
        ["cash", "5000.00", null, mainCash, header!.id],
      ].sort(),
    );
    expect([await balanceOf(mainCash), await balanceOf(mainBank), await balanceOf(secondBank)]).toEqual(["5000.00", "8000.00", "7000.00"]);
    expect([await ledger(company.companyId, "1010"), await ledger(company.companyId, "1021"), await ledger(company.companyId, "1020")]).toEqual([
      "5000.00",
      "8000.00",
      "7000.00",
    ]);
    const shift = (await call(kassir.cookie, "GET", `/api/sales/pos/shifts/${shiftId}`)).json().shift;
    expect(shift).toMatchObject({ totalCash: "5000.00", totalCard: "15000.00", receiptCount: 1 });

    // Bitta naqd to'lovda qaytim — odatiy; nasiya — faqat belgilanganda
    expect((await sell({ items: [{ productId: company.productId, quantity: "1" }], paymentMethod: "cash", amountPaid: "10000" })).json()).toMatchObject({ change: "5000.00" });
    const credit = await sell({ customerId: company.customerId, onCredit: true, payments: [{ method: "card", amount: "12000", terminalId: uzcard.id }] });
    expect(credit.statusCode, credit.body).toBe(201);
    expect(credit.json()).toMatchObject({ paid: "12000.00", debt: "8000.00" });

    // Qaytarish: 3 dona (15000) kartaga — UZCARD qismi asosiy bankdan, HUMO qismi Hamkorbankdan
    const [line] = await db.select().from(salesOrderItems).where(eq(salesOrderItems.orderId, orderId));
    const back = await call(owner(), "POST", `/api/sales/orders/${orderId}/return-items`, {
      items: [{ orderItemId: line!.id, quantity: "3" }],
      refundMethod: "card",
      refunds: [{ method: "card", amount: "15000" }],
    });
    expect(back.statusCode, back.body).toBe(201);
    expect(await balanceOf(secondBank)).toBe("0.00");
    expect(await ledger(company.companyId, "1020")).toBe("0.00");
    // Asosiy bank: savdodan 8000 + nasiya chekidagi 12000 − qaytgan 8000
    expect(await balanceOf(mainBank)).toBe("12000.00");
    const [stored] = await db.select({ refunds: salesReturns.refunds }).from(salesReturns).where(eq(salesReturns.orderId, orderId));
    const byAccount = (list: { method: string; amount: string; cashAccountId?: string | null }[]) =>
      list.map((part) => `${part.method}:${part.amount}:${part.cashAccountId}`).sort();
    expect(byAccount(stored!.refunds!)).toEqual([`card:7000.00:${secondBank}`, `card:8000.00:${mainBank}`].sort());
    // Har hisob qismi — alohida kassa harakati (havolalar takrorlanmaydi)
    const outs = await db
      .select({ referenceType: cashTransactions.referenceType, cashAccountId: cashTransactions.cashAccountId, amount: cashTransactions.amount })
      .from(cashTransactions)
      .where(and(eq(cashTransactions.companyId, company.companyId), eq(cashTransactions.type, "out")));
    expect(outs.map((row) => `${row.cashAccountId}:${row.amount}`).sort()).toEqual([`${mainBank}:8000.00`, `${secondBank}:7000.00`].sort());
    expect(outs.map((row) => row.referenceType).sort()).toEqual(["sales_return_card", "sales_return_card_2"]);
  });

  it("qarz to'lovi: aralash qismlar (moliya va kassada), takroriy kalit, qarzdan ortig'i rad, begona hisob rad", async () => {
    const other = await deliveryCompany(app, adminCookie, "Boshqa kompaniya");
    const otherCash = (await db.select().from(cashAccounts).where(and(eq(cashAccounts.companyId, other.companyId), eq(cashAccounts.type, "cash"))))[0]!.id;
    const { uzcard, humo } = await twoTerminals();
    const kassir = await addEmployee(app, company, "Kassir");
    const shiftId = await openShift(kassir.cookie);
    const credit = await call(kassir.cookie, "POST", "/api/sales/pos/sales", {
      shiftId,
      customerId: company.customerId,
      items: [{ productId: company.productId, quantity: "4" }],
      paymentMethod: "cash",
      amountPaid: "0",
      onCredit: true,
    });
    expect(credit.statusCode, credit.body).toBe(201);
    expect(await debtOf(company.customerId)).toBe("20000.00");

    const pay = (body: Record<string, unknown>) => call(owner(), "POST", "/api/sales/payments", { customerId: company.customerId, ...body });
    expect((await pay({ parts: [{ method: "cash", amount: "1000", cashAccountId: otherCash }] })).statusCode).toBe(404);
    expect((await pay({ parts: [{ method: "cash", amount: "15000" }, { method: "card", amount: "6000", terminalId: uzcard.id }] })).statusCode).toBe(400);
    expect(await debtOf(company.customerId)).toBe("20000.00");

    const parts = [
      { method: "cash", amount: "5000" },
      { method: "card", amount: "6000", terminalId: uzcard.id },
      { method: "bank", amount: "4000", cashAccountId: secondBank },
    ];
    const first = await pay({ parts, reference: "QARZ-1" });
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json().allocations).toHaveLength(3);
    const again = await pay({ parts, reference: "QARZ-1" });
    expect(again.statusCode).toBe(200);
    expect(await debtOf(company.customerId)).toBe("5000.00");
    expect(await db.select().from(payments).where(eq(payments.source, "sales_payment"))).toHaveLength(1);
    expect([await balanceOf(mainCash), await balanceOf(mainBank), await balanceOf(secondBank)]).toEqual(["5000.00", "6000.00", "4000.00"]);

    // Kassada: naqd 2000 + HUMO 3000, keyin qarz 0 — ortiqcha to'lov rad
    const posPay = (body: Record<string, unknown>) =>
      call(kassir.cookie, "POST", `/api/sales/pos/customers/${company.customerId}/payments`, { shiftId, purpose: "debt", ...body });
    const key = randomUUID();
    const kassa = await posPay({ clientRequestId: key, parts: [{ method: "cash", amount: "2000" }, { method: "card", amount: "3000", terminalId: humo.id }] });
    expect(kassa.statusCode, kassa.body).toBe(201);
    expect(kassa.json().shift).toMatchObject({ totalCash: "2000.00", totalCard: "3000.00" });
    expect((await posPay({ clientRequestId: key, parts: [{ method: "cash", amount: "2000" }, { method: "card", amount: "3000", terminalId: humo.id }] })).statusCode).toBe(201);
    expect((await call(kassir.cookie, "GET", `/api/sales/pos/shifts/${shiftId}`)).json().shift).toMatchObject({ totalCash: "2000.00", totalCard: "3000.00" });
    expect(await debtOf(company.customerId)).toBe("0.00");
    const extra = await posPay({ parts: [{ method: "cash", amount: "1000" }] });
    expect(extra.statusCode).toBe(400);
    expect(extra.json().details).toMatchObject({ reason: "overpayment" });
    // Bir usulli bank to'lovi smenada bank tushumi sifatida
    expect((await posPay({ purpose: "deposit", method: "bank", amount: "1500" })).json().shift).toMatchObject({ totalBank: "1500.00" });
  });

  it("dostavka: aralash yig'ish faqat ruxsat etilgan usullarda, terminal hisobi, takroriy so'rov, ortiqcha rad", async () => {
    await setPolicy(app, owner(), { ...NO_PROOFS, collectionMethods: ["cash", "card"] });
    const { uzcard } = await twoTerminals();
    const agent = await deliveryAgent(app, company);
    await startShift(app, agent.cookie);
    const { orderId, taskId } = await arrivedTask(app, company, agent, "10");

    const options = (await call(agent.cookie, "GET", "/api/delivery/agent/payment-options")).json();
    expect(options.methods).toEqual(["cash", "card"]);
    expect(options.terminals.map((item: { network: string }) => item.network).sort()).toEqual(["humo", "uzcard"]);
    expect(options.terminals[0]).not.toHaveProperty("cashAccountId");

    const collect = (body: Record<string, unknown>) => call(agent.cookie, "POST", `/api/delivery/agent/tasks/${taskId}/payments`, body);
    const bank = await collect({ clientRequestId: randomUUID(), parts: [{ method: "bank", amount: "50000" }] });
    expect(bank.statusCode).toBe(400);
    expect(bank.json().details).toMatchObject({ reason: "payment_method_not_allowed" });
    const over = await collect({ clientRequestId: randomUUID(), parts: [{ method: "cash", amount: "30000" }, { method: "card", amount: "30000", terminalId: uzcard.id }] });
    expect(over.statusCode).toBe(400);
    expect(over.json().details).toMatchObject({ reason: "overpayment" });

    const key = randomUUID();
    const parts = [
      { method: "cash", amount: "20000" },
      { method: "card", amount: "30000", terminalId: uzcard.id },
    ];
    const paid = await collect({ clientRequestId: key, parts });
    expect(paid.statusCode, paid.body).toBe(201);
    expect(paid.json().payments).toHaveLength(2);
    expect(paid.json().task.collectedAmount).toBe("50000.00");
    expect((await collect({ clientRequestId: key, parts })).statusCode).toBe(200);
    expect(await db.select().from(deliveryPayments).where(eq(deliveryPayments.taskId, taskId))).toHaveLength(2);
    const rows = await db.select().from(customerPayments).where(eq(customerPayments.orderId, orderId));
    // Naqd qism asosiy kassaga emas — yetkazuvchining "yo'ldagi naqd" hisobiga (kassaga topshirilguncha)
    const [agentCash] = await db.select().from(cashAccounts).where(eq(cashAccounts.deliveryAgentId, agent.id));
    expect(agentCash).toMatchObject({ type: "cash", balance: "20000.00" });
    expect(agentCash!.id).not.toBe(mainCash);
    expect(rows.map((row) => `${row.method}:${row.amount}:${row.cashAccountId}:${row.terminalId}`).sort()).toEqual(
      [`card:30000.00:${mainBank}:${uzcard.id}`, `cash:20000.00:${agentCash!.id}:null`].sort(),
    );
    expect(await db.select().from(payments).where(eq(payments.source, "delivery"))).toMatchObject([{ totalAmount: "50000.00", idempotencyKey: `delivery:${key}` }]);
    expect(await ledger(company.companyId, "1021")).toBe("30000.00");
  });

  it("desktop kassa: terminallar config bilan sinxronlanadi (xesh o'zgaradi); oflayn chek terminal bo'yicha bank hisobiga, begona terminal rad", async () => {
    const { uzcard, humo } = await twoTerminals();
    const kassir = await addEmployee(app, company, "Kassir");
    const registered = await app.inject({
      method: "POST",
      url: "/api/pos-device/setup/register",
      payload: { phone: company.owner.phone, password: company.owner.password, warehouseId: company.warehouseId, name: "Kassa 1" },
    });
    expect(registered.statusCode, registered.body).toBe(201);
    const headers = { authorization: `Bearer ${registered.json().token as string}` };
    // Kassir kassada parol bilan kiradi (qurilma amallari bog'langan kassir nomidan)
    const cashierLogin = await app.inject({ method: "POST", url: "/api/pos-device/cashiers/login", headers, payload: { phone: kassir.phone, password: "xodim-parol-123" } });
    expect(cashierLogin.statusCode, cashierLogin.body).toBe(200);
    type SyncedConfig = {
      hash: string;
      terminals: { id: string; name: string; network: string }[];
      bankAccounts: { id: string; name: string; bankName: string | null }[];
    } | null;
    const pull = async (configHash?: string) => {
      const res = await app.inject({ method: "POST", url: "/api/pos-device/pull", headers, payload: { limit: 1, ...(configHash ? { configHash } : {}) } });
      expect(res.statusCode, res.body).toBe(200);
      return res.json().config as SyncedConfig;
    };

    const first = await pull();
    expect(first!.terminals.map((terminal) => terminal.network).sort()).toEqual(["humo", "uzcard"]);
    expect(first!.terminals[0]).not.toHaveProperty("cashAccountId");
    expect(await pull(first!.hash)).toBeNull();

    const op = (type: string, payload: object, minutesAgo: number) => ({
      opId: randomUUID(),
      type,
      cashierId: kassir.id,
      createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      payload,
    });
    const push = async (ops: object[]) => {
      const res = await app.inject({ method: "POST", url: "/api/pos-device/push", headers, payload: { ops } });
      expect(res.statusCode, res.body).toBe(200);
      return res.json().results as { status: string; result?: Record<string, unknown>; error?: { code: string; message: string } }[];
    };
    const [product] = await db.select({ baseUnitId: products.baseUnitId }).from(products).where(eq(products.id, company.productId));
    const saleOp = (number: string, payments: object[], minutesAgo: number) => {
      const saleId = randomUUID();
      return {
        saleId,
        op: op(
          "sale.complete",
          {
            saleId,
            shiftId,
            number,
            items: [{ id: randomUUID(), productId: company.productId, unitId: product!.baseUnitId, quantity: "4", unitPrice: "5000" }],
            paymentMethod: "card",
            amountPaid: "20000",
            payments,
          },
          minutesAgo,
        ),
      };
    };
    const shiftId = randomUUID();
    expect((await push([op("shift.open", { shiftId, openingCash: "0" }, 30)]))[0]!.status).toBe("applied");

    // Chek HUMO faol paytida yopilgan; terminal keyin faolsizlantirilsa ham oflayn chek rad etilmaydi
    const sale = saleOp("K01-000001", [
      { method: "cash", amount: "5000" },
      { method: "card", amount: "8000", terminalId: uzcard.id },
      { method: "card", amount: "7000", terminalId: humo.id },
    ], 20);
    expect((await call(owner(), "PATCH", `/api/finance/terminals/${humo.id}`, { isActive: false })).statusCode).toBe(200);
    const second = await pull(first!.hash);
    expect(second!.hash).not.toBe(first!.hash);
    expect(second!.terminals.map((terminal) => terminal.id)).toEqual([uzcard.id]);

    const [sold] = await push([sale.op]);
    expect(sold, JSON.stringify(sold)).toMatchObject({ status: "applied", result: { paid: "20000.00" } });
    const rows = await db.select().from(customerPayments).where(eq(customerPayments.orderId, sale.saleId));
    expect(rows.map((row) => `${row.method}:${row.amount}:${row.terminalId}:${row.cashAccountId}`).sort()).toEqual(
      [`card:7000.00:${humo.id}:${secondBank}`, `card:8000.00:${uzcard.id}:${mainBank}`, `cash:5000.00:null:${mainCash}`].sort(),
    );
    const [header] = await db.select().from(payments).where(eq(payments.orderId, sale.saleId));
    expect(header).toMatchObject({ source: "pos_device", idempotencyKey: `pos_device:${sale.saleId}`, totalAmount: "20000.00" });
    expect([await balanceOf(mainBank), await balanceOf(secondBank)]).toEqual(["8000.00", "7000.00"]);

    // Begona kompaniya terminali — amal rad etiladi, pul yozilmaydi
    const other = await deliveryCompany(app, adminCookie, "Boshqa kompaniya");
    const foreign = await terminal(other.ownerCookie, {
      name: "Begona UZCARD",
      network: "uzcard",
      cashAccountId: (await db.select().from(cashAccounts).where(and(eq(cashAccounts.companyId, other.companyId), eq(cashAccounts.type, "bank"))))[0]!.id,
    });
    const stolen = saleOp("K01-000002", [{ method: "card", amount: "20000", terminalId: foreign.id }], 10);
    const [rejected] = await push([stolen.op]);
    expect(rejected).toMatchObject({ status: "rejected" });
    expect(await db.select().from(customerPayments).where(eq(customerPayments.orderId, stolen.saleId))).toHaveLength(0);

    // Bank hisobi "Kassada ko'rsatish" — config bilan keladi (xesh o'zgaradi); oflayn chek tanlangan bank hisobiga yoziladi
    expect((await call(owner(), "PATCH", `/api/finance/cash-accounts/${secondBank}`, { showInPos: true })).statusCode).toBe(200);
    const third = await pull(second!.hash);
    expect(third!.hash).not.toBe(second!.hash);
    expect(third!.bankAccounts.map((account) => account.id)).toEqual([secondBank]);
    const bankSale = saleOp("K01-000003", [
      { method: "cash", amount: "5000" },
      { method: "bank", amount: "15000", cashAccountId: secondBank },
    ], 5);
    const [bankSold] = await push([bankSale.op]);
    expect(bankSold, JSON.stringify(bankSold)).toMatchObject({ status: "applied", result: { paid: "20000.00" } });
    const bankRows = await db.select().from(customerPayments).where(eq(customerPayments.orderId, bankSale.saleId));
    expect(bankRows.map((row) => `${row.method}:${row.amount}:${row.cashAccountId}`).sort()).toEqual(
      [`bank:15000.00:${secondBank}`, `cash:5000.00:${mainCash}`].sort(),
    );
    expect(await balanceOf(secondBank)).toBe("22000.00");

    // Begona kompaniya bank hisobi — rad, pul yozilmaydi
    const [otherBank] = await db.select().from(cashAccounts).where(and(eq(cashAccounts.companyId, other.companyId), eq(cashAccounts.type, "bank")));
    const stolenBank = saleOp("K01-000004", [{ method: "bank", amount: "20000", cashAccountId: otherBank!.id }], 4);
    expect((await push([stolenBank.op]))[0]).toMatchObject({ status: "rejected" });
    expect(await db.select().from(customerPayments).where(eq(customerPayments.orderId, stolenBank.saleId))).toHaveLength(0);
  });
});
