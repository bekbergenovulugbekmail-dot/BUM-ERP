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
import { badRequest, notFound, type ModuleKey, type Permission } from "@bum/shared";
import { productImages, products } from "../../db/schema/catalog.js";
import { expenses } from "../../db/schema/finance.js";
import { employees } from "../../db/schema/hr.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { stripImageMetadata } from "../../shared/image-metadata.js";
import type { StorageClient } from "../../shared/storage.js";
import { assertModuleEnabled } from "../company/modules.service.js";
import { requirePermission, type TenantContext } from "../company/tenant.js";

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MB = 1024 * 1024;

export const FILE_KINDS = {
  "product-image": { maxBytes: 5 * MB, types: IMAGE_TYPES, manage: "products.edit", view: "products.view", module: "products" },
  "expense-receipt": { maxBytes: 10 * MB, types: [...IMAGE_TYPES, "application/pdf"], manage: "finance.manage", view: "finance.view", module: "finance" },
  "employee-photo": { maxBytes: 5 * MB, types: IMAGE_TYPES, manage: "hr.manage", view: "hr.view", module: "hr" },
} as const satisfies Record<string, { maxBytes: number; types: readonly string[]; manage: Permission; view: Permission; module: ModuleKey }>;

export type FileKind = keyof typeof FILE_KINDS;

/**
 * Fayl turi bo'yicha kirish: ruxsat va shu tur tegishli modul (fayl marshrutlari umumiy — modul guard ularni yopmaydi,
 * shuning uchun moliya yoki HR moduli o'chirilganda xarajat cheki va xodim surati shu yerda yopiladi).
 */
export async function requireFileAccess(conn: DbOrTx, tenant: TenantContext, kind: FileKind, access: "manage" | "view") {
  await requirePermission(conn, tenant, FILE_KINDS[kind][access]);
  await assertModuleEnabled(conn, tenant.company.id, FILE_KINDS[kind].module);
}

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

/** Fayl haqiqatan yuklangan, hajmi, turi va (saqlash qo'llasa) fayl boshidagi imzo qoidaga mos. */
export async function headUpload(client: StorageClient, rules: UploadRules, key: string) {
  const stored = await client.head(key);
  if (!stored) throw badRequest("Fayl yuklanmagan yoki yuklash muddati o'tgan");
  if (stored.size > rules.maxBytes) throw badRequest(`Fayl hajmi ${rules.maxBytes / MB} MB dan oshmasligi kerak`);
  const storedType = stored.contentType?.split(";")[0]?.trim().toLowerCase();
  // Tur imzolangan PUT URL ga kiradi — saqlashda turi yo'q fayl bizning yuklash havolamiz orqali kelmagan
  if (!storedType || !rules.types.includes(storedType)) throw badRequest("Fayl turi ruxsat etilmagan");
  // Rasm yoki PDF nomi ostida HTML/JS saqlanmasin: faylning birinchi baytlari e'lon qilingan turga mos
  if (client.readHead) {
    const head = await client.readHead(key, 16);
    if (!head || !matchesFileSignature(head, storedType)) throw badRequest("Fayl mazmuni e'lon qilingan turga mos emas");
  }
  return stored;
}

function matchesFileSignature(data: Buffer, contentType: string): boolean {
  if (contentType === "application/pdf") return data.subarray(0, 5).toString("latin1") === "%PDF-";
  return matchesImageSignature(data, contentType);
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
  if (input.kind === "product-image" && isDatabaseKey(previous)) await tx.delete(productImages).where(eq(productImages.productId, input.targetId));
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
  if (input.kind === "product-image" && isDatabaseKey(previous)) await tx.delete(productImages).where(eq(productImages.productId, input.targetId));
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

/** Ko'rish havolasi: bazadagi rasm — API'ning autentifikatsiyali `/content` yo'li; saqlashdagi fayl — imzolangan URL (saqlash yo'q — null). */
export async function fileUrl(conn: DbOrTx, tenant: TenantContext, input: { kind: FileKind; targetId: string }, client: StorageClient | null) {
  const key = await loadTarget(conn, tenant, input.kind, input.targetId, false);
  if (!key) throw notFound("Fayl biriktirilmagan");
  if (isDatabaseKey(key)) {
    return { url: `/api/files/${input.kind}/${input.targetId}/content?v=${encodeURIComponent(key.slice(key.lastIndexOf("/") + 1))}`, expiresIn: VIEW_TTL };
  }
  if (!client) return null;
  return { url: client.signedUrl("GET", key, VIEW_TTL), expiresIn: VIEW_TTL };
}

// ─── Bazadagi mahsulot rasmi (fayl saqlash sozlanmagan) ─────────────────────

/** Bazadagi fayl kaliti prefiksi — S3 sozlanmagan bo'lsa mahsulot rasmi `product_images` da saqlanadi. */
export const DATABASE_KEY_PREFIX = "db/";

export function isDatabaseKey(key: string | null | undefined): key is string {
  return typeof key === "string" && key.startsWith(DATABASE_KEY_PREFIX);
}

/** Fayl boshidagi imzo e'lon qilingan rasm turiga mos — rasm nomi ostida boshqa mazmun saqlanmasin. */
export function matchesImageSignature(data: Buffer, contentType: string): boolean {
  if (contentType === "image/jpeg") return data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (contentType === "image/png") return data.length > 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (contentType === "image/webp") return data.length > 12 && data.toString("latin1", 0, 4) === "RIFF" && data.toString("latin1", 8, 12) === "WEBP";
  return false;
}

/** Mahsulot rasmini bazaga yozish (bitta so'rov, 5 MB gacha): tur, hajm va fayl imzosi tekshiriladi, eski rasm almashtiriladi. */
export async function saveProductImageContent(
  tx: Tx,
  tenant: TenantContext,
  input: { productId: string; contentType: string; data: Buffer },
  meta: RequestMeta,
) {
  const rules = FILE_KINDS["product-image"];
  const contentType = (input.contentType.split(";")[0] ?? "").trim().toLowerCase();
  if (!(rules.types as readonly string[]).includes(contentType)) throw badRequest(`Fayl turi ruxsat etilmagan: ${rules.types.join(", ")}`);
  if (input.data.length === 0) throw badRequest("Fayl bo'sh");
  if (input.data.length > rules.maxBytes) throw badRequest(`Fayl hajmi ${rules.maxBytes / MB} MB dan oshmasligi kerak`);
  if (!matchesImageSignature(input.data, contentType)) throw badRequest("Fayl mazmuni tanlangan rasm turiga mos emas");
  // EXIF (GPS koordinata, qurilma), XMP va izohlar saqlanmaydi — rasm qayta kodlanmaydi, ko'rinishi o'zgarmaydi
  const content = stripImageMetadata(input.data, contentType);

  const previous = await loadTarget(tx, tenant, "product-image", input.productId, true);
  const key = `${DATABASE_KEY_PREFIX}product-image/${randomUUID()}.${EXTENSIONS[contentType]}`;
  const image = { key, content, contentType, sizeBytes: content.length };
  await tx
    .insert(productImages)
    .values({ productId: input.productId, companyId: tenant.company.id, ...image })
    .onConflictDoUpdate({ target: productImages.productId, set: { ...image, updatedAt: new Date() } });
  await saveTarget(tx, "product-image", input.productId, key);
  await writeAuditLog(
    {
      userId: tenant.user.id,
      userName: tenant.user.name,
      companyId: tenant.company.id,
      action: "FILE_ATTACHED",
      resource: "product-image",
      resourceId: input.productId,
      details: { key, size: input.data.length, replaced: previous, storage: "database" },
      ...meta,
    },
    tx,
  );
  return { key, previous: previous !== key ? previous : null };
}

export type ProductImageSource =
  | { kind: "none" }
  | { kind: "database"; key: string; content: Buffer; contentType: string }
  | { kind: "storage"; key: string };

/** Mahsulot rasmi qayerda: bazada (mazmuni bilan), saqlashda (kalit) yoki yo'q. Boshqa kompaniya mahsuloti — 404. */
export async function loadProductImage(conn: DbOrTx, companyId: string, productId: string): Promise<ProductImageSource> {
  const [product] = await conn
    .select({ key: products.imageKey })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.companyId, companyId)))
    .limit(1);
  if (!product) throw notFound("Mahsulot topilmadi");
  if (!product.key) return { kind: "none" };
  if (!isDatabaseKey(product.key)) return { kind: "storage", key: product.key };
  const [image] = await conn
    .select({ content: productImages.content, contentType: productImages.contentType })
    .from(productImages)
    .where(and(eq(productImages.productId, productId), eq(productImages.companyId, companyId), eq(productImages.key, product.key)))
    .limit(1);
  return image ? { kind: "database", key: product.key, ...image } : { kind: "none" };
}
