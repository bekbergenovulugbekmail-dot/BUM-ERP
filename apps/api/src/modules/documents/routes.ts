/**
 * Hujjat shablonlari API.
 *
 *   GET    /templates                      ro'yxat                         settings.view
 *   GET    /templates/:id                  shablon + amaldagi sxema        settings.view
 *   GET    /templates/:id/versions         versiyalar tarixi               settings.view
 *   GET    /fields                         maydonlar katalogi              settings.view
 *   GET    /active/:documentType           chizish uchun amaldagi sxema    (sessiya)
 *   POST   /templates                      yaratish (zavod nusxasidan)     settings.manage
 *   POST   /templates/:id/versions         saqlash = yangi versiya         settings.manage
 *   POST   /templates/:id/restore          eski versiyaga qaytish          settings.manage
 *   POST   /templates/:id/default          standart qilish                 settings.manage
 *   PATCH  /templates/:id                  nomini o'zgartirish             settings.manage
 *   DELETE /templates/:id                  ARXIVLASH (o'chirish emas)      settings.manage
 *
 * Sxema hech qachon "shundayligicha" saqlanmaydi — `sanitizeTemplateSchema` uni oq ro'yxat
 * bo'yicha qayta quradi (HTML/JS/SQL va maxfiy ustunlar kirmaydi).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { DOCUMENT_TYPES, type Permission } from "@bum/shared";
import { db } from "../../db/client.js";
import { withTransaction, type DbOrTx } from "../../db/transaction.js";
import { requestMeta } from "../../shared/audit.js";
import { authOf, requireAuth } from "../auth/guard.js";
import { requirePermission, requireTenant, requireTenantForWrite, type TenantContext } from "../company/tenant.js";
import { columnsFor, fieldsFor, PAYMENT_ROWS, TOTAL_ROWS } from "./field-catalog.js";
import {
  archiveTemplate,
  catalogAccess,
  createTemplate,
  activeSchemaFor,
  getTemplate,
  listTemplates,
  listVersions,
  renameTemplate,
  restoreVersion,
  saveVersion,
  setDefaultTemplate,
} from "./templates.service.js";

const documentType = z.enum(DOCUMENT_TYPES);
const templateParams = z.object({ templateId: z.uuid() });
const listQuery = z.object({ documentType: documentType.optional(), includeArchived: z.enum(["true", "false"]).transform((v) => v === "true").optional() });
const fieldsQuery = z.object({ documentType });
const typeParams = z.object({ documentType });
const createBody = z.strictObject({
  documentType,
  name: z.string().trim().min(1).max(120),
  /** Sxema tekshiruvi serverda — bu yerda faqat "obyekt" deb qabul qilinadi. */
  schema: z.unknown().optional(),
  makeDefault: z.boolean().optional(),
});
const saveBody = z.strictObject({ schema: z.unknown(), note: z.string().trim().max(300).optional() });
const renameBody = z.strictObject({ name: z.string().trim().min(1).max(120) });
const restoreBody = z.strictObject({ versionId: z.uuid() });

async function readTenant(req: FastifyRequest, permission?: Permission): Promise<TenantContext> {
  const tenant = await requireTenant(db, authOf(req).user);
  if (permission) await requirePermission(db, tenant, permission);
  return tenant;
}

function writeInTenant<T>(
  req: FastifyRequest,
  permission: Permission,
  fn: (tx: Parameters<Parameters<typeof withTransaction>[0]>[0], tenant: TenantContext) => Promise<T>,
): Promise<T> {
  return withTransaction(async (tx) => {
    const tenant = await requireTenantForWrite(tx as DbOrTx, authOf(req).user);
    await requirePermission(tx, tenant, permission);
    return fn(tx, tenant);
  });
}

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/templates", async (req) => {
    const query = listQuery.parse(req.query);
    const tenant = await readTenant(req, "settings.view");
    return { templates: await listTemplates(db, tenant, query) };
  });

  app.get("/templates/:templateId", async (req) => {
    const { templateId } = templateParams.parse(req.params);
    const tenant = await readTenant(req, "settings.view");
    return getTemplate(db, tenant, templateId);
  });

  app.get("/templates/:templateId/versions", async (req) => {
    const { templateId } = templateParams.parse(req.params);
    const tenant = await readTenant(req, "settings.view");
    return { versions: await listVersions(db, tenant, templateId) };
  });

  /** Dizayner chap paneli shu ro'yxatdan quriladi — brauzer o'zi maydon o'ylab topmaydi. */
  app.get("/fields", async (req) => {
    const query = fieldsQuery.parse(req.query);
    const tenant = await readTenant(req, "settings.view");
    const access = await catalogAccess(db, tenant, query.documentType);
    return {
      fields: fieldsFor(access),
      columns: columnsFor(access),
      totalRows: TOTAL_ROWS,
      paymentRows: PAYMENT_ROWS,
    };
  });

  /** Hujjat chizishda: kompaniyaning standart shabloni yoki zavod shabloni. */
  app.get("/active/:documentType", async (req) => {
    const params = typeParams.parse(req.params);
    const tenant = await readTenant(req);
    return { schema: await activeSchemaFor(db, tenant, params.documentType) };
  });

  app.post("/templates", async (req, reply) => {
    const body = createBody.parse(req.body);
    const result = await writeInTenant(req, "settings.manage", (tx, tenant) => createTemplate(tx, tenant, body, requestMeta(req)));
    reply.status(201);
    return result;
  });

  app.post("/templates/:templateId/versions", async (req, reply) => {
    const { templateId } = templateParams.parse(req.params);
    const body = saveBody.parse(req.body);
    const result = await writeInTenant(req, "settings.manage", (tx, tenant) =>
      saveVersion(tx, tenant, templateId, { schema: body.schema, note: body.note ?? null }, requestMeta(req)),
    );
    reply.status(201);
    return result;
  });

  app.post("/templates/:templateId/restore", async (req) => {
    const { templateId } = templateParams.parse(req.params);
    const body = restoreBody.parse(req.body);
    const version = await writeInTenant(req, "settings.manage", (tx, tenant) =>
      restoreVersion(tx, tenant, templateId, body.versionId, requestMeta(req)),
    );
    return { version };
  });

  app.post("/templates/:templateId/default", async (req) => {
    const { templateId } = templateParams.parse(req.params);
    const template = await writeInTenant(req, "settings.manage", (tx, tenant) => setDefaultTemplate(tx, tenant, templateId, requestMeta(req)));
    return { template };
  });

  app.patch("/templates/:templateId", async (req) => {
    const { templateId } = templateParams.parse(req.params);
    const body = renameBody.parse(req.body);
    const template = await writeInTenant(req, "settings.manage", (tx, tenant) => renameTemplate(tx, tenant, templateId, body.name, requestMeta(req)));
    return { template };
  });

  app.delete("/templates/:templateId", async (req) => {
    const { templateId } = templateParams.parse(req.params);
    const template = await writeInTenant(req, "settings.manage", (tx, tenant) => archiveTemplate(tx, tenant, templateId, requestMeta(req)));
    return { template };
  });
}
