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
  /** Faqat bugungi marshrutda (`/today`): shu kungi tashrif holati. */
  visitStatus?: StoreVisitStatus;
};

/** Bugungi marshrutdagi do'kon holati. */
export type StoreVisitStatus = "waiting" | "in_progress" | "ordered" | "visited_no_order";

export const NO_ORDER_REASONS = ["no_money", "has_stock", "has_debt", "owner_absent", "competitor", "price", "other"] as const;
export type NoOrderReason = (typeof NO_ORDER_REASONS)[number];

export const PHOTO_KINDS = ["storefront", "shelf", "placement", "promotion"] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

/** `/api/sales-agent/visits/*` — do'konga tashrif. */
export type AgentVisit = {
  id: string;
  customerId: string;
  customerName: string;
  routeId: string | null;
  visitDate: string;
  status: "in_progress" | "completed";
  result: "ordered" | "no_order" | null;
  startedAt: string;
  completedAt: string | null;
  durationSeconds: number | null;
  startDistanceMeters: number | null;
  endDistanceMeters: number | null;
  noOrderReason: NoOrderReason | null;
  noOrderComment: string | null;
  notes: string | null;
  photos: { id: string; kind: PhotoKind; takenAt: string }[];
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
  /** Agentning shu do'konga bugungi oxirgi tashrifi. */
  todayVisit: AgentVisit | null;
};

export type DebtorStatus = "overdue" | "today" | "soon" | "later" | "unscheduled";
export type Debtor = AgentStore & { dueDate: string | null; daysOverdue: number | null; status: DebtorStatus };

export const num = (value: string | number | null | undefined): number => Number(value ?? 0) || 0;

export type PaymentType = "cash" | "card" | "credit";

/** `GET /api/sales-agent/dashboard` — summalar asosiy valyutada (agent yuborgan, bekor qilinmagan buyurtmalar). */
export type AgentDashboard = {
  date: string;
  currency: string;
  today: {
    salesAmount: string;
    orderCount: number;
    creditSalesAmount: string;
    collectedAmount: string;
    plannedStores: number;
    visitedStores: number;
    orderedStores: number;
    remainingStores: number;
    dailyTarget: string;
    remainingToday: string;
  };
  month: {
    target: string;
    achieved: string;
    percent: number;
    remaining: string;
    remainingDays: number;
    requiredDaily: string;
    orderCount: number;
    bestDay: { date: string; amount: string } | null;
  };
  rank: { position: number; total: number } | null;
  prospectsThisMonth: number;
};

export type ProspectStatus = "new" | "converted" | "rejected";

/** `/api/sales-agent/prospects` — agent topgan potentsial do'kon. */
export type Prospect = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  comment: string | null;
  latitude: string | null;
  longitude: string | null;
  status: ProspectStatus;
  customerId: string | null;
  rejectionReason: string | null;
  salesRepName: string;
  createdAt: string;
};

export type PromotionType = "buy_x_get_y" | "percent_discount";

/** `GET /api/sales-agent/promotions` va katalogdagi mahsulot aksiyalari (miqdor — asosiy birlikda). */
export type Promotion = {
  id: string;
  name: string;
  description: string | null;
  type: PromotionType;
  productId: string;
  productName: string;
  minQuantity: string;
  freeQuantity: string | null;
  discountPercent: string | null;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
};

/** "10 ta olsangiz 1 ta bepul", "5 tadan 10% chegirma". */
export function promotionRule(
  promotion: Pick<Promotion, "type" | "minQuantity" | "freeQuantity" | "discountPercent">,
  t: TFunction<"agent">,
): string {
  return promotion.type === "buy_x_get_y"
    ? t("promo.rule.bxgy", { min: num(promotion.minQuantity), free: num(promotion.freeQuantity) })
    : t("promo.rule.percent", { min: num(promotion.minQuantity), percent: num(promotion.discountPercent) });
}

/** `GET /api/sales-agent/catalog` — narxlar asosiy valyutada, qoldiq asosiy birlikda. */
export type CatalogProduct = {
  id: string;
  name: string;
  sku: string;
  categoryId: string | null;
  unitName: string;
  hasImage: boolean;
  available: string;
  piecePrice: string;
  box: { unitId: string; unitName: string; factor: string; price: string } | null;
  promotions: Promotion[];
};

export type AgentOrderLine = { productId: string; pieces: string; boxes: string; boxUnitId: string | null; boxFactor: string | null };

/** `/api/sales-agent/orders/*` — agent buyurtmasi (ro'yxatda `items` yo'q). */
export type AgentOrder = {
  id: string;
  number: string;
  status: OrderStatus;
  orderDate: string;
  deliveryDate: string | null;
  currency: string;
  totalAmount: string;
  paidAmount: string;
  notes: string | null;
  customerId: string;
  customerName: string;
  visitId: string | null;
  clientRequestId: string;
  paymentType: PaymentType;
  paymentDueDate: string | null;
  lines: AgentOrderLine[];
  submittedAt: string | null;
  submitDistanceMeters: number | null;
  approvalStatus: "pending" | "approved" | "rejected" | null;
  rejectionReason: string | null;
  updatedAt: string;
  items?: { productId: string; productName: string; quantity: string; unitPrice: string; discountPercent: string; lineTotal: string }[];
  /** Server qo'llagan aksiyalar (qoida nusxasi bilan). */
  promotions?: {
    promotionId: string;
    productId: string;
    rule: { name: string; type: PromotionType; minQuantity: string; freeQuantity: string | null; discountPercent: string | null };
    paidQuantity: string;
    freeQuantity: string;
    discountAmount: string;
  }[];
};

/** Taymer: "4:05", "1:02:09". */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** "87 m", "1,7 km". */
export function formatDistance(meters: number | null, t: TFunction<"agent">): string | null {
  if (meters === null) return null;
  if (meters < 1000) return t("distance.m", { value: Math.round(meters) });
  return t("distance.km", { value: new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 1 }).format(meters / 1000) });
}
