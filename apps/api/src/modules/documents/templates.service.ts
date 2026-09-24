/**
 * Hujjat shablonlari: CRUD, versiyalash va chizish uchun sxemani berish.
 *
 * Qoidalar (topshiriq 17, 18, 25, 26):
 *  - har saqlash YANGI versiya; eski versiya o'chirilmaydi, unga qaytish mumkin
 *  - shablon o'chirilmaydi — arxivlanadi (tarixdagi hujjat qaysi shablon bilan chiqqani bilinsin)
 *  - standart (zavod) shablon bazada turmaydi, shuning uchun uni buzib bo'lmaydi
 *  - har amal audit jurnaliga tushadi
 *  - hamma so'rov `company_id` bilan cheklanadi — begona shablon ko'rinmaydi
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { badRequest, conflict, notFound, type DocumentTemplateSchema, type DocumentType } from "@bum/shared";
import { documentTemplateVersions, documentTemplates } from "../../db/schema/documents.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { effectivePermissions, type TenantContext } from "../company/tenant.js";
import { defaultSchemaFor } from "./default-templates.js";
import { sanitizeTemplateSchema, type SanitizeResult } from "./sanitize.js";
import type { CatalogAccess } from "./field-catalog.js";

const MAX_TEMPLATES_PER_TYPE = 20;

function audit(tx: Tx, tenant: TenantContext, meta: RequestMeta, action: string, templateId: string, details: Record<string, unknown>) {
  return writeAuditLog(
    {
      userId: tenant.user.id,
      userName: tenant.user.name,
      companyId: tenant.company.id,
      action,
      resource: "document_templates",
      resourceId: templateId,
      details,
      ...meta,
    },
    tx,
  );
}

/** Foydalanuvchining ruxsatlari bilan katalog kirish konteksti. */
export async function catalogAccess(conn: DbOrTx, tenant: TenantContext, documentType: DocumentType): Promise<CatalogAccess> {
  const permissions = await effectivePermissions(conn, tenant);
  return { documentType, permissions: new Set<string>(permissions) };
}

const templateFields = {
  id: documentTemplates.id,
  documentType: documentTemplates.documentType,
  name: documentTemplates.name,
  status: documentTemplates.status,
  isDefault: documentTemplates.isDefault,
  currentVersionId: documentTemplates.currentVersionId,
  createdAt: documentTemplates.createdAt,
  updatedAt: documentTemplates.updatedAt,
};

export async function listTemplates(conn: DbOrTx, tenant: TenantContext, options: { documentType?: DocumentType; includeArchived?: boolean } = {}) {
  const rows = await conn
    .select({ ...templateFields, version: documentTemplateVersions.version })
    .from(documentTemplates)
    .leftJoin(documentTemplateVersions, eq(documentTemplateVersions.id, documentTemplates.currentVersionId))
    .where(
      and(
        eq(documentTemplates.companyId, tenant.company.id),
        options.documentType ? eq(documentTemplates.documentType, options.documentType) : undefined,
        options.includeArchived ? undefined : eq(documentTemplates.status, "active"),
      ),
    )
    .orderBy(desc(documentTemplates.isDefault), asc(documentTemplates.name));
  return rows;
}

async function requireTemplate(conn: DbOrTx, tenant: TenantContext, templateId: string) {
  const [row] = await conn
    .select()
    .from(documentTemplates)
    .where(and(eq(documentTemplates.id, templateId), eq(documentTemplates.companyId, tenant.company.id)))
    .limit(1);
  if (!row) throw notFound("Shablon topilmadi");
  return row;
}

/** Shablon va uning amaldagi sxemasi. */
export async function getTemplate(conn: DbOrTx, tenant: TenantContext, templateId: string) {
  const template = await requireTemplate(conn, tenant, templateId);
  const [version] = template.currentVersionId
    ? await conn.select().from(documentTemplateVersions).where(eq(documentTemplateVersions.id, template.currentVersionId)).limit(1)
    : [];
  return {
    template: { ...template, companyId: undefined },
    version: version ? { id: version.id, version: version.version, note: version.note, createdAt: version.createdAt } : null,
    schema: (version?.schema as DocumentTemplateSchema | undefined) ?? defaultSchemaFor(template.documentType),
  };
}

/**
 * Hujjat chizishda ishlatiladigan sxema: kompaniyaning standart shabloni bo'lsa — o'sha,
 * aks holda zavod shabloni. Hujjat HECH QACHON shablon yo'qligi sababli chiqmay qolmaydi.
 */
export async function activeSchemaFor(conn: DbOrTx, tenant: TenantContext, documentType: DocumentType): Promise<DocumentTemplateSchema> {
  const [row] = await conn
    .select({ schema: documentTemplateVersions.schema })
    .from(documentTemplates)
    .innerJoin(documentTemplateVersions, eq(documentTemplateVersions.id, documentTemplates.currentVersionId))
    .where(
      and(
        eq(documentTemplates.companyId, tenant.company.id),
        eq(documentTemplates.documentType, documentType),
        eq(documentTemplates.isDefault, true),
        eq(documentTemplates.status, "active"),
      ),
    )
    .limit(1);
  return (row?.schema as DocumentTemplateSchema | undefined) ?? defaultSchemaFor(documentType);
}

async function insertVersion(
  tx: Tx,
  tenant: TenantContext,
  templateId: string,
  schema: DocumentTemplateSchema,
  note: string | null,
) {
  const [last] = await tx
    .select({ version: documentTemplateVersions.version })
    .from(documentTemplateVersions)
    .where(eq(documentTemplateVersions.templateId, templateId))
    .orderBy(desc(documentTemplateVersions.version))
    .limit(1);
  const [created] = await tx
    .insert(documentTemplateVersions)
    .values({
      companyId: tenant.company.id,
      templateId,
      version: (last?.version ?? 0) + 1,
      schema,
      note,
      createdBy: tenant.user.id,
    })
    .returning();
  await tx
    .update(documentTemplates)
    .set({ currentVersionId: created!.id, updatedAt: new Date() })
    .where(eq(documentTemplates.id, templateId));
  return created!;
}

/** Birinchi standart shablon bo'lsa — o'zi standart bo'ladi. */
async function clearDefault(tx: Tx, tenant: TenantContext, documentType: DocumentType) {
  await tx
    .update(documentTemplates)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(
      and(
        eq(documentTemplates.companyId, tenant.company.id),
        eq(documentTemplates.documentType, documentType),
        eq(documentTemplates.isDefault, true),
      ),
    );
}

export type CreateInput = { documentType: DocumentType; name: string; schema?: unknown; makeDefault?: boolean };

export async function createTemplate(tx: Tx, tenant: TenantContext, input: CreateInput, meta: RequestMeta) {
  const [countRow] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(documentTemplates)
    .where(
      and(
        eq(documentTemplates.companyId, tenant.company.id),
        eq(documentTemplates.documentType, input.documentType),
        eq(documentTemplates.status, "active"),
      ),
    );
  const count = countRow?.count ?? 0;
  if (count >= MAX_TEMPLATES_PER_TYPE) throw badRequest(`Bu hujjat turida ${MAX_TEMPLATES_PER_TYPE} tadan ortiq shablon bo'lmaydi`);

  const access = await catalogAccess(tx, tenant, input.documentType);
  // Sxema berilmasa zavod shablonidan boshlanadi — bo'sh varaq emas
  const source = input.schema ?? defaultSchemaFor(input.documentType);
  const { schema, warnings } = sanitizeTemplateSchema(source, access);

  const existing = await tx
    .select({ id: documentTemplates.id })
    .from(documentTemplates)
    .where(
      and(
        eq(documentTemplates.companyId, tenant.company.id),
        eq(documentTemplates.documentType, input.documentType),
        eq(documentTemplates.status, "active"),
        sql`lower(${documentTemplates.name}) = lower(${input.name})`,
      ),
    )
    .limit(1);
  if (existing.length > 0) throw conflict("Bu nomdagi shablon allaqachon bor");

  const makeDefault = input.makeDefault ?? count === 0;
  if (makeDefault) await clearDefault(tx, tenant, input.documentType);

  const [template] = await tx
    .insert(documentTemplates)
    .values({
      companyId: tenant.company.id,
      documentType: input.documentType,
      name: input.name,
      isDefault: makeDefault,
      createdBy: tenant.user.id,
    })
    .returning();

  const version = await insertVersion(tx, tenant, template!.id, schema, "Yaratildi");
  await audit(tx, tenant, meta, "DOCUMENT_TEMPLATE_CREATED", template!.id, {
    documentType: input.documentType,
    name: input.name,
    isDefault: makeDefault,
  });
  return { template: { ...template!, currentVersionId: version.id }, version, warnings };
}

export type SaveInput = { schema: unknown; note?: string | null };

/** Tahrirlash = YANGI VERSIYA. Eski versiya joyida qoladi. */
export async function saveVersion(tx: Tx, tenant: TenantContext, templateId: string, input: SaveInput, meta: RequestMeta) {
  const template = await requireTemplate(tx, tenant, templateId);
  if (template.status !== "active") throw badRequest("Arxivdagi shablon tahrirlanmaydi");
  const access = await catalogAccess(tx, tenant, template.documentType);
  const { schema, warnings }: SanitizeResult = sanitizeTemplateSchema(input.schema, access);
  const version = await insertVersion(tx, tenant, templateId, schema, input.note?.trim() || null);
  await audit(tx, tenant, meta, "DOCUMENT_TEMPLATE_SAVED", templateId, { version: version.version, warnings: warnings.length });
  return { version, warnings };
}

export async function renameTemplate(tx: Tx, tenant: TenantContext, templateId: string, name: string, meta: RequestMeta) {
  const template = await requireTemplate(tx, tenant, templateId);
  const [updated] = await tx
    .update(documentTemplates)
    .set({ name, updatedAt: new Date() })
    .where(eq(documentTemplates.id, templateId))
    .returning(templateFields);
  await audit(tx, tenant, meta, "DOCUMENT_TEMPLATE_RENAMED", templateId, { from: template.name, to: name });
  return updated!;
}

export async function setDefaultTemplate(tx: Tx, tenant: TenantContext, templateId: string, meta: RequestMeta) {
  const template = await requireTemplate(tx, tenant, templateId);
  if (template.status !== "active") throw badRequest("Arxivdagi shablon standart bo'lmaydi");
  await clearDefault(tx, tenant, template.documentType);
  const [updated] = await tx
    .update(documentTemplates)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(eq(documentTemplates.id, templateId))
    .returning(templateFields);
  await audit(tx, tenant, meta, "DOCUMENT_TEMPLATE_SET_DEFAULT", templateId, { documentType: template.documentType });
  return updated!;
}

/** O'chirish EMAS — arxivlash. Standart shablonni arxivlashdan oldin boshqasi tanlanadi. */
export async function archiveTemplate(tx: Tx, tenant: TenantContext, templateId: string, meta: RequestMeta) {
  const template = await requireTemplate(tx, tenant, templateId);
  if (template.isDefault) throw badRequest("Standart shablon arxivlanmaydi — avval boshqasini standart qiling");
  const [updated] = await tx
    .update(documentTemplates)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(documentTemplates.id, templateId))
    .returning(templateFields);
  await audit(tx, tenant, meta, "DOCUMENT_TEMPLATE_ARCHIVED", templateId, { name: template.name });
  return updated!;
}

export async function listVersions(conn: DbOrTx, tenant: TenantContext, templateId: string) {
  await requireTemplate(conn, tenant, templateId);
  return conn
    .select({
      id: documentTemplateVersions.id,
      version: documentTemplateVersions.version,
      note: documentTemplateVersions.note,
      createdBy: documentTemplateVersions.createdBy,
      createdAt: documentTemplateVersions.createdAt,
    })
    .from(documentTemplateVersions)
    .where(eq(documentTemplateVersions.templateId, templateId))
    .orderBy(desc(documentTemplateVersions.version));
}

/**
 * Eski versiyaga qaytish — eski yozuvni tiklash emas, uning sxemasidan YANGI versiya yasash.
 * Shu sababli tarix uzluksiz qoladi: "3-versiya = 1-versiyaning nusxasi".
 */
export async function restoreVersion(tx: Tx, tenant: TenantContext, templateId: string, versionId: string, meta: RequestMeta) {
  await requireTemplate(tx, tenant, templateId);
  const [source] = await tx
    .select()
    .from(documentTemplateVersions)
    .where(
      and(
        eq(documentTemplateVersions.id, versionId),
        eq(documentTemplateVersions.templateId, templateId),
        eq(documentTemplateVersions.companyId, tenant.company.id),
      ),
    )
    .limit(1);
  if (!source) throw notFound("Versiya topilmadi");
  const version = await insertVersion(tx, tenant, templateId, source.schema as DocumentTemplateSchema, `${source.version}-versiyaga qaytarildi`);
  await audit(tx, tenant, meta, "DOCUMENT_TEMPLATE_RESTORED", templateId, { from: source.version, to: version.version });
  return version;
}
