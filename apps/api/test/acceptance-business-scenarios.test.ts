/**
 * QABUL TESTI — biznes ssenariylari: bitta kompaniya bir vaqtda chakana (kassa), distribyutsiya,
 * ulgurji, ishlab chiqarish, xarid va xarajat bilan ishlaganda har oqim o'z mantig'ini saqlaydimi.
 *
 * Tekshiriladigan asosiy arxitektura qoidalari:
 *   SOTUV ≠ YETKAZISH   — sotuv holati `completed`, yetkazish holati `delivery_tasks.status` da
 *   TO'LOV ≠ YETKAZISH  — to'lov sotuv holatini o'zgartirmaydi, to'lov holati summalardan hisoblanadi
 *   KASSA ≠ DISTRIBYUTSIYA — kassa chekiga hech qachon yetkazma yaratilmaydi
 *   ISHLAB CHIQARISH ≠ SOTUV — ishlab chiqarish buyurtmasi sotuv hujjatini yaratmaydi
 *   XARID ≠ TO'LOV      — xarid tasdiqlanishi to'lov emas
 */
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { deliveryTasks } from "../src/db/schema/delivery.js";
import { stockLevels } from "../src/db/schema/inventory.js";
import { customers, salesOrders } from "../src/db/schema/sales.js";
import { buildServer } from "../src/server.js";
import {
  NO_PROOFS,
  agentAction,
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
let company: DeliveryCompany;
let call: ReturnType<typeof caller>;
let piece: string;
let kassirCookie: string;
let shiftId: string;

const owner = () => company.ownerCookie;
const today = () => localToday();

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
  company = await deliveryCompany(app, admin.cookie, "Aralash biznes");
  piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const kassir = await addEmployee(app, company, "Kassir");
  kassirCookie = kassir.cookie;
  const opened = await call(kassirCookie, "POST", "/api/sales/pos/shifts", { warehouseId: company.warehouseId, openingCash: "0" });
  expect(opened.statusCode, opened.body).toBe(201);
  shiftId = opened.json().shift.id as string;
});

/** Kassa cheki. */
const sell = (payload: object) => call(kassirCookie, "POST", "/api/sales/pos/sales", { shiftId, ...payload });
/** Buyurtma tafsiloti (holat, to'lov holati, kanal, yetkazish usuli). */
const orderOf = async (orderId: string) => (await call(owner(), "GET", `/api/sales/orders/${orderId}`)).json().order;
/** Shu buyurtmaga yaratilgan yetkazmalar. */
const tasksOf = (orderId: string) => db.select().from(deliveryTasks).where(eq(deliveryTasks.orderId, orderId));
const debtOf = async (customerId: string) =>
  (await db.select({ totalDebt: customers.totalDebt }).from(customers).where(eq(customers.id, customerId)))[0]!.totalDebt;
const stockOf = async (productId: string) =>
  (
    await db
      .select({ quantity: stockLevels.quantity })
      .from(stockLevels)
      .where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, company.warehouseId)))
  )[0]?.quantity ?? null;

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

/** ERP'da qo'lda buyurtma (kassa emas): `deliveryRequired` bilan yetkazma yaratiladi yoki yaratilmaydi. */
async function erpOrder(quantity: string, deliveryRequired: boolean | null, productId = company.productId) {
  const created = await call(owner(), "POST", "/api/sales/orders", {
    customerId: company.customerId,
    warehouseId: company.warehouseId,
    orderDate: today(),
    deliveryRequired,
    items: [{ productId, quantity }],
  });
  expect(created.statusCode, created.body).toBe(201);
  const orderId = created.json().order.id as string;
  expect((await call(owner(), "POST", `/api/sales/orders/${orderId}/confirm`)).statusCode).toBe(200);
  return orderId;
}

/** Non retsepti: 10 dona non uchun 5 un + 1 shakar. */
async function breadRecipe() {
  const bread = await product("Non", "NON", "3000");
  const flour = await product("Un", "UN", "0");
  const sugar = await product("Shakar", "SHAKAR", "0");
  const bom = await call(owner(), "POST", "/api/manufacturing/boms", { productId: bread, name: "Non retsepti", quantity: "10" });
  expect(bom.statusCode, bom.body).toBe(201);
  const bomId = bom.json().bom.id as string;
  expect((await call(owner(), "POST", `/api/manufacturing/boms/${bomId}/items`, { productId: flour, quantity: "5" })).statusCode).toBe(201);
  expect((await call(owner(), "POST", `/api/manufacturing/boms/${bomId}/items`, { productId: sugar, quantity: "1" })).statusCode).toBe(201);
  await receive(flour, "100", "2000");
  await receive(sugar, "50", "5000");
  return { bread, flour, sugar, bomId };
}

/** Retsept bo'yicha ishlab chiqarish: tayyor mahsulot omborga kiradi. */
async function produce(bomId: string, plannedQty: string) {
  const created = await call(owner(), "POST", "/api/manufacturing/orders", {
    bomId,
    warehouseId: company.warehouseId,
    plannedQty,
    plannedDate: today(),
  });
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json().order.id as string;
  expect((await call(owner(), "POST", `/api/manufacturing/orders/${id}/confirm`)).statusCode).toBe(200);
  expect((await call(owner(), "POST", `/api/manufacturing/orders/${id}/start`)).statusCode).toBe(200);
  const done = await call(owner(), "POST", `/api/manufacturing/orders/${id}/complete`, { producedQty: plannedQty });
  expect(done.statusCode, done.body).toBe(200);
  return id;
}

// ─── Chakana savdo (kassa) ───────────────────────────────────────────────────

describe("1. Chakana: kassadan sotuv", () => {
  it("naqd chek — sotuv YAKUNLANGAN, kanal kassa, qo'lma-qo'l; YETKAZMA YARATILMAYDI", async () => {
    const sale = await sell({ items: [{ productId: company.productId, quantity: "2" }], paymentMethod: "cash", amountPaid: "10000" });
    expect(sale.statusCode, sale.body).toBe(201);

    const order = sale.json().order;
    expect(order).toMatchObject({
      status: "completed",
      paymentStatus: "paid",
      source: "pos",
      fulfillmentMethod: "counter",
      isPos: true,
      totalAmount: "10000.00",
      paidAmount: "10000.00",
    });
    // Asosiy nuqta: kassadagi sotuv hech qachon "yetkazildi" bo'lmaydi va yetkazma hujjati ochilmaydi
    expect(order.status).not.toBe("delivered");
    expect(await tasksOf(order.id)).toHaveLength(0);
    // Ro'yxatdagi "Yetkazma" ustuni bo'sh bo'lishi kerak — chek yetkazilmaydi
    expect(order.deliveryStatus).toBeNull();
    expect(order.deliveryRequired).toBeNull();
    expect(await stockOf(company.productId)).toBe("98.0000");
  });

  it("aralash to'lov (naqd + karta) — bitta chek, yakunlangan va to'langan", async () => {
    const sale = await sell({
      items: [{ productId: company.productId, quantity: "2" }],
      payments: [
        { method: "cash", amount: "6000" },
        { method: "card", amount: "4000" },
      ],
    });
    expect(sale.statusCode, sale.body).toBe(201);
    expect(sale.json().order).toMatchObject({ status: "completed", paymentStatus: "paid", source: "pos", fulfillmentMethod: "counter" });
    expect(await tasksOf(sale.json().order.id)).toHaveLength(0);
  });

  it("uch usulli to'lov (naqd + karta + bank) — yakunlangan va to'langan", async () => {
    const sale = await sell({
      items: [{ productId: company.productId, quantity: "2" }],
      payments: [
        { method: "cash", amount: "4000" },
        { method: "card", amount: "3000" },
        { method: "bank", amount: "3000" },
      ],
    });
    expect(sale.statusCode, sale.body).toBe(201);
    expect(sale.json().order).toMatchObject({ status: "completed", paymentStatus: "paid" });
  });
});

describe("2. Chakana: nasiya va keyingi to'lov", () => {
  it("nasiya chek — YAKUNLANGAN lekin TO'LANMAGAN; qarz mijozda", async () => {
    const sale = await sell({
      customerId: company.customerId,
      items: [{ productId: company.productId, quantity: "2" }],
      paymentMethod: "cash",
      amountPaid: "0",
      onCredit: true,
    });
    expect(sale.statusCode, sale.body).toBe(201);
    expect(sale.json().order).toMatchObject({ status: "completed", paymentStatus: "unpaid", paidAmount: "0.00" });
    expect(await debtOf(company.customerId)).toBe("10000.00");
  });

  it("qarz to'langanda SOTUV HOLATI O'ZGARMAYDI — faqat to'lov holati to'langanga o'tadi", async () => {
    const sale = await sell({
      customerId: company.customerId,
      items: [{ productId: company.productId, quantity: "2" }],
      paymentMethod: "cash",
      amountPaid: "0",
      onCredit: true,
    });
    const orderId = sale.json().order.id as string;

    const paid = await call(owner(), "POST", "/api/sales/payments", { orderId, amount: "10000", method: "cash" });
    expect(paid.statusCode, paid.body).toBe(201);

    const after = await orderOf(orderId);
    // Eski xatti-harakat: to'liq to'lov holatni "delivered" qilardi. Endi — yo'q.
    expect(after).toMatchObject({ status: "completed", paymentStatus: "paid", paidAmount: "10000.00" });
    expect(after.status).not.toBe("delivered");
    expect(await debtOf(company.customerId)).toBe("0.00");
    expect(await tasksOf(orderId)).toHaveLength(0);
  });
});

// ─── Distribyutsiya va yetkazish ─────────────────────────────────────────────

describe("3. Distribyutsiya: yetkazib berish bilan", () => {
  it("tasdiqlangan buyurtmaga yetkazma ochiladi; sotuv hali YAKUNLANMAGAN", async () => {
    const orderId = await confirmedOrder(app, company, "10");
    const order = await orderOf(orderId);
    expect(order).toMatchObject({
      status: "confirmed",
      paymentStatus: "unpaid",
      source: "manual",
      fulfillmentMethod: "delivery",
      isPos: false,
      deliveryRequired: true,
    });

    const tasks = await tasksOf(orderId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ status: "ready", expectedAmount: "50000.00" });
    // Yetkazma holati buyurtma javobida alohida maydon sifatida ko'rinadi
    expect((await orderOf(orderId)).deliveryStatus).toBe("ready");
  });

  it("yo'lga chiqish sotuvni yakunlaydi; yetkazma tasdiqlangach SOTUV HOLATI O'ZGARMAYDI", async () => {
    await setPolicy(app, owner(), NO_PROOFS);
    const agent = await deliveryAgent(app, company);
    await startShift(app, agent.cookie);
    const orderId = await confirmedOrder(app, company, "10");
    const { id: taskId } = await taskForOrder(app, owner(), orderId);
    await assign(app, owner(), taskId, agent.id);

    expect((await agentAction(app, agent.cookie, taskId, "accept")).statusCode).toBe(200);
    expect((await agentAction(app, agent.cookie, taskId, "start")).statusCode).toBe(200);
    // Tovar omborda chiqdi — sotuv yakunlandi, lekin hali mijozga yetmagan
    expect(await orderOf(orderId)).toMatchObject({ status: "completed", paymentStatus: "unpaid" });
    expect((await tasksOf(orderId))[0]!.status).toBe("out_for_delivery");

    expect((await agentAction(app, agent.cookie, taskId, "arrive", near(30))).statusCode).toBe(200);
    expect((await agentAction(app, agent.cookie, taskId, "payments", { method: "cash", amount: "50000" })).statusCode).toBe(201);
    const done = await agentAction(app, agent.cookie, taskId, "confirm", near(30));
    expect(done.statusCode, done.body).toBe(200);

    // Yetkazish holati — yetkazma hujjatida; sotuv holati o'zgarmadi
    expect((await tasksOf(orderId))[0]!.status).toBe("delivered");
    expect(await orderOf(orderId)).toMatchObject({ status: "completed", paymentStatus: "paid", deliveryStatus: "delivered" });
  });

  it("NASIYAGA yetkazilgan buyurtma: yetkazma YETKAZILDI, sotuv yakunlangan, to'lov TO'LANMAGAN", async () => {
    await setPolicy(app, owner(), NO_PROOFS);
    const agent = await deliveryAgent(app, company);
    await startShift(app, agent.cookie);
    const orderId = await confirmedOrder(app, company, "10");
    const { id: taskId } = await taskForOrder(app, owner(), orderId);
    // Nasiya yetkazma — yig'iladigan pul yo'q
    expect((await call(owner(), "PATCH", `/api/delivery/tasks/${taskId}`, { paymentType: "credit" })).statusCode).toBe(200);
    await assign(app, owner(), taskId, agent.id);
    for (const action of ["accept", "start"]) {
      expect((await agentAction(app, agent.cookie, taskId, action)).statusCode).toBe(200);
    }
    expect((await agentAction(app, agent.cookie, taskId, "arrive", near(30))).statusCode).toBe(200);
    expect((await agentAction(app, agent.cookie, taskId, "confirm", near(30))).statusCode).toBe(200);

    // Eski xatti-harakatda bu buyurtma hech qachon "yetkazilgan" ko'rinmasdi (chunki to'lanmagan).
    // Endi yetkazish va to'lov alohida: yetkazma yetkazildi, pul esa qarz.
    expect((await tasksOf(orderId))[0]!.status).toBe("delivered");
    expect(await orderOf(orderId)).toMatchObject({ status: "completed", paymentStatus: "unpaid", deliveryStatus: "delivered" });
    expect(await debtOf(company.customerId)).toBe("50000.00");
  });

  it("mijoz o'zi olib ketadi (yetkazish shart emas) — YETKAZMA YARATILMAYDI", async () => {
    const orderId = await erpOrder("4", false);
    expect(await tasksOf(orderId)).toHaveLength(0);
    expect(await orderOf(orderId)).toMatchObject({ status: "confirmed", deliveryRequired: false, fulfillmentMethod: "pickup", deliveryStatus: null });

    const shipped = await call(owner(), "POST", `/api/sales/orders/${orderId}/ship`);
    expect(shipped.statusCode, shipped.body).toBe(200);
    expect(await orderOf(orderId)).toMatchObject({ status: "completed", paymentStatus: "unpaid" });
    expect(await tasksOf(orderId)).toHaveLength(0);
  });
});

// ─── Ulgurji ─────────────────────────────────────────────────────────────────

describe("4. Ulgurji: katta hajm, qisman to'lov", () => {
  it("jo'natilgan ulgurji buyurtma yakunlangan; qisman to'lov — QISMAN holati", async () => {
    const orderId = await erpOrder("50", false);
    expect((await call(owner(), "POST", `/api/sales/orders/${orderId}/ship`)).statusCode).toBe(200);
    expect(await orderOf(orderId)).toMatchObject({ status: "completed", paymentStatus: "unpaid", totalAmount: "250000.00" });

    expect((await call(owner(), "POST", "/api/sales/payments", { orderId, amount: "100000", method: "bank" })).statusCode).toBe(201);
    expect(await orderOf(orderId)).toMatchObject({ status: "completed", paymentStatus: "partial", paidAmount: "100000.00" });

    expect((await call(owner(), "POST", "/api/sales/payments", { orderId, amount: "150000", method: "bank" })).statusCode).toBe(201);
    expect(await orderOf(orderId)).toMatchObject({ status: "completed", paymentStatus: "paid" });
  });
});

// ─── Qaytarish ───────────────────────────────────────────────────────────────

describe("5. Qaytarish", () => {
  it("to'liq qaytarish — QAYTARILGAN; qisman qaytarishda sotuv yakunlangan bo'lib qoladi", async () => {
    const full = await sell({ items: [{ productId: company.productId, quantity: "2" }], paymentMethod: "cash", amountPaid: "10000" });
    const fullId = full.json().order.id as string;
    expect((await call(owner(), "POST", `/api/sales/orders/${fullId}/return`, { refund: true })).statusCode).toBe(200);
    expect(await orderOf(fullId)).toMatchObject({ status: "returned" });

    const partial = await sell({ items: [{ productId: company.productId, quantity: "4" }], paymentMethod: "cash", amountPaid: "20000" });
    const partialId = partial.json().order.id as string;
    const line = partial.json().order.items[0].id as string;
    const back = await call(owner(), "POST", `/api/sales/orders/${partialId}/return-items`, {
      items: [{ orderItemId: line, quantity: "1" }],
      refundMethod: "cash",
    });
    expect(back.statusCode, back.body).toBe(201);
    expect(await orderOf(partialId)).toMatchObject({ status: "completed" });
  });
});

// ─── Ishlab chiqarish ────────────────────────────────────────────────────────

describe("6. Ishlab chiqarish", () => {
  it("ishlab chiqarish SOTUV HUJJATI YARATMAYDI — faqat zaxira va tannarx", async () => {
    const { bread, bomId } = await breadRecipe();
    const before = (await db.select().from(salesOrders).where(eq(salesOrders.companyId, company.companyId))).length;

    await produce(bomId, "20");

    expect(await stockOf(bread)).toBe("20.0000");
    const after = await db.select().from(salesOrders).where(eq(salesOrders.companyId, company.companyId));
    expect(after).toHaveLength(before);
    expect(await db.select().from(deliveryTasks).where(eq(deliveryTasks.companyId, company.companyId))).toHaveLength(0);
  });

  it("ishlab chiqarish + chakana: ishlab chiqarilgan mahsulot kassadan sotiladi (qo'lma-qo'l)", async () => {
    const { bread, bomId } = await breadRecipe();
    await produce(bomId, "20");

    const sale = await sell({ items: [{ productId: bread, quantity: "5" }], paymentMethod: "cash", amountPaid: "15000" });
    expect(sale.statusCode, sale.body).toBe(201);
    expect(sale.json().order).toMatchObject({ status: "completed", paymentStatus: "paid", source: "pos", fulfillmentMethod: "counter" });
    expect(await tasksOf(sale.json().order.id)).toHaveLength(0);
    expect(await stockOf(bread)).toBe("15.0000");
  });

  it("ishlab chiqarish + distribyutsiya: ishlab chiqarilgan mahsulotga yetkazma ochiladi", async () => {
    const { bread, bomId } = await breadRecipe();
    await produce(bomId, "20");

    const orderId = await erpOrder("10", true, bread);
    expect(await tasksOf(orderId)).toHaveLength(1);
    expect(await orderOf(orderId)).toMatchObject({ status: "confirmed", source: "manual", fulfillmentMethod: "delivery", deliveryRequired: true });
  });
});

// ─── Xarid va xarajat ────────────────────────────────────────────────────────

describe("7. Xarid va xarajat", () => {
  it("xarid tasdiqlanishi TO'LOV EMAS va sotuv hujjati yaratmaydi", async () => {
    const supplier = await call(owner(), "POST", "/api/purchase/suppliers", { name: "Ta'minotchi", code: "SUP-1" });
    expect(supplier.statusCode, supplier.body).toBe(201);
    const salesBefore = (await db.select().from(salesOrders).where(eq(salesOrders.companyId, company.companyId))).length;

    const created = await call(owner(), "POST", "/api/purchase/orders", {
      supplierId: supplier.json().supplier.id,
      warehouseId: company.warehouseId,
      orderDate: today(),
      items: [{ productId: company.productId, unitId: piece, orderedQty: "10", unitPrice: "3000" }],
    });
    expect(created.statusCode, created.body).toBe(201);
    const purchaseId = created.json().order.id as string;
    expect(created.json().order.status).toBe("draft");

    const confirmed = await call(owner(), "POST", `/api/purchase/orders/${purchaseId}/confirm`);
    expect(confirmed.statusCode).toBe(200);
    // Tasdiqlangan xarid — "to'langan" emas, "qabul qilingan" ham emas
    expect(confirmed.json().order.status).toBe("confirmed");

    const salesAfter = await db.select().from(salesOrders).where(eq(salesOrders.companyId, company.companyId));
    expect(salesAfter).toHaveLength(salesBefore);
  });

  it("xarajat sotuv va yetkazma hujjatlariga tegmaydi", async () => {
    const expense = await call(owner(), "POST", "/api/finance/expenses", {
      category: "boshqa",
      description: "Ijara",
      amount: "200000",
      expenseDate: today(),
    });
    expect(expense.statusCode, expense.body).toBe(201);
    expect(await db.select().from(salesOrders).where(eq(salesOrders.companyId, company.companyId))).toHaveLength(0);
    expect(await db.select().from(deliveryTasks).where(eq(deliveryTasks.companyId, company.companyId))).toHaveLength(0);
  });
});

// ─── Bitta kompaniya — ko'p biznes ───────────────────────────────────────────

describe("8. Bitta kompaniya bir vaqtda: chakana + distribyutsiya + ishlab chiqarish + xarid", () => {
  it("har oqim o'z mantig'ini saqlaydi — biri ikkinchisining holatini meros qilib olmaydi", async () => {
    await setPolicy(app, owner(), NO_PROOFS);
    const { bread, bomId } = await breadRecipe();
    await produce(bomId, "30");

    // a) Kassadan chakana sotuv
    const pos = await sell({ items: [{ productId: bread, quantity: "3" }], paymentMethod: "cash", amountPaid: "9000" });
    expect(pos.statusCode, pos.body).toBe(201);
    const posId = pos.json().order.id as string;

    // b) Yetkazib beriladigan distribyutsiya buyurtmasi
    const deliveryId = await confirmedOrder(app, company, "10");

    // c) Olib ketiladigan ulgurji buyurtma
    const pickupId = await erpOrder("20", false);
    expect((await call(owner(), "POST", `/api/sales/orders/${pickupId}/ship`)).statusCode).toBe(200);

    // d) Xarid
    const supplier = await call(owner(), "POST", "/api/purchase/suppliers", { name: "Un ta'minotchi", code: "SUP-9" });
    const purchase = await call(owner(), "POST", "/api/purchase/orders", {
      supplierId: supplier.json().supplier.id,
      warehouseId: company.warehouseId,
      orderDate: today(),
      items: [{ productId: company.productId, unitId: piece, orderedQty: "5", unitPrice: "3000" }],
    });
    expect(purchase.statusCode, purchase.body).toBe(201);

    // Har bir sotuv o'z kanali va yetkazish usulini saqlaydi
    expect(await orderOf(posId)).toMatchObject({ status: "completed", source: "pos", fulfillmentMethod: "counter", isPos: true, deliveryStatus: null });
    expect(await orderOf(deliveryId)).toMatchObject({ status: "confirmed", source: "manual", fulfillmentMethod: "delivery", isPos: false, deliveryStatus: "ready" });
    expect(await orderOf(pickupId)).toMatchObject({ status: "completed", source: "manual", fulfillmentMethod: "pickup", isPos: false, deliveryStatus: null });

    // Yetkazma faqat yetkazish talab qilgan buyurtmada
    expect(await tasksOf(posId)).toHaveLength(0);
    expect(await tasksOf(pickupId)).toHaveLength(0);
    expect(await tasksOf(deliveryId)).toHaveLength(1);
    expect(await db.select().from(deliveryTasks).where(eq(deliveryTasks.companyId, company.companyId))).toHaveLength(1);

    // Kassa cheki "yetkazildi" bo'lib qolmadi va hech bir sotuv eski lug'atga tushmadi
    const all = await db.select().from(salesOrders).where(eq(salesOrders.companyId, company.companyId));
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all.filter((row) => row.status === "delivered" || row.status === "shipped")).toHaveLength(0);
  });
});
