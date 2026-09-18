/**
 * /api/public — `/t/:slug` tenant portali.
 *
 *   GET /companies/:slug          ommaviy kompaniya ma'lumoti (Convex: getCompanyBySlug)
 *   GET /companies/:slug/access   joriy foydalanuvchi shu kompaniyaga kira oladimi
 *                                 (Convex: verifyTenantAccess) — sessiya kerak
 *   GET /app-release              telefon ilovasining oxirgi versiyasi (sessiyasiz — ilova kirishdan oldin ham tekshiradi)
 *   GET /app-release/download     shu versiyaning APK fayli (Android yuklab oluvchisi sessiya cookie'sini yubormaydi)
 *
 * Faqat ommaviy maydonlar: moliya, a'zolar, egasi, STIR qaytarilmaydi.
 */
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { notFound } from "@bum/shared";
import { db } from "../../db/client.js";
import { companies, companyMembers } from "../../db/schema/platform.js";
import { consumeAttempt } from "../../shared/rate-limit.js";
import { authOf, requireAuth } from "../auth/guard.js";
import {
  currentRelease,
  parseByteRange,
  releaseByteRange,
  releaseChunks,
} from "../platform/desktop-releases.service.js";

const slugParams = z.object({ slug: z.string().trim().min(2).max(40) });
/** Bitta IP dan daqiqasiga ochiq kompaniya so'rovlari. */
const PUBLIC_LOOKUPS_PER_MINUTE = 60;

/** APK'ni bazadagi bo'laklardan oqim bilan berish (Range bilan — uzilgan yuklash davom etadi). */
function sendApk(
  req: FastifyRequest,
  reply: FastifyReply,
  release: { id: string; fileName: string; size: number; sha256: string; chunkSize: number },
) {
  const etag = `"${release.sha256}"`;
  reply
    .header("content-type", "application/vnd.android.package-archive")
    .header("content-disposition", `attachment; filename="${release.fileName.replace(/[^\w.-]/g, "_")}"`)
    .header("accept-ranges", "bytes")
    .header("etag", etag)
    .header("x-content-sha256", release.sha256)
    .header("cache-control", "no-store");
  const ifRange = req.headers["if-range"];
  const range = typeof ifRange === "string" && ifRange !== etag ? null : parseByteRange(req.headers.range, release.size);
  if (range === "unsatisfiable") return reply.status(416).header("content-range", `bytes */${release.size}`).send();
  if (range) {
    return reply
      .status(206)
      .header("content-range", `bytes ${range.start}-${range.end}/${release.size}`)
      .header("content-length", String(range.end - range.start + 1))
      .send(Readable.from(releaseByteRange(db, release.id, release.chunkSize, range.start, range.end)));
  }
  return reply.header("content-length", String(release.size)).send(Readable.from(releaseChunks(db, release.id)));
}

export async function publicRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Telefon ilovasi shu yerdan yangi versiya bor-yo'qligini so'raydi. Sessiyasiz: ilova kirish
   * sahifasida turganda ham tekshiradi va Android yuklab oluvchisi cookie yubormaydi.
   */
  app.get("/app-release", async () => {
    const release = await currentRelease(db, "android");
    if (!release) return { release: null };
    return {
      release: {
        version: release.version,
        notes: release.notes,
        /** Bundan eski versiyalarda yangilanish majburiy (ilova ogohlantirishni yopmaydi). */
        minVersion: release.minVersion,
        size: release.size,
        sha256: release.sha256,
        publishedAt: release.publishedAt,
        downloadUrl: "/api/public/app-release/download",
      },
    };
  });

  app.get("/app-release/download", async (req, reply) => {
    const release = await currentRelease(db, "android");
    if (!release) throw notFound("Ilovaning e'lon qilingan versiyasi yo'q");
    return sendApk(req, reply, release);
  });

  app.get("/companies/:slug", async (req) => {
    const { slug } = slugParams.parse(req.params);
    // Sessiyasiz yo'l — slug'larni ommaviy sanab chiqishga qarshi IP limiti
    await consumeAttempt(`public-company:ip:${req.ip}`, PUBLIC_LOOKUPS_PER_MINUTE, 60);
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
