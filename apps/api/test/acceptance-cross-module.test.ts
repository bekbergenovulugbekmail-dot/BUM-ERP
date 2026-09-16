/**
 * QABUL TESTI — modullararo ifloslanish (cross-module contamination).
 *
 * Usul: har amaldan oldin va keyin butun kompaniya holati suratga olinadi (sotuv, yetkazma, xarid, ishlab chiqarish,
 * zaxira, qarz, kassa, buxgalteriya) va faqat KUTILGAN o'lchov o'zgarganini tasdiqlanadi. Shu bilan "bir modul
 * boshqasining biznes ma'nosini o'zgartirmaydi" qoidasi taxmin bilan emas, o'lchov bilan tekshiriladi.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { deliveryTasks } from "../src/db/schema/delivery.js";
import { cashAccounts, journalEntries, journalLines } from "../src/db/schema/finance.js";
import { stockLevels } from "../src/db/schema/inventory.js";
import { productionOrders } from "../src/db/schema/manufacturing.js";
import { purchaseOrders, suppliers } from "../src/db/schema/purchase.js";
import { customers, salesOrders } from "../src/db/schema/sales.js";
import { buildServer } from "../src/server.js";
import {
  NO_PROOFS,
  agentAction,
  arrivedTask,
  assign,
  caller,
  confirmedOrder,
  deliveryAgent,
  deliveryCompany,
  localToday,
  near,
  resetUnits,
  setPolicy,
  startShift,
  taskForOrder,
  type DeliveryCompany,
} from "./delivery-setup.js";
import { addEmployee, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let call: ReturnType<typeof caller>;
let adminCookie: string;
let company: DeliveryCompany;
let piece: string;
let mainCash: string;
let mainBank: string;

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
  company = await deliveryCompany(app, adminCookie, "Ko'p biznesli kompaniya");
  piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const rows = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));
  mainCash = rows.find((row) => row.type === "cash")!.id;
  mainBank = rows.find((row) => row.type === "bank")!.id;
});

const owner = () => company.ownerCookie;
const today = () => localToday();

/** Butun kompaniya holati — modullararo ta'sirni o'lchash uchun. */
async function snapshot() {
  const cid = company.companyId;
  const [sales, tasks, purchases, production, stock, cash, debt, supplierDebt, journal] = await Promise.all([
    db.select({ id: salesOrders.id, status: salesOrders.status, paid: salesOrders.paidAmount, fm: salesOrders.fulfillmentMethod, src: salesOrders.source })
      .from(salesOrders).where(eq(salesOrders.companyId, cid)).orderBy(salesOrders.id),
    db.select({ id: deliveryTasks.id, status: deliveryTasks.status }).from(deliveryTasks).where(eq(deliveryTasks.companyId, cid)).orderBy(deliveryTasks.id),
    db.select({ id: purchaseOrders.id, status: purchaseOrders.status, paid: purchaseOrders.paidAmount })
      .from(purchaseOrders).where(eq(purchaseOrders.companyId, cid)).orderBy(purchaseOrders.id),
    db.select({ id: productionOrders.id, status: productionOrders.status }).from(productionOrders).where(eq(productionOrders.companyId, cid)).orderBy(productionOrders.id),
    db.select({ productId: stockLevels.productId, qty: stockLevels.quantity }).from(stockLevels).where(eq(stockLevels.companyId, cid)).orderBy(stockLevels.productId),
    db.select({ id: cashAccounts.id, balance: cashAccounts.balance }).from(cashAccounts).where(eq(cashAccounts.companyId, cid)).orderBy(cashAccounts.id),
    db.select({ id: customers.id, debt: customers.totalDebt, balance: customers.balance }).from(customers).where(eq(customers.companyId, cid)).orderBy(customers.id),
    db.select({ id: suppliers.id, debt: suppliers.totalDebt }).from(suppliers).where(eq(suppliers.companyId, cid)).orderBy(suppliers.id),
    db.select({
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)::numeric(18,2)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)::numeric(18,2)`,
      entries: sql<number>`(select count(*)::int from ${journalEntries} je where je.company_id = ${cid})`,
    }).from(journalLines).where(eq(journalLines.companyId, cid)),
  ]);
  return { sales, tasks, purchases, production, stock, cash, debt, supplierDebt, journal: journal[0]! };
}

type Snap = Awaited<ReturnType<typeof snapshot>>;

/** Buxgalteriya har doim balanslangan bo'lishi shart. */
function expectBalanced(snap: Snap) {
  expect(snap.journal.debit, "debet ≠ kredit").toBe(snap.journal.credit);
}

/** Ko'rsatilgan o'lchovlar o'zgarmaganini tasdiqlaydi. */
function expectUnchanged(before: Snap, after: Snap, keys: (keyof Snap)[]) {
  for (const key of keys) {
    expect(after[key], `${String(key)} o'zgarmasligi kerak edi`).toEqual(before[key]);
  }
}

async function product(name: string, sku: string, salesPrice = "5000") {
  const res = await call(owner(), "POST", "/api/catalog/products", { name, sku, baseUnitId: piece, salesPrice, taxRate: "0" });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().product.id as string;
}

async function receive(productId: string, quantity: string, costPrice: string) {
  const res = await call(owner(), "POST", "/api/inventory/stock/movements", {
    type: "receive",
    productId,
    warehouseId: company.warehouseId,
    quantity,
    costPrice,
  });
  expect(res.statusCode, res.body).toBe(201);
}

async function openShift() {
  const kassir = await addEmployee(app, company, "Kassir");
  const res = await call(kassir.cookie, "POST", "/api/sales/pos/shifts", { warehouseId: company.warehouseId, openingCash: "0" });
  expect(res.statusCode, res.body).toBe(201);
  return { cookie: kassir.cookie, shiftId: res.json().shift.id as string };
}

async function fund(accountId: string, balance: string) {
  const res = await call(owner(), "POST", `/api/finance/cash-accounts/${accountId}/set-balance`, { balance, reason: "Sinov qoldig'i" });
  expect(res.statusCode, res.body).toBe(200);
}

async function supplierWithDebt(totalDebt: string) {
  const created = await call(owner(), "POST", "/api/purchase/suppliers", { name: `T-${randomUUID().slice(0, 6)}`, code: `S-${randomUUID().slice(0, 6)}` });
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json().supplier.id as string;
  if (totalDebt !== "0") {
    expect((await call(owner(), "POST", `/api/purchase/suppliers/${id}/set-debt`, { totalDebt, reason: "Boshlang'ich" })).statusCode).toBe(200);
  }
  return id;
}

// ─── §25. Negative testlar: ataylab ifloslantirishga urinish ─────────────────

describe("§25 Modullararo ifloslanishga urinishlar", () => {
  it("kassa chekiga QO'LDA yetkazma yaratib bo'lmaydi", async () => {
    const { cookie, shiftId } = await openShift();
    const sale = await call(cookie, "POST", "/api/sales/pos/sales", {
      shiftId,
      customerId: company.customerId,
      items: [{ productId: company.productId, quantity: "2" }],
      paymentMethod: "cash",
      amountPaid: "10000",
    });
    expect(sale.statusCode, sale.body).toBe(201);
    const orderId = sale.json().order.id as string;

    const before = await snapshot();
    const attempt = await call(owner(), "POST", "/api/delivery/tasks", { orderId });
    expect(attempt.statusCode, attempt.body).toBe(400);
    expect(attempt.json().message).toContain("Kassa chekiga");

    const after = await snapshot();
    expectUnchanged(before, after, ["sales", "tasks", "stock", "cash", "debt", "journal"]);
  });

  it("ta'minotchiga to'lov sotuv, mijoz qarzi va yetkazmaga tegmaydi", async () => {
    const { cookie, shiftId } = await openShift();
    await call(cookie, "POST", "/api/sales/pos/sales", {
      shiftId,
      customerId: company.customerId,
      items: [{ productId: company.productId, quantity: "2" }],
      paymentMethod: "cash",
      amountPaid: "0",
      onCredit: true,
    });
    const supplierId = await supplierWithDebt("50000");
    await fund(mainCash, "50000");

    const before = await snapshot();
    const paid = await call(owner(), "POST", "/api/purchase/payments", { supplierId, amount: "50000", method: "cash" });
    expect(paid.statusCode, paid.body).toBe(201);

    const after = await snapshot();
    // Sotuv, yetkazma, ishlab chiqarish, zaxira va MIJOZ qarzi o'zgarmadi
    expectUnchanged(before, after, ["sales", "tasks", "production", "stock", "debt"]);
    expect(after.supplierDebt).not.toEqual(before.supplierDebt);
    expectBalanced(after);
  });

  it("xarajat to'lovi mijoz qarzi, sotuv va zaxiraga tegmaydi", async () => {
    await fund(mainCash, "100000");
    const created = await call(owner(), "POST", "/api/finance/expenses", {
      category: "boshqa",
      description: "Ijara",
      amount: "100000",
      expenseDate: today(),
    });
    expect(created.statusCode, created.body).toBe(201);
    const expenseId = created.json().expense.id as string;
    expect((await call(owner(), "POST", `/api/finance/expenses/${expenseId}/status`, { status: "approved" })).statusCode).toBe(200);

    const before = await snapshot();
    const paid = await call(owner(), "POST", `/api/finance/expenses/${expenseId}/status`, { status: "paid", cashAccountId: mainCash });
    expect(paid.statusCode, paid.body).toBe(200);

    const after = await snapshot();
    expectUnchanged(before, after, ["sales", "tasks", "purchases", "production", "stock", "debt", "supplierDebt"]);
    expectBalanced(after);
  });

  it("ombor ichidagi o'tkazma mijoz qarzi, sotuv va yetkazma yaratmaydi", async () => {
    const second = await call(owner(), "POST", "/api/inventory/warehouses", { name: "Ikkinchi ombor", code: "W2" });
    expect(second.statusCode, second.body).toBe(201);

    const before = await snapshot();
    const moved = await call(owner(), "POST", "/api/inventory/stock/transfers", {
      productId: company.productId,
      fromWarehouseId: company.warehouseId,
      toWarehouseId: second.json().warehouse.id,
      quantity: "10",
    });
    expect([200, 201]).toContain(moved.statusCode);

    const after = await snapshot();
    // Zaxira joyi o'zgardi, lekin sotuv/qarz/yetkazma/xarid — yo'q
    expectUnchanged(before, after, ["sales", "tasks", "purchases", "production", "debt", "supplierDebt"]);
    expectBalanced(after);
  });

  it("ishlab chiqarish sotuv, yetkazma va mijoz qarzi yaratmaydi", async () => {
    const bread = await product("Non", "NON", "3000");
    const flour = await product("Un", "UN", "0");
    const bom = await call(owner(), "POST", "/api/manufacturing/boms", { productId: bread, name: "Retsept", quantity: "10" });
    expect(bom.statusCode, bom.body).toBe(201);
    const bomId = bom.json().bom.id as string;
    expect((await call(owner(), "POST", `/api/manufacturing/boms/${bomId}/items`, { productId: flour, quantity: "5" })).statusCode).toBe(201);
    await receive(flour, "100", "2000");

    const before = await snapshot();
    const created = await call(owner(), "POST", "/api/manufacturing/orders", {
      bomId,
      warehouseId: company.warehouseId,
      plannedQty: "20",
      plannedDate: today(),
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().order.id as string;
    expect((await call(owner(), "POST", `/api/manufacturing/orders/${id}/confirm`)).statusCode).toBe(200);
    expect((await call(owner(), "POST", `/api/manufacturing/orders/${id}/start`)).statusCode).toBe(200);
    expect((await call(owner(), "POST", `/api/manufacturing/orders/${id}/complete`, { producedQty: "20" })).statusCode).toBe(200);

    const after = await snapshot();
    expectUnchanged(before, after, ["sales", "tasks", "purchases", "debt", "supplierDebt", "cash"]);
    expect(after.production.length).toBe(before.production.length + 1);
    expectBalanced(after);
  });

  it("yetkazmani tasdiqlash xarid va ishlab chiqarishga tegmaydi, sotuv holatini o'zgartirmaydi", async () => {
    await setPolicy(app, owner(), NO_PROOFS);
    const agent = await deliveryAgent(app, company);
    await startShift(app, agent.cookie);
    const { taskId, orderId } = await arrivedTask(app, company, agent, "10");
    const beforeOrder = (await call(owner(), "GET", `/api/sales/orders/${orderId}`)).json().order;
    expect(beforeOrder.status).toBe("completed");

    const before = await snapshot();
    expect((await agentAction(app, agent.cookie, taskId, "payments", { method: "cash", amount: "50000" })).statusCode).toBe(201);
    expect((await agentAction(app, agent.cookie, taskId, "confirm", near(30))).statusCode).toBe(200);

    const after = await snapshot();
    expectUnchanged(before, after, ["purchases", "production", "stock"]);
    // Sotuv holati o'zgarmadi (faqat to'langan summa oshdi), yetkazma holati o'zgardi
    expect(after.sales.map((row) => row.status)).toEqual(before.sales.map((row) => row.status));
    expect(after.tasks.find((row) => row.id === taskId)!.status).toBe("delivered");
    expectBalanced(after);
  });

  it("qaytarish ishlab chiqarish va xaridga tegmaydi", async () => {
    const { cookie, shiftId } = await openShift();
    const sale = await call(cookie, "POST", "/api/sales/pos/sales", {
      shiftId,
      items: [{ productId: company.productId, quantity: "4" }],
      paymentMethod: "cash",
      amountPaid: "20000",
    });
    expect(sale.statusCode, sale.body).toBe(201);
    const orderId = sale.json().order.id as string;

    const before = await snapshot();
    expect((await call(owner(), "POST", `/api/sales/orders/${orderId}/return`, { refund: true })).statusCode).toBe(200);

    const after = await snapshot();
    expectUnchanged(before, after, ["tasks", "purchases", "production", "supplierDebt"]);
    expect(after.sales.find((row) => row.id === orderId)!.status).toBe("returned");
    expectBalanced(after);
  });

  it("xarid qabul qilish sotuv va mijoz qarzi yaratmaydi", async () => {
    const supplierId = await supplierWithDebt("0");
    const created = await call(owner(), "POST", "/api/purchase/orders", {
      supplierId,
      warehouseId: company.warehouseId,
      orderDate: today(),
      items: [{ productId: company.productId, unitId: piece, orderedQty: "10", unitPrice: "3000" }],
    });
    expect(created.statusCode, created.body).toBe(201);
    const orderId = created.json().order.id as string;
    const orderItemId = created.json().order.items[0].id as string;
    expect((await call(owner(), "POST", `/api/purchase/orders/${orderId}/confirm`)).statusCode).toBe(200);

    const before = await snapshot();
    const receipt = await call(owner(), "POST", `/api/purchase/orders/${orderId}/receipts`, {
      items: [{ orderItemId, receivedQty: "10" }],
      receiptDate: today(),
    });
    expect([200, 201]).toContain(receipt.statusCode);

    const after = await snapshot();
    // Zaxira oshdi, ta'minotchi qarzi oshdi; sotuv, yetkazma va MIJOZ qarzi tegilmadi
    expectUnchanged(before, after, ["sales", "tasks", "production", "debt"]);
    expectBalanced(after);
  });
});

// ─── §29. Bir vaqtda ishlash (concurrency) ──────────────────────────────────

describe("§29 Parallel so'rovlar", () => {
  it("bir xil kalitli ikkita kassa cheki parallel yuborilsa — bitta chek yoziladi", async () => {
    const { cookie, shiftId } = await openShift();
    const clientRequestId = randomUUID();
    const body = {
      shiftId,
      items: [{ productId: company.productId, quantity: "2" }],
      paymentMethod: "cash",
      amountPaid: "10000",
      clientRequestId,
    };

    const results = await Promise.all([
      call(cookie, "POST", "/api/sales/pos/sales", body),
      call(cookie, "POST", "/api/sales/pos/sales", body),
    ]);
    const created = results.filter((res) => res.statusCode === 201);
    expect(created).toHaveLength(1);

    const snap = await snapshot();
    expect(snap.sales).toHaveLength(1);
    expect(snap.cash.find((row) => row.id === mainCash)!.balance).toBe("10000.00");
    expectBalanced(snap);
  });

  it("bir xil havolali ikkita ta'minotchi to'lovi parallel — pul bir marta chiqadi", async () => {
    const supplierId = await supplierWithDebt("100000");
    await fund(mainCash, "100000");
    const reference = `SP-${randomUUID()}`;
    const body = { supplierId, amount: "100000", method: "cash", reference };

    const results = await Promise.all([
      call(owner(), "POST", "/api/purchase/payments", body),
      call(owner(), "POST", "/api/purchase/payments", body),
    ]);
    expect(results.filter((res) => res.statusCode === 201)).toHaveLength(1);

    const snap = await snapshot();
    expect(snap.cash.find((row) => row.id === mainCash)!.balance).toBe("0.00");
    expectBalanced(snap);
  });

  it("qoldiqdan ortiq ikkita parallel sotuv — bittasi rad etiladi, zaxira manfiy bo'lmaydi", async () => {
    const scarce = await product("Kam mahsulot", "KAM", "1000");
    await receive(scarce, "10", "500");
    const first = await openShift();

    const sell = (cookie: string, shiftId: string) =>
      call(cookie, "POST", "/api/sales/pos/sales", {
        shiftId,
        items: [{ productId: scarce, quantity: "8" }],
        paymentMethod: "cash",
        amountPaid: "8000",
      });

    const results = await Promise.all([sell(first.cookie, first.shiftId), sell(first.cookie, first.shiftId)]);
    const ok = results.filter((res) => res.statusCode === 201);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(ok.length).toBeLessThanOrEqual(1);

    const snap = await snapshot();
    const left = snap.stock.find((row) => row.productId === scarce)!;
    expect(Number(left.qty)).toBeGreaterThanOrEqual(0);
    expect(left.qty).toBe("2.0000");
    expectBalanced(snap);
  });

  it("yetkazmani ikki marta parallel tasdiqlash — bir marta bajariladi", async () => {
    await setPolicy(app, owner(), NO_PROOFS);
    const agent = await deliveryAgent(app, company);
    await startShift(app, agent.cookie);
    const { taskId } = await arrivedTask(app, company, agent, "10");
    expect((await agentAction(app, agent.cookie, taskId, "payments", { method: "cash", amount: "50000" })).statusCode).toBe(201);

    const clientRequestId = randomUUID();
    const results = await Promise.all([
      agentAction(app, agent.cookie, taskId, "confirm", { clientRequestId, ...near(30) }),
      agentAction(app, agent.cookie, taskId, "confirm", { clientRequestId, ...near(30) }),
    ]);
    expect(results.every((res) => res.statusCode === 200)).toBe(true);

    const snap = await snapshot();
    expect(snap.tasks.filter((row) => row.status === "delivered")).toHaveLength(1);
    expectBalanced(snap);
  });
});

// ─── §24. Ketma-ket ko'p biznesli oqim ──────────────────────────────────────

describe("§24 Bitta kompaniyada ketma-ket to'rt biznes", () => {
  it("ishlab chiqarish → chakana → distribyutsiya → yetkazish → ulgurji → qarz → xarid → xarajat → o'tkazma → qaytarish", async () => {
    await setPolicy(app, owner(), NO_PROOFS);
    const bread = await product("Non", "NON2", "3000");
    const flour = await product("Un", "UN2", "0");
    const bomId = (await call(owner(), "POST", "/api/manufacturing/boms", { productId: bread, name: "R", quantity: "10" })).json().bom.id as string;
    expect((await call(owner(), "POST", `/api/manufacturing/boms/${bomId}/items`, { productId: flour, quantity: "5" })).statusCode).toBe(201);
    await receive(flour, "200", "2000");
    await fund(mainCash, "500000");

    // 1. Ishlab chiqarish — sotuv/yetkazma/qarz yaratmaydi
    let before = await snapshot();
    const mo = (await call(owner(), "POST", "/api/manufacturing/orders", { bomId, warehouseId: company.warehouseId, plannedQty: "100", plannedDate: today() })).json().order.id as string;
    expect((await call(owner(), "POST", `/api/manufacturing/orders/${mo}/confirm`)).statusCode).toBe(200);
    expect((await call(owner(), "POST", `/api/manufacturing/orders/${mo}/start`)).statusCode).toBe(200);
    expect((await call(owner(), "POST", `/api/manufacturing/orders/${mo}/complete`, { producedQty: "100" })).statusCode).toBe(200);
    let after = await snapshot();
    expectUnchanged(before, after, ["sales", "tasks", "purchases", "debt", "supplierDebt"]);

    // 2. Chakana: ishlab chiqarilgan nonni kassadan sotish — yetkazma yo'q
    before = after;
    const { cookie, shiftId } = await openShift();
    const posSale = await call(cookie, "POST", "/api/sales/pos/sales", {
      shiftId,
      items: [{ productId: bread, quantity: "10" }],
      paymentMethod: "cash",
      amountPaid: "30000",
    });
    expect(posSale.statusCode, posSale.body).toBe(201);
    after = await snapshot();
    expectUnchanged(before, after, ["tasks", "purchases", "production", "debt", "supplierDebt"]);
    expect(after.sales).toHaveLength(1);
    expect(after.sales[0]).toMatchObject({ status: "completed", src: "pos", fm: "counter" });

    // 3. Distribyutsiya buyurtmasi — yetkazma ochiladi, sotuv hali yakunlanmagan
    before = after;
    const deliveryOrderId = await confirmedOrder(app, company, "10");
    after = await snapshot();
    expectUnchanged(before, after, ["purchases", "production", "stock", "cash", "supplierDebt"]);
    expect(after.tasks).toHaveLength(1);

    // 4. Yetkazish — yetkazma DELIVERED, sotuv completed, mijoz qarzi (nasiya)
    before = after;
    const agent = await deliveryAgent(app, company);
    await startShift(app, agent.cookie);
    const { id: taskId } = await taskForOrder(app, owner(), deliveryOrderId);
    expect((await call(owner(), "PATCH", `/api/delivery/tasks/${taskId}`, { paymentType: "credit" })).statusCode).toBe(200);
    await assign(app, owner(), taskId, agent.id);
    for (const action of ["accept", "start"]) expect((await agentAction(app, agent.cookie, taskId, action)).statusCode).toBe(200);
    expect((await agentAction(app, agent.cookie, taskId, "arrive", near(30))).statusCode).toBe(200);
    expect((await agentAction(app, agent.cookie, taskId, "confirm", near(30))).statusCode).toBe(200);
    after = await snapshot();
    expectUnchanged(before, after, ["purchases", "production"]);
    expect(after.tasks[0]!.status).toBe("delivered");
    const delivered = (await call(owner(), "GET", `/api/sales/orders/${deliveryOrderId}`)).json().order;
    expect(delivered).toMatchObject({ status: "completed", paymentStatus: "unpaid", deliveryStatus: "delivered" });

    // 5. Ulgurji: katta buyurtma, olib ketish, qisman to'lov
    before = after;
    const wholesale = (await call(owner(), "POST", "/api/sales/orders", {
      customerId: company.customerId,
      warehouseId: company.warehouseId,
      orderDate: today(),
      deliveryRequired: false,
      items: [{ productId: bread, quantity: "50" }],
    })).json().order.id as string;
    expect((await call(owner(), "POST", `/api/sales/orders/${wholesale}/confirm`)).statusCode).toBe(200);
    expect((await call(owner(), "POST", `/api/sales/orders/${wholesale}/ship`)).statusCode).toBe(200);
    expect((await call(owner(), "POST", "/api/sales/payments", { orderId: wholesale, amount: "60000", method: "cash" })).statusCode).toBe(201);
    after = await snapshot();
    expectUnchanged(before, after, ["purchases", "production", "supplierDebt"]);
    // Ulgurji buyurtma yetkazma yaratmadi (hali ham bitta yetkazma)
    expect(after.tasks).toHaveLength(1);
    expect((await call(owner(), "GET", `/api/sales/orders/${wholesale}`)).json().order).toMatchObject({
      status: "completed",
      paymentStatus: "partial",
      fulfillmentMethod: "pickup",
      deliveryStatus: null,
    });

    // 6. Qarzni to'lash — sotuv va yetkazma holatlari o'zgarmaydi
    before = after;
    const beforeStatuses = before.sales.map((row) => `${row.id}:${row.status}`);
    expect((await call(owner(), "POST", "/api/sales/payments", { orderId: deliveryOrderId, amount: "50000", method: "cash" })).statusCode).toBe(201);
    after = await snapshot();
    expectUnchanged(before, after, ["tasks", "purchases", "production", "stock", "supplierDebt"]);
    expect(after.sales.map((row) => `${row.id}:${row.status}`)).toEqual(beforeStatuses);

    // 7. Xarid: xomashyo kelishi — sotuv va mijoz qarziga tegmaydi
    before = after;
    const supplierId = await supplierWithDebt("0");
    const po = (await call(owner(), "POST", "/api/purchase/orders", {
      supplierId,
      warehouseId: company.warehouseId,
      orderDate: today(),
      items: [{ productId: flour, unitId: piece, orderedQty: "50", unitPrice: "2000" }],
    })).json().order.id as string;
    expect((await call(owner(), "POST", `/api/purchase/orders/${po}/confirm`)).statusCode).toBe(200);
    after = await snapshot();
    expectUnchanged(before, after, ["sales", "tasks", "production", "stock", "debt"]);

    // 8. Xarajat — faqat kassa va buxgalteriya
    before = after;
    const expenseId = (await call(owner(), "POST", "/api/finance/expenses", {
      category: "boshqa",
      description: "Ijara",
      amount: "50000",
      expenseDate: today(),
    })).json().expense.id as string;
    expect((await call(owner(), "POST", `/api/finance/expenses/${expenseId}/status`, { status: "approved" })).statusCode).toBe(200);
    expect((await call(owner(), "POST", `/api/finance/expenses/${expenseId}/status`, { status: "paid", cashAccountId: mainCash })).statusCode).toBe(200);
    after = await snapshot();
    expectUnchanged(before, after, ["sales", "tasks", "purchases", "production", "stock", "debt", "supplierDebt"]);

    // 9. Ombor o'tkazmasi — hech qanday savdo ta'siri yo'q
    before = after;
    const w2 = (await call(owner(), "POST", "/api/inventory/warehouses", { name: "Ombor 2", code: "WH2" })).json().warehouse.id as string;
    const moved = await call(owner(), "POST", "/api/inventory/stock/transfers", {
      productId: bread,
      fromWarehouseId: company.warehouseId,
      toWarehouseId: w2,
      quantity: "5",
    });
    expect([200, 201]).toContain(moved.statusCode);
    after = await snapshot();
    expectUnchanged(before, after, ["sales", "tasks", "purchases", "production", "debt", "supplierDebt"]);

    // 10. Chakana chekni qaytarish — faqat o'sha sotuv
    before = after;
    expect((await call(owner(), "POST", `/api/sales/orders/${posSale.json().order.id}/return`, { refund: true })).statusCode).toBe(200);
    after = await snapshot();
    expectUnchanged(before, after, ["tasks", "purchases", "production", "supplierDebt"]);
    expect(after.sales.find((row) => row.id === (posSale.json().order.id as string))!.status).toBe("returned");

    // Yakuniy invariant
    expectBalanced(after);
    expect(after.stock.every((row) => Number(row.qty) >= 0)).toBe(true);
  });
});
