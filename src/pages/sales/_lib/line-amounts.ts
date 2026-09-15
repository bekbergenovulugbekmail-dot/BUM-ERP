/**
 * Serverdagi `computeLine` (apps/api/src/shared/line-amounts.ts) nusxasi — butun sonlarda.
 *
 * Oldindan ko'rilgan chek summasi serverdagi bilan tiyinigacha bir xil bo'lishi kerak:
 * karta/bank to'lovi chek summasidan oshsa server rad etadi. Yakuniy summa baribir serverdan olinadi.
 */
export type LineInput = {
  quantity: string | number;
  unitPrice: string | number;
  taxRate?: string | number;
  discountPercent?: string | number;
  taxIncluded?: boolean;
};

function toMinor(value: string | number, scale: number): bigint {
  const text = typeof value === "number" ? (Number.isFinite(value) ? value.toFixed(scale) : "0") : value.trim();
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match) return 0n;
  const [, sign, int = "", frac = ""] = match;
  const minor = BigInt((int || "0") + frac.slice(0, scale).padEnd(scale, "0"));
  return sign ? -minor : minor;
}

function rescale(minor: bigint, fromScale: number, toScale: number): bigint {
  if (toScale >= fromScale) return minor * 10n ** BigInt(toScale - fromScale);
  const divisor = 10n ** BigInt(fromScale - toScale);
  const negative = minor < 0n;
  const rounded = ((negative ? -minor : minor) + divisor / 2n) / divisor;
  return negative ? -rounded : rounded;
}

function mulDivRound(a: bigint, b: bigint, c: bigint): bigint {
  return (a * b * 2n + c) / (2n * c);
}

/** Natija tiyinlarda (2 kasr xona). */
export function computeLine(item: LineInput) {
  const gross = toMinor(item.quantity, 4) * toMinor(item.unitPrice, 4);
  const discount = rescale(gross * toMinor(item.discountPercent ?? "0", 2), 12, 8);
  const afterDiscount = gross - discount;
  const rate = toMinor(item.taxRate ?? "0", 2);

  let net: bigint;
  let tax: bigint;
  if (item.taxIncluded) {
    const total = rescale(afterDiscount, 8, 2);
    tax = rate === 0n ? 0n : mulDivRound(total, rate, 10000n + rate);
    net = total - tax;
  } else {
    net = rescale(afterDiscount, 8, 2);
    // Bir marta yaxlitlanadi (server `line-amounts.ts` bilan bir xil)
    tax = rescale(afterDiscount * rate, 12, 2);
  }
  return { net, tax, discount: rescale(discount, 8, 2), lineTotal: net + tax };
}

export const minorToNumber = (minor: bigint) => Number(minor) / 100;

/** 1250n → "12.50" — API'ga aniq summa yuborish uchun. */
export function fromMinor(minor: bigint): string {
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(3, "0");
  const text = `${digits.slice(0, -2)}.${digits.slice(-2)}`;
  return negative ? `-${text}` : text;
}
