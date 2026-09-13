/** Kassa qurilmasi o'zini uzishi va boshqa kompaniya foydalanuvchisining kassaga kirishi. */
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { auditLogs } from "../src/db/schema/platform.js";
import { posDevices } from "../src/db/schema/pos.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let adminCookie: string;

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
  adminCookie = (await signedIn(app, { isPlatformAdmin: true })).cookie;
});

async function device(company: Awaited<ReturnType<typeof createCompany>>) {
  const [warehouse] = await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId));
  const res = await app.inject({
    method: "POST",
    url: "/api/pos-device/setup/register",
    payload: { phone: company.owner.phone, password: company.owner.password, warehouseId: warehouse!.id, name: "Kassa 1" },
  });
  expect(res.statusCode).toBe(201);
  const token = (res.json() as { token: string }).token;
  return (method: "GET" | "POST", url: string, payload?: object) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
}

describe("Kassa qurilmasi: uzish va kassir kirishi", () => {
  it("qurilma o'zini uzadi: token bekor bo'ladi, audit yoziladi; obuna tugagan bo'lsa ham ishlaydi", async () => {
    const company = await createCompany(app, adminCookie, { name: "Bonnu" });
    const call = await device(company);
    expect((await call("POST", "/api/pos-device/unregister", {})).statusCode).toBe(200);
    expect((await call("GET", "/api/pos-device/session")).statusCode).toBe(401);
    const [row] = await db.select().from(posDevices).where(eq(posDevices.companyId, company.companyId));
    expect(row!.isActive).toBe(false);
    expect(
      await db.select().from(auditLogs).where(and(eq(auditLogs.action, "POS_DEVICE_UNREGISTERED"), eq(auditLogs.companyId, company.companyId))),
    ).toHaveLength(1);
  });

  it("boshqa kompaniya xodimi kassaga kira olmaydi — aniq sabab bilan; o'z xodimi kiradi", async () => {
    const bonnu = await createCompany(app, adminCookie, { name: "Bonnu Market" });
    const other = await createCompany(app, adminCookie, { name: "Hadicha Market" });
    const call = await device(bonnu);
    const stranger = await call("POST", "/api/pos-device/cashiers/login", { phone: other.owner.phone, password: other.owner.password });
    expect(stranger.statusCode).toBe(403);
    expect(stranger.json().message).toContain("«Bonnu Market» kompaniyasining faol xodimi emas");

    const kassir = await addEmployee(app, bonnu, "Kassir");
    const own = await call("POST", "/api/pos-device/cashiers/login", { phone: kassir.phone, password: "xodim-parol-123" });
    expect(own.statusCode).toBe(200);
  });
});
