import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts } from "../src/db/schema/finance.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let other: Company;
let mainWh: string;
let productId: string;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

const call = (method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie: company.ownerCookie }, ...(payload ? { payload } : {}) });

beforeEach(async () => {
  await resetDatabase();
  await db.delete(units);
  await seedDefaultUnits(db);
  const piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Ombor kompaniyasi" });
  other = await createCompany(app, admin.cookie, { name: "Boshqa kompaniya" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  productId = (await call("POST", "/api/catalog/products", { name: "Un", sku: "UN", baseUnitId: piece })).json().product.id;
});

const move = (payload: object) =>
  call("POST", "/api/inventory/stock/movements", { productId, warehouseId: mainWh, ...payload });

async function account(code: string, companyId = company.companyId) {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), eq(accounts.code, code)));
  return row!;
}
const ledger = async (code: string) => (await account(code)).balance;

describe("Ombor harakatlari buxgalteriyada", () => {
  it("qo'lda kirim, chiqim, tuzatish va inventarizatsiya tannarxda yoziladi; qarshi hisob tanlanadi", async () => {
    // Kirim — boshlang'ich qoldiq: DR 1200 / CR 3000
    expect((await move({ type: "receive", quantity: "10", costPrice: "1000" })).statusCode).toBe(201);
    expect(await ledger("1200")).toBe("10000.00");
    expect(await ledger("3000")).toBe("10000.00");

    // Hisobdan chiqarish — DR 5500 / CR 1200; ortiqcha (tuzatish) — DR 1200 / CR 4100
    expect((await move({ type: "writeoff", quantity: "2" })).statusCode).toBe(201);
    expect(await ledger("5500")).toBe("2000.00");
    expect((await move({ type: "adjust", quantity: "1" })).statusCode).toBe(201);
    expect(await ledger("4100")).toBe("1000.00");
    expect(await ledger("1200")).toBe("9000.00");

    // Qarshi hisob tanlansa — shu hisob (kapital); begona, zaxira va kreditor hisobi rad.
    // Kreditor ta'minotchi subhisobi bilan yuritiladi — qarzga kirim faqat xarid hujjati orqali (audit AUD-012).
    const received = await move({ type: "receive", quantity: "5", costPrice: "1000", counterAccountId: (await account("3000")).id });
    expect(received.statusCode).toBe(201);
    expect(received.json().journalEntryId).toBeTruthy();
    expect(await ledger("3000")).toBe("15000.00");
    expect((await move({ type: "receive", quantity: "1", costPrice: "1000", counterAccountId: (await account("2000")).id })).statusCode).toBe(400);
    expect(await ledger("2000")).toBe("0.00");
    const foreign = (await account("3000", other.companyId)).id;
    expect((await move({ type: "receive", quantity: "1", costPrice: "1000", counterAccountId: foreign })).statusCode).toBe(400);
    expect((await move({ type: "receive", quantity: "1", costPrice: "1000", counterAccountId: (await account("1200")).id })).statusCode).toBe(400);
    expect(await ledger("1200")).toBe("14000.00");

    // Inventarizatsiya: 14 bor, 12 sanaldi — kamomad 2 × 1000 = DR 5500 / CR 1200
    const countId = (await call("POST", "/api/inventory/counts", { warehouseId: mainWh, name: "Oylik" })).json().count.id;
    const item = (await call("GET", `/api/inventory/counts/${countId}`)).json().count.items[0];
    expect((await call("PATCH", `/api/inventory/counts/${countId}/items/${item.id}`, { countedQty: "12" })).statusCode).toBe(200);
    expect((await call("POST", `/api/inventory/counts/${countId}/apply`)).statusCode).toBe(200);
    expect(await ledger("5500")).toBe("4000.00");
    expect(await ledger("1200")).toBe("12000.00");
  });
});
