/**
 * /api/public — `/t/:slug` tenant portali.
 *
 *   GET /companies/:slug          ommaviy kompaniya ma'lumoti (Convex: getCompanyBySlug)
 *   GET /companies/:slug/access   joriy foydalanuvchi shu kompaniyaga kira oladimi
 *                                 (Convex: verifyTenantAccess) — sessiya kerak
 *
 * Faqat ommaviy maydonlar: moliya, a'zolar, egasi, STIR qaytarilmaydi.
 */
import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { notFound } from "@bum/shared";
import { db } from "../../db/client.js";
import { companies, companyMembers } from "../../db/schema/platform.js";
import { authOf, requireAuth } from "../auth/guard.js";

const slugParams = z.object({ slug: z.string().trim().min(2).max(40) });

export async function publicRoutes(app: FastifyInstance): Promise<void> {
  app.get("/companies/:slug", async (req) => {
    const { slug } = slugParams.parse(req.params);
    const [company] = await db
      .select({
        id: companies.id,
        name: companies.name,
        legalName: companies.legalName,
        logoUrl: companies.logoUrl,
        country: companies.country,
        currency: companies.currency,
        language: companies.language,
        slug: companies.slug,
        status: companies.status,
        city: companies.city,
      })
      .from(companies)
      .where(eq(companies.slug, slug))
      .limit(1);
    if (!company) throw notFound("Kompaniya topilmadi");
    return { company };
  });

  app.get("/companies/:slug/access", { preHandler: requireAuth }, async (req) => {
    const { slug } = slugParams.parse(req.params);
    const { user } = authOf(req);

    const [company] = await db
      .select({ id: companies.id, status: companies.status })
      .from(companies)
      .where(eq(companies.slug, slug))
      .limit(1);

    if (user.isPlatformAdmin) {
      return { allowed: true, companyId: company?.id ?? null, reason: "platform_admin" };
    }
    if (!company) return { allowed: false, companyId: null, reason: "company_not_found" };
    if (company.status === "suspended" || company.status === "cancelled") {
      return { allowed: false, companyId: company.id, reason: "company_inactive" };
    }

    const [membership] = await db
      .select({ isActive: companyMembers.isActive })
      .from(companyMembers)
      .where(and(eq(companyMembers.companyId, company.id), eq(companyMembers.userId, user.id)))
      .limit(1);
    if (!membership || !membership.isActive) {
      return { allowed: false, companyId: company.id, reason: "not_member" };
    }
    return { allowed: true, companyId: company.id, reason: "ok" };
  });
}
