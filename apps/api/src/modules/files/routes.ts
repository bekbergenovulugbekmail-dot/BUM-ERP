/**
 * /api/files — mahsulot rasmi, xarajat cheki, xodim surati.
 *
 *   POST /uploads   { kind, contentType, size }  → imzolangan PUT URL        — turning boshqarish ruxsati
 *   POST /attach    { kind, key, targetId }       → yozuvga biriktirish       — turning boshqarish ruxsati
 *   POST /detach    { kind, targetId }            → ajratish (fayl o'chiriladi) — turning boshqarish ruxsati
 *   GET  /url       ?kind=&targetId=              → imzolangan GET URL (5 daqiqa) — turning ko'rish ruxsati
 *
 * Ruxsatlar: product-image — products.edit / products.view; expense-receipt — finance.manage / finance.view;
 * employee-photo — hr.manage / hr.view. Saqlash sozlanmagan bo'lsa — 503.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { db } from "../../db/client.js";
import { withTransaction } from "../../db/transaction.js";
import { requestMeta } from "../../shared/audit.js";
import { logger } from "../../shared/logger.js";
import { storageProvider, type StorageClient } from "../../shared/storage.js";
import { authOf, requireAuth } from "../auth/guard.js";
import { requirePermission, requireTenant, requireTenantForWrite } from "../company/tenant.js";
import { FILE_KINDS, attachFile, createUpload, detachFile, fileUrl } from "./files.service.js";

const kind = z.enum(Object.keys(FILE_KINDS) as [keyof typeof FILE_KINDS, ...(keyof typeof FILE_KINDS)[]]);
const uploadBody = z.strictObject({
  kind,
  contentType: z.string().trim().toLowerCase().max(100),
  size: z.number().int().positive(),
});
const attachBody = z.strictObject({ kind, key: z.string().trim().min(1).max(300), targetId: z.uuid() });
const targetBody = z.strictObject({ kind, targetId: z.uuid() });
const urlQuery = z.object({ kind, targetId: z.uuid() });

function unavailable(reply: FastifyReply) {
  return reply.status(503).send({ code: "SERVICE_UNAVAILABLE", message: "Fayl saqlash sozlanmagan (STORAGE_*)" });
}

/** Eski faylni o'chirish — asosiy amal muvaffaqiyatli bo'lgach, xato bo'lsa faqat jurnalga. */
function removeQuietly(client: StorageClient, key: string | null) {
  if (!key) return;
  client.remove(key).catch((error: unknown) => logger.warn({ err: error, key }, "Eski faylni o'chirib bo'lmadi"));
}

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

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
    const client = storageProvider.client;
    if (!client) return unavailable(reply);

    const result = await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, authOf(req).user);
      await requirePermission(tx, tenant, FILE_KINDS[body.kind].manage);
      return detachFile(tx, tenant, body, requestMeta(req));
    });
    removeQuietly(client, result.previous);
    return reply.status(204).send();
  });

  app.get("/url", async (req, reply) => {
    const query = urlQuery.parse(req.query);
    const client = storageProvider.client;
    if (!client) return unavailable(reply);

    const tenant = await requireTenant(db, authOf(req).user);
    await requirePermission(db, tenant, FILE_KINDS[query.kind].view);
    return fileUrl(db, tenant, query, client);
  });
}
