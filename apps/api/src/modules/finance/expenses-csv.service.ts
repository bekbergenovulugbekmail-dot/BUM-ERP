/**
 * Xarajatlarni CSV orqali eksport va import qilish.
 *
 * Import xarajatni standart "kutilmoqda" (`pending`) holatida ochadi — pul hech qayerdan yechilmaydi: kassa chiqimi va
 * jurnal yozuvi faqat xarajat "to'landi" deb tasdiqlanganda bo'ladi (`POST /expenses/:expenseId/status`).
 * Yopilgan davr (`lock-date`) bir marta o'qiladi va har qator bo'yicha tekshiriladi: shu sanadagi qator xato bo'lib
 * qaytadi va tranzaksiyani yiqitmaydi.
 */
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { expenses } from "../../db/schema/finance.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { MAX_EXPORT_ROWS, cleanNumber, csvDocument, optionalText, parseIsoDate, type ImportError } from "../../shared/csv.js";
import type { TenantContext } from "../company/tenant.js";
import { createExpense } from "./expenses.service.js";
import { getLockDate } from "./journal.service.js";

const CSV_HEADER = ["Raqam", "Sana", "Kategoriya", "Tavsif", "Summa", "Valyuta", "Holati", "To'lagan", "Izoh"];

const STATUS_LABEL: Record<string, string> = { pending: "Kutilmoqda", approved: "Tasdiqlangan", paid: "To'langan" };

export async function exportExpensesCsv(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { status?: "pending" | "approved" | "paid"; category?: string; dateFrom?: string; dateTo?: string } = {},
) {
  const rows = await conn
    .select({
      number: expenses.number,
      expenseDate: expenses.expenseDate,
      category: expenses.category,
      description: expenses.description,
      amount: expenses.amount,
      currency: expenses.currency,
      status: expenses.status,
      paidBy: expenses.paidBy,
      notes: expenses.notes,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.companyId, tenant.company.id),
        options.status ? eq(expenses.status, options.status) : undefined,
        options.category ? eq(expenses.category, options.category) : undefined,
        options.dateFrom ? gte(expenses.expenseDate, options.dateFrom) : undefined,
        options.dateTo ? lte(expenses.expenseDate, options.dateTo) : undefined,
      ),
    )
    .orderBy(desc(expenses.expenseDate), asc(expenses.number))
    .limit(MAX_EXPORT_ROWS);

  return csvDocument(
    CSV_HEADER,
    rows.map((row) => [
      row.number,
      row.expenseDate,
      row.category,
      row.description,
      row.amount,
      row.currency,
      STATUS_LABEL[row.status] ?? row.status,
      row.paidBy,
      row.notes,
    ]),
  );
}

export type ExpenseImportRow = {
  category?: string;
  description?: string;
  amount?: string;
  expenseDate?: string;
  paidBy?: string;
  notes?: string;
};

export async function importExpenses(tx: Tx, tenant: TenantContext, rows: ExpenseImportRow[], meta: RequestMeta) {
  // Davr qulfi bir marta o'qiladi — yopilgan sanadagi qator xato bo'lib qaytadi, tranzaksiya yiqilmaydi
  const lockDate = await getLockDate(tx, tenant.company.id);

  const errors: ImportError[] = [];
  let created = 0;

  for (const [index, row] of rows.entries()) {
    const line = index + 1;
    const category = row.category?.trim() ?? "";
    const description = row.description?.trim() ?? "";
    const fail = (message: string) => errors.push({ row: line, key: category || null, message });

    if (!category || category.length > 64) {
      fail("Kategoriya majburiy (64 belgigacha)");
      continue;
    }
    if (!description || description.length > 1000) {
      fail("Tavsif majburiy (1000 belgigacha)");
      continue;
    }

    const expenseDate = parseIsoDate(row.expenseDate);
    if (!expenseDate) {
      fail("Sana majburiy va YYYY-MM-DD ko'rinishida bo'lishi kerak");
      continue;
    }
    if (lockDate && expenseDate <= lockDate) {
      fail(`${lockDate} gacha bo'lgan davr yopilgan — bu sanadagi xarajat kiritilmaydi`);
      continue;
    }

    const amount = Number(cleanNumber(row.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      fail("Summa musbat son bo'lishi kerak");
      continue;
    }

    // Holati standart "pending" — pul faqat tasdiqlangandan keyin harakatlanadi
    await createExpense(
      tx,
      tenant,
      {
        category,
        description,
        amount: cleanNumber(row.amount),
        expenseDate,
        paidBy: optionalText(row.paidBy, 200),
        notes: optionalText(row.notes, 2000),
      },
      meta,
    );
    created += 1;
  }

  return { created, errors };
}
