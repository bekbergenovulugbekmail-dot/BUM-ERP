import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { KassaError, KassaService, type TokenVault } from "../src/main/kassa-service.js";
import { migrate } from "../src/main/local-db.js";
import { LocalStore } from "../src/main/local-store.js";
import type { PushResult, WireOperation } from "../src/shared/sync-types.js";
import { deviceInfo, company, product, pullResponse } from "./fixtures.js";

/** Soxta `/api/pos-device` serveri (fetch darajasida). */
function fakeApi() {
  const state = { token: "bumpos_test-token", online: true, pushed: [] as WireOperation[], pulls: 0 };
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
        const results: PushResult[] = ops.map((op) => ({ opId: op.opId, status: "applied", result: { shiftId: op.payload.shiftId } }));
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
});
