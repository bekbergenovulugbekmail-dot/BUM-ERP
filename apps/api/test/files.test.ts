import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { products, units } from "../src/db/schema/catalog.js";
import { expenses } from "../src/db/schema/finance.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { presign, storageProvider, type StorageClient, type StoredObject } from "../src/shared/storage.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let other: Company;
let piece: string;
let objects: Map<string, StoredObject>;
const originalClient = storageProvider.client;

const today = new Date().toISOString().slice(0, 10);

/** Xotiradagi saqlash — yuklashni test o'zi "bajaradi". */
const fakeStorage: StorageClient = {
  signedUrl: (method, key, expires) => `http://storage.test/bum-erp/${key}?method=${method}&expires=${expires}`,
  head: async (key) => objects.get(key) ?? null,
  remove: async (key) => {
    objects.delete(key);
  },
};

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  storageProvider.client = originalClient;
  await app.close();
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
  await db.delete(units);
  await seedDefaultUnits(db);
  piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Fayl kompaniyasi" });
  other = await createCompany(app, admin.cookie, { name: "Boshqa kompaniya" });
  objects = new Map();
  storageProvider.client = fakeStorage;
});

const call = (method: "GET" | "POST", url: string, cookie = company.ownerCookie, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

async function product(owner = company) {
  const res = await call("POST", "/api/catalog/products", owner.ownerCookie, { name: "Rasmli", sku: `R-${Math.random()}`, baseUnitId: piece });
  return res.json().product.id as string;
}

describe("SigV4 imzo", () => {
  it("AWS hujjatidagi rasmiy namunaga mos (presigned GET)", () => {
    const signed = presign({
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test.txt",
      accessKey: "AKIAIOSFODNN7EXAMPLE",
      secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
      expiresSeconds: 86400,
      now: new Date("2013-05-24T00:00:00Z"),
    });
    expect(signed).toBe(
      "/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request" +
        "&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host" +
        "&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });
});

describe("Fayllar", () => {
  it("yuklash → biriktirish → almashtirish → ko'rish → ajratish; tur, hajm, kalit, ruxsat va tenant tekshiruvi", async () => {
    const productId = await product();
    const kassir = await addEmployee(app, company, "Kassir");

    expect((await call("POST", "/api/files/uploads", company.ownerCookie, { kind: "product-image", contentType: "text/html", size: 10 })).statusCode).toBe(400);
    expect((await call("POST", "/api/files/uploads", company.ownerCookie, { kind: "product-image", contentType: "image/png", size: 6 * 1024 * 1024 })).statusCode).toBe(400);
    expect((await call("POST", "/api/files/uploads", kassir.cookie, { kind: "product-image", contentType: "image/png", size: 10 })).statusCode).toBe(403);

    const upload = await call("POST", "/api/files/uploads", company.ownerCookie, { kind: "product-image", contentType: "image/png", size: 1000 });
    expect(upload.statusCode).toBe(201);
    const { key, uploadUrl, headers } = upload.json();
    expect(key).toMatch(new RegExp(`^companies/${company.companyId}/product-image/[0-9a-f-]{36}\\.png$`));
    expect(uploadUrl).toContain(key);
    expect(headers).toEqual({ "content-type": "image/png" });

    const notUploaded = await call("POST", "/api/files/attach", company.ownerCookie, { kind: "product-image", key, targetId: productId });
    expect(notUploaded.statusCode).toBe(400);
    expect(notUploaded.json().message).toContain("yuklanmagan");

    objects.set(key, { size: 1000, contentType: "image/png" });
    expect((await call("POST", "/api/files/attach", company.ownerCookie, { kind: "product-image", key, targetId: productId })).statusCode).toBe(200);
    expect((await db.select().from(products).where(eq(products.id, productId)))[0]!.imageKey).toBe(key);

    // Almashtirish — eski fayl saqlashdan o'chadi
    const second = (await call("POST", "/api/files/uploads", company.ownerCookie, { kind: "product-image", contentType: "image/webp", size: 500 })).json().key;
    objects.set(second, { size: 500, contentType: "image/webp" });
    await call("POST", "/api/files/attach", company.ownerCookie, { kind: "product-image", key: second, targetId: productId });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(objects.has(key)).toBe(false);

    // Boshqa kompaniya kaliti, boshqa kompaniya yozuvi, noto'g'ri tur prefiksi, qalbaki fayl turi
    const foreignKey = `companies/${other.companyId}/product-image/00000000-0000-4000-8000-000000000000.png`;
    objects.set(foreignKey, { size: 10, contentType: "image/png" });
    expect((await call("POST", "/api/files/attach", company.ownerCookie, { kind: "product-image", key: foreignKey, targetId: productId })).statusCode).toBe(400);
    expect((await call("POST", "/api/files/attach", company.ownerCookie, { kind: "product-image", key: second, targetId: await product(other) })).statusCode).toBe(404);
    expect((await call("POST", "/api/files/attach", company.ownerCookie, { kind: "expense-receipt", key: second, targetId: productId })).statusCode).toBe(400);
    const disguised = (await call("POST", "/api/files/uploads", company.ownerCookie, { kind: "product-image", contentType: "image/png", size: 10 })).json().key;
    objects.set(disguised, { size: 10, contentType: "text/html" });
    expect((await call("POST", "/api/files/attach", company.ownerCookie, { kind: "product-image", key: disguised, targetId: productId })).statusCode).toBe(400);

    const view = await call("GET", `/api/files/url?kind=product-image&targetId=${productId}`, kassir.cookie);
    expect(view.statusCode).toBe(200);
    expect(view.json()).toMatchObject({ expiresIn: 300 });
    expect(view.json().url).toContain(second);
    expect((await call("GET", `/api/files/url?kind=product-image&targetId=${productId}`, other.ownerCookie)).statusCode).toBe(404);

    expect((await call("POST", "/api/files/detach", company.ownerCookie, { kind: "product-image", targetId: productId })).statusCode).toBe(204);
    expect((await db.select().from(products).where(eq(products.id, productId)))[0]!.imageKey).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(objects.has(second)).toBe(false);
    expect((await call("POST", "/api/files/detach", company.ownerCookie, { kind: "product-image", targetId: productId })).statusCode).toBe(404);
  });

  it("xarajat cheki (PDF) — moliya ruxsatlari; saqlash sozlanmagan bo'lsa 503", async () => {
    const expense = await call("POST", "/api/finance/expenses", company.ownerCookie, { category: "ijara", description: "Ijara", amount: "1000", expenseDate: today });
    const expenseId = expense.json().expense.id;

    const { key } = (await call("POST", "/api/files/uploads", company.ownerCookie, { kind: "expense-receipt", contentType: "application/pdf", size: 2048 })).json();
    expect(key).toMatch(/\.pdf$/);
    objects.set(key, { size: 2048, contentType: "application/pdf" });
    expect((await call("POST", "/api/files/attach", company.ownerCookie, { kind: "expense-receipt", key, targetId: expenseId })).statusCode).toBe(200);
    expect((await db.select().from(expenses).where(eq(expenses.id, expenseId)))[0]!.attachmentKey).toBe(key);

    const kassir = await addEmployee(app, company, "Kassir");
    expect((await call("GET", `/api/files/url?kind=expense-receipt&targetId=${expenseId}`, kassir.cookie)).statusCode).toBe(403);

    storageProvider.client = null;
    expect((await call("POST", "/api/files/uploads", company.ownerCookie, { kind: "expense-receipt", contentType: "application/pdf", size: 1 })).statusCode).toBe(503);
    expect((await call("GET", `/api/files/url?kind=expense-receipt&targetId=${expenseId}`)).statusCode).toBe(503);
  });
});

/**
 * PRODUCTION YO'LI: fayl saqlash (S3) sozlanmagan bo'lsa rasm BAZAGA yoziladi.
 *
 * Bu yo'l ilgari test bilan qoplanmagan edi, holbuki production aynan shunday ishlaydi:
 * `POST /uploads` → 503 → brauzer `PUT /product-image/:id/content` ga o'tadi.
 * Tekshiriladi: yozish, mahsulot ro'yxatida `imageKey`, ko'rish havolasi va rasm mazmuni.
 */
describe("Rasm bazada (saqlash sozlanmagan)", () => {
  /** Eng kichik haqiqiy PNG (1×1) — imzo tekshiruvidan o'tadi. */
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  const putImage = (productId: string, cookie = company.ownerCookie, body: Buffer = PNG) =>
    app.inject({
      method: "PUT",
      url: `/api/files/product-image/${productId}/content`,
      headers: { cookie, "content-type": "image/png" },
      payload: body,
    });

  it("yuklash → ro'yxatda imageKey → ko'rish havolasi → rasm mazmuni", async () => {
    storageProvider.client = null; // S3 sozlanmagan: production holati
    const productId = await product();

    // 1) Brauzer avval imzolangan URL so'raydi — saqlash yo'q, 503
    expect((await call("POST", "/api/files/uploads", company.ownerCookie, { kind: "product-image", contentType: "image/png", size: PNG.length })).statusCode).toBe(503);

    // 2) Shuning uchun faylni to'g'ridan-to'g'ri API'ga yuboradi
    const saved = await putImage(productId);
    expect(saved.statusCode, saved.body).toBe(200);
    const key = saved.json().key as string;
    expect(key.startsWith("db/product-image/"), key).toBe(true);

    // 3) Mahsulot ro'yxati va kartochkasi `imageKey` yuborishi SHART — frontend rasmni shu bilan so'raydi
    const list = (await call("GET", "/api/catalog/products")).json().products as { id: string; imageKey: string | null }[];
    expect(list.find((row) => row.id === productId)?.imageKey, "ro'yxatda imageKey").toBe(key);
    expect((await call("GET", `/api/catalog/products/${productId}`)).json().product.imageKey, "kartochkada imageKey").toBe(key);

    // 4) Ko'rish havolasi — bazadagi rasm uchun API manzili
    const urlRes = await call("GET", `/api/files/url?kind=product-image&targetId=${productId}`);
    expect(urlRes.statusCode, urlRes.body).toBe(200);
    const url = urlRes.json().url as string;
    expect(url.startsWith(`/api/files/product-image/${productId}/content`), url).toBe(true);

    // 5) Aynan shu manzil rasmni qaytaradi
    const content = await app.inject({ method: "GET", url, headers: { cookie: company.ownerCookie } });
    expect(content.statusCode, content.body.slice(0, 200)).toBe(200);
    expect(content.headers["content-type"]).toBe("image/png");
    expect(content.rawPayload.length).toBeGreaterThan(0);
  });

  it("begona kompaniya rasmini ko'ra olmaydi va yozolmaydi", async () => {
    storageProvider.client = null;
    const productId = await product();
    expect((await putImage(productId)).statusCode).toBe(200);

    expect((await putImage(productId, other.ownerCookie)).statusCode, "begona yozolmaydi").toBe(404);
    const foreign = await call("GET", `/api/files/product-image/${productId}/content`, other.ownerCookie);
    expect(foreign.statusCode, "begona ko'rolmaydi").toBe(404);
  });
});
