/**
 * Convex hujjat qiymatlarini PostgreSQL ustunlariga aylantirish.
 *
 * Convex'da pul va miqdor float64 edi — bu yerda aniq o'nlik satrga yaxlitlanadi
 * (pul — 2, miqdor/narx — 4 kasr xona). Noto'g'ri qiymat — `null` (chaqiruvchi standart qo'yadi).
 */
import { isValidPhone, normalizePhone } from "@bum/shared";
import { fromMinor, rescale, toMinor } from "../shared/decimal.js";

export type ConvexDoc = { _id: string; _creationTime: number } & Record<string, unknown>;

function decimal(value: unknown, scale: number): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) >= 1e15) return null;
  const precision = scale + 6;
  const minor = rescale(toMinor(Math.abs(value).toFixed(precision), precision), precision, scale);
  return fromMinor(value < 0 ? -minor : minor, scale);
}

/** numeric(18,2). */
export const moneyOrNull = (value: unknown) => decimal(value, 2);
export const money = (value: unknown, fallback = "0") => decimal(value, 2) ?? fallback;
/** numeric(18,4) — miqdor va birlik narxi. */
export const qtyOrNull = (value: unknown) => decimal(value, 4);
export const qty = (value: unknown, fallback = "0") => decimal(value, 4) ?? fallback;
/** numeric(5,2) — 0…999.99 oralig'iga siqiladi. */
export function percent(value: unknown, fallback = "0"): string {
  const text = decimal(value, 2);
  if (text === null) return fallback;
  const minor = toMinor(text);
  return fromMinor(minor < 0n ? 0n : minor > 99999n ? 99999n : minor);
}

export const isNegative = (value: string) => value.startsWith("-");

export function text(value: unknown, max?: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return max ? trimmed.slice(0, max) : trimmed;
}

export const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

export const int = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** "2026-09-11" yoki ISO vaqtdan sana qismi. */
export function isoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match && !Number.isNaN(Date.parse(match[1]!)) ? match[1]! : null;
}

export function timestamp(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value);
  return null;
}

export const creationDate = (doc: ConvexDoc) => new Date(doc._creationTime);
export const creationIsoDate = (doc: ConvexDoc) => creationDate(doc).toISOString().slice(0, 10);

/** "HH:MM" yoki "HH:MM:SS". */
export function timeOfDay(value: unknown): string | null {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value.trim()) ? value.trim() : null;
}

export function phone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = normalizePhone(value);
  return normalized && isValidPhone(normalized) ? normalized : null;
}

export function email(value: unknown): string | null {
  const candidate = text(value, 255);
  return candidate && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

/** Faqat ilova ichidagi yo'l — tashqi havola (fishing) ko'chirilmaydi. */
export function internalLink(value: unknown): string | null {
  const candidate = text(value, 500);
  return candidate && /^\/(?![/\\])[\w\-/?=&.%#]*$/.test(candidate) ? candidate : null;
}
