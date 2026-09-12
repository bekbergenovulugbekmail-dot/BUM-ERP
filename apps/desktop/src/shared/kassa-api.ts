/**
 * Renderer ↔ main IPC shartnomasi (`window.bumKassa`). Main jarayon javobi har doim `KassaResult` — Electron xato
 * obyektlarini serializatsiyada buzmasligi uchun.
 */
import type { CashierRecord, CompanyInfo, DeviceInfo, PaymentMethod, PosConfig, RefundMethod, SyncStatus } from "./sync-types.js";

export type KassaError = { code: string; message: string; details?: unknown };
export type KassaResult<T> = { ok: true; data: T } | { ok: false; error: KassaError };

/** Smena yig'indilari qurilmada (offline) — kassa hisobi va smena yopishda ko'rinadi. */
export type ShiftTotals = { sales: string; cash: string; card: string; returns: string; receipts: number };

export type LocalShift = {
  id: string;
  cashierId: string;
  cashierName: string | null;
  openedAt: string;
  openingCash: string;
  totals?: ShiftTotals;
};

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

// ─── Kassa (POS) ─────────────────────────────────────────────────────────────

export type PosProduct = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  categoryId: string | null;
  baseUnitId: string;
  unitName: string;
  salesPrice: string;
  salesCurrency: string | null;
  /** Asosiy valyutada, asosiy birlikda; narx valyutasi kursi yo'q bo'lsa — null (sotib bo'lmaydi). */
  price: string | null;
  taxRate: string;
  taxIncluded: boolean;
  /** Qurilmadagi qoldiq: server qoldig'i + sinxron bo'lmagan cheklar/qaytarishlar (asosiy birlikda). */
  stock: string;
};

export type PosCustomer = {
  id: string;
  name: string;
  code: string | null;
  phone: string | null;
  discountPercent: string;
  creditLimit: string;
  totalDebt: string;
  balance: string;
  cashbackBalance: string;
  isActive: boolean;
  /** Kassada yaratilgan, serverga hali yetib bormagan. */
  pending: boolean;
};

export type PosContext = {
  baseCurrency: string;
  /** Faol qo'shimcha valyutalar va kurslari (asosiy valyutada). */
  currencies: { code: string; rate: string }[];
  cashback: PosConfig["cashback"] | null;
  receipt: Record<string, unknown> | null;
  company: PosConfig["company"] | null;
  permissions: string[];
};

export type CartLineInput = { productId: string; unitId: string; quantity: string; unitPrice?: string; discountPercent?: string };

export type SaleInput = {
  customerId: string | null;
  lines: CartLineInput[];
  saleCurrencies: string[];
  paymentMethod: PaymentMethod;
  /** null — aniq summa. */
  amountPaid: string | null;
  /** null — ishlatilmaydi; "" — mavjudining hammasi (chegarada). */
  cashbackAmount: string | null;
  balanceAmount: string | null;
  changeToBalance: boolean;
  currencyPayments: { currency: string; amount: string | null; method: "cash" | "card" }[];
  notes?: string | null;
};

export type LocalSyncState = "pending" | "applied" | "rejected" | "discarded";
export type DocumentSync = { state: LocalSyncState; error: string | null; conflicts: string[] };

export type ReceiptLine = {
  id: string;
  productId: string;
  name: string;
  sku: string;
  unitId: string;
  unitName: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  lineTotal: string;
  currency: string | null;
  currencyTotal: string;
};

export type LocalSale = {
  id: string;
  number: string;
  shiftId: string;
  cashierId: string;
  cashierName: string | null;
  customer: { id: string; name: string; phone: string | null } | null;
  createdAt: string;
  lines: ReceiptLine[];
  subtotal: string;
  tax: string;
  discount: string;
  total: string;
  paymentMethod: PaymentMethod;
  /** Mijoz bergan summa (asosiy valyutada). */
  tendered: string;
  paid: string;
  change: string;
  changeToBalance: string;
  debt: string;
  balanceUsed: string;
  cashbackUsed: string;
  /** Taxminiy — yakuniysi serverda. */
  cashbackEarned: string;
  currencyTotals: { currency: string; total: string; paid: string; change: string }[];
  customerAfter: { totalDebt: string; balance: string; cashbackBalance: string } | null;
  sync: DocumentSync;
};

export type ReturnableReceipt = {
  /** local — shu kassada sotilgan; server — boshqa kassa yoki web (internet bilan topilgan). */
  source: "local" | "server";
  orderId: string;
  number: string;
  createdAt: string;
  status: string;
  customer: { id: string; name: string } | null;
  total: string;
  paid: string;
  lines: {
    id: string;
    productId: string;
    name: string;
    unitId: string;
    unitName: string;
    quantity: string;
    /** Qaytarilgan (sinxron bo'lmagan qaytarishlar ham). */
    returned: string;
    unitPrice: string;
    lineTotal: string;
  }[];
};

export type ReturnInput = {
  number: string;
  items: { orderItemId: string; quantity: string }[];
  refundMethod: RefundMethod;
  reason?: string | null;
};

export type LocalReturn = {
  id: string;
  number: string;
  orderId: string;
  orderNumber: string;
  shiftId: string;
  cashierName: string | null;
  customer: { id: string; name: string } | null;
  createdAt: string;
  lines: { orderItemId: string; name: string; quantity: string; lineTotal: string }[];
  total: string;
  refundMethod: RefundMethod;
  /** Taxminiy qaytadigan pul (mijoz qarzi bo'lsa kamroq) — yakuniysi serverda. */
  refundEstimate: string;
  reason: string | null;
  sync: DocumentSync;
};

export type HeldCart = {
  customerId: string | null;
  lines: CartLineInput[];
  saleCurrencies: string[];
  /** Ekranni tiklash uchun (nomlar, birliklar, mijoz) — hisobda ishlatilmaydi. */
  display?: { customer: PosCustomer | null; lines: Record<string, unknown>[] };
};
export type HeldReceipt = { id: string; label: string; total: string; createdAt: string; cashierId: string; cart: HeldCart };

export type UnsyncedOperation = {
  opId: string;
  type: string;
  createdAt: string;
  status: "pending" | "rejected";
  attempts: number;
  error: KassaError | null;
  number: string | null;
  total: string | null;
  label: string | null;
};

export type DrawerPrefs = { mode: "none" | "driver" | "tcp" | "share"; host?: string; port?: number; share?: string };

export type DevicePrefs = {
  printerName: string | null;
  paperWidth: 58 | 80;
  /** Chek yakunlanishi bilan chop etish. */
  autoPrint: boolean;
  drawer: DrawerPrefs;
  /** Naqd to'lovda pul qutisini ochish. */
  openDrawerOnCash: boolean;
};

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
  "sync:unsynced": { input: void; output: UnsyncedOperation[] };
  "sync:retry": { input: { opId: string }; output: AppStatus };
  "sync:discard": { input: { opId: string }; output: AppStatus };
  "shift:open": { input: { openingCash: string }; output: AppStatus };
  "shift:close": { input: { closingCash: string }; output: AppStatus };
  "pos:context": { input: void; output: PosContext };
  "pos:products": { input: { query: string; limit?: number }; output: PosProduct[] };
  "pos:product-by-code": { input: { code: string }; output: PosProduct | null };
  "pos:customers": { input: { query: string }; output: PosCustomer[] };
  "pos:customer-create": { input: { name: string; phone?: string | null }; output: PosCustomer };
  "pos:complete-sale": { input: SaleInput; output: LocalSale };
  "pos:sales": { input: { limit?: number; shiftOnly?: boolean }; output: LocalSale[] };
  "pos:hold": { input: { label?: string; cart: HeldCart }; output: HeldReceipt };
  "pos:held": { input: void; output: HeldReceipt[] };
  "pos:held-take": { input: { id: string }; output: HeldReceipt };
  "pos:held-delete": { input: { id: string }; output: void };
  "pos:find-receipt": { input: { number: string }; output: ReturnableReceipt };
  "pos:return": { input: ReturnInput; output: LocalReturn };
  "device:prefs": { input: void; output: DevicePrefs };
  "device:save-prefs": { input: DevicePrefs; output: DevicePrefs };
  "device:printers": { input: void; output: { name: string; displayName: string }[] };
  "device:print": { input: { html: string }; output: void };
  "device:open-drawer": { input: void; output: void };
};

export type KassaChannel = keyof KassaChannels;

export type KassaBridge = {
  invoke<C extends KassaChannel>(
    channel: C,
    ...input: KassaChannels[C]["input"] extends void ? [] : [KassaChannels[C]["input"]]
  ): Promise<KassaResult<KassaChannels[C]["output"]>>;
  onSyncStatus(listener: (status: SyncStatus) => void): () => void;
};
