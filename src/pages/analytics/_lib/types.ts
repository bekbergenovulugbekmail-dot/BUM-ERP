/**
 * `/api/analytics/reports/*` javob turlari (apps/api/src/modules/analytics/reports.service.ts).
 * Summalar va miqdorlar — numeric satr.
 */

export type BiOverview = {
  revenue: string;
  expenses: string;
  orderCount: number;
  customerCount: number;
  employeeCount: number;
  stockValue: string;
  /**
   * Foyda ko'rsatkichlari — `analytics.view_profit` ruxsati bo'lmasa server `null` qaytaradi
   * (`profitHidden: true`). Daromad va xarajat esa hammaga ochiq.
   */
  cogs: string | null;
  grossProfit: string | null;
  netProfit: string | null;
  /** Foiz, masalan "23.50". */
  grossMargin: string | null;
  profitHidden: boolean;
};

export type SalesSummary = {
  totalOrders: number;
  totalRevenue: string;
  paidRevenue: string;
  topProducts: { productId: string; name: string; quantity: string; revenue: string }[];
  byStatus: { status: string; count: number }[];
  dailyRevenue: { date: string; amount: string }[];
};

/** Tannarxga bog'liq maydonlar (`totalValue`, `abcData[].value`) `products.view_cost` ruxsatisiz `null`. */
export type StockSummary = {
  totalProducts: number;
  totalValue: string | null;
  lowStock: number;
  outOfStock: number;
  /** Qiymati bo'yicha eng yirik 50 ta mahsulot. */
  abcData: { productId: string; name: string; quantity: string; value: string | null; abc: "A" | "B" | "C" }[];
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
  /** Qoldiq qiymati (tannarxdan): `products.view_cost` ruxsatisiz `null`. */
  value: string | null;
};

/** Numeric satr → son (faqat ko'rsatish uchun). */
export const num = (value: string | number | null | undefined): number => Number(value ?? 0) || 0;
