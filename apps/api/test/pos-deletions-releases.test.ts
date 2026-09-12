import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { desktopReleaseChunks } from "../src/db/schema/pos.js";
import { RELEASE_CHUNK_BYTES } from "../src/modules/platform/desktop-releases.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

const ENV_KEYS = ["DESKTOP_LATEST_VERSION", "DESKTOP_DOWNLOAD_URL", "DESKTOP_SHA256", "DESKTOP_MIN_VERSION", "DESKTOP_RELEASE_NOTES"] as const;

let app: FastifyInstance;
let adminCookie: string;
let ownerCookie: string;
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
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  await resetDatabase();
  adminCookie = (await signedIn(app, { isPlatformAdmin: true })).cookie;
  const company = await createCompany(app, adminCookie, { name: "Bonnu" });
  ownerCookie = company.ownerCookie;
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

type Page = { rows: Record<string, unknown>[]; cursor: { t: string; id: string } | null };
const device = { authorization: () => `Bearer ${token}` };

async function pull(cursors: Record<string, { t: string; id: string }> = {}) {
  const res = await app.inject({ method: "POST", url: "/api/pos-device/pull", headers: { authorization: device.authorization() }, payload: { cursors } });
  expect(res.statusCode).toBe(200);
  return res.json() as { entities: Record<string, Page> };
}

const cursorsOf = (entities: Record<string, Page>) =>
  Object.fromEntries(Object.entries(entities).flatMap(([entity, page]) => (page.cursor ? [[entity, page.cursor]] : [])));

describe("Kassa sinxroni: serverda o'chirilgan yozuvlar", () => {
  it("o'chirilgan kategoriya va brend qurilmaga `deletions` bilan keladi, kursordan keyin takrorlanmaydi", async () => {
    const category = await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: ownerCookie }, payload: { name: "Ichimliklar" } });
    expect(category.statusCode).toBe(201);
    const categoryId = category.json().category.id as string;
    const brand = await app.inject({ method: "POST", url: "/api/catalog/brands", headers: { cookie: ownerCookie }, payload: { name: "Coca" } });
    expect(brand.statusCode).toBe(201);
    const brandId = brand.json().brand.id as string;

    const first = await pull();
    expect(first.entities.categories!.rows.map((row) => row.id)).toContain(categoryId);
    expect(first.entities.deletions!.rows).toEqual([]);

    expect((await app.inject({ method: "DELETE", url: `/api/catalog/categories/${categoryId}`, headers: { cookie: ownerCookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: `/api/catalog/brands/${brandId}`, headers: { cookie: ownerCookie } })).statusCode).toBe(200);

    const second = await pull(cursorsOf(first.entities));
    expect(second.entities.deletions!.rows).toEqual([
      { id: expect.any(String), entity: "categories", entityId: categoryId },
      { id: expect.any(String), entity: "brands", entityId: brandId },
    ]);
    const third = await pull(cursorsOf(second.entities));
    expect(third.entities.deletions!.rows).toEqual([]);
  });
});

describe("Desktop kassa relizlari (platforma admini → qurilma)", () => {
  const upload = (cookie: string, version: string, payload: Buffer, fileName = "BUM-POS-KASSA-Setup-0.2.0.exe") =>
    app.inject({
      method: "POST",
      url: `/api/platform/desktop-releases?version=${encodeURIComponent(version)}&fileName=${encodeURIComponent(fileName)}`,
      headers: { cookie, "content-type": "application/octet-stream" },
      payload,
    });
  const check = (version: string) =>
    app.inject({ method: "GET", url: "/api/pos-device/app-update", headers: { authorization: device.authorization(), "x-app-version": version } });

  it("yuklash (bo'laklab, SHA-256), tekshiruvlar, e'lon qilish, qurilma tokeni bilan yuklab olish, arxiv", async () => {
    const installer = Buffer.concat([Buffer.from("MZ"), randomBytes(RELEASE_CHUNK_BYTES * 2 + 1234)]);
    const sha256 = createHash("sha256").update(installer).digest("hex");

    expect((await upload(ownerCookie, "0.2.0", installer)).statusCode).toBe(403);
    expect((await upload(adminCookie, "0.2", installer)).statusCode).toBe(400);
    expect((await upload(adminCookie, "0.2.0", installer, "setup.zip")).statusCode).toBe(400);
    const notExe = await upload(adminCookie, "0.2.0", Buffer.from("PK zip emas"));
    expect(notExe.statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/platform/desktop-releases", headers: { cookie: adminCookie } })).json().releases).toEqual([]);

    const uploaded = await upload(adminCookie, "0.2.0", installer);
    expect(uploaded.statusCode).toBe(201);
    const release = uploaded.json().release as { id: string };
    expect(release).toMatchObject({ version: "0.2.0", fileName: "BUM-POS-KASSA-Setup-0.2.0.exe", size: installer.length, sha256, status: "draft" });
    const chunks = await db.select({ seq: desktopReleaseChunks.seq }).from(desktopReleaseChunks).where(eq(desktopReleaseChunks.releaseId, release.id));
    expect(chunks.map((chunk) => chunk.seq).sort()).toEqual([0, 1, 2]);
    expect((await upload(adminCookie, "0.2.0", installer)).statusCode).toBe(409);

    // E'lon qilinmagan — qurilmaga taklif qilinmaydi va yuklab bo'lmaydi
    expect((await check("0.1.0")).json().update).toMatchObject({ configured: false, available: false });
    expect((await app.inject({ method: "GET", url: "/api/pos/devices", headers: { cookie: ownerCookie } })).json().installer).toBeNull();
    const downloadUrl = `/api/pos-device/releases/${release.id}/download`;
    expect((await app.inject({ method: "GET", url: downloadUrl, headers: { authorization: device.authorization() } })).statusCode).toBe(404);

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/platform/desktop-releases/${release.id}`,
      headers: { cookie: adminCookie },
      payload: { notes: "Rus tili", minVersion: "0.1.5" },
    });
    expect(patched.json().release).toMatchObject({ notes: "Rus tili", minVersion: "0.1.5" });
    const published = await app.inject({ method: "POST", url: `/api/platform/desktop-releases/${release.id}/publish`, headers: { cookie: adminCookie } });
    expect(published.json().release).toMatchObject({ status: "published", publishedAt: expect.any(String) });

    // Bazadagi reliz muhit o'zgaruvchilaridan ustun
    process.env.DESKTOP_LATEST_VERSION = "9.9.9";
    process.env.DESKTOP_DOWNLOAD_URL = "https://releases.bum-erp.uz/old.exe";
    process.env.DESKTOP_SHA256 = "a".repeat(64);
    expect((await check("0.1.0")).json().update).toEqual({
      configured: true,
      available: true,
      mandatory: true,
      current: "0.1.0",
      latest: "0.2.0",
      url: downloadUrl,
      sha256,
      notes: "Rus tili",
    });
    expect((await check("0.2.0")).json().update).toMatchObject({ available: false, mandatory: false });

    expect((await app.inject({ method: "GET", url: downloadUrl })).statusCode).toBe(401);
    const downloaded = await app.inject({ method: "GET", url: downloadUrl, headers: { authorization: device.authorization() } });
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.headers["x-content-sha256"]).toBe(sha256);
    expect(downloaded.rawPayload.equals(installer)).toBe(true);

    // Web: yangi kassa o'rnatish uchun — `pos.devices.manage` bor foydalanuvchi yuklab oladi, kassir yo'q
    const devicesList = await app.inject({ method: "GET", url: "/api/pos/devices", headers: { cookie: ownerCookie } });
    expect(devicesList.json().installer).toMatchObject({ id: release.id, version: "0.2.0", size: installer.length, sha256, notes: "Rus tili" });
    const webDownloadUrl = `/api/pos/devices/installer/${release.id}/download`;
    const webDownload = await app.inject({ method: "GET", url: webDownloadUrl, headers: { cookie: ownerCookie } });
    expect(webDownload.statusCode).toBe(200);
    expect(webDownload.headers["content-disposition"]).toBe('attachment; filename="BUM-POS-KASSA-Setup-0.2.0.exe"');
    expect(webDownload.rawPayload.equals(installer)).toBe(true);
    const cashier = await addEmployee(app, { ownerCookie }, "Kassir");
    expect((await app.inject({ method: "GET", url: webDownloadUrl, headers: { cookie: cashier.cookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: webDownloadUrl })).statusCode).toBe(401);

    // Yangi reliz e'lon qilinsa oldingisi arxivga o'tadi
    const next = await upload(adminCookie, "0.3.0", Buffer.concat([Buffer.from("MZ"), randomBytes(1024)]), "BUM-POS-KASSA-Setup-0.3.0.exe");
    const nextId = next.json().release.id as string;
    await app.inject({ method: "POST", url: `/api/platform/desktop-releases/${nextId}/publish`, headers: { cookie: adminCookie } });
    const list = (await app.inject({ method: "GET", url: "/api/platform/desktop-releases", headers: { cookie: adminCookie } })).json().releases as {
      version: string;
      status: string;
    }[];
    expect(Object.fromEntries(list.map((row) => [row.version, row.status]))).toEqual({ "0.2.0": "archived", "0.3.0": "published" });
    expect((await app.inject({ method: "GET", url: downloadUrl, headers: { authorization: device.authorization() } })).statusCode).toBe(404);

    await app.inject({ method: "POST", url: `/api/platform/desktop-releases/${nextId}/archive`, headers: { cookie: adminCookie } });
    // Bazada e'lon qilingan reliz yo'q — muhit o'zgaruvchilaridagi tashqi reliz
    expect((await check("0.1.0")).json().update).toMatchObject({ configured: true, latest: "9.9.9", url: "https://releases.bum-erp.uz/old.exe" });
  });
});
