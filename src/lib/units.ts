/**
 * Hujjat qatorining o'lchov birligi: "dona" (asosiy) va qadoq ("blok"). Xarid va sotuvda bir xil.
 *
 * Qoida bitta: mahsulotdagi narx (`purchase_price`, `sales_price`) — ASOSIY birlik narxi.
 * Shuning uchun qator blokda kiritilsa narx koeffitsientga KO'PAYTIRILADI (8 300/dona →
 * 12 donalik blok → 99 600/blok). Shusiz 12 donalik blok bitta dona narxida yozilib,
 * hujjat 12 barobar kam chiqadi.
 *
 * Birliklar serverdan `?withUnits=true` bilan keladi (`GET /api/catalog/products`).
 */

/** `factor` — 1 birlikda nechta ASOSIY birlik bor ("1 blok = 12 dona" → "12"); asosiyda "1". */
export type UnitOption = { unitId: string; name: string; shortName: string; factor: string };

type WithUnits = { unitOptions?: UnitOption[] };

/** Server ro'yxat bermagan bo'lsa (yangi yaratilgan mahsulot) — bo'sh; chaqiruvchi asosiy birlikka tushadi. */
export const unitsOf = (product: WithUnits | undefined): UnitOption[] => product?.unitOptions ?? [];

/** Koeffitsient; noma'lum birlik yoki ro'yxat yo'q bo'lsa — 1. */
export function factorOf(product: WithUnits | undefined, unitId: string): number {
  const value = Number(unitsOf(product).find((unit) => unit.unitId === unitId)?.factor);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/**
 * Qator ochilganda ASOSIY birlik turadi, qadoqqa foydalanuvchi o'zi o'tadi.
 *
 * Mahsulotning "xarid/sotuv birligi" bu yerda QO'YILMAYDI: narx asosiy birlikda saqlanadi,
 * shuning uchun blok avtomatik qo'yilsa o'sha dona narxi blok narxi bo'lib qolardi.
 */
export const defaultUnitId = (product: { baseUnitId: string }): string => product.baseUnitId;

/** Narxni bir birlikdan boshqasiga keltiradi (tiyingacha yaxlitlanadi). */
export function convertUnitPrice(price: number, fromFactor: number, toFactor: number): number {
  if (!(price > 0) || !(fromFactor > 0) || !(toFactor > 0) || fromFactor === toFactor) return price;
  return Math.round((price / fromFactor) * toFactor * 100) / 100;
}
