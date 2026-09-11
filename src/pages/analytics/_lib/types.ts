/**
 * `/api/analytics/reports/*` javob turlari (apps/api/src/modules/analytics/reports.service.ts).
 * Summalar va miqdorlar — numeric satr.
 */

export type BiOverview = {
  revenue: string;
  cogs: string;
  grossProfit: string;
  expenses: string;
  netProfit: string;
  /** Foiz, masalan "23.50". */
  grossMargin: string;
  orderCount: number;
  customerCount: number;
  employeeCount: number;
  stockValue: string;
};

export type SalesSummary = {
  totalOrders: number;
  totalRevenue: string;
  paidRevenue: string;
  topProducts: { productId: string; name: string; quantity: string; revenue: string }[];
  byStatus: { status: string; count: number }[];
  dailyRevenue: { date: string; amount: string }[];
};

export type StockSummary = {
  totalProducts: number;
  totalValue: string;
  lowStock: number;
  outOfStock: number;
  /** Qiymati bo'yicha eng yirik 50 ta mahsulot. */
  abcData: { productId: string; name: string; quantity: string; value: string; abc: "A" | "B" | "C" }[];
};

export type TopCustomer = { customerId: string; name: string; amount: string; orders: number };

export type PurchaseSummary = { totalOrders: number; totalAmount: string; paidAmount: string; debtAmount: string };

export type StockVelocityRow = {
  productId: string;
  name: string;
  sku: string | null;
  stock: string;
  soldQty: string;
  /** Sotuv bo'lmasa `null` — zaxira cheksiz. */
  daysOfStock: number | null;
  velocity: "fast" | "slow" | "dead";
  value: string;
};

/** Numeric satr → son (faqat ko'rsatish uchun). */
export const num = (value: string | number | null | undefined): number => Number(value ?? 0) || 0;
