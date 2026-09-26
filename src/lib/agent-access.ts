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

/**
 * Maydondagi supervayzer: agent ish joyi (`sales_agent.use`) va nazorat (`sales_agent.supervise`) bor, lekin ERP'da
 * sotuv buyurtmasi yaratmaydi (`sales.create` yo'q). Uning "Sotuv"i — agentniki bilan bir xil ekran (do'kon, GPS, tashrif).
 */
export function isFieldSupervisor(permissions: readonly Permission[]): boolean {
  return permissions.includes("sales_agent.use") && permissions.includes("sales_agent.supervise") && !permissions.includes("sales.create");
}

/** Faqat yetkazuvchi ish joyi: `delivery.accept` bor, sotuv agenti emas va ERP bo'limlaridan birortasiga ruxsat yo'q. */
export function isDeliveryAgentOnly(permissions: readonly Permission[]): boolean {
  if (!permissions.includes("delivery.accept") || permissions.includes("sales_agent.use")) return false;
  return !hasErpModule(permissions);
}
