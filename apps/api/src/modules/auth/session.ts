/**
 * Sessiyalar: tasodifiy token cookie'da, bazada faqat uning SHA-256 xeshi.
 *
 * Ikki muddat:
 *  - mutlaq (SESSION_ABSOLUTE_DAYS) — hech qachon uzaytirilmaydi;
 *  - faolsizlik (SESSION_IDLE_HOURS) — faol so'rovda uzayadi, lekin mutlaq
 *    muddatdan oshmaydi.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { FastifyReply } from "fastify";
import { db } from "../../db/client.js";
import { sessions, users } from "../../db/schema/platform.js";
import type { DbOrTx } from "../../db/transaction.js";
import { env, isProd } from "../../env.js";
import type { RequestMeta } from "../../shared/audit.js";

export const SESSION_COOKIE = "bum_session";

/** Faollik shundan tez-tez yozilmaydi — har so'rovda UPDATE bo'lmasligi uchun. */
const TOUCH_INTERVAL_MS = 60_000;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export type SessionUser = typeof users.$inferSelect;

export type ActiveSession = {
  sessionId: string;
  user: SessionUser;
  /** Ekran qulflangan — faqat /me, /unlock (PIN) va /logout ochiq. */
  lockedAt: Date | null;
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function idleDeadline(now: number, expiresAt: Date): Date {
  return new Date(Math.min(now + env.SESSION_IDLE_HOURS * HOUR_MS, expiresAt.getTime()));
}

export async function createSession(
  conn: DbOrTx,
  input: { userId: string } & RequestMeta,
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = new Date(now + env.SESSION_ABSOLUTE_DAYS * DAY_MS);

  const [row] = await conn
    .insert(sessions)
    .values({
      userId: input.userId,
      tokenHash: hashToken(token),
      expiresAt,
      idleExpiresAt: idleDeadline(now, expiresAt),
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      lastUsedAt: new Date(now),
    })
    .returning({ id: sessions.id });

  return { token, sessionId: row!.id, expiresAt };
}

/** Token yaroqli bo'lsa sessiya va foydalanuvchini qaytaradi, aks holda null. */
export async function validateSession(token: string): Promise<ActiveSession | null> {
  const now = new Date();
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
        gt(sessions.idleExpiresAt, now),
      ),
    )
    .limit(1);

  // O'chirilgan (faol bo'lmagan) hisobning sessiyalari ham ishlamaydi
  if (!row || !row.user.isActive) return null;

  const lastUsed = row.session.lastUsedAt?.getTime() ?? 0;
  if (now.getTime() - lastUsed > TOUCH_INTERVAL_MS) {
    await db
      .update(sessions)
      .set({ lastUsedAt: now, idleExpiresAt: idleDeadline(now.getTime(), row.session.expiresAt) })
      .where(eq(sessions.id, row.session.id));
    await db.update(users).set({ lastSeenAt: now }).where(eq(users.id, row.user.id));
  }

  return { sessionId: row.session.id, user: row.user, lockedAt: row.session.lockedAt };
}

/**
 * Tokenni faollik vaqtini YANGILAMASDAN tekshiradi — uzoq ulanishlarni (WebSocket) davriy qayta tekshirish uchun:
 * ochiq qolgan oyna sessiyaning faolsizlik muddatini cho'zmasin.
 */
export async function peekSession(token: string): Promise<ActiveSession | null> {
  const now = new Date();
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
        gt(sessions.idleExpiresAt, now),
      ),
    )
    .limit(1);
  if (!row || !row.user.isActive) return null;
  return { sessionId: row.session.id, user: row.user, lockedAt: row.session.lockedAt };
}

export async function revokeSession(token: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)));
}

/** Parol almashtirilganda va hisob bloklanganda — barcha qurilmalardan chiqarish. */
export async function revokeUserSessions(conn: DbOrTx, userId: string): Promise<void> {
  await conn
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}
