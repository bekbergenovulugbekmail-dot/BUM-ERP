/**
 * `/api/purchase` javob turlari (apps/api/src/modules/purchase). Summa va miqdorlar — numeric satr.
 */
export type PurchaseOrderStatus = "draft" | "confirmed" | "partial" | "received" | "invoiced" | "paid" | "cancelled";
export type PaymentMethod = "cash" | "bank" | "card" | "transfer";

export type Supplier = {
  id: string;
  name: string;
  code: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxId: string | null;
  bankAccount: string | null;
  paymentTermDays: number;
  currency: string;
  totalDebt: string;
  totalPurchased: string;
  isActive: boolean;
  notes: string | null;
};

export type PurchaseOrderRow = {
  id: string;
  number: string;
  supplierId: string;
  warehouseId: string;
  status: PurchaseOrderStatus;
  orderDate: string;
  expectedDate: string | null;
  currency: string;
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  totalAmount: string;
  paidAmount: string;
  notes: string | null;
  createdAt: string;
  supplierName: string;
  warehouseName: string;
  itemCount: number;
  balance: string;
};

export type PurchaseOrderItem = {
  id: string;
  productId: string;
  unitId: string;
  orderedQty: string;
  receivedQty: string;
  unitPrice: string;
  taxRate: string;
  discountPercent: string;
  lineTotal: string;
  notes: string | null;
  productName: string;
  productSku: string;
  unitName: string;
  pendingQty: string;
};

export type PurchaseReceipt = { id: string; receiptDate: string; notes: string | null; createdAt: string };

export type SupplierPayment = {
  id: string;
  amount: string;
  method: PaymentMethod;
  paymentDate: string;
  reference: string | null;
  notes: string | null;
};

export type PurchaseOrderDetail = Omit<PurchaseOrderRow, "itemCount"> & {
  supplierPhone: string | null;
  items: PurchaseOrderItem[];
  receipts: PurchaseReceipt[];
  payments: SupplierPayment[];
};

/** `/api/inventory/warehouses` — tanlash uchun kerakli maydonlar. */
export type WarehouseOption = { id: string; name: string; code: string; isDefault: boolean; isActive: boolean };

/** `/api/catalog/products` — tanlash uchun kerakli maydonlar. */
export type ProductOption = {
  id: string;
  name: string;
  sku: string;
  baseUnitId: string;
  purchasePrice: string;
  taxRate: string;
  isActive: boolean;
  isPurchaseable: boolean;
};

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: "Naqd",
  bank: "Bank",
  card: "Karta",
  transfer: "O'tkazma",
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
