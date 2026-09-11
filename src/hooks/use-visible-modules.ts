/**
 * Menyuda ko'rinadigan modullar: sozlamada yoqilgan va foydalanuvchida kerakli ruxsat bor.
 * Ruxsatlar yuklanguncha ruxsat talab qiladigan modullar ko'rsatilmaydi. Asosiy himoya — serverda.
 */
import { useModules } from "@/components/providers/module-provider.tsx";
import { usePermissions } from "@/hooks/use-company.ts";
import { ERP_MODULES, type ModuleConfig } from "@/lib/modules.ts";

export function useVisibleModules(): ModuleConfig[] {
  const { isEnabled } = useModules();
  const { can } = usePermissions();
  return ERP_MODULES.filter((m) => isEnabled(m.id) && (!m.permission || can(m.permission)));
}
