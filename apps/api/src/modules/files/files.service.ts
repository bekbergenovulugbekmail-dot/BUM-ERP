/**
 * Fayllar: mahsulot rasmi, xarajat cheki, xodim surati.
 *
 * Oqim: 1) `createUpload` — kalit va imzolangan PUT URL (10 daqiqa); 2) brauzer faylni
 * saqlashga yuklaydi; 3) `attachFile` — kalit shu kompaniya va turga tegishli, fayl haqiqatan
 * yuklangan, hajmi va turi ruxsat etilganini tekshirib yozuvga biriktiradi. Ko'rish — imzolangan
 * GET URL (5 daqiqa); saqlash ochiq (public) emas.
 *
 * Convex'dan farqlar: mahsulot rasmi foydalanuvchi kiritgan tashqi URL edi (`imageUrl`) — saqlangan
 * XSS va kuzatuv piksellari yo'li; endi faqat o'z saqlashimizdagi kalit. Xarajat cheki va xodim surati
 * Convex'da yo'q edi.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { badRequest, notFound, type Permission } from "@bum/shared";
import { products } from "../../db/schema/catalog.js";
import { expenses } from "../../db/schema/finance.js";
import { employees } from "../../db/schema/hr.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import type { StorageClient } from "../../shared/storage.js";
import type { TenantContext } from "../company/tenant.js";

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MB = 1024 * 1024;

export const FILE_KINDS = {
  "product-image": { maxBytes: 5 * MB, types: IMAGE_TYPES, manage: "products.edit", view: "products.view" },
  "expense-receipt": { maxBytes: 10 * MB, types: [...IMAGE_TYPES, "application/pdf"], manage: "finance.manage", view: "finance.view" },
  "employee-photo": { maxBytes: 5 * MB, types: IMAGE_TYPES, manage: "hr.manage", view: "hr.view" },
} as const satisfies Record<string, { maxBytes: number; types: readonly string[]; manage: Permission; view: Permission }>;

export type FileKind = keyof typeof FILE_KINDS;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

const UPLOAD_TTL = 600;
export const VIEW_TTL = 300;

export function keyPrefix(companyId: string, kind: FileKind) {
  return `companies/${companyId}/${kind}/`;
}

export type UploadRules = { maxBytes: number; types: readonly string[] };

/** Imzolangan PUT URL: tur va hajm tekshiriladi, kalit — prefiks + tasodifiy UUID. */
export function signUpload(client: StorageClient, prefix: string, rules: UploadRules, input: { contentType: string; size: number }) {
  if (!rules.types.includes(input.contentType)) {
    throw badRequest(`Fayl turi ruxsat etilmagan: ${rules.types.join(", ")}`);
  }
  if (input.size > rules.maxBytes) throw badRequest(`Fayl hajmi ${rules.maxBytes / MB} MB dan oshmasligi kerak`);

  const key = `${prefix}${randomUUID()}.${EXTENSIONS[input.contentType]}`;
  return {
    key,
    uploadUrl: client.signedUrl("PUT", key, UPLOAD_TTL, input.contentType),
    method: "PUT" as const,
    headers: { "content-type": input.contentType },
    expiresIn: UPLOAD_TTL,
  };
}

/** Kalit shu prefiks ostida `signUpload` yaratgan ko'rinishda bo'lishi shart (boshqa kompaniya yoki tur kaliti — rad). */
export function assertUploadKey(prefix: string, key: string) {
  const name = key.startsWith(prefix) ? key.slice(prefix.length) : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$/.test(name)) {
    throw badRequest("Fayl kaliti noto'g'ri");
  }
}

/** Fayl haqiqatan yuklangan, hajmi va turi qoidaga mos. */
export async function headUpload(client: StorageClient, rules: UploadRules, key: string) {
  const stored = await client.head(key);
  if (!stored) throw badRequest("Fayl yuklanmagan yoki yuklash muddati o'tgan");
  if (stored.size > rules.maxBytes) throw badRequest(`Fayl hajmi ${rules.maxBytes / MB} MB dan oshmasligi kerak`);
  const storedType = stored.contentType?.split(";")[0]?.trim();
  if (storedType && !rules.types.includes(storedType)) throw badRequest("Fayl turi ruxsat etilmagan");
  return stored;
}

const targets = {
  "product-image": { table: products, field: "imageKey", column: products.imageKey, id: products.id, company: products.companyId, label: "Mahsulot" },
  "expense-receipt": { table: expenses, field: "attachmentKey", column: expenses.attachmentKey, id: expenses.id, company: expenses.companyId, label: "Xarajat" },
  "employee-photo": { table: employees, field: "photoKey", column: employees.photoKey, id: employees.id, company: employees.companyId, label: "Xodim" },
} as const;

async function loadTarget(conn: DbOrTx, tenant: TenantContext, kind: FileKind, targetId: string, lock: boolean) {
  const target = targets[kind];
  const query = conn
    .select({ key: target.column })
    .from(target.table)
    .where(and(eq(target.id, targetId), eq(target.company, tenant.company.id)))
    .limit(1);
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw notFound(`${target.label} topilmadi`);
  return row.key;
}

async function saveTarget(tx: Tx, kind: FileKind, targetId: string, key: string | null) {
  const target = targets[kind];
  await tx
    .update(target.table)
    .set({ [target.field]: key, updatedAt: new Date() })
    .where(eq(target.id, targetId));
}

export function createUpload(
  tenant: TenantContext,
  input: { kind: FileKind; contentType: string; size: number },
  client: StorageClient,
) {
  return signUpload(client, keyPrefix(tenant.company.id, input.kind), FILE_KINDS[input.kind], input);
}

export async function attachFile(
  tx: Tx,
  tenant: TenantContext,
  input: { kind: FileKind; key: string; targetId: string },
  client: StorageClient,
  meta: RequestMeta,
) {
  assertUploadKey(keyPrefix(tenant.company.id, input.kind), input.key);
  const previous = await loadTarget(tx, tenant, input.kind, input.targetId, true);
  const stored = await headUpload(client, FILE_KINDS[input.kind], input.key);

  await saveTarget(tx, input.kind, input.targetId, input.key);
  await writeAuditLog(
    {
      userId: tenant.user.id,
      userName: tenant.user.name,
      companyId: tenant.company.id,
      action: "FILE_ATTACHED",
      resource: input.kind,
      resourceId: input.targetId,
      details: { key: input.key, size: stored.size, replaced: previous },
      ...meta,
    },
    tx,
  );
  return { key: input.key, previous: previous !== input.key ? previous : null };
}

export async function detachFile(
  tx: Tx,
  tenant: TenantContext,
  input: { kind: FileKind; targetId: string },
  meta: RequestMeta,
) {
  const previous = await loadTarget(tx, tenant, input.kind, input.targetId, true);
  if (!previous) throw notFound("Fayl biriktirilmagan");

  await saveTarget(tx, input.kind, input.targetId, null);
  await writeAuditLog(
    {
      userId: tenant.user.id,
      userName: tenant.user.name,
      companyId: tenant.company.id,
      action: "FILE_DETACHED",
      resource: input.kind,
      resourceId: input.targetId,
      details: { key: previous },
      ...meta,
    },
    tx,
  );
  return { previous };
}

export async function fileUrl(conn: DbOrTx, tenant: TenantContext, input: { kind: FileKind; targetId: string }, client: StorageClient) {
  const key = await loadTarget(conn, tenant, input.kind, input.targetId, false);
  if (!key) throw notFound("Fayl biriktirilmagan");
  return { url: client.signedUrl("GET", key, VIEW_TTL), expiresIn: VIEW_TTL };
}
