/**
 * Kassa ko'rinishi (kompaniya sozlamasi `pos.appearance`): mavzuni qulflash va qulflangan mavzu. Qurilmalarga pull
 * `config.appearance` bilan boradi (xeshi o'zgarsa). Qulf yo'q bo'lsa har kassir o'z mavzusini tanlaydi.
 */
import { and, eq } from "drizzle-orm";
import { POS_APPEARANCE_KEY, parsePosAppearance, type PosAppearance } from "@bum/shared";
import { settings } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { upsertCompanySetting } from "../company/settings.service.js";
import type { TenantContext } from "../company/tenant.js";

export async function getPosAppearance(conn: DbOrTx, companyId: string): Promise<PosAppearance> {
  const [row] = await conn
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.companyId, companyId), eq(settings.key, POS_APPEARANCE_KEY)))
    .limit(1);
  return parsePosAppearance(row?.value);
}

export async function savePosAppearance(tx: Tx, tenant: TenantContext, input: PosAppearance, meta: RequestMeta): Promise<PosAppearance> {
  const value = parsePosAppearance(JSON.stringify(input));
  await upsertCompanySetting(tx, tenant, { key: POS_APPEARANCE_KEY, value: JSON.stringify(value), group: "pos", description: "Kassa mavzusi va qulfi" }, meta);
  return value;
}
