/**
 * Kompaniya sozlamalari (convex/admin.ts: getSettings, upsertSetting).
 *
 * Convex'da upsertSetting har qanday a'zoga ochiq edi (Kassir modul sozlamalarini
 * o'zgartira olardi) — endi `settings.manage`, `modules` guruhi uchun `modules.manage`.
 * Qiymatlar audit jurnaliga yozilmaydi (maxfiy bo'lishi mumkin) — faqat kalit va guruh.
 */
import { and, eq } from "drizzle-orm";
import { settings } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import type { TenantContext } from "./tenant.js";

export async function listCompanySettings(conn: DbOrTx, tenant: TenantContext, group?: string) {
  return conn
    .select({
      key: settings.key,
      value: settings.value,
      group: settings.group,
      description: settings.description,
      updatedBy: settings.updatedBy,
      updatedAt: settings.updatedAt,
    })
    .from(settings)
    .where(and(eq(settings.companyId, tenant.company.id), group ? eq(settings.group, group) : undefined))
    .orderBy(settings.group, settings.key);
}

export async function upsertCompanySetting(
  tx: Tx,
  tenant: TenantContext,
  input: { key: string; value: string; group: string; description?: string },
  meta: RequestMeta,
) {
  const now = new Date();
  const [row] = await tx
    .insert(settings)
    .values({
      companyId: tenant.company.id,
      key: input.key,
      value: input.value,
      group: input.group,
      description: input.description ?? null,
      updatedBy: tenant.user.id,
    })
    .onConflictDoUpdate({
      target: [settings.companyId, settings.key],
      set: {
        value: input.value,
        group: input.group,
        ...(input.description !== undefined ? { description: input.description } : {}),
        updatedBy: tenant.user.id,
        updatedAt: now,
      },
    })
    .returning({
      key: settings.key,
      value: settings.value,
      group: settings.group,
      description: settings.description,
      updatedAt: settings.updatedAt,
    });

  await writeAuditLog(
    {
      userId: tenant.user.id,
      userName: tenant.user.name,
      companyId: tenant.company.id,
      action: "SETTING_UPDATED",
      resource: "settings",
      resourceId: input.key,
      details: { key: input.key, group: input.group },
      ...meta,
    },
    tx,
  );
  return row!;
}
