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
  /** Serverda butunlay o'chirilgan yozuvlar (kategoriya, brend, birlik konversiyasi) — lokal nusxa olib tashlanadi. */
  "deletions",
] as const;
export type PullEntity = (typeof PULL_ENTITIES)[number];

/** `deletions` sahifasidagi qator. */
export type DeletionRecord = { id: string; entity: string; entityId: string };
/** Server o'chira oladigan (va qurilma `records` jadvalida saqlaydigan) turlar. */
export const DELETABLE_ENTITIES: readonly string[] = ["categories", "brands", "unitConversions"];

/** Kursor: `updated_at` (mikrosekund, UTC) va `id`. */
export type PullCursor = { t: string; id: string };
export type PullCursors = Partial<Record<PullEntity, PullCursor>>;

export type PullPage = { rows: Record<string, unknown>[]; cursor: PullCursor | null; more: boolean };

export type DeviceInfo = { id: string; name: string; code: string; warehouseId: string; warehouseName: string };
export type CompanyInfo = {
  id: string;
  name: string;
  currency: string;
  /** Obuna holati (eski server — yo'q). */
  status?: string;
  trialEndsAt?: string | null;
};

/** `GET /app-update` — yangi reliz (server muhit o'zgaruvchilaridan). */
export type RemoteUpdate = {
  configured: boolean;
  available: boolean;
  mandatory: boolean;
  current: string | null;
  latest: string | null;
  url: string | null;
  sha256: string | null;
  notes: string | null;
};

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
  | "stock.count"
  | "customer.update"
  | "supplier.update"
  | "product.prices"
  | "currency.rate";

/** `currency.rate` — kassada o'zgartirilgan valyuta kursi: ko'rgan va yangi kurs (orada serverda o'zgarsa — nomuvofiqlik). */
export type CurrencyRatePayload = { code: string; from: string; to: string };

/** `GET /currencies/history` — kurs o'zgarishi (serverdagi tarix). */
export type RemoteRateChange = {
  id: string;
  code: string;
  oldRate: string | null;
  rate: string;
  source: "manual" | "cbu";
  rateDate: string;
  createdAt: string;
  createdByName: string | null;
  deviceName: string | null;
};

export type PartyType = "individual" | "legal";

/** Kassada tahrirlanadigan mijoz/ta'minotchi maydonlari (serverdagi push sxemasi bilan bir xil ro'yxat). */
export const CUSTOMER_FIELDS = ["name", "phone", "email", "address", "taxId", "partyType", "contactName", "bankAccount", "bankMfo", "notes"] as const;
export const SUPPLIER_FIELDS = ["name", "phone", "email", "address", "taxId", "partyType", "contactPerson", "bankAccount", "bankMfo", "notes"] as const;
export const PRICE_FIELDS = ["salesPrice", "wholesalePrice", "retailPrice", "promoPrice", "promoPriceEnd", "purchasePrice"] as const;
export type CustomerField = (typeof CUSTOMER_FIELDS)[number];
export type SupplierField = (typeof SUPPLIER_FIELDS)[number];
export type PriceField = (typeof PRICE_FIELDS)[number];

/**
 * Offline tahrir: qurilma ko'rgan qiymat (`from`) va yangisi (`to`). Server maydonni faqat hali `from` ga teng bo'lsa
 * yozadi — orada web'da o'zgargan bo'lsa, server qiymati qoladi va nomuvofiqlik (`record_changed`) qayd etiladi.
 */
export type FieldChange = { from: string | null; to: string | null };

/** `customer.update` — mijoz ma'lumotlari. */
export type CustomerUpdatePayload = { customerId: string; changes: Partial<Record<CustomerField, FieldChange>> };
/** `supplier.update` — ta'minotchi ma'lumotlari. */
export type SupplierUpdatePayload = { supplierId: string; changes: Partial<Record<SupplierField, FieldChange>> };
/** `product.prices` — narxlar (asosiy birlik uchun, mahsulot narx valyutasida). */
export type ProductPricesPayload = { productId: string; changes: Partial<Record<PriceField, FieldChange>> };

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
export type SupplierPayload = {
  supplierId: string;
  name: string;
  phone?: string | null;
  partyType?: PartyType;
  email?: string | null;
  address?: string | null;
  taxId?: string | null;
  contactPerson?: string | null;
  bankAccount?: string | null;
  bankMfo?: string | null;
  notes?: string | null;
};

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

// ─── Analitika ───────────────────────────────────────────────────────────────

export type AmountLine = { key: string; label: string; amount: string };
export type PartyBalance = { id: string; name: string; phone: string | null; amount: string };
export type BalanceGroup = { total: string; count: number; top: PartyBalance[] };
export type ProductStat = { productId: string; name: string; sku: string; quantity: string; revenue: string; cogs: string | null; profit: string | null };
export type CategoryStat = {
  categoryId: string | null;
  name: string;
  soldQty: string;
  revenue: string;
  cogs: string | null;
  profit: string | null;
  stockQty: string;
  stockValue: string | null;
};

/** Analitika hisoboti: serverdan (`GET /analytics`, qurilma ombori) yoki qurilmadagi hujjatlardan (offline). */
export type AnalyticsReport = {
  source: "server" | "local";
  period: { from: string; to: string };
  generatedAt: string;
  /** Qamrov izohi (qaysi ombor/kassa, nima taxminiy). */
  scope: string;
  kpis: {
    revenue: string;
    returns: string;
    netRevenue: string;
    cogs: string | null;
    grossProfit: string | null;
    /** Yalpi foyda ulushi, %. */
    margin: string | null;
    receipts: number;
    averageReceipt: string;
    itemsSold: string;
    purchases: string;
    expenses: string | null;
    stockValue: string | null;
    customers: number;
  };
  daily: { date: string; revenue: string; returns: string; profit: string | null; receipts: number }[];
  payments: AmountLine[];
  cashiers: { name: string; receipts: number; revenue: string }[];
  /** Kirim-chiqim: tushum va to'lovlar manbalari bo'yicha. */
  cashFlow: { income: AmountLine[]; expense: AmountLine[]; totalIncome: string; totalExpense: string; net: string };
  /** Mijozlar qarzi (debitorlik). */
  receivables: BalanceGroup;
  /** Mijozlarning oldindan to'lagan puli (kompaniya qarzi). */
  customerBalances: BalanceGroup;
  /** Ta'minotchilarga qarzimiz (kreditorlik). */
  payables: BalanceGroup;
  /** Ta'minotchilarga berilgan avans. */
  supplierAdvances: BalanceGroup;
  products: { top: ProductStat[]; slow: { productId: string; name: string; sku: string; stock: string; value: string | null }[] };
  categories: CategoryStat[];
};

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
  /** Aralash to'lov (naqd + karta + bank) — berilsa server paymentMethod/amountPaid o'rniga shuni oladi. */
  payments?: { method: "cash" | "card" | "bank"; amount: string }[];
  cashbackAmount?: string;
  balanceAmount?: string;
  changeToBalance?: boolean;
  saleCurrencies?: string[];
  currencyPayments?: { currency: string; amount: string; method: "cash" | "card" }[];
  /** Sotuv lahzasidagi kurslar (asosiy valyutada). */
  rates?: Record<string, string>;
  notes?: string | null;
};

export type RefundMethod = "cash" | "card" | "bank" | "balance";

/** `sale.return` — chekdagi mahsulotlarni (qisman) qaytarish. */
export type ReturnPayload = {
  returnId: string;
  orderId: string;
  shiftId: string;
  number: string;
  items: { orderItemId: string; quantity: string }[];
  refundMethod: RefundMethod;
  /** Pul usullar bo'yicha (aralash to'lovli chek). */
  refunds?: { method: RefundMethod; amount: string }[];
  reason?: string | null;
};

/** `customer.create` — kassada yangi mijoz (offline). */
export type CustomerPayload = {
  customerId: string;
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

/** Serverdagi chek (`GET /receipts/:number`) — boshqa kassa yoki web'da sotilganini qaytarish uchun. */
export type RemoteReceipt = {
  /** Usullar bo'yicha hali qaytarilishi mumkin bo'lgan pul (eski server — yo'q). */
  refundable?: { method: RefundMethod; amount: string }[];
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
  /** Kassa mavzusi qulfi (web: Sozlamalar → Kassa qurilmalari); eski server — yo'q. */
  appearance?: { locked: boolean; theme: string; custom?: unknown };
  /** Tezkor sotuv assortimenti (tartibi bilan); eski server — yo'q. */
  quickSale?: { productIds: string[] };
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
