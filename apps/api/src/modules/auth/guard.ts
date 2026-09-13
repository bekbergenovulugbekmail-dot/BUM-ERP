/**
 * Himoyalangan marshrutlar uchun preHandler.
 *
 *   app.get("/me", { preHandler: requireAuth }, async (req) => {
 *     const { user } = authOf(req);
 *   });
 *
 * Qulflangan ekran (LOCK): sessiya saqlanadi, lekin `requireAuth` 423 LOCKED qaytaradi — faqat `requireSession`
 * ishlatadigan /api/auth/me, /lock, /unlock ochiq. Chiqish (LOGOUT) sessiyani bekor qiladi — PIN endi ishlamaydi.
 *
 * Biznes konteksti (tab): `x-bum-company` / `bumCompany` — foydalanuvchining faol a'zoligi bo'lgan kompaniya shu so'rov
 * uchun aktiv bo'ladi (company/company-context.ts); boshqa biznes — 403.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError, forbidden, unauthenticated } from "@bum/shared";
import { db } from "../../db/client.js";
import {
  COMPANY_CONTEXT_HEADER,
  COMPANY_CONTEXT_QUERY,
  companyKeyFrom,
  resolveCompanyContext,
} from "../company/company-context.js";
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

/** Yaroqli sessiya (qulflangan bo'lsa ham) + so'rovdagi biznes konteksti. */
export async function requireSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.cookies[SESSION_COOKIE];
  const session = token ? await validateSession(token) : null;
  if (!session) {
    // Yaroqsiz cookie brauzerda qolib ketmasin
    if (token) clearSessionCookie(reply);
    throw unauthenticated();
  }
  const query = req.query && typeof req.query === "object" ? (req.query as Record<string, unknown>) : null;
  const key = companyKeyFrom(req.headers[COMPANY_CONTEXT_HEADER]) ?? companyKeyFrom(query?.[COMPANY_CONTEXT_QUERY]);
  // Parametr marshrut sxemalariga yetib bormaydi (qat'iy sxemalar noma'lum maydonni rad etadi)
  if (query) Reflect.deleteProperty(query, COMPANY_CONTEXT_QUERY);
  req.auth = key ? { ...session, user: await resolveCompanyContext(db, session.user, key) } : session;
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireSession(req, reply);
  if (req.auth?.lockedAt) throw new AppError("LOCKED", "Ekran bloklangan. Davom etish uchun PIN kiriting.");
}

export async function requirePlatformAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(req, reply);
  if (!req.auth?.user.isPlatformAdmin) throw forbidden("Faqat platforma admini uchun");
}

/** `requireAuth` dan keyin — sessiyani tip jihatdan aniq qaytaradi. */
export function authOf(req: FastifyRequest): ActiveSession {
  if (!req.auth) throw unauthenticated();
  return req.auth;
}
