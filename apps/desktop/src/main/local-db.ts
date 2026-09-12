/**
 * Lokal SQLite (Node'ning o'rnatilgan `node:sqlite` — native modul yig'ish shart emas).
 * Sxema `PRAGMA user_version` bo'yicha ketma-ket migratsiyalar bilan; har migratsiya tranzaksiyada.
 */
import { DatabaseSync } from "node:sqlite";

export type LocalDb = DatabaseSync;

const MIGRATIONS: string[] = [
  // v1 — sinxron poydevori: sozlamalar, ma'lumotnomalar, mahsulot/mijoz/qoldiq, kassir PIN'i, offline navbat
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE records (
    entity TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (entity, id)
  );

  CREATE TABLE products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sku TEXT NOT NULL,
    barcode TEXT,
    search TEXT NOT NULL,
    is_active INTEGER NOT NULL,
    is_saleable INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX products_barcode_idx ON products (barcode);
  CREATE INDEX products_sku_idx ON products (sku);

  CREATE TABLE customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone_digits TEXT,
    search TEXT NOT NULL,
    is_active INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX customers_phone_idx ON customers (phone_digits);

  CREATE TABLE stock_levels (
    product_id TEXT PRIMARY KEY,
    quantity TEXT NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE cashier_pins (
    user_id TEXT PRIMARY KEY,
    pin_hash TEXT NOT NULL,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    op_id TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    cashier_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected')),
    result TEXT,
    error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TEXT
  );
  CREATE INDEX outbox_status_idx ON outbox (status, seq);
  `,
  // v2 — kassa: lokal cheklar va qaytarishlar (chop etish, tarix), kechiktirilgan cheklar, sinxron bo'lmagan zaxira harakati
  `
  CREATE TABLE sales (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    op_id TEXT NOT NULL,
    shift_id TEXT NOT NULL,
    cashier_id TEXT NOT NULL,
    customer_id TEXT,
    total TEXT NOT NULL,
    created_at TEXT NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX sales_created_idx ON sales (created_at);
  CREATE INDEX sales_shift_idx ON sales (shift_id);

  CREATE TABLE sale_returns (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    op_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    shift_id TEXT NOT NULL,
    cashier_id TEXT NOT NULL,
    total TEXT NOT NULL,
    created_at TEXT NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX sale_returns_order_idx ON sale_returns (order_id);

  CREATE TABLE held_receipts (
    id TEXT PRIMARY KEY,
    cashier_id TEXT NOT NULL,
    label TEXT NOT NULL,
    total TEXT NOT NULL,
    created_at TEXT NOT NULL,
    data TEXT NOT NULL
  );

  -- Serverga yetib bormagan chek/qaytarish zaxira farqi (asosiy birlikda, ishorali): ko'rinadigan qoldiq = server qoldig'i + shu
  CREATE TABLE stock_pending (
    op_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity TEXT NOT NULL,
    PRIMARY KEY (op_id, product_id)
  );
  CREATE INDEX stock_pending_product_idx ON stock_pending (product_id);
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export function migrate(db: LocalDb): number {
  const { user_version: current } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let version = current; version < MIGRATIONS.length; version++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    });
  }
  return MIGRATIONS.length;
}

export function openLocalDb(file: string): LocalDb {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

/** Sinxron tranzaksiya: xato bo'lsa hammasi bekor. */
export function transaction<T>(db: LocalDb, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
