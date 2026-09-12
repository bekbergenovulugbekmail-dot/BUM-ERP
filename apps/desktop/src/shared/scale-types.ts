/**
 * Tarozilar: sozlama, holat va sinxron navbati turlari (main va renderer uchun umumiy, Node API'siz).
 *
 * Halollik qoidasi: almashinuv protokoli hujjat bilan tasdiqlanmagan tarozi (Shtrix-M, YES POS, Rongta) ga buyruq
 * yuborilmaydi va "ulandi" / "yuborildi" deb ko'rsatilmaydi — faqat tarmoq porti ochiqligi tekshiriladi va nima
 * hujjat kerakligi aytiladi. Ishlaydiganlari: simulyator (uskunasiz sinov) va umumiy ASCII og'irlik satri.
 */
export const SCALE_PROVIDERS = ["simulator", "generic-ascii", "shtrih-m", "yes-pos", "rongta"] as const;
export type ScaleProviderId = (typeof SCALE_PROVIDERS)[number];

/** `serial` — COM port; USB tarozilar odatda virtual COM port sifatida ko'rinadi. */
export type ScaleTransport = "tcp" | "serial" | "none";

export type ScaleCapabilities = {
  /** Og'irlikni o'qib savatga qo'shish. */
  readWeight: boolean;
  /** Mahsulotlarni (PLU) taroziga yuborish va o'chirish. */
  uploadProducts: boolean;
  /** Tarozidagi PLU ro'yxatini o'qish (solishtirish uchun). */
  listProducts: boolean;
};

export type ScaleProviderInfo = {
  label: string;
  transports: ScaleTransport[];
  capabilities: ScaleCapabilities;
  /** Protokol hujjati yo'q — qanday hujjat kerak (null — adapter ishlaydi). */
  docsRequired: string | null;
  note: string;
};

const NO_CAPABILITIES: ScaleCapabilities = { readWeight: false, uploadProducts: false, listProducts: false };
const UNVERIFIED_NOTE = "Protokol tasdiqlanmagan: faqat tarmoq porti tekshiriladi, taroziga hech qanday buyruq yuborilmaydi.";

export const SCALE_PROVIDER_INFO: Record<ScaleProviderId, ScaleProviderInfo> = {
  simulator: {
    label: "Simulyator (sinov)",
    transports: ["none"],
    capabilities: { readWeight: true, uploadProducts: true, listProducts: true },
    docsRequired: null,
    note: "Haqiqiy tarozi emas: sozlama, navbat, to'liq sinxron va solishtirishni uskunasiz sinash uchun. Og'irlik — sozlamadagi qiymat.",
  },
  "generic-ascii": {
    label: "Umumiy ASCII (og'irlik satri)",
    transports: ["tcp", "serial"],
    capabilities: { readWeight: true, uploadProducts: false, listProducts: false },
    docsRequired: null,
    note: "Tarozi og'irlikni matn satri bilan yuborsa (masalan «ST,GS,+  1.234kg»): o'zi uzluksiz yoki so'rov buyrug'iga javoban. Mahsulot yuborilmaydi.",
  },
  "shtrih-m": {
    label: "Shtrix-M (Штрих-Принт)",
    transports: ["tcp", "serial"],
    capabilities: NO_CAPABILITIES,
    docsRequired:
      "Shtrix-M almashinuv protokoli hujjati kerak: kadr formati va nazorat summasi, parol, PLU yozish/o'chirish va og'irlik so'rash buyruqlari, javob va xato kodlari, TCP porti.",
    note: UNVERIFIED_NOTE,
  },
  "yes-pos": {
    label: "YES POS",
    transports: ["tcp", "serial"],
    capabilities: NO_CAPABILITIES,
    docsRequired:
      "YES POS tarozi protokoli hujjati kerak: ulanish porti va tezligi, PLU yozuvi formati (maydonlar, kodirovka), yozish/o'chirish va og'irlik buyruqlari, javob kodlari.",
    note: UNVERIFIED_NOTE,
  },
  rongta: {
    label: "Rongta (RLS)",
    transports: ["tcp", "serial"],
    capabilities: NO_CAPABILITIES,
    docsRequired: "Rongta RLS tarozi protokoli hujjati kerak: TCP porti, PLU paketi formati, yozish/o'chirish va og'irlik so'rash buyruqlari, javoblar.",
    note: UNVERIFIED_NOTE,
  },
};

export type SerialConnection = { type: "serial"; port: string; baudRate: number; dataBits: 7 | 8; parity: "none" | "even" | "odd"; stopBits: 1 | 2 };
export type ScaleConnection = { type: "none" } | { type: "tcp"; host: string; port: number } | SerialConnection;

export const SERIAL_BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200] as const;

export type ScaleConfig = {
  id: string;
  name: string;
  provider: ScaleProviderId;
  connection: ScaleConnection;
  enabled: boolean;
  /** Mahsulot o'zgarsa (pull) avtomatik navbatga qo'shiladi. */
  autoSync: boolean;
  /** Xato bo'lsa urinishlar soni, keyin FAILED. */
  maxAttempts: number;
  /** Umumiy ASCII: og'irlik so'rash buyrug'i (bo'sh — tarozi o'zi uzluksiz yuboradi); `\r`, `\n`, `\xNN` yoziladi. */
  pollCommand: string;
  /** Simulyator og'irligi, kg. */
  simulatedWeight: string;
  createdAt: string;
  updatedAt: string;
};

export type ScaleConfigInput = Omit<ScaleConfig, "id" | "createdAt" | "updatedAt"> & { id?: string };

export type WeightReading = { weight: string; unit: "kg"; stable: boolean; raw: string | null };

export type ScaleTestStatus = "simulator" | "connected" | "port_reachable" | "unreachable" | "docs_required" | "error";
export type ScaleTestResult = { ok: boolean; status: ScaleTestStatus; message: string; reading: WeightReading | null; at: string };

export type ScaleQueueStatus = "PENDING" | "PROCESSING" | "SUCCESS" | "FAILED";
export type ScaleQueueCounts = Record<ScaleQueueStatus, number>;

export type ScaleQueueItem = {
  id: number;
  scaleId: string;
  productId: string;
  productName: string | null;
  plu: number;
  action: "upsert" | "delete";
  status: ScaleQueueStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  runId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ScaleView = ScaleConfig & {
  info: ScaleProviderInfo;
  lastTest: ScaleTestResult | null;
  queue: ScaleQueueCounts;
  /** Oxirgi to'liq sinxron: jami va holatlar bo'yicha (progress). */
  lastRun: { runId: string; total: number; startedAt: string; counts: ScaleQueueCounts } | null;
  lastSyncAt: string | null;
};

export type ScaleReconcileResult = {
  /** `scale` — tarozidan o'qilgan ro'yxat; `local` — kassa yozuvlari (tarozi ro'yxatni bermaydi). */
  source: "scale" | "local";
  checkedAt: string;
  missingOnScale: { plu: number; productId: string; name: string }[];
  extraOnScale: { plu: number; name: string }[];
  mismatched: { plu: number; productId: string; name: string; field: "name" | "price"; expected: string; actual: string }[];
  inSync: number;
};
