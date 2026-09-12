/**
 * Dostavka (yetkazib berish) — buyurtmadan alohida modul.
 *
 * ORDER ≠ DELIVERY: buyurtma — nima sotildi; yetkazma (DeliveryTask) — uni kim, qachon, qayerga va qanday yetkazishi.
 * Holat o'tishlari faqat serverda tekshiriladi (`canDeliveryTransition`); mijoz holatni o'zi o'zgartira olmaydi.
 */

export const DELIVERY_STATUSES = [
  "ready",
  "assigned",
  "accepted",
  "out_for_delivery",
  "arrived",
  "delivering",
  "delivered",
  "partially_delivered",
  "failed",
  "returned",
  "cancelled",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Yakunlanmagan yetkazma — bitta buyurtmada bir vaqtda bittadan ortiq bo'lmaydi. */
export const OPEN_DELIVERY_STATUSES = ["ready", "assigned", "accepted", "out_for_delivery", "arrived", "delivering"] as const satisfies readonly DeliveryStatus[];
/** Agent yo'lda (mahsulot ombordan chiqqan). */
export const ON_ROUTE_DELIVERY_STATUSES = ["out_for_delivery", "arrived", "delivering"] as const satisfies readonly DeliveryStatus[];

/**
 * Ruxsat etilgan o'tishlar. `assigned → assigned` — boshqa agentga o'tkazish; `failed → assigned|ready` — qayta
 * rejalash (mahsulot hali qaytarilmagan); qisman yetkazilganning qolgani qaytarilsa holat o'zgarmaydi (`returned_at`).
 */
export const DELIVERY_TRANSITIONS: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  ready: ["assigned", "cancelled"],
  assigned: ["accepted", "assigned", "ready", "cancelled"],
  accepted: ["out_for_delivery", "assigned", "ready", "cancelled"],
  out_for_delivery: ["arrived", "failed"],
  arrived: ["delivering", "delivered", "partially_delivered", "failed"],
  delivering: ["delivered", "partially_delivered", "failed"],
  delivered: [],
  partially_delivered: [],
  failed: ["returned", "assigned", "ready"],
  returned: [],
  cancelled: [],
};

export function canDeliveryTransition(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return DELIVERY_TRANSITIONS[from].includes(to);
}

export const isOpenDeliveryStatus = (status: DeliveryStatus) => (OPEN_DELIVERY_STATUSES as readonly string[]).includes(status);

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  ready: "Tayyor",
  assigned: "Biriktirilgan",
  accepted: "Qabul qilingan",
  out_for_delivery: "Yo'lda",
  arrived: "Yetib keldi",
  delivering: "Topshirilmoqda",
  delivered: "Yetkazildi",
  partially_delivered: "Qisman yetkazildi",
  failed: "Yetkazilmadi",
  returned: "Qaytarildi",
  cancelled: "Bekor qilindi",
};

export const DELIVERY_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type DeliveryPriority = (typeof DELIVERY_PRIORITIES)[number];
export const DELIVERY_PRIORITY_LABELS: Record<DeliveryPriority, string> = { low: "Past", normal: "Oddiy", high: "Yuqori", urgent: "Shoshilinch" };

export const DELIVERY_VEHICLE_TYPES = ["foot", "bicycle", "motorcycle", "car", "van", "truck"] as const;
export type DeliveryVehicleType = (typeof DELIVERY_VEHICLE_TYPES)[number];
export const DELIVERY_VEHICLE_LABELS: Record<DeliveryVehicleType, string> = {
  foot: "Piyoda",
  bicycle: "Velosiped",
  motorcycle: "Mototsikl",
  car: "Yengil mashina",
  van: "Furgon",
  truck: "Yuk mashinasi",
};

export const DELIVERY_FAILURE_REASONS = [
  "customer_absent",
  "address_not_found",
  "no_answer",
  "goods_not_ready",
  "payment_issue",
  "customer_refused",
  "vehicle_issue",
  "other",
] as const;
export type DeliveryFailureReason = (typeof DELIVERY_FAILURE_REASONS)[number];
export const DELIVERY_FAILURE_LABELS: Record<DeliveryFailureReason, string> = {
  customer_absent: "Mijoz yo'q",
  address_not_found: "Manzil topilmadi",
  no_answer: "Telefon javob bermadi",
  goods_not_ready: "Mahsulot tayyor emas",
  payment_issue: "To'lov muammosi",
  customer_refused: "Mijoz qabul qilmadi",
  vehicle_issue: "Mashina/transport muammosi",
  other: "Boshqa",
};

/** Yetkazishdagi to'lov turi: naqd, karta (terminal), bank o'tkazmasi yoki nasiya (yig'ilmaydi, qarzga). */
export const DELIVERY_PAYMENT_TYPES = ["cash", "card", "bank", "credit"] as const;
export type DeliveryPaymentType = (typeof DELIVERY_PAYMENT_TYPES)[number];
export const DELIVERY_PAYMENT_TYPE_LABELS: Record<DeliveryPaymentType, string> = { cash: "Naqd", card: "Karta", bank: "Bank", credit: "Nasiya" };

/** Agent qabul qiladigan pul usullari. */
export const DELIVERY_COLLECTION_METHODS = ["cash", "card", "bank"] as const;
export type DeliveryCollectionMethod = (typeof DELIVERY_COLLECTION_METHODS)[number];

/** not_required — yig'iladigan summa yo'q; mismatch — kutilgandan kam yig'ildi (siyosat bo'yicha ko'rib chiqiladi). */
export const DELIVERY_PAYMENT_STATUSES = ["not_required", "pending", "paid", "partial", "mismatch"] as const;
export type DeliveryPaymentStatus = (typeof DELIVERY_PAYMENT_STATUSES)[number];

export const DELIVERY_PAYMENT_REVIEWS = ["none", "pending", "approved", "rejected"] as const;
export type DeliveryPaymentReview = (typeof DELIVERY_PAYMENT_REVIEWS)[number];

export const DELIVERY_PROOF_KINDS = ["photo", "signature"] as const;
export type DeliveryProofKind = (typeof DELIVERY_PROOF_KINDS)[number];

/**
 * Kam yig'ilganda: approval — yetkazma tasdiqlanadi, farq supervayzer ko'rib chiqishiga tushadi; debt — farq mijoz
 * qarzida qoladi (ko'rib chiqishsiz); block — to'liq yig'ilmaguncha tasdiqlab bo'lmaydi.
 */
export const DELIVERY_MISMATCH_POLICIES = ["approval", "debt", "block"] as const;
export type DeliveryMismatchPolicy = (typeof DELIVERY_MISMATCH_POLICIES)[number];

export type DeliveryConfirmation = {
  /** Mijozga yuborilgan bir martalik kod (SMS sozlanmagan bo'lsa — supervayzer aytadi). */
  otp: boolean;
  /** Mijoz ekranda imzo qo'yadi. */
  signature: boolean;
  /** Topshirish rasmi (kamera). */
  photo: boolean;
};

export type DeliveryNotificationRecipients = {
  failed: string[];
  mismatch: string[];
  geofence: string[];
};

export type DeliveryPolicy = {
  geofenceRadiusMeters: number;
  maxAccuracyMeters: number;
  maxLocationAgeSeconds: number;
  trackingIntervalSeconds: number;
  /** Shuncha metr siljisa oraliqni kutmasdan yuboriladi. */
  trackingDistanceMeters: number;
  maxJumpSpeedKmh: number;
  locationRetentionDays: number;
  /** Tasdiqlangan buyurtma uchun yetkazma avtomatik yaratiladi (buyurtmada alohida belgilanmagan bo'lsa). */
  deliveryRequiredByDefault: boolean;
  /** Naqd/karta buyurtmada yetkazishda qoldiq yig'iladi (nasiya — yig'ilmaydi). */
  collectOnDelivery: boolean;
  /** Mijoz koordinatasi bo'lmasa "Mijozga yetdim" rad etiladi. */
  requireCustomerLocation: boolean;
  confirmation: DeliveryConfirmation;
  otpTtlMinutes: number;
  otpMaxAttempts: number;
  mismatchPolicy: DeliveryMismatchPolicy;
  /** Internet yo'q joyda amallar navbatga tushadi va keyin server qayta tekshiradi. */
  offlineActionsAllowed: boolean;
  /** Navbatdagi amal shundan eski bo'lsa — rad etiladi, soat. */
  offlineMaxAgeHours: number;
  /** Geofence buzilishida supervayzerga bildirishnoma. */
  geofenceAlerts: boolean;
  notificationRecipients: DeliveryNotificationRecipients;
};

export const DELIVERY_POLICY_LIMITS = {
  geofenceRadiusMeters: [20, 5000],
  maxAccuracyMeters: [5, 1000],
  maxLocationAgeSeconds: [10, 3600],
  trackingIntervalSeconds: [15, 3600],
  trackingDistanceMeters: [10, 5000],
  maxJumpSpeedKmh: [30, 1000],
  locationRetentionDays: [7, 730],
  otpTtlMinutes: [5, 1440],
  otpMaxAttempts: [1, 20],
  offlineMaxAgeHours: [1, 168],
} as const;

export const DEFAULT_DELIVERY_POLICY: DeliveryPolicy = {
  geofenceRadiusMeters: 200,
  maxAccuracyMeters: 100,
  maxLocationAgeSeconds: 120,
  trackingIntervalSeconds: 60,
  trackingDistanceMeters: 50,
  maxJumpSpeedKmh: 150,
  locationRetentionDays: 90,
  deliveryRequiredByDefault: false,
  collectOnDelivery: true,
  requireCustomerLocation: true,
  confirmation: { otp: false, signature: false, photo: true },
  otpTtlMinutes: 120,
  otpMaxAttempts: 5,
  mismatchPolicy: "approval",
  offlineActionsAllowed: true,
  offlineMaxAgeHours: 24,
  geofenceAlerts: true,
  notificationRecipients: { failed: [], mismatch: [], geofence: [] },
};

/** Agent "onlayn": oxirgi lokatsiya shuncha daqiqa ichida. */
export const DELIVERY_ONLINE_MINUTES = 5;
/** Bitta so'rovda yuboriladigan lokatsiya nuqtalari (oflayn yig'ilganlari). */
export const DELIVERY_LOCATION_BATCH_MAX = 20;

/** Vaqt oynasi "HH:MM". */
export const DELIVERY_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
