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

  // ─── Savdo ─────────────────────────────────────────────────────────────────
  "sales.view":           { label: "Savdolarni ko'rish",           group: "Savdo" },
  "sales.create":         { label: "Savdo yaratish",               group: "Savdo" },
  "sales.edit":           { label: "Savdoni tahrirlash",           group: "Savdo" },
  "sales.delete":         { label: "Savdoni o'chirish",            group: "Savdo" },
  "sales.approve":        { label: "Savdoni tasdiqlash",           group: "Savdo" },
  "sales.cancel":         { label: "Savdoni bekor qilish",         group: "Savdo" },
  "sales.refund":         { label: "Qaytarish",                    group: "Savdo" },
  "pos.use":              { label: "Kassa (POS) ishlatish",        group: "Savdo" },

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

  // ─── Moliya ────────────────────────────────────────────────────────────────
  "finance.view":         { label: "Moliyani ko'rish",             group: "Moliya" },
  "finance.manage":       { label: "Moliyani boshqarish",          group: "Moliya" },
  "finance.approve":      { label: "Xarajat tasdiqlash",           group: "Moliya" },
  "finance.export":       { label: "Moliyaviy eksport",            group: "Moliya" },

  // ─── CRM ───────────────────────────────────────────────────────────────────
  "crm.view":             { label: "CRM ko'rish",                  group: "CRM" },
  "crm.manage":           { label: "CRM boshqarish",               group: "CRM" },

  // ─── Distributsiya ─────────────────────────────────────────────────────────
  /** Savdo agentlari, marshrutlar va tashriflar. */
  "distribution.view":    { label: "Distributsiyani ko'rish",      group: "Distributsiya" },
  "distribution.manage":  { label: "Distributsiyani boshqarish",   group: "Distributsiya" },

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

  // ─── Admin ─────────────────────────────────────────────────────────────────
  "settings.view":        { label: "Sozlamalarni ko'rish",         group: "Admin" },
  "settings.manage":      { label: "Sozlamalarni boshqarish",      group: "Admin" },
  "branches.manage":      { label: "Filiallarni boshqarish",       group: "Admin" },
  "warehouses.manage":    { label: "Omborlarni boshqarish",        group: "Admin" },
  "users.view":           { label: "Foydalanuvchilarni ko'rish",   group: "Admin" },
  "users.manage":         { label: "Foydalanuvchilarni boshqarish", group: "Admin" },
  "users.invite":         { label: "Foydalanuvchi taklif qilish",  group: "Admin" },
  "roles.manage":         { label: "Rollarni boshqarish",          group: "Admin" },
  "modules.manage":       { label: "Modullarni boshqarish",        group: "Admin" },
  "audit.view":           { label: "Audit jurnalini ko'rish",      group: "Admin" },
  "company.manage":       { label: "Kompaniya sozlamalari",        group: "Admin" },
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return value in PERMISSIONS;
}

// ─── Rollar ──────────────────────────────────────────────────────────────────

const VIEW_ONLY: Permission[] = ALL_PERMISSIONS.filter(
  (p) => p.endsWith(".view") || p === "pos.use",
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
    permissions: ALL_PERMISSIONS.filter(
      (p) => p !== "roles.manage" && p !== "company.manage",
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
      "pos.use",
      "warehouse.view",
      "finance.view",
      "crm.view", "crm.manage",
      "distribution.view", "distribution.manage",
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
      "purchase.view", "purchase.create", "purchase.edit", "purchase.approve", "purchase.cancel",
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
      "purchase.view",
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
      "pos.use",
      "warehouse.view",
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
