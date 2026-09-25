/**
 * QAYTARISH TURLARI (Z1) va QAYTGAN TOVAR HOLATI.
 *
 *  1) "Yetkazilmadi" — yetkazishda qisman rad etilgan tovar omborga qaytdi: alohida hujjat (YT-), jurnal turi
 *     `delivery_refusal`, aktda "Yetkazilmadi". Pul, zaxira va qarz arifmetikasi sotuvdan keyingi qaytarish bilan bir xil.
 *  2) Sotuvdan keyingi qaytarish (QR-) holat bilan: sotuvga, shikastlangan (hisobdan chiqariladi — 5500), karantin
 *     (alohida omborga). Har qadamda aylanma balans teng, 1200 Tovar zaxirasi = omborlardagi qoldiq qiymati.
 */
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { accounts, journalEntries, journalLines } from "../src/db/schema/finance.js";
import { stockLevels } from "../src/db/schema/inventory.js";
import { customers, salesReturnItems, salesReturns } from "../src/db/schema/sales.js";
import { buildServer } from "../src/server.js";
import {
  NO_PROOFS,
  agentAction,
  arrivedTask,
  caller,
  deliveryAgent,
  deliveryCompany,
  near,
  resetUnits,
  setPolicy,
  startShift,
} from "./delivery-setup.js";
import { resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
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
  const admin = (await signedIn(app, { isPlatformAdmin: true })).cookie;
  company = await deliveryCompany(app, admin, "Qaytarish turlari");
  await setPolicy(app, company.ownerCookie, NO_PROOFS);
});

const owner = () => company.ownerCookie;

async function ledger(code: string) {
  const [row] = await db.select().from(accounts).where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code)));
  return row!.balance;
}

async function expectTrialBalance() {
  const [row] = await db
    .select({
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)::numeric(18,2)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)::numeric(18,2)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalLines.companyId, company.companyId), eq(journalEntries.status, "posted")));
  expect(row!.debit).toBe(row!.credit);
}

/** 1200 Tovar zaxirasi = omborlardagi qoldiq × o'rtacha tannarx (butun kompaniya). */
async function expectInventoryMatchesLedger() {
  const [row] = await db
    .select({ value: sql<string>`coalesce(sum(round(${stockLevels.quantity} * ${stockLevels.avgCostPrice}, 2)), 0)::numeric(18,2)` })
    .from(stockLevels)
    .where(eq(stockLevels.companyId, company.companyId));
  expect(await ledger("1200"), "1200 = ombordagi tovar qiymati").toBe(row!.value);
}

async function qty(warehouseId: string) {
  const [row] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, company.productId), eq(stockLevels.warehouseId, warehouseId)));
  return row ? Number(row.quantity) : 0;
}

async function debt() {
  const [row] = await db.select().from(customers).where(eq(customers.id, company.customerId));
  return Number(row!.totalDebt);
}

describe("Yetkazilmadi (delivery_refusal)", () => {
  it("10 tadan 6 tasi topshirildi, 4 tasi rad: YT- hujjati, o'z jurnal turi, qarz va ombor to'g'ri, aktda 'Yetkazilmadi'", async () => {
    const agent = await deliveryAgent(app, company);
    await startShift(app, agent.cookie);
    const { taskId } = await arrivedTask(app, company, agent, "10");
    await agentAction(app, agent.cookie, taskId, "delivering");
    const view = await call(agent.cookie, "GET", `/api/delivery/agent/tasks/${taskId}`);
    const item = (view.json().task.items as { id: string }[])[0]!;
    const confirmed = await agentAction(app, agent.cookie, taskId, "confirm", { ...near(20), items: [{ taskItemId: item.id, deliveredQty: "6" }] });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    const debtBefore = await debt();
    const stockBefore = await qty(company.warehouseId);

    const returned = await call(owner(), "POST", `/api/delivery/tasks/${taskId}/return`, { refundMethod: "balance", reason: "Do'kon 4 tasini olmadi" });
    expect(returned.statusCode, returned.body).toBe(200);

    const [doc] = await db.select().from(salesReturns).where(eq(salesReturns.companyId, company.companyId));
    expect(doc!.kind).toBe("delivery_refusal");
    expect(doc!.number).toMatch(/^YT-\d{4}-\d{4}$/);
    expect(doc!.deliveryTaskId).toBe(taskId);
    expect(Number(doc!.totalAmount)).toBe(20_000);
    expect(await qty(company.warehouseId), "4 ta omborga qaytdi").toBe(stockBefore + 4);
    expect(await debt(), "qarz 4 × 5000 ga kamaydi").toBe(debtBefore - 20_000);

    const types = await db
      .select({ type: journalEntries.referenceType })
      .from(journalEntries)
      .where(and(eq(journalEntries.companyId, company.companyId), eq(journalEntries.referenceId, doc!.id)));
    expect(types.map((row) => row.type)).toContain("delivery_refusal");
    expect(types.map((row) => row.type), "sotuvdan keyingi qaytarish sifatida yozilmaydi").not.toContain("sales_return");

    const statement = await call(owner(), "GET", `/api/sales/customers/${company.customerId}/statement?from=2020-01-01&to=2100-01-01`);
    expect(statement.statusCode, statement.body).toBe(200);
    const labels = (statement.json().lines as { label: string; kind: string }[]).map((line) => `${line.kind}:${line.label}`);
    expect(labels).toContain("refusal:Yetkazilmadi");
    expect(labels.some((label) => label.startsWith("return:")), "aktda 'Qaytarish' emas").toBe(false);
    await expectTrialBalance();
    await expectInventoryMatchesLedger();
  });
});

describe("Sotuvdan keyingi qaytarish: tovar holati", () => {
  async function shippedOrder(quantity: string) {
    const created = await call(owner(), "POST", "/api/sales/orders", {
      customerId: company.customerId,
      warehouseId: company.warehouseId,
      orderDate: new Date().toISOString().slice(0, 10),
      deliveryRequired: false,
      items: [{ productId: company.productId, quantity }],
    });
    expect(created.statusCode, created.body).toBe(201);
    const order = created.json().order as { id: string };
    expect((await call(owner(), "POST", `/api/sales/orders/${order.id}/confirm`)).statusCode).toBe(200);
    const ship = await call(owner(), "POST", `/api/sales/orders/${order.id}/ship`);
    expect(ship.statusCode, ship.body).toBe(200);
    const detail = (await call(owner(), "GET", `/api/sales/orders/${order.id}`)).json().order as { items: { id: string }[] };
    return { orderId: order.id, itemId: detail.items[0]!.id };
  }

  it("sotuvga, shikastlangan va karantin: ombor, 5500 va 1200 mos; karantin alohida omborda", async () => {
    const quarantine = (await call(owner(), "POST", "/api/inventory/warehouses", { name: "Karantin", code: "WH-Q" })).json().warehouse as { id: string };
    const { orderId, itemId } = await shippedOrder("5");
    const mainBefore = await qty(company.warehouseId);
    const expenseBefore = Number(await ledger("5500"));

    // Bitta qator — bitta holat: uch marta qaytariladi
    const sellable = await call(owner(), "POST", `/api/sales/orders/${orderId}/return-items`, { items: [{ orderItemId: itemId, quantity: "1" }], refundMethod: "balance" });
    expect(sellable.statusCode, sellable.body).toBe(201);
    const damaged = await call(owner(), "POST", `/api/sales/orders/${orderId}/return-items`, {
      items: [{ orderItemId: itemId, quantity: "1" }],
      refundMethod: "balance",
      dispositions: [{ orderItemId: itemId, disposition: "damaged" }],
      reason: "Qadog'i yirtilgan",
    });
    expect(damaged.statusCode, damaged.body).toBe(201);
    const quarantined = await call(owner(), "POST", `/api/sales/orders/${orderId}/return-items`, {
      items: [{ orderItemId: itemId, quantity: "1" }],
      refundMethod: "balance",
      dispositions: [{ orderItemId: itemId, disposition: "quarantine", warehouseId: quarantine.id }],
    });
    expect(quarantined.statusCode, quarantined.body).toBe(201);

    expect(await qty(company.warehouseId), "faqat sotuvga yaroqlisi asosiy omborga").toBe(mainBefore + 1);
    expect(await qty(quarantine.id), "karantin alohida").toBe(1);
    // Shikastlangan: tannarxi (3000) boshqa xarajatga
    expect(Number(await ledger("5500")) - expenseBefore).toBe(3000);
    const items = await db.select().from(salesReturnItems).where(eq(salesReturnItems.companyId, company.companyId));
    expect(items.map((row) => row.disposition).sort()).toEqual(["damaged", "quarantine", "sellable"]);
    const docs = await db.select().from(salesReturns).where(eq(salesReturns.companyId, company.companyId));
    expect(docs.every((row) => row.kind === "return" && row.number.startsWith("QR-"))).toBe(true);
    await expectTrialBalance();
    await expectInventoryMatchesLedger();
  });

  it("karantin ombori ko'rsatilmasa yoki o'sha ombor bo'lsa — rad, hech narsa yozilmaydi", async () => {
    const { orderId, itemId } = await shippedOrder("2");
    const before = await qty(company.warehouseId);
    const noWarehouse = await call(owner(), "POST", `/api/sales/orders/${orderId}/return-items`, {
      items: [{ orderItemId: itemId, quantity: "1" }],
      refundMethod: "balance",
      dispositions: [{ orderItemId: itemId, disposition: "quarantine" }],
    });
    expect(noWarehouse.statusCode).toBe(400);
    const same = await call(owner(), "POST", `/api/sales/orders/${orderId}/return-items`, {
      items: [{ orderItemId: itemId, quantity: "1" }],
      refundMethod: "balance",
      dispositions: [{ orderItemId: itemId, disposition: "supplier_return", warehouseId: company.warehouseId }],
    });
    expect(same.statusCode).toBe(400);
    expect(await qty(company.warehouseId)).toBe(before);
    expect(await db.select().from(salesReturns).where(eq(salesReturns.companyId, company.companyId))).toEqual([]);
  });
});
