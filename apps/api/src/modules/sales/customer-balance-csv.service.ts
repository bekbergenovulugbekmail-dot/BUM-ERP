/**
 * MIJOZ BALANSINI IMPORT QILISH (2.6-vazifa).
 *
 * MUHIM: import `customers.balance` ustuniga TO'G'RIDAN-TO'G'RI yozmaydi. Har qator
 * TUZATMA (adjustment) tranzaksiyasi bo'lib kiritiladi — tarix qatori, balanslangan jurnal
 * yozuvi va audit bilan. Shuning uchun:
 *  - boshlang'ich qoldiq DAROMAD deb hisoblanmaydi (sotuvga tushmaydi),
 *  - keyin nima bo'lganini tarixdan ko'rish mumkin,
 *  - takroriy import qo'shimcha pul yaratmaydi (quyida "dublikat" qarang).
 *
 * Mijoz TOPILMASA — xato (yangi mijoz yaratilmaydi): balans faylida yozuv xatosi bo'lsa
 * tasodifan mijoz ochilib ketmasligi kerak.
 *
 * Dublikat: bitta faylda bir mijoz ikki marta bo'lsa ikkinchisi o'tkazib yuboriladi.
 * Takroriy YUKLASHdan himoya: `setCustomerBalances` balansni MAQSAD qiymatga keltiradi
 * (delta bilan), shuning uchun o'sha faylni qayta yuklash balansni o'zgartirmaydi — farq nol
 * bo'lgani uchun yangi tranzaksiya ham yaratilmaydi.
 */
import { and, eq } from "drizzle-orm";
import { customers } from "../../db/schema/sales.js";
import type { Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { normalizePhone, type ImportError, type ImportOutcome } from "../../shared/csv.js";
import type { TenantContext } from "../company/tenant.js";
import { setCustomerBalances } from "./customer-balance.service.js";

export type BalanceImportRow = {
  /** Mijoz nomi — telefon bo'lmasa shu bo'yicha topiladi. */
  name?: string | null;
  phone?: string | null;
  code?: string | null;
  balance: string;
  reason?: string | null;
};

/** Faylda kutiladigan ustunlar (namuna yuklab olish uchun ham ishlatiladi). */
export const BALANCE_CSV_HEADER = ["Mijoz", "Telefon", "Kod", "Balans", "Sabab"] as const;

const DEFAULT_REASON = "Boshlang'ich qoldiq (import)";

/** Nomni taqqoslash shakli — ortiqcha bo'shliq va registr farq qilmasin. */
const foldName = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

export async function importCustomerBalances(
  tx: Tx,
  tenant: TenantContext,
  rows: BalanceImportRow[],
  meta: RequestMeta,
  options: { dryRun?: boolean } = {},
): Promise<ImportOutcome & { matched: number }> {
  const dryRun = options.dryRun === true;
  const companyId = tenant.company.id;

  const existing = await tx
    .select({ id: customers.id, name: customers.name, phone: customers.phone, code: customers.code })
    .from(customers)
    .where(eq(customers.companyId, companyId));

  const idByPhone = new Map<string, string>();
  const idByCode = new Map<string, string>();
  const idByName = new Map<string, string>();
  for (const row of existing) {
    const phone = normalizePhone(row.phone);
    if (phone && !idByPhone.has(phone)) idByPhone.set(phone, row.id);
    if (row.code && !idByCode.has(row.code.toLowerCase())) idByCode.set(row.code.toLowerCase(), row.id);
    const name = foldName(row.name);
    if (!idByName.has(name)) idByName.set(name, row.id);
  }

  const errors: ImportError[] = [];
  const duplicates: ImportError[] = [];
  const warnings: ImportError[] = [];
  const seen = new Set<string>();
  let applied = 0;
  let matched = 0;

  for (const [index, row] of rows.entries()) {
    // CSV sarlavhasi 1-qator, shuning uchun ma'lumot 2-qatordan boshlanadi
    const line = index + 2;

    // Xato xabarida qaysi qator ekanini ko'rsatuvchi kalit
    const key = row.code?.trim() || row.phone?.trim() || row.name?.trim() || null;

    const amount = Number(String(row.balance ?? "").replace(",", ".").trim());
    if (!Number.isFinite(amount)) {
      errors.push({ row: line, key, message: "Balans son bo'lishi kerak" });
      continue;
    }
    if (amount < 0) {
      errors.push({ row: line, key, message: "Balans manfiy bo'lmaydi — qarz alohida yuritiladi" });
      continue;
    }

    // Mijozni topish: kod → telefon → nom (aniqroq kalitdan boshlanadi)
    const phone = normalizePhone(row.phone);
    const code = row.code?.trim().toLowerCase();
    const name = row.name ? foldName(row.name) : null;
    const customerId =
      (code ? idByCode.get(code) : undefined) ??
      (phone ? idByPhone.get(phone) : undefined) ??
      (name ? idByName.get(name) : undefined);

    if (!customerId) {
      errors.push({ row: line, key, message: `Mijoz topilmadi: ${key ?? "—"}` });
      continue;
    }
    if (seen.has(customerId)) {
      duplicates.push({ row: line, key, message: "Bu mijoz faylda takrorlangan" });
      continue;
    }
    seen.add(customerId);
    matched += 1;

    if (dryRun) {
      applied += 1;
      continue;
    }

    try {
      // Balans TUZATMA sifatida kiritiladi: jurnal va tarix bilan, daromadga tushmaydi
      await setCustomerBalances(
        tx,
        tenant,
        { customerId, balance: amount.toFixed(2), reason: row.reason?.trim() || DEFAULT_REASON },
        meta,
      );
      applied += 1;
    } catch (error) {
      errors.push({ row: line, key, message: error instanceof Error ? error.message : "Saqlab bo'lmadi" });
    }
  }

  return {
    created: applied,
    valid: applied,
    matched,
    errors,
    duplicates,
    warnings,
    dryRun,
  };
}

/** Mijoz shu kompaniyanikimi — bitta qator uchun tekshiruv (begona ID qabul qilinmaydi). */
export async function customerBelongsToCompany(tx: Tx, companyId: string, customerId: string) {
  const [row] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)))
    .limit(1);
  return Boolean(row);
}
