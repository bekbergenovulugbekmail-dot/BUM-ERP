/**
 * So'rov bo'yicha biznes konteksti — bitta sessiya bilan bir nechta biznes parallel brauzer tablarida.
 *
 * Tab o'z biznesini `x-bum-company` sarlavhasida (brauzer sarlavha qo'ya olmaydigan rasm, yuklab olish va WebSocket
 * uchun — `bumCompany` so'rov parametrida) yuboradi: slug yoki id. Kontekst faqat foydalanuvchining FAOL a'zoligi
 * bor kompaniyalar orasidan tanlanadi — URL yoki sarlavhani o'zgartirib boshqa biznes ma'lumotiga kirib bo'lmaydi (403).
 * Tanlangan kompaniya shu so'rov uchun `activeCompanyId` bo'ladi (bazadagi saqlangan qiymat o'zgarmaydi), keyingi
 * tekshiruvlar (a'zolik, obuna, litsenziya, ruxsat) odatdagidek `requireTenant` da.
 */
import { and, eq, sql } from "drizzle-orm";
import { AppError } from "@bum/shared";
import { companies, companyMembers } from "../../db/schema/platform.js";
import type { DbOrTx } from "../../db/transaction.js";
import type { SessionUser } from "../auth/session.js";

export const COMPANY_CONTEXT_HEADER = "x-bum-company";
export const COMPANY_CONTEXT_QUERY = "bumCompany";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** Topilmadi va a'zo emas — bir xil javob (boshqa biznes mavjudligi oshkor qilinmaydi). */
export function companyAccessDenied(): AppError {
  return new AppError("FORBIDDEN", "Bu biznes topilmadi yoki unga kirishingiz yo'q", { reason: "company_access_denied" });
}

export function companyKeyFrom(value: unknown): string | null {
  const raw: unknown = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase();
  return key || null;
}

export async function resolveCompanyContext(conn: DbOrTx, user: SessionUser, key: string | null): Promise<SessionUser> {
  if (!key) return user;
  const isId = UUID_RE.test(key);
  if (!isId && !SLUG_RE.test(key)) throw companyAccessDenied();
  if (isId && key === user.activeCompanyId?.toLowerCase()) return user;

  const [row] = await conn
    .select({ id: companies.id, memberActive: companyMembers.isActive })
    .from(companies)
    .innerJoin(companyMembers, and(eq(companyMembers.companyId, companies.id), eq(companyMembers.userId, user.id)))
    .where(isId ? eq(companies.id, key) : sql`lower(${companies.slug}) = ${key}`)
    .limit(1);
  if (!row || !row.memberActive) throw companyAccessDenied();
  return row.id === user.activeCompanyId ? user : { ...user, activeCompanyId: row.id };
}
