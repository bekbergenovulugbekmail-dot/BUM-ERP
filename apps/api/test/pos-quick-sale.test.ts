import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { productImages, products, units } from "../src/db/schema/catalog.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { salesOrderItems, salesOrders } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { storageProvider } from "../src/shared/storage.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let admin: Awaited<ReturnType<typeof signedIn>>;
let company: Company;
let piece: string;
let mainWh: string;
let token: string;
const originalClient = storageProvider.client;

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
  storageProvider.client = null;
  await resetDatabase();
  await db.delete(units);
  await seedDefaultUnits(db);
  piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Do'kon" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  const registered = await app.inject({
    method: "POST",
    url: "/api/pos-device/setup/register",
    payload: { phone: company.owner.phone, password: company.owner.password, warehouseId: mainWh, name: "Kassa 1" },
  });
  token = (registered.json() as { token: string }).token;
  // Ega kassada parol bilan kiradi (qurilma amallari bog'langan kassir nomidan)
  const login = await app.inject({ method: "POST", url: "/api/pos-device/cashiers/login", headers: { authorization: `Bearer ${token}` }, payload: { phone: company.owner.phone, password: company.owner.password } });
  expect(login.statusCode, login.body).toBe(200);
});

function call(cookie: string, method: "GET" | "POST" | "PUT", url: string, payload?: object) {
  return app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
}

async function createProduct(cookie: string, sku: string, extra: Record<string, unknown> = {}, withStock = true) {
  const res = await call(cookie, "POST", "/api/catalog/products", { name: sku, sku, baseUnitId: piece, salesPrice: "5000", taxRate: "0", ...extra });
  expect(res.statusCode).toBe(201);
  const id = res.json().product.id as string;
  if (withStock) await call(cookie, "POST", "/api/inventory/stock/movements", { type: "receive", productId: id, warehouseId: mainWh, quantity: "100", costPrice: "3000" });
  return id;
}

const device = (method: "GET" | "POST", url: string, payload?: object) =>
  app.inject({ method, url: `/api/pos-device${url}`, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("rasm-mazmuni")]);

describe("Tezkor sotuv: assortiment va tavsiyalar", () => {
  it("rahbar tanlaydi (tartib, boshqa kompaniya va sotilmaydigan mahsulot rad), kassir yo'q; qurilmaga config bilan boradi", async () => {
    const owner = company.ownerCookie;
    const path = "/api/pos/devices/quick-sale";
    // B — harakatsiz (qoldiqsiz): keyin butunlay o'chiriladi
    const [a, b, c] = [await createProduct(owner, "A"), await createProduct(owner, "B", {}, false), await createProduct(owner, "C")];
    const hidden = await createProduct(owner, "HIDDEN", { isSaleable: false });
    const other = await createCompany(app, admin.cookie, { name: "Boshqa" });
    const foreign = await createProduct(other.ownerCookie, "F");

    expect((await call(owner, "GET", path)).json()).toEqual({ productIds: [], products: [] });
    const kassir = await addEmployee(app, company, "Kassir");
    expect((await call(kassir.cookie, "PUT", path, { productIds: [a] })).statusCode).toBe(403);
    expect((await call(owner, "PUT", path, { productIds: [a, foreign] })).statusCode).toBe(400);
    expect((await call(owner, "PUT", path, { productIds: [a, randomUUID()] })).statusCode).toBe(400);
    expect((await call(owner, "PUT", path, { productIds: [hidden] })).json().message).toContain("sotilmaydi");
    expect((await call(owner, "PUT", path, { productIds: Array.from({ length: 201 }, () => randomUUID()) })).statusCode).toBe(400);

    const before = (await device("POST", "/pull", {})).json() as { config: { hash: string; quickSale: { productIds: string[] } } };
    expect(before.config.quickSale).toEqual({ productIds: [] });

    const saved = await call(owner, "PUT", path, { productIds: [c, a, b, a] });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().productIds).toEqual([c, a, b]);
    expect(saved.json().products.map((row: { sku: string }) => row.sku)).toEqual(["C", "A", "B"]);

    const after = (await device("POST", "/pull", { configHash: before.config.hash })).json() as { config: { hash: string; quickSale: { productIds: string[] } } | null };
    expect(after.config!.quickSale).toEqual({ productIds: [c, a, b] });
    expect((await device("POST", "/pull", { configHash: after.config!.hash })).json().config).toBeNull();

    // O'chirilgan mahsulot assortimentdan tushib qoladi
    await db.delete(products).where(eq(products.id, b));
    expect((await call(owner, "GET", path)).json().productIds).toEqual([c, a]);
  });

  it("7/30/90 kunlik eng ko'p sotilganlar: faqat kassa, davr bo'yicha, miqdor va chek soni tartibida", async () => {
    const owner = company.ownerCookie;
    const [tea, cola, bread] = [await createProduct(owner, "TEA"), await createProduct(owner, "COLA"), await createProduct(owner, "BREAD")];
    const shift = (await call(owner, "POST", "/api/sales/pos/shifts", { warehouseId: mainWh, openingCash: "0" })).json().shift as { id: string };
    const sell = async (productId: string, quantity: string) => {
      const res = await call(owner, "POST", "/api/sales/pos/sales", { shiftId: shift.id, items: [{ productId, quantity }], paymentMethod: "cash", amountPaid: "1000000" });
      expect(res.statusCode).toBe(201);
      return res.json().order.id as string;
    };
    await sell(tea, "2");
    await sell(tea, "2");
    await sell(cola, "4");
    const oldOrder = await sell(bread, "50");
    // Non 40 kun oldin sotilgan — 7 va 30 kunlikda yo'q, 90 kunlikda birinchi
    await db.update(salesOrders).set({ orderDate: iso(40) }).where(eq(salesOrders.id, oldOrder));

    const suggest = async (days: number) =>
      ((await call(owner, "GET", `/api/pos/devices/quick-sale/suggestions?days=${days}`)).json() as { suggestions: { product: { sku: string }; quantity: string; receipts: number }[] })
        .suggestions;
    // Choy va kola 4 tadan: choy 2 chekda — oldin
    expect((await suggest(7)).map((row) => `${row.product.sku}:${Number(row.quantity)}:${row.receipts}`)).toEqual(["TEA:4:2", "COLA:4:1"]);
    expect((await suggest(30)).map((row) => row.product.sku)).toEqual(["TEA", "COLA"]);
    expect((await suggest(90)).map((row) => row.product.sku)).toEqual(["BREAD", "TEA", "COLA"]);
    expect((await call(owner, "GET", "/api/pos/devices/quick-sale/suggestions?days=14")).statusCode).toBe(400);

    // Kassa bo'lmagan buyurtma hisobga olinmaydi
    await db.update(salesOrders).set({ isPos: false }).where(inArray(salesOrders.id, [oldOrder]));
    expect((await suggest(90)).map((row) => row.product.sku)).toEqual(["TEA", "COLA"]);
  });
});

describe("Aksiya narxi — server hisoblaydi", () => {
  it("POS: amaldagi aksiya narxi qo'llanadi, muddati o'tgani yo'q; kassada eski narx — sales.edit'siz rad; offline — nomuvofiqlik", async () => {
    const owner = company.ownerCookie;
    const promo = await createProduct(owner, "PROMO", { salesPrice: "5000", promoPrice: "4000", promoPriceEnd: iso(-3) });
    const forever = await createProduct(owner, "FOREVER", { salesPrice: "5000", promoPrice: "4500" });
    const expired = await createProduct(owner, "EXPIRED", { salesPrice: "5000", promoPrice: "3000", promoPriceEnd: iso(2) });
    const kassir = await addEmployee(app, company, "Kassir");
    const shift = (await call(kassir.cookie, "POST", "/api/sales/pos/shifts", { warehouseId: mainWh, openingCash: "0" })).json().shift as { id: string };
    const sell = (items: object[]) => call(kassir.cookie, "POST", "/api/sales/pos/sales", { shiftId: shift.id, items, paymentMethod: "cash", amountPaid: "1000000" });

    const sale = await sell([
      { productId: promo, quantity: "2" },
      { productId: forever, quantity: "1" },
      { productId: expired, quantity: "1" },
    ]);
    expect(sale.statusCode).toBe(201);
    const items = await db
      .select({ productId: salesOrderItems.productId, unitPrice: salesOrderItems.unitPrice, lineTotal: salesOrderItems.lineTotal })
      .from(salesOrderItems)
      .where(eq(salesOrderItems.orderId, sale.json().order.id));
    const byProduct = Object.fromEntries(items.map((row) => [row.productId, `${Number(row.unitPrice)}/${Number(row.lineTotal)}`]));
    expect(byProduct).toEqual({ [promo]: "4000/8000", [forever]: "4500/4500", [expired]: "5000/5000" });

    // Kassa aksiya narxini ko'rsatib yuborsa — qabul; eski (aksiyasiz) narx — narx o'zgartirish (sales.edit yo'q)
    expect((await sell([{ productId: promo, quantity: "1", unitPrice: "4000" }])).statusCode).toBe(201);
    expect((await sell([{ productId: promo, quantity: "1", unitPrice: "5000" }])).statusCode).toBe(403);

    // Offline chek aksiyasiz narxda — yoziladi, `price_changed` nomuvofiqligi (ro'yxat narxi — aksiya). Ikkinchi kassir
    // (`sales.edit` yo'q — narx farqi nomuvofiqlik bo'ladi; birinchisining onlayn smenasi ochiq)
    const offlineKassir = await addEmployee(app, company, "Kassir");
    const offlineLogin = await app.inject({
      method: "POST",
      url: "/api/pos-device/cashiers/login",
      headers: { authorization: `Bearer ${token}` },
      payload: { phone: offlineKassir.phone, password: "xodim-parol-123" },
    });
    expect(offlineLogin.statusCode, offlineLogin.body).toBe(200);
    const op = (type: string, payload: object, minutesAgo: number) => ({
      opId: randomUUID(),
      type,
      cashierId: offlineKassir.id,
      createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      payload,
    });
    const offlineShift = randomUUID();
    const push = async (ops: object[]) => (await device("POST", "/push", { ops })).json().results as { status: string }[];
    expect((await push([op("shift.open", { shiftId: offlineShift, openingCash: "0" }, 30)]))[0]!.status).toBe("applied");
    const [sold] = await push([
      op(
        "sale.complete",
        {
          saleId: randomUUID(),
          shiftId: offlineShift,
          number: "K01-000001",
          items: [{ id: randomUUID(), productId: promo, unitId: piece, quantity: "1", unitPrice: "5000" }],
          paymentMethod: "cash",
          amountPaid: "5000",
        },
        10,
      ),
    ]);
    expect(sold!.status).toBe("applied");
    const conflicts = (await call(owner, "GET", "/api/pos/devices/conflicts")).json().conflicts as { kind: string; details: { items: { productId: string; listPrice: string; unitPrice: string }[] } }[];
    const priceConflict = conflicts.find((conflict) => conflict.kind === "price_changed");
    expect(priceConflict!.details.items[0]).toMatchObject({ productId: promo, unitPrice: "5000" });
    expect(Number(priceConflict!.details.items[0]!.listPrice)).toBe(4000);
  });
});

describe("Mahsulot rasmi bazada (fayl saqlash sozlanmagan)", () => {
  it("yuklash (tur, imzo, ruxsat), ko'rish havolasi va mazmun, qurilma rasmi, boshqa kompaniya 404, ajratish", async () => {
    const owner = company.ownerCookie;
    const productId = await createProduct(owner, "IMG");
    const bare = await createProduct(owner, "BARE");
    const upload = (cookie: string, id: string, contentType: string, body: Buffer) =>
      app.inject({ method: "PUT", url: `/api/files/product-image/${id}/content`, headers: { cookie, "content-type": contentType }, payload: body });

    expect((await call(owner, "POST", "/api/files/uploads", { kind: "product-image", contentType: "image/png", size: PNG.length })).statusCode).toBe(503);
    expect((await upload(owner, productId, "image/png", Buffer.from("<svg onload=alert(1)>"))).statusCode).toBe(400);
    expect((await upload(owner, productId, "image/jpeg", PNG)).statusCode).toBe(400);
    const kassir = await addEmployee(app, company, "Kassir");
    expect((await upload(kassir.cookie, productId, "image/png", PNG)).statusCode).toBe(403);

    const saved = await upload(owner, productId, "image/png", PNG);
    expect(saved.statusCode).toBe(200);
    const key = saved.json().key as string;
    expect(key).toMatch(/^db\/product-image\/[0-9a-f-]{36}\.png$/);

    const link = (await call(owner, "GET", `/api/files/url?kind=product-image&targetId=${productId}`)).json() as { url: string };
    expect(link.url).toMatch(new RegExp(`^/api/files/product-image/${productId}/content\\?v=`));
    const content = await call(owner, "GET", link.url);
    expect(content.statusCode).toBe(200);
    expect(content.headers["content-type"]).toBe("image/png");
    expect(content.rawPayload.equals(PNG)).toBe(true);

    // Qurilma: pull'da rasm kaliti, rasm mazmuni tokeni bilan; rasmsiz va boshqa kompaniya mahsuloti — 404
    const pulled = (await device("POST", "/pull", {})).json().entities.products.rows as { id: string; imageKey: string | null }[];
    expect(pulled.find((row) => row.id === productId)!.imageKey).toBe(key);
    const image = await device("GET", `/products/${productId}/image`);
    expect(image.statusCode).toBe(200);
    expect(image.rawPayload.equals(PNG)).toBe(true);
    expect((await device("GET", `/products/${bare}/image`)).statusCode).toBe(404);
    const other = await createCompany(app, admin.cookie, { name: "Boshqa" });
    const foreign = await createProduct(other.ownerCookie, "F");
    expect((await device("GET", `/products/${foreign}/image`)).statusCode).toBe(404);
    expect((await call(other.ownerCookie, "GET", `/api/files/product-image/${productId}/content`)).statusCode).toBe(404);

    // Almashtirish — bitta yozuv, yangi kalit; ajratish — yozuv o'chadi
    const replaced = await upload(owner, productId, "image/png", Buffer.concat([PNG, Buffer.from("2")]));
    expect(replaced.json().key).not.toBe(key);
    expect(await db.select({ key: productImages.key }).from(productImages).where(eq(productImages.productId, productId))).toEqual([{ key: replaced.json().key }]);
    expect((await call(owner, "POST", "/api/files/detach", { kind: "product-image", targetId: productId })).statusCode).toBe(204);
    expect(await db.select().from(productImages).where(and(eq(productImages.productId, productId), eq(productImages.companyId, company.companyId)))).toHaveLength(0);
    expect((await device("GET", `/products/${productId}/image`)).statusCode).toBe(404);
  });
});
