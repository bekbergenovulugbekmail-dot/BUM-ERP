/**
 * Pul, narx va miqdor — PostgreSQL `numeric`, JS tomonda doim SATR.
 *
 * Convex'da hammasi float64 edi (0.1 + 0.2 muammosi, buxgalteriyada yaxlitlash
 * xatosi). Bu yerda kiritish son yoki satr bo'lishi mumkin, lekin kasr xonalar
 * soni cheklanadi va qiymat normallashtirilgan satr sifatida saqlanadi.
 */
import { z } from "zod";

function normalize(text: string): string {
  const negative = text.startsWith("-");
  const [intPart = "0", fracPart = ""] = text.replace(/^-/, "").split(".");
  const int = intPart.replace(/^0+(?=\d)/, "");
  const frac = fracPart.replace(/0+$/, "");
  const out = frac ? `${int}.${frac}` : int;
  return negative && out !== "0" ? `-${out}` : out;
}

export function decimalSchema(options: { scale: number; min?: number; max?: number; positive?: boolean }) {
  const pattern = new RegExp(`^-?\\d{1,14}(\\.\\d{1,${options.scale}})?$`);

  return z.union([z.number(), z.string().trim()]).transform((value, ctx) => {
    const text = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : value;
    if (!pattern.test(text)) {
      ctx.addIssue({ code: "custom", message: `Son noto'g'ri (ko'pi bilan ${options.scale} kasr xona)` });
      return z.NEVER;
    }
    const n = Number(text);
    if (options.positive && !(n > 0)) {
      ctx.addIssue({ code: "custom", message: "Musbat son bo'lishi kerak" });
      return z.NEVER;
    }
    if (options.min !== undefined && n < options.min) {
      ctx.addIssue({ code: "custom", message: `Kamida ${options.min} bo'lishi kerak` });
      return z.NEVER;
    }
    if (options.max !== undefined && n > options.max) {
      ctx.addIssue({ code: "custom", message: `Ko'pi bilan ${options.max} bo'lishi kerak` });
      return z.NEVER;
    }
    return normalize(text);
  });
}

/** numeric(18,2), manfiy emas. */
export const moneySchema = decimalSchema({ scale: 2, min: 0 });
/** numeric(18,4), manfiy emas — birlik narxi. */
export const priceSchema = decimalSchema({ scale: 4, min: 0 });
/** numeric(18,4), manfiy emas — miqdor. */
export const qtySchema = decimalSchema({ scale: 4, min: 0 });
/** numeric(5,2) — foiz 0..100. */
export const percentSchema = decimalSchema({ scale: 2, min: 0, max: 100 });

/**
 * numeric satr → kichik birliklardagi butun son: "12.5" → 1250n (scale 2).
 * Yig'indi va solishtirish float'siz, aniq bo'lishi uchun.
 */
export function toMinor(value: string, scale = 2): bigint {
  const text = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw new Error(`Son emas: ${value}`);
  const negative = text.startsWith("-");
  const [int = "0", frac = ""] = text.replace(/^-/, "").split(".");
  if (/[1-9]/.test(frac.slice(scale))) throw new Error(`Kasr xonalar ${scale} tadan ko'p: ${value}`);
  const minor = BigInt(int + frac.slice(0, scale).padEnd(scale, "0"));
  return negative ? -minor : minor;
}

/** `toMinor` teskarisi: 1250n → "12.50". */
export function fromMinor(minor: bigint, scale = 2): string {
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(scale + 1, "0");
  const text = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative ? `-${text}` : text;
}
