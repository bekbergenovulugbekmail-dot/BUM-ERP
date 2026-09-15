/**
 * Hujjat qatori summalari (xarid, savdo, POS) — butun sonlarda, float'siz.
 *
 * miqdor × narx (8 xona) → chegirma → soliq → tiyinga yaxlitlash.
 * `taxIncluded`: narx soliqni o'z ichiga oladi (chakana narx) — soliq ichidan
 * ajratiladi, jami narxdan oshmaydi; aks holda soliq ustiga qo'shiladi.
 */
import { mulDivRound, rescale, toMinor } from "./decimal.js";

export type LineInput = {
  quantity: string;
  unitPrice: string;
  taxRate?: string;
  discountPercent?: string;
  taxIncluded?: boolean;
};

export function computeLine(item: LineInput) {
  const gross = toMinor(item.quantity, 4) * toMinor(item.unitPrice, 4);
  const discount = rescale(gross * toMinor(item.discountPercent ?? "0", 2), 12, 8);
  const afterDiscount = gross - discount;
  const rate = toMinor(item.taxRate ?? "0", 2);

  let net: bigint;
  let tax: bigint;
  if (item.taxIncluded) {
    const total = rescale(afterDiscount, 8, 2);
    // soliq = jami × r / (100 + r)
    tax = rate === 0n ? 0n : mulDivRound(total, rate, 10000n + rate);
    net = total - tax;
  } else {
    net = rescale(afterDiscount, 8, 2);
    // Bir marta yaxlitlanadi: ikki bosqichli half-up (12 → 8 → 2) chegaraviy qiymatda 1 tiyin qo'shardi
    tax = rescale(afterDiscount * rate, 12, 2);
  }
  return { net, tax, discount: rescale(discount, 8, 2), lineTotal: net + tax };
}
