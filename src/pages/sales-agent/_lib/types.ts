/**
 * `/api/sales-agent/*` javob turlari (apps/api/src/modules/sales-agent). Summalar — numeric satr.
 */
import type { TFunction } from "i18next";

/** `GET /api/sales-agent/me` — tizimga kirgan foydalanuvchiga bog'langan savdo agenti. */
export type AgentMe = {
  agent: {
    id: string;
    name: string;
    code: string;
    phone: string | null;
    region: string | null;
    monthlyTarget: string;
  };
  company: { id: string; name: string; currency: string };
};

export type AgentStore = {
  id: string;
  name: string;
  code: string;
  phone: string | null;
  address: string | null;
  contactName: string | null;
  latitude: string | null;
  longitude: string | null;
  totalDebt: string;
  creditLimit: string;
  routeId: string;
  routeName: string;
  sortOrder: number;
  lastOrderDate: string | null;
  /** Server hisoblagan masofa (metr); joy yoki do'kon koordinatasi bo'lmasa null. */
  distanceMeters: number | null;
};

export type TodayRoute = { id: string; name: string; color: string | null; days: number[]; deliveryDate: string | null };

/** `GET /api/sales-agent/today`. */
export type AgentToday = { date: string; routes: TodayRoute[]; stores: AgentStore[] };

export type OrderStatus = "draft" | "confirmed" | "shipped" | "delivered" | "returned" | "cancelled";

/** `GET /api/sales-agent/stores/:id`. */
export type StoreProfile = AgentStore & {
  balance: string;
  paymentTermDays: number;
  notes: string | null;
  /** null — kredit limiti cheklanmagan. */
  availableCredit: string | null;
  routes: { id: string; name: string }[];
  /** 0 = yakshanba … 6 = shanba. */
  visitDays: number[];
  ordersLast90Days: { count: number; total: string };
  recentOrders: { id: string; number: string; orderDate: string; status: OrderStatus; totalAmount: string; paidAmount: string }[];
};

export type DebtorStatus = "overdue" | "today" | "soon" | "later" | "unscheduled";
export type Debtor = AgentStore & { dueDate: string | null; daysOverdue: number | null; status: DebtorStatus };

export const num = (value: string | number | null | undefined): number => Number(value ?? 0) || 0;

/** "87 m", "1,7 km". */
export function formatDistance(meters: number | null, t: TFunction<"agent">): string | null {
  if (meters === null) return null;
  if (meters < 1000) return t("distance.m", { value: Math.round(meters) });
  return t("distance.km", { value: new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 1 }).format(meters / 1000) });
}
