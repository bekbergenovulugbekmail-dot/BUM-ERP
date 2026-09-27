/**
 * AUD-026 — qoldiq solishtiruvi: qoldiq = harakatlar yig'indisi (faqat o'qish).
 *  Kirim 10, chiqim 3 → mos (7 = 10 − 3). Qoldiq harakatsiz o'zgartirilsa (eski import simulyatsiyasi) — farq ko'rinadi;
 *  manfiy qoldiq alohida ro'yxatda. Begona kompaniya ombori ma'lumoti ko'rinmaydi.
 */
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { stockLevels, warehouses } from "../src/db/schema/inventory.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { createCompany, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let company: Awaited<ReturnType<typeof createCompany>>;
let other: Awaited<ReturnType<typeof createCompany>>;
let piece: string;
let mainWh: string;

const call = (cookie: string, method: "GET" | "POST", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

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
  company = await createCompany(app, admin.cookie, { name: "Solishtiruv" });
  other = await createCompany(app, admin.cookie, { name: "Begona ombor" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
});

describe("AUD-026 qoldiq solishtiruvi", () => {
  it("qoldiq = harakatlar; to'g'ridan-to'g'ri o'zgartirilgan qoldiq va manfiy qoldiq ko'rinadi; tenant", async () => {
    const owner = company.ownerCookie;
    const productId = (await call(owner, "POST", "/api/catalog/products", { name: "Guruch", sku: "GR", baseUnitId: piece, salesPrice: "15000", taxRate: "0" })).json().product.id as string;
    expect((await call(owner, "POST", "/api/inventory/stock/movements", { type: "receive", productId, warehouseId: mainWh, quantity: "10", costPrice: "9000" })).statusCode).toBe(201);
    const out = await call(owner, "POST", "/api/inventory/stock/movements", { type: "writeoff", productId, warehouseId: mainWh, quantity: "3", notes: "Shikast" });
    expect(out.statusCode, out.body).toBe(201);

    const url = `/api/inventory/stock/reconciliation?warehouseId=${mainWh}`;
    const clean = await call(owner, "GET", url);
    expect(clean.statusCode, clean.body).toBe(200);
    expect(clean.json()).toMatchObject({ checked: 1, ok: true, mismatched: [], negative: [] });

    // Harakatsiz qoldiq o'zgarishi (API'da bunday yo'l yo'q — eski import/migratsiya simulyatsiyasi)
    const level = and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, mainWh));
    await db.update(stockLevels).set({ quantity: "12" }).where(level);
    const drift = (await call(owner, "GET", url)).json();
    expect(drift.ok).toBe(false);
    expect(drift.mismatched).toEqual([expect.objectContaining({ productId, level: "12.0000", movements: "7.0000", difference: "5.0000" })]);

    await db.update(stockLevels).set({ quantity: "-2" }).where(level);
    const negative = (await call(owner, "GET", url)).json();
    expect(negative.negative).toEqual([expect.objectContaining({ productId, level: "-2.0000" })]);

    // Begona kompaniya ombori — 404 (ma'lumot ko'rinmaydi)
    expect((await call(other.ownerCookie, "GET", url)).statusCode).toBe(404);
  });
});
