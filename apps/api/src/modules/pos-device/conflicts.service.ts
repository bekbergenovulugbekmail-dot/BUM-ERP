/**
 * Offline kassa sinxroni nomuvofiqliklari (`pos_sync_conflicts`) — web'da rahbar ko'rib chiqadi va yopadi.
 * Amal (chek, qaytarish, mijoz) allaqachon yozilgan; bu ro'yxat — tekshirish kerak bo'lgan joylar.
 */
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { notFound } from "@bum/shared";
import { users } from "../../db/schema/platform.js";
import { posDevices, posSyncConflicts } from "../../db/schema/pos.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import type { TenantContext } from "../company/tenant.js";

export const CONFLICT_KINDS = {
  stock_shortage: "Zaxira yetmadi (qoldiq manfiy)",
  price_changed: "Narx prays-listdan farq qildi",
  rate_changed: "Valyuta kursi o'zgargan",
  customer_inactive: "Mijoz faol emas edi",
  credit_limit: "Kredit limitidan oshdi",
  balance_insufficient: "Mijoz balansi yetmadi (farqi qarzga)",
  cashback_insufficient: "Keshbek yetmadi (farqi qarzga)",
  shift_closed: "Yopilgan smenaga chek",
  customer_duplicate_phone: "Shu telefonli mijoz bor edi",
  debt_overpaid: "Mijoz qarzidan ortiq to'landi (farqi balansga)",
  supplier_overpaid: "Ta'minotchi qarzidan ortiq to'landi (avans)",
  count_late_document: "Inventarizatsiyadan oldingi hujjat kech keldi (qoldiq sanoq bo'yicha tuzatildi)",
  record_changed: "Kassadagi tahrir serverdagi yangi o'zgarish bilan to'qnashdi (server qiymati saqlandi)",
} as const;

export async function listConflicts(conn: DbOrTx, tenant: TenantContext, options: { resolved?: boolean; limit: number }) {
  return conn
    .select({
      id: posSyncConflicts.id,
      kind: posSyncConflicts.kind,
      referenceType: posSyncConflicts.referenceType,
      referenceId: posSyncConflicts.referenceId,
      details: posSyncConflicts.details,
      opId: posSyncConflicts.opId,
      createdAt: posSyncConflicts.createdAt,
      resolvedAt: posSyncConflicts.resolvedAt,
      resolvedByName: users.name,
      deviceId: posSyncConflicts.deviceId,
      deviceName: posDevices.name,
      deviceCode: posDevices.code,
    })
    .from(posSyncConflicts)
    .innerJoin(posDevices, eq(posDevices.id, posSyncConflicts.deviceId))
    .leftJoin(users, eq(users.id, posSyncConflicts.resolvedBy))
    .where(
      and(
        eq(posSyncConflicts.companyId, tenant.company.id),
        options.resolved ? isNotNull(posSyncConflicts.resolvedAt) : isNull(posSyncConflicts.resolvedAt),
      ),
    )
    .orderBy(desc(posSyncConflicts.createdAt), desc(posSyncConflicts.id))
    .limit(options.limit);
}

export async function resolveConflict(tx: Tx, tenant: TenantContext, conflictId: string, meta: RequestMeta) {
  const [row] = await tx
    .select({ id: posSyncConflicts.id, kind: posSyncConflicts.kind, resolvedAt: posSyncConflicts.resolvedAt })
    .from(posSyncConflicts)
    .where(and(eq(posSyncConflicts.id, conflictId), eq(posSyncConflicts.companyId, tenant.company.id)))
    .limit(1)
    .for("update");
  if (!row) throw notFound("Nomuvofiqlik topilmadi");
  if (row.resolvedAt) return { id: row.id, resolvedAt: row.resolvedAt };

  const resolvedAt = new Date();
  await tx.update(posSyncConflicts).set({ resolvedAt, resolvedBy: tenant.user.id }).where(eq(posSyncConflicts.id, conflictId));
  await writeAuditLog(
    {
      userId: tenant.user.id,
      userName: tenant.user.name,
      companyId: tenant.company.id,
      action: "POS_SYNC_CONFLICT_RESOLVED",
      resource: "pos_sync_conflicts",
      resourceId: conflictId,
      details: { kind: row.kind },
      ...meta,
    },
    tx,
  );
  return { id: row.id, resolvedAt };
}
