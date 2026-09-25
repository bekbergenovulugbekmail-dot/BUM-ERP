/**
 * EGASINING SENARIYSI (23-bo'lim): uch do'kon, bitta yetkazuvchi, bitta reys.
 *
 *   Test Market  — Cola 2 blok + Chips 5 dona (savdo agenti orqali buyurtma)
 *   Bonnu Market — Cola 3 blok
 *   Anor Market  — Cola 1 blok + Chips 4 dona
 *   Jami Cola 6 blok, Chips 9 dona.
 *
 * Oqim: "Yetkazishga chiqadiganlar" (server ro'yxati) → reys (snapshot) → 3 hujjat mos → terish → yuklash → yo'lga →
 * yetkazish: Test Market 1 blok Colani RAD etadi ("Yetkazilmadi", YT-), Anor keyinroq 1 Chips qaytaradi (QR-).
 * Har bosqichda: ombor, mijoz qarzi (kesh = jurnal subhisobi), aylanma balans, 1200 = ombor qiymati, reys snapshoti o'zgarmaydi.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts, journalEntries, journalLines } from "../src/db/schema/finance.js";
import { stockLevels } from "../src/db/schema/inventory.js";
import { agentOrders } from "../src/db/schema/sales-agent.js";
import { customers, salesReturns } from "../src/db/schema/sales.js";
import { buildServer } from "../src/server.js";
import {
  NO_PROOFS,
  agentAction,
  assign,
  caller,
  deliveryAgent,
  deliveryCompany,
  localToday,
  near,
  resetUnits,
  setPolicy,
  shop,
  startShift,
  taskForOrder,
} from "./delivery-setup.js";
import { addEmployee, resetDatabase, salesRepOf, signedIn } from "./helpers.js";
import { uniquePhone } from "./helpers.js";

let app: FastifyInstance;
let admin: string;
let company: Awaited<ReturnType<typeof deliveryCompany>>;
let call: ReturnType<typeof caller>;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
  call = caller(app);
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
  await resetUnits();
  admin = (await signedIn(app, { isPlatformAdmin: true })).cookie;
  company = await deliveryCompany(app, admin, "Distribyutor");
  await setPolicy(app, company.ownerCookie, NO_PROOFS);
});

const owner = () => company.ownerCookie;

async function expectTrialBalance(label: string) {
  const [row] = await db
    .select({
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)::numeric(18,2)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)::numeric(18,2)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalLines.companyId, company.companyId), eq(journalEntries.status, "posted")));
  expect(row!.debit, `${label}: aylanma balans`).toBe(row!.credit);
  const [inventory] = await db.select().from(accounts).where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, "1200")));
  const [value] = await db
    .select({ value: sql<string>`coalesce(sum(round(${stockLevels.quantity} * ${stockLevels.avgCostPrice}, 2)), 0)::numeric(18,2)` })
    .from(stockLevels)
    .where(eq(stockLevels.companyId, company.companyId));
  expect(inventory!.balance, `${label}: 1200 = ombor qiymati`).toBe(value!.value);
}

/** Mijoz qarzi: kesh va jurnal subhisobi bir xil bo'lishi SHART. */
async function debtOf(customerId: string) {
  const [cache] = await db.select({ debt: customers.totalDebt }).from(customers).where(eq(customers.id, customerId));
  const [ledger] = await db
    .select({ debt: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)::numeric(18,2)` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalLines.partyType, "customer"), eq(journalLines.partyId, customerId), eq(accounts.subtype, "receivable"), eq(journalEntries.status, "posted")));
  expect(cache!.debt, "kesh = jurnal").toBe(ledger!.debt);
  return Number(cache!.debt);
}

async function pieces(productId: string) {
  const [row] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, company.warehouseId)));
  return Number(row?.quantity ?? 0);
}

describe("23-bo'lim: Test / Bonnu / Anor — reys, 3 hujjat, rad etish va qaytarish", () => {
  it("to'liq senariy: hujjatlar mos, ombor, qarz va buxgalteriya har bosqichda to'g'ri", async () => {
    // ─── Tayyorgarlik: Cola bloki (12 dona), Chips, uch do'kon, savdo agenti ─────────────────────────────
    const [piece] = await db.select().from(units).where(eq(units.shortName, "d"));
    const [block] = await db.select().from(units).where(eq(units.shortName, "bl"));
    const cola = company.productId;
    expect([200, 201]).toContain((await call(owner(), "POST", "/api/catalog/unit-conversions", { productId: cola, fromUnitId: block!.id, toUnitId: piece!.id, factor: "12" })).statusCode);
    const chipsRes = await call(owner(), "POST", "/api/catalog/products", { name: "Chips Lays", sku: "CHIPS", baseUnitId: piece!.id, salesPrice: "8000", taxRate: "0" });
    const chips = chipsRes.json().product.id as string;
    await call(owner(), "POST", "/api/inventory/stock/movements", { type: "receive", productId: chips, warehouseId: company.warehouseId, quantity: "50", costPrice: "5000" });
    const customer = async (name: string) =>
      (await call(owner(), "POST", "/api/sales/customers", { name, phone: uniquePhone("95"), ...shop })).json().customer.id as string;
    const test = await customer("Test Market");
    const bonnu = await customer("Bonnu Market");
    const anor = await customer("Anor Market");
    const rep = await addEmployee(app, company, "Sotuv agenti");
    const repId = await salesRepOf(app, owner(), rep.id, { name: "Karimov Jasur", phone: "+998941112233" });
    const colaStart = await pieces(cola);
    const chipsStart = await pieces(chips);

    const order = async (customerId: string, items: object[]) => {
      const created = await call(owner(), "POST", "/api/sales/orders", {
        customerId,
        warehouseId: company.warehouseId,
        orderDate: localToday(),
        deliveryRequired: true,
        items,
      });
      expect(created.statusCode, created.body).toBe(201);
      const id = created.json().order.id as string;
      expect((await call(owner(), "POST", `/api/sales/orders/${id}/confirm`)).statusCode).toBe(200);
      return id;
    };
    const testOrder = await order(test, [{ productId: cola, quantity: "2", unitId: block!.id }, { productId: chips, quantity: "5" }]);
    const bonnuOrder = await order(bonnu, [{ productId: cola, quantity: "3", unitId: block!.id }]);
    const anorOrder = await order(anor, [{ productId: cola, quantity: "1", unitId: block!.id }, { productId: chips, quantity: "4" }]);
    // Test Market buyurtmasini savdo agenti olgan (agent buyurtmasi qismi)
    await db.insert(agentOrders).values({ orderId: testOrder, companyId: company.companyId, salesRepId: repId, customerId: test, clientRequestId: randomUUID(), paymentType: "credit" });

    const agent = await deliveryAgent(app, company, { name: "Rasulov Ali" });
    await startShift(app, agent.cookie);
    const tasks = {
      test: (await taskForOrder(app, owner(), testOrder)).id,
      bonnu: (await taskForOrder(app, owner(), bonnuOrder)).id,
      anor: (await taskForOrder(app, owner(), anorOrder)).id,
    };
    for (const id of Object.values(tasks)) await assign(app, owner(), id, agent.id);

    // ─── "Yetkazishga chiqadiganlar" — serverdagi to'liq ro'yxat ────────────────────────────────────────
    const outgoing = await call(owner(), "GET", `/api/delivery/trips/outgoing?date=${localToday()}`);
    expect(outgoing.statusCode, outgoing.body).toBe(200);
    expect((outgoing.json().taskIds as string[]).sort()).toEqual(Object.values(tasks).sort());

    const created = await call(owner(), "POST", "/api/delivery/trips", { taskIds: outgoing.json().taskIds });
    expect(created.statusCode, created.body).toBe(201);
    const [trip] = created.json().trips as { id: string; number: string; status: string; totalAmount: string; lines: { id: string; productId: string; unitName: string; requiredQty: string }[]; snapshot: Record<string, unknown> }[];
    expect(trip!.number).toMatch(/^RS-\d{4}-\d{5}$/);
    const snapshot = trip!.snapshot as unknown as {
      tasks: { id: string; customerName: string; salesRepName: string | null; salesRepPhone: string | null; agentName: string | null; taskTotal: string; items: { productId: string; unitName: string; quantity: string; lineTotal: string }[] }[];
      lines: { productId: string; unitName: string; quantity: string }[];
      totals: { amount: string; tasks: number };
    };
    expect(snapshot.totals.tasks).toBe(3);

    // Hujjat 2 (yig'ma) = hujjat 1 (nakladnoylar) yig'indisi — mahsulot × birlik
    const sum = new Map<string, number>();
    for (const task of snapshot.tasks) for (const item of task.items) sum.set(`${item.productId}|${item.unitName}`, (sum.get(`${item.productId}|${item.unitName}`) ?? 0) + Number(item.quantity));
    expect(Object.fromEntries(trip!.lines.map((line) => [`${line.productId}|${line.unitName}`, Number(line.requiredQty)]))).toEqual(Object.fromEntries(sum));
    expect(trip!.lines.find((line) => line.productId === cola)).toMatchObject({ unitName: "bl", requiredQty: "6.0000" });
    expect(trip!.lines.find((line) => line.productId === chips)).toMatchObject({ requiredQty: "9.0000" });
    // Summa: nakladnoylar = reys jami
    expect(snapshot.tasks.reduce((acc, task) => acc + Number(task.taskTotal), 0)).toBe(Number(trip!.totalAmount));
    // Nakladnoy izolyatsiyasi: savdo agenti faqat Test Market nakladnoyida
    const byName = Object.fromEntries(snapshot.tasks.map((task) => [task.customerName, task]));
    expect(byName["Test Market"]).toMatchObject({ salesRepName: "Karimov Jasur", salesRepPhone: "+998941112233", agentName: "Rasulov Ali" });
    expect(byName["Bonnu Market"]!.salesRepName).toBeNull();
    expect(byName["Anor Market"]!.salesRepName).toBeNull();

    // Ikkinchi marta reysga kirmaydi; tashqi kompaniya ko'rmaydi
    expect((await call(owner(), "POST", "/api/delivery/trips", { taskIds: [tasks.test] })).statusCode).toBe(409);
    const outsider = await deliveryCompany(app, admin, "Begona");
    expect((await call(outsider.ownerCookie, "GET", `/api/delivery/trips/${trip!.id}`)).statusCode).toBe(404);

    // ─── Terish va yuklash — faqat qayd: ombor o'zgarmaydi ──────────────────────────────────────────────
    const storekeeper = await addEmployee(app, company, "Omborchi");
    expect((await call(storekeeper.cookie, "POST", "/api/delivery/trips", { taskIds: [tasks.test] })).statusCode, "omborchi reys tuzmaydi").toBe(403);
    expect((await call(storekeeper.cookie, "POST", `/api/delivery/trips/${trip!.id}/load`)).statusCode, "terilmagan — yuklanmaydi").toBe(400);
    const pick = await call(storekeeper.cookie, "POST", `/api/delivery/trips/${trip!.id}/picking`, {
      lines: trip!.lines.map((line) => ({ lineId: line.id, pickedQty: line.requiredQty })),
    });
    expect(pick.statusCode, pick.body).toBe(200);
    expect((pick.json().trip.lines as { pickStatus: string }[]).every((line) => line.pickStatus === "picked")).toBe(true);
    expect((await call(storekeeper.cookie, "POST", `/api/delivery/trips/${trip!.id}/load`)).statusCode).toBe(200);
    expect((await call(owner(), "POST", `/api/delivery/trips/${trip!.id}/out`)).statusCode).toBe(200);
    expect(await pieces(cola), "yuklash omborni o'zgartirmaydi (Z2)").toBe(colaStart);
    await expectTrialBalance("yuklashdan keyin");

    // ─── Yetkazish: Test Market 1 blok Colani rad etadi ─────────────────────────────────────────────────
    const deliver = async (taskId: string, partial?: Record<string, string>) => {
      for (const [action, body] of [["accept", {}], ["start", {}], ["arrive", near(20)], ["delivering", {}]] as const) {
        const res = await agentAction(app, agent.cookie, taskId, action, body);
        expect(res.statusCode, `${action}: ${res.body}`).toBe(200);
      }
      const view = await call(agent.cookie, "GET", `/api/delivery/agent/tasks/${taskId}`);
      const items = (view.json().task.items as { id: string; productId: string; quantity: string }[]).map((item) => ({
        taskItemId: item.id,
        deliveredQty: partial?.[item.productId] ?? item.quantity,
      }));
      const confirmed = await agentAction(app, agent.cookie, taskId, "confirm", { ...near(20), items });
      expect(confirmed.statusCode, confirmed.body).toBe(200);
    };
    await deliver(tasks.test, { [cola]: "1" });
    await deliver(tasks.bonnu);
    await deliver(tasks.anor);
    expect(await pieces(cola), "6 blok = 72 dona chiqdi").toBe(colaStart - 72);
    expect(await pieces(chips)).toBe(chipsStart - 9);
    await expectTrialBalance("yetkazishdan keyin");

    const testDebtBefore = await debtOf(test);
    const refused = await call(owner(), "POST", `/api/delivery/tasks/${tasks.test}/return`, { refundMethod: "balance", reason: "1 blok Cola rad etildi" });
    expect(refused.statusCode, refused.body).toBe(200);
    expect(await pieces(cola), "rad etilgan 1 blok (12 dona) omborga").toBe(colaStart - 60);
    expect(await debtOf(test), "Test Market qarzi 1 blok qiymatiga kamaydi").toBe(testDebtBefore - 60_000);

    // ─── Anor Market keyinroq 1 Chipsni qaytaradi (sotuvdan keyingi qaytarish) ──────────────────────────
    const anorDebtBefore = await debtOf(anor);
    const anorDetail = (await call(owner(), "GET", `/api/sales/orders/${anorOrder}`)).json().order as { items: { id: string; productId: string }[] };
    const chipsLine = anorDetail.items.find((item) => item.productId === chips)!;
    const returned = await call(owner(), "POST", `/api/sales/orders/${anorOrder}/return-items`, { items: [{ orderItemId: chipsLine.id, quantity: "1" }], refundMethod: "balance", reason: "Muddati o'tgan" });
    expect(returned.statusCode, returned.body).toBe(201);
    expect(await pieces(chips)).toBe(chipsStart - 8);
    expect(await debtOf(anor)).toBe(anorDebtBefore - 8000);

    const docs = await db.select({ kind: salesReturns.kind, number: salesReturns.number }).from(salesReturns).where(eq(salesReturns.companyId, company.companyId));
    expect(docs.map((row) => row.kind).sort()).toEqual(["delivery_refusal", "return"]);
    expect(docs.find((row) => row.kind === "delivery_refusal")!.number).toMatch(/^YT-/);
    expect(docs.find((row) => row.kind === "return")!.number).toMatch(/^QR-/);

    // Yakuniy qarzlar: Test 2 blok×60 000 − 1 blok + 5 Chips×8000 = 100 000; Bonnu 180 000; Anor 60 000 + 32 000 − 8000
    expect(await debtOf(test)).toBe(100_000);
    expect(await debtOf(bonnu)).toBe(180_000);
    expect(await debtOf(anor)).toBe(84_000);
    await expectTrialBalance("yakun");

    // Reys snapshoti o'zgarmaydi — chop etilgan hujjatlar keyingi rad etishdan keyin ham bir xil
    const again = (await call(owner(), "GET", `/api/delivery/trips/${trip!.id}`)).json().trip as { status: string; snapshot: typeof snapshot };
    expect(again.status).toBe("out_for_delivery");
    expect(again.snapshot.totals).toEqual(snapshot.totals);
  });
});
