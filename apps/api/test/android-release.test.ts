/**
 * Telefon ilovasi (Android) relizlari: platforma admini APK yuklaydi va e'lon qiladi,
 * ilova esa sessiyasiz `/api/public/app-release` dan oxirgi versiyani so'raydi va shu yerdan yuklab oladi.
 *
 * Desktop relizlari bilan aralashmaydi: har platformaning o'z "e'lon qilingani" bor.
 */
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../src/db/client.js";
import { buildServer } from "../src/server.js";
import { resetDatabase, signedIn } from "./helpers.js";

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

/** Bitta oqim bilan yuklash (kichik fayl uchun yetarli). */
async function upload(platform: "desktop" | "android", version: string, fileName: string, body: Buffer) {
  const sha256 = createHash("sha256").update(body).digest("hex");
  const res = await app.inject({
    method: "POST",
    url: `/api/platform/desktop-releases?platform=${platform}&version=${version}&fileName=${fileName}`,
    headers: { cookie: adminCookie, "content-type": "application/octet-stream", "x-sha256": sha256 },
    payload: body,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().release as { id: string; platform: string; version: string };
}

const publish = (id: string, signature = "") =>
  app.inject({ method: "POST", url: `/api/platform/desktop-releases/${id}/publish`, headers: { cookie: adminCookie }, payload: { signature } });

const latest = () => app.inject({ method: "GET", url: "/api/public/app-release" });

/** APK — zip (PK), Windows o'rnatuvchisi — PE (MZ): server fayl turini boshidagi belgilar bilan tekshiradi. */
const apkBody = (text: string) => Buffer.concat([Buffer.from("PK" + String.fromCharCode(3, 4)), Buffer.from(text)]);
const exeBody = (text: string) => Buffer.concat([Buffer.from("MZ"), Buffer.from(text)]);

describe("Android relizi", () => {
  it("yuklanadi, imzosiz e'lon qilinadi va ilovaga ko'rinadi", async () => {
    expect((await latest()).json().release).toBeNull();

    const apk = apkBody("BUM-ERP-1.0.1");
    const release = await upload("android", "1.0.1", "BUM-ERP-1.0.1.apk", apk);
    expect(release.platform).toBe("android");

    // E'lon qilinmaguncha ilovaga ko'rinmaydi
    expect((await latest()).json().release).toBeNull();

    expect((await publish(release.id)).statusCode, "imzosiz e'lon qilinishi kerak").toBe(200);

    const body = (await latest()).json().release as { version: string; size: number; downloadUrl: string };
    expect(body.version).toBe("1.0.1");
    expect(body.size).toBe(apk.length);
    expect(body.downloadUrl).toBe("/api/public/app-release/download");
  });

  it("APK sessiyasiz yuklab olinadi (Android yuklab oluvchisi cookie yubormaydi)", async () => {
    const apk = apkBody("BUM-ERP-1.0.2");
    const release = await upload("android", "1.0.2", "BUM-ERP-1.0.2.apk", apk);
    await publish(release.id);

    const download = await app.inject({ method: "GET", url: "/api/public/app-release/download" });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toBe("application/vnd.android.package-archive");
    expect(download.rawPayload.equals(apk)).toBe(true);
  });

  it("desktop va android relizlari aralashmaydi", async () => {
    const exe = await upload("desktop", "0.9.9", "BUM-POS-KASSA-Setup.exe", exeBody("kassa"));
    const apk = await upload("android", "0.9.9", "BUM-ERP-0.9.9.apk", apkBody("telefon"));
    expect(exe.id).not.toBe(apk.id);

    await publish(apk.id);
    // Android e'lon qilingani ilovaga ko'rinadi, desktop hali qoralama
    expect((await latest()).json().release.version).toBe("0.9.9");

    const list = await app.inject({ method: "GET", url: "/api/platform/desktop-releases?platform=android", headers: { cookie: adminCookie } });
    const versions = (list.json().releases as { platform: string }[]).map((row) => row.platform);
    expect(versions).toEqual(["android"]);
  });

  it("desktop relizi imzosiz e'lon qilinmaydi", async () => {
    const exe = await upload("desktop", "0.9.8", "BUM-POS-KASSA-Setup.exe", exeBody("kassa"));
    const res = await publish(exe.id);
    expect(res.statusCode).toBe(400);
  });

  it("yangi versiya e'lon qilinsa eskisi arxivga o'tadi", async () => {
    const first = await upload("android", "1.1.0", "BUM-ERP-1.1.0.apk", apkBody("birinchi"));
    await publish(first.id);
    const second = await upload("android", "1.2.0", "BUM-ERP-1.2.0.apk", apkBody("ikkinchi"));
    await publish(second.id);

    expect((await latest()).json().release.version).toBe("1.2.0");
    const list = await app.inject({ method: "GET", url: "/api/platform/desktop-releases?platform=android", headers: { cookie: adminCookie } });
    const rows = list.json().releases as { version: string; status: string }[];
    expect(rows.find((row) => row.version === "1.1.0")?.status).toBe("archived");
    expect(rows.find((row) => row.version === "1.2.0")?.status).toBe("published");
  });
});
