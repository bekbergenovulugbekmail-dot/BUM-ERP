import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShieldX } from "lucide-react";
import { usePermissions } from "@/hooks/use-company.ts";
import { ERP_MODULES, type ModuleId } from "@/lib/modules.ts";

/**
 * Ruxsati yo'q bo'lim sahifasi ochilmaydi — to'g'ridan-to'g'ri havola bilan kirilganda ham.
 * Faqat UX: API baribir 403 qaytaradi.
 */
export default function ModuleGuard({ module, children }: { module: ModuleId; children: ReactNode }) {
  const { t } = useTranslation("common");
  const { lng = "uz" } = useParams<{ lng: string }>();
  const { can, isLoading } = usePermissions();
  const required = ERP_MODULES.find((m) => m.id === module)?.permission;

  if (!required || can(required)) return <>{children}</>;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
      <div className="h-14 w-14 rounded-2xl bg-destructive/10 flex items-center justify-center mb-4">
        <ShieldX className="h-7 w-7 text-destructive" />
      </div>
      <h2 className="text-lg font-semibold">{t("access.denied.title")}</h2>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm">{t("access.denied.message")}</p>
      <Link to={`/${lng}/dashboard`} className="mt-5 text-sm font-medium text-primary hover:underline">
        {t("btn.back")}
      </Link>
    </div>
  );
}
