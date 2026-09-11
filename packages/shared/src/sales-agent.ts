/**
 * Sotuv agenti siyosati — kompaniya sozlamasi `sales_agent.policy` (JSON):
 * geofence, lokatsiya sifati va kuzatuv, saqlash muddati, tashrif rasmi, yetkazish kuni va nasiya qoidalari.
 * Saqlangan qiymat standart bilan birlashtiriladi — yangi maydon qo'shilsa eski sozlama buzilmaydi.
 */

/** assigned — supervayzer belgilagan kun (agent o'zgartira olmaydi); choose — agent ruxsat etilgan oraliqdan tanlaydi. */
export type DeliveryDateMode = "assigned" | "choose";

/** Kredit limitidan oshsa: buyurtma rad etiladi yoki supervayzer tasdig'iga yuboriladi. */
export type CreditLimitPolicy = "block" | "approval";

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
  /** Tashrifni yakunlashdan oldin do'kon rasmi majburiy. */
  photoRequired: boolean;
  deliveryDateMode: DeliveryDateMode;
  /** `choose` rejimida bugundan necha kungacha yetkazish kuni tanlanadi. */
  maxDeliveryDays: number;
  /** Nasiya (qarzga) buyurtmada to'lov muddati majburiy. */
  creditDueDateRequired: boolean;
  creditLimitPolicy: CreditLimitPolicy;
};

/** Raqamli maydonlar chegarasi: [min, max]. */
export const SALES_AGENT_POLICY_LIMITS = {
  geofenceRadiusMeters: [20, 5000],
  maxAccuracyMeters: [5, 1000],
  maxLocationAgeSeconds: [10, 3600],
  trackingIntervalSeconds: [15, 3600],
  maxJumpSpeedKmh: [30, 1000],
  locationRetentionDays: [7, 730],
  maxDeliveryDays: [0, 60],
} as const;

export const DEFAULT_SALES_AGENT_POLICY: SalesAgentPolicy = {
  geofenceRadiusMeters: 200,
  maxAccuracyMeters: 100,
  maxLocationAgeSeconds: 120,
  trackingIntervalSeconds: 60,
  maxJumpSpeedKmh: 150,
  locationRetentionDays: 90,
  photoRequired: false,
  deliveryDateMode: "assigned",
  maxDeliveryDays: 7,
  creditDueDateRequired: true,
  creditLimitPolicy: "block",
};

/** Agent "onlayn": oxirgi lokatsiya shuncha daqiqa ichida kelgan. */
export const AGENT_ONLINE_MINUTES = 5;
