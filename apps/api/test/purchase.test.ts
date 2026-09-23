import { and, eq, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { batches, units } from "../src/db/schema/catalog.js";
import { accounts } from "../src/db/schema/finance.js";
import { stockLevels, stockMovements, warehouses } from "../src/db/schema/inventory.js";
import { suppliers } from "../src/db/schema/purchase.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let other: Company;
let piece: string;
let box: string;
let mainWh: string;

const today = new Date().toISOString().slice(0, 10);
const year = today.slice(0, 4);

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
  box = (await db.select().from(units).where(ne(units.shortName, "d")))[0]!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Xarid kompaniyasi" });
  other = await createCompany(app, admin.cookie, { name: "Boshqa kompaniya" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
});

const call = (cookie: string, method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const purchase = (method: "GET" | "POST" | "PATCH", url: string, payload?: object, cookie = company.ownerCookie) =>
  call(cookie, method, `/api/purchase${url}`, payload);

async function product(sku: string, extra: object = {}, owner = company) {
  const res = await call(owner.ownerCookie, "POST", "/api/catalog/products", { name: `Mahsulot ${sku}`, sku, baseUnitId: piece, ...extra });
  expect(res.statusCode).toBe(201);
  return res.json().product.id as string;
}

let supplierSeq = 0;
async function supplier(owner = company) {
  supplierSeq += 1;
  const res = await call(owner.ownerCookie, "POST", "/api/purchase/suppliers", { name: `Ta'minotchi ${supplierSeq}`, code: `SUP-${supplierSeq}` });
  expect(res.statusCode).toBe(201);
  return res.json().supplier.id as string;
}

async function confirmedOrder(items: object[], supplierId?: string) {
  const res = await purchase("POST", "/orders", {
    supplierId: supplierId ?? (await supplier()),
    warehouseId: mainWh,
    orderDate: today,
    items,
  });
  expect(res.statusCode).toBe(201);
  const confirmed = await purchase("POST", `/orders/${res.json().order.id}/confirm`);
  expect(confirmed.statusCode).toBe(200);
  return confirmed.json().order;
}

async function ledger(code: string) {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code)));
  return row!.balance;
}

async function stock(productId: string) {
  const [row] = await db
    .select()
    .from(stockLevels)
    .where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, mainWh)));
  return row;
}

describe("Ta'minotchilar", () => {
  it("yaratish, kod noyobligi, valyuta, qidiruv, tahrir va ruxsatlar", async () => {
    const created = await purchase("POST", "/suppliers", {
      name: "Olma savdo",
      code: "OLMA",
      phone: "+998901234567",
      paymentTermDays: 15,
      currency: "uzs",
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().supplier.id;
    expect(created.json().supplier).toMatchObject({ code: "OLMA", currency: "UZS", totalDebt: "0.00", isActive: true });

    expect((await purchase("POST", "/suppliers", { name: "X", code: "OLMA" })).statusCode).toBe(409);
    expect((await purchase("POST", "/suppliers", { name: "X", code: "USD-1", currency: "USD" })).statusCode).toBe(400);

    // Kod berilmasa — avtomatik S-0001, S-0002 (xarid oynasidan tezkor qo'shish)
    const auto1 = await purchase("POST", "/suppliers", { name: "Tezkor 1" });
    const auto2 = await purchase("POST", "/suppliers", { name: "Tezkor 2", phone: "+998907654321" });
    expect(auto1.statusCode).toBe(201);
    expect([auto1.json().supplier.code, auto2.json().supplier.code]).toEqual(["S-0001", "S-0002"]);
    await purchase("PATCH", `/suppliers/${auto1.json().supplier.id}`, { isActive: false });
    await purchase("PATCH", `/suppliers/${auto2.json().supplier.id}`, { isActive: false });

    const found = (await purchase("GET", "/suppliers?search=olma")).json().suppliers;
    expect(found.map((s: { id: string }) => s.id)).toEqual([id]);
    expect((await purchase("PATCH", `/suppliers/${id}`, { name: "Olma savdo MChJ" })).json().supplier.name).toBe("Olma savdo MChJ");
    expect((await purchase("GET", `/suppliers/${id}`)).json().supplier).toMatchObject({ orderCount: 0, openOrders: 0 });

    const kassir = await addEmployee(app, company, "Kassir");
    expect((await purchase("GET", "/suppliers", undefined, kassir.cookie)).statusCode).toBe(403);
    expect((await purchase("GET", `/suppliers/${id}`, undefined, other.ownerCookie)).statusCode).toBe(404);
  });
});

describe("Xarid buyurtmalari", () => {
  it("summalar aniq hisoblanadi; qoralama tahriri; tasdiqlash va bekor qilish qoidalari", async () => {
    const p1 = await product("P-1");
    const p2 = await product("P-2");
    const sid = await supplier();

    const res = await purchase("POST", "/orders", {
      supplierId: sid,
      warehouseId: mainWh,
      orderDate: today,
      items: [{ productId: p1, unitId: piece, orderedQty: "3", unitPrice: "1000.5", taxRate: "12", discountPercent: "10" }],
    });
    expect(res.statusCode).toBe(201);
    const order = res.json().order;
    expect(order).toMatchObject({
      number: `PO-${year}-0001`,
      status: "draft",
      subtotal: "2701.35",
      taxAmount: "324.16",
      discountAmount: "300.15",
      totalAmount: "3025.51",
      paidAmount: "0.00",
      balance: "3025.51",
    });
    expect(order.items[0]).toMatchObject({ lineTotal: "3025.51", pendingQty: "3.0000", unitName: "d" });

    const patched = await purchase("PATCH", `/orders/${order.id}`, {
      items: [{ productId: p2, unitId: piece, orderedQty: "0.3333", unitPrice: "10" }],
    });
    expect(patched.json().order).toMatchObject({ totalAmount: "3.33", taxAmount: "0.00" });
    expect(patched.json().order.items).toHaveLength(1);

    const foreign = await product("F-1", {}, other);
    const foreignItems = [{ productId: foreign, unitId: piece, orderedQty: "1", unitPrice: "1" }];
    expect((await purchase("POST", "/orders", { supplierId: sid, warehouseId: mainWh, orderDate: today, items: foreignItems })).statusCode).toBe(400);
    const boxItems = [{ productId: p1, unitId: box, orderedQty: "1", unitPrice: "1" }];
    expect((await purchase("POST", "/orders", { supplierId: sid, warehouseId: mainWh, orderDate: today, items: boxItems })).statusCode).toBe(400);

    expect((await purchase("POST", `/orders/${order.id}/confirm`)).json().order.status).toBe("confirmed");
    expect((await purchase("PATCH", `/orders/${order.id}`, { notes: "X" })).statusCode).toBe(400);
    expect((await purchase("POST", `/orders/${order.id}/cancel`, { reason: "Kerak emas" })).json().order.status).toBe("cancelled");
    expect((await purchase("POST", `/orders/${order.id}/confirm`)).statusCode).toBe(400);

    const second = await purchase("POST", "/orders", {
      supplierId: sid,
      warehouseId: mainWh,
      orderDate: today,
      items: [{ productId: p1, unitId: piece, orderedQty: "1", unitPrice: "5" }],
    });
    expect(second.json().order.number).toBe(`PO-${year}-0002`);

    const list = (await purchase("GET", `/orders?supplierId=${sid}&status=cancelled`)).json().orders;
    expect(list.map((o: { id: string }) => o.id)).toEqual([order.id]);
  });

  it("qabul: qisman → to'liq, AVCO, qarz va jurnal; ortiqcha qabul va bekor qilish rad etiladi", async () => {
    const p = await product("OLMA");
    const order = await confirmedOrder([{ productId: p, unitId: piece, orderedQty: "10", unitPrice: "1000", taxRate: "12" }]);
    const itemId = order.items[0].id;
    const receive = (receivedQty: string, orderId = order.id, orderItemId = itemId) =>
      purchase("POST", `/orders/${orderId}/receipts`, { items: [{ orderItemId, receivedQty }] });

    const first = await receive("3");
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ status: "partial", total: "3360.00" });
    expect(await stock(p)).toMatchObject({ quantity: "3.0000", avgCostPrice: "1120.0000" });
    expect(await ledger("1200")).toBe("3360.00");
    expect(await ledger("2000")).toBe("3360.00");

    const over = await receive("8");
    expect(over.statusCode).toBe(400);
    expect(over.json().message).toContain("ortiq");
    expect(await stock(p)).toMatchObject({ quantity: "3.0000" });

    const last = await receive("7");
    expect(last.json()).toMatchObject({ status: "received", total: "7840.00" });
    expect(await stock(p)).toMatchObject({ quantity: "10.0000", avgCostPrice: "1120.0000" });
    const [row] = await db.select().from(suppliers).where(eq(suppliers.id, order.supplierId));
    expect(row).toMatchObject({ totalDebt: "11200.00", totalPurchased: "11200.00" });
    expect(await ledger("1200")).toBe("11200.00");

    expect((await receive("1")).statusCode).toBe(400);
    expect((await purchase("POST", `/orders/${order.id}/cancel`)).statusCode).toBe(400);
    const movements = await db.select().from(stockMovements).where(eq(stockMovements.productId, p));
    expect(movements.map((m) => m.referenceType)).toEqual(["purchase_receipt", "purchase_receipt"]);

    const secondOrder = await confirmedOrder([{ productId: p, unitId: piece, orderedQty: "1", unitPrice: "1" }]);
    expect((await receive("1", secondOrder.id, itemId)).statusCode).toBe(400);
    const kassir = await addEmployee(app, company, "Kassir");
    const forbidden = await purchase(
      "POST",
      `/orders/${secondOrder.id}/receipts`,
      { items: [{ orderItemId: secondOrder.items[0].id, receivedQty: "1" }] },
      kassir.cookie,
    );
    expect(forbidden.statusCode).toBe(403);
  });

  it("qutida xarid zaxiraga asosiy birlikda tushadi; partiya kuzatiladigan mahsulotga partiya raqami shart", async () => {
    const p = await product("QUTI", { trackBatch: true });
    const conversion = await call(company.ownerCookie, "POST", "/api/catalog/unit-conversions", {
      fromUnitId: box,
      toUnitId: piece,
      factor: "12",
      productId: p,
    });
    expect(conversion.statusCode).toBe(201);

    const order = await confirmedOrder([{ productId: p, unitId: box, orderedQty: "2", unitPrice: "120000" }]);
    expect(order.totalAmount).toBe("240000.00");
    const itemId = order.items[0].id;

    const noBatch = await purchase("POST", `/orders/${order.id}/receipts`, { items: [{ orderItemId: itemId, receivedQty: "2" }] });
    expect(noBatch.statusCode).toBe(400);
    expect(noBatch.json().message).toContain("partiya");

    const ok = await purchase("POST", `/orders/${order.id}/receipts`, {
      items: [{ orderItemId: itemId, receivedQty: "2", batchNumber: "B-1", expiryDate: "2027-01-01" }],
    });
    expect(ok.statusCode).toBe(201);
    expect(await stock(p)).toMatchObject({ quantity: "24.0000", avgCostPrice: "10000.0000" });

    const [batch] = await db.select().from(batches).where(eq(batches.productId, p));
    expect(batch).toMatchObject({ batchNumber: "B-1", quantity: "24.0000", unitId: piece, costPrice: "10000.0000" });
    const [movement] = await db.select().from(stockMovements).where(eq(stockMovements.productId, p));
    expect(movement).toMatchObject({ batchId: batch!.id, quantity: "24.0000" });
  });
});

/**
 * TO'G'RIDAN-TO'G'RI QABUL QILISH — kichik biznesda xaridni kirituvchi odam uni o'zi qabul qiladi.
 *
 * Talab: import qilingan (yoki qo'lda kiritilgan) QORALAMA hujjatda bitta tugma bosilsa — hujjat
 * tasdiqlanadi, qolgan tovar to'liq qabul qilinadi va ko'rsatilgan usulda to'lov yoziladi.
 * Yangi hisob-kitob yo'q: zaxira, tannarx, jurnal va ta'minotchi qarzi odatdagi yo'l bilan yoziladi.
 */
describe("Xaridni bir bosqichda yakunlash", () => {
  async function draftOrder(items: object[], supplierId?: string) {
    const res = await purchase("POST", "/orders", {
      supplierId: supplierId ?? (await supplier()),
      warehouseId: mainWh,
      orderDate: today,
      items,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().order as { id: string; supplierId: string; status: string; totalAmount: string };
  }

  /** Naqd to'lov kassadan chiqadi — kassa manfiyga ketmasligi uchun avval qoldiq qo'yiladi. */
  async function fundCash(amount: string) {
    const accounts = (await call(company.ownerCookie, "GET", "/api/finance/cash-accounts")).json().cashAccounts as { id: string; type: string }[];
    const cash = accounts.find((account) => account.type === "cash") ?? accounts[0]!;
    const res = await call(company.ownerCookie, "POST", `/api/finance/cash-accounts/${cash.id}/set-balance`, {
      balance: amount,
      reason: "Sinov qoldig'i",
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  it("qoralama → tasdiq + to'liq qabul + naqd to'lov, hammasi bitta so'rovda", async () => {
    await fundCash("100000");
    const productId = await product("DIRECT-1");
    const order = await draftOrder([{ productId, unitId: piece, orderedQty: "10", unitPrice: "5000" }]);
    expect(order.status).toBe("draft");

    const res = await purchase("POST", `/orders/${order.id}/complete`, {
      payment: { amount: "50000", method: "cash" },
    });
    expect(res.statusCode, res.body).toBe(201);

    const done = res.json().order as { status: string; paidAmount: string; totalAmount: string };
    expect(done.totalAmount).toBe("50000.00");
    expect(done.paidAmount, "to'lov yozildi").toBe("50000.00");
    expect(done.status, "to'liq qabul + to'liq to'lov").toBe("paid");
    expect((await stock(productId))?.quantity, "tovar omborga kirdi").toBe("10.0000");
    expect(res.json().payment, "to'lov hujjati qaytadi").not.toBeNull();
  });

  it("to'lovsiz yakunlash — tovar kiradi, summa ta'minotchi qarziga qoladi", async () => {
    const productId = await product("DIRECT-2");
    const supplierId = await supplier();
    const order = await draftOrder([{ productId, unitId: piece, orderedQty: "4", unitPrice: "2500" }], supplierId);

    const res = await purchase("POST", `/orders/${order.id}/complete`);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().payment).toBeNull();
    expect(res.json().order.status, "qabul qilingan, to'lanmagan").toBe("received");
    expect((await stock(productId))?.quantity).toBe("4.0000");

    const [row] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId));
    expect(row!.totalDebt, "qarz o'sdi").toBe("10000.00");
  });

  it("qisman qabul qilingan hujjatni yakunlaydi va takror bosilsa xato beradi", async () => {
    const productId = await product("DIRECT-3");
    const order = await confirmedOrder([{ productId, unitId: piece, orderedQty: "10", unitPrice: "1000" }]);
    const itemId = (await purchase("GET", `/orders/${order.id}`)).json().order.items[0].id as string;

    // Avval 4 tasi qo'lda qabul qilinadi
    expect((await purchase("POST", `/orders/${order.id}/receipts`, { items: [{ orderItemId: itemId, receivedQty: "4" }] })).statusCode).toBe(201);
    expect((await stock(productId))?.quantity).toBe("4.0000");

    // Qolgan 6 tasi bitta tugma bilan
    const res = await purchase("POST", `/orders/${order.id}/complete`);
    expect(res.statusCode, res.body).toBe(201);
    expect((await stock(productId))?.quantity, "qolgani ham kirdi").toBe("10.0000");
    expect(res.json().order.status).toBe("received");

    // Takror bosilsa — qabul qilinadigan qoldiq yo'q
    const again = await purchase("POST", `/orders/${order.id}/complete`);
    expect(again.statusCode).toBe(400);
    expect(again.json().message).toMatch(/allaqachon qabul qilingan/i);
    expect((await stock(productId))?.quantity, "ikkinchi bosishdan qoldiq o'zgarmaydi").toBe("10.0000");
  });

  it("bekor qilingan hujjat yakunlanmaydi; ombor ruxsati yo'q xodim qabul qilolmaydi", async () => {
    const productId = await product("DIRECT-4");
    const cancelled = await draftOrder([{ productId, unitId: piece, orderedQty: "1", unitPrice: "1000" }]);
    expect((await purchase("POST", `/orders/${cancelled.id}/cancel`, { reason: "kerak emas" })).statusCode).toBe(200);
    const res = await purchase("POST", `/orders/${cancelled.id}/complete`);
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/bekor qilingan/i);

    // Buxgalterda `warehouse.receive` yo'q — tovarni jismonan qabul qila olmaydi
    const order = await draftOrder([{ productId, unitId: piece, orderedQty: "1", unitPrice: "1000" }]);
    const accountant = await addEmployee(app, company, "Buxgalter");
    const denied = await purchase("POST", `/orders/${order.id}/complete`, undefined, accountant.cookie);
    expect(denied.statusCode, denied.body).toBe(403);
    expect(await stock(productId), "rad etilganda qoldiq yozuvi umuman yaratilmaydi").toBeUndefined();
  });
});
