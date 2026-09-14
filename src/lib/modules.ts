// ERP module definitions with icons and permissions
import type { ModuleKey, Permission } from "@bum/shared";

export type ModuleId =
  | "dashboard"
  | "sales"
  | "pos"
  | "products"
  | "warehouse"
  | "purchase"
  | "manufacturing"
  | "crm"
  | "distribution"
  | "delivery"
  | "finance"
  | "hr"
  | "reports"
  | "analytics"
  | "ai"
  | "subscription"
  | "settings";

export type ModuleConfig = {
  id: ModuleId;
  labelKey: string;
  path: string;
  icon: string;
  defaultEnabled: boolean;
  group: "main" | "operations" | "business" | "insights" | "system";
  /** Menyuda ko'rinish va sahifani ochish uchun ruxsat; yo'q — har bir a'zoga. Asosiy himoya — serverda. */
  permission?: Permission;
  /** Kompaniya moduli (`@bum/shared` MODULE_REGISTRY); yo'q — tizim bo'limi, o'chirilmaydi. */
  moduleKey?: ModuleKey;
};

export const ERP_MODULES: ModuleConfig[] = [
  { id: "dashboard", labelKey: "nav.dashboard", path: "dashboard", icon: "LayoutDashboard", defaultEnabled: true, group: "main" },
  { id: "sales", labelKey: "nav.sales", path: "sales", icon: "ShoppingCart", defaultEnabled: true, group: "operations", permission: "sales.view", moduleKey: "sales" },
  { id: "pos", labelKey: "nav.pos", path: "pos", icon: "Monitor", defaultEnabled: true, group: "operations", permission: "pos.use", moduleKey: "pos" },
  { id: "products", labelKey: "nav.products", path: "products", icon: "Package", defaultEnabled: true, group: "operations", permission: "products.view", moduleKey: "products" },
  { id: "warehouse", labelKey: "nav.warehouse", path: "warehouse", icon: "Warehouse", defaultEnabled: true, group: "operations", permission: "warehouse.view", moduleKey: "warehouse" },
  { id: "purchase", labelKey: "nav.purchase", path: "purchase", icon: "ShoppingBag", defaultEnabled: true, group: "operations", permission: "purchase.view", moduleKey: "purchase" },
  { id: "manufacturing", labelKey: "nav.manufacturing", path: "manufacturing", icon: "Factory", defaultEnabled: false, group: "operations", permission: "manufacturing.view", moduleKey: "manufacturing" },
  { id: "crm", labelKey: "nav.crm", path: "crm", icon: "Users", defaultEnabled: true, group: "business", permission: "crm.view", moduleKey: "crm" },
  { id: "distribution", labelKey: "nav.distribution", path: "distribution", icon: "Truck", defaultEnabled: true, group: "business", permission: "distribution.view", moduleKey: "distribution" },
  { id: "delivery", labelKey: "nav.delivery", path: "delivery", icon: "PackageCheck", defaultEnabled: true, group: "business", permission: "delivery.view", moduleKey: "delivery" },
  { id: "finance", labelKey: "nav.finance", path: "finance", icon: "DollarSign", defaultEnabled: true, group: "business", permission: "finance.view", moduleKey: "finance" },
  { id: "hr", labelKey: "nav.hr", path: "hr", icon: "UserCheck", defaultEnabled: true, group: "business", permission: "hr.view", moduleKey: "hr" },
  { id: "reports", labelKey: "nav.reports", path: "reports", icon: "FileBarChart", defaultEnabled: true, group: "insights", permission: "analytics.view", moduleKey: "reports" },
  { id: "analytics", labelKey: "nav.analytics", path: "analytics", icon: "BarChart3", defaultEnabled: true, group: "insights", permission: "analytics.view", moduleKey: "reports" },
  { id: "ai", labelKey: "nav.ai", path: "ai", icon: "BrainCircuit", defaultEnabled: true, group: "insights", permission: "analytics.view", moduleKey: "reports" },
  { id: "subscription", labelKey: "nav.subscription", path: "subscription", icon: "CreditCard", defaultEnabled: true, group: "system", permission: "subscription.view" },
  { id: "settings", labelKey: "nav.settings", path: "settings", icon: "Settings", defaultEnabled: true, group: "system" },
];

/** Obuna tugaganda menyuda qoladigan bo'limlar (server ham faqat shularni ochadi). */
export const EXPIRED_SUBSCRIPTION_MODULES: readonly ModuleId[] = ["dashboard", "subscription"];

export const MODULE_GROUPS = {
  main: "Asosiy",
  operations: "Operatsiyalar",
  business: "Biznes",
  insights: "Tahlil",
  system: "Tizim",
} as const;
