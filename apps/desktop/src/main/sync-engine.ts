/**
 * Sinxron: avval offline navbat serverga (push), keyin serverdagi o'zgarishlar (pull).
 *
 *  - Bir vaqtda bitta sinxron (takroriy chaqiruv o'sha jarayonni kutadi).
 *  - Pull har siklda kursorlarni `CURSOR_REWIND_MS` orqaga surib boshlanadi — kechikib commit bo'lgan tranzaksiyalar
 *    o'tkazib yuborilmaydi; saqlangan kursor esa hech qachon orqaga ketmaydi (`laterCursor`).
 *  - Aloqa yo'q — holat `offline`, navbat saqlanadi; 401 — qurilma o'chirilgan (`unauthorized`).
 */
import type { PosConfig, PullCursor, PullCursors, PullEntity, SyncStatus, WireOperation } from "../shared/sync-types.js";
import { PULL_ENTITIES } from "../shared/sync-types.js";
import { ApiError, OfflineError, type ApiClient } from "./api-client.js";
import type { LocalStore, OutboxOp } from "./local-store.js";

export const CURSOR_REWIND_MS = 120_000;
const PUSH_BATCH = 50;
const MAX_PULL_ROUNDS = 1000;
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

/** ISO vaqtni mikrosekund aniqligida (6 xona) — server kursori bilan leksikografik taqqoslanadi. */
const microIso = (ms: number) => new Date(ms).toISOString().replace(/\.(\d{3})Z$/, ".$1000Z");

export function rewindCursors(cursors: PullCursors, ms = CURSOR_REWIND_MS): PullCursors {
  const rewound: PullCursors = {};
  for (const [entity, cursor] of Object.entries(cursors) as [PullEntity, PullCursor][]) {
    const at = Date.parse(cursor.t);
    rewound[entity] = Number.isNaN(at) ? cursor : { t: microIso(at - ms), id: ZERO_UUID };
  }
  return rewound;
}

export type SyncReport = {
  pushed: { applied: number; rejected: number };
  pulled: Partial<Record<PullEntity, number>>;
  status: SyncStatus;
};

const toWire = (op: OutboxOp): WireOperation => ({ opId: op.opId, type: op.type, cashierId: op.cashierId, createdAt: op.createdAt, payload: op.payload });

export class SyncEngine {
  private running: Promise<SyncReport> | null = null;
  /** Sinxron ketayotganda navbatga yangi amal tushdi — tugagach yana bir sikl. */
  private dirty = false;
  private state: SyncStatus["state"] = "idle";
  private lastError: string | null = null;

  constructor(
    private readonly store: LocalStore,
    private readonly api: Pick<ApiClient, "pull" | "push">,
    private readonly onStatus: (status: SyncStatus) => void = () => undefined,
  ) {}

  status(): SyncStatus {
    const counts = this.store.counts();
    return {
      state: this.state,
      lastSyncAt: this.store.getMeta<string>("lastSyncAt"),
      pending: counts.pending,
      rejected: counts.rejected,
      lastError: this.lastError,
    };
  }

  /** Bir vaqtda bitta sikl: ketayotgan bo'lsa — o'sha natija. */
  sync(): Promise<SyncReport> {
    this.running ??= this.run().finally(() => {
      this.running = null;
      if (this.dirty) {
        this.dirty = false;
        void this.sync();
      }
    });
    return this.running;
  }

  /**
   * Yangi amal navbatga tushganda: sinxron ketmayotgan bo'lsa — darhol, ketayotgan bo'lsa — tugagach yana bir sikl
   * (aks holda amal keyingi davriy sinxrongacha kutib qolardi: joriy sikl navbatni allaqachon o'qib bo'lgan).
   */
  schedule(): void {
    if (this.running) this.dirty = true;
    else void this.sync();
  }

  /** Qo'lda sinxron: ketayotgan sikl tugashini kutib, yangisini boshlaydi (internet endi qaytgan bo'lishi mumkin). */
  async syncFresh(): Promise<SyncReport> {
    if (this.running) await this.running;
    return this.sync();
  }

  private emit(state: SyncStatus["state"], error: string | null = null) {
    this.state = state;
    this.lastError = error;
    this.onStatus(this.status());
  }

  private async run(): Promise<SyncReport> {
    this.emit("syncing");
    const pushed = { applied: 0, rejected: 0 };
    const pulled: Partial<Record<PullEntity, number>> = {};
    try {
      Object.assign(pushed, await this.pushPending());
      Object.assign(pulled, await this.pullAll());
      this.store.setMeta("lastSyncAt", new Date().toISOString());
      this.emit("idle");
    } catch (error) {
      if (error instanceof OfflineError) this.emit("offline", error.message);
      else if (error instanceof ApiError && error.status === 401) this.emit("unauthorized", error.message);
      else this.emit("error", error instanceof Error ? error.message : String(error));
    }
    return { pushed, pulled, status: this.status() };
  }

  async pushPending(): Promise<{ applied: number; rejected: number }> {
    const totals = { applied: 0, rejected: 0 };
    for (;;) {
      const ops = this.store.pendingOps(PUSH_BATCH);
      if (ops.length === 0) break;
      const { results } = await this.api.push(ops.map(toWire));
      const marked = this.store.markPushResults(ops, results);
      totals.applied += marked.applied;
      totals.rejected += marked.rejected;
      // Server bu to'plam bo'yicha javob bermagan amallar keyingi siklda (cheksiz aylanmasin)
      if (marked.applied + marked.rejected < ops.length) break;
    }
    return totals;
  }

  async pullAll(): Promise<Partial<Record<PullEntity, number>>> {
    const totals: Partial<Record<PullEntity, number>> = {};
    let cursors = rewindCursors(this.store.getCursors());
    for (let round = 0; round < MAX_PULL_ROUNDS; round++) {
      const response = await this.api.pull(cursors, undefined, this.store.getMeta<PosConfig>("config")?.hash);
      const counts = this.store.applyPull(response);
      for (const entity of PULL_ENTITIES) totals[entity] = (totals[entity] ?? 0) + counts[entity];
      if (!response.more) break;
      const next: PullCursors = { ...cursors };
      for (const entity of PULL_ENTITIES) {
        const cursor = response.entities[entity]?.cursor;
        if (cursor) next[entity] = cursor;
      }
      cursors = next;
    }
    return totals;
  }
}
