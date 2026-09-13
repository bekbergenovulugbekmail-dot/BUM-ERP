/**
 * Dostavka hodisalari shinasi — PostgreSQL NOTIFY (`bum_delivery` kanali).
 *
 * Tranzaksiya ichida chaqiriladi: hodisa faqat COMMIT bo'lganda yetkaziladi (bekor qilingan amal hodisa bermaydi) va API
 * bir nechta nusxada ishlasa ham hammasiga boradi. Yukda faqat kompaniya, ID, holat va amal nomi — shaxsiy ma'lumot,
 * summa yoki koordinata yo'q. Kim nimani oladi — `realtime.ts` (`messageFor`).
 */
import { sql } from "drizzle-orm";
import type { DeliveryStatus } from "@bum/shared";
import type { Tx } from "../../db/transaction.js";

export const DELIVERY_CHANNEL = "bum_delivery";

export type DeliveryBusEvent =
  | { type: "task"; companyId: string; taskId: string; agentIds: string[]; status: DeliveryStatus | null; action: string }
  | { type: "location"; companyId: string; deliveryAgentId: string }
  | { type: "session"; companyId: string; deliveryAgentId: string }
  | { type: "agents"; companyId: string }
  | { type: "policy"; companyId: string };

export async function publishDeliveryEvent(tx: Tx, event: DeliveryBusEvent): Promise<void> {
  await tx.execute(sql`select pg_notify(${DELIVERY_CHANNEL}, ${JSON.stringify(event)})`);
}

const TYPES = new Set(["task", "location", "session", "agents", "policy"]);

export function parseDeliveryBusEvent(payload: string | undefined): DeliveryBusEvent | null {
  if (!payload) return null;
  try {
    const value = JSON.parse(payload) as DeliveryBusEvent;
    return value && typeof value === "object" && typeof value.companyId === "string" && TYPES.has(value.type) ? value : null;
  } catch {
    return null;
  }
}
