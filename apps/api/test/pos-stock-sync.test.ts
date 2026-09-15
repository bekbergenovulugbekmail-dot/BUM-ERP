import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { inventoryCountItems, inventoryCounts, stockLevels, stockMovements, warehouses } from "../src/db/schema/inventory.js";
import { posSyncConflicts } from "../src/db/schema/pos.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PATCH";
type PushResult = {
  opId: string | null;
  status: string;
  result?: Record<string, unknown>;
  error?: { code: string; message: string; details?: unknown };
};

let app: FastifyInstance;
let company: Company;
let piece: string;
let mainWarehouseId: string;

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
  const adminCookie = (await signedIn(app, { isPlatformAdmin: true })).cookie;
  company = await createCompany(app, adminCookie, { name: "Bonnu" });
  mainWarehouseId = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
});

const web = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const device = (token: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });

async function register(name: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/pos-device/setup/register",
    payload: { phone: company.owner.phone, password: company.owner.password, warehouseId: mainWarehouseId, name },
  });
  expect(res.statusCode).toBe(201);
  const body = res.json() as { token: string; device: { id: string; code: string } };
  // Ega kassada parol bilan kiradi — qurilma amallari faqat shu qurilmaga bog'langan kassir nomidan qabul qilinadi
  const login = await app.inject({ method: "POST", url: "/api/pos-device/cashiers/login", headers: { authorization: `Bearer ${body.token}` }, payload: { phone: company.owner.phone, password: company.owner.password } });
  expect(login.statusCode, login.body).toBe(200);
  return body;
}

async function product(name: string, sku: string, salesPrice = "10000") {
  const res = await web(company.ownerCookie, "POST", "/api/catalog/products", { name, sku, baseUnitId: piece, salesPrice, taxRate: "0" });
  expect(res.statusCode).toBe(201);
  return res.json().product.id as string;
}

async function push(token: string, ops: object[]) {
  const res = await device(token, "POST", "/api/pos-device/push", { ops });
  expect(res.statusCode).toBe(200);
  return res.json().results as PushResult[];
}

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const op = (type: string, cashierId: string, payload: object, minutesAgo = 1) => ({ opId: randomUUID(), type, cashierId, createdAt: at(minutesAgo), payload });
const item = (productId: string, quantity: string) => ({ productId, unitId: piece, quantity });

/** Web orqali kirim — o'tgan sana bilan. */
async function receive(productId: string, quantity: string, costPrice: string, minutesAgo: number) {
  const res = await web(company.ownerCookie, "POST", "/api/inventory/stock/movements", {
    type: "receive",
    productId,
    warehouseId: mainWarehouseId,
    quantity,
    costPrice,
    occurredAt: at(minutesAgo),
  });
  expect(res.statusCode).toBe(201);
}

async function stockOf(productId: string, warehouseId = mainWarehouseId) {
  const [level] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, warehouseId)));
  return level?.quantity;
}

describe("Desktop kassa: ombor hujjatlari va inventarizatsiya sinxroni", () => {
  it("stock.writeoff va stock.transfer: ko'p qatorli, qoldiq yetmasa nomuvofiqlik, jurnal, qabul qiluvchida tannarx; ruxsat; harakatlar va omborlar qoldig'i", async () => {
    const { token } = await register("Kassa 1");
    const owner = company.owner.id;
    const cola = await product("Cola", "COLA");
    const tea = await product("Choy", "TEA");
    await receive(cola, "10", "5000", 120);
    await receive(tea, "5", "2000", 120);
    const branch = await web(company.ownerCookie, "POST", "/api/inventory/warehouses", { name: "Filial", code: "F1" });
    expect(branch.statusCode).toBe(201);
    const branchId = branch.json().warehouse.id as string;

    // Choy 5 bor, 12 hisobdan chiqarildi — yoziladi, qoldiq manfiy va nomuvofiqlik; qiymat o'rtacha tannarxda
    const [writeoff] = await push(token, [
      op("stock.writeoff", owner, { writeoffId: randomUUID(), number: "K01-W000001", items: [item(cola, "3"), item(tea, "12")], reason: "Muddati o'tgan" }, 30),
    ]);
    expect(writeoff).toMatchObject({ status: "applied", result: { number: "K01-W000001", value: "39000.00", conflicts: ["stock_shortage"] } });
    expect(writeoff!.result!.journalEntryId).toEqual(expect.any(String));
    expect(await stockOf(cola)).toBe("7.0000");
    expect(await stockOf(tea)).toBe("-7.0000");
    const [shortage] = await db.select().from(posSyncConflicts).where(eq(posSyncConflicts.kind, "stock_shortage"));
    expect(shortage).toMatchObject({ referenceType: "stock_writeoff", details: { items: [{ productId: tea, requested: "12.0000", available: "5.0000" }] } });

    const transferId = randomUUID();
    const [transfer] = await push(token, [op("stock.transfer", owner, { transferId, number: "K01-T000001", toWarehouseId: branchId, items: [item(cola, "4")], notes: "Filialga" }, 20)]);
    expect(transfer).toMatchObject({ status: "applied", result: { number: "K01-T000001", toWarehouseId: branchId, value: "20000.00", conflicts: [] } });
    expect(await stockOf(cola)).toBe("3.0000");
    expect(await stockOf(cola, branchId)).toBe("4.0000");
    const [branchLevel] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, cola), eq(stockLevels.warehouseId, branchId)));
    expect(branchLevel!.avgCostPrice).toBe("5000.0000");
    expect((await db.select().from(stockMovements).where(eq(stockMovements.referenceId, transferId))).map((row) => row.type).sort()).toEqual(["transfer_in", "transfer_out"]);

    // Ruxsatsiz kassir; o'z omboriga ko'chirish; boshqa qurilma raqami
    const kassir = await addEmployee(app, company, "Kassir");
    const denied = await push(token, [
      op("stock.transfer", kassir.id, { transferId: randomUUID(), number: "K01-T000002", toWarehouseId: branchId, items: [item(cola, "1")] }),
      op("stock.transfer", owner, { transferId: randomUUID(), number: "K01-T000003", toWarehouseId: mainWarehouseId, items: [item(cola, "1")] }),
      op("stock.writeoff", kassir.id, { writeoffId: randomUUID(), number: "K01-W000002", items: [item(cola, "1")] }),
      op("stock.writeoff", owner, { writeoffId: randomUUID(), number: "K02-W000002", items: [item(cola, "1")] }),
    ]);
    expect(denied.map((row) => row.error?.code)).toEqual(["FORBIDDEN", "BAD_REQUEST", "FORBIDDEN", "BAD_REQUEST"]);
    expect(await stockOf(cola)).toBe("3.0000");

    // Qurilma: qurilma omboridagi harakatlar (yangisi birinchi), omborlar bo'yicha qoldiq, pull'da o'rtacha tannarx
    const movements = await device(token, "GET", `/api/pos-device/movements?productId=${cola}`);
    expect(movements.statusCode).toBe(200);
    expect(movements.json().movements.map((row: { type: string }) => row.type)).toEqual(["transfer_out", "writeoff", "receive"]);
    expect(movements.json().movements[0]).toMatchObject({ quantity: "-4.0000", notes: "K01-T000001: Filialga", productName: "Cola", unitName: "d" });
    const firstPage = await device(token, "GET", `/api/pos-device/movements?productId=${cola}&limit=2`);
    expect(firstPage.json().nextCursor).toEqual(expect.any(String));
    const secondPage = await device(token, "GET", `/api/pos-device/movements?productId=${cola}&limit=2&cursor=${encodeURIComponent(firstPage.json().nextCursor)}`);
    expect(secondPage.json()).toMatchObject({ movements: [expect.objectContaining({ type: "receive" })], nextCursor: null });

    const stock = await device(token, "GET", `/api/pos-device/stock/${cola}`);
    expect(stock.statusCode).toBe(200);
    expect(stock.json().stock).toHaveLength(2);
    expect(stock.json().stock).toEqual(expect.arrayContaining([expect.objectContaining({ warehouseId: branchId, warehouseCode: "F1", quantity: "4.0000" })]));
    expect((await device(token, "GET", `/api/pos-device/stock/${randomUUID()}`)).statusCode).toBe(404);

    const pulled = await device(token, "POST", "/api/pos-device/pull", {});
    expect(pulled.json().entities.stockLevels.rows).toEqual(expect.arrayContaining([expect.objectContaining({ productId: cola, quantity: "3.0000", avgCostPrice: "5000.0000" })]));
    // Etiketka shablonlari kassa sozlamasida (sozlanmagan kompaniyada — standart)
    expect(pulled.json().config.labels).toMatchObject({ defaultTemplateId: expect.any(String), templates: expect.arrayContaining([expect.objectContaining({ layout: expect.any(String) })]) });
  });

  it("stock.count: farq sanash lahzasidagi qoldiqqa nisbatan; kech kelgan oldingi chek va o'tgan sanali kirim sanoq bo'yicha tuzatiladi; band ID va ruxsat", async () => {
    const first = await register("Kassa 1");
    const second = await register("Kassa 2");
    expect(second.device.code).toBe("K02");
    const owner = company.owner.id;
    const juice = await product("Sharbat", "JUICE");
    await receive(juice, "10", "5000", 180);

    const shift = randomUUID();
    const sale = (number: string, quantity: string, minutesAgo: number) =>
      op(
        "sale.complete",
        owner,
        {
          saleId: randomUUID(),
          shiftId: shift,
          number,
          items: [{ id: randomUUID(), productId: juice, unitId: piece, quantity, unitPrice: "10000" }],
          paymentMethod: "cash",
          amountPaid: String(Number(quantity) * 10000),
        },
        minutesAgo,
      );

    // K02: sanashdan KEYINGI sotuv (2 dona) — inventarizatsiyadan oldin yetib keldi
    expect((await push(second.token, [op("shift.open", owner, { shiftId: shift, openingCash: "0" }, 150), sale("K02-000001", "2", 10)])).map((row) => row.status)).toEqual([
      "applied",
      "applied",
    ]);
    expect(await stockOf(juice)).toBe("8.0000");

    // K01: 30 daqiqa oldin 7 dona sanalgan. O'sha lahzada hisobda 10 edi → −3; keyingi sotuv saqlanadi → 5
    const countId = randomUUID();
    const [counted] = await push(first.token, [op("stock.count", owner, { countId, number: "K01-I000001", items: [{ productId: juice, countedQty: "7" }], notes: "Oylik" }, 30)]);
    expect(counted).toMatchObject({ status: "applied", result: { countId, number: "K01-I000001", adjusted: 1, surplus: "0.00", shortage: "15000.00", conflicts: [] } });
    expect(counted!.result!.journalEntryId).toEqual(expect.any(String));
    expect(await stockOf(juice)).toBe("5.0000");
    expect((await db.select().from(inventoryCounts).where(eq(inventoryCounts.id, countId)))[0]).toMatchObject({
      name: "K01-I000001",
      status: "completed",
      adjustmentsMade: true,
      notes: "Oylik",
    });
    expect((await db.select().from(inventoryCountItems).where(eq(inventoryCountItems.countId, countId)))[0]).toMatchObject({
      expectedQty: "10.0000",
      countedQty: "7.0000",
      difference: "-3.0000",
    });

    // K02: sanashdan OLDINGI sotuv (1 dona) kech keldi — sanoq uni hisobga olgan: sotuv yoziladi, qoldiq o'zgarmaydi
    const [late] = await push(second.token, [sale("K02-000002", "1", 60)]);
    expect(late).toMatchObject({ status: "applied", result: { conflicts: ["count_late_document"] } });
    expect(await stockOf(juice)).toBe("5.0000");
    const [lateConflict] = await db.select().from(posSyncConflicts).where(eq(posSyncConflicts.kind, "count_late_document"));
    expect(lateConflict).toMatchObject({ referenceType: "inventory_count", referenceId: countId, details: { items: [{ productId: juice, quantity: "1.0000", countName: "K01-I000001" }] } });
    expect(
      (await db.select().from(stockMovements).where(and(eq(stockMovements.referenceId, countId), eq(stockMovements.type, "count")))).map((row) => row.quantity).sort(),
    ).toEqual(["-3.0000", "1.0000"]);

    // Sanashdan keyingi kechikkan hujjat tuzatilmaydi
    const [afterCount] = await push(second.token, [sale("K02-000003", "1", 5)]);
    expect(afterCount).toMatchObject({ status: "applied", result: { conflicts: [] } });
    expect(await stockOf(juice)).toBe("4.0000");

    // Web: sanashdan oldingi sana bilan qo'lda kirim ham sanoq bo'yicha tuzatiladi
    await receive(juice, "2", "5000", 45);
    expect(await stockOf(juice)).toBe("4.0000");

    // Band identifikator; ruxsatsiz kassir
    const kassir = await addEmployee(app, company, "Kassir");
    const denied = await push(first.token, [
      op("stock.count", owner, { countId, number: "K01-I000002", items: [{ productId: juice, countedQty: "1" }] }),
      op("stock.count", kassir.id, { countId: randomUUID(), number: "K01-I000003", items: [{ productId: juice, countedQty: "1" }] }),
      op("stock.count", owner, { countId: randomUUID(), number: "K01-I000004", items: [{ productId: randomUUID(), countedQty: "1" }] }),
    ]);
    expect(denied.map((row) => row.error?.code)).toEqual(["CONFLICT", "FORBIDDEN", "BAD_REQUEST"]);
  });
});
