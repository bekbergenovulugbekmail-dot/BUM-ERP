import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { products, units } from "../src/db/schema/catalog.js";
import { accounts, cashAccounts } from "../src/db/schema/finance.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { auditLogs, companyMembers, passwordResetCodes, roles, users } from "../src/db/schema/platform.js";
import { posDeviceCashiers } from "../src/db/schema/pos.js";
import { salesOrderItems } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { writeAuditLog } from "../src/shared/audit.js";
import { registerErrorHandler } from "../src/shared/errors.js";
import { smsProvider } from "../src/shared/sms.js";
import { addEmployee, createCompany, createUser, login, me, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let ownerId: string;
const originalSms = smsProvider.client;
const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  smsProvider.client = originalSms;
  await app.close();
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Xavfsizlik do'koni", includedLicenses: 10 });
  ownerId = (await db.select({ id: users.id }).from(users).where(eq(users.phone, company.owner.phone)))[0]!.id;
});

const call = (cookie: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: object, headers: Record<string, string> = {}) =>
  app.inject({ method, url, headers: { cookie, ...headers }, ...(payload ? { payload } : {}) });

const memberActive = async (userId: string) =>
  (await db.select({ isActive: companyMembers.isActive }).from(companyMembers).where(and(eq(companyMembers.companyId, company.companyId), eq(companyMembers.userId, userId))))[0]!
    .isActive;
const userActive = async (userId: string) => (await db.select({ isActive: users.isActive }).from(users).where(eq(users.id, userId)))[0]!.isActive;

async function hrEmployee(cookie: string, userId: string, name = "Xodim") {
  const res = await call(cookie, "POST", "/api/hr/employees", { name, hireDate: today, baseSalary: "1000000", salaryType: "monthly", userId });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().employee.id as string;
}

describe("Xavfsizlik: a'zolik kirishini xodim/agent boshqaruvi orqali o'zgartirish", () => {
  it("HR menejeri yoki egasi ham egani ishdan bo'shatib kompaniyadan chiqara olmaydi; HR yozuvini o'chirish egaga tegmaydi", async () => {
    const hr = await addEmployee(app, company, "HR menejeri");
    const employeeId = await hrEmployee(company.ownerCookie, ownerId, "Ega (HR yozuvi)");

    // HR menejerida dastur kirishini boshqarish ruxsati yo'q — 403
    const byHr = await call(hr.cookie, "PATCH", `/api/hr/employees/${employeeId}`, { status: "terminated" });
    expect(byHr.statusCode, byHr.body).toBe(403);
    // Egasi o'zi ham — ega himoyalangan
    const byOwner = await call(company.ownerCookie, "PATCH", `/api/hr/employees/${employeeId}`, { status: "terminated" });
    expect(byOwner.statusCode, byOwner.body).toBe(403);
    expect(byOwner.json().message).toContain("egasi");

    expect(await memberActive(ownerId)).toBe(true);
    expect(await userActive(ownerId)).toBe(true);
    expect((await me(app, company.ownerCookie)).statusCode).toBe(200);

    expect((await call(company.ownerCookie, "DELETE", `/api/hr/employees/${employeeId}`)).statusCode).toBe(204);
    expect(await memberActive(ownerId)).toBe(true);
    expect((await me(app, company.ownerCookie)).statusCode).toBe(200);
  });

  it("agentlar menejeri egaga bog'langan savdo agentini faolsizlantirib egani bloklay olmaydi", async () => {
    const rep = await call(company.ownerCookie, "POST", "/api/distribution/sales-reps", { name: "Ega agent", userId: ownerId });
    expect(rep.statusCode, rep.body).toBe(201);
    const repId = (rep.json().salesRep ?? rep.json().rep).id as string;
    const deactivate = await call(company.ownerCookie, "PATCH", `/api/sales-agent/team/${repId}`, { isActive: false });
    expect(deactivate.statusCode, deactivate.body).toBe(403);
    expect(deactivate.json().code).toBe("FORBIDDEN");
    expect(await memberActive(ownerId)).toBe(true);
    expect((await me(app, company.ownerCookie)).statusCode).toBe(200);
  });

  it("qayta ishga olish platforma admini bloklagan hisobni ochmaydi; oddiy qayta ishga olish kirishni tiklaydi", async () => {
    const blocked = await addEmployee(app, company, "Kassir");
    const normal = await addEmployee(app, company, "Kassir");
    const blockedEmployee = await hrEmployee(company.ownerCookie, blocked.id, "Bloklangan");
    const normalEmployee = await hrEmployee(company.ownerCookie, normal.id, "Oddiy");

    for (const id of [blockedEmployee, normalEmployee]) {
      expect((await call(company.ownerCookie, "PATCH", `/api/hr/employees/${id}`, { status: "terminated" })).statusCode).toBe(200);
    }
    expect([await userActive(blocked.id), await userActive(normal.id)]).toEqual([false, false]);

    // Platforma admini bloklagan (audit yozuvi) — HR orqali qayta ishga olinsa ham hisob ochilmaydi
    await writeAuditLog({ action: "USER_BLOCKED", resource: "users", resourceId: blocked.id, severity: "warning" });
    for (const id of [blockedEmployee, normalEmployee]) {
      const rehire = await call(company.ownerCookie, "PATCH", `/api/hr/employees/${id}`, { status: "active" });
      expect(rehire.statusCode, rehire.body).toBe(200);
    }
    expect(await memberActive(blocked.id)).toBe(true);
    expect(await userActive(blocked.id)).toBe(false);
    expect(await userActive(normal.id)).toBe(true);
  });
});

describe("Xavfsizlik: parallel so'rovlar bilan limitlarni aylanib o'tish", () => {
  it("login: 12 ta parallel xato urinishdan ko'pi bilan 5 tasi parolni tekshiradi; keyin to'g'ri parol ham 429", async () => {
    const { phone, password } = await createUser();
    const results = await Promise.all(Array.from({ length: 12 }, () => login(app, phone, "xato-parol-000")));
    const codes = results.map((r) => r.res.statusCode);
    expect(codes.filter((code) => code === 401).length).toBeLessThanOrEqual(5);
    expect(codes.filter((code) => code === 429).length).toBeGreaterThanOrEqual(7);
    expect((await login(app, phone, password)).res.statusCode).toBe(429);
  });

  it("login: to'g'ri parol hisobni qaytaradi — muvaffaqiyatli kirishlar bloklamaydi", async () => {
    const { phone, password } = await createUser();
    for (let i = 0; i < 8; i++) expect((await login(app, phone, password)).res.statusCode).toBe(200);
  });

  it("parol tiklash: 15 ta parallel xato kod — kodga ko'pi bilan 5 urinish, kod yonadi, parol o'zgarmaydi", async () => {
    const sent: string[] = [];
    smsProvider.client = async (_phone, message) => {
      sent.push(message);
    };
    const victim = await createUser({ password: "eski-parol-123" });
    expect((await app.inject({ method: "POST", url: "/api/auth/password-reset/request", payload: { phone: victim.phone } })).statusCode).toBe(200);
    const code = sent.at(-1)!.match(/\b(\d{6})\b/)![1]!;
    const wrong = code === "000000" ? "111111" : "000000";

    const results = await Promise.all(
      Array.from({ length: 15 }, () =>
        app.inject({ method: "POST", url: "/api/auth/password-reset/confirm", payload: { phone: victim.phone, code: wrong, newPassword: "yangi-parol-456" } }),
      ),
    );
    expect(results.every((res) => res.statusCode === 400 || res.statusCode === 429)).toBe(true);
    const [record] = await db.select().from(passwordResetCodes).where(eq(passwordResetCodes.userId, victim.user.id));
    expect(record!.attempts).toBeLessThanOrEqual(5);
    expect(record!.consumedAt).not.toBeNull();

    const late = await app.inject({ method: "POST", url: "/api/auth/password-reset/confirm", payload: { phone: victim.phone, code, newPassword: "yangi-parol-456" } });
    expect([400, 429]).toContain(late.statusCode);
    expect((await login(app, victim.phone, "eski-parol-123")).res.statusCode).toBe(200);
  });
});

describe("Xavfsizlik: kassa qurilmasi boshqa xodim nomidan ish qila olmaydi", () => {
  it("qurilmada kirmagan xodim nomidan analitika va yuqori huquqli amal rad; smena qabul qilinadi; parol bilan kirgach ruxsat; bo'shatish va uzish bog'lanishni bekor qiladi", async () => {
    const [warehouse] = await db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.companyId, company.companyId));
    const registered = await app.inject({
      method: "POST",
      url: "/api/pos-device/setup/register",
      payload: { phone: company.owner.phone, password: company.owner.password, warehouseId: warehouse!.id, name: "Kassa X" },
    });
    expect(registered.statusCode, registered.body).toBe(201);
    const auth = { authorization: `Bearer ${registered.json().token as string}` };
    const deviceId = registered.json().device.id as string;
    const binding = async (userId: string) =>
      (await db.select().from(posDeviceCashiers).where(and(eq(posDeviceCashiers.deviceId, deviceId), eq(posDeviceCashiers.userId, userId))))[0];

    // Ro'yxatdan o'tkazgan ega bog'langan; "hech qachon kirmagan" holatini sinash uchun bekor qilinadi
    expect((await binding(ownerId))?.revokedAt).toBeNull();
    await db.update(posDeviceCashiers).set({ revokedAt: new Date() }).where(eq(posDeviceCashiers.deviceId, deviceId));

    const push = async (type: string, payload: object, cashierId = ownerId) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/pos-device/push",
        headers: auth,
        payload: { ops: [{ opId: randomUUID(), type, cashierId, createdAt: new Date().toISOString(), payload }] },
      });
      expect(res.statusCode, res.body).toBe(200);
      return res.json().results[0] as { status: string; error?: { code: string; details?: { reason?: string } } };
    };
    const analytics = () =>
      app.inject({ method: "GET", url: `/api/pos-device/analytics?from=${today}&to=${today}&cashierId=${ownerId}`, headers: auth });

    const denied = await analytics();
    expect(denied.statusCode, denied.body).toBe(403);
    expect(denied.json().details?.reason).toBe("cashier_not_bound");

    const customer = await call(company.ownerCookie, "POST", "/api/sales/customers", { name: "Mijoz A" });
    expect(customer.statusCode, customer.body).toBe(201);
    const customerId = customer.json().customer.id as string;
    const rename = { customerId, changes: { name: { from: "Mijoz A", to: "Mijoz B" } } };

    const elevated = await push("customer.update", rename);
    expect(elevated).toMatchObject({ status: "rejected", error: { code: "FORBIDDEN", details: { reason: "cashier_not_bound" } } });
    // Oddiy kassa amali (smena) bog'lanishsiz ham qabul qilinadi — offline ish to'xtamaydi
    expect(await push("shift.open", { shiftId: randomUUID(), openingCash: "0" })).toMatchObject({ status: "applied" });

    const login = await app.inject({
      method: "POST",
      url: "/api/pos-device/cashiers/login",
      headers: auth,
      payload: { phone: company.owner.phone, password: company.owner.password },
    });
    expect(login.statusCode, login.body).toBe(200);
    expect((await binding(ownerId))?.revokedAt).toBeNull();
    expect((await analytics()).statusCode).toBe(200);
    expect(await push("customer.update", rename)).toMatchObject({ status: "applied" });

    // Kassir qurilmada kirdi, keyin ishdan bo'shatildi — bog'lanish bekor
    const kassir = await addEmployee(app, company, "Kassir");
    const kassirLogin = await app.inject({
      method: "POST",
      url: "/api/pos-device/cashiers/login",
      headers: auth,
      payload: { phone: kassir.phone, password: "xodim-parol-123" },
    });
    expect(kassirLogin.statusCode, kassirLogin.body).toBe(200);
    expect((await binding(kassir.id))?.revokedAt).toBeNull();
    const employeeId = await hrEmployee(company.ownerCookie, kassir.id, "Kassir");
    expect((await call(company.ownerCookie, "PATCH", `/api/hr/employees/${employeeId}`, { status: "terminated" })).statusCode).toBe(200);
    expect((await binding(kassir.id))?.revokedAt).not.toBeNull();

    // Qurilma uzildi — barcha bog'lanishlar bekor
    expect((await app.inject({ method: "POST", url: "/api/pos-device/unregister", headers: auth })).statusCode).toBe(200);
    expect((await binding(ownerId))?.revokedAt).not.toBeNull();
  });
});

describe("Xavfsizlik: aqlli ogohlantirishlar ruxsat bo'yicha", () => {
  it("kutilayotgan xarajat ogohlantirishi moliya ruxsati yo'q kassirga ko'rinmaydi; egaga ko'rinadi", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const expense = await call(company.ownerCookie, "POST", "/api/finance/expenses", { category: "ijara", description: "Maxfiy ijara", amount: "5000000", expenseDate: today });
    expect(expense.statusCode, expense.body).toBe(201);
    const refresh = await call(company.ownerCookie, "POST", "/api/notifications/refresh");
    expect(refresh.statusCode, refresh.body).toBeLessThan(300);

    const list = async (cookie: string) =>
      (await call(cookie, "GET", "/api/notifications")).json().notifications as { id: string; relatedType: string | null; message: string }[];
    const ownerAlerts = await list(company.ownerCookie);
    const alert = ownerAlerts.find((item) => item.relatedType === "expenses");
    expect(alert?.message).toContain("Maxfiy ijara");

    const kassirAlerts = await list(kassir.cookie);
    expect(kassirAlerts.some((item) => item.relatedType === "expenses" || item.message.includes("Maxfiy ijara"))).toBe(false);
    // To'g'ridan-to'g'ri ID bilan ham o'qib/yopib bo'lmaydi
    expect((await call(kassir.cookie, "POST", `/api/notifications/${alert!.id}/read`)).statusCode).toBe(404);
  });
});

describe("Xavfsizlik: mijoz IP soxtalashtirilmaydi", () => {
  it("X-Forwarded-For dagi chap (mijoz yuborgan) qiymat emas, ishonchli proksi qo'shgan oxirgi qiymat yoziladi", async () => {
    const { user, phone } = await createUser();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { phone, password: "xato-parol-000" },
      headers: { "x-forwarded-for": "203.0.113.7, 198.51.100.9" },
    });
    expect(res.statusCode).toBe(401);
    const [row] = await db
      .select({ ipAddress: auditLogs.ipAddress })
      .from(auditLogs)
      .where(and(eq(auditLogs.userId, user.id), eq(auditLogs.action, "login_failed")));
    expect(row!.ipAddress).toBe("198.51.100.9");
  });
});

describe("Xavfsizlik: pul va ruxsat chegaralari", () => {
  let piece: string;
  let mainWh: string;
  let mainCash: string;
  let mainBank: string;
  let productId: string;
  const owner = () => company.ownerCookie;
  const balanceOf = async (id: string) => (await db.select({ balance: cashAccounts.balance }).from(cashAccounts).where(eq(cashAccounts.id, id)))[0]!.balance;
  const capitalAccount = async () =>
    (await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, "3000"))))[0]!.id;
  const openShift = async (cookie: string, openingCash = "0") => {
    const res = await call(cookie, "POST", "/api/sales/pos/shifts", { warehouseId: mainWh, openingCash });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().shift.id as string;
  };

  beforeEach(async () => {
    await db.delete(units);
    await seedDefaultUnits(db);
    piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
    mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
    const cash = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));
    mainCash = cash.find((row) => row.type === "cash")!.id;
    mainBank = cash.find((row) => row.type === "bank")!.id;
    const product = await call(owner(), "POST", "/api/catalog/products", { name: "Choy", sku: "CHOY", baseUnitId: piece, salesPrice: "5000", taxRate: "0" });
    expect(product.statusCode, product.body).toBe(201);
    productId = product.json().product.id as string;
    const stock = await call(owner(), "POST", "/api/inventory/stock/movements", { type: "receive", productId, warehouseId: mainWh, quantity: "40", costPrice: "3000" });
    expect(stock.statusCode, stock.body).toBe(201);
  });

  it("kassa: kutilgan naqddan ortiq chiqim va boshqa hisobga inkassatsiya kassirga rad; moliya ruxsati bilan inkassatsiya ishlaydi", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const shiftId = await openShift(kassir.cookie, "100000");
    const move = (cookie: string, body: object) => call(cookie, "POST", `/api/sales/pos/shifts/${shiftId}/cash-movements`, body);

    expect((await move(kassir.cookie, { kind: "other_out", amount: "150000" })).statusCode).toBe(400);
    const toBank = await move(kassir.cookie, { kind: "collection", amount: "50000", targetAccountId: mainBank });
    expect(toBank.statusCode, toBank.body).toBe(403);
    expect(await balanceOf(mainBank)).toBe("0.00");

    const within = await move(kassir.cookie, { kind: "other_out", amount: "40000" });
    expect(within.statusCode, within.body).toBeLessThan(300);
    // Kutilgan naqd endi 60 000 — undan 1 so'm ortig'i ham rad
    expect((await move(kassir.cookie, { kind: "collection", amount: "60001" })).statusCode).toBe(400);

    const fund = await call(owner(), "POST", "/api/finance/cash-transactions", { cashAccountId: mainCash, type: "in", amount: "100000", description: "Kirim", counterAccountId: await capitalAccount() });
    expect(fund.statusCode, fund.body).toBe(201);
    const byOwner = await move(owner(), { kind: "collection", amount: "20000", targetAccountId: mainBank });
    expect(byOwner.statusCode, byOwner.body).toBeLessThan(300);
    expect(await balanceOf(mainBank)).toBe("20000.00");
  });

  it("POS: balansga yoziladigan qaytim chek summasidan oshmaydi", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const shiftId = await openShift(kassir.cookie);
    const customer = await call(kassir.cookie, "POST", "/api/sales/pos/customers", { name: "Balansli mijoz" });
    expect(customer.statusCode, customer.body).toBe(201);
    const sell = (amountPaid: string) =>
      call(kassir.cookie, "POST", "/api/sales/pos/sales", {
        shiftId,
        customerId: customer.json().customer.id,
        items: [{ productId, quantity: "1" }],
        paymentMethod: "cash",
        amountPaid,
        changeToBalance: true,
      });

    const inflated = await sell("1000000");
    expect(inflated.statusCode, inflated.body).toBe(400);
    const normal = await sell("9000");
    expect(normal.statusCode, normal.body).toBe(201);
    expect(normal.json()).toMatchObject({ change: "0.00", changeToBalance: "4000.00" });
  });

  it("savdo qaytarish: karta bilan to'langan chekni naqd qaytarish moliya ruxsatisiz rad; asl usulda qaytadi", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const shiftId = await openShift(kassir.cookie, "100000");
    const sale = await call(kassir.cookie, "POST", "/api/sales/pos/sales", { shiftId, items: [{ productId, quantity: "2" }], paymentMethod: "card", amountPaid: "10000" });
    expect(sale.statusCode, sale.body).toBe(201);
    const orderId = sale.json().order.id as string;
    const [line] = await db.select().from(salesOrderItems).where(eq(salesOrderItems.orderId, orderId));

    const manager = await addEmployee(app, company, "Savdo menejeri");
    const giveBack = (refundMethod: string) =>
      call(manager.cookie, "POST", `/api/sales/orders/${orderId}/return-items`, { items: [{ orderItemId: line!.id, quantity: "1" }], refundMethod });
    const asCash = await giveBack("cash");
    expect(asCash.statusCode, asCash.body).toBe(403);
    const asCard = await giveBack("card");
    expect(asCard.statusCode, asCard.body).toBe(201);
  });

  it("xarid: qaytgan pul qaytarilgan tovar qiymatidan oshmaydi; sotuv narxini faqat products.edit bor qabul qiluvchi o'zgartiradi", async () => {
    const supplier = await call(owner(), "POST", "/api/purchase/suppliers", { name: "Ta'minotchi", code: "S-1" });
    expect(supplier.statusCode, supplier.body).toBe(201);
    const supplierId = supplier.json().supplier.id as string;
    const receivedOrder = async (receiverCookie: string, salesPrice: string | null) => {
      const created = await call(owner(), "POST", "/api/purchase/orders", {
        supplierId,
        warehouseId: mainWh,
        orderDate: today,
        items: [{ productId, unitId: piece, orderedQty: "2", unitPrice: "3000", salesPrice }],
      });
      expect(created.statusCode, created.body).toBe(201);
      const order = (await call(owner(), "POST", `/api/purchase/orders/${created.json().order.id}/confirm`)).json().order;
      const received = await call(receiverCookie, "POST", `/api/purchase/orders/${order.id}/receipts`, { items: [{ orderItemId: order.items[0].id, receivedQty: "2" }] });
      expect(received.statusCode, received.body).toBe(201);
      return order as { id: string; items: { id: string }[] };
    };
    const salesPrice = async () => Number((await db.select({ salesPrice: products.salesPrice }).from(products).where(eq(products.id, productId)))[0]!.salesPrice);

    const omborchi = await addEmployee(app, company, "Omborchi");
    await receivedOrder(omborchi.cookie, "9999");
    expect(await salesPrice()).toBe(5000);
    const order = await receivedOrder(owner(), "7777");
    expect(await salesPrice()).toBe(7777);

    const giveBack = (amount: string) =>
      call(owner(), "POST", `/api/purchase/orders/${order.id}/returns`, { items: [{ orderItemId: order.items[0]!.id, quantity: "1" }], refund: { amount, method: "cash" } });
    const inflated = await giveBack("5000");
    expect(inflated.statusCode, inflated.body).toBe(400);
    const exact = await giveBack("3000");
    expect(exact.statusCode, exact.body).toBeLessThan(300);
  });

  it("ombor: qo'lda kirimda qarshi buxgalteriya hisobini omborchi tanlay olmaydi", async () => {
    const omborchi = await addEmployee(app, company, "Omborchi");
    const counterAccountId = await capitalAccount();
    const receive = (cookie: string, extra: object) =>
      call(cookie, "POST", "/api/inventory/stock/movements", { type: "receive", productId, warehouseId: mainWh, quantity: "1", costPrice: "3000", ...extra });
    expect((await receive(omborchi.cookie, { counterAccountId })).statusCode).toBe(403);
    expect((await receive(omborchi.cookie, {})).statusCode).toBe(201);
    expect((await receive(owner(), { counterAccountId })).statusCode).toBe(201);
  });

  it("aralash to'lov: to'lov hujjatidagi mijoz buyurtma mijozidan farq qilsa rad", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const shiftId = await openShift(kassir.cookie);
    const customer = async (name: string) => (await call(owner(), "POST", "/api/sales/customers", { name })).json().customer.id as string;
    const buyer = await customer("Xaridor");
    const stranger = await customer("Begona mijoz");
    const sale = await call(kassir.cookie, "POST", "/api/sales/pos/sales", { shiftId, customerId: buyer, items: [{ productId, quantity: "2" }], paymentMethod: "cash", amountPaid: "0", onCredit: true });
    expect(sale.statusCode, sale.body).toBe(201);
    const orderId = sale.json().order.id as string;

    const pay = (customerId: string) => call(owner(), "POST", "/api/sales/payments", { orderId, customerId, parts: [{ method: "cash", amount: "1000" }] });
    const wrong = await pay(stranger);
    expect(wrong.statusCode, wrong.body).toBe(400);
    const right = await pay(buyer);
    expect(right.statusCode, right.body).toBeLessThan(300);
  });

  it("sozlamalar va rollar: pos.* umumiy yo'l bilan yozilmaydi; kurslar kurs ruxsatisiz saqlanmaydi; o'zidan kuchli rolni zaiflashtirib bo'lmaydi", async () => {
    expect((await call(owner(), "PUT", "/api/company/settings/pos.appearance", { value: "{}" })).statusCode).toBe(400);

    const createRole = async (name: string, permissions: string[]) => {
      const res = await call(owner(), "POST", "/api/company/roles", { name, permissions });
      expect(res.statusCode, res.body).toBe(201);
      return res.json().role.id as string;
    };
    await createRole("Sozlamachi", ["settings.view", "settings.manage"]);
    await createRole("Rollar admini", ["settings.view", "roles.manage"]);
    const financeRole = await createRole("Moliya boshlig'i", ["finance.view", "finance.manage"]);

    const settingsUser = await addEmployee(app, company, "Sozlamachi");
    const currencies = { cbuEnabled: false, currencies: [{ code: "USD", rate: "12500", source: "manual", isActive: true }] };
    expect((await call(settingsUser.cookie, "PUT", "/api/finance/currencies", currencies)).statusCode).toBe(403);
    expect((await call(owner(), "PUT", "/api/finance/currencies", currencies)).statusCode).toBe(200);

    const rolesAdmin = await addEmployee(app, company, "Rollar admini");
    const patchRole = (body: object) => call(rolesAdmin.cookie, "PATCH", `/api/company/roles/${financeRole}`, body);
    expect((await patchRole({ isActive: false })).statusCode).toBe(403);
    expect((await patchRole({ permissions: ["finance.view"] })).statusCode).toBe(403);
    expect((await patchRole({ description: "Moliya bo'limi" })).statusCode).toBe(200);
    const [stored] = await db.select({ isActive: roles.isActive, permissions: roles.permissions }).from(roles).where(eq(roles.id, financeRole));
    expect(stored).toMatchObject({ isActive: true });
    expect(stored!.permissions).toContain("finance.manage");
  });

  it("parol siyosati: keng tarqalgan va bir xil belgili parollar rad, murakkab parol qabul", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const change = (newPassword: string) => call(kassir.cookie, "POST", "/api/auth/password", { currentPassword: "xodim-parol-123", newPassword });
    for (const weak of ["12345678", "Password123", "aaaaaaaaaa"]) {
      const res = await change(weak);
      expect(res.statusCode, `${weak}: ${res.body}`).toBe(400);
    }
    const strong = await change("Tog-Olma-2026");
    expect(strong.statusCode, strong.body).toBeLessThan(300);
  });

  it("dostavka qaytarishi: pulni kassa yoki bankdan qaytarish sales.refund talab qiladi", async () => {
    const manager = await addEmployee(app, company, "Ombor menejeri");
    const giveBack = (refundMethod: string) => call(manager.cookie, "POST", `/api/delivery/tasks/${randomUUID()}/return`, { refundMethod });
    const asCash = await giveBack("cash");
    expect(asCash.statusCode, asCash.body).toBe(403);
    // Balansga qaytarish ruxsat tekshiruvidan o'tadi (yetkazma yo'q — 404)
    const toBalance = await giveBack("balance");
    expect(toBalance.statusCode, toBalance.body).toBe(404);
  });

  it("offline kassa: smena ochilishidan oldingi vaqtli amal rad; kutilgandan ortiq naqd chiqim qabul qilinib nomuvofiqlik yoziladi", async () => {
    const registered = await app.inject({
      method: "POST",
      url: "/api/pos-device/setup/register",
      payload: { phone: company.owner.phone, password: company.owner.password, warehouseId: mainWh, name: "Kassa Y" },
    });
    expect(registered.statusCode, registered.body).toBe(201);
    const auth = { authorization: `Bearer ${registered.json().token as string}` };
    const push = async (type: string, payload: object, createdAt = new Date()) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/pos-device/push",
        headers: auth,
        payload: { ops: [{ opId: randomUUID(), type, cashierId: ownerId, createdAt: createdAt.toISOString(), payload }] },
      });
      expect(res.statusCode, res.body).toBe(200);
      return res.json().results[0] as { status: string; error?: { details?: { reason?: string } } };
    };

    const shiftId = randomUUID();
    expect(await push("shift.open", { shiftId, openingCash: "0" })).toMatchObject({ status: "applied" });
    const early = await push("cash.movement", { movementId: randomUUID(), shiftId, kind: "other_out", amount: "1000" }, new Date(Date.now() - 60 * 60_000));
    expect(early).toMatchObject({ status: "rejected", error: { details: { reason: "before_shift" } } });

    const over = await push("cash.movement", { movementId: randomUUID(), shiftId, kind: "other_out", amount: "50000" });
    expect(over.status).toBe("applied");
    expect(JSON.stringify(over)).toContain("cash_exceeds_expected");
  });

  it("son chegarasidan oshish (PostgreSQL 22003) 500 emas, 400 qaytaradi", async () => {
    const mini = Fastify();
    registerErrorHandler(mini);
    mini.get("/overflow", async () => {
      throw Object.assign(new Error("numeric field overflow"), { code: "22003" });
    });
    const res = await mini.inject({ method: "GET", url: "/overflow" });
    await mini.close();
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "BAD_REQUEST" });
  });
});
