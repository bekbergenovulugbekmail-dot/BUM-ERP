/**
 * MIJOZNING BANK ORQALI TO'LOVI (bank tushumi) — qarzgacha to'lov + qolgani avans (2300), bitta hujjat.
 *
 * Egasining talabi: bank +X, mijoz qarzi −X; qarz bo'lmasa (yoki yetmasa) — qolgani avansga. Faqat tranzaksiya
 * orqali: har qadamda qarz 3 manbada (kesh, jurnal subhisobi, 1100) va avans (hamyon = 2300) mos, aylanma balans teng.
 * Bekor qilish hujjatni butunligicha qaytaradi; avans ishlatilgan bo'lsa — rad (tarix buzilmaydi).
 */
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts, cashAccounts, journalEntries, journalLines } from "../src/db/schema/finance.js";
import { stockLevels, warehouses } from "../src/db/schema/inventory.js";
import { customerBalanceTransactions, customers, payments, salesOrders } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let piece: string;
let mainWh: string;
let mainCash: string;
let bank: string;

/** MAHALLIY sana (server `todayIso` bilan bir xil) — UTC sana 00:00–05:00 oralig'ida bir kun orqada qoladi. */
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
  piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Bank tushumi kompaniyasi" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  const accountsList = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));
  mainCash = accountsList.find((row) => row.isDefault)!.id;
  bank = accountsList.find((row) => row.type === "bank")!.id;
});

const call = (cookie: string, method: "GET" | "POST" | "PUT", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const sales = (method: "GET" | "POST", url: string, payload?: object, cookie = company.ownerCookie) =>
  call(cookie, method, `/api/sales${url}`, payload);

async function ledger(code: string) {
  const [row] = await db.select().from(accounts).where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code)));
  return row!.balance;
}

async function cash(id = mainCash) {
  const [row] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, id));
  return row!.balance;
}

/** Mijoz qarzi JURNALDAN: 1100 qatorlari, kontragent = mijoz, bekor qilinmagan yozuvlar. */
async function ledgerDebt(customerId: string) {
  const [row] = await db
    .select({ debt: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)::numeric(18,2)` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(
      and(
        eq(journalLines.partyType, "customer"),
        eq(journalLines.partyId, customerId),
        eq(accounts.subtype, "receivable"),
        eq(journalEntries.status, "posted"),
      ),
    );
  return row!.debt;
}

/** To'rt manba bir xil qarzni ko'rsatadimi: kesh = jurnal subhisobi = 1100 qoldig'i (yagona mijoz). */
async function expectDebt(customerId: string, expected: string) {
  const [customer] = await db.select().from(customers).where(eq(customers.id, customerId));
  expect(customer!.totalDebt, "kesh (customers.total_debt)").toBe(expected);
  expect(await ledgerDebt(customerId), "mijozning jurnal subhisobi").toBe(expected);
  expect(await ledger("1100"), "1100 Debitorlar qoldig'i").toBe(expected);
}

/** Aylanma balans: jami debet = jami kredit (butun kompaniya). */
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

let seq = 0;
async function product(price: string, stock: string, cost: string) {
  seq += 1;
  const created = await call(company.ownerCookie, "POST", "/api/catalog/products", {
    name: `Mahsulot ${seq}`,
    sku: `AUD-${seq}`,
    baseUnitId: piece,
    salesPrice: price,
    taxRate: "0",
  });
  const productId = created.json().product.id as string;
  await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", {
    type: "receive",
    productId,
    warehouseId: mainWh,
    quantity: stock,
    costPrice: cost,
  });
  return productId;
}

async function stock(productId: string) {
  const [level] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, mainWh)));
  return level!.quantity;
}

async function shipped(customerId: string, productId: string, quantity: string) {
  const created = await sales("POST", "/orders", { customerId, warehouseId: mainWh, orderDate: today, items: [{ productId, quantity }] });
  expect(created.statusCode, created.body).toBe(201);
  const orderId = created.json().order.id as string;
  expect((await sales("POST", `/orders/${orderId}/confirm`)).statusCode).toBe(200);
  const ship = await sales("POST", `/orders/${orderId}/ship`);
  expect(ship.statusCode, ship.body).toBe(200);
  return orderId;
}

async function newCustomer(name: string) {
  return (await sales("POST", "/customers", { name })).json().customer.id as string;
}

async function paid(orderId: string) {
  const [row] = await db.select().from(salesOrders).where(eq(salesOrders.id, orderId));
  return row!.paidAmount;
}


async function wallet(customerId: string) {
  const [row] = await db.select().from(customers).where(eq(customers.id, customerId));
  return row!.balance;
}

const receipt = (payload: object, cookie = company.ownerCookie) => sales("POST", "/bank-receipts", payload, cookie);

describe("Bank tushumi", () => {
  it("qarz 1 000 000, bankdan 1 300 000: qarz 0, avans 300 000, bank +1 300 000; bekor qilish hammasini qaytaradi", async () => {
    const productId = await product("100000", "20", "60000");
    const customerId = await newCustomer("Test Market");
    const orderId = await shipped(customerId, productId, "10");
    await expectDebt(customerId, "1000000.00");

    const preview = await sales("GET", `/bank-receipts/preview?customerId=${customerId}&amount=1300000`);
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({ toDebt: "1000000.00", toAdvance: "300000.00", debtAfter: "0.00", advanceAfter: "300000.00" });

    const res = await receipt({ customerId, cashAccountId: bank, amount: "1300000", reference: "PP-777", notes: "Kapitalbank", expectedAdvance: "300000.00", requestId: crypto.randomUUID() });
    expect(res.statusCode, res.body).toBe(201);
    const created = res.json().receipt as { id: string; toDebt: string; toAdvance: string; status: string; reference: string; createdByName: string | null };
    expect(created).toMatchObject({ toDebt: "1000000.00", toAdvance: "300000.00", status: "posted", reference: "PP-777" });
    expect(created.createdByName, "mas'ul (kiritgan xodim) ko'rinadi").toBeTruthy();

    await expectDebt(customerId, "0.00");
    expect(await wallet(customerId)).toBe("300000.00");
    expect(await ledger("2300"), "2300 = mijoz hamyoni").toBe("300000.00");
    expect(await cash(bank)).toBe("1300000.00");
    expect(await cash(), "naqd kassaga tushmaydi").toBe("0.00");
    expect(await paid(orderId)).toBe("1000000.00");
    await expectTrialBalance();

    // Bekor qilish: ko'rib chiqish avans qismini ham ko'rsatadi
    const reversal = await sales("GET", `/bank-receipts/${created.id}/reversal`);
    expect(reversal.statusCode, reversal.body).toBe(200);
    expect(reversal.json().kind).toBe("payment");
    expect(reversal.json().effect.advance).toMatchObject({ amount: "300000.00", walletBefore: "300000.00", walletAfter: "0.00" });
    expect(reversal.json().effect.blockers).toEqual([]);

    const reversed = await sales("POST", `/bank-receipts/${created.id}/reverse`, { reason: "Bank hujjati boshqa mijozniki" });
    expect(reversed.statusCode, reversed.body).toBe(200);
    await expectDebt(customerId, "1000000.00");
    expect(await wallet(customerId)).toBe("0.00");
    expect(await ledger("2300")).toBe("0.00");
    expect(await cash(bank)).toBe("0.00");
    expect(await paid(orderId)).toBe("0.00");
    await expectTrialBalance();

    // Tarix saqlanadi: asl qatorlar joyida, holati reversed; teskari qator bor
    const [header] = await db.select().from(payments).where(eq(payments.id, created.id));
    expect(header!.status).toBe("reversed");
    const walletRows = await db.select().from(customerBalanceTransactions).where(eq(customerBalanceTransactions.customerId, customerId));
    expect(walletRows.map((row) => `${row.type}:${row.status}:${row.amount}`).sort()).toEqual(["deposit:reversed:300000.00", "deposit_reversal:posted:-300000.00"]);

    // Ikkinchi marta bekor qilinmaydi
    expect((await sales("POST", `/bank-receipts/${created.id}/reverse`, { reason: "yana bir bor" })).statusCode).toBe(409);
  });

  it("qarz yo'q: hammasi avans; faqat-avans tushumi o'zi bekor qilinadi", async () => {
    const customerId = await newCustomer("Bonnu Market");
    const res = await receipt({ customerId, cashAccountId: bank, amount: "500000" });
    expect(res.statusCode, res.body).toBe(201);
    const created = res.json().receipt as { id: string; toDebt: string; toAdvance: string };
    expect(created).toMatchObject({ toDebt: "0.00", toAdvance: "500000.00" });
    await expectDebt(customerId, "0.00");
    expect(await wallet(customerId)).toBe("500000.00");
    expect(await cash(bank)).toBe("500000.00");

    const preview = await sales("GET", `/bank-receipts/${created.id}/reversal`);
    expect(preview.json()).toMatchObject({ kind: "deposit", amount: "500000.00", blockers: [] });
    expect((await sales("POST", `/bank-receipts/${created.id}/reverse`, { reason: "Xato kiritildi" })).statusCode).toBe(200);
    expect(await wallet(customerId)).toBe("0.00");
    expect(await cash(bank)).toBe("0.00");
    expect(await ledger("2300")).toBe("0.00");
    await expectTrialBalance();
  });

  it("avans ishlatilgan bo'lsa bekor qilish rad etiladi va hech narsa o'zgarmaydi", async () => {
    const productId = await product("100000", "20", "60000");
    const customerId = await newCustomer("Anor Market");
    const created = (await receipt({ customerId, cashAccountId: bank, amount: "300000" })).json().receipt as { id: string };
    // Avansdan keyingi sotuv to'landi
    const orderId = await shipped(customerId, productId, "2");
    const spent = await sales("POST", "/payments", { orderId, amount: "200000", method: "balance" });
    expect(spent.statusCode, spent.body).toBe(201);
    expect(await wallet(customerId)).toBe("100000.00");

    const preview = await sales("GET", `/bank-receipts/${created.id}/reversal`);
    expect(preview.json().blockers.join(" ")).toContain("Avans ishlatilgan");
    const blocked = await sales("POST", `/bank-receipts/${created.id}/reverse`, { reason: "Xato" });
    expect(blocked.statusCode, blocked.body).toBe(400);
    expect(await wallet(customerId)).toBe("100000.00");
    expect(await cash(bank)).toBe("300000.00");
    await expectTrialBalance();
  });

  it("himoyalar: taqsimot o'zgargan, takroriy bank hujjati, takroriy so'rov, kassa hisobi, begona mijoz, ruxsatlar", async () => {
    const productId = await product("100000", "20", "60000");
    const customerId = await newCustomer("Test Market");
    await shipped(customerId, productId, "3");

    // Foydalanuvchi "avans 0" deb ko'rgan, lekin summa qarzdan katta — 409, hech narsa yozilmaydi
    const stale = await receipt({ customerId, cashAccountId: bank, amount: "400000", expectedAdvance: "0" });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json().details).toMatchObject({ reason: "split_changed", toAdvance: "100000.00" });
    expect(await cash(bank)).toBe("0.00");

    const requestId = crypto.randomUUID();
    const first = await receipt({ customerId, cashAccountId: bank, amount: "100000", reference: "PP-1", requestId });
    expect(first.statusCode, first.body).toBe(201);
    const again = await receipt({ customerId, cashAccountId: bank, amount: "100000", reference: "PP-1", requestId });
    expect(again.statusCode, "takroriy so'rov — o'sha hujjat").toBe(200);
    expect(again.json().receipt.id).toBe(first.json().receipt.id);
    const duplicate = await receipt({ customerId, cashAccountId: bank, amount: "100000", reference: "PP-1" });
    expect(duplicate.statusCode, "bitta bank hujjati ikki marta kiritilmaydi").toBe(409);
    expect(await cash(bank)).toBe("100000.00");

    expect((await receipt({ customerId, cashAccountId: mainCash, amount: "1000" })).statusCode, "naqd kassa — bank emas").toBe(400);

    const admin = await signedIn(app, { isPlatformAdmin: true });
    const other = await createCompany(app, admin.cookie, { name: "Begona" });
    const otherBank = (await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, other.companyId))).find((row) => row.type === "bank")!.id;
    expect((await receipt({ customerId, cashAccountId: otherBank, amount: "1000" })).statusCode, "begona bank hisobi").toBe(404);
    expect((await receipt({ customerId, cashAccountId: otherBank, amount: "1000" }, other.ownerCookie)).statusCode, "begona mijoz").toBe(404);

    const storekeeper = await addEmployee(app, company, "Omborchi");
    expect((await receipt({ customerId, cashAccountId: bank, amount: "1000" }, storekeeper.cookie)).statusCode).toBe(403);
    const cashier = await addEmployee(app, company, "Kassir");
    const receiptId = first.json().receipt.id as string;
    expect((await sales("POST", `/bank-receipts/${receiptId}/reverse`, { reason: "Kassir" }, cashier.cookie)).statusCode, "bekor qilish — finance.approve").toBe(403);
    await expectTrialBalance();
  });
});

describe("Avans kirimini bekor qilish (balansni to'ldirish)", () => {
  it("oddiy to'ldirish bekor qilinadi; bank tushumining avans qismi alohida bekor qilinmaydi", async () => {
    const productId = await product("100000", "20", "60000");
    const customerId = await newCustomer("Test Market");
    const deposit = await sales("POST", `/customers/${customerId}/balance-deposit`, { amount: "70000", method: "cash" });
    expect(deposit.statusCode, deposit.body).toBe(201);
    const depositId = deposit.json().transaction.id as string;
    expect(await cash()).toBe("70000.00");

    const reversed = await sales("POST", `/customers/${customerId}/balance-deposits/${depositId}/reverse`, { reason: "Boshqa mijozniki" });
    expect(reversed.statusCode, reversed.body).toBe(200);
    expect(await wallet(customerId)).toBe("0.00");
    expect(await cash()).toBe("0.00");
    expect(await ledger("2300")).toBe("0.00");
    expect((await sales("POST", `/customers/${customerId}/balance-deposits/${depositId}/reverse`, { reason: "yana" })).statusCode).toBe(409);

    // Qarz + avans tushumi: avans qatorini yakka bekor qilib bo'lmaydi — butun hujjat bekor qilinadi
    await shipped(customerId, productId, "1");
    const split = (await receipt({ customerId, cashAccountId: bank, amount: "150000" })).json().receipt as { advanceId: string };
    const refused = await sales("POST", `/customers/${customerId}/balance-deposits/${split.advanceId}/reverse`, { reason: "Qism" });
    expect(refused.statusCode, refused.body).toBe(400);
    expect(await wallet(customerId)).toBe("50000.00");

    // Begona mijoz yo'li bilan boshqa mijozning kirimi topilmaydi
    const other = await newCustomer("Bonnu Market");
    expect((await sales("POST", `/customers/${other}/balance-deposits/${split.advanceId}/reverse`, { reason: "Xato" })).statusCode).toBe(404);
    await expectTrialBalance();
  });
});
