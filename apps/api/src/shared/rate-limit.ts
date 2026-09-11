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
