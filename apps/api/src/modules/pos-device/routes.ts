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
 *   GET  /currencies/history       (token) kurs o'zgarishlari tarixi ?cashierId&code — kassirda `currency_rates.view`
 *   GET  /app-update               (token) yangi versiya bormi (joriy — `x-app-version`), o'rnatuvchi manzili va SHA-256
 *   GET  /releases/:id/download    (token) e'lon qilingan desktop relizini yuklab olish (bo'laklab oqim)
 *   GET  /products/:id/image       (token) mahsulot rasmi (bazadagisi — mazmun, S3 dagisi — imzolangan havolaga 302)
 *
 * /api/pos/devices — web (sessiya, `pos.devices.manage`):
 *   GET  /                         qurilmalar ro'yxati va e'lon qilingan o'rnatuvchi (`installer`)
 *   GET  /installer/:id/download   o'rnatuvchini yuklab olish (yangi kassa o'rnatish uchun)
 *   GET  /appearance, PUT /appearance   kassa mavzusi: kompaniya qulfi va qulflangan mavzu
 *   GET  /quick-sale, PUT /quick-sale   tezkor sotuv assortimenti (tartibi bilan, 200 tagacha)
 *   GET  /quick-sale/suggestions   ?days=7|30|90 — kassada eng ko'p sotilganlar (qaytarishlar ayirilgan)
 *   PATCH /:deviceId               nomi, o'chirish/yoqish
 *   GET  /conflicts                offline sinxron nomuvofiqliklari (`resolved=true` — yopilganlari)
 *   POST /conflicts/:conflictId/resolve   ko'rib chiqildi
 */
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  CUSTOM_POS_THEME,
  MAX_QUICK_SALE_ITEMS,
  POS_DENSITIES,
  POS_FONT_SCALES,
  POS_SHADOWS,
  POS_LAYOUTS, POS_PANEL_SIDES, POS_THEMES,
  badRequest,
  notFound,
  type PosThemeChoice,
  type QuickSalePeriod,
} from "@bum/shared";
import { getPosAppearance, savePosAppearance } from "./appearance.service.js";
import { quickSaleAssortment, quickSaleSuggestions, savePosQuickSale } from "./quick-sale.service.js";
import { VIEW_TTL, loadProductImage } from "../files/files.service.js";
import { sendStoredImage } from "../files/routes.js";
import { storageProvider } from "../../shared/storage.js";
import { db } from "../../db/client.js";
import { stockMovementType } from "../../db/schema/inventory.js";
import { posDevices } from "../../db/schema/pos.js";
import { withTransaction } from "../../db/transaction.js";
import { requestMeta, writeAuditLog } from "../../shared/audit.js";
import { authenticate } from "../auth/auth.service.js";
import { authOf, requireAuth } from "../auth/guard.js";
import { assertModuleEnabled } from "../company/modules.service.js";
import { assertCompanyWritable, effectivePermissions, requirePermission, requireTenant, requireTenantForWrite } from "../company/tenant.js";
import { companyCurrency } from "../finance/accounts.service.js";
import { listRateHistory } from "../finance/currencies.service.js";
import { listConflicts, resolveConflict } from "./conflicts.service.js";
import { currentRelease, downloadableRelease, parseByteRange, releaseByteRange, releaseChunks } from "../platform/desktop-releases.service.js";
import { desktopUpdate } from "./app-update.service.js";
import { deviceAnalytics } from "./device-analytics.service.js";
import {
  assertCashierBound,
  assertDeviceSubscription,
  bindCashier,
  cashierTenant,
  deviceOf,
  deviceSubscriptionView,
  newDeviceToken,
  requireDevice,
  revokeDeviceCashiers,
} from "./device-auth.js";
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
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Rang #RRGGBB ko'rinishida");
const customThemeBody = z.strictObject({
  name: z.string().trim().min(1).max(40),
  base: z.enum(["light", "dark"]),
  primary: hexColor,
  secondary: hexColor,
  background: hexColor,
  surface: hexColor,
  card: hexColor,
  button: hexColor,
  sidebar: hexColor,
  accent: hexColor,
  radius: z.number().int().min(0).max(24),
  shadow: z.enum(POS_SHADOWS),
  density: z.enum(POS_DENSITIES),
  fontScale: z.enum(POS_FONT_SCALES),
});
const appearanceBody = z.strictObject({
  locked: z.boolean(),
  theme: z.enum([...POS_THEMES, CUSTOM_POS_THEME] as unknown as readonly [PosThemeChoice, ...PosThemeChoice[]]),
  custom: customThemeBody.nullable().optional(),
  /** Biznes egasi: to'lov paneli tomoni va kassa ekrani tuzilishi (berilmasa — saqlangani). */
  paymentPanelSide: z.enum(POS_PANEL_SIDES).optional(),
  layout: z.enum(POS_LAYOUTS).optional(),
});
const quickSaleBody = z.strictObject({ productIds: z.array(z.uuid()).max(MAX_QUICK_SALE_ITEMS) });
const suggestionsQuery = z.object({
  days: z
    .enum(["7", "30", "90"])
    .default("30")
    .transform((value) => Number(value) as QuickSalePeriod),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});
const currencyHistoryQuery = z.object({
  cashierId: z.uuid(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

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
      // Sozlash marshruti sessiyasiz (modul guard kompaniyani bilmaydi) — POS moduli shu yerda tekshiriladi
      await assertModuleEnabled(tx, tenant.company.id, "pos");
      // Ro'yxatdan o'tkazgan foydalanuvchi kassir sifatida BOG'LANMAYDI: desktop ro'yxatdan keyin kassirni alohida
      // (telefon + parol) kiritadi. Aks holda qurilma tokeni egasi o'z nomidan (ega huquqlari bilan) ish qila olardi
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
    // Obuna tugagan: holat va yangilanish ochiq (kassa sababni ko'rsatadi); sinxron, kassir kirishi va boshqa amallar yopiq
    scoped.addHook("preHandler", async (req) => {
      const url = req.routeOptions.url ?? "";
      if (url.endsWith("/session") || url.endsWith("/app-update") || url.endsWith("/unregister") || url.includes("/releases/")) return;
      assertDeviceSubscription(deviceOf(req));
    });

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
          subscription: deviceSubscriptionView(context),
        },
        serverTime: new Date().toISOString(),
      };
    });

    scoped.get("/app-update", async (req) => ({ update: desktopUpdate(appVersionOf(req), process.env, await currentRelease(db)) }));

    // Kassadan "Qurilmani uzish": qurilma o'zini o'chiradi (token bekor) — keyin boshqa kompaniyaga ulanishi mumkin
    scoped.post("/unregister", async (req) => {
      const context = deviceOf(req);
      await withTransaction(async (tx) => {
        // Token xeshi almashtiriladi: admin qurilmani qayta yoqsa ham eski token ishlamaydi (qayta ro'yxatdan o'tish kerak)
        await tx
          .update(posDevices)
          .set({ isActive: false, tokenHash: newDeviceToken().tokenHash, updatedAt: new Date() })
          .where(eq(posDevices.id, context.device.id));
        await revokeDeviceCashiers(tx, context.device.id);
        await writeAuditLog(
          {
            companyId: context.company.id,
            action: "POS_DEVICE_UNREGISTERED",
            resource: "pos_devices",
            resourceId: context.device.id,
            details: { code: context.device.code, name: context.device.name, by: "device" },
            ...requestMeta(req),
          },
          tx,
        );
      });
      return { ok: true };
    });

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
      // Parol shu qurilmada tekshirildi — server kassirni endi shu qurilmada taniydi (yuqori huquqli amallar uchun)
      await bindCashier(db, context.company.id, context.device.id, auth.user.id);
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
      // Qurilma yuborgan cashierId — faqat shu qurilmada parol bilan kirgan kassir (boshqa xodim nomidan so'rab bo'lmaydi)
      await assertCashierBound(db, context, cashierId);
      await requirePermission(db, tenant, "analytics.view");
      const report = await deviceAnalytics(db, context, range);
      // Foyda, marja va tannarx — alohida ruxsat bilan (kassada ham xuddi webdagidek)
      if ((await effectivePermissions(db, tenant)).includes("analytics.view_profit")) return report;
      return { ...report, kpis: { ...report.kpis, cogs: null, grossProfit: null, margin: null }, profitHidden: true };
    });

    scoped.get("/currencies/history", async (req) => {
      const { cashierId, code, limit } = currencyHistoryQuery.parse(req.query);
      const context = deviceOf(req);
      const tenant = await cashierTenant(db, context, cashierId);
      await assertCashierBound(db, context, cashierId);
      await requirePermission(db, tenant, "currency_rates.view");
      return { history: await listRateHistory(db, context.company.id, { code, limit }) };
    });

    scoped.get("/products/:productId/image", async (req, reply) => {
      const { productId } = productParams.parse(req.params);
      const image = await loadProductImage(db, deviceOf(req).company.id, productId);
      if (image.kind === "database") return sendStoredImage(reply, image);
      const client = storageProvider.client;
      if (image.kind === "storage" && client) return reply.redirect(client.signedUrl("GET", image.key, VIEW_TTL), 302);
      throw notFound("Mahsulot rasmi yo'q");
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

  app.get("/appearance", async (req) => {
    const tenant = await requireTenant(db, authOf(req).user);
    await requirePermission(db, tenant, "pos.devices.manage");
    return { appearance: await getPosAppearance(db, tenant.company.id) };
  });

  app.put("/appearance", async (req) => {
    const body = appearanceBody.parse(req.body);
    const appearance = await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, authOf(req).user);
      await requirePermission(tx, tenant, "pos.devices.manage");
      return savePosAppearance(tx, tenant, body, requestMeta(req));
    });
    return { appearance };
  });

  app.get("/quick-sale", async (req) => {
    const tenant = await requireTenant(db, authOf(req).user);
    await requirePermission(db, tenant, "pos.devices.manage");
    return quickSaleAssortment(db, tenant.company.id);
  });

  app.put("/quick-sale", async (req) => {
    const body = quickSaleBody.parse(req.body);
    const companyId = await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, authOf(req).user);
      await requirePermission(tx, tenant, "pos.devices.manage");
      await savePosQuickSale(tx, tenant, body, requestMeta(req));
      return tenant.company.id;
    });
    return quickSaleAssortment(db, companyId);
  });

  app.get("/quick-sale/suggestions", async (req) => {
    const query = suggestionsQuery.parse(req.query);
    const tenant = await requireTenant(db, authOf(req).user);
    await requirePermission(db, tenant, "pos.devices.manage");
    return { days: query.days, suggestions: await quickSaleSuggestions(db, tenant.company.id, query) };
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
