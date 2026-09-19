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

/**
 * Mahsulot uchun BARCHA birlik → asosiy birlik koeffitsientlari (bitta so'rovda).
 *
 * Narx tahlilida (`product-cost.service.ts`) hujjat qatorlari turli birlikda bo'lishi mumkin:
 * "quti"dagi narxni "dona"dagi narx bilan solishtirmaslik uchun hammasi asosiy birlikka keltiriladi.
 * Konversiya topilmagan birlik xaritaga tushmaydi — chaqiruvchi bunday qatorni hisobga olmaydi
 * (xato o'rniga: tarixiy hujjatda eski birlik uchraganda ham narx taklifi ishlashi kerak).
 */
export async function unitFactorsToBase(
  conn: DbOrTx,
  companyId: string,
  product: { id: string; baseUnitId: string },
): Promise<Map<string, number>> {
  const rows = await conn
    .select({ fromUnitId: unitConversions.fromUnitId, factor: unitConversions.factor, productId: unitConversions.productId })
    .from(unitConversions)
    .where(
      and(
        eq(unitConversions.companyId, companyId),
        eq(unitConversions.toUnitId, product.baseUnitId),
        or(eq(unitConversions.productId, product.id), isNull(unitConversions.productId)),
      ),
    );

  const factors = new Map<string, number>([[product.baseUnitId, 1]]);
  // Avval umumiy, keyin mahsulotga xos — ikkinchisi birinchisining ustidan yozadi
  for (const row of rows.filter((r) => r.productId === null).concat(rows.filter((r) => r.productId !== null))) {
    const value = Number(row.factor);
    if (Number.isFinite(value) && value > 0) factors.set(row.fromUnitId, value);
  }
  return factors;
}
