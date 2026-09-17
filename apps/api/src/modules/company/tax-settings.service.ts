/**
 * Soliqni avtomatik hisoblash yoqilganmi (kompaniya sozlamasi).
 *
 * O'chirilgan bo'lsa yangi hujjatlarda soliq 0 bo'ladi — mahsulot kartochkasidagi stavka
 * e'tiborga olinmaydi. ESKI hujjatlar o'zgarmaydi: ularda o'sha paytdagi soliq saqlanib qoladi.
 *
 * Sukut — YOQILGAN, ya'ni sozlama yozilmagan kompaniyalarda xatti-harakat o'zgarmaydi.
 */
import { and, eq } from "drizzle-orm";
import { settings } from "../../db/schema/platform.js";
import type { DbOrTx } from "../../db/transaction.js";

export const TAX_SETTING_KEY = "tax.auto";
export const TAX_SETTING_GROUP = "finance";

export async function isTaxEnabled(conn: DbOrTx, companyId: string): Promise<boolean> {
  const [row] = await conn
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.companyId, companyId), eq(settings.key, TAX_SETTING_KEY)))
    .limit(1);
  // Yozuv yo'q — yoqilgan (eski kompaniyalarda hech narsa o'zgarmaydi)
  return row?.value !== "false";
}

/** Soliq o'chirilgan bo'lsa stavkani nolga tushiradi. */
export const effectiveTaxRate = (rate: string, enabled: boolean) => (enabled ? rate : "0");
