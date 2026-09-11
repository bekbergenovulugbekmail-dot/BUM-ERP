/**
 * O'lchov birligi → mahsulotning asosiy birligi koeffitsienti.
 *
 * Zaxira doim asosiy birlikda yuritiladi (inventory/stock.service.ts). Convex
 * xarid qabulida konversiyani e'tiborsiz qoldirardi — "quti"da qabul qilingan
 * tovar "dona" sifatida zaxiraga tushardi.
 *
 * Mahsulotga xos konversiya umumiysidan ustun. Faqat to'g'ri yo'nalish
 * (birlik → asosiy) qo'llanadi: teskari koeffitsientni bo'lish yaxlitlash beradi.
 */
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { badRequest } from "@bum/shared";
import { unitConversions } from "../../db/schema/catalog.js";
import type { DbOrTx } from "../../db/transaction.js";

export async function unitFactorToBase(
  conn: DbOrTx,
  companyId: string,
  product: { id: string; name: string; baseUnitId: string },
  unitId: string,
): Promise<string> {
  if (unitId === product.baseUnitId) return "1";

  const [row] = await conn
    .select({ factor: unitConversions.factor })
    .from(unitConversions)
    .where(
      and(
        eq(unitConversions.companyId, companyId),
        eq(unitConversions.fromUnitId, unitId),
        eq(unitConversions.toUnitId, product.baseUnitId),
        or(eq(unitConversions.productId, product.id), isNull(unitConversions.productId)),
      ),
    )
    .orderBy(sql`${unitConversions.productId} is null`)
    .limit(1);
  if (!row) throw badRequest(`${product.name}: bu o'lchov birligidan asosiy birlikka konversiya yo'q`);
  return row.factor;
}
