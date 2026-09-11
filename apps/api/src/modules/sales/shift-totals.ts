/**
 * POS smenasining valyuta bo'yicha yig'indilari — jsonb `{ "USD": "20.00" }`.
 * Yangilash bitta SQL ifodada (qator qulflangan tranzaksiyada), summa numeric'da.
 */
import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { fromMinor } from "../../shared/decimal.js";

/** Har valyuta summasiga `amounts` dagini qo'shadi (manfiy — ayiradi); nol summalar o'tkazib yuboriladi. */
export function addCurrencyAmounts(column: PgColumn, amounts: Map<string, bigint>): SQL {
  let expression: SQL = sql`${column}`;
  for (const [currency, minor] of amounts) {
    if (minor === 0n) continue;
    expression = sql`jsonb_set(${expression}, array[${currency}]::text[], to_jsonb(((coalesce((${column} ->> ${currency})::numeric, 0) + ${fromMinor(minor)}::numeric)::numeric(18,2))::text))`;
  }
  return expression;
}
