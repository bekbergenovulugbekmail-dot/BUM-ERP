import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { stockLevels, stockMovements, warehouses } from "../src/db/schema/inventory.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let companyA: Company;
let piece: string;
let mainA: string;

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
  await db.delete(units);
  await seedDefaultUnits(db);
  piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  companyA = await createCompany(app, admin.cookie, { name: "A kompaniya" });
  mainA = (await db.select().from(warehouses).where(eq(warehouses.companyId, companyA.companyId)))[0]!.id;
});

const api = (cookie: string, method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
  app.inject({ method, url: `/api/inventory${url}`, headers: { cookie }, ...(payload ? { payload } : {}) });

async function stocked(sku: string, quantity: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/catalog/products",
    headers: { cookie: companyA.ownerCookie },
    payload: { name: sku, sku, baseUnitId: piece },
  });
  const productId = res.json().product.id as string;
  await api(companyA.ownerCookie, "POST", "/stock/movements", {
    type: "receive",
    productId,
    warehouseId: mainA,
    quantity,
    costPrice: "100",
  });
  return productId;
}

async function quantityOf(productId: string) {
  const [row] = await db
    .select()
    .from(stockLevels)
    .where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, mainA)));
  return row?.quantity;
}

describe("Inventarizatsiya", () => {
  it("hisob qoldiqlardan tuziladi; qo'llash JORIY qoldiqqa nisbatan tuzatadi (orada bo'lgan harakat yo'qolmaydi)", async () => {
    const apple = await stocked("OLMA", "10");
    const pear = await stocked("NOK", "7");

    const created = await api(companyA.ownerCookie, "POST", "/counts", { warehouseId: mainA, name: "Sentabr" });
    expect(created.statusCode).toBe(201);
    const countId = created.json().count.id as string;
    expect(created.json().count.itemCount).toBe(2);

    const detail = (await api(companyA.ownerCookie, "GET", `/counts/${countId}`)).json().count;
    const appleItem = detail.items.find((i: { productId: string }) => i.productId === apple);
    expect(appleItem).toMatchObject({ expectedQty: "10.0000", countedQty: null });

    const counted = await api(companyA.ownerCookie, "PATCH", `/counts/${countId}/items/${appleItem.id}`, { countedQty: "8" });
    expect(counted.json().item).toMatchObject({ countedQty: "8.0000", difference: "-2.0000" });
    expect((await api(companyA.ownerCookie, "GET", `/counts/${countId}`)).json().count.status).toBe("in_progress");

    // Hisob davomida 3 ta sotildi — sanalgan 8 fizik haqiqat bo'lib qoladi
    await api(companyA.ownerCookie, "POST", "/stock/movements", { type: "issue", productId: apple, warehouseId: mainA, quantity: "3" });
    expect(await quantityOf(apple)).toBe("7.0000");

    const applied = await api(companyA.ownerCookie, "POST", `/counts/${countId}/apply`);
    expect(applied.statusCode).toBe(200);
    expect(applied.json()).toMatchObject({ adjusted: 1, count: { status: "completed", adjustmentsMade: true } });
    expect(await quantityOf(apple)).toBe("8.0000");
    expect(await quantityOf(pear)).toBe("7.0000");

    const [adjustment] = await db
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.referenceId, countId), eq(stockMovements.type, "count")));
    expect(adjustment).toMatchObject({ quantity: "1.0000", productId: apple });

    expect((await api(companyA.ownerCookie, "POST", `/counts/${countId}/apply`)).statusCode).toBe(400);
    expect((await api(companyA.ownerCookie, "PATCH", `/counts/${countId}/items/${appleItem.id}`, { countedQty: "1" })).statusCode).toBe(400);
  });

  it("qoldig'i yo'q mahsulotni qo'shib sanash qoldiq yaratadi; bekor qilingan hisob qo'llanmaydi", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/catalog/products",
      headers: { cookie: companyA.ownerCookie },
      payload: { name: "Topilma", sku: "TOPILMA", baseUnitId: piece },
    });
    const found = res.json().product.id as string;

    const countId = (await api(companyA.ownerCookie, "POST", "/counts", { warehouseId: mainA, name: "Topilmalar" })).json().count.id;
    // Hisob mahsulotlar ro'yxatidan quriladi — qoldig'i yo'q tovar ham DARHOL ro'yxatda bo'ladi
    const items = (await api(companyA.ownerCookie, "GET", `/counts/${countId}`)).json().count.items as { id: string; productId: string }[];
    const item = items.find((row) => row.productId === found);
    expect(item, "topilma ro'yxatda").toBeDefined();
    // Shuning uchun uni qayta qo'shib bo'lmaydi (noyob indeks)
    expect((await api(companyA.ownerCookie, "POST", `/counts/${countId}/items`, { productId: found })).statusCode).toBe(409);

    await api(companyA.ownerCookie, "PATCH", `/counts/${countId}/items/${item!.id}`, { countedQty: "4" });
    await api(companyA.ownerCookie, "POST", `/counts/${countId}/apply`);
    expect(await quantityOf(found)).toBe("4.0000");

    const cancelledId = (await api(companyA.ownerCookie, "POST", "/counts", { warehouseId: mainA, name: "Bekor" })).json().count.id;
    expect((await api(companyA.ownerCookie, "POST", `/counts/${cancelledId}/status`, { status: "cancelled" })).statusCode).toBe(200);
    expect((await api(companyA.ownerCookie, "POST", `/counts/${cancelledId}/apply`)).statusCode).toBe(400);

    const list = (await api(companyA.ownerCookie, "GET", "/counts?status=cancelled")).json().counts;
    expect(list.map((c: { id: string }) => c.id)).toEqual([cancelledId]);
  });

  it("ruxsatlar: Omborchi (warehouse.count yo'q) hisob ocha olmaydi; Ombor menejeri ocha va qo'llay oladi", async () => {
    await stocked("R-1", "5");
    const omborchi = await addEmployee(app, companyA, "Omborchi");
    const manager = await addEmployee(app, companyA, "Ombor menejeri");

    expect((await api(omborchi.cookie, "POST", "/counts", { warehouseId: mainA, name: "X" })).statusCode).toBe(403);
    const countId = (await api(manager.cookie, "POST", "/counts", { warehouseId: mainA, name: "M" })).json().count.id;
    expect((await api(manager.cookie, "POST", `/counts/${countId}/apply`)).statusCode).toBe(200);
  });
});

/**
 * INVENTARIZATSIYA AUDITI — sanoqchi ish oqimining chegaralari.
 *
 * Hisobga mahsulot qo'shish ("topilma"), takror qo'shishning oldini olish, bekor qilingan
 * hisobning qo'llanmasligi va band (rezerv) qilingan tovardan kam sanash holati tekshiriladi.
 */
describe("Inventarizatsiya ro'yxati to'liqligi", () => {
  /**
   * Hisob MAHSULOTLAR ro'yxatidan qurilishi kerak, qoldiqdan emas: omborda hech qachon harakat
   * bo'lmagan mahsulotda `stock_levels` qatori yo'q va u ilgari ro'yxatga umuman tushmasdi —
   * sanoqchi chala ro'yxat ko'rardi. Holbuki inventarizatsiya aynan shunday tovarni topish uchun ham.
   */
  it("qoldig'i yo'q (harakat bo'lmagan) mahsulot ham ro'yxatga tushadi", async () => {
    const stockedId = await stocked("FULL-1", "5");
    // Bu mahsulotga hech qanday harakat yo'q — `stock_levels` qatori ham yo'q
    const untouched = (
      await app.inject({
        method: "POST",
        url: "/api/catalog/products",
        headers: { cookie: companyA.ownerCookie },
        payload: { name: "Harakatsiz", sku: "FULL-2", baseUnitId: piece },
      })
    ).json().product.id as string;

    const created = await api(companyA.ownerCookie, "POST", "/counts", { warehouseId: mainA, name: "To'liq ro'yxat" });
    expect(created.statusCode, created.body).toBe(201);
    const items = (await api(companyA.ownerCookie, "GET", `/counts/${created.json().count.id}`)).json().count.items as {
      productId: string;
      expectedQty: string;
    }[];

    const byProduct = new Map(items.map((item) => [item.productId, item.expectedQty]));
    expect(byProduct.get(stockedId), "qoldig'i bor mahsulot").toBe("5.0000");
    expect(byProduct.has(untouched), "harakat bo'lmagan mahsulot ham ro'yxatda").toBe(true);
    expect(Number(byProduct.get(untouched)), "kutilgan qoldiq 0").toBe(0);
  });

  it("faol bo'lmagan mahsulot ro'yxatga kirmaydi", async () => {
    const active = await stocked("FULL-3", "2");
    const archived = (
      await app.inject({
        method: "POST",
        url: "/api/catalog/products",
        headers: { cookie: companyA.ownerCookie },
        payload: { name: "Arxiv", sku: "FULL-4", baseUnitId: piece },
      })
    ).json().product.id as string;
    expect(
      (await app.inject({
        method: "PATCH",
        url: `/api/catalog/products/${archived}`,
        headers: { cookie: companyA.ownerCookie },
        payload: { isActive: false },
      })).statusCode,
    ).toBe(200);

    const created = await api(companyA.ownerCookie, "POST", "/counts", { warehouseId: mainA, name: "Faollar" });
    const items = (await api(companyA.ownerCookie, "GET", `/counts/${created.json().count.id}`)).json().count.items as { productId: string }[];
    const ids = new Set(items.map((item) => item.productId));
    expect(ids.has(active)).toBe(true);
    expect(ids.has(archived), "arxivlangan mahsulot sanalmaydi").toBe(false);
  });
});

describe("Inventarizatsiya — sanoqchi oqimi", () => {
  async function openCount(name = "Audit") {
    const res = await api(companyA.ownerCookie, "POST", "/counts", { warehouseId: mainA, name });
    expect(res.statusCode, res.body).toBe(201);
    const id = res.json().count.id as string;
    expect((await api(companyA.ownerCookie, "POST", `/counts/${id}/status`, { status: "in_progress" })).statusCode).toBe(200);
    return id;
  }

  const detail = async (countId: string) =>
    (await api(companyA.ownerCookie, "GET", `/counts/${countId}`)).json().count as {
      items: { id: string; productId: string; expectedQty: string; countedQty: string | null }[];
    };

  it("hisobdan keyin paydo bo'lgan mahsulotni qo'shib sanash mumkin, takror qo'shilmaydi", async () => {
    const countId = await openCount();
    // Hisob ochilgandan KEYIN kelgan tovar — ro'yxatda yo'q
    const later = await stocked("LATER-1", "7");
    expect((await detail(countId)).items.some((item) => item.productId === later), "avval ro'yxatda yo'q").toBe(false);

    const added = await api(companyA.ownerCookie, "POST", `/counts/${countId}/items`, { productId: later });
    expect(added.statusCode, added.body).toBe(201);
    expect((await detail(countId)).items.some((item) => item.productId === later)).toBe(true);

    // Takror qo'shish — noyob indeks 409 beradi (500 emas), hisobda dublikat qator paydo bo'lmaydi
    const again = await api(companyA.ownerCookie, "POST", `/counts/${countId}/items`, { productId: later });
    expect(again.statusCode, again.body).toBe(409);
    expect((await detail(countId)).items.filter((item) => item.productId === later)).toHaveLength(1);
  });

  it("sanalmagan qatorlar tegilmaydi — faqat sanalganlari tuzatiladi", async () => {
    const touched = await stocked("TOUCH-1", "10");
    const untouched = await stocked("TOUCH-2", "10");
    const countId = await openCount();
    const items = (await detail(countId)).items;
    const touchedItem = items.find((item) => item.productId === touched)!;

    // Faqat bittasi sanaladi
    expect((await api(companyA.ownerCookie, "PATCH", `/counts/${countId}/items/${touchedItem.id}`, { countedQty: 8 })).statusCode).toBe(200);

    const applied = await api(companyA.ownerCookie, "POST", `/counts/${countId}/apply`);
    expect(applied.statusCode, applied.body).toBe(200);
    expect(applied.json().adjusted, "faqat bitta qator tuzatildi").toBe(1);
    expect(await quantityOf(touched)).toBe("8.0000");
    expect(await quantityOf(untouched), "sanalmagan mahsulot qoldig'i o'zgarmaydi").toBe("10.0000");
  });

  it("band qilingan tovardan kam sanash rad etiladi — zaxira invarianti buzilmaydi", async () => {
    const productId = await stocked("RESERVED-1", "10");
    // 6 dona mijoz buyurtmasi uchun band qilinadi
    const customer = await app.inject({
      method: "POST",
      url: "/api/sales/customers",
      headers: { cookie: companyA.ownerCookie },
      payload: { name: "Mijoz", phone: `+9989${Math.floor(10_000_000 + Math.random() * 89_999_999)}` },
    });
    expect(customer.statusCode).toBe(201);
    const order = await app.inject({
      method: "POST",
      url: "/api/sales/orders",
      headers: { cookie: companyA.ownerCookie },
      payload: {
        customerId: customer.json().customer.id,
        warehouseId: mainA,
        orderDate: new Date().toISOString().slice(0, 10),
        items: [{ productId, quantity: "6" }],
      },
    });
    expect(order.statusCode, order.body).toBe(201);
    expect(
      (await app.inject({
        method: "POST",
        url: `/api/sales/orders/${order.json().order.id}/confirm`,
        headers: { cookie: companyA.ownerCookie },
      })).statusCode,
    ).toBe(200);

    const countId = await openCount("Band tovar");
    const item = (await detail(countId)).items.find((row) => row.productId === productId)!;
    // Sanoqda 2 dona topildi — lekin 6 tasi band, qoldiq 2 ga tushsa invariant buzilardi
    expect((await api(companyA.ownerCookie, "PATCH", `/counts/${countId}/items/${item.id}`, { countedQty: 2 })).statusCode).toBe(200);

    const applied = await api(companyA.ownerCookie, "POST", `/counts/${countId}/apply`);
    expect(applied.statusCode, applied.body).toBe(400);
    expect(await quantityOf(productId), "qoldiq o'zgarmadi").toBe("10.0000");
  });

  it("bekor qilingan hisobga qator qo'shib bo'lmaydi", async () => {
    const productId = await stocked("CANCEL-1", "3");
    const countId = await openCount("Bekor bo'ladi");
    expect((await api(companyA.ownerCookie, "POST", `/counts/${countId}/status`, { status: "cancelled" })).statusCode).toBe(200);

    const added = await api(companyA.ownerCookie, "POST", `/counts/${countId}/items`, { productId });
    expect(added.statusCode, added.body).toBe(400);
  });
  /**
   * Hisob BUTUN katalogdan quriladi — minglab mahsulotli bizneslarda hamma qatorni bir yo'la
   * yuborib bo'lmaydi. Qidiruv va chegara SERVERDA; ko'rsatkichlar esa chegaradan mustaqil
   * bo'lishi shart, aks holda "nechta sanalgan" soni ekrandagi qatorlar soniga qarab yolg'on ko'rsatardi.
   */
  it("qidiruv serverda bajariladi, ko'rsatkichlar esa to'liq hisobdan olinadi", async () => {
    await stocked("QIDIR-OLMA", "10");
    await stocked("QIDIR-NOK", "5");
    await stocked("BOSHQA-UZUM", "3");
    const countId = await openCount("Qidiruvli");

    const all = (await api(companyA.ownerCookie, "GET", `/counts/${countId}`)).json().count;
    expect(all.itemCount, "hamma mahsulot hisobda").toBe(3);
    expect(all.countedItems).toBe(0);

    const found = (await api(companyA.ownerCookie, "GET", `/counts/${countId}?search=QIDIR`)).json().count;
    expect(found.items.map((item: { productSku: string }) => item.productSku).sort()).toEqual(["QIDIR-NOK", "QIDIR-OLMA"]);
    expect(found.itemCount, "ko'rsatkich qidiruvdan qat'i nazar to'liq").toBe(3);

    const bySku = (await api(companyA.ownerCookie, "GET", `/counts/${countId}?search=UZUM`)).json().count;
    expect(bySku.items).toHaveLength(1);
    expect((await api(companyA.ownerCookie, "GET", `/counts/${countId}?search=YO%27QNARSA`)).json().count.items).toEqual([]);
  });

  it("chegara qatorlarni kesadi, sanalgan/ortiqcha/kam ko'rsatkichlari esa butun hisobdan", async () => {
    const first = await stocked("LIMIT-A", "10");
    await stocked("LIMIT-B", "10");
    await stocked("LIMIT-C", "10");
    const countId = await openCount("Chegarali");

    const items = (await detail(countId)).items;
    const firstItem = items.find((item) => item.productId === first)!;
    // Bitta qator ortiqcha chiqdi (12 > 10)
    expect((await api(companyA.ownerCookie, "PATCH", `/counts/${countId}/items/${firstItem.id}`, { countedQty: 12 })).statusCode).toBe(200);

    const limited = (await api(companyA.ownerCookie, "GET", `/counts/${countId}?limit=1`)).json().count;
    expect(limited.items, "ekranga faqat bitta qator").toHaveLength(1);
    expect(limited.itemCount).toBe(3);
    expect(limited.countedItems, "sanalganlar soni chegaradan mustaqil").toBe(1);
    expect(limited.surplusItems).toBe(1);
    expect(limited.shortageItems).toBe(0);
  });
});
