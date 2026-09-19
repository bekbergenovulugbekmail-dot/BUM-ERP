/**
 * Ishonchli qurilmalar: bir odamda bir nechta telefon/noutbuk bo'ladi.
 *
 *  - foydalanuvchi O'ZINING yangi qurilmasini ishonchli qurilmadan turib tasdiqlaydi (rahbarni kutmaydi);
 *  - rahbardan tashqari `devices.manage` ruxsatiga ega xodim (masalan, HR menejeri) ham tasdiqlaydi;
 *  - begona qurilmani hech kim tasdiqlay olmaydi va ruxsatsiz xodim ham tasdiqlay olmaydi.
 */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../src/db/client.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, login, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let adminCookie: string;
let company: Awaited<ReturnType<typeof createCompany>>;

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
  company = await createCompany(app, adminCookie, { name: "Qurilmalar" });
});

/** Berilgan qurilma identifikatori bilan kirish. */
const loginWithDevice = (phone: string, password: string, deviceId: string) =>
  app.inject({ method: "POST", url: "/api/auth/login", headers: { "x-device-id": deviceId }, payload: { phone, password } });

const call = (cookie: string, method: "GET" | "POST", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

describe("O'zining ishonchli qurilmalari", () => {
  it("ikkinchi qurilma tasdiq kutadi; foydalanuvchi uni birinchi qurilmadan turib o'zi tasdiqlaydi", async () => {
    const worker = await addEmployee(app, company, "Kassir");
    const password = "xodim-parol-123";

    // Birinchi qurilma — avtomatik ishonchli
    const first = await loginWithDevice(worker.phone, password, "telefon-1");
    expect(first.statusCode).toBe(200);
    const firstCookie = `bum_session=${first.cookies.find((c) => c.name === "bum_session")!.value}`;

    // Ikkinchi qurilma (noutbuk) — kirish berilmaydi
    const second = await loginWithDevice(worker.phone, password, "noutbuk-1");
    expect(second.statusCode, "yangi qurilma tasdiq kutadi").toBe(403);

    // O'z qurilmalari ro'yxatida ikkalasi ham ko'rinadi
    const list = await call(firstCookie, "GET", "/api/auth/devices");
    expect(list.statusCode, list.body).toBe(200);
    const devices = list.json().devices as { id: string; status: string }[];
    expect(devices).toHaveLength(2);
    const pending = devices.find((device) => device.status === "pending");
    expect(pending, "ikkinchi qurilma 'pending' bo'lishi kerak").toBeTruthy();

    // O'zi tasdiqlaydi — rahbar kerak emas
    const approved = await call(firstCookie, "POST", `/api/auth/devices/${pending!.id}`, { status: "approved" });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json().device.status).toBe("approved");

    // Endi noutbukdan kirish ochiq
    expect((await loginWithDevice(worker.phone, password, "noutbuk-1")).statusCode).toBe(200);

    // Bekor qilinsa — yana yopiladi
    const revoked = await call(firstCookie, "POST", `/api/auth/devices/${pending!.id}`, { status: "revoked" });
    expect(revoked.statusCode).toBe(200);
    expect((await loginWithDevice(worker.phone, password, "noutbuk-1")).statusCode).toBe(403);
  });

  it("rahbar ham o'zining 2-3 qurilmasini o'zi ochadi", async () => {
    const { phone, password } = company.owner;
    const first = await loginWithDevice(phone, password, "ega-telefon");
    expect(first.statusCode).toBe(200);
    const cookie = `bum_session=${first.cookies.find((c) => c.name === "bum_session")!.value}`;

    expect((await loginWithDevice(phone, password, "ega-noutbuk")).statusCode).toBe(403);
    const devices = (await call(cookie, "GET", "/api/auth/devices")).json().devices as { id: string; status: string }[];
    const pending = devices.find((device) => device.status === "pending")!;
    expect((await call(cookie, "POST", `/api/auth/devices/${pending.id}`, { status: "approved" })).statusCode).toBe(200);
    expect((await loginWithDevice(phone, password, "ega-noutbuk")).statusCode).toBe(200);

    // Uchinchi qurilma (planshet) ham xuddi shunday
    expect((await loginWithDevice(phone, password, "ega-planshet")).statusCode).toBe(403);
    const again = (await call(cookie, "GET", "/api/auth/devices")).json().devices as { id: string; status: string }[];
    const tablet = again.find((device) => device.status === "pending")!;
    expect((await call(cookie, "POST", `/api/auth/devices/${tablet.id}`, { status: "approved" })).statusCode).toBe(200);
    expect((await loginWithDevice(phone, password, "ega-planshet")).statusCode).toBe(200);
  });

  it("begona odamning qurilmasini tasdiqlab bo'lmaydi", async () => {
    const worker = await addEmployee(app, company, "Kassir");
    const other = await addEmployee(app, company, "Omborchi");
    await loginWithDevice(worker.phone, "xodim-parol-123", "telefon-1");
    await loginWithDevice(worker.phone, "xodim-parol-123", "telefon-2");

    const ownerDevices = await call(company.ownerCookie, "GET", `/api/company/employees/${worker.id}/devices`);
    expect(ownerDevices.statusCode).toBe(200);
    const pending = (ownerDevices.json().devices as { id: string; status: string }[]).find((d) => d.status === "pending")!;

    // Boshqa xodim o'z ro'yxatiga qo'shib tasdiqlay olmaydi (qurilma uniki emas)
    const res = await call(other.cookie, "POST", `/api/auth/devices/${pending.id}`, { status: "approved" });
    expect(res.statusCode, "begona qurilma topilmasligi kerak").toBe(400);
  });
});

describe("Rahbardan boshqa xodim ham qurilma ocha oladi", () => {
  it("HR menejeri tasdiqlaydi; kassirda bu ruxsat yo'q", async () => {
    const worker = await addEmployee(app, company, "Kassir");
    const hr = await addEmployee(app, company, "HR menejeri");
    const cashier = await addEmployee(app, company, "Kassir");

    await loginWithDevice(worker.phone, "xodim-parol-123", "telefon-1");
    expect((await loginWithDevice(worker.phone, "xodim-parol-123", "telefon-2")).statusCode).toBe(403);

    // HR menejeri ro'yxatni ko'radi va tasdiqlaydi
    const list = await call(hr.cookie, "GET", `/api/company/employees/${worker.id}/devices`);
    expect(list.statusCode, list.body).toBe(200);
    const pending = (list.json().devices as { id: string; status: string }[]).find((d) => d.status === "pending")!;
    const approved = await call(hr.cookie, "POST", `/api/company/employees/${worker.id}/devices/${pending.id}`, { status: "approved" });
    expect(approved.statusCode, approved.body).toBe(200);
    expect((await loginWithDevice(worker.phone, "xodim-parol-123", "telefon-2")).statusCode).toBe(200);

    // Kassirda qurilmalarni boshqarish yo'q
    expect((await call(cashier.cookie, "GET", `/api/company/employees/${worker.id}/devices`)).statusCode).toBe(403);
  });
});
