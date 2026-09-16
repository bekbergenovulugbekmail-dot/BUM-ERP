/**
 * Mijozlarni CSV orqali eksport va import qilish.
 *
 * Eksportda qarz, balans va keshbek ham chiqadi — lekin import ularni O'ZGARTIRMAYDI: pul qiymatlari faqat hujjat
 * (to'lov, sotuv) yoki "Balansni to'g'rilash" (`/customers/:customerId/balance-adjust`) orqali o'zgaradi. Import
 * faqat yangi mijoz ochadi: har qator alohida tekshiriladi, xato qator `errors` ga tushadi va qolganlari yoziladi.
 */
import { and, asc, eq } from "drizzle-orm";
import { customers } from "../../db/schema/sales.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import {
  MAX_EXPORT_ROWS,
  cleanNumber,
  csvDocument,
  normalizePhone,
  optionalText,
  type ImportError,
  type ImportOutcome,
} from "../../shared/csv.js";
import type { TenantContext } from "../company/tenant.js";
import { createCustomer } from "./customers.service.js";

const CSV_HEADER = [
  "Nomi",
  "Kod",
  "Turi",
  "Telefon",
  "Email",
  "Manzil",
  "Mas'ul shaxs",
  "STIR",
  "Hisob raqami",
  "MFO",
  "Shahar/tuman",
  "Mahalla",
  "Chegirma %",
  "Kredit limiti",
  "To'lov muddati (kun)",
  "Qarz",
  "Balans",
  "Keshbek",
  "Izoh",
  "Faol",
];

export async function exportCustomersCsv(conn: DbOrTx, tenant: TenantContext, options: { includeInactive?: boolean } = {}) {
  const rows = await conn
    .select({
      name: customers.name,
      code: customers.code,
      partyType: customers.partyType,
      phone: customers.phone,
      email: customers.email,
      address: customers.address,
      contactName: customers.contactName,
      taxId: customers.taxId,
      bankAccount: customers.bankAccount,
      bankMfo: customers.bankMfo,
      city: customers.city,
      district: customers.district,
      discountPercent: customers.discountPercent,
      creditLimit: customers.creditLimit,
      paymentTermDays: customers.paymentTermDays,
      totalDebt: customers.totalDebt,
      balance: customers.balance,
      cashbackBalance: customers.cashbackBalance,
      notes: customers.notes,
      isActive: customers.isActive,
    })
    .from(customers)
    .where(and(eq(customers.companyId, tenant.company.id), options.includeInactive ? undefined : eq(customers.isActive, true)))
    .orderBy(asc(customers.name), asc(customers.id))
    .limit(MAX_EXPORT_ROWS);

  return csvDocument(
    CSV_HEADER,
    rows.map((row) => [
      row.name,
      row.code,
      row.partyType === "legal" ? "Yuridik shaxs" : "Jismoniy shaxs",
      row.phone,
      row.email,
      row.address,
      row.contactName,
      row.taxId,
      row.bankAccount,
      row.bankMfo,
      row.city,
      row.district,
      row.discountPercent,
      row.creditLimit,
      row.paymentTermDays,
      row.totalDebt,
      row.balance,
      row.cashbackBalance,
      row.notes,
      row.isActive ? "ha" : "yo'q",
    ]),
  );
}

export type CustomerImportRow = {
  name?: string;
  partyType?: string;
  phone?: string;
  email?: string;
  address?: string;
  contactName?: string;
  taxId?: string;
  bankAccount?: string;
  bankMfo?: string;
  city?: string;
  district?: string;
  discountPercent?: string;
  creditLimit?: string;
  paymentTermDays?: string;
};

/** "Yuridik shaxs", "legal", "yuridik" → legal; qolgani — jismoniy. */
function partyTypeOf(value: string | undefined): "individual" | "legal" {
  const text = (value ?? "").trim().toLowerCase();
  return text.startsWith("yuridik") || text === "legal" ? "legal" : "individual";
}

export async function importCustomers(
  tx: Tx,
  tenant: TenantContext,
  rows: CustomerImportRow[],
  meta: RequestMeta,
  options: { dryRun?: boolean } = {},
): Promise<ImportOutcome> {
  const dryRun = options.dryRun === true;
  // Dublikat kaliti — telefon raqami (kompaniya ichida): bazadagilar va fayl ichidagilar
  const takenPhones = new Set(
    (await tx.select({ phone: customers.phone }).from(customers).where(eq(customers.companyId, tenant.company.id)))
      .map((row) => normalizePhone(row.phone))
      .filter((phone): phone is string => Boolean(phone)),
  );
  const errors: ImportError[] = [];
  const duplicates: ImportError[] = [];
  const warnings: ImportError[] = [];
  let created = 0;
  let valid = 0;

  for (const [index, row] of rows.entries()) {
    const line = index + 1;
    const name = row.name?.trim() ?? "";
    const fail = (message: string) => errors.push({ row: line, key: name || null, message });

    if (!name) {
      fail("Nomi majburiy");
      continue;
    }
    if (name.length > 200) {
      fail("Nomi juda uzun (200 belgidan ko'p)");
      continue;
    }

    const discount = Number(cleanNumber(row.discountPercent));
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
      fail("Chegirma 0 va 100 orasida bo'lishi kerak");
      continue;
    }
    const creditLimit = Number(cleanNumber(row.creditLimit));
    if (!Number.isFinite(creditLimit) || creditLimit < 0) {
      fail("Kredit limiti noto'g'ri son");
      continue;
    }
    const termDays = Number(cleanNumber(row.paymentTermDays));
    if (!Number.isInteger(termDays) || termDays < 0 || termDays > 3650) {
      fail("To'lov muddati 0–3650 kun oralig'ida butun son bo'lishi kerak");
      continue;
    }

    // CREATE ONLY: bir xil telefonli mijoz bo'lsa yangi yozuv ochilmaydi (keyinchalik UPDATE rejimi qo'shilishi mumkin)
    const phone = normalizePhone(row.phone);
    if (phone && takenPhones.has(phone)) {
      duplicates.push({ row: line, key: name, message: `Bu telefon bilan mijoz allaqachon bor: ${row.phone?.trim() ?? ""}` });
      continue;
    }
    if (phone) takenPhones.add(phone);

    valid += 1;
    if (dryRun) continue;
    await createCustomer(
      tx,
      tenant,
      {
        name,
        partyType: partyTypeOf(row.partyType),
        phone: optionalText(row.phone, 20),
        email: optionalText(row.email, 255),
        address: optionalText(row.address, 1000),
        contactName: optionalText(row.contactName, 200),
        taxId: optionalText(row.taxId, 32),
        bankAccount: optionalText(row.bankAccount, 64),
        bankMfo: optionalText(row.bankMfo, 16),
        city: optionalText(row.city, 100),
        district: optionalText(row.district, 100),
        discountPercent: cleanNumber(row.discountPercent),
        creditLimit: cleanNumber(row.creditLimit),
        paymentTermDays: termDays,
      },
      meta,
    );
    created += 1;
  }

  return { created, valid, errors, duplicates, warnings, dryRun };
}
