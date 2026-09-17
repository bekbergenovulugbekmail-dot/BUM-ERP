/**
 * Mijoz botidan buyurtma: mahsulot qidirish va QORALAMA (draft) sotuv hujjatini yaratish.
 *
 * Buyurtma kompaniya EGASI nomidan, `source: "bot"` bilan yoziladi va tasdiqlashni do'kon xodimi
 * dasturdan bajaradi — bot hech qanday zaxira yoki pulni o'zgartirmaydi. Shu sabab yangi "buyurtma
 * tizimi" yaratilmadi: mavjud `createOrder` va uning barcha tekshiruvlari ishlaydi.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { badRequest } from "@bum/shared";
import { products } from "../../db/schema/catalog.js";
import { warehouses } from "../../db/schema/inventory.js";
import { companies, users } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { requireTenant } from "../company/tenant.js";
import { createOrder } from "../sales/orders.service.js";

/** Bot amallari uchun so'rov konteksti: tarmoq manzili yo'q, faqat manba ko'rsatiladi. */
const BOT_META: RequestMeta = { ipAddress: "telegram", userAgent: "telegram-bot" };

export type BotProduct = { id: string; name: string; price: string; stock: string };

/** Mijoz botidagi qidiruv: faqat faol va sotiladigan mahsulotlar. */
export async function searchBotProducts(conn: DbOrTx, companyId: string, query: string, limit = 8): Promise<BotProduct[]> {
  const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return conn
    .select({
      id: products.id,
      name: products.name,
      price: products.salesPrice,
      stock: sql<string>`coalesce((select sum(quantity) from stock_levels s where s.product_id = ${products.id}), 0)::text`,
    })
    .from(products)
    .where(
      and(
        eq(products.companyId, companyId),
        eq(products.isActive, true),
        sql`(${products.name} ilike ${pattern} or ${products.sku} ilike ${pattern} or ${products.barcode} ilike ${pattern})`,
      ),
    )
    .orderBy(desc(products.updatedAt))
    .limit(limit);
}

/** Buyurtma yoziladigan ombor: kompaniyaning asosiy (birinchi faol) ombori. */
async function defaultWarehouse(tx: Tx, companyId: string): Promise<string> {
  const [warehouse] = await tx
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.companyId, companyId), eq(warehouses.isActive, true)))
    .orderBy(desc(warehouses.isDefault), warehouses.createdAt)
    .limit(1);
  if (!warehouse) throw badRequest("Kompaniyada faol ombor yo'q");
  return warehouse.id;
}

/**
 * Botdan kelgan savat → qoralama buyurtma. Egasining hisobi nomidan: kim yaratgani auditda
 * "telegram-bot" sifatida qoladi.
 */
export async function createBotOrder(
  tx: Tx,
  companyId: string,
  customerId: string,
  items: { productId: string; quantity: string }[],
) {
  if (items.length === 0) throw badRequest("Savat bo'sh");
  const [company] = await tx
    .select({ ownerId: companies.ownerId })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (!company?.ownerId) throw badRequest("Kompaniya egasi topilmadi");

  const [owner] = await tx.select().from(users).where(eq(users.id, company.ownerId)).limit(1);
  if (!owner) throw badRequest("Kompaniya egasi topilmadi");

  const tenant = await requireTenant(tx, { ...owner, activeCompanyId: companyId });
  const order = await createOrder(
    tx,
    tenant,
    {
      customerId,
      warehouseId: await defaultWarehouse(tx, companyId),
      orderDate: new Date().toISOString().slice(0, 10),
      notes: "Telegram bot orqali buyurtma",
      items: items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      source: "bot",
    },
    BOT_META,
  );
  return order;
}
