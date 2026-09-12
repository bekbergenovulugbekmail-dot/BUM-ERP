/**
 * Lokal ma'lumotlar ombori: serverdan kelgan o'zgarishlarni saqlash (upsert), kursorlar, offline navbat (outbox),
 * kassir PIN'lari va qidiruv. Hammasi sinxron (`node:sqlite`), yozishlar tranzaksiyada.
 */
import { randomUUID } from "node:crypto";
import type {
  CashierRecord,
  PullCursor,
  PullCursors,
  PullEntity,
  PullResponse,
  PushResult,
  SyncOperationType,
  WireOperation,
} from "../shared/sync-types.js";
import { PULL_ENTITIES } from "../shared/sync-types.js";
import { toMinor } from "../shared/money.js";
import { transaction, type LocalDb } from "./local-db.js";

/** Chek/qaytarishning zaxiraga ta'siri (asosiy birlikda, ishorali). */
export type StockDelta = { productId: string; quantity: string };

export type OutboxError = { code: string; message: string; details?: unknown };

/** Lokal hujjat (chek yoki qaytarish) va uning navbatdagi holati. */
export type StoredDocument<T> = {
  doc: T;
  opId: string;
  state: "pending" | "applied" | "rejected" | "discarded";
  error: OutboxError | null;
  result: Record<string, unknown> | null;
};

type DocumentRow = { data: string; op_id: string; discarded_at: string | null; status: string | null; error: string | null; result: string | null };

type Param = string | number | null;

export type OutboxOp = WireOperation & {
  seq: number;
  status: "pending" | "applied" | "rejected";
  attempts: number;
  result: Record<string, unknown> | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type OutboxRow = {
  seq: number;
  op_id: string;
  type: SyncOperationType;
  cashier_id: string;
  payload: string;
  created_at: string;
  status: OutboxOp["status"];
  result: string | null;
  error: string | null;
  attempts: number;
};

const toOp = (row: OutboxRow): OutboxOp => ({
  seq: row.seq,
  opId: row.op_id,
  type: row.type,
  cashierId: row.cashier_id,
  payload: JSON.parse(row.payload) as Record<string, unknown>,
  createdAt: row.created_at,
  status: row.status,
  attempts: row.attempts,
  result: row.result ? (JSON.parse(row.result) as Record<string, unknown>) : null,
  error: row.error ? (JSON.parse(row.error) as OutboxOp["error"]) : null,
});

/** (t, id) juftligi bo'yicha kattarog'i — kursor hech qachon orqaga ketmasin. */
export function laterCursor(a: PullCursor | undefined, b: PullCursor | null | undefined): PullCursor | undefined {
  if (!b) return a;
  if (!a) return b;
  if (b.t !== a.t) return b.t > a.t ? b : a;
  return b.id > a.id ? b : a;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");
const searchText = (...parts: unknown[]) => parts.map(text).join(" ").toLowerCase();

export class LocalStore {
  constructor(readonly db: LocalDb) {}

  // ─── Sozlamalar ──────────────────────────────────────────────────────────

  getMeta<T>(key: string): T | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : null;
  }

  setMeta(key: string, value: unknown): void {
    this.db
      .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
      .run(key, JSON.stringify(value));
  }

  deleteMeta(key: string): void {
    this.db.prepare("DELETE FROM meta WHERE key = ?").run(key);
  }

  getCursors(): PullCursors {
    return this.getMeta<PullCursors>("cursors") ?? {};
  }

  // ─── Serverdan kelgan o'zgarishlar ──────────────────────────────────────

  /** Sahifadagi qatorlarni upsert qiladi va kursorlarni oldinga suradi (orqaga emas). Qaytaradi: tur bo'yicha qatorlar soni. */
  applyPull(response: PullResponse): Record<PullEntity, number> {
    return transaction(this.db, () => {
      const counts = {} as Record<PullEntity, number>;
      const cursors = this.getCursors();
      for (const entity of PULL_ENTITIES) {
        const page = response.entities[entity];
        counts[entity] = page?.rows.length ?? 0;
        if (!page) continue;
        for (const row of page.rows) this.upsert(entity, row);
        const next = laterCursor(cursors[entity], page.cursor);
        if (next) cursors[entity] = next;
      }
      this.setMeta("cursors", cursors);
      this.setMeta("company", response.company);
      this.setMeta("device", response.device);
      this.setMeta("serverTime", response.serverTime);
      if (response.config) this.setMeta("config", response.config);
      return counts;
    });
  }

  private upsert(entity: PullEntity, row: Record<string, unknown>): void {
    const data = JSON.stringify(row);
    switch (entity) {
      case "products":
        this.db
          .prepare(
            `INSERT INTO products (id, name, sku, barcode, search, is_active, is_saleable, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET name = excluded.name, sku = excluded.sku, barcode = excluded.barcode, search = excluded.search,
               is_active = excluded.is_active, is_saleable = excluded.is_saleable, data = excluded.data`,
          )
          .run(
            text(row.id),
            text(row.name),
            text(row.sku),
            typeof row.barcode === "string" ? row.barcode : null,
            searchText(row.name, row.sku, row.barcode),
            row.isActive ? 1 : 0,
            row.isSaleable ? 1 : 0,
            data,
          );
        return;
      case "customers":
        this.db
          .prepare(
            `INSERT INTO customers (id, name, phone_digits, search, is_active, data) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET name = excluded.name, phone_digits = excluded.phone_digits, search = excluded.search,
               is_active = excluded.is_active, data = excluded.data`,
          )
          .run(text(row.id), text(row.name), text(row.phone).replace(/\D/g, "") || null, searchText(row.name, row.code, row.phone), row.isActive ? 1 : 0, data);
        return;
      case "stockLevels":
        this.db
          .prepare(
            `INSERT INTO stock_levels (product_id, quantity, data) VALUES (?, ?, ?)
             ON CONFLICT (product_id) DO UPDATE SET quantity = excluded.quantity, data = excluded.data`,
          )
          .run(text(row.productId), text(row.quantity) || "0", data);
        return;
      case "cashiers":
        this.putRecord("cashiers", text(row.userId), data);
        return;
      default:
        this.putRecord(entity, text(row.id), data);
    }
  }

  private putRecord(entity: string, id: string, data: string): void {
    this.db
      .prepare("INSERT INTO records (entity, id, data) VALUES (?, ?, ?) ON CONFLICT (entity, id) DO UPDATE SET data = excluded.data")
      .run(entity, id, data);
  }

  records<T>(entity: string): T[] {
    const rows = this.db.prepare("SELECT data FROM records WHERE entity = ? ORDER BY id").all(entity) as { data: string }[];
    return rows.map((row) => JSON.parse(row.data) as T);
  }

  cashiers(): CashierRecord[] {
    return this.records<CashierRecord>("cashiers").sort((a, b) => (a.name ?? a.phone).localeCompare(b.name ?? b.phone));
  }

  cashier(userId: string): CashierRecord | null {
    const row = this.db.prepare("SELECT data FROM records WHERE entity = 'cashiers' AND id = ?").get(userId) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as CashierRecord) : null;
  }

  /** Kassir birinchi onlayn kirishida kelgan profil (keyingi pull'gacha ham ro'yxatda bo'lsin). */
  saveCashier(cashier: CashierRecord): void {
    this.putRecord("cashiers", cashier.userId, JSON.stringify(cashier));
  }

  searchProducts(query: string, limit = 50): Record<string, unknown>[] {
    const needle = query.trim().toLowerCase();
    const rows = (
      needle
        ? this.db
            .prepare(
              `SELECT data FROM products WHERE is_active = 1 AND is_saleable = 1 AND (barcode = ? OR sku = ? OR search LIKE ?)
               ORDER BY CASE WHEN barcode = ? OR sku = ? THEN 0 ELSE 1 END, name LIMIT ?`,
            )
            .all(query.trim(), query.trim(), `%${needle.replace(/[%_]/g, "")}%`, query.trim(), query.trim(), limit)
        : this.db.prepare("SELECT data FROM products WHERE is_active = 1 AND is_saleable = 1 ORDER BY name LIMIT ?").all(limit)
    ) as { data: string }[];
    return rows.map((row) => JSON.parse(row.data) as Record<string, unknown>);
  }

  counts(): { products: number; customers: number; cashiers: number; pending: number; rejected: number } {
    const count = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n;
    return {
      products: count("SELECT count(*) AS n FROM products"),
      customers: count("SELECT count(*) AS n FROM customers"),
      cashiers: count("SELECT count(*) AS n FROM records WHERE entity = 'cashiers'"),
      pending: count("SELECT count(*) AS n FROM outbox WHERE status = 'pending'"),
      rejected: count("SELECT count(*) AS n FROM outbox WHERE status = 'rejected'"),
    };
  }

  // ─── Offline navbat ─────────────────────────────────────────────────────

  enqueue(input: { type: SyncOperationType; cashierId: string; payload: Record<string, unknown> }, now = new Date()): OutboxOp {
    const opId = randomUUID();
    this.db
      .prepare("INSERT INTO outbox (op_id, type, cashier_id, payload, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(opId, input.type, input.cashierId, JSON.stringify(input.payload), now.toISOString());
    return this.operation(opId)!;
  }

  operation(opId: string): OutboxOp | null {
    const row = this.db.prepare("SELECT * FROM outbox WHERE op_id = ?").get(opId) as OutboxRow | undefined;
    return row ? toOp(row) : null;
  }

  pendingOps(limit: number): OutboxOp[] {
    return (this.db.prepare("SELECT * FROM outbox WHERE status = 'pending' ORDER BY seq LIMIT ?").all(limit) as OutboxRow[]).map(toOp);
  }

  rejectedOps(limit = 200): OutboxOp[] {
    return (this.db.prepare("SELECT * FROM outbox WHERE status = 'rejected' ORDER BY seq DESC LIMIT ?").all(limit) as OutboxRow[]).map(toOp);
  }

  /** Server javobi: bajarilgan/rad etilganlar yakunlanadi; javobsiz qolganlar navbatda qoladi. */
  markPushResults(sent: OutboxOp[], results: PushResult[], now = new Date()): { applied: number; rejected: number } {
    return transaction(this.db, () => {
      let applied = 0;
      let rejected = 0;
      const byId = new Map(results.filter((result) => result.opId).map((result) => [result.opId!, result]));
      for (const op of sent) {
        const result = byId.get(op.opId);
        if (!result) {
          this.db.prepare("UPDATE outbox SET attempts = attempts + 1, last_attempt_at = ? WHERE op_id = ?").run(now.toISOString(), op.opId);
          continue;
        }
        const status = result.status === "applied" ? "applied" : "rejected";
        if (status === "applied") applied += 1;
        else rejected += 1;
        // Bajarilgan — server qoldig'i keyingi pull'da keladi; rad etilgan — zaxira serverda o'zgarmagan
        this.db.prepare("DELETE FROM stock_pending WHERE op_id = ?").run(op.opId);
        this.db
          .prepare("UPDATE outbox SET status = ?, result = ?, error = ?, attempts = attempts + 1, last_attempt_at = ? WHERE op_id = ?")
          .run(status, result.result ? JSON.stringify(result.result) : null, result.error ? JSON.stringify(result.error) : null, now.toISOString(), op.opId);
      }
      return { applied, rejected };
    });
  }

  inTransaction<T>(fn: () => T): T {
    return transaction(this.db, fn);
  }

  // ─── Katalog va mijozlar ────────────────────────────────────────────────

  private dataRow<T>(sql: string, ...params: Param[]): T | null {
    const row = this.db.prepare(sql).get(...params) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as T) : null;
  }

  product<T = Record<string, unknown>>(id: string): T | null {
    return this.dataRow<T>("SELECT data FROM products WHERE id = ?", id);
  }

  /** Skaner: shtrix-kod yoki SKU aniq mos, sotiladigan faol mahsulot. */
  productByCode<T = Record<string, unknown>>(code: string): T | null {
    const needle = code.trim();
    if (!needle) return null;
    return this.dataRow<T>(
      "SELECT data FROM products WHERE is_active = 1 AND is_saleable = 1 AND (barcode = ? OR sku = ?) ORDER BY CASE WHEN barcode = ? THEN 0 ELSE 1 END LIMIT 1",
      needle,
      needle,
      needle,
    );
  }

  /** Ko'rinadigan qoldiq (4 kasr, butun sonda): server qoldig'i + sinxron bo'lmagan hujjatlar ta'siri. */
  stockMap(productIds: string[]): Map<string, bigint> {
    const result = new Map<string, bigint>();
    const ids = [...new Set(productIds)];
    if (ids.length === 0) return result;
    const placeholders = ids.map(() => "?").join(", ");
    const add = (rows: { product_id: string; quantity: string }[]) => {
      for (const row of rows) result.set(row.product_id, (result.get(row.product_id) ?? 0n) + toMinor(row.quantity, 4));
    };
    add(this.db.prepare(`SELECT product_id, quantity FROM stock_levels WHERE product_id IN (${placeholders})`).all(...ids) as { product_id: string; quantity: string }[]);
    add(this.db.prepare(`SELECT product_id, quantity FROM stock_pending WHERE product_id IN (${placeholders})`).all(...ids) as { product_id: string; quantity: string }[]);
    return result;
  }

  customer<T = Record<string, unknown>>(id: string): T | null {
    return this.dataRow<T>("SELECT data FROM customers WHERE id = ?", id);
  }

  searchCustomers<T = Record<string, unknown>>(query: string, limit = 30): T[] {
    const needle = query.trim().toLowerCase();
    const digits = query.replace(/\D/g, "");
    let rows: { data: string }[];
    if (!needle) {
      rows = this.db.prepare("SELECT data FROM customers WHERE is_active = 1 ORDER BY name LIMIT ?").all(limit) as { data: string }[];
    } else if (digits.length >= 3) {
      rows = this.db
        .prepare("SELECT data FROM customers WHERE is_active = 1 AND (search LIKE ? OR phone_digits LIKE ?) ORDER BY name LIMIT ?")
        .all(`%${needle.replace(/[%_]/g, "")}%`, `%${digits}%`, limit) as { data: string }[];
    } else {
      rows = this.db
        .prepare("SELECT data FROM customers WHERE is_active = 1 AND search LIKE ? ORDER BY name LIMIT ?")
        .all(`%${needle.replace(/[%_]/g, "")}%`, limit) as { data: string }[];
    }
    return rows.map((row) => JSON.parse(row.data) as T);
  }

  /** Kassada yaratilgan yoki qurilmada o'zgargan (balans, qarz) mijoz — keyingi pull server qiymati bilan almashtiradi. */
  saveCustomer(row: Record<string, unknown>): void {
    this.upsert("customers", row);
  }

  pendingCustomerIds(): Set<string> {
    const rows = this.db.prepare("SELECT payload FROM outbox WHERE type = 'customer.create' AND status = 'pending'").all() as { payload: string }[];
    return new Set(rows.map((row) => String((JSON.parse(row.payload) as { customerId?: string }).customerId ?? "")));
  }

  // ─── Cheklar va qaytarishlar ────────────────────────────────────────────

  /** Hujjat raqami ketma-ketligi (tranzaksiya ichida chaqiriladi). */
  nextSequence(key: string): number {
    const next = (this.getMeta<number>(`seq:${key}`) ?? 0) + 1;
    this.setMeta(`seq:${key}`, next);
    return next;
  }

  private addPendingStock(opId: string, deltas: StockDelta[]): void {
    const statement = this.db.prepare(
      "INSERT INTO stock_pending (op_id, product_id, quantity) VALUES (?, ?, ?) ON CONFLICT (op_id, product_id) DO UPDATE SET quantity = excluded.quantity",
    );
    for (const delta of deltas) {
      if (toMinor(delta.quantity, 4) !== 0n) statement.run(opId, delta.productId, delta.quantity);
    }
  }

  insertSale(input: {
    id: string;
    number: string;
    opId: string;
    shiftId: string;
    cashierId: string;
    customerId: string | null;
    total: string;
    createdAt: string;
    doc: unknown;
    stockDeltas: StockDelta[];
  }): void {
    this.db
      .prepare("INSERT INTO sales (id, number, op_id, shift_id, cashier_id, customer_id, total, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        input.id,
        input.number,
        input.opId,
        input.shiftId,
        input.cashierId,
        input.customerId,
        input.total,
        input.createdAt,
        JSON.stringify({ doc: input.doc, stockDeltas: input.stockDeltas }),
      );
    this.addPendingStock(input.opId, input.stockDeltas);
  }

  insertReturn(input: {
    id: string;
    number: string;
    opId: string;
    orderId: string;
    shiftId: string;
    cashierId: string;
    total: string;
    createdAt: string;
    doc: unknown;
    stockDeltas: StockDelta[];
  }): void {
    this.db
      .prepare("INSERT INTO sale_returns (id, number, op_id, order_id, shift_id, cashier_id, total, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        input.id,
        input.number,
        input.opId,
        input.orderId,
        input.shiftId,
        input.cashierId,
        input.total,
        input.createdAt,
        JSON.stringify({ doc: input.doc, stockDeltas: input.stockDeltas }),
      );
    this.addPendingStock(input.opId, input.stockDeltas);
  }

  private documents<T>(table: "sales" | "sale_returns", where: string, params: Param[], limit: number): StoredDocument<T>[] {
    const rows = this.db
      .prepare(
        `SELECT d.data, d.op_id, d.discarded_at, o.status, o.error, o.result FROM ${table} d LEFT JOIN outbox o ON o.op_id = d.op_id
         ${where} ORDER BY d.created_at DESC LIMIT ?`,
      )
      .all(...params, limit) as DocumentRow[];
    return rows.map((row) => ({
      doc: (JSON.parse(row.data) as { doc: T }).doc,
      opId: row.op_id,
      state: row.discarded_at ? "discarded" : ((row.status as StoredDocument<T>["state"] | null) ?? "applied"),
      error: row.error ? (JSON.parse(row.error) as OutboxError) : null,
      result: row.result ? (JSON.parse(row.result) as Record<string, unknown>) : null,
    }));
  }

  sales<T>(options: { limit: number; shiftId?: string }): StoredDocument<T>[] {
    return options.shiftId
      ? this.documents<T>("sales", "WHERE d.shift_id = ?", [options.shiftId], options.limit)
      : this.documents<T>("sales", "", [], options.limit);
  }

  saleById<T>(id: string): StoredDocument<T> | null {
    return this.documents<T>("sales", "WHERE d.id = ?", [id], 1)[0] ?? null;
  }

  saleByNumber<T>(number: string): StoredDocument<T> | null {
    return this.documents<T>("sales", "WHERE d.number = ?", [number], 1)[0] ?? null;
  }

  returns<T>(options: { limit: number; shiftId?: string }): StoredDocument<T>[] {
    return options.shiftId
      ? this.documents<T>("sale_returns", "WHERE d.shift_id = ?", [options.shiftId], options.limit)
      : this.documents<T>("sale_returns", "", [], options.limit);
  }

  /** Chek bo'yicha qurilmadagi (bekor qilinmagan) qaytarishlar. */
  returnsForOrder<T>(orderId: string): StoredDocument<T>[] {
    return this.documents<T>("sale_returns", "WHERE d.order_id = ? AND d.discarded_at IS NULL", [orderId], 1000);
  }

  // ─── Kechiktirilgan cheklar ─────────────────────────────────────────────

  holdReceipt(input: { id: string; cashierId: string; label: string; total: string; createdAt: string; data: unknown }): void {
    this.db
      .prepare("INSERT INTO held_receipts (id, cashier_id, label, total, created_at, data) VALUES (?, ?, ?, ?, ?, ?)")
      .run(input.id, input.cashierId, input.label, input.total, input.createdAt, JSON.stringify(input.data));
  }

  heldReceipts<T>(): { id: string; cashierId: string; label: string; total: string; createdAt: string; data: T }[] {
    const rows = this.db.prepare("SELECT * FROM held_receipts ORDER BY created_at").all() as {
      id: string;
      cashier_id: string;
      label: string;
      total: string;
      created_at: string;
      data: string;
    }[];
    return rows.map((row) => ({ id: row.id, cashierId: row.cashier_id, label: row.label, total: row.total, createdAt: row.created_at, data: JSON.parse(row.data) as T }));
  }

  deleteHeld(id: string): boolean {
    return this.db.prepare("DELETE FROM held_receipts WHERE id = ?").run(id).changes > 0;
  }

  // ─── Sinxron bo'lmagan amallar ──────────────────────────────────────────

  unsyncedOps(): (OutboxOp & { number: string | null; total: string | null })[] {
    const rows = this.db
      .prepare(
        `SELECT o.*, COALESCE(s.number, r.number) AS doc_number, COALESCE(s.total, r.total) AS doc_total
         FROM outbox o LEFT JOIN sales s ON s.op_id = o.op_id LEFT JOIN sale_returns r ON r.op_id = o.op_id
         WHERE o.status IN ('pending', 'rejected') ORDER BY o.seq`,
      )
      .all() as (OutboxRow & { doc_number: string | null; doc_total: string | null })[];
    return rows.map((row) => ({ ...toOp(row), number: row.doc_number, total: row.doc_total }));
  }

  private documentDeltas(opId: string): StockDelta[] {
    const row = this.db
      .prepare("SELECT data FROM sales WHERE op_id = ? AND discarded_at IS NULL UNION ALL SELECT data FROM sale_returns WHERE op_id = ? AND discarded_at IS NULL")
      .get(opId, opId) as { data: string } | undefined;
    return row ? ((JSON.parse(row.data) as { stockDeltas?: StockDelta[] }).stockDeltas ?? []) : [];
  }

  /** Rad etilgan amalni qayta navbatga qo'yish (masalan, rahbar serverda sababni tuzatgach). */
  retryOp(opId: string): boolean {
    return transaction(this.db, () => {
      const changed = this.db.prepare("UPDATE outbox SET status = 'pending', error = NULL, result = NULL WHERE op_id = ? AND status = 'rejected'").run(opId).changes;
      if (changed === 0) return false;
      this.addPendingStock(opId, this.documentDeltas(opId));
      return true;
    });
  }

  /** Rad etilgan amalni bekor qilish: navbatdan olinadi, lokal hujjat "bekor qilingan" bo'lib qoladi. */
  discardOp(opId: string, now = new Date()): boolean {
    return transaction(this.db, () => {
      const op = this.operation(opId);
      if (!op || op.status !== "rejected") return false;
      this.db.prepare("DELETE FROM stock_pending WHERE op_id = ?").run(opId);
      this.db.prepare("UPDATE sales SET discarded_at = ? WHERE op_id = ?").run(now.toISOString(), opId);
      this.db.prepare("UPDATE sale_returns SET discarded_at = ? WHERE op_id = ?").run(now.toISOString(), opId);
      this.db.prepare("DELETE FROM outbox WHERE op_id = ?").run(opId);
      return true;
    });
  }

  // ─── Kassir PIN'i ───────────────────────────────────────────────────────

  pinState(userId: string): { hash: string; failedAttempts: number; lockedUntil: string | null } | null {
    const row = this.db.prepare("SELECT pin_hash, failed_attempts, locked_until FROM cashier_pins WHERE user_id = ?").get(userId) as
      | { pin_hash: string; failed_attempts: number; locked_until: string | null }
      | undefined;
    return row ? { hash: row.pin_hash, failedAttempts: row.failed_attempts, lockedUntil: row.locked_until } : null;
  }

  setPinHash(userId: string, hash: string, now = new Date()): void {
    this.db
      .prepare(
        `INSERT INTO cashier_pins (user_id, pin_hash, failed_attempts, locked_until, updated_at) VALUES (?, ?, 0, NULL, ?)
         ON CONFLICT (user_id) DO UPDATE SET pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = NULL, updated_at = excluded.updated_at`,
      )
      .run(userId, hash, now.toISOString());
  }

  recordPinAttempt(userId: string, success: boolean, lockAfter: number, lockMs: number, now = new Date()): void {
    if (success) {
      this.db.prepare("UPDATE cashier_pins SET failed_attempts = 0, locked_until = NULL WHERE user_id = ?").run(userId);
      return;
    }
    const state = this.pinState(userId);
    if (!state) return;
    const failed = state.failedAttempts + 1;
    const lockedUntil = failed >= lockAfter ? new Date(now.getTime() + lockMs).toISOString() : state.lockedUntil;
    this.db
      .prepare("UPDATE cashier_pins SET failed_attempts = ?, locked_until = ? WHERE user_id = ?")
      .run(failed >= lockAfter ? 0 : failed, lockedUntil, userId);
  }
}
