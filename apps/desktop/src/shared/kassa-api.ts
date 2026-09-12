/**
 * Renderer ↔ main IPC shartnomasi (`window.bumKassa`). Main jarayon javobi har doim `KassaResult` — Electron xato
 * obyektlarini serializatsiyada buzmasligi uchun.
 */
import type {
  AnalyticsReport,
  CashierRecord,
  CashMovementKind,
  CompanyInfo,
  DeviceInfo,
  PartyType,
  PaymentMethod,
  PosConfig,
  RefundMethod,
  RemoteSale,
  RemoteWarehouseStock,
  SyncStatus,
} from "./sync-types.js";

export type KassaError = { code: string; message: string; details?: unknown };
export type KassaResult<T> = { ok: true; data: T } | { ok: false; error: KassaError };

/** Smena yig'indilari qurilmada (offline) — kassa hisobi va smena yopishda ko'rinadi. */
export type ShiftTotals = { sales: string; cash: string; card: string; returns: string; receipts: number; cashIn?: string; cashOut?: string };

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

/** Jismoniy/yuridik shaxs rekvizitlari (mijoz va ta'minotchi uchun umumiy). */
export type PartyDetails = {
  partyType: PartyType;
  email: string | null;
  address: string | null;
  /** STIR (yuridik) yoki JSHSHIR (jismoniy). */
  taxId: string | null;
  bankAccount: string | null;
  bankMfo: string | null;
  notes: string | null;
};

export type CustomerInput = {
  name: string;
  phone?: string | null;
  partyType?: PartyType;
  email?: string | null;
  address?: string | null;
  taxId?: string | null;
  contactName?: string | null;
  bankAccount?: string | null;
  bankMfo?: string | null;
  notes?: string | null;
};

export type SupplierInput = Omit<CustomerInput, "contactName"> & { contactPerson?: string | null };

export type PosCustomer = PartyDetails & {
  id: string;
  name: string;
  code: string | null;
  phone: string | null;
  contactName: string | null;
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
  /** Etiketka shablonlari (`LabelSettings`); sozlanmagan — null (renderer standartni oladi). */
  labels: unknown;
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

// ─── Kassa bo'limi ───────────────────────────────────────────────────────────

export type LocalCashMovement = {
  id: string;
  shiftId: string;
  kind: CashMovementKind;
  type: "in" | "out";
  amount: string;
  category: string | null;
  notes: string | null;
  cashierName: string | null;
  createdAt: string;
  sync: DocumentSync;
};

export type LocalCustomerPayment = {
  id: string;
  shiftId: string;
  customer: { id: string; name: string; phone: string | null };
  purpose: "deposit" | "debt";
  method: "cash" | "card";
  amount: string;
  cashierName: string | null;
  createdAt: string;
  /** Qurilmadagi taxminiy holat (server qarzdan ortiqni balansga o'tkazadi). */
  customerAfter: { totalDebt: string; balance: string };
  sync: DocumentSync;
};

/** X-hisobot (joriy smena) yoki Z-hisobot (yopilgan) — qurilmadagi hujjatlardan hisoblanadi. */
export type ShiftReport = {
  shift: { id: string; cashierName: string | null; openedAt: string; closedAt: string | null; openingCash: string; closingCash: string | null };
  device: { code: string; name: string; warehouseName: string } | null;
  receipts: number;
  salesTotal: string;
  tax: string;
  discount: string;
  /** Tushum turi bo'yicha: naqd, karta, bank, o'tkazma, balansdan, keshbekdan, qarzga. */
  byMethod: { key: string; label: string; amount: string }[];
  returns: { count: number; total: string; cash: string; card: string; balance: string };
  customerPayments: { count: number; debtCash: string; debtCard: string; depositCash: string; depositCard: string };
  cashMovements: { kind: CashMovementKind; label: string; count: number; amount: string }[];
  cashIn: string;
  cashOut: string;
  expectedCash: string;
  difference: string | null;
  cashiers: { name: string; receipts: number; total: string }[];
  /** Ta'minotchilar bilan kassa orqali: xarid/qarz to'lovlari (chiqim) va qaytarishda qaytgan pul (kirim). */
  suppliers: { payments: number; paidCash: string; paidCard: string; refunds: number; refundCash: string; refundCard: string };
  unsynced: number;
};

// ─── Xarid ───────────────────────────────────────────────────────────────────

export type PosSupplier = PartyDetails & {
  id: string;
  name: string;
  code: string | null;
  phone: string | null;
  contactPerson: string | null;
  /** Asosiy valyutadagi kitob qiymati (qurilmadagi taxminiy holat). */
  totalDebt: string;
  isActive: boolean;
  pending: boolean;
};

export type PurchaseProduct = PosProduct & {
  purchasePrice: string;
  purchaseCurrency: string | null;
  trackBatch: boolean;
  trackExpiry: boolean;
};

export type PurchaseLineInput = {
  productId: string;
  unitId: string;
  quantity: string;
  /** Ta'minotchi narxi (soliqsiz) qator valyutasida. */
  unitPrice: string;
  currency?: string | null;
  salesPrice?: string | null;
  batchNumber?: string | null;
  expiryDate?: string | null;
};

export type PurchaseInput = {
  supplierId: string;
  lines: PurchaseLineInput[];
  notes?: string | null;
  /** Darhol to'lov — kassa smenasidan, asosiy valyutada. */
  payment: { amount: string; method: "cash" | "card" } | null;
};

export type LocalPurchase = {
  id: string;
  number: string;
  supplier: { id: string; name: string };
  shiftId: string | null;
  cashierName: string | null;
  createdAt: string;
  lines: {
    id: string;
    productId: string;
    name: string;
    sku: string;
    unitId: string;
    unitName: string;
    quantity: string;
    unitPrice: string;
    currency: string | null;
    /** Qator valyutasida. */
    lineTotal: string;
    /** Asosiy valyutada (qurilmadagi kurs bilan). */
    baseTotal: string;
    salesPrice: string | null;
  }[];
  total: string;
  currencyTotals: { currency: string; total: string }[];
  payment: { amount: string; method: "cash" | "card" } | null;
  notes: string | null;
  sync: DocumentSync;
};

export type ReturnablePurchase = {
  source: "local" | "server";
  orderId: string;
  number: string;
  createdAt: string;
  status: string;
  supplier: { id: string; name: string };
  lines: {
    id: string;
    productId: string;
    name: string;
    unitId: string;
    unitName: string;
    /** Qabul qilingan miqdor. */
    quantity: string;
    returned: string;
    unitPrice: string;
    lineTotal: string;
    currency: string | null;
  }[];
};

export type PurchaseReturnInput = {
  number: string;
  items: { orderItemId: string; quantity: string }[];
  reason?: string | null;
  refund: { amount: string; method: "cash" | "card" } | null;
};

export type LocalPurchaseReturn = {
  id: string;
  number: string;
  orderId: string;
  orderNumber: string;
  supplier: { id: string; name: string };
  shiftId: string | null;
  cashierName: string | null;
  createdAt: string;
  lines: { orderItemId: string; name: string; quantity: string; lineTotal: string }[];
  /** Taxminiy qiymat (asosiy valyutada) — yakuniysi serverda qabul tannarxidan. */
  total: string;
  refund: { amount: string; method: "cash" | "card" } | null;
  reason: string | null;
  sync: DocumentSync;
};

export type LocalSupplierPayment = {
  id: string;
  shiftId: string;
  supplier: { id: string; name: string };
  amount: string;
  method: "cash" | "card";
  notes: string | null;
  cashierName: string | null;
  createdAt: string;
  supplierDebtAfter: string;
  sync: DocumentSync;
};

// ─── Ombor ───────────────────────────────────────────────────────────────────

export type StockFilter = "all" | "positive" | "low" | "zero" | "negative";

export type StockRow = {
  productId: string;
  name: string;
  sku: string;
  barcode: string | null;
  unitName: string;
  /** Ko'rinadigan qoldiq (server + sinxron bo'lmagan hujjatlar), asosiy birlikda. */
  quantity: string;
  /** Shundan serverga yetib bormagan hujjatlar ta'siri. */
  pending: string;
  minStock: string;
  /** O'rtacha tannarx va qiymat — faqat `warehouse.manage` ruxsati bilan. */
  avgCost: string | null;
  value: string | null;
  isLow: boolean;
};

export type StockList = {
  rows: StockRow[];
  summary: { products: number; positive: number; low: number; zero: number; negative: number; totalValue: string | null };
  /** Ro'yxat chegarasidan ko'p — qidiruvni aniqlashtiring. */
  truncated: boolean;
};

export type StockWarehouse = { id: string; name: string; code: string };

/** Ombor hujjati qatori (asosiy birlikda). */
export type StockLineInput = { productId: string; quantity: string };

export type StockDocumentKind = "writeoff" | "transfer" | "count";

export type LocalStockDocument = {
  id: string;
  number: string;
  kind: StockDocumentKind;
  cashierName: string | null;
  createdAt: string;
  toWarehouse: { id: string; name: string } | null;
  lines: {
    productId: string;
    name: string;
    sku: string;
    unitName: string;
    /** Hisobdan chiqarish/ko'chirish — miqdor; inventarizatsiya — sanalgan. */
    quantity: string;
    /** Inventarizatsiya: qurilmadagi kutilgan qoldiq va farq. */
    expected?: string;
    difference?: string;
  }[];
  notes: string | null;
  /** Taxminiy qiymat o'rtacha tannarxda (inventarizatsiyada ishorali) — yakuniysi serverda; ruxsatsiz — null. */
  value: string | null;
  sync: DocumentSync;
};

export type CountDraft = {
  id: string;
  startedAt: string;
  lines: { productId: string; name: string; sku: string; unitName: string; counted: string; expected: string; difference: string }[];
};

export type MovementRow = {
  id: string;
  /** server — serverdagi harakat; pending — qurilmadagi, hali yuborilmagan hujjat. */
  source: "server" | "pending";
  /** Serverda — harakat turi (receive, issue…); qurilmada — amal turi (sale.complete…). */
  type: string;
  productId: string;
  productName: string;
  unitName: string;
  quantity: string;
  documentNumber: string | null;
  notes: string | null;
  by: string | null;
  occurredAt: string;
};

export type MovementPage = { rows: MovementRow[]; nextCursor: string | null; offline: boolean };

// ─── Ma'lumotlar: narxlar ────────────────────────────────────────────────────

export type PriceRow = {
  productId: string;
  name: string;
  sku: string;
  barcode: string | null;
  unitName: string;
  stock: string;
  /** Narxlar mahsulot valyutasida (asosiy birlik uchun). */
  salesPrice: string;
  salesCurrency: string | null;
  wholesalePrice: string | null;
  retailPrice: string | null;
  promoPrice: string | null;
  promoPriceEnd: string | null;
  /** Xarid narxi — faqat `products.edit` yoki `purchase.create` ruxsati bilan. */
  purchasePrice: string | null;
  purchaseCurrency: string | null;
  /** Yuborilmagan narx o'zgarishi bor. */
  pending: boolean;
};

export type PriceInput = {
  productId: string;
  salesPrice?: string;
  wholesalePrice?: string | null;
  retailPrice?: string | null;
  promoPrice?: string | null;
  promoPriceEnd?: string | null;
  purchasePrice?: string;
};

export type DrawerPrefs = { mode: "none" | "driver" | "tcp" | "share"; host?: string; port?: number; share?: string };

/** Kassa ekranidagi tezkor tugma bilan bajariladigan amallar. */
export type HotkeyAction =
  | "help"
  | "search"
  | "quantity"
  | "customer"
  | "hold"
  | "held"
  | "return"
  | "unsynced"
  | "payCash"
  | "payCard"
  | "payBank"
  | "complete";

export type DevicePrefs = {
  /** Dastur tili: o'zbek lotin, kirill (avtomatik o'giriladi) yoki rus (lug'at bo'yicha). */
  language: "uz-Latn" | "uz-Cyrl" | "ru";
  theme: "light" | "dark" | "system";
  fontScale: "normal" | "large";
  hotkeys: Record<HotkeyAction, string>;
  /** Qoldiq yetmasa sotishni taqiqlash (standart — ogohlantirib sotiladi, server nomuvofiqlik qayd etadi). */
  blockNegativeStock: boolean;
  defaultPaymentMethod: PaymentMethod;
  enabledPaymentMethods: PaymentMethod[];
  /** Davriy sinxron oralig'i, soniya. */
  syncIntervalSec: number;
  /** Harakatsizlikdan keyin kassirni bloklash (PIN so'raladi), daqiqa; 0 — o'chiq. */
  autoLockMinutes: number;
  printerName: string | null;
  paperWidth: 58 | 80;
  /** Chek yakunlanishi bilan chop etish. */
  autoPrint: boolean;
  drawer: DrawerPrefs;
  /** Naqd to'lovda pul qutisini ochish. */
  openDrawerOnCash: boolean;
  /** Etiketka printeri (null — Windows standart printeri). */
  labelPrinterName: string | null;
};

export type LabelPrintInput = { html: string; layout: "roll" | "a4"; widthMm: number; heightMm: number };

export type UpdateInfo = {
  configured: boolean;
  available: boolean;
  mandatory: boolean;
  current: string;
  latest: string | null;
  notes: string | null;
  /** Yuklab olingan va SHA-256 tekshirilgan o'rnatuvchi tayyor. */
  downloaded: boolean;
  /** Uzilgan yuklab olishning diskdagi qismi (bayt) — "Yuklab olish" shu joydan davom etadi. */
  partialBytes: number;
};

/** Sozlamalar oynasi uchun qurilmadagi ma'lumotlar (offline ham). */
export type SettingsOverview = {
  appVersion: string;
  apiUrl: string | null;
  device: DeviceInfo | null;
  company: PosConfig["company"] | null;
  subscription: { status: string | null; trialEndsAt: string | null };
  baseCurrency: string;
  currencies: { code: string; rate: string; rateDate: string | null; isActive: boolean }[];
  cashback: PosConfig["cashback"] | null;
  warehouses: { id: string; name: string; code: string; isDefault: boolean; isActive: boolean; current: boolean }[];
  cashiers: { userId: string; name: string | null; phone: string; role: string; active: boolean; hasPin: boolean }[];
  permissions: string[];
  sync: SyncStatus;
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
  "cashier:change-pin": { input: { oldPin: string; newPin: string }; output: void };
  "settings:overview": { input: void; output: SettingsOverview };
  "update:check": { input: void; output: UpdateInfo };
  "update:download": { input: void; output: UpdateInfo };
  "update:install": { input: void; output: void };
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
  "pos:products-by-ids": { input: { ids: string[] }; output: PosProduct[] };
  "pos:customers": { input: { query: string }; output: PosCustomer[] };
  "pos:customer-create": { input: CustomerInput; output: PosCustomer };
  "ref:customers": { input: { query: string; partyType?: PartyType; limit?: number }; output: PosCustomer[] };
  "ref:customer-update": { input: { customerId: string } & Partial<CustomerInput>; output: PosCustomer };
  "ref:suppliers": { input: { query: string; partyType?: PartyType; limit?: number }; output: PosSupplier[] };
  "ref:supplier-update": { input: { supplierId: string } & Partial<SupplierInput>; output: PosSupplier };
  "ref:prices": { input: { query: string; limit?: number }; output: PriceRow[] };
  "ref:price-update": { input: PriceInput; output: PriceRow };
  "pos:complete-sale": { input: SaleInput; output: LocalSale };
  "pos:sales": { input: { limit?: number; shiftOnly?: boolean }; output: LocalSale[] };
  "pos:hold": { input: { label?: string; cart: HeldCart }; output: HeldReceipt };
  "pos:held": { input: void; output: HeldReceipt[] };
  "pos:held-take": { input: { id: string }; output: HeldReceipt };
  "pos:held-delete": { input: { id: string }; output: void };
  "pos:find-receipt": { input: { number: string }; output: ReturnableReceipt };
  "pos:return": { input: ReturnInput; output: LocalReturn };
  "cash:report": { input: { shiftId?: string }; output: ShiftReport };
  "cash:movement": { input: { kind: CashMovementKind; amount: string; category?: string | null; notes?: string | null }; output: LocalCashMovement };
  "cash:movements": { input: void; output: LocalCashMovement[] };
  "cash:customer-payment": {
    input: { customerId: string; purpose: "deposit" | "debt"; amount: string; method: "cash" | "card"; notes?: string | null };
    output: LocalCustomerPayment;
  };
  "cash:customer-payments": { input: void; output: LocalCustomerPayment[] };
  "cash:shifts": { input: { limit?: number }; output: ShiftReport[] };
  "history:sales": { input: { from?: string; to?: string; limit?: number }; output: LocalSale[] };
  "history:returns": { input: { from?: string; to?: string; limit?: number }; output: LocalReturn[] };
  "history:server": { input: { from?: string; to?: string; cursor?: string }; output: { sales: RemoteSale[]; nextCursor: string | null } };
  "purchase:suppliers": { input: { query: string }; output: PosSupplier[] };
  "purchase:supplier-create": { input: SupplierInput; output: PosSupplier };
  "purchase:products": { input: { query: string }; output: PurchaseProduct[] };
  "purchase:product-by-code": { input: { code: string }; output: PurchaseProduct | null };
  "purchase:complete": { input: PurchaseInput; output: LocalPurchase };
  "purchase:list": { input: { from?: string; to?: string; limit?: number }; output: LocalPurchase[] };
  "purchase:find": { input: { number: string }; output: ReturnablePurchase };
  "purchase:return": { input: PurchaseReturnInput; output: LocalPurchaseReturn };
  "purchase:returns": { input: { from?: string; to?: string; limit?: number }; output: LocalPurchaseReturn[] };
  "purchase:supplier-payment": { input: { supplierId: string; amount: string; method: "cash" | "card"; notes?: string | null }; output: LocalSupplierPayment };
  "stock:list": { input: { query: string; filter?: StockFilter; limit?: number }; output: StockList };
  "stock:warehouses": { input: void; output: StockWarehouse[] };
  "stock:products": { input: { query: string }; output: PosProduct[] };
  "stock:product-by-code": { input: { code: string }; output: PosProduct | null };
  "stock:writeoff": { input: { lines: StockLineInput[]; reason?: string | null }; output: LocalStockDocument };
  "stock:transfer": { input: { toWarehouseId: string; lines: StockLineInput[]; notes?: string | null }; output: LocalStockDocument };
  "stock:documents": { input: { kind?: StockDocumentKind; from?: string; to?: string; limit?: number }; output: LocalStockDocument[] };
  "stock:movements": { input: { productId?: string; type?: string; cursor?: string }; output: MovementPage };
  "stock:elsewhere": { input: { productId: string }; output: RemoteWarehouseStock[] };
  "count:draft": { input: void; output: CountDraft | null };
  "count:set": { input: { productId: string; counted: string; mode?: "set" | "add" }; output: CountDraft };
  "count:remove": { input: { productId: string }; output: CountDraft | null };
  "count:cancel": { input: void; output: void };
  "count:complete": { input: { notes?: string | null; zeroMissing?: boolean }; output: LocalStockDocument };
  "analytics:report": { input: { from: string; to: string; source?: "auto" | "local" }; output: AnalyticsReport };
  "device:prefs": { input: void; output: DevicePrefs };
  "device:save-prefs": { input: DevicePrefs; output: DevicePrefs };
  "device:printers": { input: void; output: { name: string; displayName: string }[] };
  "device:print": { input: { html: string }; output: void };
  "device:print-labels": { input: LabelPrintInput; output: void };
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
