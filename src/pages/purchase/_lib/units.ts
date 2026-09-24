/**
 * Hujjat qatorining o'lchov birligi: "dona" (asosiy) va qadoq ("blok").
 *
 * Qoida bitta: `products.purchase_price` — ASOSIY birlik narxi. Shuning uchun qator blokda
 * kiritilsa narx koeffitsientga KO'PAYTIRILADI (8 300/dona → 12 donalik blok → 99 600/blok).
 * Shusiz 12 donalik blok bitta dona narxida yozilib, hujjat 12 barobar kam chiqadi.
 */
import { num, type ProductOption, type UnitOption } from "./types.ts";

/** Server bermagan bo'lsa (yangi yaratilgan mahsulot) ro'yxat bo'sh — chaqiruvchi asosiy birlikka tushadi. */
export const unitsOf = (product: ProductOption | undefined): UnitOption[] => product?.unitOptions ?? [];

/** 1 birlikda nechta ASOSIY birlik bor (1 blok = 6 dona → 6). Noma'lum birlik — 1. */
export const factorOf = (product: ProductOption | undefined, unitId: string): number =>
  num(unitsOf(product).find((unit) => unit.unitId === unitId)?.factor) || 1;

/**
 * Qator ochilganda ASOSIY birlik turadi ("dona"), blokka foydalanuvchi o'zi o'tadi.
 *
 * Mahsulotning "xarid birligi" bu yerda QO'YILMAYDI: narx asosiy birlikda saqlanadi, shuning
 * uchun blok avtomatik qo'yilsa o'sha dona narxi blok narxi bo'lib qolardi.
 */
export const defaultUnitId = (product: ProductOption): string => product.baseUnitId;

/** Narxni bir birlikdan boshqasiga keltiradi (tiyingacha yaxlitlanadi). */
export function convertUnitPrice(price: number, fromFactor: number, toFactor: number): number {
  if (!(price > 0) || !(fromFactor > 0) || !(toFactor > 0) || fromFactor === toFactor) return price;
  return Math.round((price / fromFactor) * toFactor * 100) / 100;
}
