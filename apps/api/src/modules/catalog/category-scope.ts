/**
 * Xodimning mas'ul kategoriyalari — a'zolikdagi `allowedCategoryIds` bo'yicha mahsulot cheklovi.
 *
 * Qoidalar:
 *  - bo'sh ro'yxat = cheklov yo'q (barcha kategoriyalar); to'liq huquqli rollar doim cheklovsiz
 *  - tanlangan kategoriyaning barcha ichki kategoriyalari ham kiradi
 *  - cheklangan xodim kategoriyasiz mahsulotni ko'rmaydi va u bilan ishlamaydi
 *  - NIMA qila olishi (ko'rish / qo'shish / o'zgartirish) rol ruxsatlari bilan belgilanadi —
 *    bu modul faqat QAYSI mahsulotlar bilan ekanini tekshiradi
 *
 * Qo'llanadi: katalog, ombor (qoldiq, harakatlar, inventarizatsiya), xarid va savdo (POS bilan).
 */
import { and, eq, inArray, isNull, notInArray, or, sql, type SQL } from "drizzle-orm";
import { forbidden } from "@bum/shared";
import { products } from "../../db/schema/catalog.js";
import type { DbOrTx } from "../../db/transaction.js";
import { isFullAccessRole, type TenantContext } from "../company/tenant.js";

/** Bitta so'rov ichida daraxt bir marta hisoblanadi. */
const scopes = new WeakMap<TenantContext, Promise<string[] | null>>();

/**
 * `uuid[]` qiymati. Drizzle `sql` shablonida JS massivni parametrlar ro'yxatiga yoyadi
 * (`($1, $2)`), shuning uchun massiv aniq `array[...]` ifodasi bilan quriladi.
 */
function uuidArray(ids: string[]): SQL {
  return ids.length === 0
    ? sql`array[]::uuid[]`
    : sql`array[${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )}]::uuid[]`;
}

/** `null` — cheklov yo'q; aks holda ruxsat etilgan kategoriya ID'lari (ichki kategoriyalari bilan). */
export function categoryScope(conn: DbOrTx, tenant: TenantContext): Promise<string[] | null> {
  const roots = tenant.membership.allowedCategoryIds;
  if (roots.length === 0 || isFullAccessRole(tenant.membership.companyRole)) return Promise.resolve(null);

  let scope = scopes.get(tenant);
  if (!scope) {
    scope = conn
      .execute<{ id: string }>(sql`
        with recursive tree as (
          select id from categories
          where company_id = ${tenant.company.id} and id = any(${uuidArray(roots)})
          union
          select c.id from categories c
          inner join tree t on c.parent_id = t.id
          where c.company_id = ${tenant.company.id}
        )
        select id from tree`)
      .then((result) => result.rows.map((row) => row.id));
    scopes.set(tenant, scope);
  }
  return scope;
}

/** `products` jadvali qatnashgan so'rov uchun shart; cheklov bo'lmasa `undefined`. */
export function productScopeCondition(scope: string[] | null): SQL | undefined {
  return scope === null ? undefined : inArray(products.categoryId, scope);
}

/** Kategoriya (yangi mahsulot yoki kategoriya uchun) xodim doirasida bo'lishi kerak. */
export function assertCategoryInScope(scope: string[] | null, categoryId: string | null | undefined): void {
  if (scope === null) return;
  if (!categoryId || !scope.includes(categoryId)) throw forbidden("Bu kategoriya sizga biriktirilmagan");
}

/** Mavjud mahsulot (kategoriyasi bo'yicha) xodim doirasida bo'lishi kerak. */
export function assertProductCategoryInScope(scope: string[] | null, categoryId: string | null): void {
  if (scope === null) return;
  if (!categoryId || !scope.includes(categoryId)) {
    throw forbidden("Bu mahsulot sizga biriktirilgan kategoriyada emas");
  }
}

/** Barcha mahsulotlar xodim doirasida bo'lishi kerak — aks holda birinchisining nomi bilan FORBIDDEN. */
export async function assertProductsInScope(conn: DbOrTx, tenant: TenantContext, productIds: string[]): Promise<void> {
  if (productIds.length === 0) return;
  const scope = await categoryScope(conn, tenant);
  if (scope === null) return;

  const [outside] = await conn
    .select({ name: products.name })
    .from(products)
    .where(
      and(
        eq(products.companyId, tenant.company.id),
        inArray(products.id, [...new Set(productIds)]),
        or(isNull(products.categoryId), notInArray(products.categoryId, scope)),
      ),
    )
    .limit(1);
  if (outside) throw forbidden(`${outside.name}: bu mahsulot sizga biriktirilgan kategoriyada emas`);
}

/** Konversiya: mahsulotga xosi — mahsulot doirada bo'lsin; umumiysi — faqat cheklanmagan xodim. */
export async function assertConversionInScope(conn: DbOrTx, tenant: TenantContext, productId: string | null): Promise<void> {
  const scope = await categoryScope(conn, tenant);
  if (scope === null) return;
  if (!productId) throw forbidden("Umumiy konversiyani faqat kategoriya cheklovi yo'q xodim o'zgartiradi");
  await assertProductsInScope(conn, tenant, [productId]);
}

/** Hujjat ro'yxati uchun: shu hujjatda xodim doirasidagi kamida bitta mahsulot bormi (SQL `exists`). */
export function documentHasScopedItem(
  scope: string[] | null,
  itemsTable: SQL,
  itemOrderId: SQL,
  itemProductId: SQL,
  orderId: SQL,
): SQL | undefined {
  if (scope === null) return undefined;
  return sql`exists (
    select 1 from ${itemsTable}
    inner join ${products} on ${products.id} = ${itemProductId}
    where ${itemOrderId} = ${orderId} and ${products.categoryId} = any(${uuidArray(scope)})
  )`;
}
