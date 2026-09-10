/**
 * Tranzaksiya chegarasi.
 *
 * Convexda har bir mutation avtomatik atomar edi. PostgreSQLda buni aniq
 * belgilash kerak — audit §9 da sanab o'tilgan 9 ta operatsiya SHART
 * bitta tranzaksiya ichida bajarilishi kerak.
 *
 * Qoida: tranzaksiyani CONTROLLER ochadi, service qatlami tayyor `tx` ni
 * qabul qiladi. Shunda ichma-ich chaqiruvlar bitta tranzaksiyada qoladi
 * va tasodifan ikkinchi tranzaksiya ochilmaydi.
 */
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import { db, schema } from "./client.js";

export type Tx = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/** Servis metodlari shu tipni qabul qiladi — tranzaksiya ham, oddiy db ham. */
export type DbOrTx = Tx | typeof db;

export function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

/**
 * Zaxira qatorini yangilashdan oldin qulflash.
 *
 * Bir vaqtda ikki sotuv bir mahsulotni yechsa, ikkalasi ham eski qoldiqni
 * o'qib, noto'g'ri natija yozishi mumkin (lost update). SELECT ... FOR UPDATE
 * buni oldini oladi.
 */
export const FOR_UPDATE = " FOR UPDATE" as const;
