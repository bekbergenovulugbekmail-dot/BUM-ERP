import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { products, units } from "../src/db/schema/catalog.js";
import { accounts, cashAccounts } from "../src/db/schema/finance.js";
import { stockLevels, warehouses } from "../src/db/schema/inventory.js";
import { supplierBalances, suppliers } from "../src/db/schema/purchase.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let piece: string;
let mainWh: string;
let mainCash: string;

const today = new Date().toISOString().slice(0, 10);

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
  company = await createCompany(app, admin.cookie, { name: "Import do'kon" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  mainCash = (await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId))).find(
    (c) => c.type === "cash",
  )!.id;
});

const call = (method: "GET" | "POST" | "PUT", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie: company.ownerCookie }, ...(payload ? { payload } : {}) });

async function setUsdRate(rate: string) {
  const res = await call("PUT", "/api/finance/currencies", {
    cbuEnabled: false,
    currencies: [{ code: "USD", rate, source: "manual", isActive: true }],
  });
  expect(res.statusCode).toBe(200);
}

async function ledgerRow(code: string) {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code)));
  return row!;
}
const ledger = async (code: string) => (await ledgerRow(code)).balance;

async function balancesOf(supplierId: string) {
  const rows = await db.select().from(supplierBalances).where(eq(supplierBalances.supplierId, supplierId));
  return Object.fromEntries(rows.map((row) => [row.currency, [row.debt, row.bookValue]]));
}

describe("Ko'p valyutali xarid", () => {
  it("qabulda tannarx va kreditorlar so'mda (qabul kursi), ta'minotchi qarzi dollarda; to'lovda kurs farqi", async () => {
    await setUsdRate("12000");
    const importProduct = (await call("POST", "/api/catalog/products", { name: "Import naushnik", baseUnitId: piece })).json().product.id;
    const localProduct = (await call("POST", "/api/catalog/products", { name: "Mahalliy kabel", baseUnitId: piece })).json().product.id;
    const supplierId = (await call("POST", "/api/purchase/suppliers", { name: "Import ta'minotchi" })).json().supplier.id;

    const created = await call("POST", "/api/purchase/orders", {
      supplierId,
      warehouseId: mainWh,
      orderDate: today,
      items: [
        { productId: importProduct, unitId: piece, orderedQty: "10", unitPrice: "5", currency: "USD", salesPrice: "80000" },
        { productId: localProduct, unitId: piece, orderedQty: "2", unitPrice: "10000" },
      ],
    });
    expect(created.statusCode).toBe(201);
    const order = created.json().order;
    expect(order.totalAmount).toBe("620000.00");
    expect(order.currencyTotals).toEqual([
      { currency: "USD", totalAmount: "50.00", paidAmount: "0.00" },
      { currency: "UZS", totalAmount: "20000.00", paidAmount: "0.00" },
    ]);
    expect(order.items[0]).toMatchObject({ currency: "USD", exchangeRate: "12000.0000", lineTotal: "50.00", salesPrice: "80000.0000" });
    expect(order.items[1]).toMatchObject({ currency: null, lineTotal: "20000.00" });

    const eur = await call("POST", "/api/purchase/orders", {
      supplierId,
      warehouseId: mainWh,
      orderDate: today,
      items: [{ productId: importProduct, unitId: piece, orderedQty: "1", unitPrice: "1", currency: "EUR" }],
    });
    expect(eur.statusCode).toBe(400);

    expect((await call("POST", `/api/purchase/orders/${order.id}/confirm`)).statusCode).toBe(200);
    // Qabul kunidagi kurs 12 500
    await setUsdRate("12500");
    const received = await call("POST", `/api/purchase/orders/${order.id}/receipts`, {
      items: order.items.map((item: { id: string; orderedQty: string }) => ({ orderItemId: item.id, receivedQty: item.orderedQty })),
    });
    expect(received.statusCode).toBe(201);
    expect(received.json().total).toBe("645000.00");
    expect(await ledger("1200")).toBe("645000.00");
    expect(await ledger("2000")).toBe("645000.00");
    const [level] = await db
      .select()
      .from(stockLevels)
      .where(and(eq(stockLevels.productId, importProduct), eq(stockLevels.warehouseId, mainWh)));
    expect(level!.avgCostPrice).toBe("62500.0000");
    expect(await balancesOf(supplierId)).toEqual({ USD: ["50.00", "625000.00"], UZS: ["20000.00", "20000.00"] });
    expect((await db.select().from(suppliers).where(eq(suppliers.id, supplierId)))[0]!.totalDebt).toBe("645000.00");
    expect((await db.select().from(products).where(eq(products.id, importProduct)))[0]).toMatchObject({
      salesPrice: "80000.0000",
      salesCurrency: null,
    });

    // Dollar kassa (boshlang'ich 100 $ — jurnal 12 500 kurs bilan) va so'm kassaga kirim
    const usdCash = await call("POST", "/api/finance/cash-accounts", {
      name: "Dollar kassa",
      type: "cash",
      currency: "USD",
      openingBalance: "100",
    });
    expect(usdCash.statusCode).toBe(201);
    expect(usdCash.json().cashAccount).toMatchObject({ currency: "USD", balance: "100.00" });
    expect(await ledger("1010")).toBe("1250000.00");
    const capital = await ledgerRow("3000");
    expect(
      (await call("POST", "/api/finance/cash-transactions", {
        cashAccountId: mainCash,
        type: "in",
        amount: "50000",
        description: "Kirim",
        counterAccountId: capital.id,
      })).statusCode,
    ).toBe(201);

    const pay = (body: object) =>
      call("POST", "/api/purchase/payments", { supplierId, orderId: order.id, method: "cash", ...body });
    // So'm kassadan dollar to'lab bo'lmaydi
    expect((await pay({ currency: "USD", amount: "20", cashAccountId: mainCash })).statusCode).toBe(400);

    // Kurs 12 000: 20 $ = 240 000, kitob qiymati 250 000 → 10 000 kurs farqi daromadi
    await setUsdRate("12000");
    const first = await pay({ currency: "USD", amount: "20" });
    expect(first.statusCode).toBe(201);
    expect(first.json().payment).toMatchObject({
      currency: "USD",
      amount: "20.00",
      exchangeRate: "12000.0000",
      baseAmount: "240000.00",
      fxAmount: "10000.00",
    });
    expect(await ledger("4200")).toBe("10000.00");
    expect(await ledger("2000")).toBe("395000.00");
    expect(await ledger("1010")).toBe("1060000.00");
    expect(await balancesOf(supplierId)).toMatchObject({ USD: ["30.00", "375000.00"] });

    // Kurs 13 000: qolgan 30 $ = 390 000, kitob 375 000 → 15 000 kurs farqi xarajati
    await setUsdRate("13000");
    const second = await pay({ currency: "USD", amount: "30" });
    expect(second.statusCode).toBe(201);
    expect(second.json().payment).toMatchObject({ baseAmount: "390000.00", fxAmount: "-15000.00" });
    expect(await ledger("5700")).toBe("15000.00");
    expect(await ledger("2000")).toBe("20000.00");
    expect(await balancesOf(supplierId)).toMatchObject({ USD: ["0.00", "0.00"] });
    expect((await db.select().from(cashAccounts).where(eq(cashAccounts.id, usdCash.json().cashAccount.id)))[0]!.balance).toBe("50.00");
    expect((await pay({ currency: "USD", amount: "1" })).statusCode).toBe(400);

    expect((await pay({ amount: "20000" })).statusCode).toBe(201);
    const final = (await call("GET", `/api/purchase/orders/${order.id}`)).json().order;
    expect(final.status).toBe("paid");
    expect(final.currencyTotals).toEqual([
      { currency: "USD", totalAmount: "50.00", paidAmount: "50.00" },
      { currency: "UZS", totalAmount: "20000.00", paidAmount: "20000.00" },
    ]);
    expect(await ledger("2000")).toBe("0.00");
    expect((await call("GET", `/api/purchase/suppliers/${supplierId}`)).json().supplier).toMatchObject({
      totalDebt: "0.00",
      balances: [],
    });
  });

  it("valyutali kassa: yoqilmagan valyuta va asosiy kassa rad, o'tkazma faqat bir valyutada, kirim jurnali kurs bilan", async () => {
    await setUsdRate("12000");
    const create = (body: object) => call("POST", "/api/finance/cash-accounts", { type: "cash", ...body });
    expect((await create({ name: "Yevro", currency: "EUR" })).statusCode).toBe(400);
    expect((await create({ name: "Dollar", currency: "USD", isDefault: true })).statusCode).toBe(400);
    const usd = (await create({ name: "Dollar", currency: "USD" })).json().cashAccount;
    expect(usd.currency).toBe("USD");

    expect(
      (await call("POST", "/api/finance/cash-transfers", { fromCashAccountId: usd.id, toCashAccountId: mainCash, amount: "1" })).statusCode,
    ).toBe(400);

    const capital = await ledgerRow("3000");
    const income = await call("POST", "/api/finance/cash-transactions", {
      cashAccountId: usd.id,
      type: "in",
      amount: "10",
      description: "Dollar kirim",
      counterAccountId: capital.id,
    });
    expect(income.statusCode).toBe(201);
    expect(await ledger("1010")).toBe("120000.00");
    expect((await call("GET", "/api/finance/dashboard")).json().totalCash).toBe("120000.00");
  });
});
