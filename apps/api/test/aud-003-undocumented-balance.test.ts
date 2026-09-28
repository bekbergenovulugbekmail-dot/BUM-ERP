/**
 * AUD-003 (egasi qarori, 2026-09-28): to'lovning hujjatlarga taqsimlanmagan qismi pul sifatida saqlanadi (jurnal va
 * kesh), lekin aging'da ochiq hujjat qarzi bo'lib ko'rinmaydi — "HUJJATSIZ QOLDIQ" alohida:
 *   hujjatlashtirilgan qarz (ochiq hujjatlar) | hujjatsiz qarz (boshlang'ich/tuzatma) | hujjatga bog'lanmagan kredit.
 * Aging jami va kredit to'xtatish — faqat hujjatlashtirilgan qarzdan (mavjud qoida).
 */
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SALES_POLICY } from "../src/modules/sales/sales-policy.service.js";
import { closeDb, db } from "../src/db/client.js";
import { auditLogs } from "../src/db/schema/platform.js";
import { units } from "../src/db/schema/catalog.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { customers } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { todayIso } from "../src/modules/finance/cash.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let company: Awaited<ReturnType<typeof createCompany>>;
let other: Awaited<ReturnType<typeof createCompany>>;
let piece: string;
let mainWh: string;
let productId: string;

const call = (method: "GET" | "POST" | "PUT", url: string, payload?: object, cookie = company.ownerCookie) =>
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
  company = await createCompany(app, admin.cookie, { name: "Hujjatsiz" });
  other = await createCompany(app, admin.cookie, { name: "Begona" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  productId = (await call("POST", "/api/catalog/products", { name: "Un", sku: "UN", baseUnitId: piece, salesPrice: "100000", taxRate: "0" })).json().product.id;
  await call("POST", "/api/inventory/stock/movements", { type: "receive", productId, warehouseId: mainWh, quantity: "10", costPrice: "60000" });
});

async function creditSale(customerId: string, orderDate = todayIso()) {
  const orderId = (await call("POST", "/api/sales/orders", { customerId, warehouseId: mainWh, orderDate, items: [{ productId, quantity: "1" }] })).json().order.id as string;
  expect((await call("POST", `/api/sales/orders/${orderId}/confirm`)).statusCode).toBe(200);
  expect((await call("POST", `/api/sales/orders/${orderId}/ship`)).statusCode).toBe(200);
  return orderId;
}
type Aging = {
  totals: { total: string };
  undocumented: { debt: string; unappliedCredit: string; customers: { customerId: string; documented: string; ledger: string; undocumentedDebt: string; unappliedCredit: string }[] };
};
const aging = async (cookie = company.ownerCookie) => (await call("GET", "/api/sales/receivables/aging", undefined, cookie)).json() as Aging;

describe("AUD-003 — hujjatsiz qoldiq alohida", () => {
  it("boshlang'ich qarz + nasiya sotuv: aging jami faqat hujjatlar; hujjatsiz 50k alohida; umumiy to'lovning taqsimlanmagan qismi ko'rinadi", async () => {
    const customerId = (await call("POST", "/api/sales/customers", { name: "Eski mijoz" })).json().customer.id as string;
    const opening = await call("POST", `/api/sales/customers/${customerId}/balance-adjust`, { totalDebt: "50000", reason: "Boshlang'ich qarz", counter: "equity" });
    expect(opening.statusCode, opening.body).toBe(200);
    await creditSale(customerId);

    const first = await aging();
    expect(first.totals.total, "aging jami — faqat hujjatlar").toBe("100000.00");
    expect(first.undocumented).toMatchObject({ debt: "50000.00", unappliedCredit: "0.00" });
    expect(first.undocumented.customers).toEqual([expect.objectContaining({ customerId, documented: "100000.00", ledger: "150000.00", undocumentedDebt: "50000.00", unappliedCredit: "0.00" })]);

    // 120 000 umumiy to'lov: 100 000 hujjatga, 20 000 — hujjatsiz qarzga (taqsimlanmagan qism javobda va auditda)
    const paid = await call("POST", "/api/sales/payments", { customerId, amount: "120000", method: "cash" });
    expect(paid.statusCode, paid.body).toBe(201);
    expect(paid.json()).toMatchObject({ unallocated: "20000.00" });
    expect(paid.json().allocations.map((a: { amount: string }) => a.amount)).toEqual(["100000.00"]);
    const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "CUSTOMER_PAYMENT_RECORDED"), eq(auditLogs.resourceId, paid.json().payment.id)));
    expect(audit!.details).toMatchObject({ unallocated: "20000.00" });

    const after = await aging();
    expect(after.totals.total).toBe("0.00");
    expect(after.undocumented).toMatchObject({ debt: "30000.00", unappliedCredit: "0.00" });
    expect((await db.select().from(customers).where(eq(customers.id, customerId)))[0]!.totalDebt, "pul saqlangan: kesh = jurnal").toBe("30000.00");
    const statement = (await call("GET", `/api/sales/customers/${customerId}/statement`)).json();
    expect(statement.reconciliation.ok).toBe(true);
  });

  it("hujjatga bog'lanmagan kredit (tuzatma bilan qarz kamaydi) — alohida, hujjat qarzi o'zgarmaydi", async () => {
    const customerId = (await call("POST", "/api/sales/customers", { name: "Tuzatilgan" })).json().customer.id as string;
    await creditSale(customerId);
    expect((await call("POST", `/api/sales/customers/${customerId}/balance-adjust`, { totalDebt: "70000", reason: "Akt bo'yicha" })).statusCode).toBe(200);
    const report = await aging();
    expect(report.totals.total).toBe("100000.00");
    expect(report.undocumented).toMatchObject({ debt: "0.00", unappliedCredit: "30000.00" });
    expect(report.undocumented.customers[0]).toMatchObject({ documented: "100000.00", ledger: "70000.00", unappliedCredit: "30000.00" });
  });

  it("kredit to'xtatish hujjatsiz qarzga qaramaydi; tenant; ruxsat", async () => {
    const customerId = (await call("POST", "/api/sales/customers", { name: "Siyosat" })).json().customer.id as string;
    await call("POST", `/api/sales/customers/${customerId}/balance-adjust`, { totalDebt: "500000", reason: "Boshlang'ich qarz", counter: "equity" });
    expect((await call("PUT", "/api/sales/policy", { ...DEFAULT_SALES_POLICY, creditHoldOverdueAmount: "10000" })).statusCode).toBe(200);
    const credit = (await call("GET", `/api/sales/customers/${customerId}/credit`)).json().credit;
    expect(credit).toMatchObject({ allowed: true, overdueAmount: "0.00" });

    expect((await aging(other.ownerCookie)).undocumented.customers, "begona kompaniya ko'rmaydi").toEqual([]);
    // Ruxsat — mavjud qoida (sales.view): kassirda bor; sales.view siz rol — 403
    const kassir = await addEmployee(app, company, "Kassir");
    expect((await call("GET", "/api/sales/receivables/aging", undefined, kassir.cookie)).statusCode).toBe(200);
    expect((await call("POST", "/api/company/roles", { name: "Faqat ombor", permissions: ["products.view"] })).statusCode).toBe(201);
    const clerk = await addEmployee(app, company);
    expect((await app.inject({ method: "PATCH", url: `/api/company/employees/${clerk.id}`, headers: { cookie: company.ownerCookie }, payload: { role: "Faqat ombor" } })).statusCode).toBe(200);
    expect((await call("GET", "/api/sales/receivables/aging", undefined, clerk.cookie)).statusCode).toBe(403);
  });
});
