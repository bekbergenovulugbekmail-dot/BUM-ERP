import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { SCHEMA_VERSION, migrate } from "../src/main/local-db.js";
import { LocalStore, laterCursor } from "../src/main/local-store.js";
import { product, pullResponse } from "./fixtures.js";

let store: LocalStore;

beforeEach(() => {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  store = new LocalStore(db);
});

describe("Lokal ombor", () => {
  it("migratsiya takror ishlasa o'zgarmaydi", () => {
    expect(migrate(store.db)).toBe(SCHEMA_VERSION);
    expect((store.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION);
  });

  it("serverdan kelgan qatorlarni upsert qiladi, kursor oldinga siljiydi va orqaga ketmaydi; qidiruv", () => {
    const first = { t: "2026-09-12T09:00:00.000001Z", id: "p2" };
    const counts = store.applyPull(
      pullResponse({
        products: { rows: [product("p1", "Coca Cola 1L", { barcode: "4780001" }), product("p2", "Pepsi 1L")], cursor: first },
        stockLevels: { rows: [{ id: "s1", productId: "p1", quantity: "10.0000" }], cursor: { t: "2026-09-12T09:00:00.000000Z", id: "s1" } },
        cashiers: { rows: [{ id: "m1", userId: "u1", name: "Ali", phone: "+998901112233", role: "Kassir", permissions: ["pos.use"], active: true }], cursor: { t: "2026-09-12T08:00:00.000000Z", id: "m1" } },
        units: { rows: [{ id: "unit1", name: "dona", shortName: "d" }], cursor: { t: "2026-01-01T00:00:00.000000Z", id: "unit1" } },
      }),
    );
    expect(counts).toMatchObject({ products: 2, stockLevels: 1, cashiers: 1, units: 1, customers: 0 });
    expect(store.getCursors().products).toEqual(first);
    expect(store.getMeta("company")).toMatchObject({ name: "Bonnu" });

    // Narx o'zgardi — o'sha qator yangilanadi, ikkinchi nusxa yo'q
    store.applyPull(pullResponse({ products: { rows: [product("p1", "Coca Cola 1L", { barcode: "4780001", salesPrice: "12000.0000" })], cursor: { t: "2026-09-12T09:05:00.000000Z", id: "p1" } } }));
    expect(store.counts().products).toBe(2);
    expect(store.searchProducts("4780001")).toEqual([expect.objectContaining({ id: "p1", salesPrice: "12000.0000" })]);
    expect(store.searchProducts("pepsi").map((row) => row.id)).toEqual(["p2"]);

    // Orqaga surilgan (eski) kursor saqlangan kursorni almashtirmaydi
    store.applyPull(pullResponse({}, { products: { t: "2026-09-12T09:03:00.000000Z", id: "00000000-0000-0000-0000-000000000000" } }));
    expect(store.getCursors().products).toEqual({ t: "2026-09-12T09:05:00.000000Z", id: "p1" });
    expect(store.cashiers()).toEqual([expect.objectContaining({ userId: "u1", active: true })]);
  });

  it("serverda o'chirilgan kategoriya va brend lokal nusxadan olib tashlanadi (noma'lum tur — e'tiborsiz)", () => {
    const at = (time: string, id: string) => ({ t: `2026-09-12T${time}:00.000000Z`, id });
    store.applyPull(
      pullResponse({
        products: { rows: [product("p1", "Coca Cola 1L")], cursor: at("09:00", "p1") },
        categories: { rows: [{ id: "c1", name: "Ichimliklar" }, { id: "c2", name: "Shirinliklar" }], cursor: at("09:00", "c2") },
        brands: { rows: [{ id: "b1", name: "Coca" }], cursor: at("09:00", "b1") },
      }),
    );
    store.applyPull(
      pullResponse({
        // Shu sahifada eski qator qayta kelsa ham o'chirish keyin qo'llanadi
        categories: { rows: [{ id: "c1", name: "Ichimliklar" }], cursor: at("09:01", "c1") },
        deletions: {
          rows: [
            { id: "d1", entity: "categories", entityId: "c1" },
            { id: "d2", entity: "brands", entityId: "b1" },
            { id: "d3", entity: "products", entityId: "p1" },
          ],
          cursor: at("09:10", "d3"),
        },
      }),
    );
    expect(store.records<{ id: string }>("categories").map((row) => row.id)).toEqual(["c2"]);
    expect(store.records("brands")).toEqual([]);
    expect(store.counts().products).toBe(1);
    expect(store.getCursors().deletions).toEqual(at("09:10", "d3"));
  });

  it("offline navbat: tartib, server javobi bo'yicha yakunlash, javobsizlari navbatda qoladi", () => {
    const a = store.enqueue({ type: "shift.open", cashierId: "u1", payload: { shiftId: "s1", openingCash: "0" } });
    const b = store.enqueue({ type: "shift.close", cashierId: "u1", payload: { shiftId: "s1", closingCash: "0" } });
    const c = store.enqueue({ type: "shift.close", cashierId: "u1", payload: { shiftId: "s2", closingCash: "0" } });
    const pending = store.pendingOps(10);
    expect(pending.map((op) => op.opId)).toEqual([a.opId, b.opId, c.opId]);

    const marked = store.markPushResults(pending, [
      { opId: a.opId, status: "applied", result: { shiftId: "s1" } },
      { opId: b.opId, status: "rejected", error: { code: "NOT_FOUND", message: "Smena topilmadi" } },
    ]);
    expect(marked).toEqual({ applied: 1, rejected: 1 });
    expect(store.pendingOps(10).map((op) => op.opId)).toEqual([c.opId]);
    expect(store.operation(a.opId)).toMatchObject({ status: "applied", result: { shiftId: "s1" }, attempts: 1 });
    expect(store.rejectedOps()).toEqual([expect.objectContaining({ opId: b.opId, error: expect.objectContaining({ code: "NOT_FOUND" }) })]);
    expect(store.counts()).toMatchObject({ pending: 1, rejected: 1 });
  });

  it("kursor taqqoslash: vaqt, keyin id", () => {
    const a = { t: "2026-09-12T09:00:00.000001Z", id: "b" };
    expect(laterCursor(a, { t: "2026-09-12T09:00:00.000000Z", id: "z" })).toBe(a);
    expect(laterCursor(a, { t: "2026-09-12T09:00:00.000001Z", id: "c" })).toEqual({ t: a.t, id: "c" });
    expect(laterCursor(undefined, null)).toBeUndefined();
  });
});
