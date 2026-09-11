/**
 * Davriy tozalash (PHASE 4): eskirgan sessiyalar, parol tiklash kodlari va rate limit oynalari.
 *
 * - 1 kunlik zaxira bilan o'chiriladi (eng uzun rate limit oynasi hozir 1 soat)
 * - bir nechta API nusxasi bo'lsa ham bir vaqtda faqat bittasi bajaradi (advisory lock)
 * - server kirish nuqtasida ishga tushadi, testlarda `purgeExpired` to'g'ridan-to'g'ri chaqiriladi
 */
import { and, isNotNull, lt, or, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { passwordResetCodes, rateLimits, sessions } from "../db/schema/platform.js";
import { withTransaction } from "../db/transaction.js";
import { purgeAgentLocations } from "../modules/sales-agent/location.service.js";

const RETENTION_MS = 24 * 60 * 60 * 1000;
const INTERVAL_MS = 60 * 60 * 1000;

export type PurgeResult = {
  sessions: number;
  passwordResetCodes: number;
  rateLimits: number;
  /** Kompaniya siyosatidagi saqlash muddatidan eski agent lokatsiyalari va hodisalari. */
  agentLocations: number;
  agentLocationEvents: number;
};

/** Lock boshqa nusxada band bo'lsa `null`. */
export async function purgeExpired(now = new Date()): Promise<PurgeResult | null> {
  const cutoff = new Date(now.getTime() - RETENTION_MS);
  return withTransaction(async (tx) => {
    const lock = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtext('maintenance:purge-expired')) as locked`,
    );
    if (!lock.rows[0]?.locked) return null;

    const expiredSessions = await tx
      .delete(sessions)
      .where(
        or(
          lt(sessions.expiresAt, cutoff),
          lt(sessions.idleExpiresAt, cutoff),
          and(isNotNull(sessions.revokedAt), lt(sessions.revokedAt, cutoff)),
        ),
      );
    const expiredCodes = await tx.delete(passwordResetCodes).where(lt(passwordResetCodes.expiresAt, cutoff));
    const oldWindows = await tx.delete(rateLimits).where(lt(rateLimits.windowStart, cutoff));
    const agentLocations = await purgeAgentLocations(tx, now);

    return {
      sessions: expiredSessions.rowCount ?? 0,
      passwordResetCodes: expiredCodes.rowCount ?? 0,
      rateLimits: oldWindows.rowCount ?? 0,
      ...agentLocations,
    };
  });
}

/** Darhol bir marta, keyin har soatda. Qaytarilgan funksiya to'xtatadi. */
export function startMaintenance(log: FastifyBaseLogger): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await purgeExpired();
      if (result && Object.values(result).some((count) => count > 0)) {
        log.info({ purged: result }, "Eskirgan yozuvlar tozalandi");
      }
    } catch (error) {
      log.error({ err: error }, "Davriy tozalash xatosi");
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
