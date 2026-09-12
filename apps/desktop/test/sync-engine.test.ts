import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError, OfflineError } from "../src/main/api-client.js";
import { migrate } from "../src/main/local-db.js";
import { LocalStore } from "../src/main/local-store.js";
import { checkPin, hashPin } from "../src/main/pin.js";
import { CURSOR_REWIND_MS, SyncEngine, rewindCursors } from "../src/main/sync-engine.js";
import type { PullCursors, PullResponse, PushResult, SyncStatus, WireOperation } from "../src/shared/sync-types.js";
import { product, pullResponse } from "./fixtures.js";

let store: LocalStore;

beforeEach(() => {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  store = new LocalStore(db);
});

/** Soxta server: amallar va pull so'rovlarini yozib boradi. */
function fakeServer(options: { pulls?: PullResponse[]; offline?: boolean; status?: number } = {}) {
  const calls: string[] = [];
  const pushed: WireOperation[][] = [];
  const pullCursors: PullCursors[] = [];
  const queue = [...(options.pulls ?? [pullResponse({})])];
  const applied = new Map<string, PushResult>();
  return {
    calls,
    pushed,
    pullCursors,
    api: {
      async push(ops: WireOperation[]) {
        calls.push("push");
        if (options.offline) throw new OfflineError();
        pushed.push(ops);
        return {
          results: ops.map((op) => {
            const known = applied.get(op.opId);
            if (known) return { ...known, duplicate: true };
            const result: PushResult =
              op.type === "shift.close" && op.payload.shiftId === "missing"
                ? { opId: op.opId, status: "rejected", error: { code: "NOT_FOUND", message: "Smena topilmadi" } }
                : { opId: op.opId, status: "applied", result: { shiftId: op.payload.shiftId } };
            applied.set(op.opId, result);
            return result;
          }),
        };
      },
      async pull(cursors: PullCursors) {
        calls.push("pull");
        if (options.offline) throw new OfflineError();
        if (options.status) throw new ApiError(options.status, "UNAUTHENTICATED", "Qurilma o'chirilgan");
        pullCursors.push(cursors);
        return queue.shift() ?? pullResponse({});
      },
    },
  };
}

describe("Sinxron mexanizmi", () => {
  it("avval navbat yuboriladi, keyin sahifalab pull; natijalar lokal saqlanadi", async () => {
    store.enqueue({ type: "shift.open", cashierId: "u1", payload: { shiftId: "s1", openingCash: "0" } });
    store.enqueue({ type: "shift.close", cashierId: "u1", payload: { shiftId: "missing", closingCash: "0" } });
    const server = fakeServer({
      pulls: [
        pullResponse({ products: { rows: [product("p1", "Cola")], cursor: { t: "2026-09-12T10:00:00.000001Z", id: "p1" }, more: true } }),
        pullResponse({ products: { rows: [product("p2", "Pepsi")], cursor: { t: "2026-09-12T10:00:00.000002Z", id: "p2" } } }),
      ],
    });
    const statuses: SyncStatus[] = [];
    const engine = new SyncEngine(store, server.api, (status) => statuses.push(status));

    const report = await engine.sync();
    expect(server.calls).toEqual(["push", "pull", "pull"]);
    expect(report.pushed).toEqual({ applied: 1, rejected: 1 });
    expect(report.pulled.products).toBe(2);
    expect(report.status).toMatchObject({ state: "idle", pending: 0, rejected: 1 });
    expect(statuses.map((s) => s.state)).toEqual(["syncing", "idle"]);
    // Ikkinchi sahifa birinchi javob kursori bilan so'raladi
    expect(server.pullCursors[1]!.products).toEqual({ t: "2026-09-12T10:00:00.000001Z", id: "p1" });
    expect(store.getCursors().products).toEqual({ t: "2026-09-12T10:00:00.000002Z", id: "p2" });
  });

  it("keyingi siklda kursor 2 daqiqa orqaga suriladi, lekin saqlangan kursor orqaga ketmaydi", async () => {
    store.setMeta("cursors", { products: { t: "2026-09-12T10:00:00.000002Z", id: "p2" } });
    const server = fakeServer();
    await new SyncEngine(store, server.api).sync();
    expect(server.pullCursors[0]!.products).toEqual({ t: "2026-09-12T09:58:00.000000Z", id: "00000000-0000-0000-0000-000000000000" });
    expect(store.getCursors().products).toEqual({ t: "2026-09-12T10:00:00.000002Z", id: "p2" });
    expect(rewindCursors({ units: { t: "2026-09-12T00:00:00.500000Z", id: "x" } }, CURSOR_REWIND_MS).units!.t).toBe("2026-09-11T23:58:00.500000Z");
  });

  it("aloqa yo'q — navbat saqlanadi, holat offline; keyin qayta yuborishda takrorlanmaydi", async () => {
    const op = store.enqueue({ type: "shift.open", cashierId: "u1", payload: { shiftId: "s1", openingCash: "0" } });
    const report = await new SyncEngine(store, fakeServer({ offline: true }).api).sync();
    expect(report.status).toMatchObject({ state: "offline", pending: 1 });
    expect(store.operation(op.opId)!.status).toBe("pending");

    const online = fakeServer();
    const engine = new SyncEngine(store, online.api);
    expect((await engine.sync()).pushed.applied).toBe(1);
    expect((await engine.sync()).pushed.applied).toBe(0);
    expect(online.pushed.flat().map((o) => o.opId)).toEqual([op.opId]);
  });

  it("sinxron ketayotganda navbatga tushgan amal — sikl tugagach yana bir sikl (davriy sinxronni kutmaydi)", async () => {
    const server = fakeServer();
    const engine = new SyncEngine(store, server.api);
    const first = engine.sync();
    // Joriy sikl navbatni allaqachon o'qib bo'lgan — amal keyin tushdi
    const op = store.enqueue({ type: "shift.open", cashierId: "u1", payload: { shiftId: "s2", openingCash: "0" } });
    engine.schedule();
    expect((await first).pushed.applied).toBe(0);
    await engine.syncFresh();
    expect(server.pushed.flat().map((o) => o.opId)).toEqual([op.opId]);
    expect(store.operation(op.opId)!.status).toBe("applied");
  });

  it("qurilma o'chirilgan (401) — holat unauthorized; parallel sinxron bitta", async () => {
    const server = fakeServer({ status: 401 });
    const engine = new SyncEngine(store, server.api);
    const [a, b] = await Promise.all([engine.sync(), engine.sync()]);
    expect(a).toBe(b);
    expect(a.status.state).toBe("unauthorized");
    expect(server.calls).toEqual(["pull"]);
  });
});

describe("Kassa PIN'i", () => {
  it("to'g'ri PIN, xato PIN va 5 xatodan keyin qulf", async () => {
    store.setPinHash("u1", await hashPin("4321"));
    expect(await checkPin(store, "u1", "4321")).toEqual({ ok: true });
    expect(await checkPin(store, "u2", "4321")).toEqual({ ok: false, reason: "not_set" });
    const now = new Date("2026-09-12T10:00:00Z");
    for (let i = 0; i < 4; i++) expect((await checkPin(store, "u1", "0000", now)).ok).toBe(false);
    const locked = await checkPin(store, "u1", "0000", now);
    expect(locked).toMatchObject({ ok: false, reason: "locked" });
    expect(await checkPin(store, "u1", "4321", now)).toMatchObject({ ok: false, reason: "locked" });
    expect(await checkPin(store, "u1", "4321", new Date(now.getTime() + 6 * 60_000))).toEqual({ ok: true });
  });
});
