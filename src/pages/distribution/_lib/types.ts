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

/** Hudud (Urganch, Xiva ...) — marshrutlar shu hudud tarkibida. */
export type Territory = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  routeCount: number;
};

export type DistributionRoute = {
  id: string;
  name: string;
  territoryId: string | null;
  territoryName: string | null;
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
  city: string | null;
  district: string | null;
  latitude: string | null;
  longitude: string | null;
  totalDebt: string;
};

export type RouteDetail = Omit<DistributionRoute, "customerCount"> & { customers: RouteMember[] };

/** `GET /api/distribution/map` — faol marshrutlar do'konlari (tartibda) va marshrutsiz koordinatali do'konlar. */
export type MapStore = {
  customerId: string;
  name: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
  latitude: string | null;
  longitude: string | null;
};

export type DistributionMapData = {
  routes: (DistributionRoute & { customers: (MapStore & { routeId: string; memberId: string; sortOrder: number })[] })[];
  unrouted: MapStore[];
};

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

/** `GET /api/distribution/assignments` — marshrutning aniq sanaga agentga biriktirilishi. */
export type RouteAssignment = {
  id: string;
  routeId: string;
  salesRepId: string;
  assignDate: string;
  deliveryDate: string | null;
  notes: string | null;
  routeName: string;
  routeColor: string | null;
  salesRepName: string;
};

export type CustomerOption = { id: string; name: string; phone: string | null };

// ─── Supervayzer: /api/sales-agent/supervisor/* ─────────────────────────────

export type LocationEventType =
  | "permission_denied"
  | "update_failure"
  | "low_accuracy"
  | "stale"
  | "invalid"
  | "jump"
  | "mock"
  | "geofence_block"
  | "visit_exit";

/** `GET /supervisor/agents` — faol agent, oxirgi joyi (bo'lmasa null) va bugungi marshruti. */
export type SupervisedAgent = {
  id: string;
  name: string;
  code: string;
  phone: string | null;
  region: string | null;
  latitude: string | null;
  longitude: string | null;
  accuracy: string | null;
  recordedAt: string | null;
  receivedAt: string | null;
  suspicious: boolean | null;
  hasLogin: boolean;
  /** Faol ish sessiyasi boshlangan vaqt; ish vaqti bo'lmasa `null` (lokatsiya olinmaydi). */
  workSessionStartedAt: string | null;
  online: boolean;
  todayRoutes: { id: string; name: string; deliveryDate: string | null }[];
};

/** `GET /supervisor/live`. */
export type LiveLocations = {
  locations: {
    salesRepId: string;
    name: string;
    latitude: string;
    longitude: string;
    accuracy: string | null;
    recordedAt: string;
    receivedAt: string;
    suspicious: boolean;
  }[];
  serverTime: string;
};

export type LocationEvent = {
  id: string;
  salesRepId?: string;
  salesRepName?: string;
  type: LocationEventType;
  latitude: string | null;
  longitude: string | null;
  accuracy: string | null;
  details: Record<string, unknown> | null;
  occurredAt: string;
};

export type NoOrderReason =
  | "no_money"
  | "has_stock"
  | "not_needed"
  | "has_debt"
  | "owner_absent"
  | "store_closed"
  | "competitor"
  | "price"
  | "other";
export type VisitPhotoKind = "storefront" | "shelf" | "placement" | "promotion";

/** `GET /supervisor/visits` — do'konga tashriflar. */
export type SupervisorVisit = {
  id: string;
  salesRepId: string;
  salesRepName: string;
  customerId: string;
  customerName: string;
  visitDate: string;
  status: "in_progress" | "completed";
  result: "ordered" | "no_order" | null;
  startedAt: string;
  completedAt: string | null;
  durationSeconds: number | null;
  timerStartedAt: string | null;
  pausedSeconds: number;
  outsideSince: string | null;
  outsideCount: number;
  invalidatedAt: string | null;
  startDistanceMeters: number | null;
  endDistanceMeters: number | null;
  noOrderReason: NoOrderReason | null;
  noOrderComment: string | null;
  notes: string | null;
  photos: { id: string; kind: VisitPhotoKind; takenAt: string }[];
};

export type VisitsSummary = {
  total: number;
  inProgress: number;
  ordered: number;
  noOrder: number;
  reasons: Partial<Record<NoOrderReason, number>>;
};

export type StoreVisitStatus = "waiting" | "in_progress" | "ordered" | "visited_no_order";

/** Agentning ish sessiyasi ("Ishni boshlash" — "Ishni yakunlash"). */
export type AgentWorkSession = {
  id: string;
  status: "active" | "ended";
  startedAt: string;
  endedAt: string | null;
  endReason: "agent" | "auto" | "deactivated" | null;
};

/** `GET /supervisor/agents/:salesRepId` — agent tafsiloti (bugun). */
export type AgentDetail = {
  workSessions: AgentWorkSession[];
  agent: { id: string; name: string; code: string; phone: string | null; region: string | null };
  currency: string;
  routes: { id: string; name: string; deliveryDate: string | null }[];
  stores: { id: string; name: string; address: string | null; latitude: string | null; longitude: string | null; visitStatus: StoreVisitStatus }[];
  currentVisit: { id: string; customerId: string; customerName: string; startedAt: string } | null;
  today: { salesAmount: string; orderCount: number; visitsCompleted: number; visitsRemaining: number };
};

/** `GET /supervisor/prospects` — agent topgan potentsial do'konlar. */
export type DistProspect = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  comment: string | null;
  latitude: string | null;
  longitude: string | null;
  status: "new" | "converted" | "rejected";
  customerId: string | null;
  rejectionReason: string | null;
  salesRepName: string;
  createdAt: string;
};

/** `GET /supervisor/promotions` — miqdorlar asosiy birlikda. */
export type DistPromotion = {
  id: string;
  name: string;
  description: string | null;
  type: "buy_x_get_y" | "percent_discount";
  productId: string;
  productName: string;
  minQuantity: string;
  freeQuantity: string | null;
  discountPercent: string | null;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
};

/** `GET /supervisor/orders` — agent yuborgan buyurtmalar. */
export type SupervisorOrder = {
  id: string;
  number: string;
  status: "draft" | "confirmed" | "completed" | "shipped" | "delivered" | "returned" | "cancelled";
  orderDate: string;
  deliveryDate: string | null;
  currency: string;
  totalAmount: string;
  customerName: string;
  salesRepName: string;
  paymentType: "cash" | "card" | "credit";
  paymentDueDate: string | null;
  submittedAt: string;
  submitDistanceMeters: number | null;
  approvalStatus: "pending" | "approved" | "rejected" | null;
  rejectionReason: string | null;
};

/** `GET /supervisor/agents/:id/history?date=`. */
export type AgentLocationHistory = {
  agent: { id: string; name: string; code: string };
  date: string;
  points: { latitude: string; longitude: string; accuracy: string | null; recordedAt: string; suspicious: boolean }[];
  events: LocationEvent[];
  workSessions: AgentWorkSession[];
  truncated: boolean;
};

/** Numeric satr → son (faqat ko'rsatish uchun). */
export const num = (value: string | number | null | undefined): number => Number(value ?? 0) || 0;

/** UI kuni (0 = dushanba … 6 = yakshanba) ↔ API kuni (0 = yakshanba … 6 = shanba). */
export const toApiDay = (uiDay: number) => (uiDay + 1) % 7;
export const fromApiDay = (apiDay: number) => (apiDay + 6) % 7;
