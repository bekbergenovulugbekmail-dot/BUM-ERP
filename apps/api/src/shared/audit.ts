/**
 * Audit jurnali. Convexdagi writeAuditLog (convex/tenant.ts) bilan bir xil
 * maydonlar; `details` endi JSON satr emas, jsonb.
 */
import { db } from "../db/client.js";
import { auditLogs } from "../db/schema/platform.js";
import type { DbOrTx } from "../db/transaction.js";

/** So'rovdan olinadigan kontekst — audit va sessiya yozuvlari uchun. */
export type RequestMeta = {
  ipAddress: string;
  userAgent: string | null;
};

export type AuditEntry = Partial<RequestMeta> & {
  companyId?: string | null;
  userId?: string | null;
  userName?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  details?: Record<string, unknown>;
  severity?: "info" | "warning" | "error";
};

export async function writeAuditLog(entry: AuditEntry, conn: DbOrTx = db): Promise<void> {
  await conn.insert(auditLogs).values({
    companyId: entry.companyId ?? null,
    userId: entry.userId ?? null,
    userName: entry.userName ?? null,
    action: entry.action,
    resource: entry.resource,
    resourceId: entry.resourceId ?? null,
    details: entry.details ?? null,
    severity: entry.severity ?? "info",
    ipAddress: entry.ipAddress ?? null,
    userAgent: entry.userAgent ?? null,
    occurredAt: new Date(),
  });
}
