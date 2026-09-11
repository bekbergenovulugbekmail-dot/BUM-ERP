/**
 * `/api/crm/*` javob turlari (apps/api/src/modules/crm/*.service.ts select maydonlari).
 * Pul summalari — numeric satr, sanalar — ISO satr.
 */

/** `GET /api/crm/sales-reps` — lidga agent tanlash uchun (to'liq ma'lumot — /api/distribution). */
export type SalesRepOption = { id: string; name: string; code: string };

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

export type CustomerOption = { id: string; name: string; phone: string | null };

/** Numeric satr → son (faqat ko'rsatish uchun). */
export const num = (value: string | number | null | undefined): number => Number(value ?? 0) || 0;
