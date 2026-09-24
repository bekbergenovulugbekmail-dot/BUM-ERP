import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts, cashAccounts } from "../src/db/schema/finance.js";
import { stockLevels, warehouses } from "../src/db/schema/inventory.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn, uniquePhone } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let other: Company;
let mainWh: string;
let mainCash: string;
let productId: string;

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
  company = await createCompany(app, admin.cookie, { name: "Do'kon" });
  other = await createCompany(app, admin.cookie, { name: "Boshqa do'kon" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  const cash = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));
  mainCash = cash.find((c) => c.type === "cash")!.id;

  const product = await call(company.ownerCookie, "POST", "/api/catalog/products", {
    name: "Choy",
    sku: "CHOY",
    baseUnitId: piece,
    salesPrice: "5000",
    taxRate: "12",
    taxIncluded: true,
  });
  productId = product.json().product.id;
  await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", {
    type: "receive",
    productId,
    warehouseId: mainWh,
    quantity: "10",
    costPrice: "3000",
  });
});

function call(cookie: string, method: "GET" | "POST", url: string, payload?: object) {
  return app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
}
const pos = (method: "GET" | "POST", url: string, cookie: string, payload?: object) =>
  call(cookie, method, `/api/sales/pos${url}`, payload);

async function ledger(code: string) {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code)));
  return row!.balance;
}

async function cashBalance() {
  const [row] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, mainCash));
  return row!.balance;
}

async function stockQty() {
  const [row] = await db
    .select()
    .from(stockLevels)
    .where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, mainWh)));
  return row!.quantity;
}

async function openShift(cookie: string) {
  const res = await pos("POST", "/shifts", cookie, { warehouseId: mainWh, openingCash: "0" });
  expect(res.statusCode).toBe(201);
  return res.json().shift as { id: string };
}

async function newCustomer(cookie: string, body: object) {
  const res = await pos("POST", "/customers", cookie, body);
  expect(res.statusCode).toBe(201);
  return res.json().customer as { id: string; code: string };
}

const customerOf = async (id: string) =>
  (await call(company.ownerCookie, "GET", `/api/sales/customers/${id}`)).json().customer;

describe("POS mijozlari", () => {
  it("kassir mijoz qo'shadi; telefon takrori rad; telefon, ism yoki familiya bo'yicha qidiruv", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const created = await pos("POST", "/customers", kassir.cookie, { name: "Valiyev Ali", phone: "+998 90 123 45 67" });
    expect(created.statusCode).toBe(201);
    expect(created.json().customer).toMatchObject({ code: "C-0001", balance: "0.00", totalDebt: "0.00" });
    expect((await pos("POST", "/customers", kassir.cookie, { name: "Boshqa", phone: "901234567" })).statusCode).toBe(409);
    await newCustomer(kassir.cookie, { name: "Karimova Nodira", phone: "+998935550011" });

    const search = async (term: string, cookie = kassir.cookie) => {
      const res = await call(cookie, "GET", `/api/sales/customers?search=${encodeURIComponent(term)}`);
      expect(res.statusCode).toBe(200);
      return res.json().customers.map((c: { name: string }) => c.name);
    };
    expect(await search("ali valiyev")).toEqual(["Valiyev Ali"]);
    expect(await search("Nodira")).toEqual(["Karimova Nodira"]);
    expect(await search("90 123 45")).toEqual(["Valiyev Ali"]);
    expect(await search("5550011")).toEqual(["Karimova Nodira"]);
    expect(await search("777")).toEqual([]);
    expect(await search("Valiyev", other.ownerCookie)).toEqual([]);
  });

  it("balans: to'ldirish, balansdan to'lash, qaytim balansga, qarzga sotuv, qarzni balansdan yopish, tarix", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const shift = await openShift(kassir.cookie);
    const customer = await newCustomer(kassir.cookie, { name: "Doimiy mijoz", phone: "+998971112233" });
    const payCustomer = (body: object) =>
      pos("POST", `/customers/${customer.id}/payments`, kassir.cookie, { shiftId: shift.id, ...body });

    const deposit = await payCustomer({ purpose: "deposit", amount: "50000", method: "cash" });
    expect(deposit.statusCode).toBe(201);
    expect(deposit.json().customer).toMatchObject({ balance: "50000.00", totalDebt: "0.00" });
    expect(await cashBalance()).toBe("50000.00");
    expect(await ledger("2300")).toBe("50000.00");
    expect((await payCustomer({ purpose: "deposit", amount: "1000", method: "balance" })).statusCode).toBe(400);

    // 10 000 lik chek: 3 000 balansdan, 10 000 naqd berildi → 7 000 to'lov, 3 000 qaytim balansga
    const sale = await pos("POST", "/sales", kassir.cookie, {
      shiftId: shift.id,
      customerId: customer.id,
      items: [{ productId, quantity: "2" }],
      paymentMethod: "cash",
      amountPaid: "10000",
      balanceAmount: "3000",
      changeToBalance: true,
    });
    expect(sale.statusCode).toBe(201);
    expect(sale.json()).toMatchObject({
      paid: "7000.00",
      change: "0.00",
      balanceUsed: "3000.00",
      changeToBalance: "3000.00",
      debt: "0.00",
      customer: { balance: "50000.00", totalDebt: "0.00" },
    });
    expect(sale.json().order).toMatchObject({ status: "completed", paymentStatus: "paid", totalAmount: "10000.00", paidAmount: "10000.00" });
    expect(await cashBalance()).toBe("60000.00");
    expect(await ledger("2300")).toBe("50000.00");
    expect(await ledger("1100")).toBe("0.00");

    const credit = await pos("POST", "/sales", kassir.cookie, {
      shiftId: shift.id,
      customerId: customer.id,
      items: [{ productId, quantity: "1" }],
      paymentMethod: "cash",
      amountPaid: "0",
      onCredit: true,
    });
    expect(credit.statusCode).toBe(201);
    expect(credit.json()).toMatchObject({ paid: "0.00", debt: "5000.00", customer: { totalDebt: "5000.00" } });
    // Nasiya chek ham yakunlangan sotuv; qarzligi to'lov holatida ko'rinadi
    expect(credit.json().order).toMatchObject({ status: "completed", paymentStatus: "unpaid" });
    expect(await ledger("1100")).toBe("5000.00");

    expect((await payCustomer({ purpose: "debt", amount: "6000", method: "cash" })).statusCode).toBe(400);
    const fromBalance = await payCustomer({ purpose: "debt", amount: "5000", method: "balance" });
    expect(fromBalance.statusCode).toBe(201);
    expect(fromBalance.json().customer).toMatchObject({ balance: "45000.00", totalDebt: "0.00" });
    expect(await ledger("1100")).toBe("0.00");
    expect(await ledger("2300")).toBe("45000.00");

    // Rad etiladi: mijozsiz balans yoki qaytim, chekdan ortiq, balansda yetarli emas
    const poor = await newCustomer(kassir.cookie, { name: "Balansi yo'q" });
    const sell = (body: object) =>
      pos("POST", "/sales", kassir.cookie, {
        shiftId: shift.id,
        items: [{ productId, quantity: "1" }],
        paymentMethod: "cash",
        amountPaid: "5000",
        ...body,
      });
    expect((await sell({ balanceAmount: "1000" })).statusCode).toBe(400);
    expect((await sell({ changeToBalance: true, amountPaid: "6000" })).statusCode).toBe(400);
    expect((await sell({ customerId: customer.id, balanceAmount: "6000" })).statusCode).toBe(400);
    expect((await sell({ customerId: poor.id, balanceAmount: "1000" })).statusCode).toBe(400);

    expect((await pos("GET", `/shifts/${shift.id}`, kassir.cookie)).json().shift).toMatchObject({
      totalSales: "15000.00",
      totalCash: "60000.00",
      receiptCount: 2,
    });

    const history = await call(kassir.cookie, "GET", `/api/sales/customers/${customer.id}/balance`);
    expect(history.statusCode).toBe(200);
    const rows = history.json().transactions as { type: string; amount: string }[];
    expect(rows.map((r) => `${r.type}:${r.amount}`).sort()).toEqual(
      ["change:3000.00", "deposit:50000.00", "sale_payment:-3000.00", "sale_payment:-5000.00"].sort(),
    );
    expect((await call(other.ownerCookie, "GET", `/api/sales/customers/${customer.id}/balance`)).statusCode).toBe(404);
  });

  it("qaytarish: balansdan to'langan qism balansga, naqd qism kassadan qaytadi", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const shift = await openShift(kassir.cookie);
    const customer = await newCustomer(kassir.cookie, { name: "Qaytaruvchi" });
    const deposit = await pos("POST", `/customers/${customer.id}/payments`, kassir.cookie, {
      shiftId: shift.id,
      purpose: "deposit",
      amount: "5000",
      method: "cash",
    });
    expect(deposit.statusCode).toBe(201);

    const sale = await pos("POST", "/sales", kassir.cookie, {
      shiftId: shift.id,
      customerId: customer.id,
      items: [{ productId, quantity: "2" }],
      paymentMethod: "cash",
      amountPaid: "5000",
      balanceAmount: "5000",
    });
    expect(sale.statusCode).toBe(201);
    expect(await cashBalance()).toBe("10000.00");
    expect((await customerOf(customer.id)).balance).toBe("0.00");

    const returned = await call(company.ownerCookie, "POST", `/api/sales/orders/${sale.json().order.id}/return`, { refund: true });
    expect(returned.statusCode).toBe(200);
    expect(returned.json().refunded).toBe("10000.00");
    expect(await customerOf(customer.id)).toMatchObject({ balance: "5000.00", totalDebt: "0.00" });
    expect(await cashBalance()).toBe("5000.00");
    expect(await ledger("2300")).toBe("5000.00");
    expect(await ledger("1100")).toBe("0.00");
    expect(await stockQty()).toBe("10.0000");
    expect((await pos("GET", `/shifts/${shift.id}`, kassir.cookie)).json().shift.totalCash).toBe("5000.00");
  });
});

/**
 * 2-VAZIFA: balans maydonini to'g'ridan-to'g'ri tahrirlash emas, PUL QO'SHISH va AYIRISH.
 *
 * Har ikkalasi ham tranzaksiya: tarix qatori + kassa harakati + BALANSLANGAN jurnal.
 * Balans hech qachon qatorlar yig'indisidan ajralib qolmasligi kerak.
 */
describe("Mijoz hisobiga pul qo'shish va ayirish", () => {
  const deposit = (cookie: string, customerId: string, body: object) =>
    call(cookie, "POST", `/api/sales/customers/${customerId}/balance-deposit`, body);
  const withdraw = (cookie: string, customerId: string, body: object) =>
    call(cookie, "POST", `/api/sales/customers/${customerId}/balance-withdraw`, body);
  const history = async (customerId: string) =>
    (await call(company.ownerCookie, "GET", `/api/sales/customers/${customerId}/balance`)).json()
      .transactions as { type: string; amount: string; balanceAfter: string }[];

  it("pul qo'shish: balans, kassa va jurnal birga o'zgaradi", async () => {
    const customer = await newCustomer(company.ownerCookie, { name: "Avans mijozi", phone: uniquePhone() });
    const cashBefore = Number(await cashBalance());

    const res = await deposit(company.ownerCookie, customer.id, { amount: "1000000", method: "cash", notes: "Oldindan to'lov" });
    expect(res.statusCode, res.body).toBe(201);

    expect((await customerOf(customer.id)).balance).toBe("1000000.00");
    expect(Number(await cashBalance()) - cashBefore, "kassaga pul tushdi").toBe(1_000_000);
    // 2300 "Mijozlar avanslari" — majburiyat oshdi
    expect(await ledger("2300")).toBe("1000000.00");

    const rows = await history(customer.id);
    expect(rows[0]).toMatchObject({ type: "deposit", amount: "1000000.00", balanceAfter: "1000000.00" });
  });

  it("pul ayirish: balans kamayadi, kassadan pul chiqadi, avans majburiyati yopiladi", async () => {
    const customer = await newCustomer(company.ownerCookie, { name: "Qaytarib oluvchi", phone: uniquePhone() });
    expect((await deposit(company.ownerCookie, customer.id, { amount: "1000000", method: "cash" })).statusCode).toBe(201);
    const cashAfterDeposit = Number(await cashBalance());

    const res = await withdraw(company.ownerCookie, customer.id, { amount: "300000", method: "cash", notes: "Ortiqcha to'lov qaytdi" });
    expect(res.statusCode, res.body).toBe(201);

    expect((await customerOf(customer.id)).balance).toBe("700000.00");
    expect(cashAfterDeposit - Number(await cashBalance()), "kassadan pul chiqdi").toBe(300_000);
    expect(await ledger("2300"), "avans majburiyati kamaydi").toBe("700000.00");

    const rows = await history(customer.id);
    expect(rows[0]).toMatchObject({ type: "withdrawal", amount: "300000.00", balanceAfter: "700000.00" });
  });

  it("balansdan ortiq pul ayirib bo'lmaydi — balans manfiyga tushmaydi", async () => {
    const customer = await newCustomer(company.ownerCookie, { name: "Kam balans", phone: uniquePhone() });
    expect((await deposit(company.ownerCookie, customer.id, { amount: "100000", method: "cash" })).statusCode).toBe(201);

    const res = await withdraw(company.ownerCookie, customer.id, { amount: "150000", method: "cash" });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().details.reason).toBe("insufficient_balance");
    expect((await customerOf(customer.id)).balance, "balans o'zgarmadi").toBe("100000.00");
  });

  it("balans har doim tarix qatorlari yig'indisiga teng", async () => {
    const customer = await newCustomer(company.ownerCookie, { name: "Yig'indi", phone: uniquePhone() });
    expect((await deposit(company.ownerCookie, customer.id, { amount: "500000", method: "cash" })).statusCode).toBe(201);
    expect((await deposit(company.ownerCookie, customer.id, { amount: "250000", method: "card" })).statusCode).toBe(201);
    expect((await withdraw(company.ownerCookie, customer.id, { amount: "100000", method: "cash" })).statusCode).toBe(201);

    const rows = await history(customer.id);
    const sum = rows.reduce(
      (total, row) => total + (row.type === "withdrawal" || row.type === "sale_payment" ? -Number(row.amount) : Number(row.amount)),
      0,
    );
    expect(sum, "kirim − chiqim").toBe(650_000);
    expect(Number((await customerOf(customer.id)).balance), "balans yig'indiga teng").toBe(sum);
    // Oxirgi qatordagi `balanceAfter` ham o'sha qiymat — tarix uzilmagan
    expect(Number(rows[0]!.balanceAfter)).toBe(sum);
  });

  it("begona kompaniya mijoziga pul qo'shib bo'lmaydi", async () => {
    const customer = await newCustomer(company.ownerCookie, { name: "Bizniki", phone: uniquePhone() });
    const res = await deposit(other.ownerCookie, customer.id, { amount: "100000", method: "cash" });
    expect([403, 404]).toContain(res.statusCode);
  });
});

/**
 * 2.5 — MIJOZ OBOROTI va qarz KESHINING haqiqiy manbaga MOSLIGI.
 *
 * `customers.total_debt` — bu kesh; haqiqiy qarz hujjatlardan hisoblanadi
 * (`net = total_amount − qaytarish`, yakunlangan hujjatlarning to'lanmagan qismi).
 * Ikkalasi hech qachon ajralib qolmasligi kerak — aks holda mijoz kartochkasi,
 * qarz yoshi hisoboti va kredit tekshiruvi turli raqam ko'rsatadi.
 */
describe("Mijoz oboroti va qarz keshi", () => {
  const turnover = async (customerId: string) =>
    (await call(company.ownerCookie, "GET", `/api/sales/customers/${customerId}/turnover`)).json() as {
      orderCount: number; grossSales: string; returnsTotal: string; netSales: string;
      totalPaid: string; openDebt: string; cachedDebt: string; balance: string;
    };

  /** Qarzga sotuv: tasdiqlangan va yakunlangan hujjat (tovar mijozda). */
  async function creditSale(customerId: string, quantity: string, unitPrice: string) {
    const order = await call(company.ownerCookie, "POST", "/api/sales/orders", {
      customerId,
      warehouseId: mainWh,
      orderDate: new Date().toISOString().slice(0, 10),
      items: [{ productId, quantity, unitPrice }],
    });
    expect(order.statusCode, order.body).toBe(201);
    const orderId = order.json().order.id as string;
    expect((await call(company.ownerCookie, "POST", `/api/sales/orders/${orderId}/confirm`)).statusCode).toBe(200);
    // Tovar mijozga jo'natiladi — hujjat "shipped" bo'ladi va qarzga tushadi
    const shipped = await call(company.ownerCookie, "POST", `/api/sales/orders/${orderId}/ship`);
    expect(shipped.statusCode, shipped.body).toBe(200);
    return orderId;
  }

  it("oborot: jami xarid, sof savdo, to'lov va qarz bir-biriga mos", async () => {
    const customer = await newCustomer(company.ownerCookie, { name: "Oborot", phone: uniquePhone() });
    await creditSale(customer.id, "2", "500000"); // 1 000 000

    const before = await turnover(customer.id);
    expect(before.orderCount).toBe(1);
    expect(before.grossSales).toBe("1000000.00");
    expect(before.netSales).toBe("1000000.00");
    expect(before.openDebt, "to'lanmagan — to'liq qarz").toBe("1000000.00");
    expect(before.cachedDebt, "kesh haqiqiy qarzga teng").toBe(before.openDebt);

    // 400 000 to'lov
    const paid = await call(company.ownerCookie, "POST", "/api/sales/payments", {
      customerId: customer.id, amount: "400000", method: "cash",
    });
    expect(paid.statusCode, paid.body).toBe(201);

    const after = await turnover(customer.id);
    expect(after.totalPaid).toBe("400000.00");
    expect(after.openDebt).toBe("600000.00");
    expect(after.cachedDebt, "to'lovdan keyin ham kesh mos").toBe(after.openDebt);
  });

  it("to'liq to'langan hujjatdan qaytarish: kesh haqiqiy qarzdan ajralib qolmaydi", async () => {
    const customer = await newCustomer(company.ownerCookie, { name: "Qaytaruvchi", phone: uniquePhone() });
    const orderId = await creditSale(customer.id, "2", "500000"); // 1 000 000

    expect((await call(company.ownerCookie, "POST", "/api/sales/payments", {
      customerId: customer.id, amount: "1000000", method: "cash",
    })).statusCode).toBe(201);

    const paidOff = await turnover(customer.id);
    expect(paidOff.openDebt).toBe("0.00");
    expect(paidOff.cachedDebt).toBe("0.00");

    // Bitta dona qaytariladi — 500 000
    const items = (await call(company.ownerCookie, "GET", `/api/sales/orders/${orderId}`)).json().order.items as
      { id: string }[];
    const returned = await call(company.ownerCookie, "POST", `/api/sales/orders/${orderId}/return-items`, {
      items: [{ orderItemId: items[0]!.id, quantity: "1" }],
      refundMethod: "cash",
      reason: "Sifatsiz",
    });
    expect(returned.statusCode, returned.body).toBe(201);

    const final = await turnover(customer.id);
    expect(final.netSales, "sof savdo qaytarish chegirilgan").toBe("500000.00");
    expect(final.returnsTotal).toBe("500000.00");
    // ENG MUHIMI: kesh va haqiqiy qarz ajralib qolmasin
    expect(final.cachedDebt, "qaytarishdan keyin kesh haqiqiy qarzga teng bo'lishi kerak").toBe(final.openDebt);
  });
});

/**
 * 2.6 — BALANS IMPORTI.
 *
 * Import `customers.balance` ga to'g'ridan-to'g'ri yozmaydi: har qator TUZATMA
 * tranzaksiyasi bo'lib kiritiladi (tarix + balanslangan jurnal). Boshlang'ich qoldiq
 * DAROMAD deb hisoblanmasligi kerak — sotuvga tushmaydi.
 */
describe("Mijoz balansini import qilish", () => {
  const importBalances = (cookie: string, rows: object[], dryRun?: boolean) =>
    call(cookie, "POST", "/api/sales/customers/balance-import", { rows, ...(dryRun ? { dryRun } : {}) });

  it("preview hech narsa saqlamaydi, mosliklarni ko'rsatadi", async () => {
    const shop = await newCustomer(company.ownerCookie, { name: "Import mijozi", phone: uniquePhone() });

    const preview = await importBalances(company.ownerCookie, [
      { name: "Import mijozi", balance: "5000000", reason: "Opening balance" },
    ], true);
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({ dryRun: true, matched: 1, valid: 1 });
    expect((await customerOf(shop.id)).balance, "preview'da balans o'zgarmaydi").toBe("0.00");
  });

  it("import balansni TUZATMA sifatida kiritadi va tarixda qoladi", async () => {
    const shop = await newCustomer(company.ownerCookie, { name: "Qoldiqli", phone: uniquePhone() });

    const res = await importBalances(company.ownerCookie, [
      { name: "Qoldiqli", balance: "5000000", reason: "Opening balance" },
    ]);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ matched: 1, valid: 1 });
    expect((await customerOf(shop.id)).balance).toBe("5000000.00");

    const rows = (await call(company.ownerCookie, "GET", `/api/sales/customers/${shop.id}/balance`)).json()
      .transactions as { type: string; balanceAfter: string }[];
    expect(rows[0], "tuzatma tranzaksiyasi yozilgan").toMatchObject({ type: "adjustment", balanceAfter: "5000000.00" });
  });

  it("boshlang'ich qoldiq SOTUVGA tushmaydi", async () => {
    const shop = await newCustomer(company.ownerCookie, { name: "Daromad emas", phone: uniquePhone() });
    expect((await importBalances(company.ownerCookie, [{ name: "Daromad emas", balance: "5000000" }])).statusCode).toBe(200);

    const turnover = (await call(company.ownerCookie, "GET", `/api/sales/customers/${shop.id}/turnover`)).json() as
      { grossSales: string; netSales: string; balance: string };
    expect(turnover.grossSales, "savdo yo'q").toBe("0.00");
    expect(turnover.netSales).toBe("0.00");
    expect(turnover.balance, "pul balansda").toBe("5000000.00");
  });

  it("mijoz topilmasa XATO — yangi mijoz yaratilmaydi", async () => {
    const res = await importBalances(company.ownerCookie, [{ name: "Yo'q mijoz", balance: "1000" }]);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().valid).toBe(0);
    expect(res.json().errors[0].message).toContain("topilmadi");

    const list = (await call(company.ownerCookie, "GET", "/api/sales/customers")).json().customers as { name: string }[];
    expect(list.map((row) => row.name)).not.toContain("Yo'q mijoz");
  });

  it("faylda takrorlangan mijoz ikkinchi marta qo'llanmaydi", async () => {
    await newCustomer(company.ownerCookie, { name: "Takror", phone: uniquePhone() });
    const res = await importBalances(company.ownerCookie, [
      { name: "Takror", balance: "1000000" },
      { name: "Takror", balance: "9000000" },
    ]);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().duplicates).toHaveLength(1);
    expect(res.json().valid).toBe(1);
  });

  it("takroriy YUKLASH balansni ikki barobar qilmaydi", async () => {
    const shop = await newCustomer(company.ownerCookie, { name: "Qayta yuklash", phone: uniquePhone() });
    const rows = [{ name: "Qayta yuklash", balance: "2000000" }];

    expect((await importBalances(company.ownerCookie, rows)).statusCode).toBe(200);
    expect((await customerOf(shop.id)).balance).toBe("2000000.00");

    expect((await importBalances(company.ownerCookie, rows)).statusCode).toBe(200);
    expect((await customerOf(shop.id)).balance, "o'sha fayl qayta yuklansa balans o'zgarmaydi").toBe("2000000.00");
  });

  it("manfiy balans rad etiladi", async () => {
    await newCustomer(company.ownerCookie, { name: "Manfiy", phone: uniquePhone() });
    const res = await importBalances(company.ownerCookie, [{ name: "Manfiy", balance: "-500" }]);
    expect(res.json().errors[0].message).toContain("manfiy");
    expect(res.json().valid).toBe(0);
  });

  it("begona kompaniya mijozi topilmaydi", async () => {
    await newCustomer(company.ownerCookie, { name: "Bizniki", phone: uniquePhone() });
    const res = await importBalances(other.ownerCookie, [{ name: "Bizniki", balance: "1000" }]);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().valid, "begona mijoz import qilinmaydi").toBe(0);
  });
});
