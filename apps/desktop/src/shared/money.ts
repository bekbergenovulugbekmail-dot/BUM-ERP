/**
 * Pul, narx va miqdor — butun sonlarda (float'siz). Serverdagi `apps/api/src/shared/decimal.ts` va
 * `line-amounts.ts` bilan aynan bir xil yaxlitlash: offline chek summasi sinxronda serverdagi bilan tiyinigacha mos.
 */

/** "12.5" → 1250n (scale 2). Noto'g'ri satr — 0n emas, xato (summa jimgina yo'qolmasin). */
export function toMinor(value: string | number, scale = 2): bigint {
  const text = typeof value === "number" ? (Number.isFinite(value) ? value.toFixed(scale) : "") : value.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error(`Son emas: ${String(value)}`);
  const [, sign, int = "0", frac = ""] = match;
  const minor = BigInt(int + frac.slice(0, scale).padEnd(scale, "0"));
  return sign ? -minor : minor;
}

/** Masshtabni o'zgartirish, kichraytirishda half-up (ishoraga simmetrik). */
export function rescale(minor: bigint, fromScale: number, toScale: number): bigint {
  if (toScale >= fromScale) return minor * 10n ** BigInt(toScale - fromScale);
  const divisor = 10n ** BigInt(fromScale - toScale);
  const negative = minor < 0n;
  const rounded = ((negative ? -minor : minor) + divisor / 2n) / divisor;
  return negative ? -rounded : rounded;
}

/** round(a × b / c), half-up; a, b ≥ 0, c > 0. */
export function mulDivRound(a: bigint, b: bigint, c: bigint): bigint {
  return (a * b * 2n + c) / (2n * c);
}

/** 1250n → "12.50". */
export function fromMinor(minor: bigint, scale = 2): string {
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(scale + 1, "0");
  const text = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative ? `-${text}` : text;
}

export const minBig = (...values: bigint[]) => values.reduce((a, b) => (b < a ? b : a));
export const maxBig = (...values: bigint[]) => values.reduce((a, b) => (b > a ? b : a));

/** Ekranda ko'rsatish uchun (hisob uchun emas). */
export const minorToNumber = (minor: bigint, scale = 2) => Number(minor) / 10 ** scale;

export type LineInput = {
  quantity: string;
  unitPrice: string;
  taxRate?: string;
  discountPercent?: string;
  taxIncluded?: boolean;
};

/** Hujjat qatori: miqdor × narx → chegirma → soliq (ichida yoki ustiga) → tiyin. */
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

/** Narx × koeffitsient (4 xona) — birlik konversiyasi yoki valyuta kursi. */
export const scalePrice = (price: string, factor: string) => fromMinor(rescale(toMinor(price, 4) * toMinor(factor, 4), 8, 4), 4);

/** Normallashtirilgan o'nlik satr ("12.50" → "12.5", "3.0000" → "3") — kiritishni solishtirish uchun. */
export function normalizeDecimal(text: string): string {
  const negative = text.startsWith("-");
  const [intPart = "0", fracPart = ""] = text.replace(/^-/, "").split(".");
  const int = intPart.replace(/^0+(?=\d)/, "");
  const frac = fracPart.replace(/0+$/, "");
  const out = frac ? `${int}.${frac}` : int;
  return negative && out !== "0" ? `-${out}` : out;
}
