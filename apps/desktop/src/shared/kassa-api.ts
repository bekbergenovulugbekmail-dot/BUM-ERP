/**
 * Renderer ↔ main IPC shartnomasi (`window.bumKassa`). Main jarayon javobi har doim `KassaResult` — Electron xato
 * obyektlarini serializatsiyada buzmasligi uchun.
 */
import type { CashierRecord, CompanyInfo, DeviceInfo, SyncStatus } from "./sync-types.js";

export type KassaError = { code: string; message: string; details?: unknown };
export type KassaResult<T> = { ok: true; data: T } | { ok: false; error: KassaError };

export type LocalShift = { id: string; cashierId: string; cashierName: string | null; openedAt: string; openingCash: string };

export type AppStatus = {
  appVersion: string;
  registered: boolean;
  apiUrl: string | null;
  device: DeviceInfo | null;
  company: CompanyInfo | null;
  cashier: CashierRecord | null;
  shift: LocalShift | null;
  counts: { products: number; customers: number; cashiers: number; pending: number; rejected: number };
  sync: SyncStatus;
};

export type RejectedOperation = { opId: string; type: string; createdAt: string; error: KassaError | null };

export type KassaChannels = {
  "app:status": { input: void; output: AppStatus };
  "setup:options": {
    input: { apiUrl: string; phone: string; password: string; companyId?: string };
    output: { companies: { id: string; name: string }[]; company: { id: string; name: string } | null; warehouses: { id: string; name: string; code: string; isDefault: boolean }[] };
  };
  "setup:register": { input: { apiUrl: string; phone: string; password: string; companyId?: string; warehouseId: string; name: string }; output: AppStatus };
  "cashier:list": { input: void; output: (CashierRecord & { hasPin: boolean })[] };
  "cashier:first-login": { input: { phone: string; password: string; pin: string }; output: AppStatus };
  "cashier:unlock": { input: { userId: string; pin: string }; output: AppStatus };
  "cashier:logout": { input: void; output: AppStatus };
  "sync:run": { input: void; output: AppStatus };
  "sync:rejected": { input: void; output: RejectedOperation[] };
  "shift:open": { input: { openingCash: string }; output: AppStatus };
  "shift:close": { input: { closingCash: string }; output: AppStatus };
};

export type KassaChannel = keyof KassaChannels;

export type KassaBridge = {
  invoke<C extends KassaChannel>(
    channel: C,
    ...input: KassaChannels[C]["input"] extends void ? [] : [KassaChannels[C]["input"]]
  ): Promise<KassaResult<KassaChannels[C]["output"]>>;
  onSyncStatus(listener: (status: SyncStatus) => void): () => void;
};
