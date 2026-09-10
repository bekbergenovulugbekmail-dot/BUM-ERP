// ERP module definitions with icons and permissions
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
};

export const ERP_MODULES: ModuleConfig[] = [
  { id: "dashboard", labelKey: "nav.dashboard", path: "dashboard", icon: "LayoutDashboard", defaultEnabled: true, group: "main" },
  { id: "sales", labelKey: "nav.sales", path: "sales", icon: "ShoppingCart", defaultEnabled: true, group: "operations" },
  { id: "pos", labelKey: "nav.pos", path: "pos", icon: "Monitor", defaultEnabled: true, group: "operations" },
  { id: "products", labelKey: "nav.products", path: "products", icon: "Package", defaultEnabled: true, group: "operations" },
  { id: "warehouse", labelKey: "nav.warehouse", path: "warehouse", icon: "Warehouse", defaultEnabled: true, group: "operations" },
  { id: "purchase", labelKey: "nav.purchase", path: "purchase", icon: "ShoppingBag", defaultEnabled: true, group: "operations" },
  { id: "manufacturing", labelKey: "nav.manufacturing", path: "manufacturing", icon: "Factory", defaultEnabled: false, group: "operations" },
  { id: "crm", labelKey: "nav.crm", path: "crm", icon: "Users", defaultEnabled: true, group: "business" },
  { id: "distribution", labelKey: "nav.distribution", path: "distribution", icon: "Truck", defaultEnabled: false, group: "business" },
  { id: "finance", labelKey: "nav.finance", path: "finance", icon: "DollarSign", defaultEnabled: true, group: "business" },
  { id: "hr", labelKey: "nav.hr", path: "hr", icon: "UserCheck", defaultEnabled: true, group: "business" },
  { id: "reports", labelKey: "nav.reports", path: "reports", icon: "FileBarChart", defaultEnabled: true, group: "insights" },
  { id: "analytics", labelKey: "nav.analytics", path: "analytics", icon: "BarChart3", defaultEnabled: true, group: "insights" },
  { id: "ai", labelKey: "nav.ai", path: "ai", icon: "BrainCircuit", defaultEnabled: true, group: "insights" },
  { id: "settings", labelKey: "nav.settings", path: "settings", icon: "Settings", defaultEnabled: true, group: "system" },
];

export const MODULE_GROUPS = {
  main: "Asosiy",
  operations: "Operatsiyalar",
  business: "Biznes",
  insights: "Tahlil",
  system: "Tizim",
} as const;
