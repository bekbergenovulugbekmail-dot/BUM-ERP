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
 *
 * HAR BIR BIZNES MANZILI O'Z SESSIYASI: so'rovdagi biznes bo'lagi bo'yicha AYNAN o'sha biznesning
 * cookie'si (`bum_s_<biznes>`) o'qiladi. Shu sababli bitta brauzerda bir nechta biznes bir vaqtda
 * ochiq tura oladi va bir tabdagi chiqish boshqasiga ta'sir qilmaydi. Bog'lanmagan sessiya (kassa,
 * telefon ilovasi, platforma admini) umumiy `bum_session` cookie'sida qoladi.
 *
 * Sessiya biznesga bog'langan bo'lsa, so'rovdagi biznes boshqa bo'lsa — 403 COMPANY_SESSION_MISMATCH:
 * manzildagi slug'ni almashtirib boshqa biznesga o'tib bo'lmaydi.
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
  tenantSessionCookie,
  validateSession,
  type ActiveSession,
} from "./session.js";

declare module "fastify" {
  interface FastifyRequest {
    /** `requireAuth` dan o'tgan so'rovlarda to'ldiriladi. */
    auth: ActiveSession | null;
  }
}

/** So'rov qaysi biznes manzilidan kelgani (`x-bum-company` sarlavhasi yoki `bumCompany` parametri). */
export function companyKeyOf(req: FastifyRequest): string | null {
  const query = req.query && typeof req.query === "object" ? (req.query as Record<string, unknown>) : null;
  return companyKeyFrom(req.headers[COMPANY_CONTEXT_HEADER]) ?? companyKeyFrom(query?.[COMPANY_CONTEXT_QUERY]);
}

/** Yaroqli sessiya (qulflangan bo'lsa ham) + so'rovdagi biznes konteksti. */
export async function requireSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const query = req.query && typeof req.query === "object" ? (req.query as Record<string, unknown>) : null;
  const key = companyKeyOf(req);
  // Parametr marshrut sxemalariga yetib bormaydi (qat'iy sxemalar noma'lum maydonni rad etadi)
  if (query) Reflect.deleteProperty(query, COMPANY_CONTEXT_QUERY);

  // Biznes manzilidan kelgan so'rov — o'sha biznesning cookie'si; bo'lmasa bog'lanmagan sessiya (kassa/ilova/admin)
  const tenantToken = key ? req.cookies[tenantSessionCookie(key)] : undefined;
  const token = tenantToken ?? req.cookies[SESSION_COOKIE];
  const session = token ? await validateSession(token) : null;
  if (!session) {
    // Yaroqsiz cookie brauzerda qolib ketmasin
    if (tenantToken) clearSessionCookie(reply, key);
    else if (token) clearSessionCookie(reply);
    throw unauthenticated();
  }

  if (!key) {
    // Biznes ko'rsatilmagan so'rov: bog'langan sessiya o'z biznesida qoladi
    req.auth = session;
    return;
  }

  const user = await resolveCompanyContext(db, session.user, key);
  // Sessiya biznesga bog'langan bo'lsa — faqat o'sha biznes (slug almashtirish ishlamaydi)
  if (session.companyId && session.companyId !== user.activeCompanyId) {
    throw new AppError("FORBIDDEN", "Bu sessiya boshqa biznesga tegishli — o'sha biznes manzilidan kiring", {
      reason: "company_session_mismatch",
    });
  }
  req.auth = { ...session, user };
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
