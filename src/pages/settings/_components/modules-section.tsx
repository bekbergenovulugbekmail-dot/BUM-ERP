/**
 * Sozlamalar → Modullar (`GET /api/company/modules`, `PUT /api/company/modules/:key` — `modules.manage`).
 * Modul o'chirilsa ma'lumot o'chirilmaydi: menyu yashiriladi va API yopiladi, qayta yoqilganda hammasi avvalgidek.
 * Bog'liqliklar serverda tekshiriladi (masalan, Dostavka — Savdoga, Savdo — Mahsulot va Omborga bog'liq).
 *
 * Ro'yxatda FAQAT yoqilgan modullar turadi — o'chirilganlari kompaniya uchun yo'q hisoblanadi (ularni
 * kompaniyaning o'zi yoqa olmaydi, bu platforma administratori qarori). Nechtasi ochilishi mumkinligi
 * pastda bitta qatorda eslatiladi.
 */
import { toast } from "sonner";
import { format } from "date-fns";
import {
  BarChart3, DollarSign, Factory, History, Info, Lock, Monitor, Package, PackageCheck,
  ShoppingBag, ShoppingCart, Truck, UserCheck, Users, Warehouse,
} from "lucide-react";
import { MODULE_REGISTRY, type ModuleKey } from "@bum/shared";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { usePermissions } from "@/hooks/use-company.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";

const ICON_MAP: Record<string, React.ElementType> = {
  Package, Warehouse, ShoppingCart, Monitor, ShoppingBag, Factory, Users, Truck, PackageCheck, DollarSign, UserCheck, BarChart3,
};

export type CompanyModuleRow = {
  key: ModuleKey;
  name: string;
  description: string;
  icon: string;
  dependsOn: ModuleKey[];
  dependents: ModuleKey[];
  enabled: boolean;
  enabledAt: string | null;
  disabledAt: string | null;
  updatedAt: string | null;
};

export type ModuleHistoryRow = {
  id: string;
  moduleKey: string;
  enabled: boolean;
  source: "owner" | "platform" | "registration";
  reason: string | null;
  changedByName: string | null;
  createdAt: string;
};

const SOURCE_LABELS: Record<ModuleHistoryRow["source"], string> = {
  owner: "kompaniya",
  platform: "platforma admini",
  registration: "ro'yxatdan o'tish",
};

const CORE_PARTS = ["Bosh sahifa", "Obuna", "Sozlamalar", "Profil va xavfsizlik"];

const nameOf = (key: string) => MODULE_REGISTRY[key as ModuleKey]?.name ?? key;

export default function ModulesSection() {
  const { can } = usePermissions();
  /**
   * Modullarni kompaniyaning o'zi yoqa/o'chira olmaydi — bu platforma administratori qaroriga
   * bog'liq (server ham rad etadi). Bu yerda faqat holat ko'rsatiladi.
   */
  const canManage = false;
  const canSeeHistory = can("modules.manage");
  const query = useApiQuery<{ modules: CompanyModuleRow[]; history: ModuleHistoryRow[] }>("/api/company/modules");
  const save = useApiMutation(
    ({ key, enabled }: { key: ModuleKey; enabled: boolean }) => api.put(`/api/company/modules/${key}`, { enabled }),
    { invalidate: ["/api/company"] },
  );

  const allModules = query.data?.modules;
  const enabledKeys = new Set(allModules?.filter((module) => module.enabled).map((module) => module.key));
  // O'chirilgan modul ro'yxatda turmaydi — faqat nechtasi ochilishi mumkinligi eslatiladi
  const modules = allModules?.filter((module) => module.enabled);
  const disabledCount = (allModules?.length ?? 0) - (modules?.length ?? 0);

  const toggle = async (module: CompanyModuleRow) => {
    try {
      await save.mutateAsync({ key: module.key, enabled: !module.enabled });
      toast.success(module.enabled ? `${module.name} o'chirildi — ma'lumotlar saqlanadi` : `${module.name} yoqildi`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold">Modullar</p>
        <p className="text-xs text-muted-foreground">
          Kompaniyangiz qaysi bo'limlardan foydalanishi ro'yxatdan o'tishda tanlangan.
          Yangi modul kerak bo'lsa — platforma administratoriga murojaat qiling, u ochib beradi.
        </p>
      </div>

      {!modules ? (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          {modules.map((module) => {
            const Icon = ICON_MAP[module.icon] ?? Package;
            // Ro'yxatda faqat yoqilganlari — o'chirish uchun unga bog'liq modullar avval o'chiriladi
            const activeDependents = module.dependents.filter((key) => enabledKeys.has(key));
            const blockedReason = activeDependents.length > 0 ? `Avval o'chiring: ${activeDependents.map(nameOf).join(", ")}` : null;
            return (
              <div key={module.key} className="flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{module.name}</p>
                      <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                        Yoqilgan
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{module.description}</p>
                  </div>
                  <Switch
                    aria-label={`${module.name} modulini o'chirish`}
                    checked
                    disabled={!canManage || save.isPending || blockedReason !== null}
                    onCheckedChange={() => void toggle(module)}
                    className="cursor-pointer"
                  />
                </div>
                {module.dependsOn.length > 0 && (
                  <p className="text-[11px] text-muted-foreground">Talab qiladi: {module.dependsOn.map(nameOf).join(", ")}</p>
                )}
                {canManage && blockedReason && (
                  <p className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                    <Info className="h-3 w-3 shrink-0" /> {blockedReason}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {disabledCount > 0 && (
        <p className="text-xs text-muted-foreground">
          Yana {disabledCount} ta modulni ulash mumkin — kerak bo'lsa platforma administratoriga murojaat qiling.
        </p>
      )}

      <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>O'chirilmaydigan tizim qismlari: {CORE_PARTS.join(", ")}. Obuna tugasa — faqat Bosh sahifa va Obuna ochiq qoladi.</span>
      </div>

      {canSeeHistory && (query.data?.history.length ?? 0) > 0 && (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <History className="h-3.5 w-3.5" /> O'zgarishlar tarixi
          </p>
          <ul className="divide-y divide-border rounded-xl border border-border bg-card text-sm">
            {query.data!.history.slice(0, 20).map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  <span className="font-medium">{nameOf(row.moduleKey)}</span>{" "}
                  <span className={row.enabled ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}>
                    {row.enabled ? "yoqildi" : "o'chirildi"}
                  </span>
                  {row.reason ? <span className="text-muted-foreground"> — {row.reason}</span> : null}
                </span>
                <span className="text-xs text-muted-foreground">
                  {row.changedByName ?? "—"} · {SOURCE_LABELS[row.source] ?? row.source} · {format(new Date(row.createdAt), "dd.MM.yyyy HH:mm")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
