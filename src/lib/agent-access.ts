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

/** Faqat yetkazuvchi ish joyi: `delivery.accept` bor, sotuv agenti emas va ERP bo'limlaridan birortasiga ruxsat yo'q. */
export function isDeliveryAgentOnly(permissions: readonly Permission[]): boolean {
  if (!permissions.includes("delivery.accept") || permissions.includes("sales_agent.use")) return false;
  return !hasErpModule(permissions);
}
