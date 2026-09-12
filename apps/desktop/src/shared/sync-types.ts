/**
 * Server (`/api/pos-device`) va desktop ilova o'rtasidagi sinxron turlari.
 * Main jarayon, preload va renderer uchun umumiy (faqat turlar — ish vaqtida kod yo'q).
 */

export const PULL_ENTITIES = [
  "units",
  "unitConversions",
  "categories",
  "brands",
  "products",
  "customers",
  "warehouses",
  "stockLevels",
  "currencies",
  "cashiers",
] as const;
export type PullEntity = (typeof PULL_ENTITIES)[number];

/** Kursor: `updated_at` (mikrosekund, UTC) va `id`. */
export type PullCursor = { t: string; id: string };
export type PullCursors = Partial<Record<PullEntity, PullCursor>>;

export type PullPage = { rows: Record<string, unknown>[]; cursor: PullCursor | null; more: boolean };

export type DeviceInfo = { id: string; name: string; code: string; warehouseId: string; warehouseName: string };
export type CompanyInfo = { id: string; name: string; currency: string };

export type PullResponse = {
  serverTime: string;
  company: CompanyInfo;
  device: DeviceInfo;
  entities: Record<PullEntity, PullPage>;
  more: boolean;
  /** Kompaniya sozlamalari (chek shabloni, keshbek, rekvizitlar); qurilmadagi `configHash` bilan bir xil bo'lsa — null. */
  config: PosConfig | null;
};

export type SyncOperationType = "shift.open" | "shift.close" | "sale.complete" | "sale.return" | "customer.create";

export type PaymentMethod = "cash" | "card" | "bank" | "transfer";

/** `sale.complete` — offline chek. Narx, kurs va raqam qurilmadan (sotuv shu shartda bo'lgan). */
export type SalePayload = {
  saleId: string;
  shiftId: string;
  /** `K01-000123` — qurilma kodi bilan, kompaniyada unikal. */
  number: string;
  customerId?: string | null;
  items: {
    id: string;
    productId: string;
    unitId: string;
    quantity: string;
    unitPrice: string;
    discountPercent?: string;
  }[];
  paymentMethod: PaymentMethod;
  amountPaid: string;
  cashbackAmount?: string;
  balanceAmount?: string;
  changeToBalance?: boolean;
  saleCurrencies?: string[];
  currencyPayments?: { currency: string; amount: string; method: "cash" | "card" }[];
  /** Sotuv lahzasidagi kurslar (asosiy valyutada). */
  rates?: Record<string, string>;
  notes?: string | null;
};

export type RefundMethod = "cash" | "card" | "balance";

/** `sale.return` — chekdagi mahsulotlarni (qisman) qaytarish. */
export type ReturnPayload = {
  returnId: string;
  orderId: string;
  shiftId: string;
  number: string;
  items: { orderItemId: string; quantity: string }[];
  refundMethod: RefundMethod;
  reason?: string | null;
};

/** `customer.create` — kassada yangi mijoz (offline). */
export type CustomerPayload = { customerId: string; name: string; phone?: string | null };

/** Serverdagi chek (`GET /receipts/:number`) — boshqa kassa yoki web'da sotilganini qaytarish uchun. */
export type RemoteReceipt = {
  id: string;
  number: string;
  status: string;
  isPos: boolean;
  deviceId: string | null;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  currency: string;
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  totalAmount: string;
  paidAmount: string;
  createdAt: string;
  items: {
    id: string;
    productId: string;
    productName: string;
    productSku: string;
    unitId: string;
    unitName: string;
    quantity: string;
    returnedQty: string;
    unitPrice: string;
    discountPercent: string;
    taxRate: string;
    lineTotal: string;
    priceCurrency: string | null;
    currencyTotal: string;
  }[];
};

/** Sinxronda server qayd etgan nomuvofiqlik (sotuv baribir yoziladi). */
export type SyncConflict = { kind: string; details: Record<string, unknown> };

/** Pull javobidagi kompaniya sozlamalari — `configHash` o'zgarganda keladi. */
export type PosConfig = {
  hash: string;
  company: { name: string; address: string | null; phone: string | null; taxId: string | null; currency: string };
  cashback: {
    enabled: boolean;
    accrualBase: "paid" | "total";
    maxUsagePercent: number;
    tiers: { minAmount: number; percent: number }[];
    categoryRates: { categoryId: string; percent: number }[];
  };
  receipt: Record<string, unknown>;
};

export type WireOperation = {
  opId: string;
  type: SyncOperationType;
  cashierId: string;
  createdAt: string;
  payload: Record<string, unknown>;
};

export type PosSyncError = { code: string; message: string; details?: unknown };

export type PushResult = {
  opId: string | null;
  status: "applied" | "rejected" | "invalid";
  duplicate?: boolean;
  result?: Record<string, unknown> | null;
  error?: PosSyncError | null;
};

export type CashierRecord = {
  id: string;
  userId: string;
  name: string | null;
  phone: string;
  role: string;
  permissions: string[];
  active: boolean;
};

export type SyncState = "idle" | "syncing" | "offline" | "unauthorized" | "error";

export type SyncStatus = {
  state: SyncState;
  lastSyncAt: string | null;
  pending: number;
  rejected: number;
  lastError: string | null;
};
