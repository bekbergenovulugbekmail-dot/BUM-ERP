/**
 * `/api/sales` (POS bilan) javob turlari — apps/api/src/modules/sales. Summa va miqdorlar — numeric satr.
 */
import type { CompanyInfo } from "@/lib/pdf/pdf-utils.ts";
import type { ActiveCompany } from "@/hooks/use-company.ts";

export type SalesOrderStatus = "draft" | "confirmed" | "shipped" | "delivered" | "returned" | "cancelled";
/** `balance` — mijoz balansidan (faqat server yozadi: POS va qarz to'lovi). */
export type PaymentMethod = "cash" | "bank" | "card" | "transfer" | "balance";

export type Customer = {
  id: string;
  name: string;
  code: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxId: string | null;
  discountPercent: string;
  creditLimit: string;
  paymentTermDays: number;
  currency: string;
  totalDebt: string;
  totalPurchased: string;
  /** Oldindan to'langan pul (hamyon) — qarzdan alohida. */
  balance: string;
  isActive: boolean;
  notes: string | null;
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
  notes: string | null;
  productName: string;
  productSku: string;
  unitName: string;
};

export type CustomerPayment = {
  id: string;
  amount: string;
  method: PaymentMethod;
  paymentDate: string;
  reference: string | null;
  notes: string | null;
};

export type SalesOrderDetail = Omit<SalesOrderRow, "itemCount"> & {
  customerPhone: string | null;
  items: SalesOrderItem[];
  payments: CustomerPayment[];
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
  receiptCount: number;
  notes: string | null;
  warehouseName: string;
  /** Boshlang'ich naqd + naqd tushum. */
  expectedCash: string;
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
  taxRate: string;
  taxIncluded: boolean;
  isActive: boolean;
  isSaleable: boolean;
};

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: "Naqd",
  bank: "Bank",
  card: "Karta",
  transfer: "O'tkazma",
  balance: "Balansdan",
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
