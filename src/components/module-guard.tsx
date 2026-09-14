import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Blocks, ShieldX } from "lucide-react";
import { useModules } from "@/components/providers/module-provider.tsx";
import { usePermissions } from "@/hooks/use-company.ts";
import { ERP_MODULES, type ModuleId } from "@/lib/modules.ts";

/**
 * Bo'lim sahifasi: kompaniyada modul o'chiq bo'lsa yoki ruxsat yo'q bo'lsa ochilmaydi — to'g'ridan-to'g'ri havola bilan
 * kirilganda ham. Faqat UX: API baribir MODULE_DISABLED / 403 qaytaradi.
 */
export default function ModuleGuard({ module, children }: { module: ModuleId; children: ReactNode }) {
  const { t } = useTranslation("common");
  const { lng = "uz" } = useParams<{ lng: string }>();
  const { can, isLoading } = usePermissions();
  const { isEnabled, isLoading: modulesLoading } = useModules();
  const required = ERP_MODULES.find((m) => m.id === module)?.permission;
  const enabled = isEnabled(module);

  if (!modulesLoading && enabled && (!required || can(required))) return <>{children}</>;

  if (modulesLoading || isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const disabled = !enabled;
  const Icon = disabled ? Blocks : ShieldX;
  return (
    <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
      <div className={`h-14 w-14 rounded-2xl flex items-center justify-center mb-4 ${disabled ? "bg-muted" : "bg-destructive/10"}`}>
        <Icon className={`h-7 w-7 ${disabled ? "text-muted-foreground" : "text-destructive"}`} />
      </div>
      <h2 className="text-lg font-semibold">{disabled ? t("module.disabled.title") : t("access.denied.title")}</h2>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm">{disabled ? t("module.disabled.message") : t("access.denied.message")}</p>
      {disabled && can("modules.manage") && <p className="mt-2 text-xs font-medium text-muted-foreground">{t("module.disabled.manage")}</p>}
      <Link to={`/${lng}/dashboard`} className="mt-5 text-sm font-medium text-primary hover:underline">
        {t("btn.back")}
      </Link>
    </div>
  );
}
