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
import { transaction, type LocalDb } from "./local-db.js";

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
        this.db
          .prepare("UPDATE outbox SET status = ?, result = ?, error = ?, attempts = attempts + 1, last_attempt_at = ? WHERE op_id = ?")
          .run(status, result.result ? JSON.stringify(result.result) : null, result.error ? JSON.stringify(result.error) : null, now.toISOString(), op.opId);
      }
      return { applied, rejected };
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
