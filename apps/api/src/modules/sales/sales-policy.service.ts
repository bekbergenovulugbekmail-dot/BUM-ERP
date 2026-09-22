/**
 * Savdo siyosati (kompaniya egasining qarorlari) — `settings` jadvalida `sales.policy` kaliti; umumiy sozlamalar
 * endpointi orqali yozilmaydi (`PUT /api/sales/policy`, `settings.manage`).
 *   maxDiscountPercent       — qo'lda berilgan chegirma shu foizdan oshsa `sales.approve` kerak (offline kassa — nomuvofiqlik)
 *   cashierDepositLimit      — kassada mijoz balansiga bir martada shundan ortiq yozish (to'ldirish, qaytim) `sales.approve`
 *   shiftDifferenceTolerance — smena yopilganda kassa farqi shundan oshsa rahbar ko'rib chiqadi
 *   creditHoldOverdueDays    — to'lov muddati shuncha kundan ko'p o'tgan bo'lsa NASIYA sotuv to'xtaydi
 *   creditHoldOverdueAmount  — muddati o'tgan qarz shu summadan oshsa NASIYA sotuv to'xtaydi
 * `null` — cheklanmagan. Standart: chegirma va depozit cheklanmagan, har qanday kassa farqi ko'rib
 * chiqiladi, kredit to'xtatish qoidasi O'CHIQ (mavjud xatti-harakat o'zgarmaydi — faqat ega yoqadi).
 */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { FULL_ACCESS_ROLES, type Permission } from "@bum/shared";
import { notifications } from "../../db/schema/notifications.js";
import { companyMembers, roles, settings } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { moneySchema, percentSchema } from "../../shared/decimal.js";
import { upsertCompanySetting } from "../company/settings.service.js";
import type { TenantContext } from "../company/tenant.js";

export const SALES_POLICY_KEY = "sales.policy";

export const salesPolicySchema = z.strictObject({
  maxDiscountPercent: percentSchema.nullable(),
  cashierDepositLimit: moneySchema.nullable(),
  shiftDifferenceTolerance: moneySchema,
  /**
   * Nasiya to'xtatish chegaralari; `null` — o'chiq. Naqd sotuv va qarz to'lash hech qachon to'xtamaydi.
   * Ixtiyoriy: eski mijozlar (va saqlangan eski sozlama) shu maydonlarsiz yuborsa ham qabul qilinadi.
   */
  creditHoldOverdueDays: z.number().int().min(0).max(3650).nullable().default(null),
  creditHoldOverdueAmount: moneySchema.nullable().default(null),
});

export type SalesPolicy = z.output<typeof salesPolicySchema>;

export const DEFAULT_SALES_POLICY: SalesPolicy = {
  maxDiscountPercent: null,
  cashierDepositLimit: null,
  shiftDifferenceTolerance: "0",
  creditHoldOverdueDays: null,
  creditHoldOverdueAmount: null,
};

export async function getSalesPolicy(conn: DbOrTx, companyId: string): Promise<SalesPolicy> {
  const [row] = await conn
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.companyId, companyId), eq(settings.key, SALES_POLICY_KEY)))
    .limit(1);
  if (!row) return DEFAULT_SALES_POLICY;
  try {
    const stored: unknown = JSON.parse(row.value);
    const parsed = salesPolicySchema.safeParse({ ...DEFAULT_SALES_POLICY, ...(stored && typeof stored === "object" ? stored : {}) });
    return parsed.success ? parsed.data : DEFAULT_SALES_POLICY;
  } catch {
    return DEFAULT_SALES_POLICY;
  }
}

export async function saveSalesPolicy(tx: Tx, tenant: TenantContext, input: SalesPolicy, meta: RequestMeta) {
  await upsertCompanySetting(tx, tenant, { key: SALES_POLICY_KEY, value: JSON.stringify(input), group: "sales", description: "Savdo siyosati" }, meta);
  return input;
}

/** Ruxsati bor (yoki to'liq huquqli) faol a'zolar. */
export async function membersWithPermission(conn: DbOrTx, companyId: string, permission: Permission): Promise<string[]> {
  const members = await conn
    .select({ userId: companyMembers.userId, companyRole: companyMembers.companyRole, permissions: roles.permissions, roleActive: roles.isActive })
    .from(companyMembers)
    .leftJoin(
      roles,
      sql`(${companyMembers.roleId} is not null and ${roles.id} = ${companyMembers.roleId})
        or (${companyMembers.roleId} is null and ${roles.name} = ${companyMembers.companyRole}
            and (${roles.companyId} = ${companyId} or ${roles.companyId} is null))`,
    )
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.isActive, true)));
  const result = new Set<string>();
  for (const member of members) {
    const fullAccess = (FULL_ACCESS_ROLES as readonly string[]).includes(member.companyRole);
    if (fullAccess || (member.roleActive && member.permissions?.includes(permission))) result.add(member.userId);
  }
  return [...result];
}

/** Tasdiqlovchilarga shaxsiy bildirishnoma (hodisa egasining o'ziga emas). */
export async function notifyMembersWithPermission(
  tx: Tx,
  companyId: string,
  permission: Permission,
  input: { title: string; message: string; relatedType: string; relatedId: string; link: string; excludeUserId?: string | null },
) {
  const recipients = (await membersWithPermission(tx, companyId, permission)).filter((userId) => userId !== input.excludeUserId);
  if (recipients.length === 0) return 0;
  await tx.insert(notifications).values(
    recipients.map((userId) => ({
      companyId,
      userId,
      isGlobal: false,
      type: "system" as const,
      severity: "warning" as const,
      title: input.title,
      message: input.message,
      relatedType: input.relatedType,
      relatedId: input.relatedId,
      link: input.link,
    })),
  );
  return recipients.length;
}
