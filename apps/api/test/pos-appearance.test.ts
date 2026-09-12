import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let company: Awaited<ReturnType<typeof createCompany>>;
let token: string;

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
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Do'kon" });
  const warehouseId = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  const res = await app.inject({
    method: "POST",
    url: "/api/pos-device/setup/register",
    payload: { phone: company.owner.phone, password: company.owner.password, warehouseId, name: "Kassa 1" },
  });
  token = (res.json() as { token: string }).token;
});

const pull = async (configHash?: string) =>
  (await app.inject({ method: "POST", url: "/api/pos-device/pull", headers: { authorization: `Bearer ${token}` }, payload: configHash ? { configHash } : {} })).json() as {
    config: { hash: string; appearance: { locked: boolean; theme: string } } | null;
  };

describe("Kassa mavzusi: kompaniya qulfi", () => {
  it("standart — qulfsiz; rahbar qulflaydi (pos.devices.manage), kassir yo'q; qurilmaga config bilan boradi", async () => {
    const path = "/api/pos/devices/appearance";
    const owner = { cookie: company.ownerCookie };
    expect((await app.inject({ method: "GET", url: path, headers: owner })).json()).toEqual({ appearance: { locked: false, theme: "light" } });

    const before = await pull();
    expect(before.config!.appearance).toEqual({ locked: false, theme: "light" });

    const kassir = await addEmployee(app, company, "Kassir");
    expect((await app.inject({ method: "PUT", url: path, headers: { cookie: kassir.cookie }, payload: { locked: true, theme: "dark" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: path, headers: owner, payload: { locked: true, theme: "neon" } })).statusCode).toBe(400);
    const saved = await app.inject({ method: "PUT", url: path, headers: owner, payload: { locked: true, theme: "high-contrast" } });
    expect(saved.json()).toEqual({ appearance: { locked: true, theme: "high-contrast" } });

    // Sozlama o'zgardi — xesh boshqa, qurilma yangi config oladi; o'zgarmasa config null
    const after = await pull(before.config!.hash);
    expect(after.config).toMatchObject({ appearance: { locked: true, theme: "high-contrast" } });
    expect(after.config!.hash).not.toBe(before.config!.hash);
    expect((await pull(after.config!.hash)).config).toBeNull();
  });
});
