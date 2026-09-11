/**
 * Ta'minotchilar (convex/purchase/suppliers.ts).
 *
 * Convex'dan farqlar:
 *  - `list` / `getById` ruxsat tekshirmasdi — `purchase.view`
 *  - kod noyobligi global indeksning birinchi yozuvi bo'yicha tekshirilardi (boshqa
 *    kompaniyada shu kod bo'lsa, o'z kompaniyasidagi dublikat o'tib ketardi) — endi bazada unique
 *  - `create` / `update` to'xtatilgan kompaniyada ham yozardi
 *  - valyuta erkin edi — hozircha faqat kompaniya valyutasi (ko'p valyutali hisob yo'q)
 *  - qarzi bor ta'minotchini faolsizlantirib bo'lmaydi; `totalDebt` / `totalPurchased`
 *    faqat qabul va to'lovdan o'zgaradi
 */
import { and, asc, eq, getTableColumns, ilike, or, sql } from "drizzle-orm";
import { badRequest, conflict, notFound } from "@bum/shared";
import { purchaseOrders, suppliers } from "../../db/schema/purchase.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { toMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { companyCurrency } from "../finance/accounts.service.js";

const { legacyId: _legacyId, companyId: _companyId, ...supplierFields } = getTableColumns(suppliers);

export function purchaseAudit(
  tx: Tx,
  tenant: TenantContext,
  meta: RequestMeta,
  entry: { action: string; resource: string; resourceId: string; details: Record<string, unknown> },
) {
  return writeAuditLog(
    { userId: tenant.user.id, userName: tenant.user.name, companyId: tenant.company.id, ...entry, ...meta },
    tx,
  );
}

export type SupplierInput = {
  name: string;
  code: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  taxId?: string | null;
  bankAccount?: string | null;
  paymentTermDays?: number;
  currency?: string;
  notes?: string | null;
};

async function resolveCurrency(conn: DbOrTx, companyId: string, requested?: string) {
  const currency = await companyCurrency(conn, companyId);
  if (requested && requested !== currency) {
    throw badRequest(`Hozircha faqat kompaniya valyutasi (${currency}) qo'llanadi`);
  }
  return currency;
}

export async function listSuppliers(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { includeInactive?: boolean; search?: string },
) {
  const pattern = options.search ? `%${options.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  return conn
    .select(supplierFields)
    .from(suppliers)
    .where(
      and(
        eq(suppliers.companyId, tenant.company.id),
        options.includeInactive ? undefined : eq(suppliers.isActive, true),
        pattern
          ? or(ilike(suppliers.name, pattern), ilike(suppliers.code, pattern), ilike(suppliers.phone, pattern))
          : undefined,
      ),
    )
    .orderBy(asc(suppliers.name));
}

export async function getSupplier(conn: DbOrTx, tenant: TenantContext, supplierId: string) {
  const [supplier] = await conn
    .select(supplierFields)
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.companyId, tenant.company.id)))
    .limit(1);
  if (!supplier) throw notFound("Ta'minotchi topilmadi");

  const [stats] = await conn
    .select({
      orderCount: sql<number>`count(*)::int`,
      openOrders: sql<number>`(count(*) filter (where ${purchaseOrders.status} in ('confirmed', 'partial')))::int`,
    })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.companyId, tenant.company.id), eq(purchaseOrders.supplierId, supplierId)));
  return { ...supplier, ...stats! };
}

export async function createSupplier(tx: Tx, tenant: TenantContext, input: SupplierInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const currency = await resolveCurrency(tx, companyId, input.currency);

  const [supplier] = await tx
    .insert(suppliers)
    .values({ ...input, currency, companyId })
    .returning(supplierFields);

  await purchaseAudit(tx, tenant, meta, {
    action: "SUPPLIER_CREATED",
    resource: "suppliers",
    resourceId: supplier!.id,
    details: { code: supplier!.code, name: supplier!.name },
  });
  return supplier!;
}

export async function updateSupplier(
  tx: Tx,
  tenant: TenantContext,
  supplierId: string,
  patch: Partial<Omit<SupplierInput, "code">> & { isActive?: boolean },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const [current] = await tx
    .select(supplierFields)
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!current) throw notFound("Ta'minotchi topilmadi");

  if (patch.currency) await resolveCurrency(tx, companyId, patch.currency);
  if (current.isActive && patch.isActive === false && toMinor(current.totalDebt) !== 0n) {
    throw conflict("Ta'minotchi bilan hisob-kitob yopilmagan — qarz nolga teng bo'lishi kerak");
  }

  const [updated] = await tx
    .update(suppliers)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(suppliers.id, supplierId))
    .returning(supplierFields);

  await purchaseAudit(tx, tenant, meta, {
    action: "SUPPLIER_UPDATED",
    resource: "suppliers",
    resourceId: supplierId,
    details: { changes: Object.keys(patch) },
  });
  return updated!;
}
