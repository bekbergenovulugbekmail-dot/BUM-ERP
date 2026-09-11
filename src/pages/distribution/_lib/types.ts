/**
 * `/api/distribution/*` javob turlari (apps/api/src/modules/distribution/*.service.ts select maydonlari).
 * Pul summalari — numeric satr, sanalar — ISO satr.
 */

export type SalesRep = {
  id: string;
  name: string;
  code: string;
  phone: string | null;
  email: string | null;
  userId: string | null;
  region: string | null;
  monthlyTarget: string;
  commission: string;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

/** `GET /api/distribution/sales-reps/stats` — faol agentlar va shu oy ko'rsatkichlari. */
export type SalesRepStats = SalesRep & {
  leadsThisMonth: number;
  openLeads: number;
  wonValueThisMonth: string;
  visitsThisMonth: number;
  visitSalesThisMonth: string;
};

export type DistributionRoute = {
  id: string;
  name: string;
  salesRepId: string | null;
  description: string | null;
  /** 0 = yakshanba … 6 = shanba (API qoidasi). */
  days: number[];
  color: string | null;
  isActive: boolean;
  salesRepName: string | null;
  customerCount: number;
};

export type RouteMember = {
  id: string;
  routeId: string;
  customerId: string;
  sortOrder: number;
  visitNotes: string | null;
  customerName: string;
  phone: string | null;
  address: string | null;
  totalDebt: string;
};

export type RouteDetail = Omit<DistributionRoute, "customerCount"> & { customers: RouteMember[] };

export type VisitStatus = "planned" | "in_progress" | "completed" | "cancelled";

export type RouteVisit = {
  id: string;
  routeId: string;
  salesRepId: string | null;
  visitDate: string;
  status: VisitStatus;
  customersVisited: number;
  ordersCreated: number;
  totalAmount: string;
  notes: string | null;
  routeName: string;
  salesRepName: string | null;
};

export type CustomerOption = { id: string; name: string; phone: string | null };

/** Numeric satr → son (faqat ko'rsatish uchun). */
export const num = (value: string | number | null | undefined): number => Number(value ?? 0) || 0;

/** UI kuni (0 = dushanba … 6 = yakshanba) ↔ API kuni (0 = yakshanba … 6 = shanba). */
export const toApiDay = (uiDay: number) => (uiDay + 1) % 7;
export const fromApiDay = (apiDay: number) => (apiDay + 6) % 7;
