/**
 * `/api/sales` (POS bilan) javob turlari — apps/api/src/modules/sales. Summa va miqdorlar — numeric satr.
 */
import type { CompanyInfo } from "@/lib/pdf/pdf-utils.ts";
import type { ActiveCompany } from "@/hooks/use-company.ts";

/**
 * Sotuv hujjatining holati — yetkazish holati emas (u `delivery` modulida), to'lov holati ham emas
 * (u `paymentStatus` da). `shipped` va `delivered` — eski yozuvlar, ma'nosi `completed` bilan bir xil.
 */
export type SalesOrderStatus = "draft" | "confirmed" | "completed" | "shipped" | "delivered" | "returned" | "cancelled";
/** To'lov holati — summalardan hisoblanadi, serverdan keladi. */
export type SalePaymentStatus = "unpaid" | "partial" | "paid";
/** Yetkazma holati — sotuv holatidan mustaqil; yetkazma ochilmagan bo'lsa `null`. */
export type SaleDeliveryStatus =
  | "ready" | "assigned" | "accepted" | "out_for_delivery" | "arrived"
  | "delivering" | "delivered" | "partially_delivered" | "failed" | "returned" | "cancelled";
/** `balance` — mijoz balansidan, `cashback` — keshbekdan (faqat server yozadi: POS va qarz to'lovi). */
export type PaymentMethod = "cash" | "bank" | "card" | "transfer" | "balance" | "cashback";

export type Customer = {
  id: string;
  name: string;
  code: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxId: string | null;
  /** Jismoniy yoki yuridik shaxs. */
  partyType: "individual" | "legal";
  bankAccount: string | null;
  bankMfo: string | null;
  /** Do'kon egasi yoki mas'ul shaxs. */
  contactName: string | null;
  /** Do'kon joylashuvi (numeric satr); agent masofasi va geofence uchun. */
  latitude: string | null;
  longitude: string | null;
  /** Hudud: shahar/tuman va mahalla (dostavkani hudud bo'yicha taqsimlash). */
  city: string | null;
  district: string | null;
  discountPercent: string;
  creditLimit: string;
  paymentTermDays: number;
  currency: string;
  totalDebt: string;
  totalPurchased: string;
  /** Oldindan to'langan pul (hamyon) — qarzdan alohida. */
  balance: string;
  /** Keshbek hisobi — pul balansidan alohida. */
  cashbackBalance: string;
  isActive: boolean;
  notes: string | null;
  /**
   * Kredit holati: `ok` — cheklovsiz, `hold` — NASIYA sotuv rad etiladi.
   * Naqd sotuv va qarzni to'lash hech qachon bloklanmaydi.
   */
  creditStatus: "ok" | "hold";
  creditHoldReason: string | null;
  creditHoldAt: string | null;
};

/** POS javobidagi mijoz holati (sotuv yoki to'lovdan keyin). */
export type PosCustomerSummary = {
  id: string;
  name: string;
  code: string;
  phone: string | null;
  balance: string;
  totalDebt: string;
  creditLimit: string;
  cashbackBalance: string;
};

export type SalesOrderRow = {
  id: string;
  number: string;
  customerId: string | null;
  warehouseId: string;
  status: SalesOrderStatus;
  orderDate: string;
  deliveryDate: string | null;
  currency: string;
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  totalAmount: string;
  paidAmount: string;
  isPos: boolean;
  posShiftId: string | null;
  notes: string | null;
  createdAt: string;
  /** Mijozsiz (anonim) sotuvda null. */
  customerName: string | null;
  warehouseName: string;
  itemCount: number;
  balance: string;
  paymentStatus: SalePaymentStatus;
  /** Yetkazma ochilmagan bo'lsa null (kassa cheki, olib ketish). */
  deliveryStatus: SaleDeliveryStatus | null;
};

export type SalesOrderItem = {
  id: string;
  productId: string;
  unitId: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  discountPercent: string;
  lineTotal: string;
  costPrice: string;
  /** Chek valyutasi (POS sotuv valyutalari); null — asosiy. `currencyTotal` shu valyutada, `lineTotal` — asosiyda. */
  priceCurrency: string | null;
  priceRate: string;
  currencyTotal: string;
  notes: string | null;
  productName: string;
  productSku: string;
  unitName: string;
  /** Shu qatordan allaqachon qaytarilgan miqdor (qator birligida). */
  returnedQty: string;
  /** Omborda band qilingan miqdor (asosiy birlikda) — tasdiqlangan, jo'natilmagan buyurtmada. */
  reservedQty: string;
};

/** Qaytarish hujjati va uning qatorlari (nakladnoy ichidan qisman qaytarish tarixi). */
export type SalesReturnRecord = {
  id: string;
  number: string;
  totalAmount: string;
  refundMethod: string;
  refundAmount: string;
  reason: string | null;
  createdAt: string;
  /** Kim qabul qilgan (hisob o'chirilgan bo'lsa null). */
  createdByName: string | null;
  items: {
    orderItemId: string;
    productId: string;
    productName: string;
    quantity: string;
    lineTotal: string;
  }[];
};

export type CustomerPayment = {
  id: string;
  /** Asosiy valyutada; chet valyutadagi to'lovda `foreignAmount` — `currency` da. */
  amount: string;
  currency: string;
  foreignAmount: string;
  method: PaymentMethod;
  paymentDate: string;
  reference: string | null;
  notes: string | null;
};

export type SalesOrderDetail = Omit<SalesOrderRow, "itemCount"> & {
  customerPhone: string | null;
  /** Chet valyuta qatnashgan chekda: valyuta bo'yicha jami va to'langan. */
  currencyTotals: { currency: string; totalAmount: string; paidAmount: string }[];
  /** Shu buyurtmadan mijozga berilgan keshbek. */
  cashbackEarned: string;
  items: SalesOrderItem[];
  payments: CustomerPayment[];
  /** Qaytarish tarixi — eng eskisidan boshlab. */
  returns: SalesReturnRecord[];
};

export type SalesStats = {
  totalThisMonth: string;
  countThisMonth: number;
  todayCount: number;
  pendingPayment: number;
  totalDebt: string;
};

export type PosShift = {
  id: string;
  warehouseId: string;
  cashierId: string | null;
  cashierName: string | null;
  status: "open" | "closed";
  openedAt: string;
  closedAt: string | null;
  openingCash: string;
  closingCash: string | null;
  totalSales: string;
  totalCash: string;
  totalCard: string;
  /** Bank va o'tkazma orqali tushum — naqd va kartadan alohida. */
  totalBank: string;
  /** Smenada qaytarilgan mahsulotlar summasi. */
  totalReturns: string;
  /** Kassaga kirim va kassadan chiqim — kutilayotgan naqdga kiradi. */
  cashIn: string;
  cashOut: string;
  receiptCount: number;
  notes: string | null;
  warehouseName: string;
  /** Boshlang'ich naqd + naqd tushum. */
  expectedCash: string;
  /** Chet valyutada: boshlang'ich naqd, naqd va karta tushumi, yopilishda sanalgan naqd — `{ USD: "20.00" }`. */
  openingForeignCash: Record<string, string>;
  foreignCash: Record<string, string>;
  foreignCard: Record<string, string>;
  closingForeignCash: Record<string, string> | null;
  /** Usul va terminal kesimidagi tushum — smenani yopishda solishtirish uchun (server hisoblaydi). */
  payments?: {
    method: string;
    terminalId: string | null;
    terminalName: string | null;
    network: string | null;
    accountName: string | null;
    amount: string;
    count: number;
  }[];
  /** Yopilishdagi kassa farqi; `pending` — savdo siyosatidagi chegaradan oshdi, rahbar ko'rib chiqadi. */
  cashDifference?: string | null;
  differenceReview?: "pending" | "approved" | "rejected" | null;
  differenceReviewNote?: string | null;
  differenceReviewedAt?: string | null;
};

/** `/api/inventory/warehouses` — tanlash uchun kerakli maydonlar. */
export type WarehouseOption = { id: string; name: string; code: string; isDefault: boolean; isActive: boolean };

/** `/api/catalog/products` — tanlash uchun kerakli maydonlar. */
export type ProductOption = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  baseUnitId: string;
  salesPrice: string;
  /** Narx valyutasi; null — asosiy valyuta. Sotuvda joriy kurs bilan hisoblanadi. */
  salesCurrency: string | null;
  /** Aksiya narxi (sotuv narxi valyutasida) va oxirgi kuni; POS da server shu narxni qo'llaydi. */
  promoPrice?: string | null;
  promoPriceEnd?: string | null;
  taxRate: string;
  taxIncluded: boolean;
  isActive: boolean;
  isSaleable: boolean;
  /** Rasm kaliti (StorageService) — kassada mahsulot rasmi shu bo'yicha ko'rsatiladi; null — rasm yo'q. */
  imageKey?: string | null;
  /** O'lchov birligi qisqartmasi ("d", "kg") — kassada narx yonida. */
  baseUnitName?: string | null;
  /** Minimal qoldiq — kassada "Kam" holatini ko'rsatish uchun. */
  minStock?: string | null;
};

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: "Naqd",
  bank: "Bank",
  card: "Karta",
  transfer: "O'tkazma",
  balance: "Balansdan",
  cashback: "Keshbekdan",
};

/** Faqat ko'rsatish va oldindan hisoblash uchun — aniq summa serverda. */
export const num = (value: string | number | null | undefined) => Number(value ?? 0) || 0;

/** Ikki marta bosishdan himoya: bitta forma — bitta reference, takroriy so'rovga server mavjud to'lovni qaytaradi. */
export const newReference = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

/** Foydalanuvchining mahalliy sanasi (UTC emas). */
export function todayLocal(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function companyInfo(company: ActiveCompany | undefined): CompanyInfo {
  return {
    name: company?.name ?? "BUM ERP",
    legalName: company?.legalName ?? undefined,
    taxId: company?.taxId ?? undefined,
    address: company?.address ?? undefined,
    phone: company?.phone ?? undefined,
    email: company?.email ?? undefined,
    website: company?.website ?? undefined,
  };
}
