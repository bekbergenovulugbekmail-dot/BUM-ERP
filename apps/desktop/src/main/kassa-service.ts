/**
 * Kassa ilovasining asosiy xizmati (main jarayon): qurilmani ro'yxatdan o'tkazish, kassir kirishi va PIN, sinxron,
 * smena. Renderer faqat IPC orqali shu metodlarni chaqiradi; token va lokal baza renderer'ga chiqmaydi.
 */
import { randomUUID } from "node:crypto";
import type { AppStatus, LocalShift, RejectedOperation } from "../shared/kassa-api.js";
import type { CashierRecord, CompanyInfo, DeviceInfo, SyncStatus } from "../shared/sync-types.js";
import { ApiError, createApiClient, type ApiClient } from "./api-client.js";
import type { LocalStore } from "./local-store.js";
import { PIN_PATTERN, checkPin, hashPin } from "./pin.js";
import { SyncEngine } from "./sync-engine.js";

export class KassaError extends Error {
  readonly code: string;
  readonly details: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "KassaError";
    this.code = code;
    this.details = details;
  }
}

const MONEY = /^\d{1,16}(\.\d{1,2})?$/;

export type TokenVault = { save(token: string): void; load(): string | null; clear(): void };

export class KassaService {
  private api: ApiClient | null = null;
  private engine: SyncEngine | null = null;
  private cashier: CashierRecord | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly store: LocalStore,
    private readonly vault: TokenVault,
    private readonly options: {
      appVersion: string;
      platform: string;
      fetchImpl?: typeof fetch;
      onSyncStatus?: (status: SyncStatus) => void;
    },
  ) {
    this.connect();
  }

  // ─── Holat ───────────────────────────────────────────────────────────────

  status(): AppStatus {
    const counts = this.store.counts();
    return {
      appVersion: this.options.appVersion,
      registered: this.api !== null,
      apiUrl: this.store.getMeta<string>("apiUrl"),
      device: this.store.getMeta<DeviceInfo>("device"),
      company: this.store.getMeta<CompanyInfo>("company"),
      cashier: this.cashier,
      shift: this.store.getMeta<LocalShift>("shift"),
      counts,
      sync: this.engine?.status() ?? { state: "idle", lastSyncAt: null, pending: counts.pending, rejected: counts.rejected, lastError: null },
    };
  }

  private connect() {
    const apiUrl = this.store.getMeta<string>("apiUrl");
    const token = this.vault.load();
    if (!apiUrl || !token) return;
    this.api = createApiClient({ baseUrl: apiUrl, token, appVersion: this.options.appVersion, fetchImpl: this.options.fetchImpl });
    this.engine = new SyncEngine(this.store, this.api, (status) => this.options.onSyncStatus?.(status));
  }

  /** Davriy sinxron (standart 30 soniya); ilova yopilganda `stop`. */
  start(intervalMs = 30_000) {
    this.stop();
    void this.engine?.sync();
    this.timer = setInterval(() => void this.engine?.sync(), intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ─── Ro'yxatdan o'tkazish ───────────────────────────────────────────────

  private setupClient(apiUrl: string) {
    let url: URL;
    try {
      url = new URL(apiUrl);
    } catch {
      throw new KassaError("BAD_REQUEST", "Server manzili noto'g'ri");
    }
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new KassaError("BAD_REQUEST", "Server manzili https bo'lishi kerak");
    }
    return createApiClient({ baseUrl: url.origin, appVersion: this.options.appVersion, fetchImpl: this.options.fetchImpl });
  }

  async setupOptions(input: { apiUrl: string; phone: string; password: string; companyId?: string }) {
    return this.setupClient(input.apiUrl).setupOptions(input);
  }

  async register(input: { apiUrl: string; phone: string; password: string; companyId?: string; warehouseId: string; name: string }): Promise<AppStatus> {
    if (this.api) throw new KassaError("CONFLICT", "Qurilma allaqachon ro'yxatdan o'tgan");
    const client = this.setupClient(input.apiUrl);
    const registration = await client.setupRegister({ ...input, platform: this.options.platform });
    this.vault.save(registration.token);
    this.store.setMeta("apiUrl", new URL(input.apiUrl).origin);
    this.store.setMeta("device", registration.device);
    this.store.setMeta("company", registration.company);
    this.connect();
    await this.engine!.sync();
    return this.status();
  }

  // ─── Kassir ─────────────────────────────────────────────────────────────

  cashiers(): (CashierRecord & { hasPin: boolean })[] {
    return this.store
      .cashiers()
      .filter((cashier) => cashier.active)
      .map((cashier) => ({ ...cashier, hasPin: this.store.pinState(cashier.userId) !== null }));
  }

  /** Birinchi kirish (onlayn): server telefon + parolni tekshiradi, kassir shu qurilma uchun PIN o'rnatadi. */
  async firstLogin(input: { phone: string; password: string; pin: string }): Promise<AppStatus> {
    if (!this.api) throw new KassaError("NOT_REGISTERED", "Qurilma ro'yxatdan o'tmagan");
    if (!PIN_PATTERN.test(input.pin)) throw new KassaError("BAD_REQUEST", "PIN 4–8 raqamdan iborat bo'lsin");
    const { cashier } = await this.api.cashierLogin(input.phone, input.password);
    const record: CashierRecord = { ...cashier, userId: cashier.id, active: true };
    this.store.saveCashier(record);
    this.store.setPinHash(record.userId, await hashPin(input.pin));
    this.cashier = record;
    return this.status();
  }

  /** Offline almashish: lokal PIN; server o'chirgan kassir (pull'dan keyin `active: false`) kira olmaydi. */
  async unlock(input: { userId: string; pin: string }): Promise<AppStatus> {
    const record = this.store.cashier(input.userId);
    if (!record || !record.active) throw new KassaError("FORBIDDEN", "Kassir bu qurilmada ishlay olmaydi");
    const check = await checkPin(this.store, input.userId, input.pin);
    if (!check.ok) {
      const message =
        check.reason === "locked" ? "Ko'p xato urinish — PIN vaqtincha bloklandi" : check.reason === "not_set" ? "Avval onlayn kirib PIN o'rnating" : "PIN noto'g'ri";
      throw new KassaError(check.reason === "locked" ? "PIN_LOCKED" : "PIN_INVALID", message, check.ok ? undefined : { lockedUntil: check.lockedUntil });
    }
    this.cashier = record;
    return this.status();
  }

  logout(): AppStatus {
    this.cashier = null;
    return this.status();
  }

  private requireCashier(permission = "pos.use"): CashierRecord {
    if (!this.cashier) throw new KassaError("UNAUTHENTICATED", "Kassir kirmagan");
    if (!this.cashier.permissions.includes(permission)) throw new KassaError("FORBIDDEN", `Ruxsat yo'q: ${permission}`);
    return this.cashier;
  }

  // ─── Sinxron ────────────────────────────────────────────────────────────

  async syncNow(): Promise<AppStatus> {
    if (!this.engine) throw new KassaError("NOT_REGISTERED", "Qurilma ro'yxatdan o'tmagan");
    await this.engine.sync();
    return this.status();
  }

  rejected(): RejectedOperation[] {
    return this.store.rejectedOps().map((op) => ({ opId: op.opId, type: op.type, createdAt: op.createdAt, error: op.error }));
  }

  // ─── Smena (offline) ────────────────────────────────────────────────────

  openShift(input: { openingCash: string }): AppStatus {
    const cashier = this.requireCashier();
    if (!MONEY.test(input.openingCash)) throw new KassaError("BAD_REQUEST", "Boshlang'ich naqd summasi noto'g'ri");
    if (this.store.getMeta<LocalShift>("shift")) throw new KassaError("CONFLICT", "Smena allaqachon ochiq");
    const shift: LocalShift = { id: randomUUID(), cashierId: cashier.userId, cashierName: cashier.name, openedAt: new Date().toISOString(), openingCash: input.openingCash };
    this.store.enqueue({ type: "shift.open", cashierId: cashier.userId, payload: { shiftId: shift.id, openingCash: input.openingCash } }, new Date(shift.openedAt));
    this.store.setMeta("shift", shift);
    void this.engine?.sync();
    return this.status();
  }

  closeShift(input: { closingCash: string }): AppStatus {
    const cashier = this.requireCashier();
    if (!MONEY.test(input.closingCash)) throw new KassaError("BAD_REQUEST", "Kassadagi naqd summasi noto'g'ri");
    const shift = this.store.getMeta<LocalShift>("shift");
    if (!shift) throw new KassaError("CONFLICT", "Ochiq smena yo'q");
    this.store.enqueue({ type: "shift.close", cashierId: cashier.userId, payload: { shiftId: shift.id, closingCash: input.closingCash } });
    this.store.deleteMeta("shift");
    void this.engine?.sync();
    return this.status();
  }
}

/** IPC javobiga aylantirish: KassaError/ApiError — xabar bilan, kutilmagan xato — umumiy. */
export function toKassaError(error: unknown): { code: string; message: string; details?: unknown } {
  if (error instanceof KassaError) return { code: error.code, message: error.message, details: error.details };
  if (error instanceof ApiError) return { code: error.code, message: error.message, details: error.details };
  if (error instanceof Error && error.name === "OfflineError") return { code: "OFFLINE", message: error.message };
  return { code: "INTERNAL", message: "Kutilmagan xato" };
}
