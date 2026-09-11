/**
 * Himoyalangan marshrutlar uchun preHandler.
 *
 *   app.get("/me", { preHandler: requireAuth }, async (req) => {
 *     const { user } = authOf(req);
 *   });
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { unauthenticated } from "@bum/shared";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  validateSession,
  type ActiveSession,
} from "./session.js";

declare module "fastify" {
  interface FastifyRequest {
    /** `requireAuth` dan o'tgan so'rovlarda to'ldiriladi. */
    auth: ActiveSession | null;
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.cookies[SESSION_COOKIE];
  const session = token ? await validateSession(token) : null;
  if (!session) {
    // Yaroqsiz cookie brauzerda qolib ketmasin
    if (token) clearSessionCookie(reply);
    throw unauthenticated();
  }
  req.auth = session;
}

/** `requireAuth` dan keyin — sessiyani tip jihatdan aniq qaytaradi. */
export function authOf(req: FastifyRequest): ActiveSession {
  if (!req.auth) throw unauthenticated();
  return req.auth;
}
