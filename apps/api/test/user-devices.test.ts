/**
 * Ishonchli qurilmalar: birinchi qurilma avtomatik, ikkinchisi egasi tasdiqlamaguncha kira olmaydi.
 * Parol to'g'ri bo'lsa ham qurilma tasdiqlanmagan bo'lsa kirish berilmaydi.
 */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../src/db/client.js";
import { buildServer } from "../src/server.js";
import { createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type DeviceRow = { id: string; name: string; status: "pending" | "approved" | "revoked" };

let app: FastifyInstance;
let company: Company;
let staffUserId = "";

const STAFF_PHONE = "+998901234567";
const PASSWORD = "Xodim-parol-9911";

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
  company = await createCompany(app, admin.cookie, { name: "Qurilma kompaniyasi" });

  const created = await app.inject({
    method: "POST",
    url: "/api/company/employees",
    headers: { cookie: company.ownerCookie },
    payload: { phone: STAFF_PHONE, password: PASSWORD, name: "Kassir Ali", role: "Kassir" },
  });
  expect(created.statusCode, created.body).toBe(201);

  const list = await app.inject({ method: "GET", url: "/api/company/employees", headers: { cookie: company.ownerCookie } });
  const found = (list.json().employees as { id: string; phone: string }[]).find((row) => row.phone === STAFF_PHONE);
  staffUserId = found!.id;
});

/** `device` berilmasa — sarlavhasiz so'rov (yangilanmagan eski mijoz). */
const login = (device?: string) =>
  app.inject({
    method: "POST",
    url: "/api/auth/login",
    ...(device ? { headers: { "x-device-id": device } } : {}),
    payload: { phone: STAFF_PHONE, password: PASSWORD },
  });

const listDevices = async (): Promise<DeviceRow[]> => {
  const res = await app.inject({
    method: "GET",
    url: `/api/company/employees/${staffUserId}/devices`,
    headers: { cookie: company.ownerCookie },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().devices as DeviceRow[];
};

const setStatus = (deviceRowId: string, status: "approved" | "revoked", name?: string) =>
  app.inject({
    method: "POST",
    url: `/api/company/employees/${staffUserId}/devices/${deviceRowId}`,
    headers: { cookie: company.ownerCookie },
    payload: { status, ...(name ? { name } : {}) },
  });

describe("Ishonchli qurilmalar", () => {
  it("birinchi qurilma avtomatik ishonchli, ikkinchisi tasdiq so'raydi", async () => {
    expect((await login("device-aaa-1111")).statusCode).toBe(200);
    // Ayni qurilmadan qayta kirish — muammosiz
    expect((await login("device-aaa-1111")).statusCode).toBe(200);

    // Boshqa qurilmadan: login va parol to'g'ri, lekin kirish yo'q
    const second = await login("device-bbb-2222");
    expect(second.statusCode, second.body).toBe(403);
    expect(second.json().details).toMatchObject({ reason: "device_not_approved" });

    const rows = await listDevices();
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.status === "approved")).toHaveLength(1);
    expect(rows.filter((row) => row.status === "pending")).toHaveLength(1);
  });

  it("egasi tasdiqlagandan keyin yangi qurilma kiradi", async () => {
    await login("device-aaa-1111");
    expect((await login("device-ccc-3333")).statusCode).toBe(403);

    const pending = (await listDevices()).find((row) => row.status === "pending")!;
    const approved = await setStatus(pending.id, "approved", "Ulugbek telefoni");
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json().device).toMatchObject({ status: "approved", name: "Ulugbek telefoni" });

    expect((await login("device-ccc-3333")).statusCode).toBe(200);
  });

  it("bekor qilingan qurilma qayta kira olmaydi", async () => {
    await login("device-aaa-1111");
    const first = (await listDevices())[0]!;
    expect((await setStatus(first.id, "revoked")).statusCode).toBe(200);

    const blocked = await login("device-aaa-1111");
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().message).toContain("bekor qilingan");
  });

  it("qurilma sarlavhasi yuborilmasa eski mijoz kira oladi (moslik)", async () => {
    expect((await login()).statusCode).toBe(200);
    // Sarlavhasiz kirish qurilma yozmaydi
    expect(await listDevices()).toHaveLength(0);
  });

  it("boshqa kompaniya xodimining qurilmalarini ko'rib bo'lmaydi", async () => {
    const admin = await signedIn(app, { isPlatformAdmin: true });
    const stranger = await createCompany(app, admin.cookie, { name: "Begona" });
    const res = await app.inject({
      method: "GET",
      url: `/api/company/employees/${staffUserId}/devices`,
      headers: { cookie: stranger.ownerCookie },
    });
    expect(res.statusCode).toBe(400);
  });
});
