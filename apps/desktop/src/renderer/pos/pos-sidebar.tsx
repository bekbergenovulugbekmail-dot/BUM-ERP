import type { ComponentType } from "react";
import { BookUser, Calculator, ChartColumn, House, ReceiptText, Settings, ShoppingCart, Truck, Warehouse, Zap } from "lucide-react";
import type { View } from "../app.tsx";

type Target = { tab: "quick" | "all" } | { view: View };

type NavItem = {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Ko'rsatish uchun ruxsatlardan kamida bittasi (yo'q — hamma kassirga). */
  anyOf?: string[];
  target: Target;
  bottom?: boolean;
};

const ITEMS: NavItem[] = [
  { key: "home", label: "Bosh sahifa", icon: House, target: { view: "home" } },
  { key: "quick", label: "Tezkor sotuv", icon: Zap, target: { tab: "quick" } },
  { key: "all", label: "Sotuv", icon: ShoppingCart, target: { tab: "all" } },
  { key: "history", label: "Sotuv tarixi", icon: ReceiptText, target: { view: "history" } },
  { key: "kassa", label: "Kassa hisobi", icon: Calculator, target: { view: "kassa" } },
  { key: "references", label: "Mijozlar", icon: BookUser, target: { view: "references" } },
  { key: "purchase", label: "Xarid", icon: Truck, anyOf: ["purchase.create", "warehouse.receive"], target: { view: "purchase" } },
  { key: "warehouse", label: "Ombor", icon: Warehouse, anyOf: ["warehouse.view"], target: { view: "warehouse" } },
  { key: "analytics", label: "Hisobotlar", icon: ChartColumn, anyOf: ["analytics.view"], target: { view: "analytics" } },
  { key: "settings", label: "Sozlamalar", icon: Settings, target: { view: "settings" }, bottom: true },
];

/**
 * Kassa yon paneli: tez o'tish (katta bosish maydoni, sensorli ekranga mos). Kassirda ruxsati bo'lmagan bo'limlar ko'rsatilmaydi
 * (RBAC). Boshqa bo'limga o'tganda kassa ekrani yashiriladi, o'chirilmaydi — savat va joriy sotuv saqlanadi.
 */
export function PosSidebar({
  permissions,
  activeTab,
  onTab,
  onNavigate,
}: {
  permissions: string[];
  activeTab: "quick" | "all";
  onTab: (tab: "quick" | "all") => void;
  onNavigate: (view: View) => void;
}) {
  const visible = ITEMS.filter((item) => !item.anyOf || item.anyOf.some((permission) => permissions.includes(permission)));
  const render = (item: NavItem) => {
    const active = "tab" in item.target && item.target.tab === activeTab;
    return (
      <button
        key={item.key}
        type="button"
        aria-current={active ? "page" : undefined}
        onClick={() => ("tab" in item.target ? onTab(item.target.tab) : onNavigate(item.target.view))}
        className={`pos-motion flex min-h-(--pos-tap-size) flex-col items-center justify-center gap-1 rounded-(--radius) px-1 py-1.5 text-[10.5px] font-medium leading-tight transition-colors ${
          active ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-pos" : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        } ${item.bottom ? "mt-auto" : ""}`}
      >
        <item.icon className="size-5 shrink-0" />
        <span className="line-clamp-2 w-full text-center">{item.label}</span>
      </button>
    );
  };
  return (
    <nav aria-label="Bo'limlar" className="pos-glass flex w-[4.75rem] shrink-0 flex-col gap-1 overflow-y-auto border-r border-sidebar-border bg-sidebar px-1.5 py-2 text-sidebar-foreground">
      {visible.map(render)}
    </nav>
  );
}
