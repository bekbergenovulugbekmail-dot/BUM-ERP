/**
 * Hujjat raqamlari: EXP-2026-0001, JE-2026-00001 va h.k.
 *
 * Convex'da oxirgi hujjat + 1 edi — ikki parallel so'rov bir xil raqam olardi.
 * Bu yerda kompaniya + prefiks bo'yicha tranzaksiya darajasidagi advisory lock:
 * ikkinchi so'rov birinchisi tugashini kutadi. Unique indeks — ikkinchi qatlam.
 */
import { and, eq, like, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Tx } from "../db/transaction.js";

export async function nextDocumentNumber(
  tx: Tx,
  options: {
    table: PgTable;
    column: PgColumn;
    companyColumn: PgColumn;
    companyId: string;
    prefix: string;
    width: number;
  },
): Promise<string> {
  const { table, column, companyColumn, companyId, prefix, width } = options;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${companyId}:${prefix}`}))`);

  // Satr bo'yicha max emas: "10000" < "9999" bo'lib qoladi
  const start = prefix.length + 1;
  const [row] = await tx
    .select({ last: sql<string | null>`max(substring(${column} from ${start}::int)::bigint)` })
    .from(table)
    .where(
      and(
        eq(companyColumn, companyId),
        like(column, `${prefix}%`),
        sql`substring(${column} from ${start}::int) ~ '^[0-9]+$'`,
      ),
    );

  const next = BigInt(row?.last ?? "0") + 1n;
  return `${prefix}${next.toString().padStart(width, "0")}`;
}
