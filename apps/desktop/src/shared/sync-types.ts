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
  "suppliers",
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

export type SyncOperationType =
  | "shift.open"
  | "shift.close"
  | "sale.complete"
  | "sale.return"
  | "customer.create"
  | "cash.movement"
  | "customer.payment"
  | "supplier.create"
  | "purchase.complete"
  | "purchase.return"
  | "supplier.payment"
  | "stock.writeoff"
  | "stock.transfer"
  | "stock.count";

export type CashMovementKind = "collection" | "change_fund" | "expense" | "other_in" | "other_out";

/** `cash.movement` — inkassatsiya, almashtirish puli, kassadan xarajat, boshqa kirim/chiqim. */
export type CashMovementPayload = {
  movementId: string;
  shiftId: string;
  kind: CashMovementKind;
  amount: string;
  category?: string | null;
  notes?: string | null;
};

/** `customer.payment` — kassada qarz to'lovi yoki balansni to'ldirish. */
export type CustomerPaymentPayload = {
  paymentId: string;
  shiftId: string;
  customerId: string;
  purpose: "deposit" | "debt";
  amount: string;
  method: "cash" | "card";
  notes?: string | null;
};

/** `supplier.create` — kassada yangi ta'minotchi (offline). */
export type SupplierPayload = { supplierId: string; name: string; phone?: string | null };

/**
 * `purchase.complete` — kassada xarid: ta'minotchidan tovar qabul qilindi. Serverda tasdiqlangan va to'liq qabul
 * qilingan xarid buyurtmasi (`K01-P000001`) bo'lib yoziladi; narx, kurs va vaqt — qurilmadagi.
 */
export type PurchasePayload = {
  purchaseId: string;
  number: string;
  supplierId: string;
  items: {
    id: string;
    productId: string;
    unitId: string;
    quantity: string;
    unitPrice: string;
    taxRate?: string;
    discountPercent?: string;
    /** Qator valyutasi; null — asosiy. */
    currency?: string | null;
    /** Mahsulotning yangi sotuv narxi (asosiy birlik uchun). */
    salesPrice?: string | null;
    batchNumber?: string | null;
    expiryDate?: string | null;
  }[];
  rates?: Record<string, string>;
  notes?: string | null;
  /** Ta'minotchiga darhol to'lov — kassa smenasidan (asosiy valyutada). */
  payment?: { shiftId: string; amount: string; method: "cash" | "card" } | null;
};

/** `purchase.return` — ta'minotchiga qaytarish (qisman); pul qaytsa — kassaga. */
export type PurchaseReturnPayload = {
  returnId: string;
  number: string;
  orderId: string;
  items: { orderItemId: string; quantity: string }[];
  reason?: string | null;
  refund?: { shiftId: string; amount: string; method: "cash" | "card" } | null;
};

/** `supplier.payment` — kassa smenasidan ta'minotchi qarzini to'lash. */
export type SupplierPaymentPayload = {
  paymentId: string;
  shiftId: string;
  supplierId: string;
  amount: string;
  method: "cash" | "card";
  orderId?: string | null;
  notes?: string | null;
};

/** Ombor hujjati qatori: mahsulot, birlik va miqdor (shu birlikda). */
export type StockItemPayload = { productId: string; unitId: string; quantity: string };

/** `stock.writeoff` — qurilma omboridan hisobdan chiqarish (buzilgan, yo'qolgan va h.k.), `K01-W000001`. */
export type StockWriteoffPayload = { writeoffId: string; number: string; items: StockItemPayload[]; reason?: string | null };

/** `stock.transfer` — qurilma omboridan boshqa omborga ko'chirish, `K01-T000001`. */
export type StockTransferPayload = { transferId: string; number: string; toWarehouseId: string; items: StockItemPayload[]; notes?: string | null };

/**
 * `stock.count` — inventarizatsiya, `K01-I000001`: sanalgan miqdorlar (asosiy birlikda) amal vaqtidagi holat bo'yicha.
 * Server farqni o'sha lahzadagi qoldiqqa nisbatan hisoblaydi (keyingi harakatlar saqlanadi).
 */
export type StockCountPayload = { countId: string; number: string; items: { productId: string; countedQty: string }[]; notes?: string | null };

/** Serverdagi zaxira harakati (`GET /movements`) — qurilma omboridagi. */
export type RemoteMovement = {
  id: string;
  type: string;
  productId: string;
  productName: string;
  productSku: string;
  unitName: string;
  /** Ishorali, asosiy birlikda. */
  quantity: string;
  costPrice: string;
  referenceType: string | null;
  referenceId: string | null;
  documentNumber: string | null;
  notes: string | null;
  performedByName: string | null;
  occurredAt: string;
};

/** Mahsulot qoldig'i kompaniya omborlari bo'yicha (`GET /stock/:productId`). */
export type RemoteWarehouseStock = { warehouseId: string; warehouseName: string; warehouseCode: string; quantity: string; reservedQty: string };

/** Serverdagi xarid (`GET /purchases/:number`) — qaytarish uchun, qabul va qaytarilgan miqdorlar bilan. */
export type RemotePurchase = {
  id: string;
  number: string;
  status: string;
  supplierId: string;
  supplierName: string;
  totalAmount: string;
  paidAmount: string;
  createdAt: string;
  items: {
    id: string;
    productId: string;
    productName: string;
    unitId: string;
    unitName: string;
    orderedQty: string;
    receivedQty: string;
    returnedQty: string;
    unitPrice: string;
    lineTotal: string;
    currency: string | null;
  }[];
};

/** Serverdagi sotuv tarixi qatori (`GET /sales`) — qurilma omboridagi barcha kassalar. */
export type RemoteSale = {
  id: string;
  number: string;
  status: string;
  orderDate: string;
  totalAmount: string;
  paidAmount: string;
  createdAt: string;
  customerName: string | null;
  deviceCode: string | null;
  cashierName: string | null;
};

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
  /** Etiketka shablonlari (`LabelSettings`, web: Sozlamalar → Etiketka); eski server — yo'q. */
  labels?: unknown;
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
