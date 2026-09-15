import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { compareVersions, desktopUpdate } from "../src/modules/pos-device/app-update.service.js";
import { buildServer } from "../src/server.js";
import { createCompany, resetDatabase, signedIn } from "./helpers.js";

const ENV_KEYS = ["DESKTOP_LATEST_VERSION", "DESKTOP_DOWNLOAD_URL", "DESKTOP_SHA256", "DESKTOP_MIN_VERSION", "DESKTOP_RELEASE_NOTES"] as const;
const SHA = "a".repeat(64);

let app: FastifyInstance;
let token: string;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

beforeEach(async () => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  await resetDatabase();
  const adminCookie = (await signedIn(app, { isPlatformAdmin: true })).cookie;
  const company = await createCompany(app, adminCookie, { name: "Bonnu" });
  const warehouseId = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  const res = await app.inject({
    method: "POST",
    url: "/api/pos-device/setup/register",
    payload: { phone: company.owner.phone, password: company.owner.password, warehouseId, name: "Kassa 1" },
  });
  token = (res.json() as { token: string }).token;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const check = (version: string) => app.inject({ method: "GET", url: "/api/pos-device/app-update", headers: { authorization: `Bearer ${token}`, "x-app-version": version } });

describe("Desktop kassa: yangilanish va obuna holati", () => {
  it("versiya taqqoslash, sozlanmagan/xavfsiz bo'lmagan reliz, majburiy yangilanish; sessiya va pull'da obuna holati", async () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
    expect(desktopUpdate("0.1.0", { DESKTOP_LATEST_VERSION: "0.2.0", DESKTOP_DOWNLOAD_URL: "http://x/setup.exe", DESKTOP_SHA256: SHA })).toMatchObject({ configured: false });
    expect(desktopUpdate("0.1.0", { DESKTOP_LATEST_VERSION: "0.2.0", DESKTOP_DOWNLOAD_URL: "https://x/setup.exe", DESKTOP_SHA256: "abc" })).toMatchObject({ configured: false });

    for (const key of ENV_KEYS) delete process.env[key];
    expect((await check("0.1.0")).json().update).toMatchObject({ configured: false, available: false });

    process.env.DESKTOP_LATEST_VERSION = "0.2.0";
    process.env.DESKTOP_DOWNLOAD_URL = "https://releases.bum-erp.uz/BUM-POS-KASSA-Setup-0.2.0.exe";
    process.env.DESKTOP_SHA256 = SHA.toUpperCase();
    process.env.DESKTOP_MIN_VERSION = "0.1.5";
    process.env.DESKTOP_RELEASE_NOTES = "Analitika va sozlamalar";
    expect((await check("0.1.0")).json().update).toEqual({
      configured: true,
      available: true,
      mandatory: true,
      current: "0.1.0",
      latest: "0.2.0",
      url: "https://releases.bum-erp.uz/BUM-POS-KASSA-Setup-0.2.0.exe",
      sha256: SHA,
      signature: null,
      notes: "Analitika va sozlamalar",
    });
    // Tashqi reliz imzosi muhit o'zgaruvchisidan; tekshiruvni kassa o'zi bajaradi
    process.env.DESKTOP_SIGNATURE = "imzo";
    expect((await check("0.1.0")).json().update).toMatchObject({ signature: "imzo" });
    expect((await check("0.1.7")).json().update).toMatchObject({ available: true, mandatory: false });
    expect((await check("0.2.0")).json().update).toMatchObject({ available: false, mandatory: false });
    expect((await app.inject({ method: "GET", url: "/api/pos-device/app-update" })).statusCode).toBe(401);

    const session = await app.inject({ method: "GET", url: "/api/pos-device/session", headers: { authorization: `Bearer ${token}` } });
    expect(session.json().company).toMatchObject({ status: expect.any(String), trialEndsAt: expect.toSatisfy((value: unknown) => value === null || typeof value === "string") });
    const pulled = await app.inject({ method: "POST", url: "/api/pos-device/pull", headers: { authorization: `Bearer ${token}` }, payload: {} });
    expect(pulled.json().company).toMatchObject({ status: session.json().company.status });
  });
});
