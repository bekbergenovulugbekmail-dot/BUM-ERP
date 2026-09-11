import { toast } from "sonner";
import { cn } from "@/lib/utils.ts";
import { Switch } from "@/components/ui/switch.tsx";
import { ERP_MODULES, MODULE_GROUPS } from "@/lib/modules.ts";
import { useModules } from "@/components/providers/module-provider.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation } from "@/lib/query.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import {
  LayoutDashboard, ShoppingCart, Monitor, Package, Warehouse,
  ShoppingBag, Factory, Users, Truck, DollarSign, UserCheck,
  FileBarChart, BarChart3, BrainCircuit, Settings,
} from "lucide-react";

const ICON_MAP: Record<string, React.ElementType> = {
  LayoutDashboard, ShoppingCart, Monitor, Package, Warehouse,
  ShoppingBag, Factory, Users, Truck, DollarSign, UserCheck,
  FileBarChart, BarChart3, BrainCircuit, Settings,
};

type ModuleId = Parameters<ReturnType<typeof useModules>["toggleModule"]>[0];

export default function ModulesSection() {
  const { enabledModules, toggleModule } = useModules();
  const { can } = usePermissions();
  const canManage = can("modules.manage");

  // `PUT /api/company/settings/module.<id>` — `modules` guruhi uchun `modules.manage`
  const saveModule = useApiMutation(
    ({ moduleId, enabled }: { moduleId: string; enabled: boolean }) =>
      api.put(`/api/company/settings/module.${moduleId}`, {
        value: String(enabled),
        group: "modules",
        description: `Module ${moduleId} enabled state`,
      }),
    { invalidate: ["/api/company/settings"] },
  );

  const handleToggle = async (moduleId: ModuleId) => {
    const enabled = !enabledModules.includes(moduleId);
    toggleModule(moduleId);
    try {
      await saveModule.mutateAsync({ moduleId, enabled });
    } catch (err) {
      // Server rad etdi — mahalliy holat qaytariladi
      toggleModule(moduleId);
      toast.error(errorMessage(err));
    }
  };

  const grouped = Object.entries(MODULE_GROUPS).map(([groupKey, groupLabel]) => ({
    key: groupKey,
    label: groupLabel,
    modules: ERP_MODULES.filter((m) => m.group === groupKey),
  }));

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold">Modullarni boshqarish</p>
        <p className="text-xs text-muted-foreground">
          {canManage
            ? "Keraksiz modullarni o'chirib qo'ying — ular menyudan yashiriladi"
            : "Modullarni o'zgartirish uchun ruxsat yo'q"}
        </p>
      </div>

      {grouped.map(({ key, label, modules }) => (
        <div key={key} className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">{label}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {modules.map((mod) => {
              const Icon = ICON_MAP[mod.icon] ?? Package;
              const isEnabled = enabledModules.includes(mod.id);
              const isCore = mod.id === "dashboard" || mod.id === "settings";
              return (
                <div
                  key={mod.id}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-xl border transition-all",
                    isEnabled ? "bg-card border-border" : "bg-muted/30 border-transparent opacity-60"
                  )}
                >
                  <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0", isEnabled ? "bg-primary/10" : "bg-muted")}>
                    <Icon className={cn("h-4 w-4", isEnabled ? "text-primary" : "text-muted-foreground")} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{mod.labelKey.replace("nav.", "").charAt(0).toUpperCase() + mod.labelKey.replace("nav.", "").slice(1)}</p>
                    <p className="text-xs text-muted-foreground">{mod.path}</p>
                  </div>
                  <Switch
                    checked={isEnabled}
                    onCheckedChange={() => { if (!isCore) void handleToggle(mod.id); }}
                    disabled={isCore || !canManage || saveModule.isPending}
                    className="cursor-pointer"
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
