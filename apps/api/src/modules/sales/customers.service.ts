/**
 * Mijozlar (convex/sales/customers.ts).
 *
 * Convex'dan farqlar:
 *  - kod "oxirgi + 1" edi — parallel yaratishda takrorlanardi (advisory lock, `C-0001`)
 *  - `list` / `getById` ruxsat tekshirmasdi — `sales.view`; `update` to'xtatilgan kompaniyada ham yozardi
 *  - kredit limiti saqlanardi, lekin hech qayerda tekshirilmasdi — endi jo'natish va POS nasiyasida
 *  - valyuta erkin edi — faqat kompaniya valyutasi; qarzi bor mijozni faolsizlantirib bo'lmaydi
 */
import { and, asc, desc, eq, getTableColumns, ilike, or, sql } from "drizzle-orm";
import { badRequest, conflict, notFound } from "@bum/shared";
import { customerPayments, customers, salesOrders } from "../../db/schema/sales.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { toMinor } from "../../shared/decimal.js";
import { isValidCoordinate } from "../../shared/geo.js";
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
  /** Faqat desktop kassa sinxroni: qurilmada yaratilgan mijoz ID'si (offline cheklar shunga bog'langan). */
  id?: string;
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
  /** Do'kon egasi yoki mas'ul shaxs. */
  contactName?: string | null;
  /** Do'kon joylashuvi — ikkalasi birga (null — o'chirish). */
  latitude?: number | null;
  longitude?: number | null;
};

/** Koordinata juftligi: ikkalasi ham yoki hech biri; 6 xona (~10 sm). Berilmasa — o'zgarmaydi. */
function coordinateValues(input: { latitude?: number | null; longitude?: number | null }) {
  if (input.latitude === undefined && input.longitude === undefined) return {};
  const latitude = input.latitude ?? null;
  const longitude = input.longitude ?? null;
  if ((latitude === null) !== (longitude === null)) throw badRequest("Kenglik va uzunlik birga kiritiladi");
  if (latitude !== null && longitude !== null && !isValidCoordinate({ latitude, longitude })) {
    throw badRequest("Koordinata noto'g'ri");
  }
  return {
    latitude: latitude === null ? null : latitude.toFixed(6),
    longitude: longitude === null ? null : longitude.toFixed(6),
  };
}

async function resolveCurrency(conn: DbOrTx, companyId: string, requested?: string) {
  const currency = await companyCurrency(conn, companyId);
  if (requested && requested !== currency) {
    throw badRequest(`Hozircha faqat kompaniya valyutasi (${currency}) qo'llanadi`);
  }
  return currency;
}

const likePattern = (value: string) => `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Ismning har bir so'zi alohida ("ali valiyev" → "Valiyev Ali"), kod, telefon; raqamlar bo'yicha
 * telefon formatidan qat'i nazar ("90 123" → "+998901234567").
 */
function customerSearch(search: string) {
  const words = search.split(/\s+/).filter(Boolean);
  const digits = search.replace(/\D/g, "");
  return or(
    and(...words.map((word) => ilike(customers.name, likePattern(word)))),
    ilike(customers.code, likePattern(search)),
    ilike(customers.phone, likePattern(search)),
    digits.length >= 3
      ? sql`regexp_replace(coalesce(${customers.phone}, ''), '[^0-9]', '', 'g') like ${`%${digits}%`}`
      : undefined,
  );
}

export async function listCustomers(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { search?: string; includeInactive?: boolean; limit: number },
) {
  return conn
    .select(customerFields)
    .from(customers)
    .where(
      and(
        eq(customers.companyId, tenant.company.id),
        options.includeInactive ? undefined : eq(customers.isActive, true),
        options.search ? customerSearch(options.search) : undefined,
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

  const { latitude, longitude, ...fields } = input;
  const [customer] = await tx
    .insert(customers)
    .values({ ...fields, ...coordinateValues({ latitude, longitude }), code, currency, companyId })
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

  const { latitude, longitude, ...fields } = patch;
  const [updated] = await tx
    .update(customers)
    .set({ ...fields, ...coordinateValues({ latitude, longitude }), updatedAt: new Date() })
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
