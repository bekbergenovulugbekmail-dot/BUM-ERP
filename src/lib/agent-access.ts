/**
 * Mobil ish joylariga kirish qoidasi (faqat UX — asosiy himoya serverda).
 */
import type { Permission } from "@bum/shared";
import { ERP_MODULES } from "@/lib/modules.ts";

const hasErpModule = (permissions: readonly Permission[]) =>
  ERP_MODULES.some((module) => module.permission && permissions.includes(module.permission));

/** Faqat agent ish joyi: `sales_agent.use` bor va ERP bo'limlaridan birortasiga ruxsat yo'q. */
export function isAgentOnly(permissions: readonly Permission[]): boolean {
  if (!permissions.includes("sales_agent.use")) return false;
  return !hasErpModule(permissions);
}

/** Tayyor "Supervayzer" roli nomi (kompaniya ruxsatlarini o'zgartirgan bo'lsa ham — maydondagi supervayzer). */
export const SUPERVISOR_ROLE = "Supervayzer";

/**
 * Maydondagi supervayzer: uning "Sotuv"i — agentniki bilan bir xil ekran (do'kon, GPS, tashrif, buyurtma).
 * "Supervayzer" roli (kompaniya unga `sales.create` qo'shgan bo'lsa ham), yoki agent ish joyi + nazorat ruxsati bor,
 * lekin ERP'da sotuv buyurtmasi yaratmaydigan boshqa rol. Direktor, egasi va sotuv menejeri — oddiy "Sotuv".
 */
export function isFieldSupervisor(permissions: readonly Permission[], companyRole?: string | null): boolean {
  if (!permissions.includes("sales_agent.use")) return false;
  if (companyRole === SUPERVISOR_ROLE) return true;
  return permissions.includes("sales_agent.supervise") && !permissions.includes("sales.create");
}

/** Faqat yetkazuvchi ish joyi: `delivery.accept` bor, sotuv agenti emas va ERP bo'limlaridan birortasiga ruxsat yo'q. */
export function isDeliveryAgentOnly(permissions: readonly Permission[]): boolean {
  if (!permissions.includes("delivery.accept") || permissions.includes("sales_agent.use")) return false;
  return !hasErpModule(permissions);
}
