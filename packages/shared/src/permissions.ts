/**
 * BUM ERP ruxsatlar katalogi — YAGONA HAQIQAT MANBAI.
 *
 * Backend `requirePermission()` faqat `Permission` tipini qabul qiladi,
 * ya'ni katalogda yo'q nom yozilsa TypeScript kompilyatsiya xatosi beradi.
 * Bu Convex davridagi muammoni doimiy yopadi: o'sha yerda `requirePermission`
 * oddiy `string` qabul qilardi va 5 ta ruxsat hech bir rolda bo'lmasa ham
 * kod muvaffaqiyatli kompilyatsiya bo'lardi.
 */

export const PERMISSIONS = {
  // ─── Mahsulotlar ───────────────────────────────────────────────────────────
  "products.view":        { label: "Mahsulotlarni ko'rish",        group: "Mahsulotlar" },
  "products.create":      { label: "Mahsulot qo'shish",            group: "Mahsulotlar" },
  "products.edit":        { label: "Mahsulotni tahrirlash",        group: "Mahsulotlar" },
  "products.delete":      { label: "Mahsulotni o'chirish",         group: "Mahsulotlar" },
  /** Kategoriya, brend, o'lchov birligi kabi mahsulot ma'lumotnomalari. */
  "products.manage":      { label: "Mahsulot ma'lumotnomalari",    group: "Mahsulotlar" },
  /**
   * Tannarx, xarid narxi, ombor qiymati va marja. `products.view` dan ATAYLAB ajratilgan.
   *
   * Kompaniya egasining qarori: tannarxni HECH KIM ko'rmaydi — shuning uchun bu ruxsat hech bir
   * tayyor rolda yo'q (Direktorda ham), faqat to'liq huquqlilarda (Business Owner, Superadmin).
   * Kerak bo'lsa ega uni rollar sozlamasidan kerakli xodimga beradi — `analytics.view_profit` kabi.
   */
  "products.view_cost":   { label: "Tannarx va xarid narxini ko'rish", group: "Mahsulotlar" },

  // ─── Savdo ─────────────────────────────────────────────────────────────────
  "sales.view":           { label: "Savdolarni ko'rish",           group: "Savdo" },
  "sales.create":         { label: "Savdo yaratish",               group: "Savdo" },
  "sales.edit":           { label: "Savdoni tahrirlash",           group: "Savdo" },
  "sales.delete":         { label: "Savdoni o'chirish",            group: "Savdo" },
  "sales.approve":        { label: "Savdoni tasdiqlash",           group: "Savdo" },
  "sales.cancel":         { label: "Savdoni bekor qilish",         group: "Savdo" },
  "sales.refund":         { label: "Qaytarish",                    group: "Savdo" },
  /**
   * Mijozdan qarz/buyurtma to'lovini qabul qilish (kassa oynasidan tashqari, ERP "To'lovlar" bo'limida ham).
   * Pulni hisoblarga taqsimlash va kassa sozlamalari — bu emas, `finance.manage`.
   */
  "sales.collect_payment": { label: "Mijozdan to'lov qabul qilish", group: "Savdo" },
  "pos.use":              { label: "Kassa (POS) ishlatish",        group: "Savdo" },
  /** Desktop kassa qurilmasini ro'yxatdan o'tkazish va o'chirish. */
  "pos.devices.manage":   { label: "Kassa qurilmalarini boshqarish", group: "Savdo" },
  /** Kassa qutisidan xarajat to'lash (smena naqdidan, "to'langan" xarajat hujjati). */
  "pos.cash.expense":     { label: "Kassadan xarajat to'lash",     group: "Savdo" },
  /** Kassa tarozilari: holat, sinxron navbati va solishtirishni ko'rish. */
  "scale.view":           { label: "Tarozilarni ko'rish",          group: "Savdo" },
  /** Tarozi qo'shish, ulanish sozlamalari, etiketka shtrix-kodi formati. */
  "scale.manage":         { label: "Tarozilarni sozlash",          group: "Savdo" },
  /** Mahsulotlarni taroziga yuborish, to'liq sinxron, xato yozuvlarni qayta yuborish. */
  "scale.sync":           { label: "Taroziga mahsulot yuborish",   group: "Savdo" },

  // ─── Ombor ─────────────────────────────────────────────────────────────────
  "warehouse.view":       { label: "Omborni ko'rish",              group: "Ombor" },
  "warehouse.manage":     { label: "Omborni boshqarish",           group: "Ombor" },
  "warehouse.transfer":   { label: "Ombor o'tkazma",               group: "Ombor" },
  "warehouse.count":      { label: "Inventarizatsiya",             group: "Ombor" },
  /** Tovarni jismonan qabul qilish — xarid qabulidan alohida huquq. */
  "warehouse.receive":    { label: "Tovar qabul qilish",           group: "Ombor" },

  // ─── Xarid ─────────────────────────────────────────────────────────────────
  "purchase.view":        { label: "Xaridlarni ko'rish",           group: "Xarid" },
  "purchase.create":      { label: "Xarid yaratish",               group: "Xarid" },
  "purchase.edit":        { label: "Xaridni tahrirlash",           group: "Xarid" },
  "purchase.approve":     { label: "Xaridni tasdiqlash",           group: "Xarid" },
  "purchase.cancel":      { label: "Xaridni bekor qilish",         group: "Xarid" },
  /** Qabul qilingan tovarni ta'minotchiga qaytarish (zaxira, qarz va jurnal teskari). */
  "purchase.return":      { label: "Ta'minotchiga qaytarish",      group: "Xarid" },

  // ─── Moliya ────────────────────────────────────────────────────────────────
  "finance.view":         { label: "Moliyani ko'rish",             group: "Moliya" },
  "finance.manage":       { label: "Moliyani boshqarish",          group: "Moliya" },
  "finance.approve":      { label: "Xarajat tasdiqlash",           group: "Moliya" },
  "finance.export":       { label: "Moliyaviy eksport",            group: "Moliya" },
  /** Valyuta kurslari va ularning o'zgarish tarixini ko'rish (web va kassa). */
  "currency_rates.view":  { label: "Valyuta kurslarini ko'rish",   group: "Moliya" },
  /** Bitta valyuta kursini o'zgartirish — web yoki kassadan (tarix va audit bilan). */
  "currency_rates.manage":{ label: "Valyuta kursini o'zgartirish", group: "Moliya" },

  // ─── CRM ───────────────────────────────────────────────────────────────────
  "crm.view":             { label: "CRM ko'rish",                  group: "CRM" },
  "crm.manage":           { label: "CRM boshqarish",               group: "CRM" },

  // ─── Distributsiya ─────────────────────────────────────────────────────────
  /** Savdo agentlari, marshrutlar va tashriflar. */
  "distribution.view":    { label: "Distributsiyani ko'rish",      group: "Distributsiya" },
  "distribution.manage":  { label: "Distributsiyani boshqarish",   group: "Distributsiya" },

  // ─── Sotuv agenti ──────────────────────────────────────────────────────────
  /** Mobil agent ish joyi — bog'langan agentning o'z marshruti, do'konlari va buyurtmalari. */
  /**
   * "Zakaz olish" — alohida modul emas, SAVDO ichidagi ruxsat. Yoqilgan bo'lsa xodim
   * zakaz olish ish joyiga kiradi va mavjud agent buyurtma oqimidan foydalanadi;
   * o'chirilgan bo'lsa menyuda ko'rinmaydi VA server 403 qaytaradi.
   */
  "sales_agent.use":              { label: "Sotuvda zakaz olish",          group: "Savdo" },
  "sales_agent.supervise":        { label: "Agentlarni nazorat qilish",    group: "Sotuv agenti" },
  /** Lokatsiya — maxfiy operatsion ma'lumot: faqat o'qish rollariga avtomatik berilmaydi. */
  "sales_agent.location.view":    { label: "Agent lokatsiyasini ko'rish",  group: "Sotuv agenti" },
  "sales_agent.location.live":    { label: "Jonli kuzatuv xaritasi",       group: "Sotuv agenti" },
  "sales_agent.location.history": { label: "Lokatsiya tarixi",             group: "Sotuv agenti" },
  "promotions.manage":            { label: "Aksiyalarni boshqarish",       group: "Sotuv agenti" },
  /** Xodim + login + rol + agent profilini bitta jarayonda yaratish, faolsizlantirish. */
  "sales_agent.agents.manage":    { label: "Sotuv agentlarini qo'shish",   group: "Sotuv agenti" },
  /** Agentga ixtiyoriy beriladi: mijoz aloqa ma'lumotlari (moliyaviy maydonlarsiz). */
  "sales_agent.customer.edit":           { label: "Agent mijozni tahrirlaydi",       group: "Sotuv agenti" },
  "sales_agent.customer.location.edit":  { label: "Agent mijoz lokatsiyasini saqlaydi", group: "Sotuv agenti" },
  "sales_agent.customer.photo.create":   { label: "Agent do'kon rasmini qo'shadi",   group: "Sotuv agenti" },

  // ─── Dostavka ──────────────────────────────────────────────────────────────
  /** Barcha yetkazmalar, agentlar va holatlar (lokatsiyasiz). */
  "delivery.view":            { label: "Yetkazmalarni ko'rish",               group: "Dostavka" },
  /** Yetkazma yaratish, bekor qilish, qayta rejalash, yetkazuvchi agentlar va siyosat. */
  "delivery.manage":          { label: "Yetkazmalarni boshqarish",            group: "Dostavka" },
  "delivery.assign":          { label: "Yetkazmani agentga biriktirish",      group: "Dostavka" },
  "delivery.reassign":        { label: "Yetkazmani boshqa agentga o'tkazish", group: "Dostavka" },
  /** Yetkazuvchi agent ish joyi: o'ziga biriktirilgan yetkazmalarni ko'rish va qabul qilish. */
  "delivery.accept":          { label: "Yetkazmani qabul qilish (agent)",      group: "Dostavka" },
  "delivery.start":           { label: "Yo'lga chiqish",                       group: "Dostavka" },
  "delivery.arrive":          { label: "Mijozga yetib kelish (geofence)",      group: "Dostavka" },
  "delivery.confirm":         { label: "Yetkazishni tasdiqlash",               group: "Dostavka" },
  "delivery.fail":            { label: "Yetkazib bo'lmadi deb belgilash",      group: "Dostavka" },
  /** Qaytgan mahsulotni omborga qabul qilish (zaxira va qarz qaytadi). */
  "delivery.return":          { label: "Qaytgan mahsulotni qabul qilish",      group: "Dostavka" },
  /** Dostavchi mijozdan ilgari sotilgan tovarni qaytarib oladi (siyosatga ko'ra — qabuldan keyin yoki darhol). */
  "delivery.return_pickup":   { label: "Mijozdan tovarni qaytarib olish",      group: "Dostavka" },
  "delivery.collect_payment": { label: "Yetkazishda to'lov qabul qilish",      group: "Dostavka" },
  "delivery.view_debt":       { label: "Agent mijoz qarzini ko'radi",          group: "Dostavka" },
  /** Lokatsiya — maxfiy operatsion ma'lumot: faqat o'qish rollariga avtomatik berilmaydi. */
  "delivery.view_location":   { label: "Yetkazuvchi lokatsiyasini ko'rish",    group: "Dostavka" },
  "delivery.manage_routes":   { label: "Yetkazish tartibini o'zgartirish",     group: "Dostavka" },
  "delivery.view_reports":    { label: "Dostavka hisobotlari",                 group: "Dostavka" },

  // ─── Ishlab chiqarish ──────────────────────────────────────────────────────
  "manufacturing.view":   { label: "Ishlab chiqarishni ko'rish",    group: "Ishlab chiqarish" },
  "manufacturing.manage": { label: "Ishlab chiqarishni boshqarish", group: "Ishlab chiqarish" },
  /** Ishlab chiqarish buyurtmasini tasdiqlash / yakunlash. */
  "manufacturing.approve":{ label: "Ishlab chiqarishni tasdiqlash", group: "Ishlab chiqarish" },

  // ─── HR ────────────────────────────────────────────────────────────────────
  "hr.view":              { label: "Xodimlarni ko'rish",           group: "HR" },
  "hr.manage":            { label: "Xodimlarni boshqarish",        group: "HR" },
  "hr.salary":            { label: "Maosh tayyorlash",             group: "HR" },
  "hr.attendance":        { label: "Davomat boshqarish",           group: "HR" },
  /** Maoshni to'lovga tasdiqlash — tayyorlashdan ALOHIDA (vazifalar ajratimi). */
  "hr.approve":           { label: "Maoshni tasdiqlash",           group: "HR" },

  // ─── Analitika ─────────────────────────────────────────────────────────────
  "analytics.view":       { label: "Analitikani ko'rish",          group: "Analitika" },
  "analytics.export":     { label: "Ma'lumot eksport",             group: "Analitika" },
  /**
   * FOYDA ko'rsatkichlari: sof foyda, yalpi foyda, marja, tovar tannarxi (COGS) va foyda-zarar
   * hisoboti. Aylanma (daromad) va xarajat bundan tashqarida — ular `analytics.view` bilan ko'rinadi.
   *
   * Alohida ruxsat: kompaniya egasi foydani xodimlarga ko'rsatishni xohlamasligi mumkin. Hech bir
   * tayyor rolda YO'Q — faqat ega va superadmin (to'liq huquqli) ko'radi; kerak bo'lsa ega uni
   * rollar sozlamasida direktor yoki buxgalterga beradi.
   */
  "analytics.view_profit": { label: "Foydani ko'rish",             group: "Analitika" },

  // ─── Admin ─────────────────────────────────────────────────────────────────
  "settings.view":        { label: "Sozlamalarni ko'rish",         group: "Admin" },
  "settings.manage":      { label: "Sozlamalarni boshqarish",      group: "Admin" },
  "branches.manage":      { label: "Filiallarni boshqarish",       group: "Admin" },
  "warehouses.manage":    { label: "Omborlarni boshqarish",        group: "Admin" },
  "users.view":           { label: "Foydalanuvchilarni ko'rish",   group: "Admin" },
  "users.manage":         { label: "Foydalanuvchilarni boshqarish", group: "Admin" },
  /**
   * Xodimlarning ishonchli qurilmalarini tasdiqlash va bekor qilish. Foydalanuvchi yaratish yoki
   * bloklashdan (`users.manage`) alohida: rahbar yo'qda ham yangi qurilmani kimdir ochishi kerak.
   */
  "devices.manage":       { label: "Qurilmalarni tasdiqlash",      group: "Admin" },
  "users.invite":         { label: "Foydalanuvchi taklif qilish",  group: "Admin" },
  "roles.manage":         { label: "Rollarni boshqarish",          group: "Admin" },
  "modules.manage":       { label: "Modullarni boshqarish",        group: "Admin" },
  "audit.view":           { label: "Audit jurnalini ko'rish",      group: "Admin" },
  "company.manage":       { label: "Kompaniya sozlamalari",        group: "Admin" },

  // Obuna va litsenziya: to'lov so'rovi va dasturdan foydalanuvchi xodim — pullik resurs (egasi yoki vakolatli rahbar)
  "subscription.view":    { label: "Obunani ko'rish",              group: "Obuna" },
  "subscription.manage":  { label: "Obunani boshqarish (tarif, to'lov)", group: "Obuna" },
  "license.view":         { label: "Litsenziyalarni ko'rish",      group: "Obuna" },
  "license.manage":       { label: "Qo'shimcha litsenziya sotib olish", group: "Obuna" },
  "employee.software_access.manage": { label: "Xodimga dastur kirishini berish/olish", group: "Obuna" },
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return value in PERMISSIONS;
}

// ─── Rollar ──────────────────────────────────────────────────────────────────

/** To'lov va litsenziya — pullik resurs: faqat egasi (to'liq ruxsatli rol); Direktor faqat ko'radi. */
const BILLING_MANAGE: readonly Permission[] = ["subscription.manage", "license.manage", "employee.software_access.manage"];
const BILLING_VIEW: readonly Permission[] = ["subscription.view", "license.view"];

const VIEW_ONLY: Permission[] = ALL_PERMISSIONS.filter(
  (p) => (p.endsWith(".view") || p === "pos.use") && !p.startsWith("sales_agent.location.") && !BILLING_VIEW.includes(p),
);

/** Bu ikki rol har doim barcha ruxsatlarga ega (kodda ham bypass qilinadi). */
export const FULL_ACCESS_ROLES = ["Superadmin", "Business Owner"] as const;

export type RoleDefinition = {
  name: string;
  description: string;
  color: string;
  isSystem: boolean;
  permissions: Permission[];
};

export const DEFAULT_ROLES: RoleDefinition[] = [
  {
    name: "Superadmin",
    description: "Tizimning to'liq boshqaruvchisi",
    color: "#6366f1",
    isSystem: true,
    permissions: ALL_PERMISSIONS,
  },
  {
    name: "Business Owner",
    description: "Kompaniya egasi — to'liq boshqaruv",
    color: "#f59e0b",
    isSystem: true,
    permissions: ALL_PERMISSIONS,
  },
  {
    name: "Direktor",
    description: "Barcha operatsiyalarni ko'rish va boshqarish",
    color: "#0ea5e9",
    isSystem: true,
    // Foyda (`analytics.view_profit`) va tannarx (`products.view_cost`) bu yerda ham YO'Q: ularni
    // faqat ega ko'radi. Kerak bo'lsa ega rollar sozlamasida direktorga qo'shib beradi.
    permissions: ALL_PERMISSIONS.filter(
      (p) =>
        p !== "roles.manage" &&
        p !== "company.manage" &&
        p !== "analytics.view_profit" &&
        p !== "products.view_cost" &&
        !BILLING_MANAGE.includes(p),
    ),
  },
  {
    name: "Buxgalter",
    description: "Moliya, xarid va maosh",
    color: "#14b8a6",
    isSystem: true,
    permissions: [
      "products.view",
      "sales.view", "sales.approve",
      "purchase.view", "purchase.create", "purchase.edit", "purchase.approve",
      "finance.view", "finance.manage", "finance.approve", "finance.export",
      "currency_rates.view", "currency_rates.manage",
      "hr.view", "hr.salary", "hr.approve",
      "analytics.view", "analytics.export",
      "settings.view",
      "audit.view",
    ],
  },
  {
    name: "Moliya menejeri",
    description: "Moliyaviy operatsiyalar",
    color: "#22c55e",
    isSystem: true,
    permissions: [
      "products.view",
      "sales.view", "sales.approve",
      "purchase.view", "purchase.approve",
      "finance.view", "finance.manage", "finance.approve", "finance.export",
      "currency_rates.view", "currency_rates.manage",
      "hr.view", "hr.salary", "hr.approve",
      "analytics.view", "analytics.export",
      "settings.view",
    ],
  },
  {
    name: "Savdo menejeri",
    description: "Savdo va CRM",
    color: "#f97316",
    isSystem: true,
    permissions: [
      "products.view", "products.create", "products.edit", "products.manage",
      "sales.view", "sales.create", "sales.edit", "sales.approve", "sales.cancel", "sales.refund",
      "sales.collect_payment",
      "pos.use",
      "scale.view", "scale.sync",
      "warehouse.view",
      "finance.view",
      "currency_rates.view",
      "crm.view", "crm.manage",
      "distribution.view", "distribution.manage",
      "sales_agent.supervise", "promotions.manage", "sales_agent.agents.manage",
      "delivery.view", "delivery.manage", "delivery.assign", "delivery.reassign", "delivery.manage_routes", "delivery.view_reports",
      "analytics.view",
      "settings.view",
    ],
  },
  {
    name: "Xarid menejeri",
    description: "Ta'minotchilar va xaridlar",
    color: "#a855f7",
    isSystem: true,
    permissions: [
      "products.view", "products.create", "products.edit", "products.manage",
      "purchase.view", "purchase.create", "purchase.edit", "purchase.approve", "purchase.cancel", "purchase.return",
      "warehouse.view", "warehouse.manage", "warehouse.receive",
      "finance.view",
      "analytics.view",
      "settings.view",
    ],
  },
  {
    name: "Ombor menejeri",
    description: "Ombor va inventar",
    color: "#8b5cf6",
    isSystem: true,
    permissions: [
      "products.view", "products.create", "products.edit", "products.manage",
      "warehouse.view", "warehouse.manage", "warehouse.transfer", "warehouse.count", "warehouse.receive",
      "scale.view", "scale.manage", "scale.sync",
      "purchase.view",
      "delivery.view", "delivery.return",
      "analytics.view",
      "settings.view",
    ],
  },
  {
    name: "Omborchi",
    description: "Ombor operatsiyalari",
    color: "#64748b",
    isSystem: true,
    permissions: [
      "products.view",
      "warehouse.view", "warehouse.manage", "warehouse.transfer", "warehouse.receive",
      "purchase.view",
    ],
  },
  {
    name: "Kassir",
    description: "Faqat kassa va savdo",
    color: "#3b82f6",
    isSystem: true,
    permissions: [
      "products.view",
      "sales.view", "sales.create",
      // Kassir mijoz qarzini kassa oynasida ham, "To'lovlar" bo'limida ham qabul qila oladi
      "sales.collect_payment",
      "pos.use",
      "warehouse.view",
      // Kassada kursni ko'radi; o'zgartirish (`currency_rates.manage`) — rahbar beradi
      "currency_rates.view",
      // Tarozidan og'irlik o'qish va holatni ko'rish; sozlash va yuborish — rahbar yoki omborchi
      "scale.view",
    ],
  },
  {
    name: "HR menejeri",
    description: "Xodimlar va maosh",
    color: "#ec4899",
    isSystem: true,
    // Diqqat: hr.approve ATAYLAB berilmagan — maoshni tayyorlagan odam
    // uni o'zi tasdiqlamasligi kerak (vazifalar ajratimi).
    permissions: [
      "hr.view", "hr.manage", "hr.salary", "hr.attendance",
      "sales_agent.agents.manage",
      // Rahbar yo'qda ham yangi xodimning telefoni/noutbuki ochilishi kerak
      "devices.manage",
      "analytics.view",
      "settings.view",
    ],
  },
  {
    name: "Ishlab chiqarish menejeri",
    description: "Ishlab chiqarish operatsiyalari",
    color: "#d97706",
    isSystem: true,
    permissions: [
      "products.view", "products.create", "products.edit", "products.manage",
      "manufacturing.view", "manufacturing.manage", "manufacturing.approve",
      "warehouse.view", "warehouse.manage", "warehouse.receive",
      "purchase.view",
      "analytics.view",
    ],
  },
  {
    name: "Sotuv agenti",
    description: "Mobil agent ish joyi: marshrut, do'konlar, buyurtma",
    color: "#10b981",
    isSystem: true,
    // Faqat agent ish joyi — ERP bo'limlari va boshqa agentlarning ma'lumoti ko'rinmaydi.
    // Mijoz aloqa ma'lumoti, joylashuvi (mijoz yonida) va vitrina rasmi — spetsifikatsiya RBAC bo'yicha; kompaniya olib qo'yishi mumkin
    permissions: ["sales_agent.use", "sales_agent.customer.edit", "sales_agent.customer.location.edit", "sales_agent.customer.photo.create"],
  },
  {
    name: "Supervayzer",
    description: "Savdo agentlari nazorati va o'zi ham zakaz olishi: marshrut, lokatsiya, aksiyalar",
    color: "#0891b2",
    isSystem: true,
    permissions: [
      "products.view",
      "sales.view",
      "crm.view",
      "distribution.view", "distribution.manage",
      // Supervayzer o'zi ham zakaz oladi: agent ish joyi unga ham ochiq (hisobi faol savdo agentiga
      // bog'langan bo'lishi kerak — "Distribyutsiya → Sotuv agentlari" da bir marta bog'lanadi)
      "sales_agent.use",
      "sales_agent.customer.edit", "sales_agent.customer.location.edit", "sales_agent.customer.photo.create",
      "sales_agent.supervise",
      "sales_agent.location.view", "sales_agent.location.live", "sales_agent.location.history",
      "promotions.manage", "sales_agent.agents.manage",
      "delivery.view", "delivery.manage", "delivery.assign", "delivery.reassign", "delivery.return",
      "delivery.view_location", "delivery.manage_routes", "delivery.view_reports",
      "analytics.view",
    ],
  },
  {
    name: "Dostavka agenti",
    description: "DELIVERY_AGENT — yetkazuvchi ish joyi: o'z yetkazmalari, mijozlari va to'lovlari",
    color: "#f43f5e",
    isSystem: true,
    // Faqat o'ziga biriktirilgan yetkazmalar — ERP bo'limlari, boshqa agentlar va sozlamalar ko'rinmaydi
    permissions: [
      "delivery.accept", "delivery.start", "delivery.arrive", "delivery.confirm", "delivery.fail",
      "delivery.collect_payment", "delivery.view_debt", "delivery.return_pickup",
    ],
  },
  {
    name: "Auditor",
    description: "Faqat o'qish va hisobot",
    color: "#94a3b8",
    isSystem: true,
    permissions: VIEW_ONLY.concat(["analytics.export", "audit.view"]),
  },
  {
    name: "Ko'ruvchi",
    description: "Faqat o'qish huquqi",
    color: "#cbd5e1",
    isSystem: true,
    permissions: VIEW_ONLY,
  },
];

/**
 * Convex kodidagi eskirgan ruxsat nomlari → katalogdagi to'g'ri nom.
 * Migratsiya davomida yordamchi; barcha modullar ko'chgach o'chiriladi.
 */
export const LEGACY_PERMISSION_ALIASES: Record<string, Permission> = {
  "production.manage": "manufacturing.manage",
  "production.approve": "manufacturing.approve",
};
