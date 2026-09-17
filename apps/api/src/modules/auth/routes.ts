/**
 * /api/auth — kirish, chiqish, joriy foydalanuvchi, o'z paroli va PIN.
 *
 * Convex mosligi:
 *   signIn("password")        → POST /login
 *   signOut                   → POST /logout
 *   users.getCurrentUser      → GET  /me
 *   (yangi)                   → POST /password     o'z parolini eski parol bilan
 *   (yangi)                   → POST /password-reset/request, /password-reset/confirm   SMS kod (Eskiz; o'chiq — 503)
 *   pin.getSecuritySettings   → GET  /security
 *   pin.setPin                → POST /pin
 *   pin.changePin             → POST /pin/change
 *   pin.removePin             → POST /pin/remove
 *   pin.verifyPin             → POST /pin/verify   (doim 200, { success, reason })
 *   pin.setAutoLockTimeout    → PUT  /auto-lock
 *   (yangi)                   → POST /lock         ekranni qulflash (sessiya saqlanadi; PIN o'rnatilgan bo'lishi shart)
 *   (yangi)                   → POST /unlock       shu sessiyani PIN bilan ochish (doim 200, { success, reason })
 *   (yangi)                   -> GET  /sessions, POST /sessions/revoke-others, DELETE /sessions/:sessionId — o'z qurilmalari
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../../db/client.js";
import { withTransaction } from "../../db/transaction.js";
import { requestMeta, writeAuditLog } from "../../shared/audit.js";
import { deviceError, registerDevice } from "./devices.service.js";
import { smsProvider } from "../../shared/sms.js";
import { changeOwnPassword, verifyCurrentPassword } from "../users/user-admin.service.js";
import { confirmPasswordReset, requestPasswordReset } from "./password-reset.service.js";
import { authenticate, buildMe, startSession } from "./auth.service.js";
import { authOf, requireAuth, requireSession } from "./guard.js";
import { listOwnSessions, revokeOtherSessions, revokeOwnSession } from "./sessions.service.js";
import {
  changePin,
  lockSession,
  pinFailureError,
  removePin,
  securitySettings,
  setAutoLockTimeout,
  setPin,
  unlockSession,
  verifyPin,
} from "./pin.service.js";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  revokeSession,
  setSessionCookie,
  validateSession,
} from "./session.js";

/**
 * Qurilma identifikatori: mijoz `x-device-id` sarlavhasida yuboradi (brauzerda saqlanadi).
 * Yuborilmasa — eski mijoz, qurilma tekshiruvi qo'llanmaydi.
 */
function deviceIdOf(req: FastifyRequest): string | null {
  const raw = req.headers["x-device-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(trimmed) ? trimmed : null;
}

const loginBody = z.object({
  phone: z.string().min(1).max(32),
  password: z.string().min(1).max(256),
});
const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(1).max(256),
});
const resetRequestBody = z.object({ phone: z.string().min(1).max(32) });
const resetConfirmBody = z.object({
  phone: z.string().min(1).max(32),
  code: z.string().regex(/^\d{6}$/, "Kod 6 xonali bo'lishi kerak"),
  newPassword: z.string().min(1).max(256),
});
const SMS_UNAVAILABLE = { code: "SERVICE_UNAVAILABLE", message: "SMS orqali tiklash sozlanmagan — administratorga murojaat qiling" };
const setPinBody = z.object({ pin: z.string() });
const changePinBody = z.object({ oldPin: z.string(), newPin: z.string() });
const removePinBody = z.object({ currentPin: z.string() });
const verifyPinBody = z.object({
  pin: z.string(),
  expectedUserId: z.string().min(1),
  expectedCompanyId: z.string().nullish(),
});
const autoLockBody = z.object({ seconds: z.number() });
const unlockBody = z.object({ pin: z.string().max(16) });
const sessionParams = z.object({ sessionId: z.uuid() });

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/login", async (req, reply) => {
    const body = loginBody.parse(req.body);
    const meta = requestMeta(req);

    const auth = await authenticate(body.phone, body.password, meta);
    // Parol to'g'ri bo'lsa ham qurilma tasdiqlanmagan bo'lsa kirish berilmaydi
    const device = {
      deviceId: deviceIdOf(req),
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    };
    // Qurilma yozuvi ALOHIDA tranzaksiyada saqlanadi — rad etilsa ham egasi uni ro'yxatda ko'radi
    const decision = await withTransaction((tx) => registerDevice(tx, auth.user.id, device));
    if (decision !== "allowed") throw deviceError(decision === "revoked");

    const { session, me } = await withTransaction((tx) => startSession(tx, auth, meta));

    setSessionCookie(reply, session.token, session.expiresAt);
    return { user: me };
  });

  app.post("/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      // Audit uchun kim chiqqani — sessiya bekor qilinishidan oldin
      const active = await validateSession(token);
      await revokeSession(token);
      if (active) {
        await writeAuditLog({
          userId: active.user.id,
          userName: active.user.name,
          companyId: active.user.activeCompanyId,
          action: "logout",
          resource: "users",
          resourceId: active.user.id,
          ...requestMeta(req),
        });
      }
    }
    clearSessionCookie(reply);
    return { ok: true };
  });

  // Qulflangan sessiyada ham ochiq — ilova qulf ekranini ko'rsatishi uchun
  app.get("/me", { preHandler: requireSession }, async (req) => {
    const session = authOf(req);
    return { user: await buildMe(db, session.user, { sessionLocked: session.lockedAt !== null }) };
  });

  // ─── Ekran qulfi (LOCK ≠ LOGOUT) ─────────────────────────────────────────

  app.post("/lock", { preHandler: requireSession }, async (req) => {
    const session = authOf(req);
    await withTransaction((tx) => lockSession(tx, session, requestMeta(req)));
    return { ok: true, locked: true };
  });

  /** Doim 200: `{ success, reason }` — urinishlar hisobi commit bo'lishi uchun xato tashlanmaydi. */
  app.post("/unlock", { preHandler: requireSession }, async (req) => {
    const { pin } = unlockBody.parse(req.body);
    const session = authOf(req);
    return withTransaction((tx) => unlockSession(tx, session, pin, requestMeta(req)));
  });

  app.post("/password", { preHandler: requireAuth }, async (req, reply) => {
    const body = changePasswordBody.parse(req.body);
    const { user } = authOf(req);
    const meta = requestMeta(req);

    await verifyCurrentPassword(user, body.currentPassword);
    const session = await withTransaction(async (tx) => {
      await changeOwnPassword(tx, user, body.currentPassword, body.newPassword, meta);
      // Barcha sessiyalar bekor qilindi — joriy qurilma uchun yangisi ochiladi
      return createSession(tx, { userId: user.id, ...meta });
    });

    setSessionCookie(reply, session.token, session.expiresAt);
    return { ok: true };
  });

  // ─── SMS orqali parol tiklash ────────────────────────────────────────────

  // Faol sessiyalar (o'z qurilmalari): ro'yxat, bittasini yoki joriydan boshqa hammasini tugatish
  app.get("/sessions", { preHandler: requireAuth }, async (req) => {
    return { sessions: await listOwnSessions(db, authOf(req).user.id, req.cookies[SESSION_COOKIE]!) };
  });

  app.post("/sessions/revoke-others", { preHandler: requireAuth }, async (req) => {
    const revoked = await withTransaction((tx) => revokeOtherSessions(tx, authOf(req).user, req.cookies[SESSION_COOKIE]!, requestMeta(req)));
    return { revoked };
  });

  app.delete("/sessions/:sessionId", { preHandler: requireAuth }, async (req) => {
    const { sessionId } = sessionParams.parse(req.params);
    await withTransaction((tx) => revokeOwnSession(tx, authOf(req).user, sessionId, req.cookies[SESSION_COOKIE]!, requestMeta(req)));
    return { ok: true };
  });

  app.post("/password-reset/request", async (req, reply) => {
    const { phone } = resetRequestBody.parse(req.body);
    const sms = smsProvider.client;
    if (!sms) return reply.status(503).send(SMS_UNAVAILABLE);

    await requestPasswordReset(phone, requestMeta(req), sms);
    return { ok: true, message: "Agar raqam ro'yxatdan o'tgan bo'lsa, SMS kod yuborildi" };
  });

  app.post("/password-reset/confirm", async (req, reply) => {
    const body = resetConfirmBody.parse(req.body);
    if (!smsProvider.client) return reply.status(503).send(SMS_UNAVAILABLE);

    await confirmPasswordReset(body, requestMeta(req));
    return { ok: true };
  });

  // ─── PIN ─────────────────────────────────────────────────────────────────

  app.get("/security", { preHandler: requireAuth }, async (req) => {
    return securitySettings(authOf(req).user);
  });

  app.post("/pin", { preHandler: requireAuth }, async (req) => {
    const { pin } = setPinBody.parse(req.body);
    const { user } = authOf(req);
    await withTransaction((tx) => setPin(tx, user.id, pin, requestMeta(req)));
    return { ok: true };
  });

  app.post("/pin/change", { preHandler: requireAuth }, async (req) => {
    const { oldPin, newPin } = changePinBody.parse(req.body);
    const { user } = authOf(req);
    const result = await withTransaction((tx) =>
      changePin(tx, user.id, oldPin, newPin, requestMeta(req)),
    );
    // Xato commit'dan keyin — urinishlar hisobi saqlanib qolishi uchun
    if (!result.success) throw pinFailureError(result.reason);
    return { ok: true };
  });

  app.post("/pin/remove", { preHandler: requireAuth }, async (req) => {
    const { currentPin } = removePinBody.parse(req.body);
    const { user } = authOf(req);
    const result = await withTransaction((tx) =>
      removePin(tx, user.id, currentPin, requestMeta(req)),
    );
    if (!result.success) throw pinFailureError(result.reason);
    return { ok: true };
  });

  app.post("/pin/verify", { preHandler: requireAuth }, async (req) => {
    const body = verifyPinBody.parse(req.body);
    const { user } = authOf(req);
    return withTransaction((tx) => verifyPin(tx, user.id, body, requestMeta(req)));
  });

  app.put("/auto-lock", { preHandler: requireAuth }, async (req) => {
    const { seconds } = autoLockBody.parse(req.body);
    await setAutoLockTimeout(db, authOf(req).user.id, seconds);
    return { ok: true };
  });
}
