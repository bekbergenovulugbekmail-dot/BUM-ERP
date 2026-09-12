/**
 * Dostavka bildirishnomalari — faqat muhim hodisalar (yetkazilmadi, to'lov farqi, geofence buzilishi): spam yo'q,
 * oddiy holatlar (qabul, yo'lda, yetkazildi) boshqaruv panelida ko'rinadi. Oluvchilar: siyosatda shu hodisa uchun
 * tanlanganlar (faol a'zolar), aks holda `delivery.manage` ruxsati bor yoki to'liq huquqli faol a'zolar.
 */
import { and, eq, sql } from "drizzle-orm";
import { FULL_ACCESS_ROLES, type DeliveryNotificationRecipients, type DeliveryPolicy } from "@bum/shared";
import { notifications } from "../../db/schema/notifications.js";
import { companyMembers, roles } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";

export async function deliveryManagers(conn: DbOrTx, companyId: string): Promise<string[]> {
  const members = await conn
    .select({
      userId: companyMembers.userId,
      companyRole: companyMembers.companyRole,
      permissions: roles.permissions,
      roleActive: roles.isActive,
    })
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
    if (fullAccess || (member.roleActive && member.permissions?.includes("delivery.manage"))) result.add(member.userId);
  }
  return [...result];
}

export async function notifyDeliveryManagers(
  tx: Tx,
  companyId: string,
  policy: DeliveryPolicy,
  event: keyof DeliveryNotificationRecipients,
  input: { title: string; message: string; taskId: string; severity?: "warning" | "error" | "info" },
) {
  const chosen = policy.notificationRecipients[event];
  let recipients: string[];
  if (chosen.length > 0) {
    const active = await tx
      .select({ userId: companyMembers.userId })
      .from(companyMembers)
      .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.isActive, true)));
    const activeIds = new Set(active.map((row) => row.userId));
    recipients = chosen.filter((id) => activeIds.has(id));
  } else {
    recipients = await deliveryManagers(tx, companyId);
  }
  if (recipients.length === 0) return 0;
  await tx.insert(notifications).values(
    recipients.map((userId) => ({
      companyId,
      userId,
      isGlobal: false,
      type: "system" as const,
      severity: input.severity ?? ("warning" as const),
      title: input.title,
      message: input.message,
      relatedType: "delivery_tasks",
      relatedId: input.taskId,
      link: "/delivery",
    })),
  );
  return recipients.length;
}
