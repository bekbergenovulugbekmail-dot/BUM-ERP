/**
 * Ta'minotchilarni CSV orqali eksport va import qilish.
 *
 * Eksportda qarz va jami xarid ham chiqadi, lekin import ularni O'ZGARTIRMAYDI: pul qiymatlari faqat hujjat (qabul,
 * to'lov) yoki "Qarzni to'g'rilash" (`/suppliers/:supplierId/set-debt`) orqali o'zgaradi. Import faqat yangi
 * ta'minotchi ochadi; har qator alohida tekshiriladi va xato qator `errors` ga tushadi.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { suppliers } from "../../db/schema/purchase.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import {
  MAX_EXPORT_ROWS,
  cleanNumber,
  csvDocument,
  normalizeKey,
  optionalText,
  type ImportError,
  type ImportOutcome,
} from "../../shared/csv.js";
import type { TenantContext } from "../company/tenant.js";
import { createSupplier } from "./suppliers.service.js";

const CSV_HEADER = [
  "Nomi",
  "Kod",
  "Turi",
  "Mas'ul shaxs",
  "Telefon",
  "Email",
  "Manzil",
  "STIR",
  "Hisob raqami",
  "MFO",
  "To'lov muddati (kun)",
  "Valyuta",
  "Qarz",
  "Jami xarid",
  "Izoh",
  "Faol",
];

export async function exportSuppliersCsv(conn: DbOrTx, tenant: TenantContext, options: { includeInactive?: boolean } = {}) {
  const rows = await conn
    .select({
      name: suppliers.name,
      code: suppliers.code,
      partyType: suppliers.partyType,
      contactPerson: suppliers.contactPerson,
      phone: suppliers.phone,
      email: suppliers.email,
      address: suppliers.address,
      taxId: suppliers.taxId,
      bankAccount: suppliers.bankAccount,
      bankMfo: suppliers.bankMfo,
      paymentTermDays: suppliers.paymentTermDays,
      currency: suppliers.currency,
      totalDebt: suppliers.totalDebt,
      totalPurchased: suppliers.totalPurchased,
      notes: suppliers.notes,
      isActive: suppliers.isActive,
    })
    .from(suppliers)
    .where(and(eq(suppliers.companyId, tenant.company.id), options.includeInactive ? undefined : eq(suppliers.isActive, true)))
    .orderBy(asc(suppliers.name), asc(suppliers.id))
    .limit(MAX_EXPORT_ROWS);

  return csvDocument(
    CSV_HEADER,
    rows.map((row) => [
      row.name,
      row.code,
      row.partyType === "individual" ? "Jismoniy shaxs" : "Yuridik shaxs",
      row.contactPerson,
      row.phone,
      row.email,
      row.address,
      row.taxId,
      row.bankAccount,
      row.bankMfo,
      row.paymentTermDays,
      row.currency,
      row.totalDebt,
      row.totalPurchased,
      row.notes,
      row.isActive ? "ha" : "yo'q",
    ]),
  );
}

export type SupplierImportRow = {
  name?: string;
  code?: string;
  partyType?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  taxId?: string;
  bankAccount?: string;
  bankMfo?: string;
  paymentTermDays?: string;
};

/** "Jismoniy shaxs", "individual" → individual; qolgani — yuridik (ta'minotchida standart). */
function partyTypeOf(value: string | undefined): "individual" | "legal" {
  const text = (value ?? "").trim().toLowerCase();
  return text.startsWith("jismoniy") || text === "individual" ? "individual" : "legal";
}

export async function importSuppliers(
  tx: Tx,
  tenant: TenantContext,
  rows: SupplierImportRow[],
  meta: RequestMeta,
  options: { dryRun?: boolean } = {},
): Promise<ImportOutcome> {
  const companyId = tenant.company.id;
  const dryRun = options.dryRun === true;
  // Kod noyob (kompaniya ichida): fayldagi va bazadagi kodlar oldindan tekshiriladi — INSERT xatosi tranzaksiyani
  // yiqitmasin, xato qator alohida qaytsin
  const fileCodes = [...new Set(rows.map((row) => row.code?.trim()).filter((code): code is string => Boolean(code)))];
  const taken = new Set(
    fileCodes.length === 0
      ? []
      : (
          await tx
            .select({ code: suppliers.code })
            .from(suppliers)
            .where(and(eq(suppliers.companyId, companyId), inArray(suppliers.code, fileCodes)))
        ).map((row) => row.code),
  );

  // Ikkinchi dublikat kaliti — STIR (bo'sh bo'lmasa)
  const takenTaxIds = new Set(
    (await tx.select({ taxId: suppliers.taxId }).from(suppliers).where(eq(suppliers.companyId, companyId)))
      .map((row) => normalizeKey(row.taxId))
      .filter((value): value is string => Boolean(value)),
  );
  const errors: ImportError[] = [];
  const duplicates: ImportError[] = [];
  const warnings: ImportError[] = [];
  let created = 0;
  let valid = 0;

  for (const [index, row] of rows.entries()) {
    const line = index + 1;
    const name = row.name?.trim() ?? "";
    const code = row.code?.trim() ?? "";
    const fail = (message: string) => errors.push({ row: line, key: code || name || null, message });

    if (!name) {
      fail("Nomi majburiy");
      continue;
    }
    if (name.length > 200 || code.length > 32) {
      fail("Nomi yoki kod juda uzun");
      continue;
    }
    // CREATE ONLY: takroriy kod yoki STIR — xato emas, dublikat (yangi yozuv ochilmaydi)
    if (code && taken.has(code)) {
      duplicates.push({ row: line, key: code, message: `"${code}" kodli ta'minotchi allaqachon bor` });
      continue;
    }
    const taxId = normalizeKey(row.taxId);
    if (taxId && takenTaxIds.has(taxId)) {
      duplicates.push({ row: line, key: code || name, message: `Bu STIR bilan ta'minotchi allaqachon bor: ${row.taxId?.trim() ?? ""}` });
      continue;
    }

    const termDays = Number(cleanNumber(row.paymentTermDays));
    if (!Number.isInteger(termDays) || termDays < 0 || termDays > 3650) {
      fail("To'lov muddati 0–3650 kun oralig'ida butun son bo'lishi kerak");
      continue;
    }

    valid += 1;
    // Fayl ichidagi keyingi takrorlar ham preview'da ko'rinishi uchun kalitlar shu yerda belgilanadi
    if (code) taken.add(code);
    if (taxId) takenTaxIds.add(taxId);
    if (dryRun) continue;
    await createSupplier(
      tx,
      tenant,
      {
        name,
        ...(code ? { code } : {}),
        partyType: partyTypeOf(row.partyType),
        contactPerson: optionalText(row.contactPerson, 200),
        phone: optionalText(row.phone, 20),
        email: optionalText(row.email, 255),
        address: optionalText(row.address, 1000),
        taxId: optionalText(row.taxId, 32),
        bankAccount: optionalText(row.bankAccount, 64),
        bankMfo: optionalText(row.bankMfo, 16),
        paymentTermDays: termDays,
      },
      meta,
    );
    created += 1;
  }

  return { created, valid, errors, duplicates, warnings, dryRun };
}
