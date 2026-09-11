/**
 * Ta'minotchi qarzi valyuta bo'yicha (`supplier_balances`).
 *
 * `debt` — ta'minotchi valyutasidagi qarz, `bookValue` — shu qarzning asosiy valyutadagi kitob qiymati
 * (kreditorlar hisobida qanday turgan bo'lsa). Asosiy valyutada ikkalasi teng. `suppliers.total_debt` —
 * barcha valyutalar kitob qiymatlari yig'indisi (kreditorlar bilan bir xil).
 * Valyutadagi qarz to'liq yopilganda kitob qiymatida qolgan farq — kurs farqi (4200 daromad / 5700 xarajat).
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { supplierBalances, suppliers } from "../../db/schema/purchase.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import { ensureAccountBySubtype, postJournalEntry, requireAccountBySubtype } from "../finance/journal.service.js";

/** Qator bo'lmasa yaratiladi; tranzaksiya oxirigacha qulflanadi. */
export async function lockSupplierBalance(tx: Tx, companyId: string, supplierId: string, currency: string) {
  await tx.insert(supplierBalances).values({ companyId, supplierId, currency }).onConflictDoNothing();
  const [row] = await tx
    .select({ id: supplierBalances.id, debt: supplierBalances.debt, bookValue: supplierBalances.bookValue })
    .from(supplierBalances)
    .where(and(eq(supplierBalances.supplierId, supplierId), eq(supplierBalances.currency, currency)))
    .limit(1)
    .for("update");
  return row!;
}

/**
 * Qarz va kitob qiymatini o'zgartiradi, `suppliers.total_debt` ni kitob qiymati bo'yicha yangilaydi.
 * Qarz nolga tushib, kitob qiymatida qoldiq qolsa — kurs farqi jurnali bilan yopiladi.
 */
export async function applySupplierBalance(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    supplierId: string;
    currency: string;
    debtDelta: bigint;
    bookDelta: bigint;
    date: string;
    description: string;
  },
) {
  const row = await lockSupplierBalance(tx, input.companyId, input.supplierId, input.currency);
  const debt = toMinor(row.debt) + input.debtDelta;
  let book = toMinor(row.bookValue) + input.bookDelta;
  let totalDebtDelta = input.bookDelta;
  let fxSettled = 0n;

  if (debt === 0n && book !== 0n) {
    const amount = fromMinor(book > 0n ? book : -book);
    const payable = await requireAccountBySubtype(tx, input.companyId, "payable", "liability", "Kreditorlar");
    // Kitobda qarz ko'p qolgan — kurs farqi daromadi; kam (manfiy) — xarajati
    const lines =
      book > 0n
        ? [
            { accountId: payable, debit: amount },
            { accountId: await ensureAccountBySubtype(tx, input.companyId, "fx_gain"), credit: amount },
          ]
        : [
            { accountId: await ensureAccountBySubtype(tx, input.companyId, "fx_loss"), debit: amount },
            { accountId: payable, credit: amount },
          ];
    await postJournalEntry(tx, input.companyId, input.userId, {
      entryDate: input.date,
      description: `Kurs farqi (${input.currency}): ${input.description}`,
      referenceType: "supplier_fx",
      referenceId: randomUUID(),
      lines,
    });
    fxSettled = book;
    totalDebtDelta -= book;
    book = 0n;
  }

  await tx
    .update(supplierBalances)
    .set({ debt: fromMinor(debt), bookValue: fromMinor(book), updatedAt: new Date() })
    .where(eq(supplierBalances.id, row.id));
  if (totalDebtDelta !== 0n) {
    await tx
      .update(suppliers)
      .set({ totalDebt: sql`${suppliers.totalDebt} + ${fromMinor(totalDebtDelta)}::numeric`, updatedAt: new Date() })
      .where(eq(suppliers.id, input.supplierId));
  }
  return { debt, book, fxSettled };
}

export type SupplierCurrencyDebt = { currency: string; debt: string };

/** Nol bo'lmagan qarzlar, valyuta bo'yicha. */
export async function supplierDebtsByCurrency(conn: DbOrTx, companyId: string, supplierIds: string[]) {
  const result = new Map<string, SupplierCurrencyDebt[]>();
  if (supplierIds.length === 0) return result;
  const rows = await conn
    .select({ supplierId: supplierBalances.supplierId, currency: supplierBalances.currency, debt: supplierBalances.debt })
    .from(supplierBalances)
    .where(
      and(
        eq(supplierBalances.companyId, companyId),
        inArray(supplierBalances.supplierId, supplierIds),
        ne(supplierBalances.debt, "0"),
      ),
    )
    .orderBy(asc(supplierBalances.currency));
  for (const row of rows) {
    const list = result.get(row.supplierId) ?? [];
    list.push({ currency: row.currency, debt: row.debt });
    result.set(row.supplierId, list);
  }
  return result;
}
