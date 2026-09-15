/**
 * Foydalanuvchining o'z faol sessiyalari (qurilmalar): ro'yxat, bitta sessiyani yoki joriydan boshqa hammasini tugatish.
 * Faqat o'z sessiyalari — boshqa foydalanuvchining sessiya ID'si 404. Joriy sessiya "Chiqish" bilan tugatiladi.
 * Token va uning xeshi javobga chiqmaydi.
 */
import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import { badRequest, notFound } from "@bum/shared";
import { sessions } from "../../db/schema/platform.js";
import type { DbOrTx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { hashToken, type ActiveSession } from "./session.js";

type SessionUser = ActiveSession["user"];

const activeFor = (userId: string, now: Date) =>
  and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now), gt(sessions.idleExpiresAt, now));

export async function listOwnSessions(conn: DbOrTx, userId: string, token: string) {
  const current = hashToken(token);
  const rows = await conn
    .select({
      id: sessions.id,
      tokenHash: sessions.tokenHash,
      ipAddress: sessions.ipAddress,
      userAgent: sessions.userAgent,
      createdAt: sessions.createdAt,
      lastUsedAt: sessions.lastUsedAt,
      expiresAt: sessions.expiresAt,
      locked: sessions.lockedAt,
    })
    .from(sessions)
    .where(activeFor(userId, new Date()))
    .orderBy(desc(sessions.lastUsedAt), desc(sessions.createdAt))
    .limit(50);
  return rows.map(({ tokenHash, locked, ...row }) => ({ ...row, locked: locked !== null, current: tokenHash === current }));
}

async function audit(conn: DbOrTx, user: SessionUser, meta: RequestMeta, action: string, details: Record<string, unknown>) {
  await writeAuditLog(
    { userId: user.id, userName: user.name, companyId: user.activeCompanyId, action, resource: "sessions", resourceId: user.id, details, ...meta },
    conn,
  );
}

export async function revokeOwnSession(conn: DbOrTx, user: SessionUser, sessionId: string, token: string, meta: RequestMeta) {
  const [target] = await conn
    .select({ id: sessions.id, tokenHash: sessions.tokenHash })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), activeFor(user.id, new Date())))
    .limit(1);
  if (!target) throw notFound("Sessiya topilmadi");
  if (target.tokenHash === hashToken(token)) throw badRequest("Joriy sessiya \"Chiqish\" tugmasi bilan tugatiladi");
  await conn.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, target.id));
  await audit(conn, user, meta, "SESSION_REVOKED", { sessionId: target.id });
}

/** Joriydan boshqa barcha sessiyalar (boshqa brauzer va qurilmalar) — nechta tugatilgani. */
export async function revokeOtherSessions(conn: DbOrTx, user: SessionUser, token: string, meta: RequestMeta) {
  const revoked = await conn
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt), ne(sessions.tokenHash, hashToken(token))))
    .returning({ id: sessions.id });
  await audit(conn, user, meta, "SESSIONS_REVOKED_OTHERS", { count: revoked.length });
  return revoked.length;
}
