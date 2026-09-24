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
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { badRequest } from "@bum/shared";
import { unitConversions, units } from "../../db/schema/catalog.js";
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

/**
 * Bir necha mahsulot uchun "qaysi birlikda kiritish mumkin" ro'yxati — BITTA so'rovda.
 *
 * Hujjat qatorida miqdor asosiy birlikda ham ("dona"), qadoqda ham ("blok") kiritilishi kerak:
 * ta'minotchi blok bilan sotadi, ombor esa donada yuritiladi. Ro'yxat har doim asosiy birlikdan
 * boshlanadi, keyin shu mahsulotga konversiyasi bor birliklar (mahsulotga xos konversiya umumiysidan ustun).
 *
 * `factor` — 1 birlikda nechta ASOSIY birlik bor (1 blok = 6 dona → "6"). Asosiy birlik uchun "1".
 */
export type UnitOption = { unitId: string; name: string; shortName: string; factor: string; allowsFraction: boolean };

export async function unitOptionsForProducts(
  conn: DbOrTx,
  companyId: string,
  items: { id: string; baseUnitId: string }[],
): Promise<Map<string, UnitOption[]>> {
  const result = new Map<string, UnitOption[]>();
  if (items.length === 0) return result;

  const baseUnitIds = [...new Set(items.map((item) => item.baseUnitId))];
  const productIds = items.map((item) => item.id);

  const rows = await conn
    .select({
      productId: unitConversions.productId,
      fromUnitId: unitConversions.fromUnitId,
      toUnitId: unitConversions.toUnitId,
      factor: unitConversions.factor,
      name: units.name,
      shortName: units.shortName,
      allowsFraction: units.allowsFraction,
    })
    .from(unitConversions)
    .innerJoin(units, eq(units.id, unitConversions.fromUnitId))
    .where(
      and(
        eq(unitConversions.companyId, companyId),
        inArray(unitConversions.toUnitId, baseUnitIds),
        or(inArray(unitConversions.productId, productIds), isNull(unitConversions.productId)),
        eq(units.isActive, true),
      ),
    );

  const baseUnits = await conn
    .select({ id: units.id, name: units.name, shortName: units.shortName, allowsFraction: units.allowsFraction })
    .from(units)
    .where(inArray(units.id, baseUnitIds));
  const baseById = new Map(baseUnits.map((unit) => [unit.id, unit]));

  for (const item of items) {
    const base = baseById.get(item.baseUnitId);
    const options = new Map<string, UnitOption>();
    if (base) options.set(base.id, { unitId: base.id, name: base.name, shortName: base.shortName, factor: "1", allowsFraction: base.allowsFraction });
    // Avval umumiy, keyin mahsulotga xos — ikkinchisi birinchisining ustidan yozadi
    for (const row of rows.filter((r) => r.productId === null).concat(rows.filter((r) => r.productId === item.id))) {
      if (row.toUnitId !== item.baseUnitId || row.fromUnitId === item.baseUnitId) continue;
      options.set(row.fromUnitId, { unitId: row.fromUnitId, name: row.name, shortName: row.shortName, factor: row.factor, allowsFraction: row.allowsFraction });
    }
    result.set(item.id, [...options.values()]);
  }
  return result;
}
