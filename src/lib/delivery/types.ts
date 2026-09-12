/**
 * `/api/delivery/*` javob turlari (apps/api/src/modules/delivery). Summalar va miqdorlar — numeric satr.
 */
import type {
  DeliveryCollectionMethod,
  DeliveryFailureReason,
  DeliveryPaymentReview,
  DeliveryPaymentStatus,
  DeliveryPaymentType,
  DeliveryPriority,
  DeliveryProofKind,
  DeliveryStatus,
  DeliveryVehicleType,
  Permission,
} from "@bum/shared";

export const num = (value: string | number | null | undefined) => Number(value ?? 0) || 0;

export type DeliveryWorkingSchedule = { days: number[]; start: string; end: string };

export type DeliveryAgentRow = {
  id: string;
  code: string;
  name: string | null;
  phone: string;
  userId: string;
  employeeId: string | null;
  employeeCode: string | null;
  employeeStatus: string | null;
  supervisorUserId: string | null;
  supervisorName: string | null;
  branchId: string | null;
  branchName: string | null;
  territory: string | null;
  deliveryZone: string | null;
  vehicleType: DeliveryVehicleType | null;
  vehicleNumber: string | null;
  maxLoadKg: string | null;
  workingSchedule: DeliveryWorkingSchedule | null;
  notes: string | null;
  isActive: boolean;
  loginActive: boolean;
  createdAt: string;
};

export type DeliveryMe = {
  agent: {
    id: string;
    code: string;
    name: string | null;
    phone: string;
    territory: string | null;
    deliveryZone: string | null;
    vehicleType: DeliveryVehicleType | null;
    vehicleNumber: string | null;
  };
  company: { id: string; name: string; currency: string };
  permissions: Permission[];
};

export type WorkSession = { id: string; status: "active" | "ended"; startedAt: string; endedAt: string | null; endReason: string | null };

export type DeliveryTaskRow = {
  id: string;
  number: string;
  status: DeliveryStatus;
  priority: DeliveryPriority;
  scheduledDate: string;
  windowStart: string | null;
  windowEnd: string | null;
  routeOrder: number | null;
  paymentType: DeliveryPaymentType;
  expectedAmount: string;
  collectedAmount: string;
  paymentStatus: DeliveryPaymentStatus;
  paymentReview: DeliveryPaymentReview;
  failureReason: DeliveryFailureReason | null;
  deliveryAgentId: string | null;
  agentCode: string | null;
  agentName: string | null;
  orderId: string;
  orderNumber: string;
  orderTotal: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  customerAddress: string | null;
  customerLatitude: string | null;
  customerLongitude: string | null;
  assignedAt: string | null;
  startedAt: string | null;
  arrivedAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  returnedAt: string | null;
  createdAt: string;
  overdue: boolean;
  /** Agent ro'yxatida: server hisoblagan masofa (joy berilgan bo'lsa). */
  distanceMeters?: number | null;
};

export type DeliveryTaskItem = {
  id: string;
  orderItemId: string;
  productId: string;
  productName: string;
  productSku: string;
  unitName: string;
  quantity: string;
  deliveredQty: string | null;
  returnedQty: string;
  unitPrice: string;
  value: string;
  deliveredValue: string | null;
};

export type DeliveryEvent = {
  id: string;
  action: string;
  fromStatus: DeliveryStatus | null;
  toStatus: DeliveryStatus | null;
  actorName: string | null;
  occurredAt: string;
  receivedAt: string;
  distanceMeters: number | null;
  note: string | null;
  details?: Record<string, unknown> | null;
  offline: boolean;
};

export type DeliveryTaskDetail = Omit<DeliveryTaskRow, "agentCode" | "agentName" | "orderNumber" | "orderTotal" | "customerName" | "customerPhone" | "customerAddress" | "customerLatitude" | "customerLongitude"> & {
  customerNote: string | null;
  deliveryNote: string | null;
  supervisorNote?: string | null;
  paymentReviewNote?: string | null;
  paymentReviewedAt: string | null;
  failureComment: string | null;
  cancelReason: string | null;
  acceptedAt: string | null;
  deliveringAt: string | null;
  cancelledAt: string | null;
  arrivalDistanceMeters: number | null;
  confirmDistanceMeters: number | null;
  arrivalAccuracy: string | null;
  otpIssued: boolean;
  otpVerified: boolean;
  otpExpiresAt: string | null;
  otpAttempts: number;
  signerName: string | null;
  order: { id: string; number: string; status: string; orderDate: string; totalAmount: string; paidAmount: string; currency: string };
  customer: {
    id: string;
    name: string;
    phone: string | null;
    address: string | null;
    contactName: string | null;
    latitude: string | null;
    longitude: string | null;
    totalDebt?: string;
    balance?: string;
  };
  agent: { id: string; code: string; name: string | null; phone: string } | null;
  items: DeliveryTaskItem[];
  payments: { id: string; method: DeliveryCollectionMethod; amount: string; collectedAt: string; collectedByName: string | null; offline: boolean }[];
  proofs: { id: string; kind: DeliveryProofKind; contentType: string; sizeBytes: number; signerName: string | null; distanceMeters: number | null; takenAt: string }[];
  events: DeliveryEvent[];
};

export type ConfirmSummary = {
  taskId: string;
  number: string;
  status: DeliveryStatus;
  orderNumber: string;
  orderTotal: string;
  deliveredValue: string;
  expectedAmount: string;
  collectedAmount: string;
  mismatchAmount: string;
  paymentStatus: DeliveryPaymentStatus;
  paymentReview: DeliveryPaymentReview;
  orderBalance: string;
  customerDebt?: string;
};

export type Collected = { cash: string; card: string; bank: string; total: string };

export type AgentDashboard = {
  date: string;
  tasks: { total: number; done: number; remaining: number; onRoute: number; delivered: number; partiallyDelivered: number; failed: number; returned: number; late: number };
  progressPercent: number;
  collected: Collected;
  expectedPending: string;
  mismatchAmount: string;
  customersDebt: string | null;
  workSession: WorkSession | null;
};

export type AgentCustomer = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  contactName: string | null;
  latitude: string | null;
  longitude: string | null;
  openTasks: number;
  deliveries: number;
  pendingPayments: number;
  lastDeliveredAt: string | null;
  totalDebt?: string;
};

export type AgentDebts = {
  debtors: { id: string; name: string; phone: string | null; address: string | null; totalDebt: string; lastDeliveredAt: string | null }[];
  shortfalls: (DeliveryTaskRow & { mismatchAmount: string })[];
  collections: { id: string; taskId: string; number: string; customerName: string; method: DeliveryCollectionMethod; amount: string; collectedAt: string; offline: boolean }[];
};

export type ReportDeliveries = {
  total: number;
  delivered: number;
  partiallyDelivered: number;
  failed: number;
  returned: number;
  cancelled: number;
  open: number;
  mismatch: string;
  averageMinutes: number | null;
  late: number;
};

export type AgentReport = {
  from: string;
  to: string;
  deliveries: ReportDeliveries;
  collected: Collected;
  failureReasons: { reason: DeliveryFailureReason; count: number }[];
  routeDistanceMeters: number;
};

export type SupervisorReport = {
  from: string;
  to: string;
  agents: (ReportDeliveries & { agent: { id: string; code: string; name: string | null; territory: string | null }; collected: Collected })[];
  collected: Collected;
  failureReasons: { reason: DeliveryFailureReason; count: number }[];
};

export type SupervisorDashboard = {
  date: string;
  total: number;
  unassigned: number;
  assigned: number;
  waiting: number;
  onRoute: number;
  delivered: number;
  partiallyDelivered: number;
  failed: number;
  returned: number;
  cancelled: number;
  overdue: number;
  pendingReviews: number;
  pendingReturns: number;
  collected: Collected;
  agents: { deliveryAgentId: string; name: string | null; code: string; total: number; done: number; onRoute: number; failed: number; collected: Collected }[];
};

export type LiveAgent = {
  id: string;
  code: string;
  name: string | null;
  phone: string;
  territory: string | null;
  vehicleType: DeliveryVehicleType | null;
  vehicleNumber: string | null;
  latitude: string | null;
  longitude: string | null;
  accuracy: string | null;
  recordedAt: string | null;
  receivedAt: string | null;
  suspicious: boolean | null;
  sessionStartedAt: string | null;
  onDuty: boolean;
  online: boolean;
  currentTask: { id: string; number: string; status: DeliveryStatus; customerName: string; customerLatitude: string | null; customerLongitude: string | null } | null;
  today: { total: number; done: number };
};

export type AgentTrack = {
  agent: { id: string; name: string | null };
  date: string;
  points: { latitude: string; longitude: string; accuracy: string | null; recordedAt: string; suspicious: boolean }[];
  sessions: WorkSession[];
  events: { taskId: string; number: string; action: string; latitude: string | null; longitude: string | null; distanceMeters: number | null; occurredAt: string }[];
};

export type ReadyOrder = {
  id: string;
  number: string;
  status: string;
  orderDate: string;
  deliveryDate: string | null;
  deliveryRequired: boolean | null;
  totalAmount: string;
  paidAmount: string;
  customerId: string;
  customerName: string;
  customerAddress: string | null;
  hasLocation: boolean;
};
