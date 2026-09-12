/**
 * Kassada offline tahrirlangan ma'lumotnoma (mijoz, ta'minotchi, mahsulot narxlari) — maydonlar bo'yicha birlashtirish.
 *
 * Qurilma har o'zgargan maydon uchun o'zi ko'rgan qiymat (`from`) va yangisini (`to`) yuboradi. Server:
 *  - joriy qiymat allaqachon `to` ga teng — hech narsa qilinmaydi;
 *  - joriy qiymat hali `from` ga teng — `to` yoziladi (oddiy xizmat funksiyasi orqali: tekshiruv va audit bilan);
 *  - aks holda (orada web'da yoki boshqa kassada o'zgargan) — server qiymati qoladi, `record_changed` nomuvofiqligi.
 * `updated_at` bu yerda yaroqsiz: mijoz qarzi yoki qoldiq o'zgarishi ham uni yangilaydi.
 */
import { and, eq } from "drizzle-orm";
import { badRequest, notFound } from "@bum/shared";
import { products } from "../../db/schema/catalog.js";
import { companyCurrencies } from "../../db/schema/finance.js";
import { suppliers } from "../../db/schema/purchase.js";
import { customers } from "../../db/schema/sales.js";
import type { Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { toMinor } from "../../shared/decimal.js";
import { updateProduct } from "../catalog/products.service.js";
import type { TenantContext } from "../company/tenant.js";
import { setCurrencyRate } from "../finance/currencies.service.js";
import { updateSupplier } from "../purchase/suppliers.service.js";
import { updateCustomer } from "../sales/customers.service.js";
import type { SaleConflict } from "../sales/pos.service.js";

export type FieldChange = { from: string | null; to: string | null };
type Kind = "text" | "phone" | "money" | "date";

export const CUSTOMER_CHANGE_FIELDS = ["name", "phone", "email", "address", "taxId", "partyType", "contactName", "bankAccount", "bankMfo", "notes"] as const;
export const SUPPLIER_CHANGE_FIELDS = ["name", "phone", "email", "address", "taxId", "partyType", "contactPerson", "bankAccount", "bankMfo", "notes"] as const;
export const PRICE_CHANGE_FIELDS = ["salesPrice", "wholesalePrice", "retailPrice", "promoPrice", "promoPriceEnd", "purchasePrice"] as const;

const kindOf = (field: string): Kind =>
  field === "phone" ? "phone" : field === "promoPriceEnd" ? "date" : field.endsWith("Price") ? "money" : "text";

/** Taqqoslash uchun: bo'sh — null; telefon — faqat raqamlar; narx — 4 kasrli butun son. */
function normalized(value: unknown, kind: Kind): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (text === "") return null;
  if (kind === "phone") return text.replace(/\D/g, "");
  if (kind === "money") return toMinor(text, 4).toString();
  return text;
}

export type SkippedField = { field: string; base: string | null; device: string | null; server: string | null };

function mergeFields(current: Record<string, unknown>, changes: Partial<Record<string, FieldChange>>) {
  const patch: Record<string, string | null> = {};
  const skipped: SkippedField[] = [];
  for (const [field, change] of Object.entries(changes)) {
    if (!change) continue;
    const kind = kindOf(field);
    const server = normalized(current[field], kind);
    if (server === normalized(change.to, kind)) continue;
    if (server === normalized(change.from, kind)) patch[field] = change.to;
    else skipped.push({ field, base: change.from, device: change.to, server: current[field] == null ? null : String(current[field]) });
  }
  return { patch, skipped };
}

function mergeResult(entity: string, id: string, patch: Record<string, unknown>, skipped: SkippedField[]) {
  const conflicts: SaleConflict[] = skipped.length > 0 ? [{ kind: "record_changed", details: { entity, id, fields: skipped } }] : [];
  return { applied: Object.keys(patch), skipped: skipped.map((item) => item.field), conflicts };
}

export async function mergeCustomerChanges(tx: Tx, tenant: TenantContext, customerId: string, changes: Partial<Record<string, FieldChange>>, meta: RequestMeta) {
  const [current] = await tx
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.companyId, tenant.company.id)))
    .limit(1)
    .for("update");
  if (!current) throw notFound("Mijoz topilmadi");
  const { patch, skipped } = mergeFields(current, changes);
  if ("name" in patch && !patch.name) throw badRequest("Mijoz nomi bo'sh bo'lmasin");
  if (Object.keys(patch).length > 0) await updateCustomer(tx, tenant, customerId, patch as Parameters<typeof updateCustomer>[3], meta);
  return mergeResult("customer", customerId, patch, skipped);
}

export async function mergeSupplierChanges(tx: Tx, tenant: TenantContext, supplierId: string, changes: Partial<Record<string, FieldChange>>, meta: RequestMeta) {
  const [current] = await tx
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.companyId, tenant.company.id)))
    .limit(1)
    .for("update");
  if (!current) throw notFound("Ta'minotchi topilmadi");
  const { patch, skipped } = mergeFields(current, changes);
  if ("name" in patch && !patch.name) throw badRequest("Ta'minotchi nomi bo'sh bo'lmasin");
  if (Object.keys(patch).length > 0) await updateSupplier(tx, tenant, supplierId, patch as Parameters<typeof updateSupplier>[3], meta);
  return mergeResult("supplier", supplierId, patch, skipped);
}

/**
 * Kassada (offline ham) o'zgartirilgan valyuta kursi: server kursi allaqachon `to` — hech narsa; hali `from` — `to`
 * yoziladi (tarix va audit qurilma bilan); aks holda server kursi qoladi va `record_changed`.
 */
export async function mergeCurrencyRate(tx: Tx, tenant: TenantContext, input: { code: string; from: string; to: string; deviceId: string }, meta: RequestMeta) {
  const [current] = await tx
    .select({ id: companyCurrencies.id, rate: companyCurrencies.rate })
    .from(companyCurrencies)
    .where(and(eq(companyCurrencies.companyId, tenant.company.id), eq(companyCurrencies.code, input.code)))
    .limit(1);
  if (!current) throw notFound(`${input.code} valyutasi topilmadi`);
  const server = toMinor(current.rate, 4);
  if (server === toMinor(input.to, 4)) return { id: current.id, applied: false, conflicts: [] as SaleConflict[] };
  if (server !== toMinor(input.from, 4)) {
    const conflicts: SaleConflict[] = [
      { kind: "record_changed", details: { entity: "currency", id: input.code, fields: [{ field: "rate", base: input.from, device: input.to, server: current.rate }] } },
    ];
    return { id: current.id, applied: false, conflicts };
  }
  await setCurrencyRate(tx, tenant, { code: input.code, rate: input.to, deviceId: input.deviceId }, meta);
  return { id: current.id, applied: true, conflicts: [] as SaleConflict[] };
}

export async function mergeProductPrices(tx: Tx, tenant: TenantContext, productId: string, changes: Partial<Record<string, FieldChange>>, meta: RequestMeta) {
  const [current] = await tx
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.companyId, tenant.company.id)))
    .limit(1)
    .for("update");
  if (!current) throw notFound("Mahsulot topilmadi");
  const { patch, skipped } = mergeFields(current, changes);
  for (const required of ["salesPrice", "purchasePrice"]) {
    if (required in patch && patch[required] == null) throw badRequest("Sotuv va xarid narxi bo'sh bo'lmasin");
  }
  if (Object.keys(patch).length > 0) await updateProduct(tx, tenant, productId, patch as Parameters<typeof updateProduct>[3], meta);
  return mergeResult("product", productId, patch, skipped);
}
