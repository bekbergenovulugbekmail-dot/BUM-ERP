/**
 * Menyuda ko'rinadigan modullar: sozlamada yoqilgan va foydalanuvchida kerakli ruxsat bor.
 * Ruxsatlar yuklanguncha ruxsat talab qiladigan modullar ko'rsatilmaydi. Asosiy himoya — serverda.
 * Obuna tugagan bo'lsa — faqat Bosh sahifa va Obuna (server boshqa bo'limlarni 403 bilan yopadi).
 */
import { useModules } from "@/components/providers/module-provider.tsx";
import { useCurrentUser } from "@/hooks/use-auth.ts";
import { useActiveCompany, usePermissions } from "@/hooks/use-company.ts";
import { ERP_MODULES, EXPIRED_SUBSCRIPTION_MODULES, type ModuleConfig } from "@/lib/modules.ts";
import { subscriptionBlocked } from "@/lib/subscription.ts";
import { isFieldSupervisor } from "@/lib/agent-access.ts";

export function useVisibleModules(): ModuleConfig[] {
  const { isEnabled } = useModules();
  const { can, permissions } = usePermissions();
  // Maydondagi supervayzerning "Sotuv"i — agent ish joyi (xuddi sotuv agentidek)
  const fieldSupervisor = isFieldSupervisor(permissions ?? [], useActiveCompany().data?.membership.companyRole);
  const blocked = subscriptionBlocked(useCurrentUser()?.subscription);
  return ERP_MODULES.filter(
    (m) =>
      // Obuna bo'limini modul sozlamasi bilan yashirib bo'lmaydi — uzaytirish shu yerdan
      (m.id === "subscription" || isEnabled(m.id)) &&
      (!m.permission || can(m.permission)) &&
      (!blocked || EXPIRED_SUBSCRIPTION_MODULES.includes(m.id)),
  ).map((m) => (fieldSupervisor && m.id === "sales" ? { ...m, path: "sales-agent" } : m));
}
