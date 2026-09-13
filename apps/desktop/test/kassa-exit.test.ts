/** Kassadan chiqish: qurilmani kompaniyadan uzish (token, kompaniya ma'lumotlari, server) va ilova yopilishi. */
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { KassaService, type TokenVault } from "../src/main/kassa-service.js";
import { migrate } from "../src/main/local-db.js";
import { LocalStore } from "../src/main/local-store.js";
import type { PushResult, WireOperation } from "../src/shared/sync-types.js";
import { company, deviceInfo, product, pullResponse } from "./fixtures.js";

function fakeServer() {
  const token = "bumpos_exit-token";
  const state = { online: true, revoked: false, unregistered: 0, failUnregister: false };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    if (!state.online) throw new TypeError("fetch failed");
    const url = new URL(String(input));
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const authed = !state.revoked && (init?.headers as Record<string, string>).authorization === `Bearer ${token}`;
    if (url.pathname === "/api/pos-device/setup/register") {
      state.revoked = false;
      return json(201, { token, device: { ...deviceInfo, isActive: true }, company });
    }
    if (!authed) return json(401, { code: "UNAUTHENTICATED", message: "Kassa qurilmasi ro'yxatdan o'tmagan yoki o'chirilgan" });
    switch (url.pathname) {
      case "/api/pos-device/pull":
        return json(200, pullResponse({ products: { rows: [product("p1", "Cola")], cursor: { t: "2026-09-12T10:00:00.000000Z", id: "p1" } } }));
      case "/api/pos-device/push": {
        const ops = body.ops as WireOperation[];
        return json(200, { results: ops.map((op): PushResult => ({ opId: op.opId, status: "applied", result: {} })) });
      }
      case "/api/pos-device/cashiers/login":
        return json(200, { cashier: { id: "u1", name: "Ali", phone: "+998901112233", role: "Kassir", permissions: ["pos.use"] } });
      case "/api/pos-device/unregister":
        if (state.failUnregister) return json(500, { code: "INTERNAL", message: "xato" });
        state.unregistered += 1;
        state.revoked = true;
        return json(200, { ok: true });
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

const registerInput = { apiUrl: "https://bum-erp.uz", phone: "+998900000001", password: "right", warehouseId: "w1", name: "Kassa 1" };

async function registered(server: ReturnType<typeof fakeServer>) {
  const kassa = new KassaService(store, vault, { appVersion: "0.4.1", platform: "win32", fetchImpl: server.fetchImpl });
  await kassa.register(registerInput);
  await kassa.firstLogin({ phone: "+998901112233", password: "kassir", pin: "1234" });
  return kassa;
}

describe("Qurilmani uzish", () => {
  it("server qurilmani o'chiradi; token, kassirlar va kompaniya ma'lumotlari o'chadi; uskuna sozlamalari qoladi; qayta ulash mumkin", async () => {
    const server = fakeServer();
    const kassa = await registered(server);
    store.setMeta("devicePrefs", { marker: "printer" });
    store.setMeta("scaleSettings", { scales: [], marker: "tarozi" });
    expect(kassa.status()).toMatchObject({ registered: true, counts: { products: 1, cashiers: 1 } });

    const result = await kassa.unpair();
    expect(result.serverRevoked).toBe(true);
    expect(server.state.unregistered).toBe(1);
    expect(result.status).toMatchObject({ registered: false, company: null, device: null, cashier: null, apiUrl: null, counts: { products: 0, cashiers: 0, pending: 0 } });
    expect(vault.value).toBeNull();
    expect(store.pinState("u1")).toBeNull();
    expect(store.getMeta("devicePrefs")).toEqual({ marker: "printer" });
    expect(store.getMeta("scaleSettings")).toMatchObject({ marker: "tarozi" });
    await expect(kassa.syncNow()).rejects.toMatchObject({ code: "NOT_REGISTERED" });

    // Boshqa (yoki shu) kompaniyaga qayta ulanadi
    await kassa.register(registerInput);
    expect(kassa.status()).toMatchObject({ registered: true, counts: { products: 1 } });
  });

  it("yuborilmagan amal yoki ochiq smena bo'lsa uzilmaydi — ma'lumot va token saqlanadi", async () => {
    const server = fakeServer();
    const kassa = await registered(server);
    server.state.online = false;
    store.enqueue({ type: "customer.create", cashierId: "u1", payload: { id: "x1", name: "Mijoz" } });
    await expect(kassa.unpair()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(kassa.status()).toMatchObject({ registered: true, counts: { pending: 1 } });
    expect(vault.value).not.toBeNull();
    expect(server.state.unregistered).toBe(0);

    server.state.online = true;
    await kassa.syncNow();
    store.setMeta("shift", { id: "s1", openedAt: "2026-09-13T08:00:00.000Z" });
    await expect(kassa.unpair()).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("Smena ochiq") });
    expect(kassa.status().registered).toBe(true);
  });

  it("internet yo'q yoki server xatosi — lokal uzish baribir bajariladi (server yozuvi web'dan o'chiriladi)", async () => {
    const server = fakeServer();
    const kassa = await registered(server);
    server.state.online = false;
    const offline = await kassa.unpair();
    expect(offline).toMatchObject({ serverRevoked: false, status: { registered: false } });
    expect(vault.value).toBeNull();

    server.state.online = true;
    await kassa.register(registerInput);
    server.state.failUnregister = true;
    const failed = await kassa.unpair();
    expect(failed).toMatchObject({ serverRevoked: false, status: { registered: false } });
  });

  it("ilova yopilishi: sinxron ketayotganda baza ochiq qoladi (xato yo'q), bo'sh paytda yopiladi; takroriy chaqiruv xato bermaydi", async () => {
    const server = fakeServer();
    const kassa = await registered(server);
    kassa.start(60_000);
    // start darhol sinxron boshlaydi — shu paytda yopish bazani yopmaydi
    kassa.shutdown();
    expect(store.db.isOpen).toBe(true);
    await kassa.syncNow();
    kassa.shutdown();
    expect(store.db.isOpen).toBe(false);
    expect(() => kassa.shutdown()).not.toThrow();
  });
});
