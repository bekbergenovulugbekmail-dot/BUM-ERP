/**
 * Kassa ko'rinishi (kompaniya sozlamasi `pos.appearance`): standart mavzu, qulf va kompaniya maxsus mavzusi. Qurilmalarga
 * pull `config.appearance` bilan boradi (xeshi o'zgarsa). Qulf yo'q bo'lsa kassir o'z mavzusini tanlaydi; tanlamagan
 * kassirda — kompaniya standarti. Maxsus mavzu kontrast tekshiruvidan (WCAG) o'tmasa saqlanmaydi.
 */
import { and, eq } from "drizzle-orm";
import {
  POS_APPEARANCE_KEY,
  badRequest,
  parsePosAppearance,
  validateCustomTheme,
  type PosAppearance,
  type PosCustomTheme,
  type PosLayout,
  type PosPanelSide,
  type PosThemeChoice,
} from "@bum/shared";
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

/** `custom` berilmasa — mavjud maxsus mavzu saqlanadi; `null` — o'chiriladi. */
export async function savePosAppearance(
  tx: Tx,
  tenant: TenantContext,
  input: { locked: boolean; theme: PosThemeChoice; custom?: PosCustomTheme | null; paymentPanelSide?: PosPanelSide; layout?: PosLayout },
  meta: RequestMeta,
): Promise<PosAppearance> {
  const current = await getPosAppearance(tx, tenant.company.id);
  const custom = input.custom === undefined ? current.custom : input.custom;
  if (custom) {
    const issues = validateCustomTheme(custom);
    if (issues.length > 0) throw badRequest("Maxsus mavzu kontrast talabidan o'tmadi", { issues });
  }
  if (input.theme === "custom" && !custom) throw badRequest("Kompaniya maxsus mavzusi yaratilmagan");
  const value: PosAppearance = {
    locked: input.locked,
    theme: input.theme,
    custom,
    // Berilmasa — saqlangan tanlov (mavzuni o'zgartirish joylashuvni tiklab yubormasin)
    paymentPanelSide: input.paymentPanelSide ?? current.paymentPanelSide,
    layout: input.layout ?? current.layout,
  };
  await upsertCompanySetting(
    tx,
    tenant,
    { key: POS_APPEARANCE_KEY, value: JSON.stringify(value), group: "pos", description: "Kassa ko'rinishi: standart mavzu, qulf, maxsus mavzu" },
    meta,
  );
  return parsePosAppearance(JSON.stringify(value));
}
