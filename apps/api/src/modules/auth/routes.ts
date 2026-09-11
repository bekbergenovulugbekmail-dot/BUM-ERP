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
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db/client.js";
import { withTransaction } from "../../db/transaction.js";
import { requestMeta } from "../../shared/audit.js";
import { smsProvider } from "../../shared/sms.js";
import { changeOwnPassword, verifyCurrentPassword } from "../users/user-admin.service.js";
import { confirmPasswordReset, requestPasswordReset } from "./password-reset.service.js";
import { authenticate, buildMe, startSession } from "./auth.service.js";
import { authOf, requireAuth } from "./guard.js";
import {
  changePin,
  pinFailureError,
  removePin,
  securitySettings,
  setAutoLockTimeout,
  setPin,
  verifyPin,
} from "./pin.service.js";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  revokeSession,
  setSessionCookie,
} from "./session.js";

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

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/login", async (req, reply) => {
    const body = loginBody.parse(req.body);
    const meta = requestMeta(req);

    const auth = await authenticate(body.phone, body.password, meta);
    const { session, me } = await withTransaction((tx) => startSession(tx, auth, meta));

    setSessionCookie(reply, session.token, session.expiresAt);
    return { user: me };
  });

  app.post("/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await revokeSession(token);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/me", { preHandler: requireAuth }, async (req) => {
    return { user: await buildMe(db, authOf(req).user) };
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
