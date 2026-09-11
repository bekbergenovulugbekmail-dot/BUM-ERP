/**
 * Sotuv agenti ish joyiga kirish qoidasi (faqat UX — asosiy himoya serverda).
 */
import type { Permission } from "@bum/shared";
import { ERP_MODULES } from "@/lib/modules.ts";

/** Faqat agent ish joyi: `sales_agent.use` bor va ERP bo'limlaridan birortasiga ruxsat yo'q. */
export function isAgentOnly(permissions: readonly Permission[]): boolean {
  if (!permissions.includes("sales_agent.use")) return false;
  return !ERP_MODULES.some((module) => module.permission && permissions.includes(module.permission));
}
