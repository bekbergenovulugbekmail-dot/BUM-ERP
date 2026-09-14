/**
 * Fixed-window rate limit — PostgreSQL'da (`rate_limits`).
 * Hozirgi hajm uchun Redis shart emas.
 *
 * Ikki qadam ataylab ajratilgan: `assertNotLimited` hisobni oshirmaydi,
 * `recordHit` faqat muvaffaqiyatsiz urinishda chaqiriladi — shunda to'g'ri
 * kirgan foydalanuvchi o'z urinishlari bilan bloklanib qolmaydi.
 */
import { and, eq, sql } from "drizzle-orm";
import { rateLimited } from "@bum/shared";
import { db } from "../db/client.js";
import { rateLimits } from "../db/schema/platform.js";

function windowStart(windowSeconds: number, now = Date.now()): Date {
  const size = windowSeconds * 1000;
  return new Date(Math.floor(now / size) * size);
}

/** Joriy oynada `limit` ga yetilgan bo'lsa RATE_LIMITED tashlaydi. */
export async function assertNotLimited(
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const [row] = await db
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(and(eq(rateLimits.bucket, bucket), eq(rateLimits.windowStart, windowStart(windowSeconds))));
  if (row && row.count >= limit) throw rateLimited();
}

/**
 * Urinishni AVVAL hisoblaydi (atomar), keyin chegarani tekshiradi: parallel so'rovlar ham limitdan oshib keta olmaydi
 * (`assertNotLimited` + keyinroq `recordHit` oralig'ida bir nechta so'rov o'tib ketardi). To'g'ri urinishdan keyin
 * `releaseAttempt` hisobni qaytaradi.
 */
export async function consumeAttempt(bucket: string, limit: number, windowSeconds: number): Promise<void> {
  const count = await recordHit(bucket, windowSeconds);
  if (count > limit) throw rateLimited();
}

/** Muvaffaqiyatli urinish hisobini qaytaradi (joriy oynada, noldan pastga tushmaydi). */
export async function releaseAttempt(bucket: string, windowSeconds: number): Promise<void> {
  await db
    .update(rateLimits)
    .set({ count: sql`greatest(${rateLimits.count} - 1, 0)` })
    .where(and(eq(rateLimits.bucket, bucket), eq(rateLimits.windowStart, windowStart(windowSeconds))));
}

/** Joriy oynadagi hisobni atomar oshiradi va yangi qiymatni qaytaradi. */
export async function recordHit(bucket: string, windowSeconds: number): Promise<number> {
  const [row] = await db
    .insert(rateLimits)
    .values({ bucket, windowStart: windowStart(windowSeconds), count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.bucket, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });
  return row?.count ?? 1;
}
