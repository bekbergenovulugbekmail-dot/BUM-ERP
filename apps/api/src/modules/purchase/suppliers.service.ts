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
import { randomUUID } from "node:crypto";
import { and, asc, eq, getTableColumns, ilike, or, sql } from "drizzle-orm";
import { badRequest, conflict, notFound } from "@bum/shared";
import { purchaseOrders, suppliers } from "../../db/schema/purchase.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import { nextDocumentNumber } from "../../shared/numbering.js";
import { applySupplierBalance, supplierDebtsByCurrency } from "./supplier-balances.service.js";
import type { TenantContext } from "../company/tenant.js";
import { companyCurrency } from "../finance/accounts.service.js";
import { assertPeriodOpen, postJournalEntry, requireAccountBySubtype } from "../finance/journal.service.js";

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
  /** Faqat desktop kassa sinxroni: qurilmada yaratilgan ta'minotchi ID'si (offline xaridlar shunga bog'langan). */
  id?: string;
  name: string;
  /** Berilmasa — avtomatik (S-0001). */
  code?: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  taxId?: string | null;
  partyType?: "individual" | "legal";
  bankAccount?: string | null;
  bankMfo?: string | null;
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
  const rows = await conn
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
  // Qarz valyuta bo'yicha (asosiy valyutadagi `totalDebt` — kitob qiymati)
  const debts = await supplierDebtsByCurrency(conn, tenant.company.id, rows.map((row) => row.id));
  return rows.map((row) => ({ ...row, balances: debts.get(row.id) ?? [] }));
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
  const debts = await supplierDebtsByCurrency(conn, tenant.company.id, [supplierId]);
  return { ...supplier, ...stats!, balances: debts.get(supplierId) ?? [] };
}

export async function createSupplier(tx: Tx, tenant: TenantContext, input: SupplierInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const currency = await resolveCurrency(tx, companyId, input.currency);
  const code =
    input.code ??
    (await nextDocumentNumber(tx, {
      table: suppliers,
      column: suppliers.code,
      companyColumn: suppliers.companyId,
      companyId,
      prefix: "S-",
      width: 4,
    }));

  const [supplier] = await tx
    .insert(suppliers)
    .values({ ...input, code, currency, companyId })
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

/**
 * Ta'minotchi qarzini to'g'rilash: qarz noto'g'ri bo'lsa to'g'ri qiymatga o'rnatiladi (faqat asosiy valyutada).
 * Farq jurnalda "Boshqa xarajatlar" (qarz oshsa) yoki "Boshqa daromadlar" (kamaysa) bilan kreditorlarga yoziladi;
 * valyuta bo'yicha qoldiq va `total_debt` — `applySupplierBalance` orqali. Sabab majburiy, audit jurnaliga tushadi;
 * yopilgan davrga tuzatish kiritilmaydi.
 */
export async function setSupplierDebt(
  tx: Tx,
  tenant: TenantContext,
  supplierId: string,
  input: { totalDebt: string; reason: string; date?: string },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const reason = input.reason.trim();
  if (reason.length < 3) throw badRequest("To'g'rilash sababi ko'rsatilishi kerak");
  const target = toMinor(input.totalDebt);
  if (target < 0n) throw badRequest("Qarz manfiy bo'lmaydi — ortiqcha to'lov avans bo'lib yuritiladi");

  const date = input.date ?? new Date().toISOString().slice(0, 10);
  await assertPeriodOpen(tx, companyId, date);
  const [current] = await tx
    .select(supplierFields)
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!current) throw notFound("Ta'minotchi topilmadi");

  const currency = await companyCurrency(tx, companyId);
  if (current.currency !== currency) {
    throw badRequest(`To'g'rilash faqat asosiy valyutadagi (${currency}) ta'minotchida`);
  }
  const delta = target - toMinor(current.totalDebt);
  if (delta === 0n) return { supplier: current, delta: "0.00" };

  const amount = fromMinor(delta > 0n ? delta : -delta);
  const payable = await requireAccountBySubtype(tx, companyId, "payable", "liability", "Kreditorlar");
  await postJournalEntry(tx, companyId, tenant.user.id, {
    party: { type: "supplier", id: supplierId },
    entryDate: date,
    description: `Ta'minotchi qarzi to'g'rilandi: ${current.name} — ${reason}`,
    referenceType: "supplier_debt_adjustment",
    referenceId: randomUUID(),
    lines:
      delta > 0n
        ? [
            { accountId: await requireAccountBySubtype(tx, companyId, "other", "expense", "Boshqa xarajatlar"), debit: amount },
            { accountId: payable, credit: amount },
          ]
        : [
            { accountId: payable, debit: amount },
            { accountId: await requireAccountBySubtype(tx, companyId, "other", "income", "Boshqa daromadlar"), credit: amount },
          ],
  });
  // Asosiy valyutada qarz va kitob qiymati teng — `total_debt` shu yerda yangilanadi
  await applySupplierBalance(tx, {
    companyId,
    userId: tenant.user.id,
    supplierId,
    currency,
    debtDelta: delta,
    bookDelta: delta,
    date,
    description: `Qarz to'g'rilandi — ${reason}`,
  });

  await purchaseAudit(tx, tenant, meta, {
    action: "SUPPLIER_DEBT_ADJUSTED",
    resource: "suppliers",
    resourceId: supplierId,
    details: { reason, before: current.totalDebt, after: fromMinor(target), delta: fromMinor(delta) },
  });
  const [fresh] = await tx.select(supplierFields).from(suppliers).where(eq(suppliers.id, supplierId));
  return { supplier: fresh!, delta: fromMinor(delta) };
}
