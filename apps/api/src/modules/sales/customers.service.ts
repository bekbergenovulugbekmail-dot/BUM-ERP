/**
 * Mijozlar (convex/sales/customers.ts).
 *
 * Convex'dan farqlar:
 *  - kod "oxirgi + 1" edi — parallel yaratishda takrorlanardi (advisory lock, `C-0001`)
 *  - `list` / `getById` ruxsat tekshirmasdi — `sales.view`; `update` to'xtatilgan kompaniyada ham yozardi
 *  - kredit limiti saqlanardi, lekin hech qayerda tekshirilmasdi — endi jo'natish va POS nasiyasida
 *  - valyuta erkin edi — faqat kompaniya valyutasi; qarzi bor mijozni faolsizlantirib bo'lmaydi
 */
import { and, asc, desc, eq, getTableColumns, ilike, or } from "drizzle-orm";
import { badRequest, conflict, notFound } from "@bum/shared";
import { customerPayments, customers, salesOrders } from "../../db/schema/sales.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { toMinor } from "../../shared/decimal.js";
import { nextDocumentNumber } from "../../shared/numbering.js";
import type { TenantContext } from "../company/tenant.js";
import { companyCurrency } from "../finance/accounts.service.js";

const { legacyId: _legacyId, companyId: _companyId, ...customerFields } = getTableColumns(customers);

export function salesAudit(
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

export type CustomerInput = {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  taxId?: string | null;
  discountPercent?: string;
  creditLimit?: string;
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

export async function listCustomers(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { search?: string; includeInactive?: boolean; limit: number },
) {
  const pattern = options.search ? `%${options.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  return conn
    .select(customerFields)
    .from(customers)
    .where(
      and(
        eq(customers.companyId, tenant.company.id),
        options.includeInactive ? undefined : eq(customers.isActive, true),
        pattern
          ? or(ilike(customers.name, pattern), ilike(customers.code, pattern), ilike(customers.phone, pattern))
          : undefined,
      ),
    )
    .orderBy(asc(customers.name))
    .limit(options.limit);
}

export async function getCustomer(conn: DbOrTx, tenant: TenantContext, customerId: string) {
  const companyId = tenant.company.id;
  const [customer] = await conn
    .select(customerFields)
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)))
    .limit(1);
  if (!customer) throw notFound("Mijoz topilmadi");

  const orders = await conn
    .select({
      id: salesOrders.id,
      number: salesOrders.number,
      status: salesOrders.status,
      orderDate: salesOrders.orderDate,
      totalAmount: salesOrders.totalAmount,
      paidAmount: salesOrders.paidAmount,
      isPos: salesOrders.isPos,
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.companyId, companyId), eq(salesOrders.customerId, customerId)))
    .orderBy(desc(salesOrders.orderDate), desc(salesOrders.id))
    .limit(20);

  const payments = await conn
    .select({
      id: customerPayments.id,
      orderId: customerPayments.orderId,
      amount: customerPayments.amount,
      method: customerPayments.method,
      paymentDate: customerPayments.paymentDate,
    })
    .from(customerPayments)
    .where(and(eq(customerPayments.companyId, companyId), eq(customerPayments.customerId, customerId)))
    .orderBy(desc(customerPayments.paymentDate), desc(customerPayments.createdAt))
    .limit(20);

  return { ...customer, orders, payments };
}

export async function createCustomer(tx: Tx, tenant: TenantContext, input: CustomerInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const currency = await resolveCurrency(tx, companyId, input.currency);
  const code = await nextDocumentNumber(tx, {
    table: customers,
    column: customers.code,
    companyColumn: customers.companyId,
    companyId,
    prefix: "C-",
    width: 4,
  });

  const [customer] = await tx
    .insert(customers)
    .values({ ...input, code, currency, companyId })
    .returning(customerFields);

  await salesAudit(tx, tenant, meta, {
    action: "CUSTOMER_CREATED",
    resource: "customers",
    resourceId: customer!.id,
    details: { code, name: customer!.name },
  });
  return customer!;
}

export async function updateCustomer(
  tx: Tx,
  tenant: TenantContext,
  customerId: string,
  patch: Partial<CustomerInput> & { isActive?: boolean },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const [current] = await tx
    .select(customerFields)
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!current) throw notFound("Mijoz topilmadi");

  if (patch.currency) await resolveCurrency(tx, companyId, patch.currency);
  if (current.isActive && patch.isActive === false && toMinor(current.totalDebt) !== 0n) {
    throw conflict("Mijoz bilan hisob-kitob yopilmagan — qarz nolga teng bo'lishi kerak");
  }

  const [updated] = await tx
    .update(customers)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(customers.id, customerId))
    .returning(customerFields);

  await salesAudit(tx, tenant, meta, {
    action: "CUSTOMER_UPDATED",
    resource: "customers",
    resourceId: customerId,
    details: { changes: Object.keys(patch) },
  });
  return updated!;
}
