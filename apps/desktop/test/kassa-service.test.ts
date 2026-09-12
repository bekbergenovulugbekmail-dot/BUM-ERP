import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { KassaError, KassaService, type TokenVault } from "../src/main/kassa-service.js";
import { migrate } from "../src/main/local-db.js";
import { LocalStore } from "../src/main/local-store.js";
import type { PushResult, WireOperation } from "../src/shared/sync-types.js";
import { deviceInfo, company, product, pullResponse } from "./fixtures.js";

/** Soxta `/api/pos-device` serveri (fetch darajasida). */
function fakeApi() {
  const state = { token: "bumpos_test-token", online: true, pushed: [] as WireOperation[], pulls: 0, rejectTypes: [] as string[] };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    if (!state.online) throw new TypeError("fetch failed");
    const url = new URL(String(input));
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const authed = (init?.headers as Record<string, string>).authorization === `Bearer ${state.token}`;
    switch (url.pathname) {
      case "/api/pos-device/setup/options":
        return body.password === "right"
          ? json(200, { companies: [company], company, warehouses: [{ id: "w1", name: "Asosiy", code: "MAIN", isDefault: true }] })
          : json(401, { code: "UNAUTHENTICATED", message: "Telefon raqam yoki parol noto'g'ri" });
      case "/api/pos-device/setup/register":
        return json(201, { token: state.token, device: { ...deviceInfo, isActive: true }, company });
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
});
