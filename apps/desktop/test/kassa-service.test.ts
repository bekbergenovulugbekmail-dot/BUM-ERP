import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { KassaError, KassaService, type TokenVault } from "../src/main/kassa-service.js";
import { migrate } from "../src/main/local-db.js";
import { LocalStore } from "../src/main/local-store.js";
import type { PushResult, WireOperation } from "../src/shared/sync-types.js";
import { deviceInfo, company, product, pullResponse } from "./fixtures.js";

/** Soxta `/api/pos-device` serveri (fetch darajasida). */
function fakeApi() {
  const state = {
    token: "bumpos_test-token",
    online: true,
    pushed: [] as WireOperation[],
    pulls: 0,
    rejectTypes: [] as string[],
    analyticsQuery: null as Record<string, string> | null,
    update: { configured: false, available: false, mandatory: false, current: null, latest: null, url: null, sha256: null, notes: null } as Record<string, unknown>,
    installer: Buffer.alloc(0),
  };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    if (!state.online) throw new TypeError("fetch failed");
    const url = new URL(String(input));
    // Yangilanish o'rnatuvchisi — tashqi https manzil (token yuborilmaydi)
    if (url.hostname === "releases.test") return new Response(state.installer);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const authed = (init?.headers as Record<string, string>).authorization === `Bearer ${state.token}`;
    switch (url.pathname) {
      case "/api/pos-device/setup/options":
        return body.password === "right"
          ? json(200, { companies: [company], company, warehouses: [{ id: "w1", name: "Asosiy", code: "MAIN", isDefault: true }] })
          : json(401, { code: "UNAUTHENTICATED", message: "Telefon raqam yoki parol noto'g'ri" });
      case "/api/pos-device/setup/register": {
        // Serverdagi qat'iy sxema kabi: noma'lum maydon — 400
        const allowed = ["phone", "password", "companyId", "warehouseId", "name", "appVersion", "platform"];
        const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
        if (unknown.length > 0) return json(400, { code: "VALIDATION_ERROR", message: `Noma'lum maydon: ${unknown.join(", ")}` });
        return json(201, { token: state.token, device: { ...deviceInfo, isActive: true }, company });
      }
      case "/api/pos-device/cashiers/login":
        if (!authed) return json(401, { code: "UNAUTHENTICATED", message: "token" });
        return body.password === "kassir"
          ? json(200, { cashier: { id: "u1", name: "Ali", phone: "+998901112233", role: "Kassir", permissions: ["pos.use"] } })
          : json(401, { code: "UNAUTHENTICATED", message: "Telefon raqam yoki parol noto'g'ri" });
      case "/api/pos-device/pull":
        if (!authed) return json(401, { code: "UNAUTHENTICATED", message: "token" });
        state.pulls += 1;
        return json(200, pullResponse({ products: { rows: [product("p1", "Cola")], cursor: { t: "2026-09-12T10:00:00.000000Z", id: "p1" } } }));
      case "/api/pos-device/push": {
        if (!authed) return json(401, { code: "UNAUTHENTICATED", message: "token" });
        const ops = body.ops as WireOperation[];
        state.pushed.push(...ops);
        const results: PushResult[] = ops.map((op) =>
          state.rejectTypes.includes(op.type)
            ? { opId: op.opId, status: "rejected", error: { code: "BAD_REQUEST", message: "Sinov rad etishi" } }
            : { opId: op.opId, status: "applied", result: { shiftId: op.payload.shiftId } },
        );
        return json(200, { results });
      }
      case "/api/pos-device/movements":
        if (!authed) return json(401, { code: "UNAUTHENTICATED", message: "token" });
        return json(200, {
          movements: [
            {
              id: "m1",
              type: "transfer_out",
              productId: url.searchParams.get("productId") ?? "p1",
              productName: "Pepsi",
              productSku: "PEPSI",
              unitName: "dona",
              quantity: "-4.0000",
              costPrice: "3000.0000",
              referenceType: "stock_transfer",
              referenceId: null,
              documentNumber: "K01-T000001",
              notes: null,
              performedByName: "Ali",
              occurredAt: "2026-09-12T10:00:00.000Z",
            },
          ],
          nextCursor: "c1",
        });
      case "/api/pos-device/releases/r1/download":
        // Server bazasidagi reliz — faqat qurilma tokeni bilan
        if (!authed) return json(401, { code: "UNAUTHENTICATED", message: "token" });
        return new Response(state.installer);
      case "/api/pos-device/app-update":
        if (!authed) return json(401, { code: "UNAUTHENTICATED", message: "token" });
        return json(200, { update: state.update });
      case "/api/pos-device/analytics":
        if (!authed) return json(401, { code: "UNAUTHENTICATED", message: "token" });
        state.analyticsQuery = Object.fromEntries(url.searchParams.entries());
        return json(200, { period: { from: url.searchParams.get("from"), to: url.searchParams.get("to") }, scope: "Ombor: Asosiy", kpis: { revenue: "99.00" } });
      case "/api/pos-device/stock/p2":
        if (!authed) return json(401, { code: "UNAUTHENTICATED", message: "token" });
        return json(200, {
          stock: [
            { warehouseId: "w1", warehouseName: "Asosiy", warehouseCode: "MAIN", quantity: "5.0000", reservedQty: "0.0000" },
            { warehouseId: "w2", warehouseName: "Filial", warehouseCode: "F1", quantity: "4.0000", reservedQty: "0.0000" },
          ],
        });
      default:
        return json(404, { code: "NOT_FOUND", message: url.pathname });
    }
  }) as typeof fetch;
  return { state, fetchImpl };
}

let store: LocalStore;
let vault: TokenVault & { value: string | null };

beforeEach(() => {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  store = new LocalStore(db);
  vault = {
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
});

const service = (api: ReturnType<typeof fakeApi>) => new KassaService(store, vault, { appVersion: "0.1.0", platform: "win32", fetchImpl: api.fetchImpl });

describe("Kassa xizmati (main jarayon)", () => {
  it("ro'yxatdan o'tkazish: https talab, token saqlanadi, darhol sinxron", async () => {
    const api = fakeApi();
    const kassa = service(api);
    expect(kassa.status().registered).toBe(false);
    await expect(kassa.setupOptions({ apiUrl: "http://bum-erp.uz", phone: "+998900000001", password: "right" })).rejects.toBeInstanceOf(KassaError);
    await expect(kassa.setupOptions({ apiUrl: "https://bum-erp.uz", phone: "+998900000001", password: "wrong" })).rejects.toMatchObject({ status: 401 });

    const options = await kassa.setupOptions({ apiUrl: "https://bum-erp.uz", phone: "+998900000001", password: "right" });
    expect(options.warehouses[0]!.id).toBe("w1");
    const status = await kassa.register({ apiUrl: "https://bum-erp.uz/uz/login", phone: "+998900000001", password: "right", warehouseId: "w1", name: "Kassa 1" });
    expect(status).toMatchObject({ registered: true, apiUrl: "https://bum-erp.uz", device: { code: "K01" }, company: { name: "Bonnu" } });
    expect(vault.value).toBe(api.state.token);
    expect(api.state.pulls).toBe(1);
    expect(status.counts.products).toBe(1);

    // Qayta ishga tushganda token va manzil lokal bazadan
    expect(service(api).status().registered).toBe(true);
    await expect(kassa.register({ apiUrl: "https://bum-erp.uz", phone: "x", password: "right", warehouseId: "w1", name: "K" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("server manzili: sxemasiz — https qo'shiladi; sertifikat mos emas yoki domen topilmadi — aniq xabar", async () => {
    const api = fakeApi();
    const requested: string[] = [];
    const tracking = service({ ...api, fetchImpl: (async (input: URL | RequestInfo, init?: RequestInit) => {
      requested.push(String(input));
      return api.fetchImpl(input, init);
    }) as typeof fetch });
    await expect(tracking.setupOptions({ apiUrl: "  www.bum-erp.uz ", phone: "+998900000001", password: "right" })).resolves.toMatchObject({ warehouses: [{ id: "w1" }] });
    expect(requested).toEqual(["https://www.bum-erp.uz/api/pos-device/setup/options"]);
    await expect(tracking.setupOptions({ apiUrl: "kassa", phone: "+998900000001", password: "right" })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const failing = (code: string) =>
      new KassaService(store, vault, {
        appVersion: "0.1.0",
        platform: "win32",
        fetchImpl: (async () => {
          throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(code), { code }) });
        }) as typeof fetch,
      });
    await expect(failing("ERR_TLS_CERT_ALTNAME_INVALID").setupOptions({ apiUrl: "bum-erp.uz", phone: "+998900000001", password: "right" })).rejects.toMatchObject({
      name: "OfflineError",
      message: expect.stringContaining("sertifikati bu manzilga mos emas"),
    });
    await expect(failing("ENOTFOUND").setupOptions({ apiUrl: "bum-erp.uz", phone: "+998900000001", password: "right" })).rejects.toMatchObject({
      message: "Server topilmadi — manzilni tekshiring",
    });
    await expect(failing("ECONNRESET").setupOptions({ apiUrl: "bum-erp.uz", phone: "+998900000001", password: "right" })).rejects.toMatchObject({
      message: "Server bilan aloqa yo'q",
    });
  });

  it("kassir: birinchi kirish onlayn PIN bilan, keyin offline PIN; o'chirilgan kassir kira olmaydi; smena navbatga", async () => {
    const api = fakeApi();
    const kassa = service(api);
    await kassa.register({ apiUrl: "https://bum-erp.uz", phone: "+998900000001", password: "right", warehouseId: "w1", name: "Kassa 1" });

    await expect(kassa.firstLogin({ phone: "+998901112233", password: "kassir", pin: "12" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(kassa.firstLogin({ phone: "+998901112233", password: "xato", pin: "1234" })).rejects.toMatchObject({ status: 401 });
    expect((await kassa.firstLogin({ phone: "+998901112233", password: "kassir", pin: "1234" })).cashier).toMatchObject({ userId: "u1", name: "Ali" });
    expect(kassa.cashiers()).toEqual([expect.objectContaining({ userId: "u1", hasPin: true })]);

    // Offline: PIN bilan qayta kirish va smena
    kassa.logout();
    api.state.online = false;
    await expect(kassa.unlock({ userId: "u1", pin: "0000" })).rejects.toMatchObject({ code: "PIN_INVALID" });
    expect((await kassa.unlock({ userId: "u1", pin: "1234" })).cashier?.userId).toBe("u1");
    const opened = kassa.openShift({ openingCash: "50000" });
    expect(opened.shift).toMatchObject({ cashierId: "u1", openingCash: "50000" });
    expect(() => kassa.openShift({ openingCash: "1" })).toThrow(KassaError);
    const closed = kassa.closeShift({ closingCash: "50000" });
    expect(closed.shift).toBeNull();
    expect((await kassa.syncNow()).sync).toMatchObject({ state: "offline", pending: 2 });

    // Internet qaytdi — navbat tartibda yuboriladi
    api.state.online = true;
    expect((await kassa.syncNow()).sync).toMatchObject({ state: "idle", pending: 0 });
    expect(api.state.pushed.map((op) => op.type)).toEqual(["shift.open", "shift.close"]);
    expect(api.state.pushed[0]!.payload.shiftId).toBe(opened.shift!.id);

    // Server kassirni o'chirdi (pull'da active: false) — PIN bilan kira olmaydi
    kassa.logout();
    store.saveCashier({ id: "m1", userId: "u1", name: "Ali", phone: "+998901112233", role: "Kassir", permissions: ["pos.use"], active: false });
    await expect(kassa.unlock({ userId: "u1", pin: "1234" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(() => kassa.openShift({ openingCash: "1" })).toThrow(KassaError);
  });

  it("chek offline: K01 raqami, qoldiq kutilmoqda, qaytim, kechiktirish, qaytarish, rad etilganini qayta yuborish va bekor qilish", async () => {
    const api = fakeApi();
    const kassa = service(api);
    await kassa.register({ apiUrl: "https://bum-erp.uz", phone: "+998900000001", password: "right", warehouseId: "w1", name: "Kassa 1" });
    await kassa.firstLogin({ phone: "+998901112233", password: "kassir", pin: "1234" });
    const cashier = { id: "m1", userId: "u1", name: "Ali", phone: "+998901112233", role: "Kassir", active: true };
    store.saveCashier({ ...cashier, permissions: ["pos.use"] });
    store.applyPull(
      pullResponse({
        units: { rows: [{ id: "unit-d", name: "Dona", shortName: "dona", isBase: true, isActive: true }] },
        products: { rows: [product("p1", "Cola")] },
        stockLevels: { rows: [{ id: "s1", productId: "p1", warehouseId: "w1", quantity: "5.0000", reservedQty: "0.0000" }] },
      }),
    );

    api.state.online = false;
    kassa.openShift({ openingCash: "0" });
    const saleInput = (quantity: string, amountPaid: string | null, extra: Partial<Parameters<typeof kassa.completeSale>[0]> = {}) => ({
      customerId: null,
      lines: [{ productId: "p1", unitId: "unit-d", quantity }],
      saleCurrencies: [],
      paymentMethod: "cash" as const,
      amountPaid,
      cashbackAmount: null,
      balanceAmount: null,
      changeToBalance: false,
      currencyPayments: [],
      ...extra,
    });

    // Mijozsiz to'liq to'lanmagan chek va ruxsatsiz narx o'zgartirish — rad
    expect(() => kassa.completeSale(saleInput("2", "1000"))).toThrow("Mijozsiz sotuvda chek to'liq to'lanishi kerak");
    expect(() => kassa.completeSale({ ...saleInput("1", null), lines: [{ productId: "p1", unitId: "unit-d", quantity: "1", unitPrice: "5000" }] })).toThrow(
      "sales.edit",
    );

    const sale = kassa.completeSale(saleInput("2", "25000"));
    expect(sale).toMatchObject({ number: "K01-000001", total: "20000.00", paid: "20000.00", change: "5000.00", sync: { state: "pending" } });
    expect(kassa.products({ query: "cola" })[0]!.stock).toBe("3.0000");

    // Kechiktirish va qaytarib olish
    const held = kassa.hold({ cart: { customerId: null, lines: [{ productId: "p1", unitId: "unit-d", quantity: "1" }], saleCurrencies: [] } });
    expect(held.total).toBe("10000.00");
    expect(() => kassa.closeShift({ closingCash: "0" })).toThrow("Kechiktirilgan cheklar bor");
    expect(kassa.takeHeld({ id: held.id }).cart.lines).toHaveLength(1);
    expect(kassa.held()).toEqual([]);

    // Qaytarish: ruxsat, qolganidan ko'p emas, qoldiq qaytadi, smena yig'indisi
    await expect(kassa.returnItems({ number: "K01-000001", items: [{ orderItemId: sale.lines[0]!.id, quantity: "1" }], refundMethod: "cash" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    store.saveCashier({ ...cashier, permissions: ["pos.use", "sales.refund", "sales.approve"] });
    const returned = await kassa.returnItems({ number: "k01-000001", items: [{ orderItemId: sale.lines[0]!.id, quantity: "1" }], refundMethod: "cash" });
    expect(returned).toMatchObject({ number: "K01-Q000001", orderId: sale.id, total: "10000.00", refundEstimate: "10000.00" });
    expect((await kassa.findReceipt({ number: "K01-000001" })).lines[0]).toMatchObject({ quantity: "2", returned: "1.0000" });
    await expect(kassa.returnItems({ number: "K01-000001", items: [{ orderItemId: sale.lines[0]!.id, quantity: "2" }], refundMethod: "cash" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(kassa.products({ query: "cola" })[0]!.stock).toBe("4.0000");
    expect(kassa.status().shift!.totals).toEqual({ sales: "20000.00", cash: "10000.00", card: "0.00", returns: "10000.00", receipts: 1 });

    // Internet qaytdi: navbat tartibda, qoldiq farqi tozalanadi
    api.state.online = true;
    expect((await kassa.syncNow()).sync).toMatchObject({ state: "idle", pending: 0 });
    expect(api.state.pushed.map((op) => op.type)).toEqual(["shift.open", "sale.complete", "sale.return"]);
    expect(api.state.pushed[1]!.payload).toMatchObject({ saleId: sale.id, number: "K01-000001", amountPaid: "25000.00", items: [{ id: sale.lines[0]!.id, quantity: "2" }] });
    expect(kassa.products({ query: "cola" })[0]!.stock).toBe("5.0000");

    // Server rad etdi: qoldiq farqi olinadi; qayta yuborish qaytaradi; bekor qilish yakunlaydi
    api.state.rejectTypes = ["sale.complete"];
    const second = kassa.completeSale(saleInput("1", null));
    await kassa.syncNow();
    expect(kassa.unsynced()).toEqual([expect.objectContaining({ status: "rejected", number: second.number, total: "10000.00" })]);
    expect(kassa.products({ query: "cola" })[0]!.stock).toBe("5.0000");
    const [rejectedOp] = kassa.unsynced();
    kassa.retry({ opId: rejectedOp!.opId });
    expect(kassa.products({ query: "cola" })[0]!.stock).toBe("4.0000");
    await kassa.syncNow();
    kassa.discard({ opId: rejectedOp!.opId });
    expect(kassa.unsynced()).toEqual([]);
    expect(kassa.sales({}).find((row) => row.id === second.id)!.sync.state).toBe("discarded");
    expect(kassa.products({ query: "cola" })[0]!.stock).toBe("5.0000");
  });

  it("kassa bo'limi: kirim-chiqim, xarajat ruxsati, mijoz to'lovi (qarzdan ortig'i balansga), X/Z-hisobot, tarix, navbat tartibi", async () => {
    const api = fakeApi();
    const kassa = service(api);
    await kassa.register({ apiUrl: "https://bum-erp.uz", phone: "+998900000001", password: "right", warehouseId: "w1", name: "Kassa 1" });
    await kassa.firstLogin({ phone: "+998901112233", password: "kassir", pin: "1234" });
    const cashier = { id: "m1", userId: "u1", name: "Ali", phone: "+998901112233", role: "Kassir", active: true };
    store.saveCashier({ ...cashier, permissions: ["pos.use"] });
    store.applyPull(
      pullResponse({
        units: { rows: [{ id: "unit-d", name: "Dona", shortName: "dona", isBase: true, isActive: true }] },
        products: { rows: [product("p1", "Cola")] },
        stockLevels: { rows: [{ id: "s1", productId: "p1", warehouseId: "w1", quantity: "50.0000", reservedQty: "0.0000" }] },
        customers: {
          rows: [
            {
              id: "c1",
              name: "Vali",
              code: "C-0001",
              phone: "+998901234567",
              discountPercent: "0.00",
              creditLimit: "0.00",
              totalDebt: "15000.00",
              balance: "0.00",
              cashbackBalance: "0.00",
              isActive: true,
            },
          ],
        },
      }),
    );

    api.state.online = false;
    kassa.openShift({ openingCash: "10000" });
    const sale = (quantity: string, paymentMethod: "cash" | "card") =>
      kassa.completeSale({
        customerId: null,
        lines: [{ productId: "p1", unitId: "unit-d", quantity }],
        saleCurrencies: [],
        paymentMethod,
        amountPaid: null,
        cashbackAmount: null,
        balanceAmount: null,
        changeToBalance: false,
        currencyPayments: [],
      });
    sale("3", "cash");
    sale("1", "card");

    expect(() => kassa.cashMovement({ kind: "expense", amount: "1000" })).toThrow("pos.cash.expense");
    expect(() => kassa.cashMovement({ kind: "collection", amount: "0" })).toThrow("Summa noto'g'ri");
    kassa.cashMovement({ kind: "collection", amount: "25000", notes: "Seyfga" });
    kassa.cashMovement({ kind: "change_fund", amount: "5000" });
    store.saveCashier({ ...cashier, permissions: ["pos.use", "pos.cash.expense"] });
    expect(kassa.cashMovement({ kind: "expense", amount: "2000", category: "suv" })).toMatchObject({ type: "out", category: "suv", sync: { state: "pending" } });
    expect(kassa.cashMovements()).toHaveLength(3);

    // Qarz 15000, to'lov 20000 → qarz 0, balans 5000 (server ham ortig'ini balansga yozadi)
    expect(kassa.customerPayment({ customerId: "c1", purpose: "debt", amount: "20000", method: "cash" }).customerAfter).toEqual({ totalDebt: "0.00", balance: "5000.00" });
    expect(kassa.customers({ query: "vali" })[0]).toMatchObject({ totalDebt: "0.00", balance: "5000.00" });
    expect(kassa.customerPayments()).toHaveLength(1);

    // Naqd: 10000 + 30000 + 20000 − 25000 + 5000 − 2000 = 38000
    const report = kassa.shiftReport({});
    expect(report).toMatchObject({ receipts: 2, salesTotal: "40000.00", cashIn: "5000.00", cashOut: "27000.00", expectedCash: "38000.00", difference: null, unsynced: 6 });
    expect(report.byMethod).toEqual(
      expect.arrayContaining([
        { key: "cash", label: "Naqd", amount: "30000.00" },
        { key: "card", label: "Karta", amount: "10000.00" },
      ]),
    );
    expect(report.customerPayments).toMatchObject({ count: 1, debtCash: "20000.00" });
    expect(report.cashMovements).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "collection", count: 1, amount: "25000.00" })]));
    expect(kassa.status().shift!.totals).toMatchObject({ cash: "50000.00", card: "10000.00", cashIn: "5000.00", cashOut: "27000.00" });

    // Smena yopildi: Z-hisobot tarixda, farq sanalgan naqd bilan
    kassa.closeShift({ closingCash: "37500" });
    const [closed] = kassa.shiftHistory({});
    expect(closed).toMatchObject({ receipts: 2, expectedCash: "38000.00", difference: "-500.00", shift: { closingCash: "37500.00" } });
    expect(kassa.shiftReport({ shiftId: closed!.shift.id }).shift.closedAt).not.toBeNull();
    expect(() => kassa.shiftReport({})).toThrow("Ochiq smena yo'q");

    // Tarix: sana oralig'i; server tarixi internet talab qiladi
    expect(kassa.historySales({ from: new Date(Date.now() - 3_600_000).toISOString() })).toHaveLength(2);
    expect(kassa.historySales({ from: new Date(Date.now() + 3_600_000).toISOString() })).toEqual([]);
    expect(() => kassa.historySales({ from: "kecha" })).toThrow("Sana noto'g'ri");
    await expect(kassa.historyServer({})).rejects.toMatchObject({ code: "OFFLINE" });

    api.state.online = true;
    expect((await kassa.syncNow()).sync).toMatchObject({ state: "idle", pending: 0 });
    expect(api.state.pushed.map((op) => op.type)).toEqual([
      "shift.open",
      "sale.complete",
      "sale.complete",
      "cash.movement",
      "cash.movement",
      "cash.movement",
      "customer.payment",
      "shift.close",
    ]);
  });

  it("xarid bo'limi: ta'minotchi (offline), xarid va qoldiq, darhol to'lov smenadan, qaytarish va qaytgan pul, ta'minotchiga to'lov, X-hisobot", async () => {
    const api = fakeApi();
    const kassa = service(api);
    await kassa.register({ apiUrl: "https://bum-erp.uz", phone: "+998900000001", password: "right", warehouseId: "w1", name: "Kassa 1" });
    await kassa.firstLogin({ phone: "+998901112233", password: "kassir", pin: "1234" });
    const cashier = { id: "m1", userId: "u1", name: "Ali", phone: "+998901112233", role: "Kassir", active: true };
    store.saveCashier({ ...cashier, permissions: ["pos.use"] });
    store.applyPull(
      pullResponse({
        units: { rows: [{ id: "unit-d", name: "Dona", shortName: "dona", isBase: true, isActive: true }] },
        products: { rows: [product("p1", "Cola", { isPurchaseable: true, purchasePrice: "7000.0000", purchaseCurrency: null })] },
        stockLevels: { rows: [{ id: "s1", productId: "p1", warehouseId: "w1", quantity: "2.0000", reservedQty: "0.0000" }] },
        currencies: { rows: [{ id: "cur1", code: "USD", rate: "12500.0000", rateDate: "2026-09-12", isActive: true }] },
      }),
    );

    api.state.online = false;
    kassa.openShift({ openingCash: "100000" });
    expect(() => kassa.createSupplier({ name: "Olma" })).toThrow("purchase.create");
    store.saveCashier({ ...cashier, permissions: ["pos.use", "purchase.create", "warehouse.receive"] });
    const supplier = kassa.createSupplier({ name: "Olma savdo", phone: "+998901112233" });
    expect(kassa.suppliers({ query: "olma" })[0]).toMatchObject({ id: supplier.id, pending: true, totalDebt: "0.00" });

    const input = (payment: { amount: string; method: "cash" | "card" } | null) => ({
      supplierId: supplier.id,
      lines: [
        { productId: "p1", unitId: "unit-d", quantity: "10", unitPrice: "7000", salesPrice: "9000" },
        { productId: "p1", unitId: "unit-d", quantity: "1", unitPrice: "2", currency: "USD" },
      ],
      notes: "Faktura 15",
      payment,
    });
    expect(() => kassa.completePurchase(input({ amount: "50000", method: "cash" }))).toThrow("purchase.approve");
    store.saveCashier({ ...cashier, permissions: ["pos.use", "purchase.create", "warehouse.receive", "purchase.approve", "purchase.return"] });
    expect(() => kassa.completePurchase(input({ amount: "80000", method: "cash" }))).toThrow("UZS dagi qatorlar summasidan oshmasin");

    // 10 × 7000 + 2 USD × 12500 = 95000
    const purchase = kassa.completePurchase(input({ amount: "50000", method: "cash" }));
    expect(purchase).toMatchObject({ number: "K01-P000001", total: "95000.00", payment: { amount: "50000.00", method: "cash" }, sync: { state: "pending" } });
    expect(purchase.currencyTotals).toEqual([
      { currency: "UZS", total: "70000.00" },
      { currency: "USD", total: "2.00" },
    ]);
    expect(kassa.purchaseProducts({ query: "cola" })[0]).toMatchObject({ stock: "13.0000", purchasePrice: "7000.0000" });
    expect(kassa.suppliers({ query: "olma" })[0]!.totalDebt).toBe("45000.00");

    // Qaytarish: 2 dona, ta'minotchi 5000 naqd qaytardi
    const returned = await kassa.returnPurchase({
      number: "k01-p000001",
      items: [{ orderItemId: purchase.lines[0]!.id, quantity: "2" }],
      refund: { amount: "5000", method: "cash" },
      reason: "Siniq",
    });
    expect(returned).toMatchObject({ number: "K01-R000001", total: "14000.00", refund: { amount: "5000.00", method: "cash" } });
    expect((await kassa.findPurchase({ number: "K01-P000001" })).lines[0]).toMatchObject({ quantity: "10", returned: "2.0000" });
    await expect(
      kassa.returnPurchase({ number: "K01-P000001", items: [{ orderItemId: purchase.lines[0]!.id, quantity: "9" }], refund: null }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(kassa.purchaseProducts({ query: "cola" })[0]!.stock).toBe("11.0000");
    expect(kassa.suppliers({ query: "olma" })[0]!.totalDebt).toBe("36000.00");

    expect(kassa.supplierPayment({ supplierId: supplier.id, amount: "6000", method: "cash" }).supplierDebtAfter).toBe("30000.00");

    // Kutilgan naqd: 100000 − 50000 + 5000 − 6000 = 49000
    expect(kassa.shiftReport({})).toMatchObject({
      expectedCash: "49000.00",
      suppliers: { payments: 2, paidCash: "56000.00", paidCard: "0.00", refunds: 1, refundCash: "5000.00" },
    });
    expect(kassa.purchases({})).toHaveLength(1);
    expect(kassa.purchaseReturns({})).toHaveLength(1);

    api.state.online = true;
    await kassa.syncNow();
    expect(api.state.pushed.map((op) => op.type)).toEqual(["shift.open", "supplier.create", "purchase.complete", "purchase.return", "supplier.payment"]);
    expect(api.state.pushed[2]!.payload).toMatchObject({
      number: "K01-P000001",
      supplierId: supplier.id,
      rates: { USD: "12500.0000" },
      payment: { amount: "50000.00", method: "cash" },
    });
  });

  it("ma'lumotlar: jismoniy/yuridik mijoz va ta'minotchi, offline tahrir faqat o'zgargan maydonlar bilan, narxlar va ruxsatlar", async () => {
    const api = fakeApi();
    const kassa = service(api);
    await kassa.register({ apiUrl: "https://bum-erp.uz", phone: "+998900000001", password: "right", warehouseId: "w1", name: "Kassa 1" });
    await kassa.firstLogin({ phone: "+998901112233", password: "kassir", pin: "1234" });
    const cashier = { id: "m1", userId: "u1", name: "Ali", phone: "+998901112233", role: "Kassir", active: true };
    store.saveCashier({ ...cashier, permissions: ["pos.use"] });
    api.state.online = false;
    store.applyPull(
      pullResponse({
        units: { rows: [{ id: "unit-d", name: "Dona", shortName: "dona", isBase: true, isActive: true }] },
        products: { rows: [product("p1", "Cola", { purchasePrice: "7000.0000", purchaseCurrency: null, wholesalePrice: null, retailPrice: "10500.0000" })] },
        customers: {
          rows: [
            {
              id: "c1",
              name: "Vali",
              code: "C-0001",
              phone: "+998901234567",
              discountPercent: "0.00",
              creditLimit: "0.00",
              totalDebt: "0.00",
              balance: "0.00",
              cashbackBalance: "0.00",
              isActive: true,
            },
          ],
        },
        suppliers: { rows: [{ id: "s1", name: "Olma savdo", code: "S-0001", phone: null, currency: "UZS", totalDebt: "0.00", isActive: true, partyType: "legal", taxId: "301234567" }] },
      }),
    );

    // Yangi yuridik mijoz (offline): rekvizitlar, format tekshiruvi
    expect(() => kassa.createCustomer({ name: "MChJ Rizo", partyType: "legal", email: "rizo" })).toThrow("Email noto'g'ri");
    const legal = kassa.createCustomer({ name: "MChJ Rizo", partyType: "legal", taxId: "302345678", bankAccount: "20208000900123456001", bankMfo: "00873", phone: "" });
    expect(legal).toMatchObject({ partyType: "legal", taxId: "302345678", bankMfo: "00873", phone: null, pending: true });
    expect(kassa.referenceCustomers({ query: "", partyType: "legal" }).map((row) => row.id)).toEqual([legal.id]);
    expect(kassa.referenceCustomers({ query: "", partyType: "individual" }).map((row) => row.id)).toEqual(["c1"]);

    // Tahrir: ruxsat; faqat o'zgargan maydonlar; o'zgarish yo'q — navbatga tushmaydi
    expect(() => kassa.updateCustomer({ customerId: "c1", phone: "+998901234599" })).toThrow("crm.manage");
    store.saveCashier({ ...cashier, permissions: ["pos.use", "crm.manage", "purchase.view", "purchase.edit", "products.view", "products.edit"] });
    expect(kassa.updateCustomer({ customerId: "c1", name: "Vali", phone: "+998901234599", address: "Chilonzor" })).toMatchObject({ phone: "+998901234599", address: "Chilonzor" });
    kassa.updateCustomer({ customerId: "c1", name: "Vali", phone: "+998901234599" });
    expect(kassa.referenceSuppliers({ query: "olma" })[0]).toMatchObject({ partyType: "legal", taxId: "301234567" });
    expect(kassa.updateSupplier({ supplierId: "s1", partyType: "legal", taxId: "301234567", bankMfo: "00444" })).toMatchObject({ bankMfo: "00444" });

    // Narxlar: xarid narxi ruxsat bilan ko'rinadi, faqat o'zgarganlari; sotuv narxi majburiy; kassada darhol
    expect(kassa.priceList({ query: "cola" })[0]).toMatchObject({ salesPrice: "10000.0000", retailPrice: "10500.0000", wholesalePrice: null, purchasePrice: "7000.0000", pending: false });
    expect(() => kassa.updatePrices({ productId: "p1", salesPrice: "" })).toThrow("Sotuv narxi kiritilishi shart");
    const priced = kassa.updatePrices({ productId: "p1", salesPrice: "12000", wholesalePrice: "11000", retailPrice: "10500", purchasePrice: "7000" });
    expect(priced).toMatchObject({ salesPrice: "12000.0000", wholesalePrice: "11000.0000", pending: true });
    expect(Number(kassa.products({ query: "cola" })[0]!.price)).toBe(12000);

    expect(kassa.unsynced().map((op) => [op.type, op.label])).toEqual([
      ["customer.create", "MChJ Rizo"],
      ["customer.update", "Vali"],
      ["supplier.update", "Olma savdo"],
      ["product.prices", "Cola"],
    ]);

    api.state.online = true;
    await kassa.syncNow();
    expect(api.state.pushed.map((op) => op.type)).toEqual(["customer.create", "customer.update", "supplier.update", "product.prices"]);
    expect(api.state.pushed[0]!.payload).toEqual({ customerId: legal.id, name: "MChJ Rizo", phone: null, taxId: "302345678", bankAccount: "20208000900123456001", bankMfo: "00873", partyType: "legal" });
    expect(api.state.pushed[1]!.payload).toEqual({
      customerId: "c1",
      changes: { phone: { from: "+998901234567", to: "+998901234599" }, address: { from: null, to: "Chilonzor" } },
    });
    expect(api.state.pushed[2]!.payload).toEqual({ supplierId: "s1", changes: { bankMfo: { from: null, to: "00444" } } });
    expect(api.state.pushed[3]!.payload).toEqual({
      productId: "p1",
      changes: { salesPrice: { from: "10000.0000", to: "12000.0000" }, wholesalePrice: { from: null, to: "11000.0000" } },
    });
  });

  it("sozlamalar: qurilma sozlamalari tekshiruvi, o'chirilgan to'lov usuli, qoldiqsiz sotuv taqiqi, PIN almashtirish, umumiy ma'lumot, yangilanish (SHA-256) va o'rnatish", async () => {
    const api = fakeApi();
    const installed: string[] = [];
    const kassa = new KassaService(store, vault, {
      appVersion: "0.1.0",
      platform: "win32",
      fetchImpl: api.fetchImpl,
      updater: {
        install: async (file) => {
          installed.push(file);
        },
      },
      downloadDir: tmpdir(),
    });
    await kassa.register({ apiUrl: "https://bum-erp.uz", phone: "+998900000001", password: "right", warehouseId: "w1", name: "Kassa 1" });
    await kassa.firstLogin({ phone: "+998901112233", password: "kassir", pin: "1234" });
    api.state.online = false;
    store.applyPull(
      pullResponse({
        units: { rows: [{ id: "unit-d", name: "Dona", shortName: "dona", isBase: true, isActive: true }] },
        products: { rows: [product("p1", "Cola")] },
        stockLevels: { rows: [{ id: "s1", productId: "p1", warehouseId: "w1", quantity: "2.0000", reservedQty: "0.0000" }] },
      }),
    );

    // Standart sozlamalar va tekshiruv
    expect(kassa.prefs()).toMatchObject({ theme: "light", language: "uz-Latn", syncIntervalSec: 30, autoLockMinutes: 0, hotkeys: { complete: "F12" }, enabledPaymentMethods: ["cash", "card", "bank", "transfer"] });
    expect(() => kassa.savePrefs({ ...kassa.prefs(), enabledPaymentMethods: [] })).toThrow("Kamida bitta");
    expect(() => kassa.savePrefs({ ...kassa.prefs(), hotkeys: { ...kassa.prefs().hotkeys, help: "F12" } })).toThrow("Tugma takrorlangan: F12");
    expect(() => kassa.savePrefs({ ...kassa.prefs(), hotkeys: { ...kassa.prefs().hotkeys, help: "Q" } })).toThrow("Tugma noto'g'ri");
    const saved = kassa.savePrefs({
      ...kassa.prefs(),
      enabledPaymentMethods: ["cash"],
      defaultPaymentMethod: "card",
      syncIntervalSec: 5,
      autoLockMinutes: 999,
      theme: "dark",
      language: "uz-Cyrl",
      blockNegativeStock: true,
      hotkeys: { ...kassa.prefs().hotkeys, help: "Ctrl+H" },
    });
    expect(saved).toMatchObject({ enabledPaymentMethods: ["cash"], defaultPaymentMethod: "cash", syncIntervalSec: 10, autoLockMinutes: 240, theme: "dark", language: "uz-Cyrl", blockNegativeStock: true, hotkeys: { help: "Ctrl+H", complete: "F12" } });
    expect(kassa.prefs()).toEqual(saved);

    // O'chirilgan usul va qoldiqsiz sotuv taqiqi
    kassa.openShift({ openingCash: "0" });
    const sale = (quantity: string, paymentMethod: "cash" | "card") =>
      kassa.completeSale({ customerId: null, lines: [{ productId: "p1", unitId: "unit-d", quantity }], saleCurrencies: [], paymentMethod, amountPaid: null, cashbackAmount: null, balanceAmount: null, changeToBalance: false, currencyPayments: [] });
    expect(() => sale("1", "card")).toThrow("o'chirilgan");
    expect(() => sale("3", "cash")).toThrow("qoldiq yetmaydi (bor 2.0000)");
    expect(sale("2", "cash").number).toBe("K01-000001");
    expect(() => sale("1", "cash")).toThrow("bor 0.0000");

    // PIN almashtirish
    await expect(kassa.changePin({ oldPin: "1234", newPin: "12" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(kassa.changePin({ oldPin: "0000", newPin: "5678" })).rejects.toMatchObject({ code: "PIN_INVALID" });
    await kassa.changePin({ oldPin: "1234", newPin: "5678" });
    kassa.logout();
    await expect(kassa.unlock({ userId: "u1", pin: "1234" })).rejects.toMatchObject({ code: "PIN_INVALID" });
    expect((await kassa.unlock({ userId: "u1", pin: "5678" })).cashier?.userId).toBe("u1");

    expect(kassa.settingsOverview()).toMatchObject({
      appVersion: "0.1.0",
      apiUrl: "https://bum-erp.uz",
      device: { code: "K01" },
      baseCurrency: "UZS",
      permissions: ["pos.use"],
      cashiers: [expect.objectContaining({ userId: "u1", hasPin: true })],
      sync: { pending: 2 },
    });

    // Yangilanish: sozlanmagan; SHA-256 mos emas — saqlanmaydi; mos — yuklanadi va o'rnatuvchi ishga tushadi
    api.state.online = true;
    await expect(kassa.checkUpdate()).resolves.toMatchObject({ configured: false, available: false, current: "0.1.0", downloaded: false });
    const bytes = Buffer.from("BUM POS KASSA setup");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    api.state.installer = bytes;
    api.state.update = { configured: true, available: true, mandatory: false, current: "0.1.0", latest: "0.2.0", url: "https://releases.test/setup.exe", sha256: "0".repeat(64), notes: "Yangi" };
    await expect(kassa.downloadUpdate()).rejects.toMatchObject({ code: "CHECKSUM_MISMATCH" });
    await expect(kassa.installUpdate()).rejects.toMatchObject({ code: "CONFLICT" });
    api.state.update = { ...api.state.update, sha256 };
    const file = path.join(tmpdir(), "BUM-POS-KASSA-Setup-0.2.0.exe");
    try {
      await expect(kassa.downloadUpdate()).resolves.toMatchObject({ available: true, latest: "0.2.0", notes: "Yangi", downloaded: true });
      await expect(kassa.checkUpdate()).resolves.toMatchObject({ downloaded: true });
      await kassa.installUpdate();
      expect(installed).toEqual([file]);
    } finally {
      await rm(file, { force: true });
    }
    // Nisbiy manzil (server bazasidagi reliz) — API manzilidan, qurilma tokeni bilan
    const nextBytes = Buffer.from("BUM POS KASSA setup 0.3.0");
    api.state.installer = nextBytes;
    api.state.update = { ...api.state.update, latest: "0.3.0", url: "/api/pos-device/releases/r1/download", sha256: createHash("sha256").update(nextBytes).digest("hex") };
    const nextFile = path.join(tmpdir(), "BUM-POS-KASSA-Setup-0.3.0.exe");
    try {
      await expect(kassa.downloadUpdate()).resolves.toMatchObject({ latest: "0.3.0", downloaded: true });
    } finally {
      await rm(nextFile, { force: true });
    }
    await expect(kassa.installUpdate()).rejects.toMatchObject({ code: "CHECKSUM_MISMATCH" });
  });

  it("analitika: offline — shu kassa hujjatlaridan (tushum, qaytarish, taxminiy foyda, to'lov turlari, qarzdorlik, mahsulot va kategoriya); onlayn — serverdan", async () => {
    const api = fakeApi();
    const kassa = service(api);
    await kassa.register({ apiUrl: "https://bum-erp.uz", phone: "+998900000001", password: "right", warehouseId: "w1", name: "Kassa 1" });
    await kassa.firstLogin({ phone: "+998901112233", password: "kassir", pin: "1234" });
    const cashier = { id: "m1", userId: "u1", name: "Ali", phone: "+998901112233", role: "Kassir", active: true };
    store.saveCashier({ ...cashier, permissions: ["pos.use", "sales.refund"] });
    api.state.online = false;
    const party = (id: string, name: string, extra: Record<string, unknown>) => ({ id, name, code: null, phone: null, isActive: true, discountPercent: "0.00", creditLimit: "0.00", balance: "0.00", cashbackBalance: "0.00", totalDebt: "0.00", ...extra });
    store.applyPull(
      pullResponse({
        units: { rows: [{ id: "unit-d", name: "Dona", shortName: "dona", isBase: true, isActive: true }] },
        categories: { rows: [{ id: "cat1", name: "Ichimliklar", parentId: null, sortOrder: 0, isActive: true }] },
        products: { rows: [product("p1", "Cola", { categoryId: "cat1" }), product("p2", "Choy")] },
        stockLevels: {
          rows: [
            { id: "s1", productId: "p1", warehouseId: "w1", quantity: "10.0000", reservedQty: "0.0000", avgCostPrice: "6000.0000" },
            { id: "s2", productId: "p2", warehouseId: "w1", quantity: "5.0000", reservedQty: "0.0000", avgCostPrice: "2000.0000" },
          ],
        },
        customers: { rows: [party("c1", "Vali", { totalDebt: "15000.00" }), party("c2", "Hasan", { balance: "3000.00" })] },
        suppliers: { rows: [party("s1", "Olma", { totalDebt: "20000.00", currency: "UZS" }), party("s2", "Nok", { totalDebt: "-5000.00", currency: "UZS" })] },
      }),
    );
    const at = new Date();
    const today = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;

    kassa.openShift({ openingCash: "0" });
    const sale = (quantity: string, paymentMethod: "cash" | "card") =>
      kassa.completeSale({
        customerId: null,
        lines: [{ productId: "p1", unitId: "unit-d", quantity }],
        saleCurrencies: [],
        paymentMethod,
        amountPaid: null,
        cashbackAmount: null,
        balanceAmount: null,
        changeToBalance: false,
        currencyPayments: [],
      });
    const first = sale("3", "cash");
    sale("1", "card");
    await kassa.returnItems({ number: first.number, items: [{ orderItemId: first.lines[0]!.id, quantity: "1" }], refundMethod: "cash" });

    await expect(kassa.analyticsReport({ from: today, to: today })).rejects.toMatchObject({ code: "FORBIDDEN" });
    store.saveCashier({ ...cashier, permissions: ["pos.use", "sales.refund", "analytics.view"] });
    await expect(kassa.analyticsReport({ from: today, to: "2020-01-01" })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // 4 × 10000 = 40000, qaytarish 10000; tannarx (4 − 1) × 6000 = 18000
    const report = await kassa.analyticsReport({ from: today, to: today });
    expect(report).toMatchObject({
      source: "local",
      kpis: { revenue: "40000.00", returns: "10000.00", netRevenue: "30000.00", cogs: "18000.00", grossProfit: "12000.00", margin: "40.00", receipts: 2, averageReceipt: "15000.00", itemsSold: "3.0000", customers: 2 },
      receivables: { total: "15000.00", count: 1 },
      customerBalances: { total: "3000.00", count: 1 },
      payables: { total: "20000.00", count: 1, top: [expect.objectContaining({ name: "Olma" })] },
      supplierAdvances: { total: "5000.00", count: 1 },
    });
    expect(report.kpis.stockValue).toBe("52000.00");
    expect(report.payments).toEqual([
      { key: "cash", label: "Naqd", amount: "30000.00" },
      { key: "card", label: "Karta", amount: "10000.00" },
    ]);
    expect(report.cashFlow).toMatchObject({ totalIncome: "40000.00", totalExpense: "10000.00", net: "30000.00" });
    expect(report.daily).toEqual([{ date: today, revenue: "40000.00", returns: "10000.00", profit: "12000.00", receipts: 2 }]);
    expect(report.products.top).toEqual([{ productId: "p1", name: "Cola", sku: "COLA", quantity: "3.0000", revenue: "30000.00", cogs: "18000.00", profit: "12000.00" }]);
    expect(report.products.slow.map((row) => row.productId)).toEqual(["p2"]);
    expect(report.categories.find((row) => row.categoryId === "cat1")).toMatchObject({ name: "Ichimliklar", revenue: "30000.00", profit: "12000.00" });
    expect(report.categories.find((row) => row.categoryId === null)).toMatchObject({ name: "Kategoriyasiz", stockValue: "10000.00" });

    // Onlayn — serverdan, kassir identifikatori bilan; majburan faqat shu kassa
    api.state.online = true;
    expect(await kassa.analyticsReport({ from: today, to: today })).toMatchObject({ source: "server", kpis: { revenue: "99.00" } });
    expect(api.state.analyticsQuery).toEqual({ from: today, to: today, cashierId: "u1" });
    expect((await kassa.analyticsReport({ from: today, to: today, source: "local" })).source).toBe("local");
  });

  it("etiketka: kontekstda shablonlar, mahsulotlar ID bo'yicha, etiketka printeri sozlamasi, o'lcham tekshiruvi va chop etish", async () => {
    const api = fakeApi();
    const kassa = service(api);
    await kassa.register({ apiUrl: "https://bum-erp.uz", phone: "+998900000001", password: "right", warehouseId: "w1", name: "Kassa 1" });
    await kassa.firstLogin({ phone: "+998901112233", password: "kassir", pin: "1234" });
    api.state.online = false;
    store.applyPull(pullResponse({ products: { rows: [product("p1", "Cola"), product("p2", "Pepsi", { isActive: false })] } }));

    // Sozlama kelmagan — null (renderer standart shablonni oladi); pull'dagi config bilan — shablonlar
    expect(kassa.posContext().labels).toBeNull();
    store.setMeta("config", {
      hash: "h1",
      company: { name: "Bonnu", address: null, phone: null, taxId: null, currency: "UZS" },
      cashback: { enabled: false, accrualBase: "paid", maxUsagePercent: 0, tiers: [], categoryRates: [] },
      receipt: {},
      labels: { defaultTemplateId: "t1", templates: [{ id: "t1", name: "58×40", layout: "roll", widthMm: 58, heightMm: 40 }] },
    });
    expect(kassa.posContext().labels).toMatchObject({ defaultTemplateId: "t1" });

    // Faol emas va noma'lum — tashlab ketiladi, takror — bir marta
    expect(kassa.productsByIds({ ids: ["p2", "p1", "p1", "missing"] }).map((row) => row.id)).toEqual(["p1"]);
    expect(kassa.savePrefs({ ...kassa.prefs(), labelPrinterName: "Xprinter 365B" }).labelPrinterName).toBe("Xprinter 365B");
    await expect(kassa.printLabels({ html: "<p>x</p>", layout: "roll", widthMm: 5, heightMm: 40 })).rejects.toThrow("o'lchami");
    await expect(kassa.printLabels({ html: "<p>x</p>", layout: "roll", widthMm: 58, heightMm: 40 })).rejects.toMatchObject({ code: "UNAVAILABLE" });

    const printed: unknown[] = [];
    const withPrinter = new KassaService(store, vault, {
      appVersion: "0.1.0",
      platform: "win32",
      fetchImpl: api.fetchImpl,
      printer: {
        list: async () => [],
        print: async () => undefined,
        printLabels: async (_html, options) => {
          printed.push(options);
        },
      },
    });
    await withPrinter.unlock({ userId: "u1", pin: "1234" });
    await withPrinter.printLabels({ html: "<p>x</p>", layout: "a4", widthMm: 58, heightMm: 40 });
    expect(printed).toEqual([{ printerName: "Xprinter 365B", layout: "a4", widthMm: 58, heightMm: 40 }]);
  });

  it("ombor bo'limi: qoldiqlar va qiymat, hisobdan chiqarish, ko'chirish, inventarizatsiya qoralamasi va farq, harakatlar, navbat", async () => {
    const api = fakeApi();
    const kassa = service(api);
    await kassa.register({ apiUrl: "https://bum-erp.uz", phone: "+998900000001", password: "right", warehouseId: "w1", name: "Kassa 1" });
    await kassa.firstLogin({ phone: "+998901112233", password: "kassir", pin: "1234" });
    const cashier = { id: "m1", userId: "u1", name: "Ali", phone: "+998901112233", role: "Kassir", active: true };
    store.saveCashier({ ...cashier, permissions: ["pos.use"] });
    api.state.online = false;
    store.applyPull(
      pullResponse({
        units: { rows: [{ id: "unit-d", name: "Dona", shortName: "dona", isBase: true, isActive: true }] },
        products: { rows: [product("p1", "Cola", { minStock: "5.0000" }), product("p2", "Pepsi", { isSaleable: false }), product("p3", "Fanta")] },
        stockLevels: {
          rows: [
            { id: "s1", productId: "p1", warehouseId: "w1", quantity: "4.0000", reservedQty: "0.0000", avgCostPrice: "7000.0000" },
            { id: "s2", productId: "p2", warehouseId: "w1", quantity: "10.0000", reservedQty: "0.0000", avgCostPrice: "3000.0000" },
          ],
        },
        warehouses: {
          rows: [
            { id: "w1", name: "Asosiy", code: "MAIN", isDefault: true, isActive: true },
            { id: "w2", name: "Filial", code: "F1", isDefault: false, isActive: true },
            { id: "w3", name: "Yopilgan", code: "X", isDefault: false, isActive: false },
          ],
        },
      }),
    );

    // Ruxsatsiz — yo'q; ko'rish ruxsati bilan tannarx ko'rinmaydi
    expect(() => kassa.stockList({ query: "" })).toThrow("warehouse.view");
    store.saveCashier({ ...cashier, permissions: ["pos.use", "warehouse.view"] });
    const list = kassa.stockList({ query: "" });
    expect(list.summary).toEqual({ products: 3, positive: 2, low: 1, zero: 1, negative: 0, totalValue: null });
    expect(list.rows.find((row) => row.productId === "p1")).toMatchObject({ quantity: "4.0000", isLow: true, avgCost: null, value: null });
    expect(kassa.stockList({ query: "", filter: "zero" }).rows.map((row) => row.productId)).toEqual(["p3"]);
    expect(kassa.stockWarehouses()).toEqual([{ id: "w2", name: "Filial", code: "F1" }]);
    expect(kassa.stockProductByCode({ code: "PEPSI" })?.id).toBe("p2");
    expect(() => kassa.writeOff({ lines: [{ productId: "p1", quantity: "1" }], reason: "Singan" })).toThrow("warehouse.manage");

    store.saveCashier({ ...cashier, permissions: ["pos.use", "warehouse.view", "warehouse.manage", "warehouse.transfer", "warehouse.count"] });
    // 4 × 7000 + 10 × 3000
    expect(kassa.stockList({ query: "" }).summary.totalValue).toBe("58000.00");

    // Hisobdan chiqarish qoldiqdan ko'p — yoziladi (qoldiq manfiy ko'rinadi)
    const writeoff = kassa.writeOff({ lines: [{ productId: "p1", quantity: "6" }], reason: "Singan" });
    expect(writeoff).toMatchObject({ number: "K01-W000001", kind: "writeoff", value: "42000.00", notes: "Singan", sync: { state: "pending" } });
    expect(kassa.stockList({ query: "cola" }).rows[0]).toMatchObject({ quantity: "-2.0000", pending: "-6.0000" });

    expect(() => kassa.transfer({ toWarehouseId: "w3", lines: [{ productId: "p2", quantity: "1" }] })).toThrow("Qabul qiluvchi ombor topilmadi");
    expect(() =>
      kassa.transfer({
        toWarehouseId: "w2",
        lines: [
          { productId: "p2", quantity: "1" },
          { productId: "p2", quantity: "2" },
        ],
      }),
    ).toThrow("takrorlangan");
    const transfer = kassa.transfer({ toWarehouseId: "w2", lines: [{ productId: "p2", quantity: "4" }], notes: "Filialga" });
    expect(transfer).toMatchObject({ number: "K01-T000001", toWarehouse: { id: "w2", name: "Filial" }, value: "12000.00" });

    // Inventarizatsiya: skaner +1, qo'lda qiymat, olib tashlash; kutilgan qoldiq — ko'rinadigan
    kassa.countSet({ productId: "p2", counted: "1", mode: "add" });
    kassa.countSet({ productId: "p2", counted: "1", mode: "add" });
    expect(kassa.countDraft()!.lines).toEqual([expect.objectContaining({ productId: "p2", counted: "2.0000", expected: "6.0000", difference: "-4.0000" })]);
    kassa.countSet({ productId: "p3", counted: "3", mode: "set" });
    expect(kassa.countRemove({ productId: "p3" })!.lines).toHaveLength(1);
    kassa.countSet({ productId: "p2", counted: "5", mode: "set" });
    expect(() => kassa.countSet({ productId: "p2", counted: "0", mode: "add" })).toThrow("miqdor noto'g'ri");

    // To'liq inventarizatsiya: sanalmagan Cola (−2) → 0; qiymat: +2 × 7000 − 1 × 3000
    const count = kassa.countComplete({ notes: "Oylik", zeroMissing: true });
    expect(count).toMatchObject({ number: "K01-I000001", kind: "count", value: "11000.00", notes: "Oylik" });
    expect(count.lines).toEqual([
      expect.objectContaining({ productId: "p1", quantity: "0.0000", expected: "-2.0000", difference: "2.0000" }),
      expect.objectContaining({ productId: "p2", quantity: "5.0000", expected: "6.0000", difference: "-1.0000" }),
    ]);
    expect(kassa.countDraft()).toBeNull();
    expect(() => kassa.countComplete({})).toThrow("Sanalgan mahsulot yo'q");
    expect(kassa.stockList({ query: "", filter: "positive" }).rows.map((row) => [row.productId, row.quantity])).toEqual([["p2", "5.0000"]]);
    expect(kassa.stockDocuments({ kind: "count" }).map((doc) => doc.number)).toEqual(["K01-I000001"]);
    expect(kassa.stockDocuments({}).map((doc) => doc.number).sort()).toEqual(["K01-I000001", "K01-T000001", "K01-W000001"]);
    expect(kassa.unsynced().map((op) => [op.type, op.number, op.label])).toEqual([
      ["stock.writeoff", "K01-W000001", "Singan"],
      ["stock.transfer", "K01-T000001", "→ Filial"],
      ["stock.count", "K01-I000001", "2 mahsulot"],
    ]);

    // Harakatlar offline — faqat qurilmadagi yuborilmagan hujjatlar; boshqa omborlar — internet bilan
    const offline = await kassa.stockMovements({ productId: "p2" });
    expect(offline.offline).toBe(true);
    expect(offline.rows.map((row) => [row.source, row.type, row.quantity, row.documentNumber])).toEqual([
      ["pending", "stock.count", "-1.0000", "K01-I000001"],
      ["pending", "stock.transfer", "-4.0000", "K01-T000001"],
    ]);
    await expect(kassa.stockElsewhere({ productId: "p2" })).rejects.toMatchObject({ code: "OFFLINE" });

    api.state.online = true;
    await kassa.syncNow();
    expect(api.state.pushed.map((op) => op.type)).toEqual(["stock.writeoff", "stock.transfer", "stock.count"]);
    expect(api.state.pushed[0]!.payload).toMatchObject({ number: "K01-W000001", reason: "Singan", items: [{ productId: "p1", unitId: "unit-d", quantity: "6.0000" }] });
    expect(api.state.pushed[1]!.payload).toMatchObject({ toWarehouseId: "w2", notes: "Filialga", items: [{ productId: "p2", quantity: "4.0000" }] });
    expect(api.state.pushed[2]!.payload).toMatchObject({
      number: "K01-I000001",
      notes: "Oylik",
      items: [
        { productId: "p1", countedQty: "0.0000" },
        { productId: "p2", countedQty: "5.0000" },
      ],
    });
    expect(kassa.stockDocuments({ kind: "writeoff" })[0]!.sync.state).toBe("applied");

    const online = await kassa.stockMovements({ productId: "p2" });
    expect(online).toMatchObject({ offline: false, nextCursor: "c1", rows: [expect.objectContaining({ source: "server", type: "transfer_out", by: "Ali" })] });
    expect((await kassa.stockElsewhere({ productId: "p2" })).map((row) => row.warehouseCode)).toEqual(["MAIN", "F1"]);
  });
});
