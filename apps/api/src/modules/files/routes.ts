/**
 * /api/files — mahsulot rasmi, xarajat cheki, xodim surati.
 *
 *   POST /uploads   { kind, contentType, size }  → imzolangan PUT URL        — turning boshqarish ruxsati
 *   POST /attach    { kind, key, targetId }       → yozuvga biriktirish       — turning boshqarish ruxsati
 *   POST /detach    { kind, targetId }            → ajratish (fayl o'chiriladi) — turning boshqarish ruxsati
 *   GET  /url       ?kind=&targetId=              → ko'rish havolasi (5 daqiqa) — turning ko'rish ruxsati
 *
 * Fayl saqlash (S3) sozlanmagan bo'lsa mahsulot rasmi bazaga:
 *   PUT  /product-image/:productId/content   (image/jpeg|png|webp, 5 MB gacha) — products.edit
 *   GET  /product-image/:productId/content   rasm mazmuni — products.view
 *
 * Ruxsatlar: product-image — products.edit / products.view; expense-receipt — finance.manage / finance.view;
 * employee-photo — hr.manage / hr.view. Saqlash kerak bo'lgan amal saqlash sozlanmagan bo'lsa — 503.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { badRequest, notFound } from "@bum/shared";
import { db } from "../../db/client.js";
import { withTransaction } from "../../db/transaction.js";
import { requestMeta } from "../../shared/audit.js";
import { logger } from "../../shared/logger.js";
import { storageProvider, type StorageClient } from "../../shared/storage.js";
import { authOf, requireAuth } from "../auth/guard.js";
import { requirePermission, requireTenant, requireTenantForWrite } from "../company/tenant.js";
import {
  FILE_KINDS,
  IMAGE_TYPES,
  attachFile,
  createUpload,
  detachFile,
  fileUrl,
  isDatabaseKey,
  loadProductImage,
  saveProductImageContent,
} from "./files.service.js";

const kind = z.enum(Object.keys(FILE_KINDS) as [keyof typeof FILE_KINDS, ...(keyof typeof FILE_KINDS)[]]);
const uploadBody = z.strictObject({
  kind,
  contentType: z.string().trim().toLowerCase().max(100),
  size: z.number().int().positive(),
});
const attachBody = z.strictObject({ kind, key: z.string().trim().min(1).max(300), targetId: z.uuid() });
const targetBody = z.strictObject({ kind, targetId: z.uuid() });
const urlQuery = z.object({ kind, targetId: z.uuid() });
const productParams = z.object({ productId: z.uuid() });

function unavailable(reply: FastifyReply) {
  return reply.status(503).send({ code: "SERVICE_UNAVAILABLE", message: "Fayl saqlash sozlanmagan (STORAGE_*)" });
}

/** Eski faylni saqlashdan o'chirish — asosiy amal muvaffaqiyatli bo'lgach, xato bo'lsa faqat jurnalga (bazadagisi tranzaksiyada o'chgan). */
function removeQuietly(client: StorageClient | null, key: string | null) {
  if (!client || !key || isDatabaseKey(key)) return;
  client.remove(key).catch((error: unknown) => logger.warn({ err: error, key }, "Eski faylni o'chirib bo'lmadi"));
}

/** Bazadagi rasm javobi; URL da `?v=` (kalit) bor — almashtirilgan rasm yangi manzil bilan keladi. */
export function sendStoredImage(reply: FastifyReply, image: { key: string; content: Buffer; contentType: string }) {
  return reply
    .header("content-type", image.contentType)
    .header("content-length", String(image.content.length))
    .header("cache-control", "private, max-age=86400")
    .header("etag", `"${image.key.slice(image.key.lastIndexOf("/") + 1)}"`)
    .header("x-content-type-options", "nosniff")
    .send(image.content);
}

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  app.addContentTypeParser([...IMAGE_TYPES], { parseAs: "buffer", bodyLimit: FILE_KINDS["product-image"].maxBytes + 1024 }, (_req, body, done) =>
    done(null, body),
  );

  app.post("/uploads", async (req, reply) => {
    const body = uploadBody.parse(req.body);
    const client = storageProvider.client;
    if (!client) return unavailable(reply);

    const tenant = await requireTenantForWrite(db, authOf(req).user);
    await requirePermission(db, tenant, FILE_KINDS[body.kind].manage);
    reply.status(201);
    return createUpload(tenant, body, client);
  });

  app.post("/attach", async (req, reply) => {
    const body = attachBody.parse(req.body);
    const client = storageProvider.client;
    if (!client) return unavailable(reply);

    const result = await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, authOf(req).user);
      await requirePermission(tx, tenant, FILE_KINDS[body.kind].manage);
      return attachFile(tx, tenant, body, client, requestMeta(req));
    });
    removeQuietly(client, result.previous);
    return { key: result.key };
  });

  app.post("/detach", async (req, reply) => {
    const body = targetBody.parse(req.body);
    const result = await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, authOf(req).user);
      await requirePermission(tx, tenant, FILE_KINDS[body.kind].manage);
      return detachFile(tx, tenant, body, requestMeta(req));
    });
    removeQuietly(storageProvider.client, result.previous);
    return reply.status(204).send();
  });

  app.get("/url", async (req, reply) => {
    const query = urlQuery.parse(req.query);
    const tenant = await requireTenant(db, authOf(req).user);
    await requirePermission(db, tenant, FILE_KINDS[query.kind].view);
    return (await fileUrl(db, tenant, query, storageProvider.client)) ?? unavailable(reply);
  });

  app.put("/product-image/:productId/content", async (req) => {
    const { productId } = productParams.parse(req.params);
    if (!Buffer.isBuffer(req.body)) throw badRequest("Rasm fayli yuborilmadi (JPG, PNG yoki WEBP)");
    const data = req.body;
    const result = await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, authOf(req).user);
      await requirePermission(tx, tenant, FILE_KINDS["product-image"].manage);
      return saveProductImageContent(tx, tenant, { productId, contentType: req.headers["content-type"] ?? "", data }, requestMeta(req));
    });
    removeQuietly(storageProvider.client, result.previous);
    return { key: result.key };
  });

  app.get("/product-image/:productId/content", async (req, reply) => {
    const { productId } = productParams.parse(req.params);
    const tenant = await requireTenant(db, authOf(req).user);
    await requirePermission(db, tenant, FILE_KINDS["product-image"].view);
    const image = await loadProductImage(db, tenant.company.id, productId);
    if (image.kind !== "database") throw notFound("Rasm topilmadi");
    return sendStoredImage(reply, image);
  });
}
