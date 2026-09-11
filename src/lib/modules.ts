// ERP module definitions with icons and permissions
import type { Permission } from "@bum/shared";

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
  | "finance"
  | "hr"
  | "reports"
  | "analytics"
  | "ai"
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
};

export const ERP_MODULES: ModuleConfig[] = [
  { id: "dashboard", labelKey: "nav.dashboard", path: "dashboard", icon: "LayoutDashboard", defaultEnabled: true, group: "main" },
  { id: "sales", labelKey: "nav.sales", path: "sales", icon: "ShoppingCart", defaultEnabled: true, group: "operations", permission: "sales.view" },
  { id: "pos", labelKey: "nav.pos", path: "pos", icon: "Monitor", defaultEnabled: true, group: "operations", permission: "pos.use" },
  { id: "products", labelKey: "nav.products", path: "products", icon: "Package", defaultEnabled: true, group: "operations", permission: "products.view" },
  { id: "warehouse", labelKey: "nav.warehouse", path: "warehouse", icon: "Warehouse", defaultEnabled: true, group: "operations", permission: "warehouse.view" },
  { id: "purchase", labelKey: "nav.purchase", path: "purchase", icon: "ShoppingBag", defaultEnabled: true, group: "operations", permission: "purchase.view" },
  { id: "manufacturing", labelKey: "nav.manufacturing", path: "manufacturing", icon: "Factory", defaultEnabled: false, group: "operations", permission: "manufacturing.view" },
  { id: "crm", labelKey: "nav.crm", path: "crm", icon: "Users", defaultEnabled: true, group: "business", permission: "crm.view" },
  { id: "distribution", labelKey: "nav.distribution", path: "distribution", icon: "Truck", defaultEnabled: true, group: "business", permission: "distribution.view" },
  { id: "finance", labelKey: "nav.finance", path: "finance", icon: "DollarSign", defaultEnabled: true, group: "business", permission: "finance.view" },
  { id: "hr", labelKey: "nav.hr", path: "hr", icon: "UserCheck", defaultEnabled: true, group: "business", permission: "hr.view" },
  { id: "reports", labelKey: "nav.reports", path: "reports", icon: "FileBarChart", defaultEnabled: true, group: "insights", permission: "analytics.view" },
  { id: "analytics", labelKey: "nav.analytics", path: "analytics", icon: "BarChart3", defaultEnabled: true, group: "insights", permission: "analytics.view" },
  { id: "ai", labelKey: "nav.ai", path: "ai", icon: "BrainCircuit", defaultEnabled: true, group: "insights", permission: "analytics.view" },
  { id: "settings", labelKey: "nav.settings", path: "settings", icon: "Settings", defaultEnabled: true, group: "system" },
];

export const MODULE_GROUPS = {
  main: "Asosiy",
  operations: "Operatsiyalar",
  business: "Biznes",
  insights: "Tahlil",
  system: "Tizim",
} as const;
