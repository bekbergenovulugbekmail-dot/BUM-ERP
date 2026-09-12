/**
 * Sotuv agenti siyosati — kompaniya sozlamasi `sales_agent.policy` (JSON):
 * geofence, lokatsiya sifati va kuzatuv, saqlash muddati, tashrif (rasmlar, minimal vaqt, hududdan chiqish),
 * yetkazish kuni va nasiya qoidalari.
 * Saqlangan qiymat standart bilan birlashtiriladi — yangi maydon qo'shilsa eski sozlama buzilmaydi.
 */

/** assigned — supervayzer belgilagan kun (agent o'zgartira olmaydi); choose — agent ruxsat etilgan oraliqdan tanlaydi. */
export type DeliveryDateMode = "assigned" | "choose";

/** Kredit limitidan oshsa: buyurtma rad etiladi yoki supervayzer tasdig'iga yuboriladi. */
export type CreditLimitPolicy = "block" | "approval";

/**
 * Tashrif paytida agent do'kon hududidan chiqsa: pause — tashqaridagi vaqt hisoblanmaydi; invalidate — tashrif
 * bekor (buyurtmaga yaroqsiz, faqat yopiladi); flag — vaqt hisoblanadi, chiqish qayd etiladi.
 */
export type VisitExitPolicy = "pause" | "invalidate" | "flag";

/**
 * Bildirishnoma oluvchilar (foydalanuvchi ID'lari) hodisa bo'yicha; bo'sh ro'yxat — standart: `sales_agent.supervise`
 * ruxsati bor va to'liq huquqli faol a'zolar.
 */
export type NotificationRecipients = {
  /** Geofence buzilishi (uzoqdan buyurtma urinishi). */
  geofence: string[];
  /** Buyurtma supervayzer tasdig'ini kutmoqda. */
  approval: string[];
  /** Kredit limiti oshdi (buyurtma rad etildi). */
  creditLimit: string[];
};

export type SalesAgentPolicy = {
  /** Buyurtma berish uchun do'kondan ruxsat etilgan masofa, metr. */
  geofenceRadiusMeters: number;
  /** GPS aniqligi shundan yomon bo'lsa — lokatsiya qabul qilinmaydi, metr. */
  maxAccuracyMeters: number;
  /** Lokatsiya shundan eski bo'lsa — qabul qilinmaydi, soniya. */
  maxLocationAgeSeconds: number;
  /** Kuzatuvda lokatsiya yuborish oralig'i, soniya. */
  trackingIntervalSeconds: number;
  /** Ikki nuqta orasidagi tezlik shundan oshsa — shubhali sakrash, km/soat. */
  maxJumpSpeedKmh: number;
  /** Lokatsiya tarixi saqlanadigan kunlar (keyin avtomatik o'chiriladi). */
  locationRetentionDays: number;
  /** Tashrifning minimal davomiyligi (vitrina rasmidan), daqiqa; "Do'kon yopiq" uchun talab qilinmaydi. */
  minVisitMinutes: number;
  /** Tashrif vitrina rasmidan boshlanadi (taymer shundan). */
  storefrontPhotoRequired: boolean;
  /** Buyurtma yoki buyurtmasiz yakunlashdan oldin polka rasmi. */
  shelfPhotoRequired: boolean;
  visitExitPolicy: VisitExitPolicy;
  /** Buyurtma faqat do'kondagi ochiq tashrifda (rasmlar va minimal vaqtdan keyin) yuboriladi. */
  orderRequiresVisit: boolean;
  deliveryDateMode: DeliveryDateMode;
  /** `choose` rejimida bugundan necha kungacha yetkazish kuni tanlanadi. */
  maxDeliveryDays: number;
  /** Nasiya (qarzga) buyurtmada to'lov muddati majburiy. */
  creditDueDateRequired: boolean;
  creditLimitPolicy: CreditLimitPolicy;
  notificationRecipients: NotificationRecipients;
};

/** Raqamli maydonlar chegarasi: [min, max]. */
export const SALES_AGENT_POLICY_LIMITS = {
  geofenceRadiusMeters: [20, 5000],
  maxAccuracyMeters: [5, 1000],
  maxLocationAgeSeconds: [10, 3600],
  trackingIntervalSeconds: [15, 3600],
  maxJumpSpeedKmh: [30, 1000],
  locationRetentionDays: [7, 730],
  minVisitMinutes: [0, 120],
  maxDeliveryDays: [0, 60],
} as const;

/** Sozlamada tez tanlanadigan geofence radiuslari, metr. */
export const GEOFENCE_RADIUS_PRESETS = [100, 200, 300, 500] as const;

export const DEFAULT_SALES_AGENT_POLICY: SalesAgentPolicy = {
  geofenceRadiusMeters: 200,
  maxAccuracyMeters: 100,
  maxLocationAgeSeconds: 120,
  trackingIntervalSeconds: 60,
  maxJumpSpeedKmh: 150,
  locationRetentionDays: 90,
  minVisitMinutes: 10,
  storefrontPhotoRequired: true,
  shelfPhotoRequired: true,
  visitExitPolicy: "pause",
  orderRequiresVisit: true,
  deliveryDateMode: "assigned",
  maxDeliveryDays: 7,
  creditDueDateRequired: true,
  creditLimitPolicy: "block",
  notificationRecipients: { geofence: [], approval: [], creditLimit: [] },
};

/** Agent "onlayn": oxirgi lokatsiya shuncha daqiqa ichida kelgan. */
export const AGENT_ONLINE_MINUTES = 5;
