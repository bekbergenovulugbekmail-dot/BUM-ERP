import { and, eq } from "drizzle-orm";
import { DEFAULT_SALES_AGENT_POLICY, type SalesAgentPolicy } from "@bum/shared";
import { db } from "../src/db/client.js";
import { settings } from "../src/db/schema/platform.js";

/** Tashrif oqimi (rasmlar, minimal vaqt, buyurtma faqat tashrifda) o'chirilgan siyosat — boshqa qoidalarni sinovchi testlar uchun. */
export const LEGACY_VISIT_POLICY = {
  minVisitMinutes: 0,
  storefrontPhotoRequired: false,
  shelfPhotoRequired: false,
  orderRequiresVisit: false,
} satisfies Partial<SalesAgentPolicy>;

/** Kompaniya siyosatini to'g'ridan-to'g'ri saqlaydi (standart + o'zgartirishlar). */
export async function setAgentPolicy(companyId: string, patch: Partial<SalesAgentPolicy>) {
  const key = "sales_agent.policy";
  await db.delete(settings).where(and(eq(settings.companyId, companyId), eq(settings.key, key)));
  await db.insert(settings).values({ companyId, key, value: JSON.stringify({ ...DEFAULT_SALES_AGENT_POLICY, ...patch }), group: "sales_agent" });
}
