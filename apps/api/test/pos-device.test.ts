import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { auditLogs } from "../src/db/schema/platform.js";
import { posDevices, posSyncOperations } from "../src/db/schema/pos.js";
import { posShifts } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PATCH";

let app: FastifyInstance;
let adminCookie: string;
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
  adminCookie = (await signedIn(app, { isPlatformAdmin: true })).cookie;
  company = await createCompany(app, adminCookie, { name: "Bonnu" });
  mainWarehouseId = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
});

const web = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const device = (token: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
const setup = (path: "options" | "register", payload: object) => app.inject({ method: "POST", url: `/api/pos-device/setup/${path}`, payload });
const actionCount = (action: string) => db.$count(auditLogs, eq(auditLogs.action, action));

async function register(owner: Company, name: string, warehouseId: string) {
  const res = await setup("register", { phone: owner.owner.phone, password: owner.owner.password, warehouseId, name, appVersion: "0.1.0", platform: "win32" });
  expect(res.statusCode).toBe(201);
  return res.json() as { token: string; device: { id: string; code: string } };
}

async function product(owner: Company, name: string, sku: string, salesPrice = "10000") {
  const res = await web(owner.ownerCookie, "POST", "/api/catalog/products", { name, sku, baseUnitId: piece, salesPrice, taxRate: "0" });
  expect(res.statusCode).toBe(201);
  return res.json().product.id as string;
}

const receive = (owner: Company, productId: string, warehouseId: string, quantity: string) =>
  web(owner.ownerCookie, "POST", "/api/inventory/stock/movements", { type: "receive", productId, warehouseId, quantity, costPrice: "1000" });

describe("Desktop kassa qurilmasi", () => {
  it("ro'yxatdan o'tkazish: ruxsat, ombor tanlash, K01/K02, token faqat xesh; web ro'yxati va o'chirish", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    expect((await setup("options", { phone: company.owner.phone, password: "xato-parol" })).statusCode).toBe(401);
    expect((await setup("options", { phone: kassir.phone, password: "xodim-parol-123" })).statusCode).toBe(403);

    const options = await setup("options", { phone: company.owner.phone, password: company.owner.password });
    expect(options.statusCode).toBe(200);
    expect(options.json().company).toMatchObject({ id: company.companyId, name: "Bonnu" });
    expect(options.json().warehouses.map((w: { id: string }) => w.id)).toEqual([mainWarehouseId]);

    const first = await register(company, "Kassa 1", mainWarehouseId);
    expect(first.token).toMatch(/^bumpos_/);
    expect(first.device).toMatchObject({ code: "K01", name: "Kassa 1", warehouseId: mainWarehouseId });
    const second = await register(company, "Kassa 2", mainWarehouseId);
    expect(second.device.code).toBe("K02");
    const [stored] = await db.select().from(posDevices).where(eq(posDevices.id, first.device.id));
    expect(stored!.tokenHash).toHaveLength(64);
    expect(stored!.tokenHash).not.toContain(first.token.slice(7, 20));

    const session = await device(first.token, "GET", "/api/pos-device/session");
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({ device: { code: "K01" }, company: { id: company.companyId, currency: "UZS" } });
    expect((await app.inject({ method: "GET", url: "/api/pos-device/session" })).statusCode).toBe(401);
    expect((await device("bumpos_notatoken", "GET", "/api/pos-device/session")).statusCode).toBe(401);
    expect((await web(company.ownerCookie, "GET", "/api/pos-device/session")).statusCode).toBe(401);

    const list = await web(company.ownerCookie, "GET", "/api/pos/devices");
    expect(list.json().devices.map((d: { code: string }) => d.code)).toEqual(["K01", "K02"]);
    expect(JSON.stringify(list.json())).not.toContain("token");
    expect((await web(kassir.cookie, "GET", "/api/pos/devices")).statusCode).toBe(403);

    expect((await web(company.ownerCookie, "PATCH", `/api/pos/devices/${first.device.id}`, { isActive: false })).statusCode).toBe(200);
    expect((await device(first.token, "GET", "/api/pos-device/session")).statusCode).toBe(401);
    expect((await device(second.token, "GET", "/api/pos-device/session")).statusCode).toBe(200);
    expect(await actionCount("POS_DEVICE_REGISTERED")).toBe(2);
    expect(await actionCount("POS_DEVICE_DEACTIVATED")).toBe(1);

    // Boshqa kompaniya qurilmani o'zgartira olmaydi
    const other = await createCompany(app, adminCookie, { name: "Boshqa" });
    expect((await web(other.ownerCookie, "PATCH", `/api/pos/devices/${second.device.id}`, { isActive: false })).statusCode).toBe(404);
  });

  it("pull: sahifalab, kursordan keyingi o'zgarishlar, faqat qurilma ombori qoldig'i, kompaniya izolyatsiyasi, kassirlar", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const { token } = await register(company, "Kassa 1", mainWarehouseId);
    const cola = await product(company, "Coca Cola 1L", "COLA");
    const pepsi = await product(company, "Pepsi 1L", "PEPSI", "8000");
    await receive(company, cola, mainWarehouseId, "10");
    const filial = (await web(company.ownerCookie, "POST", "/api/inventory/warehouses", { name: "Filial", code: "FIL" })).json().warehouse.id as string;
    await receive(company, pepsi, filial, "5");

    type PullResponse = {
      entities: Record<string, { rows: { id: string }[]; cursor: { t: string; id: string } | null; more: boolean }>;
      more: boolean;
    };
    const pull = async (cursors: Record<string, { t: string; id: string } | null>, limit?: number) => {
      const clean = Object.fromEntries(Object.entries(cursors).filter(([, value]) => value !== null));
      const res = await device(token, "POST", "/api/pos-device/pull", { cursors: clean, ...(limit ? { limit } : {}) });
      expect(res.statusCode).toBe(200);
      return res.json() as PullResponse;
    };

    // Sahifalab: bittadan, "more" tugaguncha
    let cursors: Record<string, { t: string; id: string } | null> = {};
    const productIds: string[] = [];
    let rounds = 0;
    for (;;) {
      const page = await pull(cursors, 1);
      productIds.push(...page.entities.products!.rows.map((row) => row.id));
      cursors = Object.fromEntries(Object.entries(page.entities).map(([name, value]) => [name, value.cursor]));
      rounds += 1;
      if (!page.more || rounds > 30) break;
    }
    expect(productIds.sort()).toEqual([cola, pepsi].sort());

    const full = await pull({});
    expect(full.entities.stockLevels!.rows).toEqual([expect.objectContaining({ productId: cola, warehouseId: mainWarehouseId, quantity: "10.0000" })]);
    expect(full.entities.warehouses!.rows).toHaveLength(2);
    const cashiers = full.entities.cashiers!.rows as unknown as { userId: string; active: boolean; permissions: string[] }[];
    expect(cashiers.find((c) => c.userId === kassir.id)).toMatchObject({ active: true });
    expect(cashiers.find((c) => c.userId === kassir.id)!.permissions).toContain("pos.use");
    expect(JSON.stringify(full)).not.toMatch(/pinHash|passwordHash|argon2/);

    // Kursordan keyin faqat o'zgargan mahsulot
    const latest = Object.fromEntries(Object.entries(full.entities).map(([name, value]) => [name, value.cursor]));
    expect((await web(company.ownerCookie, "PATCH", `/api/catalog/products/${cola}`, { salesPrice: "12000" })).statusCode).toBe(200);
    const delta = await pull(latest);
    expect(delta.entities.products!.rows).toEqual([expect.objectContaining({ id: cola, salesPrice: "12000.0000" })]);
    expect(delta.entities.units!.rows).toEqual([]);
    expect(delta.entities.customers!.rows).toEqual([]);

    // Boshqa kompaniya qurilmasi bu kompaniya ma'lumotini olmaydi
    const other = await createCompany(app, adminCookie, { name: "Boshqa" });
    const otherWarehouse = (await db.select().from(warehouses).where(eq(warehouses.companyId, other.companyId)))[0]!.id;
    const foreign = await register(other, "Begona kassa", otherWarehouse);
    const foreignPull = (await device(foreign.token, "POST", "/api/pos-device/pull", {})).json() as PullResponse;
    expect(foreignPull.entities.products!.rows).toEqual([]);
    expect(foreignPull.entities.stockLevels!.rows).toEqual([]);

    expect((await device(token, "POST", "/api/pos-device/pull", { cursors: { products: { t: "yesterday", id: randomUUID() } } })).statusCode).toBe(400);
  });

  it("push: smena offline ID va vaqt bilan, takroriy yuborish bitta natija, bir omborda ikki kassa, rad etishlar saqlanadi", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const one = await register(company, "Kassa 1", mainWarehouseId);
    const two = await register(company, "Kassa 2", mainWarehouseId);

    const login = await device(one.token, "POST", "/api/pos-device/cashiers/login", { phone: kassir.phone, password: "xodim-parol-123" });
    expect(login.statusCode).toBe(200);
    expect(login.json().cashier).toMatchObject({ id: kassir.id, role: "Kassir" });
    expect(login.json().cashier.permissions).toContain("pos.use");
    expect((await device(one.token, "POST", "/api/pos-device/cashiers/login", { phone: kassir.phone, password: "xato" })).statusCode).toBe(401);

    const push = async (token: string, ops: object[]) => {
      const res = await device(token, "POST", "/api/pos-device/push", { ops });
      expect(res.statusCode).toBe(200);
      return res.json().results as { opId: string | null; status: string; duplicate?: boolean; result?: Record<string, unknown>; error?: { code: string; details?: unknown } }[];
    };
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

    const shiftId = randomUUID();
    const openOp = { opId: randomUUID(), type: "shift.open", cashierId: kassir.id, createdAt: at(30), payload: { shiftId, openingCash: "50000" } };
    const [opened] = await push(one.token, [openOp]);
    expect(opened).toMatchObject({ opId: openOp.opId, status: "applied", result: { shiftId } });
    const [shift] = await db.select().from(posShifts).where(eq(posShifts.id, shiftId));
    expect(shift).toMatchObject({ deviceId: one.device.id, cashierId: kassir.id, status: "open", openingCash: "50000.00" });
    expect(Math.abs(shift!.openedAt.getTime() - Date.parse(openOp.createdAt))).toBeLessThan(1000);

    // Takroriy yuborish — o'sha natija, ikkinchi smena yaratilmaydi
    const [again] = await push(one.token, [openOp]);
    expect(again).toMatchObject({ status: "applied", duplicate: true, result: { shiftId } });
    expect(await db.$count(posShifts)).toBe(1);

    // Bir omborda ikkinchi kassa o'z smenasini ochadi; web kassaga desktop smenasi ko'rinmaydi
    const secondShift = randomUUID();
    const [openedTwo] = await push(two.token, [
      { opId: randomUUID(), type: "shift.open", cashierId: company.owner.id, createdAt: at(10), payload: { shiftId: secondShift, openingCash: "0" } },
    ]);
    expect(openedTwo!.status).toBe("applied");
    expect((await web(company.ownerCookie, "GET", `/api/sales/pos/shifts/open?warehouseId=${mainWarehouseId}`)).json().shift).toBeNull();

    // Boshqa kassa bu smenani yopa olmaydi; rad etish saqlanadi va takrorda o'sha javob
    const foreignClose = { opId: randomUUID(), type: "shift.close", cashierId: company.owner.id, createdAt: at(5), payload: { shiftId, closingCash: "50000" } };
    const [rejected] = await push(two.token, [foreignClose]);
    expect(rejected).toMatchObject({ status: "rejected", error: { code: "NOT_FOUND" } });
    expect((await push(two.token, [foreignClose]))[0]).toMatchObject({ status: "rejected", duplicate: true });

    // Bitta so'rovda bir nechta amal: noto'g'ri, kelajak vaqt, boshqa kompaniya kassiri, to'g'ri yopish
    const other = await createCompany(app, adminCookie, { name: "Boshqa" });
    const results = await push(one.token, [
      { opId: "not-a-uuid", type: "shift.close" },
      { opId: randomUUID(), type: "shift.close", cashierId: kassir.id, createdAt: at(1), payload: { shiftId } },
      { opId: randomUUID(), type: "shift.close", cashierId: kassir.id, createdAt: new Date(Date.now() + 3_600_000).toISOString(), payload: { shiftId, closingCash: "1" } },
      { opId: randomUUID(), type: "shift.close", cashierId: other.owner.id, createdAt: at(1), payload: { shiftId, closingCash: "1" } },
      { opId: randomUUID(), type: "shift.close", cashierId: kassir.id, createdAt: at(1), payload: { shiftId, closingCash: "50000" } },
    ]);
    expect(results.map((r) => r.status)).toEqual(["invalid", "rejected", "rejected", "rejected", "applied"]);
    expect(results[1]!.error!.code).toBe("BAD_REQUEST");
    expect(results[2]!.error).toMatchObject({ details: { reason: "clock_future" } });
    expect(results[3]!.error!.code).toBe("FORBIDDEN");
    expect(results[4]!.result).toMatchObject({ shiftId, expectedCash: "50000.00", difference: "0.00" });
    expect((await db.select().from(posShifts).where(eq(posShifts.id, shiftId)))[0]!.status).toBe("closed");

    expect(await db.$count(posSyncOperations, eq(posSyncOperations.status, "applied"))).toBe(3);
    expect(await db.$count(posSyncOperations, eq(posSyncOperations.status, "rejected"))).toBe(4);
    expect((await device(one.token, "POST", "/api/pos-device/push", { ops: [] })).statusCode).toBe(400);
  });
});
