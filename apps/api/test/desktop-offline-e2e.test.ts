/**
 * BUM POS KASSA uchdan-uchga offline sinovi: haqiqiy desktop xizmati (`KassaService`, lokal SQLite, navbat, PIN)
 * haqiqiy API serverga (`app.inject`) ulanadi; "internet" o'chirilib yoqiladi.
 */
import { DatabaseSync } from "node:sqlite";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { KassaService, type TokenVault } from "../../desktop/src/main/kassa-service.js";
import { migrate } from "../../desktop/src/main/local-db.js";
import { LocalStore } from "../../desktop/src/main/local-store.js";
import { closeDb, db } from "../src/db/client.js";
import { products, units } from "../src/db/schema/catalog.js";
import { inventoryCounts, stockLevels, warehouses } from "../src/db/schema/inventory.js";
import { posSyncConflicts } from "../src/db/schema/pos.js";
import { suppliers } from "../src/db/schema/purchase.js";
import { customers, posShifts, salesOrders } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let piece: string;
let mainWarehouseId: string;

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
  const adminCookie = (await signedIn(app, { isPlatformAdmin: true })).cookie;
  company = await createCompany(app, adminCookie, { name: "Bonnu" });
  mainWarehouseId = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
});

/** Kassa ↔ server "tarmog'i": o'chirish, push javobini yo'qotish (server bajaradi, qurilma javob olmaydi). */
function network() {
  const state = { online: true, dropNextPushResponse: false };
  const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    if (!state.online) throw new TypeError("fetch failed");
    const url = new URL(String(input));
    const res = await app.inject({
      method: (init?.method ?? "GET") as "GET" | "POST",
      url: `${url.pathname}${url.search}`,
      headers: (init?.headers ?? {}) as Record<string, string>,
      ...(typeof init?.body === "string" ? { payload: init.body } : {}),
    });
    if (state.dropNextPushResponse && url.pathname === "/api/pos-device/push") {
      state.dropNextPushResponse = false;
      throw new TypeError("connection reset");
    }
    return new Response(res.body, { status: res.statusCode, headers: { "content-type": String(res.headers["content-type"] ?? "application/json") } });
  }) as typeof fetch;
  return { state, fetchImpl };
}

function kassaFor(net: ReturnType<typeof network>) {
  const database = new DatabaseSync(":memory:");
  migrate(database);
  const store = new LocalStore(database);
  const vault: TokenVault & { value: string | null } = {
    value: null,
    save(token) {
      this.value = token;
    },
    load() {
      return this.value;
    },
    clear() {
      this.value = null;
    },
  };
  return new KassaService(store, vault, { appVersion: "0.1.0", platform: "win32", fetchImpl: net.fetchImpl });
}

async function webProduct(name: string, sku: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/catalog/products",
    headers: { cookie: company.ownerCookie },
    payload: { name, sku, baseUnitId: piece, salesPrice: "10000", purchasePrice: "6000", taxRate: "0" },
  });
  expect(res.statusCode).toBe(201);
  const id = res.json().product.id as string;
  const received = await app.inject({
    method: "POST",
    url: "/api/inventory/stock/movements",
    headers: { cookie: company.ownerCookie },
    payload: { type: "receive", productId: id, warehouseId: mainWarehouseId, quantity: "5", costPrice: "6000" },
  });
  expect(received.statusCode).toBe(201);
  return id;
}

async function stockOf(productId: string) {
  const [level] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, mainWarehouseId)));
  return level?.quantity;
}

describe("BUM POS KASSA — uchdan-uchga offline", () => {
  it("to'liq offline ish kuni: xarid, sotuv, qaytarish, ortiqcha sotuv, inkassatsiya, hisobdan chiqarish, inventarizatsiya, narx va mijoz tahriri, smena yopish → internet qaytgach server holati to'g'ri", async () => {
    const cola = await webProduct("Cola", "COLA");
    const net = network();
    const kassa = kassaFor(net);
    const registered = await kassa.register({ apiUrl: "https://kassa.test", phone: company.owner.phone, password: company.owner.password, warehouseId: mainWarehouseId, name: "Kassa 1" });
    expect(registered).toMatchObject({ registered: true, device: { code: "K01" } });
    await kassa.firstLogin({ phone: company.owner.phone, password: company.owner.password, pin: "1234" });
    expect(kassa.products({ query: "cola" })[0]).toMatchObject({ id: cola, stock: "5.0000" });

    // ─── Internet yo'q ───────────────────────────────────────────────────
    net.state.online = false;
    kassa.openShift({ openingCash: "100000" });
    const supplier = kassa.createSupplier({ name: "Olma savdo", phone: "+998931112233", partyType: "legal", taxId: "301234567" });
    kassa.completePurchase({ supplierId: supplier.id, lines: [{ productId: cola, unitId: piece, quantity: "10", unitPrice: "6500" }], payment: { amount: "30000", method: "cash" } });
    const customer = kassa.createCustomer({ name: "Vali", phone: "+998901234567" });
    const sale = (quantity: string) =>
      kassa.completeSale({ customerId: null, lines: [{ productId: cola, unitId: piece, quantity }], saleCurrencies: [], paymentMethod: "cash", amountPaid: null, cashbackAmount: null, balanceAmount: null, changeToBalance: false, currencyPayments: [] });
    const first = sale("12");
    await kassa.returnItems({ number: first.number, items: [{ orderItemId: first.lines[0]!.id, quantity: "2" }], refundMethod: "cash" });
    sale("7"); // qoldiq 5 edi — ortiqcha sotuv (ogohlantirib yoziladi)
    kassa.cashMovement({ kind: "collection", amount: "50000" });
    kassa.writeOff({ lines: [{ productId: cola, quantity: "1" }], reason: "Singan" });
    expect(kassa.products({ query: "cola" })[0]!.stock).toBe("-3.0000");
    kassa.countSet({ productId: cola, counted: "0", mode: "set" });
    kassa.countComplete({ notes: "Kun oxiri" });
    kassa.updatePrices({ productId: cola, salesPrice: "11000" });
    kassa.updateCustomer({ customerId: customer.id, address: "Chilonzor" });
    // 100000 − 30000 + 120000 − 20000 + 70000 − 50000
    expect(kassa.shiftReport({}).expectedCash).toBe("190000.00");
    kassa.closeShift({ closingCash: "190000" });
    // smena ochish, ta'minotchi, xarid, mijoz, 2 chek, qaytarish, inkassatsiya, hisobdan chiqarish, inventarizatsiya, narx, mijoz tahriri, smena yopish
    expect((await kassa.syncNow()).sync).toMatchObject({ state: "offline", pending: 13 });

    // ─── Internet qaytdi ─────────────────────────────────────────────────
    net.state.online = true;
    const synced = await kassa.syncNow();
    expect(kassa.unsynced()).toEqual([]);
    expect(synced.sync).toMatchObject({ state: "idle", pending: 0, rejected: 0 });

    // Qoldiq: 5 + 10 − 12 + 2 − 7 − 1 = −3, sanoq 0 → tuzatma +3
    expect(await stockOf(cola)).toBe("0.0000");
    const orders = await db.select().from(salesOrders).where(eq(salesOrders.companyId, company.companyId));
    expect(orders.map((row) => row.number).sort()).toEqual(["K01-000001", "K01-000002"]);
    expect((await db.select().from(suppliers).where(eq(suppliers.id, supplier.id)))[0]).toMatchObject({ totalDebt: "35000.00", partyType: "legal", taxId: "301234567" });
    expect((await db.select().from(customers).where(eq(customers.id, customer.id)))[0]).toMatchObject({ address: "Chilonzor" });
    expect((await db.select().from(products).where(eq(products.id, cola)))[0]!.salesPrice).toBe("11000.0000");
    expect((await db.select().from(posShifts).where(eq(posShifts.companyId, company.companyId)))[0]).toMatchObject({
      status: "closed",
      openingCash: "100000.00",
      closingCash: "190000.00",
      totalCash: "170000.00",
      cashOut: "80000.00",
    });
    expect((await db.select().from(inventoryCounts).where(eq(inventoryCounts.companyId, company.companyId)))[0]).toMatchObject({ name: "K01-I000001", status: "completed" });
    const conflicts = await db.select().from(posSyncConflicts).where(eq(posSyncConflicts.companyId, company.companyId));
    expect(conflicts.map((row) => row.kind)).toContain("stock_shortage");

    // Qurilma server bilan bir xil: navbat bo'sh, qoldiq va narx serverdagidek
    expect(kassa.products({ query: "cola" })[0]).toMatchObject({ stock: "0.0000", salesPrice: "11000.0000" });
    expect(kassa.status().counts).toMatchObject({ pending: 0, rejected: 0 });
  });

  it("push javobi yo'qoldi (server bajardi, qurilma bilmadi): qayta yuborishda takrorlanmaydi — bitta chek, qoldiq bir marta kamayadi", async () => {
    const tea = await webProduct("Choy", "TEA");
    const net = network();
    const kassa = kassaFor(net);
    await kassa.register({ apiUrl: "https://kassa.test", phone: company.owner.phone, password: company.owner.password, warehouseId: mainWarehouseId, name: "Kassa 1" });
    await kassa.firstLogin({ phone: company.owner.phone, password: company.owner.password, pin: "1234" });

    net.state.online = false;
    kassa.openShift({ openingCash: "0" });
    const sold = kassa.completeSale({
      customerId: null,
      lines: [{ productId: tea, unitId: piece, quantity: "2" }],
      saleCurrencies: [],
      paymentMethod: "card",
      amountPaid: null,
      cashbackAmount: null,
      balanceAmount: null,
      changeToBalance: false,
      currencyPayments: [],
    });

    net.state.online = true;
    net.state.dropNextPushResponse = true;
    expect((await kassa.syncNow()).sync).toMatchObject({ state: "offline", pending: 2 });
    expect(await stockOf(tea)).toBe("3.0000");

    const again = await kassa.syncNow();
    expect(again.sync).toMatchObject({ state: "idle", pending: 0, rejected: 0 });
    const orders = await db.select().from(salesOrders).where(eq(salesOrders.companyId, company.companyId));
    expect(orders.map((row) => row.id)).toEqual([sold.id]);
    expect(await stockOf(tea)).toBe("3.0000");
    expect(kassa.sales({}).find((row) => row.id === sold.id)!.sync.state).toBe("applied");
  });
});
