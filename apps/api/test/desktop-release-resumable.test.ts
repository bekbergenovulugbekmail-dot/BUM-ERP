import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { parseByteRange } from "../src/modules/platform/desktop-releases.service.js";
import { buildServer } from "../src/server.js";
import { createCompany, resetDatabase, signedIn } from "./helpers.js";

const CHUNK = 1024 * 1024;
const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

let app: FastifyInstance;
let adminCookie: string;
let ownerCookie: string;
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

type Upload = { id: string; status: string; totalChunks: number; receivedChunks: number[]; receivedBytes: number };

const start = (cookie: string, body: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/api/platform/desktop-releases/uploads", headers: { cookie }, payload: body });
const put = (id: string, index: number, data: Buffer, chunkSha?: string) =>
  app.inject({
    method: "PUT",
    url: `/api/platform/desktop-releases/uploads/${id}/chunks/${index}`,
    headers: { cookie: adminCookie, "content-type": "application/octet-stream", ...(chunkSha ? { "x-chunk-sha256": chunkSha } : {}) },
    payload: data,
  });
const state = async (id: string) =>
  (await app.inject({ method: "GET", url: `/api/platform/desktop-releases/uploads/${id}`, headers: { cookie: adminCookie } })).json().upload as Upload;
const action = (id: string, name: "complete" | "abort") =>
  app.inject({ method: "POST", url: `/api/platform/desktop-releases/uploads/${id}/${name}`, headers: { cookie: adminCookie } });
const installerOf = (bytes: number) => Buffer.concat([Buffer.from("MZ"), randomBytes(bytes - 2)]);
const chunkOf = (file: Buffer, index: number) => file.subarray(index * CHUNK, (index + 1) * CHUNK);

describe("Desktop relizi: bo'laklab davom ettiriladigan yuklash va Range bilan yuklab olish", () => {
  it("27% da uzilish → davom, buzilgan va takroriy bo'lak, 70% → yakunlash, SHA-256, e'lon; qurilma Range bilan davom ettiradi", async () => {
    const file = installerOf(10 * CHUNK + 12_345);
    const fileSha = sha(file);
    const body = { version: "0.3.0", fileName: "BUM-POS-KASSA-Setup-0.3.0.exe", size: file.length, sha256: fileSha, chunkSize: CHUNK };

    expect((await start(ownerCookie, body)).statusCode).toBe(403);
    expect((await start(adminCookie, { ...body, fileName: "../../setup.exe" })).statusCode).toBe(400);
    expect((await start(adminCookie, { ...body, chunkSize: 1024 })).statusCode).toBe(400);
    const started = await start(adminCookie, body);
    expect(started.statusCode).toBe(201);
    const upload = started.json().upload as Upload;
    expect(upload).toMatchObject({ status: "uploading", totalChunks: 11, receivedChunks: [], receivedBytes: 0 });

    // ≈27%: 3 bo'lak, keyin aloqa uzildi
    for (const index of [0, 1, 2]) {
      const res = await put(upload.id, index, chunkOf(file, index), sha(chunkOf(file, index)));
      expect(res.statusCode).toBe(200);
    }
    // Yo'lda buzilgan bo'lak va noto'g'ri hajm — rad etiladi, hisobga olinmaydi
    const corrupted = Buffer.from(chunkOf(file, 3));
    corrupted[100] = corrupted[100]! ^ 0xff;
    expect((await put(upload.id, 3, corrupted, sha(chunkOf(file, 3)))).json()).toMatchObject({ code: "BAD_REQUEST", details: { reason: "chunk_checksum" } });
    expect((await put(upload.id, 4, Buffer.alloc(10))).json()).toMatchObject({ details: { reason: "chunk_size" } });
    expect((await put(upload.id, 11, Buffer.alloc(10))).statusCode).toBe(400);
    expect((await action(upload.id, "complete")).json()).toMatchObject({ code: "CONFLICT", details: { receivedBytes: 3 * CHUNK } });

    // Brauzer yangilandi: shu fayl qayta tanlanadi — o'sha sessiya, 3 bo'lak serverda
    const resumed = await start(adminCookie, body);
    expect(resumed.json().upload).toMatchObject({ id: upload.id, receivedChunks: [0, 1, 2], receivedBytes: 3 * CHUNK });
    expect((await start(adminCookie, { ...body, sha256: "b".repeat(64) })).statusCode).toBe(409);
    // Takroriy bo'lak — bayt ikki marta sanalmaydi
    expect((await put(upload.id, 2, chunkOf(file, 2))).json()).toMatchObject({ receivedBytes: 3 * CHUNK, receivedChunks: 3 });

    // ≈70% gacha, yana uzilish; tugallanmagan reliz e'lon qilinmaydi
    for (let index = 3; index <= 7; index++) expect((await put(upload.id, index, chunkOf(file, index))).statusCode).toBe(200);
    const listed = (await app.inject({ method: "GET", url: "/api/platform/desktop-releases", headers: { cookie: adminCookie } })).json().releases;
    expect(listed).toEqual([expect.objectContaining({ id: upload.id, status: "uploading", receivedBytes: 8 * CHUNK, expectedSize: file.length })]);
    expect((await app.inject({ method: "POST", url: `/api/platform/desktop-releases/${upload.id}/publish`, headers: { cookie: adminCookie } })).statusCode).toBe(400);
    expect((await state(upload.id)).receivedChunks).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    // Qolganlari (oxirgisi qisqa) — teskari tartibda ham bo'ladi
    for (const index of [10, 9, 8]) expect((await put(upload.id, index, chunkOf(file, index))).statusCode).toBe(200);
    const completed = await action(upload.id, "complete");
    expect(completed.statusCode).toBe(200);
    expect(completed.json().release).toMatchObject({ status: "draft", size: file.length, sha256: fileSha });
    expect((await action(upload.id, "complete")).statusCode).toBe(200);
    expect((await put(upload.id, 0, chunkOf(file, 0))).statusCode).toBe(409);
    expect((await action(upload.id, "abort")).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `/api/platform/desktop-releases/${upload.id}/publish`, headers: { cookie: adminCookie } })).statusCode).toBe(200);

    // Qurilma: 27% da uzilgan yuklab olish Range bilan davom etadi
    const url = `/api/pos-device/releases/${upload.id}/download`;
    const download = (headers: Record<string, string>) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}`, ...headers } });
    const full = await download({});
    expect(full.statusCode).toBe(200);
    expect(full.headers["accept-ranges"]).toBe("bytes");
    expect(full.headers.etag).toBe(`"${fileSha}"`);
    expect(full.rawPayload.equals(file)).toBe(true);

    const offset = Math.floor(file.length * 0.27);
    const rest = await download({ range: `bytes=${offset}-`, "if-range": `"${fileSha}"` });
    expect(rest.statusCode).toBe(206);
    expect(rest.headers["content-range"]).toBe(`bytes ${offset}-${file.length - 1}/${file.length}`);
    expect(Buffer.concat([file.subarray(0, offset), rest.rawPayload]).equals(file)).toBe(true);

    const acrossChunks = await download({ range: `bytes=${CHUNK - 6}-${CHUNK + 9}` });
    expect(acrossChunks.rawPayload.equals(file.subarray(CHUNK - 6, CHUNK + 10))).toBe(true);
    expect((await download({ range: "bytes=-500" })).rawPayload.equals(file.subarray(file.length - 500))).toBe(true);
    // Boshqa relizning qismi qo'shilib ketmasin: ETag mos emas — butun fayl
    expect((await download({ range: `bytes=${offset}-`, "if-range": '"eskireliz"' })).statusCode).toBe(200);
    const beyond = await download({ range: `bytes=${file.length}-` });
    expect(beyond.statusCode).toBe(416);
    expect(beyond.headers["content-range"]).toBe(`bytes */${file.length}`);

    // Web (kassa o'rnatish) yuklab olishi ham davom ettiriladi
    const web = await app.inject({ method: "GET", url: `/api/pos/devices/installer/${upload.id}/download`, headers: { cookie: ownerCookie, range: "bytes=0-1" } });
    expect(web.statusCode).toBe(206);
    expect(web.rawPayload.toString("latin1")).toBe("MZ");
  });

  it("SHA-256 mos kelmasa — failed va e'lon qilinmaydi; qayta boshlash, bekor qilish; parallel sessiyalar aralashmaydi", async () => {
    const good = installerOf(2 * CHUNK + 7);
    const other = installerOf(CHUNK + 3);
    const wrong = await start(adminCookie, { version: "0.4.0", fileName: "setup-0.4.0.exe", size: good.length, sha256: sha(other), chunkSize: CHUNK });
    const parallel = await start(adminCookie, { version: "0.5.0", fileName: "setup-0.5.0.exe", size: other.length, sha256: sha(other), chunkSize: CHUNK });
    const wrongId = (wrong.json().upload as Upload).id;
    const parallelId = (parallel.json().upload as Upload).id;

    // Ikki sessiya bo'laklari aralash keladi
    await put(wrongId, 0, chunkOf(good, 0));
    await put(parallelId, 1, chunkOf(other, 1));
    await put(wrongId, 2, chunkOf(good, 2));
    await put(parallelId, 0, chunkOf(other, 0));
    await put(wrongId, 1, chunkOf(good, 1));

    const failed = await action(wrongId, "complete");
    expect(failed.statusCode).toBe(422);
    expect(failed.json()).toMatchObject({ code: "CHECKSUM_MISMATCH", details: { release: { status: "failed" } } });
    expect((await state(wrongId))).toMatchObject({ status: "failed", receivedChunks: [], error: expect.stringContaining("SHA-256") });
    expect((await app.inject({ method: "POST", url: `/api/platform/desktop-releases/${wrongId}/publish`, headers: { cookie: adminCookie } })).statusCode).toBe(400);

    // Shu versiyani to'g'ri fayl bilan qayta boshlash, keyin bekor qilish — versiya bo'shaydi
    const restarted = await start(adminCookie, { version: "0.4.0", fileName: "setup-0.4.0.exe", size: good.length, sha256: sha(good), chunkSize: CHUNK });
    expect(restarted.json().upload).toMatchObject({ id: wrongId, status: "uploading", receivedChunks: [] });
    await put(wrongId, 0, chunkOf(good, 0));
    expect((await action(wrongId, "abort")).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/platform/desktop-releases/uploads/${wrongId}`, headers: { cookie: adminCookie } })).statusCode).toBe(404);

    expect((await action(parallelId, "complete")).json().release).toMatchObject({ status: "draft", sha256: sha(other) });

    expect(parseByteRange(undefined, 10)).toBeNull();
    expect(parseByteRange("bytes=2-4", 10)).toEqual({ start: 2, end: 4 });
    expect(parseByteRange("bytes=8-100", 10)).toEqual({ start: 8, end: 9 });
    expect(parseByteRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
    expect(parseByteRange("bytes=10-", 10)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=5-2", 10)).toBeNull();
    expect(parseByteRange("bytes=0-1,4-5", 10)).toBeNull();
  });
});
