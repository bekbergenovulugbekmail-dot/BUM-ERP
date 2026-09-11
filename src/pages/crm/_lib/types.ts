/**
 * `/api/crm/*` javob turlari (apps/api/src/modules/crm/*.service.ts select maydonlari).
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

export type LeadStage = "new" | "contacted" | "qualified" | "proposal" | "won" | "lost";
export type LeadSource = "website" | "referral" | "social" | "cold_call" | "exhibition" | "other";

export type Lead = {
  id: string;
  name: string;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  source: LeadSource;
  stage: LeadStage;
  estimatedValue: string | null;
  customerId: string | null;
  salesRepId: string | null;
  expectedCloseDate: string | null;
  notes: string | null;
  lostReason: string | null;
  createdAt: string;
  updatedAt: string;
  salesRepName: string | null;
};

export type LeadStats = {
  total: number;
  openValue: string;
  wonValue: string;
  byStage: { stage: LeadStage; count: number; value: string }[];
};

export type ActivityType = "call" | "meeting" | "email" | "note" | "task";

export type Activity = {
  id: string;
  type: ActivityType;
  title: string;
  description: string | null;
  customerId: string | null;
  leadId: string | null;
  activityDate: string;
  dueDate: string | null;
  status: "planned" | "done" | "cancelled";
  outcome: string | null;
  createdAt: string;
  customerName: string | null;
  leadName: string | null;
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
