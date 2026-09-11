/**
 * /api/auth — kirish, chiqish, joriy foydalanuvchi va PIN.
 *
 * Convex mosligi:
 *   signIn("password")        → POST /login
 *   signOut                   → POST /logout
 *   users.getCurrentUser      → GET  /me
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
  revokeSession,
  setSessionCookie,
} from "./session.js";

const loginBody = z.object({
  phone: z.string().min(1).max(32),
  password: z.string().min(1).max(256),
});
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
