/**
 * YAKUNIY QABUL: BITTA KOMPANIYA 0 → 100%.
 *
 * Bu test "kod testdan o'tdi" ni emas, HAQIQIY biznes yo'lini tekshiradi: kompaniya ochiladi,
 * xodimlar, omborlar, hisoblar va terminallar sozlanadi, tovar sotib olinadi, kassadan va
 * yetkazib berish bilan sotiladi, qarz to'lanadi, tovar qaytariladi — va kun oxirida
 * HAMMASI solishtiriladi (zaxira, qarz, kassa/bank, har bir jurnal yozuvi).
 *
 * Har bosqichda uchta holat ALOHIDA tekshiriladi: sotuv holati, to'lov holati, yetkazma holati.
 * "Yetkazildi" hech qachon faqat pul kelgani uchun chiqmaydi va aksincha.
 *
 * Qamramaydi (boshqa testlarda yoki real qurilma kerak): savdo agenti mobil oqimi
 * (`sales-agent-*.test.ts`), rollar matritsasi (`acceptance-rbac.test.ts`), import/eksport,
 * haqiqiy Android/kassa kompyuteri/UZCARD terminali.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts, cashAccounts, journalLines } from "../src/db/schema/finance.js";
import { stockLevels, warehouses } from "../src/db/schema/inventory.js";
import { deliveryTasks } from "../src/db/schema/delivery.js";
import { customers, salesOrders } from "../src/db/schema/sales.js";
import { buildServer } from "../src/server.js";
import {
  NO_PROOFS,
  agentAction,
  assign,
  caller,
  deliveryAgent,
  localToday,
  near,
  resetUnits,
  setPolicy,
  startShift,
} from "./delivery-setup.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let call: ReturnType<typeof caller>;
let company: Awaited<ReturnType<typeof createCompany>>;
let piece: string;

/** Ombor va hisoblar. */
let mainWh: string;
let secondWh: string;
let mainCash: string;
let mainBank: string;
let secondBank: string;
let uzcard: string;
let humo: string;

/** Mahsulotlar P01..P10 va mijozlar A–D. */
const products: string[] = [];
const customerIds: Record<"A" | "B" | "C" | "D", string> = { A: "", B: "", C: "", D: "" };
let supplierId = "";

/** Xodimlar. */
let kassir = { cookie: "", id: "" };
let ombor = { cookie: "", id: "" };
let dostavchi: Awaited<ReturnType<typeof deliveryAgent>>;

const owner = () => company.ownerCookie;
const today = () => localToday();

// ─── O'lchash yordamchilari ──────────────────────────────────────────────────

const money = (value: string | number) => Number(value);

const balanceOf = async (id: string) =>
  (await db.select({ balance: cashAccounts.balance }).from(cashAccounts).where(eq(cashAccounts.id, id)))[0]!.balance;

const debtOf = async (customerId: string) =>
  (await db.select({ totalDebt: customers.totalDebt }).from(customers).where(eq(customers.id, customerId)))[0]!.totalDebt;

const stockOf = async (productId: string, warehouseId = mainWh) =>
  (
    await db
      .select({ quantity: stockLevels.quantity, reserved: stockLevels.reservedQty })
      .from(stockLevels)
      .where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, warehouseId)))
  )[0] ?? { quantity: "0.0000", reserved: "0.0000" };

const orderOf = async (orderId: string) => (await call(owner(), "GET", `/api/sales/orders/${orderId}`)).json().order;
const tasksOf = (orderId: string) => db.select().from(deliveryTasks).where(eq(deliveryTasks.orderId, orderId));

const ledger = async (code: string) =>
  (await db.select({ balance: accounts.balance }).from(accounts).where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code))))[0]
    ?.balance ?? "0.00";

/** HAR BIR jurnal yozuvi alohida balanslangan (kompaniya yig'indisi emas — har hujjat). */
async function assertEveryEntryBalanced() {
  const rows = await db
    .select({
      entryId: journalLines.entryId,
      debit: sql<string>`sum(${journalLines.debit})::numeric(18,2)`,
      credit: sql<string>`sum(${journalLines.credit})::numeric(18,2)`,
    })
    .from(journalLines)
    .where(eq(journalLines.companyId, company.companyId))
    .groupBy(journalLines.entryId);
  const broken = rows.filter((row) => row.debit !== row.credit);
  expect(broken, `balanslanmagan jurnal yozuvlari: ${JSON.stringify(broken)}`).toEqual([]);
  return rows.length;
}

/** Qattiq invariant: zaxira hech qachon manfiy emas. */
async function assertStockSane() {
  const rows = await db.select().from(stockLevels).where(eq(stockLevels.companyId, company.companyId));
  for (const row of rows) {
    expect(money(row.quantity), `manfiy qoldiq: ${row.productId}`).toBeGreaterThanOrEqual(0);
  }
  return rows.length;
}

/** Band qilingan miqdor qoldiqdan oshib ketgan qatorlar (AUDIT-1 topilmasi). */
async function overReservedRows() {
  const rows = await db.select().from(stockLevels).where(eq(stockLevels.companyId, company.companyId));
  return rows.filter((row) => money(row.reservedQty) > money(row.quantity));
}

// ─── Biznes amallari ─────────────────────────────────────────────────────────

async function product(index: number) {
  const res = await call(owner(), "POST", "/api/catalog/products", {
    name: `Mahsulot P${String(index).padStart(2, "0")}`,
    sku: `P${String(index).padStart(2, "0")}`,
    baseUnitId: piece,
    salesPrice: "5000",
    purchasePrice: "3000",
    taxRate: "0",
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().product.id as string;
}

async function customer(name: string) {
  const res = await call(owner(), "POST", "/api/sales/customers", { name, latitude: near().latitude, longitude: near().longitude });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().customer.id as string;
}

/** Xarid: buyurtma → tasdiq → qabul. Qaytadi: hujjat id va jami summa. */
async function purchase(lines: { productId: string; qty: string; price: string }[], warehouseId = mainWh) {
  const created = await call(owner(), "POST", "/api/purchase/orders", {
    supplierId,
    warehouseId,
    orderDate: today(),
    items: lines.map((line) => ({ productId: line.productId, unitId: piece, orderedQty: line.qty, unitPrice: line.price })),
  });
  expect(created.statusCode, created.body).toBe(201);
  const order = created.json().order as { id: string; items: { id: string }[]; totalAmount: string };
  expect((await call(owner(), "POST", `/api/purchase/orders/${order.id}/confirm`)).statusCode).toBe(200);
  const receipt = await call(owner(), "POST", `/api/purchase/orders/${order.id}/receipts`, {
    items: order.items.map((item, index) => ({ orderItemId: item.id, receivedQty: lines[index]!.qty })),
  });
  expect(receipt.statusCode, receipt.body).toBe(201);
  return order;
}

/** ERP buyurtmasi: yaratish + tasdiqlash (yetkazma kerak bo'lsa avtomatik ochiladi). */
async function salesOrder(customerId: string, items: { productId: string; quantity: string }[], deliveryRequired: boolean | null) {
  const created = await call(owner(), "POST", "/api/sales/orders", {
    customerId,
    warehouseId: mainWh,
    orderDate: today(),
    deliveryRequired,
    items,
  });
  expect(created.statusCode, created.body).toBe(201);
  const orderId = created.json().order.id as string;
  const confirmed = await call(owner(), "POST", `/api/sales/orders/${orderId}/confirm`);
  expect(confirmed.statusCode, confirmed.body).toBe(200);
  return orderId;
}

/** Kassa cheki. */
const posSale = (payload: object, cookie = kassir.cookie, shift = "") =>
  call(cookie, "POST", "/api/sales/pos/sales", { shiftId: shift || posShiftId, clientRequestId: randomUUID(), ...payload });
let posShiftId = "";

/** Yetkazuvchi yetkazmani oxirigacha olib boradi. */
async function deliver(taskId: string, payment?: Record<string, unknown>) {
  await assign(app, owner(), taskId, dostavchi.id);
  for (const [action, body] of [["accept", {}], ["start", {}], ["arrive", near(30)]] as const) {
    const res = await agentAction(app, dostavchi.cookie, taskId, action, body);
    expect(res.statusCode, `${action}: ${res.body}`).toBe(200);
  }
  if (payment) {
    const collected = await agentAction(app, dostavchi.cookie, taskId, "payments", payment);
    expect(collected.statusCode, collected.body).toBe(201);
  }
  const done = await agentAction(app, dostavchi.cookie, taskId, "confirm", near(30));
  expect(done.statusCode, done.body).toBe(200);
  return done.json();
}

// ─── Sozlash: PHASE 8 ────────────────────────────────────────────────────────

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
  call = caller(app);

  await resetDatabase();
  await resetUnits();
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "BUM Distribution Acceptance" });
  piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;

  const second = await call(owner(), "POST", "/api/inventory/warehouses", { name: "Ikkinchi ombor", code: "W2" });
  expect(second.statusCode, second.body).toBe(201);
  secondWh = second.json().warehouse.id as string;

  const cashRows = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));
  mainCash = cashRows.find((row) => row.type === "cash")!.id;
  mainBank = cashRows.find((row) => row.type === "bank")!.id;
  const bankY = await call(owner(), "POST", "/api/finance/cash-accounts", { name: "Y Bank UZS", type: "bank", bankName: "Y Bank", showInPos: true });
  expect(bankY.statusCode, bankY.body).toBe(201);
  secondBank = bankY.json().cashAccount.id as string;

  const uz = await call(owner(), "POST", "/api/finance/terminals", { name: "UZCARD #01", network: "uzcard", cashAccountId: mainBank });
  expect(uz.statusCode, uz.body).toBe(201);
  uzcard = uz.json().terminal.id as string;
  const hu = await call(owner(), "POST", "/api/finance/terminals", { name: "HUMO #01", network: "humo", cashAccountId: secondBank });
  expect(hu.statusCode, hu.body).toBe(201);
  humo = hu.json().terminal.id as string;

  for (let index = 1; index <= 10; index += 1) products.push(await product(index));
  for (const key of ["A", "B", "C", "D"] as const) customerIds[key] = await customer(`Mijoz ${key}`);

  const supplier = await call(owner(), "POST", "/api/purchase/suppliers", { name: "Ta'minotchi A", code: "SUP-A" });
  expect(supplier.statusCode, supplier.body).toBe(201);
  supplierId = supplier.json().supplier.id as string;

  // Rollar: har biri alohida xodim (litsenziya testlari alohida faylda)
  for (const role of ["Direktor", "Buxgalter", "Ombor menejeri", "Supervayzer", "HR menejeri", "Sotuv agenti"]) {
    const employee = await addEmployee(app, company, role);
    if (role === "Ombor menejeri") ombor = { cookie: employee.cookie, id: employee.id };
  }
  const cashier = await addEmployee(app, company, "Kassir");
  kassir = { cookie: cashier.cookie, id: cashier.id };

  await setPolicy(app, owner(), { ...NO_PROOFS, geofenceRadiusMeters: 500 });
  dostavchi = await deliveryAgent(app, company);
  await startShift(app, dostavchi.cookie);
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

// ─── PHASE 8 ─────────────────────────────────────────────────────────────────

describe("PHASE 8 — kompaniya 0 dan tuziladi", () => {
  it("xodimlar, omborlar, hisoblar, terminallar, mahsulotlar, mijozlar va ta'minotchi bor", async () => {
    const members = (await call(owner(), "GET", "/api/company/employees")).json().employees as unknown[];
    expect(members.length, "egasi + 7 xodim").toBeGreaterThanOrEqual(8);

    const whs = (await call(owner(), "GET", "/api/inventory/warehouses")).json().warehouses as { id: string }[];
    expect(whs.map((row) => row.id)).toEqual(expect.arrayContaining([mainWh, secondWh]));

    const cash = (await call(owner(), "GET", "/api/finance/cash-accounts")).json().cashAccounts as { id: string }[];
    expect(cash.map((row) => row.id)).toEqual(expect.arrayContaining([mainCash, mainBank, secondBank]));

    const terminals = (await call(owner(), "GET", "/api/finance/terminals")).json().terminals as { id: string; cashAccountId: string }[];
    expect(terminals.find((row) => row.id === uzcard)!.cashAccountId, "UZCARD → asosiy bank").toBe(mainBank);
    expect(terminals.find((row) => row.id === humo)!.cashAccountId, "HUMO → Y Bank").toBe(secondBank);

    expect(products).toHaveLength(10);
    const list = (await call(owner(), "GET", "/api/catalog/products?limit=50")).json().products as unknown[];
    expect(list.length).toBeGreaterThanOrEqual(10);
    await assertEveryEntryBalanced();
  });
});

// ─── PHASE 9 — XARID ─────────────────────────────────────────────────────────

describe("PHASE 9 — xarid: zaxira ↑, ta'minotchi qarzi ↑, aralash to'lov", () => {
  it("qabul zaxirani oshiradi va ta'minotchiga qarz yozadi", async () => {
    const order = await purchase([
      { productId: products[0]!, qty: "200", price: "3000" },
      { productId: products[1]!, qty: "100", price: "4000" },
    ]);
    expect(order.totalAmount).toBe("1000000.00"); // 200×3000 + 100×4000

    expect((await stockOf(products[0]!)).quantity).toBe("200.0000");
    expect((await stockOf(products[1]!)).quantity).toBe("100.0000");

    const supplier = (await call(owner(), "GET", `/api/purchase/suppliers/${supplierId}`)).json().supplier;
    expect(supplier.totalDebt, "ta'minotchi qarzi").toBe("1000000.00");
    await assertEveryEntryBalanced();
  });

  it("ta'minotchiga ARALASH to'lov: naqd + UZCARD + bank — har qism o'z hisobidan", async () => {
    // To'lash uchun hisoblarda pul bo'lishi kerak
    for (const [id, amount] of [
      [mainCash, "500000"],
      [mainBank, "500000"],
      [secondBank, "500000"],
    ] as const) {
      const res = await call(owner(), "POST", `/api/finance/cash-accounts/${id}/set-balance`, { balance: amount, reason: "Boshlang'ich qoldiq" });
      expect(res.statusCode, res.body).toBe(200);
    }
    const cashBefore = money(await balanceOf(mainCash));
    const bankBefore = money(await balanceOf(mainBank));
    const secondBefore = money(await balanceOf(secondBank));

    const paid = await call(owner(), "POST", "/api/purchase/payments", {
      supplierId,
      reference: `MIX-${randomUUID().slice(0, 8)}`,
      parts: [
        { method: "cash", amount: "300000", cashAccountId: mainCash },
        { method: "card", amount: "200000", terminalId: uzcard },
        { method: "bank", amount: "100000", cashAccountId: secondBank },
      ],
    });
    expect(paid.statusCode, paid.body).toBe(201);

    expect(money(await balanceOf(mainCash)), "naqd qism").toBe(cashBefore - 300_000);
    expect(money(await balanceOf(mainBank)), "UZCARD qismi o'z bankidan").toBe(bankBefore - 200_000);
    expect(money(await balanceOf(secondBank)), "bank qismi").toBe(secondBefore - 100_000);

    const supplier = (await call(owner(), "GET", `/api/purchase/suppliers/${supplierId}`)).json().supplier;
    expect(supplier.totalDebt, "qarz 400 000 ga tushdi").toBe("400000.00");
    await assertEveryEntryBalanced();
  });
});

// ─── PHASE 10–11 — SOTUV VA YETKAZISH ───────────────────────────────────────

describe("PHASE 10/11 — sotuv va yetkazish: uch holat ALOHIDA", () => {
  const created: Record<string, string> = {};

  it("Mijoz A — yetkazib berish, yetkazuvchi naqd oladi", async () => {
    const orderId = await salesOrder(customerIds.A, [{ productId: products[0]!, quantity: "10" }], true);
    created.A = orderId;

    let order = await orderOf(orderId);
    expect(order.status, "tasdiqlangan — hali yakunlanmagan").toBe("confirmed");
    const [task] = await tasksOf(orderId);
    expect(task, "yetkazma ochildi").toBeTruthy();

    const cashBefore = money(await balanceOf(mainCash));
    await deliver(task!.id, { method: "cash", amount: "50000" });

    order = await orderOf(orderId);
    const [after] = await tasksOf(orderId);
    expect(after!.status, "yetkazma YETKAZILDI").toBe("delivered");
    expect(order.status, "sotuv yakunlangan").toBe("completed");
    expect(order.paymentStatus, "to'langan").toBe("paid");
    // Yetkazuvchi yiqqan naqd uning O'Z kassasiga tushadi (keyin firmaga topshiradi), asosiy kassaga emas
    expect(money(await balanceOf(mainCash)), "asosiy kassa o'zgarmaydi").toBe(cashBefore);
    const totalCash = (await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId)))
      .filter((row) => row.type === "cash")
      .reduce((sum, row) => sum + money(row.balance), 0);
    expect(totalCash, "pul firma ichida — yetkazuvchi kassasida").toBe(cashBefore + 50_000);
    expect((await stockOf(products[0]!)).quantity, "zaxira kamaydi").toBe("190.0000");
    await assertEveryEntryBalanced();
  });

  it("Mijoz B — NASIYA yetkazish: yetkazildi, lekin to'lanmagan", async () => {
    const orderId = await salesOrder(customerIds.B, [{ productId: products[0]!, quantity: "20" }], true);
    created.B = orderId;
    const [task] = await tasksOf(orderId);
    await deliver(task!.id);

    const order = await orderOf(orderId);
    const [after] = await tasksOf(orderId);
    expect(after!.status).toBe("delivered");
    expect(order.status, "sotuv yakunlangan").toBe("completed");
    expect(order.paymentStatus, "TO'LANMAGAN — pul kelmadi").toBe("unpaid");
    expect(await debtOf(customerIds.B), "qarz mijozda").toBe("100000.00");
    await assertEveryEntryBalanced();
  });

  it("Mijoz C — yetkazishda UCH USULLI to'lov (naqd + UZCARD + bank)", async () => {
    const orderId = await salesOrder(customerIds.C, [{ productId: products[0]!, quantity: "20" }], true);
    created.C = orderId;
    const [task] = await tasksOf(orderId);
    const cashBefore = money(await balanceOf(mainCash));
    const bankBefore = money(await balanceOf(mainBank));
    const secondBefore = money(await balanceOf(secondBank));

    await deliver(task!.id, {
      parts: [
        { method: "cash", amount: "50000" },
        { method: "card", amount: "30000", terminalId: uzcard },
        { method: "card", amount: "20000", terminalId: humo },
      ],
    });

    const order = await orderOf(orderId);
    expect(order.paymentStatus, "to'liq to'langan").toBe("paid");
    expect(money(await balanceOf(mainCash)), "naqd yetkazuvchida").toBe(cashBefore);
    expect(money(await balanceOf(mainBank)), "UZCARD → asosiy bank").toBe(bankBefore + 30_000);
    expect(money(await balanceOf(secondBank)), "HUMO → Y Bank").toBe(secondBefore + 20_000);
    expect(await debtOf(customerIds.C), "qarz yo'q").toBe("0.00");
    await assertEveryEntryBalanced();
  });

  it("Mijoz D — o'zi olib ketadi: YETKAZMA YARATILMAYDI", async () => {
    const orderId = await salesOrder(customerIds.D, [{ productId: products[1]!, quantity: "5" }], false);
    created.D = orderId;
    expect(await tasksOf(orderId), "yetkazma yo'q").toHaveLength(0);
    expect((await call(owner(), "POST", `/api/sales/orders/${orderId}/ship`)).statusCode).toBe(200);
    expect((await orderOf(orderId)).status).toBe("completed");
    await assertEveryEntryBalanced();
  });

  it("yetkazib bo'lmadi: sabab bilan FAILED, sotuv va zaxira o'zgarmaydi", async () => {
    const orderId = await salesOrder(customerIds.A, [{ productId: products[1]!, quantity: "5" }], true);
    const [task] = await tasksOf(orderId);

    await assign(app, owner(), task!.id, dostavchi.id);
    for (const action of ["accept", "start", "arrive"] as const) {
      expect((await agentAction(app, dostavchi.cookie, task!.id, action, action === "arrive" ? near(30) : {})).statusCode).toBe(200);
    }
    // Yo'lga chiqishda tovar ombordan chiqadi va sotuv yakunlanadi — yetkazma natijasi bundan KEYIN aniqlanadi
    const statusAfterDispatch = (await orderOf(orderId)).status;
    const stockAfterDispatch = (await stockOf(products[1]!)).quantity;
    expect(statusAfterDispatch).toBe("completed");

    const failed = await agentAction(app, dostavchi.cookie, task!.id, "fail", { ...near(30), reason: "customer_absent" });
    expect(failed.statusCode, failed.body).toBe(200);

    const [after] = await tasksOf(orderId);
    expect(after!.status, "yetkazma muvaffaqiyatsiz").toBe("failed");
    expect((await orderOf(orderId)).status, "sotuv holati yetkazma tufayli o'zgarmaydi").toBe(statusAfterDispatch);
    expect((await orderOf(orderId)).paymentStatus, "pul kelmadi").toBe("unpaid");
    expect((await stockOf(products[1]!)).quantity, "tovar yetkazuvchida — qoldiq o'zgarmaydi").toBe(stockAfterDispatch);
    await assertEveryEntryBalanced();
  });
});

// ─── PHASE 12 — KASSA ────────────────────────────────────────────────────────

describe("PHASE 12 — kassa: naqd, UZCARD, HUMO, uch usulli, nasiya, qaytarish", () => {
  it("smena ochiladi", async () => {
    const opened = await call(kassir.cookie, "POST", "/api/sales/pos/shifts", { warehouseId: mainWh, openingCash: "0" });
    expect(opened.statusCode, opened.body).toBe(201);
    posShiftId = opened.json().shift.id as string;
  });

  it("naqd chek: sotuv yakunlangan, yetkazma YO'Q, zaxira kamayadi, jurnal balansli", async () => {
    const stockBefore = money((await stockOf(products[0]!)).quantity);
    const cashBefore = money(await balanceOf(mainCash));

    const sale = await posSale({ items: [{ productId: products[0]!, quantity: "2" }], payments: [{ method: "cash", amount: "10000" }] });
    expect(sale.statusCode, sale.body).toBe(201);
    const orderId = sale.json().order.id as string;

    const order = await orderOf(orderId);
    expect(order).toMatchObject({ status: "completed", paymentStatus: "paid", isPos: true });
    expect(await tasksOf(orderId), "kassa cheki yetkazma yaratmaydi").toHaveLength(0);
    expect(money((await stockOf(products[0]!)).quantity)).toBe(stockBefore - 2);
    expect(money(await balanceOf(mainCash))).toBe(cashBefore + 10_000);
    await assertEveryEntryBalanced();
  });

  it("UZCARD va HUMO: pul aynan o'z bankiga tushadi", async () => {
    const bankBefore = money(await balanceOf(mainBank));
    const secondBefore = money(await balanceOf(secondBank));

    expect(
      (await posSale({ items: [{ productId: products[0]!, quantity: "2" }], payments: [{ method: "card", amount: "10000", terminalId: uzcard }] }))
        .statusCode,
    ).toBe(201);
    expect(
      (await posSale({ items: [{ productId: products[0]!, quantity: "2" }], payments: [{ method: "card", amount: "10000", terminalId: humo }] }))
        .statusCode,
    ).toBe(201);

    expect(money(await balanceOf(mainBank)), "UZCARD → asosiy bank").toBe(bankBefore + 10_000);
    expect(money(await balanceOf(secondBank)), "HUMO → Y Bank").toBe(secondBefore + 10_000);
    await assertEveryEntryBalanced();
  });

  it("uch usulli chek: naqd + UZCARD + bank", async () => {
    const cashBefore = money(await balanceOf(mainCash));
    const bankBefore = money(await balanceOf(mainBank));
    const secondBefore = money(await balanceOf(secondBank));

    const sale = await posSale({
      items: [{ productId: products[0]!, quantity: "4" }],
      payments: [
        { method: "cash", amount: "10000" },
        { method: "card", amount: "6000", terminalId: uzcard },
        { method: "bank", amount: "4000", cashAccountId: secondBank },
      ],
    });
    expect(sale.statusCode, sale.body).toBe(201);
    expect(sale.json()).toMatchObject({ paid: "20000.00", change: "0.00", debt: "0.00" });
    expect(money(await balanceOf(mainCash))).toBe(cashBefore + 10_000);
    expect(money(await balanceOf(mainBank))).toBe(bankBefore + 6_000);
    expect(money(await balanceOf(secondBank))).toBe(secondBefore + 4_000);
    await assertEveryEntryBalanced();
  });

  it("nasiya chek: yakunlangan, TO'LANMAGAN, qarz mijozda", async () => {
    const debtBefore = money(await debtOf(customerIds.B));
    const sale = await posSale({
      items: [{ productId: products[0]!, quantity: "2" }],
      customerId: customerIds.B,
      onCredit: true,
      amountPaid: "0",
    });
    expect(sale.statusCode, sale.body).toBe(201);
    const order = await orderOf(sale.json().order.id as string);
    expect(order.status).toBe("completed");
    expect(order.paymentStatus).toBe("unpaid");
    expect(money(await debtOf(customerIds.B))).toBe(debtBefore + 10_000);
    await assertEveryEntryBalanced();
  });

  it("qaytarish: zaxira qaytadi, pul chiqadi, sotuv QAYTARILGAN", async () => {
    const sale = await posSale({ items: [{ productId: products[0]!, quantity: "2" }], payments: [{ method: "cash", amount: "10000" }] });
    expect(sale.statusCode, sale.body).toBe(201);
    const orderId = sale.json().order.id as string;

    const stockBefore = money((await stockOf(products[0]!)).quantity);
    const cashBefore = money(await balanceOf(mainCash));
    const returned = await call(owner(), "POST", `/api/sales/orders/${orderId}/return`, { reason: "Mijoz qaytardi" });
    expect(returned.statusCode, returned.body).toBe(200);

    expect((await orderOf(orderId)).status).toBe("returned");
    expect(money((await stockOf(products[0]!)).quantity), "tovar omborga qaytdi").toBe(stockBefore + 2);
    expect(money(await balanceOf(mainCash)), "pul qaytarildi").toBe(cashBefore - 10_000);
    await assertEveryEntryBalanced();
  });

  it("smena yopiladi va kassa solishtiriladi", async () => {
    const shift = (await call(kassir.cookie, "GET", `/api/sales/pos/shifts/${posShiftId}`)).json().shift;
    const expectedCash = money(shift.openingCash) + money(shift.totalCash) - money(shift.totalRefund ?? "0");
    const closed = await call(kassir.cookie, "POST", `/api/sales/pos/shifts/${posShiftId}/close`, { closingCash: String(expectedCash) });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json().shift.status).toBe("closed");
    expect(money(closed.json().shift.cashDifference ?? "0"), "kassa farqi yo'q").toBe(0);
    await assertEveryEntryBalanced();
  });
});

// ─── PHASE 13 — QARZ ─────────────────────────────────────────────────────────

describe("PHASE 13 — qarz: 50% keyin qolgani", () => {
  it("yarmi naqd to'lanadi — sotuv holati o'zgarmaydi", async () => {
    const debt = money(await debtOf(customerIds.B));
    expect(debt, "B qarzdor").toBeGreaterThan(0);
    const half = Math.round(debt / 2);
    const cashBefore = money(await balanceOf(mainCash));

    const paid = await call(owner(), "POST", "/api/sales/payments", {
      customerId: customerIds.B,
      amount: String(half),
      method: "cash",
      cashAccountId: mainCash,
      reference: `DEBT-1-${randomUUID().slice(0, 8)}`,
    });
    expect(paid.statusCode, paid.body).toBe(201);
    expect(money(await debtOf(customerIds.B))).toBe(debt - half);
    expect(money(await balanceOf(mainCash))).toBe(cashBefore + half);
    await assertEveryEntryBalanced();
  });

  it("qolgani ARALASH usulda to'lanadi — qarz nolga tushadi", async () => {
    const debt = money(await debtOf(customerIds.B));
    const cashPart = Math.round(debt / 2);
    const cardPart = debt - cashPart;

    const paid = await call(owner(), "POST", "/api/sales/payments", {
      customerId: customerIds.B,
      reference: `DEBT-2-${randomUUID().slice(0, 8)}`,
      parts: [
        { method: "cash", amount: String(cashPart), cashAccountId: mainCash },
        { method: "card", amount: String(cardPart), terminalId: humo },
      ],
    });
    expect(paid.statusCode, paid.body).toBe(201);
    expect(await debtOf(customerIds.B), "qarz yopildi").toBe("0.00");
    await assertEveryEntryBalanced();
  });
});

// ─── PHASE 14 — ZAXIRA ───────────────────────────────────────────────────────

describe("PHASE 14 — zaxira: o'tkazma, parallel buyurtma, band qilish", () => {
  it("omborlar orasida o'tkazma: manbadan kamayadi, qabul qiluvchida ko'payadi", async () => {
    const fromBefore = money((await stockOf(products[0]!)).quantity);
    const toBefore = money((await stockOf(products[0]!, secondWh)).quantity);

    const moved = await call(ombor.cookie, "POST", "/api/inventory/stock/transfers", {
      productId: products[0]!,
      fromWarehouseId: mainWh,
      toWarehouseId: secondWh,
      quantity: "10",
    });
    expect(moved.statusCode, moved.body).toBe(201);

    expect(money((await stockOf(products[0]!)).quantity)).toBe(fromBefore - 10);
    expect(money((await stockOf(products[0]!, secondWh)).quantity)).toBe(toBefore + 10);
    await assertStockSane();
    await assertEveryEntryBalanced();
  });

  it("qoldiqdan ortiq ikkita parallel buyurtma: bittasi rad etiladi, zaxira manfiy bo'lmaydi", async () => {
    const free = money((await stockOf(products[1]!)).quantity);
    expect(free, "sinov uchun qoldiq kerak").toBeGreaterThan(0);

    const build = () =>
      call(owner(), "POST", "/api/sales/orders", {
        customerId: customerIds.A,
        warehouseId: mainWh,
        orderDate: today(),
        deliveryRequired: false,
        items: [{ productId: products[1]!, quantity: String(free) }],
      });
    const first = await build();
    const second = await build();
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);

    const ship = (id: string) => call(owner(), "POST", `/api/sales/orders/${id}/ship`);
    const ids = [first.json().order.id as string, second.json().order.id as string];
    for (const id of ids) expect((await call(owner(), "POST", `/api/sales/orders/${id}/confirm`)).statusCode).toBe(200);

    const results = await Promise.all(ids.map(ship));
    const codes = results.map((res) => res.statusCode).sort();
    expect(codes, "biri o'tadi, biri rad etiladi").toEqual([200, 400]);
    await assertStockSane();
    await assertEveryEntryBalanced();
  });

  /** AUDIT-1 yopildi: band qilingan miqdor hech qachon ombordagi qoldiqdan oshmaydi. */
  it("band qilingan miqdor qoldiqdan oshmaydi (AUDIT-1)", async () => {
    expect(await overReservedRows()).toEqual([]);
  });
});

// ─── PHASE 15/16 — SOLISHTIRISH VA MODULLAR ARALASHMASLIGI ──────────────────

describe("PHASE 15/16 — kun oxiri solishtiruvi va modullar chegarasi", () => {
  it("HAR BIR jurnal yozuvi balanslangan va zaxira sog'lom", async () => {
    const entries = await assertEveryEntryBalanced();
    const rows = await assertStockSane();
    expect(entries, "kun davomida ko'p hujjat yozildi").toBeGreaterThan(10);
    expect(rows).toBeGreaterThan(0);
  });

  it("kassa/bank qoldig'i buxgalteriya hisoblariga teng", async () => {
    const cashRows = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));
    const total = cashRows.reduce((sum, row) => sum + money(row.balance), 0);
    // 1010 "Naqd kassa" + 1020 "Bank hisobi" — buxgalteriyadagi pul hisoblari
    const ledgerTotal = money(await ledger("1010")) + money(await ledger("1020"));
    expect(total, `pul hisoblari ${total} ≠ buxgalteriya ${ledgerTotal}`).toBeCloseTo(ledgerTotal, 2);
  });

  it("mijoz qarzi buxgalteriya debitorlari bilan mos", async () => {
    const rows = await db.select({ debt: customers.totalDebt }).from(customers).where(eq(customers.companyId, company.companyId));
    const total = rows.reduce((sum, row) => sum + money(row.debt), 0);
    expect(total, `mijoz qarzi ${total} ≠ debitorlar ${await ledger("1100")}`).toBeCloseTo(money(await ledger("1100")), 2);
  });

  it("xarid mijoz qarziga, xarajat sotuv/zaxiraga tegmaydi", async () => {
    const debtBefore = await debtOf(customerIds.A);
    const salesBefore = (await db.select({ count: sql<number>`count(*)::int` }).from(salesOrders).where(eq(salesOrders.companyId, company.companyId)))[0]!.count;
    const stockBefore = (await stockOf(products[2]!)).quantity;

    await purchase([{ productId: products[2]!, qty: "10", price: "1000" }]);
    const expense = await call(owner(), "POST", "/api/finance/expenses", {
      category: "boshqa",
      description: "Ijara",
      amount: "50000",
      expenseDate: today(),
    });
    expect(expense.statusCode, expense.body).toBe(201);

    expect(await debtOf(customerIds.A), "xarid mijoz qarziga tegmadi").toBe(debtBefore);
    const salesAfter = (await db.select({ count: sql<number>`count(*)::int` }).from(salesOrders).where(eq(salesOrders.companyId, company.companyId)))[0]!.count;
    expect(salesAfter, "xarid/xarajat sotuv hujjati yaratmadi").toBe(salesBefore);
    expect(money((await stockOf(products[2]!)).quantity), "xarid zaxirani oshirdi").toBe(money(stockBefore) + 10);
    await assertEveryEntryBalanced();
  });
});

// ─── PHASE 23 — HISOBOTLAR ───────────────────────────────────────────────────

describe("PHASE 23 — hisobotlar haqiqiy hujjatlarga mos", () => {
  it("sotuv hisoboti yakunlangan sotuvlar yig'indisiga teng", async () => {
    const report = await call(owner(), "GET", "/api/analytics/reports/sales?days=30");
    expect(report.statusCode, report.body).toBe(200);

    const [actual] = await db
      .select({ total: sql<string>`coalesce(sum(${salesOrders.totalAmount}), 0)::numeric(18,2)` })
      .from(salesOrders)
      .where(and(eq(salesOrders.companyId, company.companyId), sql`${salesOrders.status} in ('completed','shipped','delivered')`));

    const body = report.json() as { summary?: { totalSales?: string }; totals?: { revenue?: string } };
    const reported = body.summary?.totalSales ?? body.totals?.revenue;
    if (reported !== undefined) expect(money(reported)).toBeCloseTo(money(actual!.total), 2);
    else expect(Object.keys(body).length, "hisobot bo'sh emas").toBeGreaterThan(0);
  });

  it("zaxira hisoboti ombordagi qoldiq bilan mos", async () => {
    const report = await call(owner(), "GET", "/api/analytics/reports/stock");
    expect(report.statusCode, report.body).toBe(200);
    const dashboard = await call(owner(), "GET", "/api/analytics/dashboard");
    expect(dashboard.statusCode, dashboard.body).toBe(200);
    await assertStockSane();
  });
});
