import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts, cashAccounts } from "../src/db/schema/finance.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { supplierPayments, suppliers } from "../src/db/schema/purchase.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let other: Company;
let piece: string;
let mainWh: string;
let mainCash: string;
let mainBank: string;

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
  company = await createCompany(app, admin.cookie, { name: "To'lov kompaniyasi" });
  other = await createCompany(app, admin.cookie, { name: "Boshqa kompaniya" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  const cash = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));
  mainCash = cash.find((c) => c.type === "cash")!.id;
  mainBank = cash.find((c) => c.type === "bank")!.id;
});

const call = (cookie: string, method: "GET" | "POST", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const pay = (body: object, cookie = company.ownerCookie) => call(cookie, "POST", "/api/purchase/payments", body);

async function ledger(code: string) {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code)));
  return row!;
}

async function balanceOf(cashAccountId: string) {
  const [row] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, cashAccountId));
  return row!.balance;
}

async function debtOf(supplierId: string) {
  const [row] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId));
  return row!.totalDebt;
}

async function fund(cashAccountId: string, amount: string) {
  const capital = await ledger("3000");
  const res = await call(company.ownerCookie, "POST", "/api/finance/cash-transactions", {
    cashAccountId,
    type: "in",
    amount,
    description: "Kirim",
    counterAccountId: capital.id,
  });
  expect(res.statusCode).toBe(201);
}

let seq = 0;
async function setup(options: { qty: string; price: string; receive?: boolean; confirm?: boolean; supplierId?: string }) {
  seq += 1;
  const productRes = await call(company.ownerCookie, "POST", "/api/catalog/products", { name: `P ${seq}`, sku: `P-${seq}`, baseUnitId: piece });
  const supplierId =
    options.supplierId ??
    (await call(company.ownerCookie, "POST", "/api/purchase/suppliers", { name: `S ${seq}`, code: `S-${seq}` })).json().supplier.id;
  const orderRes = await call(company.ownerCookie, "POST", "/api/purchase/orders", {
    supplierId,
    warehouseId: mainWh,
    orderDate: today,
    items: [{ productId: productRes.json().product.id, unitId: piece, orderedQty: options.qty, unitPrice: options.price }],
  });
  let order = orderRes.json().order;
  if (options.confirm !== false) {
    order = (await call(company.ownerCookie, "POST", `/api/purchase/orders/${order.id}/confirm`)).json().order;
  }
  if (options.receive) {
    const received = await call(company.ownerCookie, "POST", `/api/purchase/orders/${order.id}/receipts`, {
      items: [{ orderItemId: order.items[0].id, receivedQty: options.qty }],
    });
    expect(received.statusCode).toBe(201);
  }
  return { order, supplierId: supplierId as string };
}

const getOrder = async (orderId: string) =>
  (await call(company.ownerCookie, "GET", `/api/purchase/orders/${orderId}`)).json().order;

describe("Ta'minotchiga to'lov", () => {
  it("kassadan: DR kreditorlar / CR kassa, buyurtma va qarz yangilanadi; ortiqcha to'lov rad; reference takrorlanmaydi", async () => {
    await fund(mainCash, "1000000");
    const { order, supplierId } = await setup({ qty: "10", price: "1000", receive: true });

    const first = await pay({ supplierId, orderId: order.id, amount: "4000", method: "cash" });
    expect(first.statusCode).toBe(201);
    expect(first.json().payment).toMatchObject({ amount: "4000.00", cashAccountId: mainCash });
    expect(first.json().payment.journalEntryId).toBeTruthy();
    expect(await getOrder(order.id)).toMatchObject({ paidAmount: "4000.00", status: "received", balance: "6000.00" });
    expect(await balanceOf(mainCash)).toBe("996000.00");
    expect(await debtOf(supplierId)).toBe("6000.00");
    expect((await ledger("2000")).balance).toBe("6000.00");
    expect((await ledger("1010")).balance).toBe("996000.00");

    const over = await pay({ supplierId, orderId: order.id, amount: "6000.01" });
    expect(over.statusCode).toBe(400);

    const rest = await pay({ supplierId, orderId: order.id, amount: "6000", reference: "PAY-1" });
    expect(rest.statusCode).toBe(201);
    expect(await getOrder(order.id)).toMatchObject({ status: "paid", balance: "0.00" });
    expect(await debtOf(supplierId)).toBe("0.00");

    const repeat = await pay({ supplierId, orderId: order.id, amount: "6000", reference: "PAY-1" });
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json().created).toBe(false);
    expect(await balanceOf(mainCash)).toBe("990000.00");

    expect((await pay({ supplierId, amount: "1" })).statusCode).toBe(400);
    const list = (await call(company.ownerCookie, "GET", `/api/purchase/payments?supplierId=${supplierId}`)).json().payments;
    expect(list).toHaveLength(2);
  });

  it("bank orqali avans: bank hisobidan, CR bank; qabuldan keyin buyurtma to'langan; mablag' yetmasa hech narsa yozilmaydi", async () => {
    await fund(mainBank, "50000");
    const { order, supplierId } = await setup({ qty: "10", price: "3000" });

    const advance = await pay({ supplierId, orderId: order.id, amount: "30000", method: "bank" });
    expect(advance.statusCode).toBe(201);
    expect(advance.json().payment.cashAccountId).toBe(mainBank);
    expect(await balanceOf(mainBank)).toBe("20000.00");
    expect((await ledger("1020")).balance).toBe("20000.00");
    expect(await debtOf(supplierId)).toBe("-30000.00");
    expect(await getOrder(order.id)).toMatchObject({ status: "confirmed", paidAmount: "30000.00" });

    const received = await call(company.ownerCookie, "POST", `/api/purchase/orders/${order.id}/receipts`, {
      items: [{ orderItemId: order.items[0].id, receivedQty: "10" }],
    });
    expect(received.json().status).toBe("paid");
    expect(await debtOf(supplierId)).toBe("0.00");

    const { order: big, supplierId: bigSupplier } = await setup({ qty: "10", price: "10000" });
    const failed = await pay({ supplierId: bigSupplier, orderId: big.id, amount: "100000", method: "cash" });
    expect(failed.statusCode).toBe(400);
    expect(await db.select().from(supplierPayments).where(eq(supplierPayments.orderId, big.id))).toHaveLength(0);
    expect(await getOrder(big.id)).toMatchObject({ paidAmount: "0.00" });
  });

  it("ruxsatlar va bog'liqliklar: Omborchi to'lay olmaydi; begona ta'minotchi, boshqa ta'minotchi buyurtmasi, qoralama", async () => {
    await fund(mainCash, "100000");
    const { order, supplierId } = await setup({ qty: "10", price: "1000", receive: true });

    const omborchi = await addEmployee(app, company, "Omborchi");
    expect((await pay({ supplierId, orderId: order.id, amount: "1000" }, omborchi.cookie)).statusCode).toBe(403);
    const xarid = await addEmployee(app, company, "Xarid menejeri");
    expect((await pay({ supplierId, orderId: order.id, amount: "1000" }, xarid.cookie)).statusCode).toBe(201);

    const foreignSupplier = (await call(other.ownerCookie, "POST", "/api/purchase/suppliers", { name: "F", code: "F-1" })).json().supplier.id;
    expect((await pay({ supplierId: foreignSupplier, amount: "1" })).statusCode).toBe(404);

    const { supplierId: anotherSupplier } = await setup({ qty: "1", price: "1" });
    expect((await pay({ supplierId: anotherSupplier, orderId: order.id, amount: "1" })).statusCode).toBe(400);

    const { order: draft, supplierId: draftSupplier } = await setup({ qty: "1", price: "100", confirm: false });
    expect((await pay({ supplierId: draftSupplier, orderId: draft.id, amount: "1" })).statusCode).toBe(400);
  });
});
