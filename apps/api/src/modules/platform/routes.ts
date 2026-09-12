/**
 * /api/platform — platforma admini. Barcha marshrutlar `requirePlatformAdmin` ortida.
 *
 *   GET   /companies                     kompaniyalar (?status=), a'zolar soni, egasi
 *   POST  /companies                     kompaniya + egasi (platformCreateCompany)
 *   GET   /companies/:companyId          tafsilot: egasi, a'zolar, filiallar
 *   POST  /companies/:companyId/status   holat (to'xtatish sababi bilan)
 *   GET   /stats                         statistika
 *   GET   /audit-logs                    audit jurnali (?companyId=&resource=&limit=&cursor=)
 *   GET   /users                         foydalanuvchilar (?search=&limit=&offset=)
 *   PATCH /users/:userId                 telefon raqamini o'zgartirish
 *   POST  /users/:userId/password        parolni tiklash — sessiyalar bekor
 *   POST  /users/:userId/status          faollashtirish / bloklash
 *   POST  /users/:userId/platform-admin  platforma adminini tayinlash (faqat bootstrap admin)
 *   GET   /settings, PUT /settings       platforma sozlamalari (ro'yxatdan o'tish ham)
 *   GET   /desktop-releases              desktop kassa relizlari
 *   POST  /desktop-releases?version=&fileName=   o'rnatuvchini yuklash (application/octet-stream, oqim bilan)
 *   PATCH /desktop-releases/:releaseId   izoh, majburiy versiya
 *   POST  /desktop-releases/:releaseId/publish | /archive   e'lon qilish (oldingisi arxivga) | arxivlash
 *
 * Bootstrap admin va boshqa platforma adminlariga foydalanuvchi amallari ta'sir
 * qilmaydi (users/user-admin.service.ts). Bootstrap admin `db:seed` orqali yaratiladi.
 */
import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { badRequest } from "@bum/shared";
import { db } from "../../db/client.js";
import { withTransaction } from "../../db/transaction.js";
import { requestMeta } from "../../shared/audit.js";
import { listAuditLogs } from "../audit/audit-log.service.js";
import { authOf, requirePlatformAdmin } from "../auth/guard.js";
import {
  platformChangePhone,
  platformResetPassword,
  platformSetActive,
  setPlatformAdmin,
} from "../users/user-admin.service.js";
import {
  COMPANY_STATUSES,
  createCompanyWithOwner,
  getCompanyDetails,
  listCompanies,
  setCompanyStatus,
} from "./company.service.js";
import {
  MAX_RELEASE_BYTES,
  RELEASE_VERSION,
  archiveRelease,
  listReleases,
  publishRelease,
  updateRelease,
  uploadRelease,
} from "./desktop-releases.service.js";
import {
  getPlatformSettings,
  listUsers,
  platformStats,
  savePlatformSettings,
} from "./platform.service.js";

const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();

const createCompanyBody = z.object({
  name: z.string().trim().min(1).max(200),
  legalName: optionalText(300),
  taxId: optionalText(32),
  phone: optionalText(20),
  address: optionalText(500),
  city: optionalText(100),
  region: optionalText(100),
  country: z.string().length(2).optional(),
  currency: z.string().length(3).optional(),
  language: z.string().length(2).optional(),
  branchName: optionalText(200),
  owner: z.object({
    phone: z.string().min(1).max(32),
    password: z.string().min(1).max(256),
    name: z.string().max(200).optional(),
  }),
});
const companyListQuery = z.object({ status: z.enum(COMPANY_STATUSES).optional() });
const companyParams = z.object({ companyId: z.uuid() });
const companyStatusBody = z.strictObject({
  status: z.enum(COMPANY_STATUSES),
  reason: z.string().trim().min(1).max(500).optional(),
});

const auditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  companyId: z.uuid().optional(),
  resource: z.string().trim().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
});
const usersQuery = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const userParams = z.object({ userId: z.uuid() });
const updateUserBody = z.object({ phone: z.string().min(1).max(32) });
const resetPasswordBody = z.object({ newPassword: z.string().min(1).max(256) });
const userStatusBody = z.object({ isActive: z.boolean() });
const platformAdminBody = z.strictObject({ isPlatformAdmin: z.boolean() });

const releaseParams = z.object({ releaseId: z.uuid() });
const releaseUploadQuery = z.object({
  version: z.string().trim().regex(RELEASE_VERSION, "Versiya formati: 1.2.3"),
  fileName: z
    .string()
    .trim()
    .min(5)
    .max(200)
    .regex(/^[\w .()-]+\.exe$/i, "Fayl nomi .exe bilan tugasin")
    .default("BUM-POS-KASSA-Setup.exe"),
});
const releasePatchBody = z.strictObject({
  notes: z.string().trim().max(2000).nullable().optional(),
  minVersion: z.string().trim().regex(RELEASE_VERSION, "Majburiy versiya formati: 1.2.3").nullable().optional(),
});

const settingsBody = z.strictObject({
  registrationEnabled: z.boolean().optional(),
  defaultTrialDays: z.number().int().min(0).max(365).optional(),
  platformName: z.string().trim().min(1).max(100).optional(),
  supportEmail: z.union([z.email().max(255), z.literal("")]).optional(),
});

export async function platformRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requirePlatformAdmin);

  // ─── Kompaniyalar ────────────────────────────────────────────────────────

  app.get("/companies", async (req) => {
    const filter = companyListQuery.parse(req.query);
    return { companies: await listCompanies(db, filter) };
  });

  app.post("/companies", async (req, reply) => {
    const body = createCompanyBody.parse(req.body);
    const { user } = authOf(req);
    const created = await withTransaction((tx) =>
      createCompanyWithOwner(tx, user, body, requestMeta(req)),
    );
    reply.status(201);
    return created;
  });

  app.get("/companies/:companyId", async (req) => {
    const { companyId } = companyParams.parse(req.params);
    return getCompanyDetails(db, companyId);
  });

  app.post("/companies/:companyId/status", async (req) => {
    const { companyId } = companyParams.parse(req.params);
    const { status, reason } = companyStatusBody.parse(req.body);
    const { user } = authOf(req);
    const company = await withTransaction((tx) =>
      setCompanyStatus(tx, user, companyId, status, reason, requestMeta(req)),
    );
    return { company };
  });

  // ─── Kuzatuv ─────────────────────────────────────────────────────────────

  app.get("/stats", async () => platformStats(db));

  app.get("/audit-logs", async (req) => listAuditLogs(db, auditQuery.parse(req.query)));

  // ─── Foydalanuvchilar ────────────────────────────────────────────────────

  app.get("/users", async (req) => listUsers(db, usersQuery.parse(req.query)));

  app.patch("/users/:userId", async (req) => {
    const { userId } = userParams.parse(req.params);
    const { phone } = updateUserBody.parse(req.body);
    const { user } = authOf(req);
    const updated = await withTransaction((tx) =>
      platformChangePhone(tx, user, userId, phone, requestMeta(req)),
    );
    return { user: { id: updated.id, phone: updated.phone, name: updated.name } };
  });

  app.post("/users/:userId/password", async (req) => {
    const { userId } = userParams.parse(req.params);
    const { newPassword } = resetPasswordBody.parse(req.body);
    const { user } = authOf(req);
    await withTransaction((tx) => platformResetPassword(tx, user, userId, newPassword, requestMeta(req)));
    return { ok: true };
  });

  app.post("/users/:userId/status", async (req) => {
    const { userId } = userParams.parse(req.params);
    const { isActive } = userStatusBody.parse(req.body);
    const { user } = authOf(req);
    await withTransaction((tx) => platformSetActive(tx, user, userId, isActive, requestMeta(req)));
    return { ok: true };
  });

  app.post("/users/:userId/platform-admin", async (req) => {
    const { userId } = userParams.parse(req.params);
    const { isPlatformAdmin } = platformAdminBody.parse(req.body);
    const { user } = authOf(req);
    await withTransaction((tx) => setPlatformAdmin(tx, user, userId, isPlatformAdmin, requestMeta(req)));
    return { ok: true };
  });

  // ─── Desktop kassa relizlari ─────────────────────────────────────────────

  // O'rnatuvchi xom baytlar bilan keladi — oqim o'zgarmay servisga uzatiladi (hajm chegarasi servisda)
  app.addContentTypeParser("application/octet-stream", (_req, payload, done) => done(null, payload));

  app.get("/desktop-releases", async () => ({ releases: await listReleases(db) }));

  app.post("/desktop-releases", { bodyLimit: MAX_RELEASE_BYTES }, async (req, reply) => {
    const { version, fileName } = releaseUploadQuery.parse(req.query);
    if (!(req.body instanceof Readable)) throw badRequest("Fayl application/octet-stream sifatida yuborilsin");
    const stream = req.body;
    const { user } = authOf(req);
    const release = await withTransaction((tx) => uploadRelease(tx, { version, fileName, stream }, user, requestMeta(req)));
    reply.status(201);
    return { release };
  });

  app.patch("/desktop-releases/:releaseId", async (req) => {
    const { releaseId } = releaseParams.parse(req.params);
    const patch = releasePatchBody.parse(req.body);
    const { user } = authOf(req);
    return { release: await withTransaction((tx) => updateRelease(tx, releaseId, patch, user, requestMeta(req))) };
  });

  app.post("/desktop-releases/:releaseId/publish", async (req) => {
    const { releaseId } = releaseParams.parse(req.params);
    const { user } = authOf(req);
    return { release: await withTransaction((tx) => publishRelease(tx, releaseId, user, requestMeta(req))) };
  });

  app.post("/desktop-releases/:releaseId/archive", async (req) => {
    const { releaseId } = releaseParams.parse(req.params);
    const { user } = authOf(req);
    return { release: await withTransaction((tx) => archiveRelease(tx, releaseId, user, requestMeta(req))) };
  });

  // ─── Sozlamalar ──────────────────────────────────────────────────────────

  app.get("/settings", async () => ({ settings: await getPlatformSettings(db) }));

  app.put("/settings", async (req) => {
    const patch = settingsBody.parse(req.body);
    const { user } = authOf(req);
    const saved = await withTransaction((tx) => savePlatformSettings(tx, user, patch, requestMeta(req)));
    return { settings: saved };
  });
}
