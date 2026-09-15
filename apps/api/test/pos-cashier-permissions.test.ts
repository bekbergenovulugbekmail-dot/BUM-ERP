import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { roles } from "../src/db/schema/platform.js";
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

type Cursor = { t: string; id: string };
type PullBody = {
  config: { hash: string } | null;
  entities: { cashiers: { rows: { userId: string; phone: string; permissions: string[]; active: boolean }[]; cursor: Cursor | null } };
};

const pull = async (configHash?: string, cursor?: Cursor | null) =>
  (
    await app.inject({
      method: "POST",
      url: "/api/pos-device/pull",
      headers: { authorization: `Bearer ${token}` },
      payload: { ...(configHash ? { configHash } : {}), ...(cursor ? { cursors: { cashiers: cursor } } : {}) },
    })
  ).json() as PullBody;

describe("Kassa: kassir ruxsatlari yangilanishi", () => {
  it("rol ruxsatlari a'zolik yozuvisiz o'zgarsa (rol tahriri, migratsiya) — config xeshi o'zgaradi va kassirlar qayta yuboriladi", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    // Qurilma kassirni userId bo'yicha saqlaydi; shu qurilmada ishlay olmaydigan xodimning telefoni yuborilmaydi
    const rowOf = (body: PullBody) => body.entities.cashiers.rows.find((row) => row.userId === kassir.id);

    const first = await pull();
    expect(rowOf(first)).toMatchObject({ active: true });
    expect(rowOf(first)!.permissions).toEqual(expect.arrayContaining(["pos.use", "scale.view", "currency_rates.view"]));

    // O'zgarish yo'q — config ham, kassirlar ham qayta kelmaydi
    const same = await pull(first.config!.hash, first.entities.cashiers.cursor);
    expect(same.config).toBeNull();
    expect(same.entities.cashiers.rows).toHaveLength(0);

    // Rol bevosita bazada o'zgardi: a'zolik va foydalanuvchi yozuvlariga tegilmadi
    await db
      .update(roles)
      .set({ permissions: sql`array_remove(${roles.permissions}, 'scale.view')` })
      .where(eq(roles.name, "Kassir"));

    const changed = await pull(first.config!.hash, first.entities.cashiers.cursor);
    expect(changed.config).not.toBeNull();
    expect(changed.config!.hash).not.toBe(first.config!.hash);
    expect(rowOf(changed)).toMatchObject({ active: true });
    expect(rowOf(changed)!.permissions).not.toContain("scale.view");
    // Egasi (to'liq ruxsat) ham qayta keladi
    expect(changed.entities.cashiers.rows.some((row) => row.phone === company.owner.phone)).toBe(true);

    // Yangi xesh bilan — takroriy yuborish yo'q
    const after = await pull(changed.config!.hash, changed.entities.cashiers.cursor);
    expect(after.config).toBeNull();
    expect(after.entities.cashiers.rows).toHaveLength(0);

    // pos.use olib tashlansa kassir shu qurilmada ishlay olmaydi
    await db
      .update(roles)
      .set({ permissions: sql`array_remove(${roles.permissions}, 'pos.use')` })
      .where(eq(roles.name, "Kassir"));
    expect(rowOf(await pull(changed.config!.hash, changed.entities.cashiers.cursor))).toMatchObject({ active: false });
  });
});
