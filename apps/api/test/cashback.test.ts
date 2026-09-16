import { and, eq } from "drizzle-orm";
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
let other: Company;
let mainWh: string;
let mainCash: string;
let categoryId: string;
let choy: string;
let non: string;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

function call(cookie: string, method: "GET" | "POST" | "PUT", url: string, payload?: object) {
  return app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
}

beforeEach(async () => {
  await resetDatabase();
  await db.delete(units);
  await seedDefaultUnits(db);
  const piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Do'kon" });
  other = await createCompany(app, admin.cookie, { name: "Boshqa do'kon" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  mainCash = (await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId))).find(
    (c) => c.type === "cash",
  )!.id;

  categoryId = (await call(company.ownerCookie, "POST", "/api/catalog/categories", { name: "Ichimliklar" })).json().category.id;
  const product = async (body: object) => {
    const res = await call(company.ownerCookie, "POST", "/api/catalog/products", { baseUnitId: piece, ...body });
    const id = res.json().product.id as string;
    await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", {
      type: "receive",
      productId: id,
      warehouseId: mainWh,
      quantity: "50",
      costPrice: "1000",
    });
    return id;
  };
  choy = await product({ name: "Choy", sku: "CHOY", categoryId, salesPrice: "5000", taxRate: "12", taxIncluded: true });
  non = await product({ name: "Non", sku: "NON", salesPrice: "3000" });
});

const putSettings = (cookie: string, payload: object) => call(cookie, "PUT", "/api/sales/cashback/settings", payload);

async function ledger(code: string) {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code)));
  return row!.balance;
}

async function cashBalance() {
  const [row] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, mainCash));
  return Number(row!.balance);
}

describe("Keshbek", () => {
  it("sozlamalar: standart o'chiq; kassir o'qiydi, saqlay olmaydi; begona kategoriya, noto'g'ri foiz, takroriy pog'ona rad", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const initial = await call(kassir.cookie, "GET", "/api/sales/cashback/settings");
    expect(initial.statusCode).toBe(200);
    expect(initial.json().settings).toMatchObject({ enabled: false, accrualBase: "paid", maxUsagePercent: 100 });

    const settings = {
      enabled: true,
      accrualBase: "total",
      maxUsagePercent: 50,
      tiers: [{ minAmount: 20000, percent: 2 }, { minAmount: 0, percent: 1 }],
      categoryRates: [{ categoryId, percent: 5 }],
    };
    expect((await putSettings(kassir.cookie, settings)).statusCode).toBe(403);
    const saved = await putSettings(company.ownerCookie, settings);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().settings.tiers).toEqual([{ minAmount: 0, percent: 1 }, { minAmount: 20000, percent: 2 }]);
    expect((await call(kassir.cookie, "GET", "/api/sales/cashback/settings")).json().settings).toMatchObject({
      enabled: true,
      maxUsagePercent: 50,
    });

    const foreign = (await call(other.ownerCookie, "POST", "/api/catalog/categories", { name: "Begona" })).json().category.id;
    expect((await putSettings(company.ownerCookie, { ...settings, categoryRates: [{ categoryId: foreign, percent: 3 }] })).statusCode).toBe(400);
    expect((await putSettings(company.ownerCookie, { ...settings, maxUsagePercent: 120 })).statusCode).toBe(400);
    expect(
      (await putSettings(company.ownerCookie, { ...settings, tiers: [{ minAmount: 0, percent: 1 }, { minAmount: 0, percent: 2 }] })).statusCode,
    ).toBe(400);

    // Umumiy sozlamalar endpointi orqali chetlab o'tib bo'lmaydi
    const bypass = await call(company.ownerCookie, "PUT", "/api/company/settings/loyalty.cashback", { value: "{}", group: "loyalty" });
    expect(bypass.statusCode).toBe(400);
    // Boshqa kompaniya — o'z standarti
    expect((await call(other.ownerCookie, "GET", "/api/sales/cashback/settings")).json().settings.enabled).toBe(false);
  });

  it("hisoblash (pog'ona va kategoriya), ishlatish chegarasi, qaytarishda bekor qilish va buxgalteriya", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const shiftRes = await call(kassir.cookie, "POST", "/api/sales/pos/shifts", { warehouseId: mainWh, openingCash: "0" });
    const shiftId = shiftRes.json().shift.id as string;
    const customer = (await call(kassir.cookie, "POST", "/api/sales/pos/customers", { name: "Keshbekli mijoz" })).json().customer;
    const sell = (body: object) =>
      call(kassir.cookie, "POST", "/api/sales/pos/sales", { shiftId, paymentMethod: "cash", ...body });

    const settings = {
      enabled: true,
      accrualBase: "total",
      maxUsagePercent: 50,
      tiers: [{ minAmount: 0, percent: 1 }, { minAmount: 20000, percent: 2 }],
      categoryRates: [{ categoryId, percent: 5 }],
    };
    expect((await putSettings(company.ownerCookie, settings)).statusCode).toBe(200);

    // Mijozsiz chekka keshbek yo'q
    const anonymous = await sell({ items: [{ productId: choy, quantity: "1" }], amountPaid: "5000" });
    expect(anonymous.json()).toMatchObject({ cashbackEarned: "0.00", cashbackUsed: "0.00" });

    // 22 000 lik chek: Choy (kategoriya 5%) 10 000 → 500, Non (pog'ona 2%) 12 000 → 240
    const first = await sell({
      customerId: customer.id,
      items: [{ productId: choy, quantity: "2" }, { productId: non, quantity: "4" }],
      amountPaid: "22000",
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ cashbackEarned: "740.00", customer: { cashbackBalance: "740.00" } });
    expect(await ledger("2400")).toBe("740.00");
    expect(await ledger("5600")).toBe("740.00");

    // Endi faqat pul bilan to'langan qismiga; chekning 50% igacha keshbek
    expect((await putSettings(company.ownerCookie, { ...settings, accrualBase: "paid" })).statusCode).toBe(200);
    const one = [{ productId: choy, quantity: "1" }];
    expect((await sell({ customerId: customer.id, items: one, amountPaid: "2000", cashbackAmount: "3000" })).statusCode).toBe(400);
    expect((await sell({ items: one, amountPaid: "4500", cashbackAmount: "500" })).statusCode).toBe(400);

    // 5 000: 500 keshbekdan, 4 500 naqd → keshbek 4 500 × 5% = 225
    const second = await sell({ customerId: customer.id, items: one, amountPaid: "4500", cashbackAmount: "500" });
    expect(second.statusCode).toBe(201);
    expect(second.json()).toMatchObject({
      paid: "4500.00",
      cashbackUsed: "500.00",
      cashbackEarned: "225.00",
      customer: { cashbackBalance: "465.00", totalDebt: "0.00" },
    });
    expect(second.json().order).toMatchObject({ status: "completed", paymentStatus: "paid", paidAmount: "5000.00" });
    expect(await ledger("2400")).toBe("465.00");
    expect(await ledger("1100")).toBe("0.00");
    expect((await sell({ customerId: customer.id, items: one, amountPaid: "4400", cashbackAmount: "600" })).statusCode).toBe(400);

    // Qaytarish: ishlatilgan 500 qaytadi, berilgan 225 bekor; naqd 4 500 kassadan
    const cashBefore = await cashBalance();
    const returned = await call(company.ownerCookie, "POST", `/api/sales/orders/${second.json().order.id}/return`, { refund: true });
    expect(returned.statusCode).toBe(200);
    expect(returned.json().refunded).toBe("5000.00");
    const after = (await call(company.ownerCookie, "GET", `/api/sales/customers/${customer.id}`)).json().customer;
    expect(after).toMatchObject({ cashbackBalance: "740.00", totalDebt: "0.00" });
    expect(cashBefore - (await cashBalance())).toBe(4500);
    expect(await ledger("2400")).toBe("740.00");
    expect(await ledger("5600")).toBe("740.00");
    expect(await ledger("1100")).toBe("0.00");

    const history = await call(kassir.cookie, "GET", `/api/sales/customers/${customer.id}/cashback`);
    expect(history.statusCode).toBe(200);
    expect(history.json().transactions.map((t: { type: string; amount: string }) => `${t.type}:${t.amount}`).sort()).toEqual(
      ["earn:740.00", "earn:225.00", "redeem:-500.00", "redeem_refund:500.00", "earn_reversal:-225.00"].sort(),
    );
    expect((await call(other.ownerCookie, "GET", `/api/sales/customers/${customer.id}/cashback`)).statusCode).toBe(404);

    // Tizim o'chirilsa — ishlatib bo'lmaydi va hisoblanmaydi
    expect((await putSettings(company.ownerCookie, { ...settings, enabled: false })).statusCode).toBe(200);
    expect((await sell({ customerId: customer.id, items: one, amountPaid: "4900", cashbackAmount: "100" })).statusCode).toBe(400);
    const off = await sell({ customerId: customer.id, items: one, amountPaid: "5000" });
    expect(off.json()).toMatchObject({ cashbackEarned: "0.00", customer: { cashbackBalance: "740.00" } });
  });
});
