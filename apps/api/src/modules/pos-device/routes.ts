/**
 * Desktop kassa (BUM POS KASSA) API'si.
 *
 * /api/pos-device — qurilma:
 *   POST /setup/options            telefon + parol → kompaniyalar va omborlar (`pos.devices.manage`)
 *   POST /setup/register           qurilmani ro'yxatdan o'tkazish → token (bir marta), qurilma, kompaniya
 *   GET  /session                  (token) qurilma, kompaniya, server vaqti
 *   POST /cashiers/login           (token) kassirning birinchi kirishi: telefon + parol → profil va ruxsatlar
 *   POST /pull                     (token) o'zgarishlar: kursorlar bo'yicha sahifalab; sozlamalar xeshi o'zgarsa `config`
 *   POST /push                     (token) offline amallar navbati: bir martalik (opId) — smena, chek, qaytarish, mijoz
 *   GET  /receipts/:number         (token) qaytarish uchun chek (qurilma omboridagi, qaytarilgan miqdorlar bilan)
 *   GET  /sales                    (token) sotuv tarixi: qurilma omboridagi barcha kassa cheklari (sana, kursor)
 *   GET  /purchases/:number        (token) ta'minotchiga qaytarish uchun xarid (qabul va qaytarilgan miqdorlar)
 *   GET  /movements                (token) mahsulot harakati — qurilma ombori (?productId, type, kursor)
 *   GET  /stock/:productId         (token) mahsulot qoldig'i kompaniyaning faol omborlarida
 *   GET  /analytics                (token) analitika ?from&to&cashierId — kassirda `analytics.view`
 *   GET  /app-update               (token) yangi versiya bormi (joriy — `x-app-version`), o'rnatuvchi manzili va SHA-256
 *   GET  /releases/:id/download    (token) e'lon qilingan desktop relizini yuklab olish (bo'laklab oqim)
 *
 * /api/pos/devices — web (sessiya, `pos.devices.manage`):
 *   GET  /                         qurilmalar ro'yxati va e'lon qilingan o'rnatuvchi (`installer`)
 *   GET  /installer/:id/download   o'rnatuvchini yuklab olish (yangi kassa o'rnatish uchun)
 *   PATCH /:deviceId               nomi, o'chirish/yoqish
 *   GET  /conflicts                offline sinxron nomuvofiqliklari (`resolved=true` — yopilganlari)
 *   POST /conflicts/:conflictId/resolve   ko'rib chiqildi
 */
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { badRequest } from "@bum/shared";
import { db } from "../../db/client.js";
import { stockMovementType } from "../../db/schema/inventory.js";
import { posDevices } from "../../db/schema/pos.js";
import { withTransaction } from "../../db/transaction.js";
import { requestMeta, writeAuditLog } from "../../shared/audit.js";
import { authenticate } from "../auth/auth.service.js";
import { authOf, requireAuth } from "../auth/guard.js";
import { assertCompanyWritable, effectivePermissions, requirePermission, requireTenant, requireTenantForWrite } from "../company/tenant.js";
import { companyCurrency } from "../finance/accounts.service.js";
import { listConflicts, resolveConflict } from "./conflicts.service.js";
import { currentRelease, downloadableRelease, parseByteRange, releaseByteRange, releaseChunks } from "../platform/desktop-releases.service.js";
import { desktopUpdate } from "./app-update.service.js";
import { deviceAnalytics } from "./device-analytics.service.js";
import { cashierTenant, deviceOf, requireDevice } from "./device-auth.js";
import { deviceWarehouses, listDevices, registerDevice, setupTenant, updateDevice } from "./devices.service.js";
import { deviceProductStock, findDevicePurchase, findDeviceReceipt, listDeviceMovements, listDeviceSales } from "./receipts.service.js";
import { DEFAULT_PULL_LIMIT, PULL_ENTITIES, pullChanges } from "./sync-pull.service.js";
import { MAX_OPS_PER_PUSH, pushOperations } from "./sync-push.service.js";

const credentials = {
  phone: z.string().trim().min(1).max(32),
  password: z.string().min(1).max(256),
};
const optionsBody = z.strictObject({ ...credentials, companyId: z.uuid().optional() });
const registerBody = z.strictObject({
  ...credentials,
  companyId: z.uuid().optional(),
  warehouseId: z.uuid(),
  name: z.string().trim().min(1).max(100),
  appVersion: z.string().trim().max(32).optional(),
  platform: z.string().trim().max(32).optional(),
});
const cashierLoginBody = z.strictObject(credentials);
const cursorSchema = z.strictObject({
  t: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/, "kursor vaqti noto'g'ri"),
  id: z.uuid(),
});
const pullBody = z.strictObject({
  cursors: z.partialRecord(z.enum(PULL_ENTITIES), cursorSchema).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  /** Qurilmadagi sozlamalar xeshi — bir xil bo'lsa `config: null`. */
  configHash: z.string().max(64).optional(),
});
const pushBody = z.strictObject({ ops: z.array(z.unknown()).min(1).max(MAX_OPS_PER_PUSH) });
const receiptParams = z.object({ number: z.string().trim().min(1).max(32) });
const salesQuery = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(500).optional(),
});
const movementsQuery = z.object({
  productId: z.uuid().optional(),
  type: z.enum(stockMovementType.enumValues).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().max(500).optional(),
});
const productParams = z.object({ productId: z.uuid() });
const releaseParams = z.object({ releaseId: z.uuid() });

/**
 * O'rnatuvchini bazadagi bo'laklardan oqim bilan yuborish (xotirada bitta bo'lak). HTTP Range: uzilgan yuklab olish
 * to'xtagan joyidan davom etadi; `If-Range` ETag (SHA-256) mos kelmasa — butun fayl (boshqa reliz qismi qo'shilib ketmasin).
 */
function sendRelease(req: FastifyRequest, reply: FastifyReply, release: { id: string; fileName: string; size: number; sha256: string; chunkSize: number }) {
  const etag = `"${release.sha256}"`;
  reply
    .header("content-type", "application/octet-stream")
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
const analyticsQuery = z
  .object({ from: z.iso.date(), to: z.iso.date(), cashierId: z.uuid() })
  .refine((range) => range.from <= range.to && (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000 <= 366, {
    message: "Davr noto'g'ri (366 kungacha)",
    path: ["to"],
  });
const deviceParams = z.object({ deviceId: z.uuid() });
const conflictParams = z.object({ conflictId: z.uuid() });
const conflictsQuery = z.object({
  resolved: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
const devicePatchBody = z.strictObject({ name: z.string().trim().min(1).max(100).optional(), isActive: z.boolean().optional() });

const appVersionOf = (req: FastifyRequest) => {
  const header = req.headers["x-app-version"];
  return typeof header === "string" && header.length <= 32 ? header : undefined;
};

export async function posDeviceRoutes(app: FastifyInstance): Promise<void> {
  app.decorateRequest("posDevice", null);

  app.post("/setup/options", async (req) => {
    const body = optionsBody.parse(req.body);
    const auth = await authenticate(body.phone, body.password, requestMeta(req));
    const { companies, tenant } = await setupTenant(db, auth.user, body.companyId);
    return {
      companies,
      company: tenant ? { id: tenant.company.id, name: tenant.company.name } : null,
      warehouses: tenant ? await deviceWarehouses(db, tenant) : [],
    };
  });

  app.post("/setup/register", async (req, reply) => {
    const body = registerBody.parse(req.body);
    const meta = requestMeta(req);
    const auth = await authenticate(body.phone, body.password, meta);
    const registered = await withTransaction(async (tx) => {
      const { tenant } = await setupTenant(tx, auth.user, body.companyId);
      if (!tenant) throw badRequest("Kompaniyani tanlang", { reason: "company_required" });
      const { device, token } = await registerDevice(tx, tenant, body, meta);
      return {
        token,
        device,
        company: { id: tenant.company.id, name: tenant.company.name, currency: await companyCurrency(tx, tenant.company.id) },
      };
    });
    reply.status(201);
    return registered;
  });

  await app.register(async (scoped) => {
    scoped.addHook("preHandler", requireDevice);

    scoped.get("/session", async (req) => {
      const context = deviceOf(req);
      await db.update(posDevices).set({ lastSeenAt: new Date(), appVersion: appVersionOf(req) }).where(eq(posDevices.id, context.device.id));
      return {
        device: context.device,
        company: {
          id: context.company.id,
          name: context.company.name,
          currency: context.company.currency,
          status: context.company.status,
          trialEndsAt: context.company.trialEndsAt?.toISOString() ?? null,
        },
        serverTime: new Date().toISOString(),
      };
    });

    scoped.get("/app-update", async (req) => ({ update: desktopUpdate(appVersionOf(req), process.env, await currentRelease(db)) }));

    scoped.get("/releases/:releaseId/download", async (req, reply) => {
      const { releaseId } = releaseParams.parse(req.params);
      return sendRelease(req, reply, await downloadableRelease(db, releaseId));
    });

    scoped.post("/cashiers/login", async (req) => {
      const body = cashierLoginBody.parse(req.body);
      const meta = requestMeta(req);
      const context = deviceOf(req);
      const auth = await authenticate(body.phone, body.password, meta);
      const tenant = await cashierTenant(db, context, auth.user.id);
      await writeAuditLog({
        userId: auth.user.id,
        userName: auth.user.name,
        companyId: context.company.id,
        action: "POS_CASHIER_LOGIN",
        resource: "pos_devices",
        resourceId: context.device.id,
        details: { deviceCode: context.device.code },
        ...meta,
      });
      return {
        cashier: {
          id: auth.user.id,
          name: auth.user.name,
          phone: auth.user.phone,
          role: tenant.membership.companyRole,
          permissions: await effectivePermissions(db, tenant),
        },
      };
    });

    scoped.post("/pull", async (req) => {
      const body = pullBody.parse(req.body ?? {});
      const context = deviceOf(req);
      const changes = await pullChanges(db, context, body.cursors ?? {}, body.limit ?? DEFAULT_PULL_LIMIT, body.configHash);
      const now = new Date();
      await db
        .update(posDevices)
        .set({ lastSeenAt: now, lastPullAt: now, appVersion: appVersionOf(req) })
        .where(eq(posDevices.id, context.device.id));
      return changes;
    });

    scoped.post("/push", { bodyLimit: 5 * 1024 * 1024 }, async (req) => {
      const body = pushBody.parse(req.body);
      const context = deviceOf(req);
      // To'xtatilgan kompaniya — butun navbat keyinroq (amallar rad etilgan deb saqlanmaydi)
      assertCompanyWritable(context.company);
      const results = await pushOperations(context, body.ops, requestMeta(req));
      const now = new Date();
      await db
        .update(posDevices)
        .set({ lastSeenAt: now, lastPushAt: now, appVersion: appVersionOf(req) })
        .where(eq(posDevices.id, context.device.id));
      return { results };
    });

    scoped.get("/receipts/:number", async (req) => {
      const { number } = receiptParams.parse(req.params);
      return { receipt: await findDeviceReceipt(db, deviceOf(req), number) };
    });

    scoped.get("/sales", async (req) => {
      const query = salesQuery.parse(req.query);
      return listDeviceSales(db, deviceOf(req), query);
    });

    scoped.get("/purchases/:number", async (req) => {
      const { number } = receiptParams.parse(req.params);
      return { purchase: await findDevicePurchase(db, deviceOf(req), number) };
    });

    scoped.get("/movements", async (req) => {
      const query = movementsQuery.parse(req.query);
      return listDeviceMovements(db, deviceOf(req), query);
    });

    scoped.get("/stock/:productId", async (req) => {
      const { productId } = productParams.parse(req.params);
      return { stock: await deviceProductStock(db, deviceOf(req), productId) };
    });

    scoped.get("/analytics", async (req) => {
      const { cashierId, ...range } = analyticsQuery.parse(req.query);
      const context = deviceOf(req);
      // Kassir qurilmada PIN bilan kirgan; server a'zolik va ruxsatni qayta tekshiradi
      const tenant = await cashierTenant(db, context, cashierId);
      await requirePermission(db, tenant, "analytics.view");
      return deviceAnalytics(db, context, range);
    });
  });
}

export async function posDevicesAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/", async (req) => {
    const tenant = await requireTenant(db, authOf(req).user);
    await requirePermission(db, tenant, "pos.devices.manage");
    const release = await currentRelease(db);
    return {
      devices: await listDevices(db, tenant),
      // Yangi kassa o'rnatish uchun — platforma admini e'lon qilgan o'rnatuvchi
      installer: release
        ? { id: release.id, version: release.version, fileName: release.fileName, size: release.size, sha256: release.sha256, notes: release.notes, publishedAt: release.publishedAt }
        : null,
    };
  });

  app.get("/installer/:releaseId/download", async (req, reply) => {
    const { releaseId } = releaseParams.parse(req.params);
    const tenant = await requireTenant(db, authOf(req).user);
    await requirePermission(db, tenant, "pos.devices.manage");
    return sendRelease(req, reply, await downloadableRelease(db, releaseId));
  });

  app.get("/conflicts", async (req) => {
    const query = conflictsQuery.parse(req.query);
    const tenant = await requireTenant(db, authOf(req).user);
    await requirePermission(db, tenant, "pos.devices.manage");
    return { conflicts: await listConflicts(db, tenant, query) };
  });

  app.post("/conflicts/:conflictId/resolve", async (req) => {
    const { conflictId } = conflictParams.parse(req.params);
    const conflict = await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, authOf(req).user);
      await requirePermission(tx, tenant, "pos.devices.manage");
      return resolveConflict(tx, tenant, conflictId, requestMeta(req));
    });
    return { conflict };
  });

  app.patch("/:deviceId", async (req) => {
    const { deviceId } = deviceParams.parse(req.params);
    const body = devicePatchBody.parse(req.body);
    const device = await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, authOf(req).user);
      await requirePermission(tx, tenant, "pos.devices.manage");
      return updateDevice(tx, tenant, deviceId, body, requestMeta(req));
    });
    return { device };
  });
}
