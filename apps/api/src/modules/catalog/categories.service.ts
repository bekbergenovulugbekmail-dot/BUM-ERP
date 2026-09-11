/**
 * Kategoriyalar va brendlar (convex/products/categories.ts, brands.ts).
 *
 * Convex'dan farqlar:
 *  - kategoriyani o'chirishda ichki kategoriyalar tekshirilmasdi — yetim qolardi
 *  - kategoriyani o'z avlodiga ota qilib qo'yish mumkin edi (sikl)
 *  - brendni o'chirib bo'lmasdi va nomi takrorlanishi mumkin edi (bazada unique)
 */
import { and, count, eq } from "drizzle-orm";
import { badRequest, conflict, notFound } from "@bum/shared";
import { brands, categories, products } from "../../db/schema/catalog.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import type { TenantContext } from "../company/tenant.js";
import { assertCategoryInScope, categoryScope } from "./category-scope.js";

const MAX_CATEGORY_DEPTH = 50;

function audit(
  tx: Tx,
  tenant: TenantContext,
  meta: RequestMeta,
  entry: { action: string; resource: string; resourceId: string; details?: Record<string, unknown> },
) {
  return writeAuditLog(
    {
      userId: tenant.user.id,
      userName: tenant.user.name,
      companyId: tenant.company.id,
      ...entry,
      ...meta,
    },
    tx,
  );
}

function withoutLegacy<T extends { legacyId: unknown }>(row: T): Omit<T, "legacyId"> {
  const { legacyId: _legacyId, ...rest } = row;
  return rest;
}

// ─── Kategoriyalar ───────────────────────────────────────────────────────────

export async function listCategories(conn: DbOrTx, tenant: TenantContext, includeInactive = false) {
  const rows = await conn
    .select()
    .from(categories)
    .where(
      and(
        eq(categories.companyId, tenant.company.id),
        includeInactive ? undefined : eq(categories.isActive, true),
      ),
    )
    .orderBy(categories.sortOrder, categories.name);
  // Cheklangan xodim faqat o'z kategoriyalarini (ichkilari bilan) ko'radi
  const scope = await categoryScope(conn, tenant);
  return (scope === null ? rows : rows.filter((c) => scope.includes(c.id))).map(withoutLegacy);
}

async function loadCategory(conn: DbOrTx, tenant: TenantContext, id: string) {
  const [category] = await conn
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.companyId, tenant.company.id)))
    .limit(1);
  return category;
}

/** Ota kategoriya shu kompaniyaniki bo'lishi va sikl hosil qilmasligi kerak. */
async function assertValidParent(tx: Tx, tenant: TenantContext, parentId: string, selfId?: string) {
  if (parentId === selfId) throw badRequest("Kategoriya o'ziga ota bo'la olmaydi");

  let cursor: string | null = parentId;
  for (let depth = 0; cursor; depth++) {
    if (depth > MAX_CATEGORY_DEPTH) throw badRequest("Kategoriya daraxti juda chuqur");
    const node = await loadCategory(tx, tenant, cursor);
    if (!node) throw badRequest("Ota kategoriya topilmadi");
    if (selfId && node.parentId === selfId) {
      throw badRequest("Kategoriyani o'z ichidagi kategoriyaga joylashtirib bo'lmaydi");
    }
    cursor = node.parentId;
  }
}

export type CategoryInput = {
  name: string;
  parentId?: string | null;
  description?: string | null;
  sortOrder?: number;
};

export async function createCategory(tx: Tx, tenant: TenantContext, input: CategoryInput, meta: RequestMeta) {
  // Cheklangan xodim faqat o'z kategoriyasi ichida yangi kategoriya ochadi
  const scope = await categoryScope(tx, tenant);
  if (scope !== null) assertCategoryInScope(scope, input.parentId);
  if (input.parentId) await assertValidParent(tx, tenant, input.parentId);

  const [category] = await tx
    .insert(categories)
    .values({
      companyId: tenant.company.id,
      name: input.name,
      parentId: input.parentId ?? null,
      description: input.description ?? null,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();

  await audit(tx, tenant, meta, {
    action: "CATEGORY_CREATED",
    resource: "categories",
    resourceId: category!.id,
    details: { name: category!.name, parentId: category!.parentId },
  });
  return withoutLegacy(category!);
}

export async function updateCategory(
  tx: Tx,
  tenant: TenantContext,
  id: string,
  patch: Partial<CategoryInput> & { isActive?: boolean },
  meta: RequestMeta,
) {
  const category = await loadCategory(tx, tenant, id);
  if (!category) throw notFound("Kategoriya topilmadi");
  const scope = await categoryScope(tx, tenant);
  assertCategoryInScope(scope, id);
  if (patch.parentId !== undefined) assertCategoryInScope(scope, patch.parentId);
  if (patch.parentId) await assertValidParent(tx, tenant, patch.parentId, id);

  const [updated] = await tx
    .update(categories)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(categories.id, id))
    .returning();

  await audit(tx, tenant, meta, {
    action: "CATEGORY_UPDATED",
    resource: "categories",
    resourceId: id,
    details: { changes: Object.keys(patch) },
  });
  return withoutLegacy(updated!);
}

export async function deleteCategory(tx: Tx, tenant: TenantContext, id: string, meta: RequestMeta) {
  const category = await loadCategory(tx, tenant, id);
  if (!category) throw notFound("Kategoriya topilmadi");

  assertCategoryInScope(await categoryScope(tx, tenant), id);

  const [[usedByProducts], [children]] = await Promise.all([
    tx
      .select({ n: count() })
      .from(products)
      .where(and(eq(products.companyId, tenant.company.id), eq(products.categoryId, id))),
    tx
      .select({ n: count() })
      .from(categories)
      .where(and(eq(categories.companyId, tenant.company.id), eq(categories.parentId, id))),
  ]);
  if ((usedByProducts?.n ?? 0) > 0) throw conflict("Bu kategoriyada mahsulotlar mavjud");
  if ((children?.n ?? 0) > 0) throw conflict("Bu kategoriyaning ichki kategoriyalari mavjud");

  await tx.delete(categories).where(eq(categories.id, id));
  await audit(tx, tenant, meta, {
    action: "CATEGORY_DELETED",
    resource: "categories",
    resourceId: id,
    details: { name: category.name },
  });
}

// ─── Brendlar ────────────────────────────────────────────────────────────────

export async function listBrands(conn: DbOrTx, tenant: TenantContext, isActive?: boolean) {
  const rows = await conn
    .select()
    .from(brands)
    .where(
      and(
        eq(brands.companyId, tenant.company.id),
        isActive === undefined ? undefined : eq(brands.isActive, isActive),
      ),
    )
    .orderBy(brands.name);
  return rows.map(withoutLegacy);
}

export type BrandInput = { name: string; description?: string | null };

export async function createBrand(tx: Tx, tenant: TenantContext, input: BrandInput, meta: RequestMeta) {
  const [brand] = await tx
    .insert(brands)
    .values({ companyId: tenant.company.id, name: input.name, description: input.description ?? null })
    .returning();
  await audit(tx, tenant, meta, {
    action: "BRAND_CREATED",
    resource: "brands",
    resourceId: brand!.id,
    details: { name: brand!.name },
  });
  return withoutLegacy(brand!);
}

export async function updateBrand(
  tx: Tx,
  tenant: TenantContext,
  id: string,
  patch: Partial<BrandInput> & { isActive?: boolean },
  meta: RequestMeta,
) {
  const [updated] = await tx
    .update(brands)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(brands.id, id), eq(brands.companyId, tenant.company.id)))
    .returning();
  if (!updated) throw notFound("Brend topilmadi");
  await audit(tx, tenant, meta, {
    action: "BRAND_UPDATED",
    resource: "brands",
    resourceId: id,
    details: { changes: Object.keys(patch) },
  });
  return withoutLegacy(updated);
}

export async function deleteBrand(tx: Tx, tenant: TenantContext, id: string, meta: RequestMeta) {
  const [brand] = await tx
    .select()
    .from(brands)
    .where(and(eq(brands.id, id), eq(brands.companyId, tenant.company.id)))
    .limit(1);
  if (!brand) throw notFound("Brend topilmadi");

  const [used] = await tx
    .select({ n: count() })
    .from(products)
    .where(and(eq(products.companyId, tenant.company.id), eq(products.brandId, id)));
  if ((used?.n ?? 0) > 0) throw conflict("Bu brenddagi mahsulotlar mavjud");

  await tx.delete(brands).where(eq(brands.id, id));
  await audit(tx, tenant, meta, {
    action: "BRAND_DELETED",
    resource: "brands",
    resourceId: id,
    details: { name: brand.name },
  });
}
