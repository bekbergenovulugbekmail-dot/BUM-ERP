/**
 * Audit jurnalini o'qish — platforma admini (hamma kompaniyalar) va
 * kompaniya (`audit.view`, faqat o'z kompaniyasi) uchun umumiy.
 *
 * Convex'da listAuditLogs oxirgi 100 ta GLOBAL yozuvni olib, keyin kompaniya
 * bo'yicha filtrlardi — ya'ni faol platformada kompaniya o'z jurnalini deyarli
 * ko'rmasdi. Bu yerda filtr so'rovning o'zida, sahifalash `(vaqt, id)` kursori bilan.
 *
 * Yozish faqat serverda (shared/audit.ts). Convex'dagi createAuditLog kabi
 * mijoz yozadigan endpoint ataylab yo'q — jurnalni qalbakilashtirib bo'lmaydi.
 */
import { and, desc, eq, lt, or } from "drizzle-orm";
import { badRequest } from "@bum/shared";
import { auditLogs, companies } from "../../db/schema/platform.js";
import type { DbOrTx } from "../../db/transaction.js";

/** Kursor — (vaqt, id): bir millisekundda yozilgan yozuvlar ham tushib qolmaydi. */
function encodeCursor(occurredAt: Date, id: string): string {
  return Buffer.from(`${occurredAt.toISOString()}|${id}`).toString("base64url");
}

function decodeCursor(cursor: string): { occurredAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const occurredAt = new Date(iso ?? "");
  if (!id || Number.isNaN(occurredAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw badRequest("Kursor noto'g'ri");
  }
  return { occurredAt, id };
}

export type AuditLogQuery = {
  limit: number;
  companyId?: string;
  resource?: string;
  cursor?: string;
};

export async function listAuditLogs(conn: DbOrTx, options: AuditLogQuery) {
  const after = options.cursor ? decodeCursor(options.cursor) : null;

  const rows = await conn
    .select({
      id: auditLogs.id,
      occurredAt: auditLogs.occurredAt,
      action: auditLogs.action,
      resource: auditLogs.resource,
      resourceId: auditLogs.resourceId,
      severity: auditLogs.severity,
      details: auditLogs.details,
      userId: auditLogs.userId,
      userName: auditLogs.userName,
      ipAddress: auditLogs.ipAddress,
      companyId: auditLogs.companyId,
      companyName: companies.name,
    })
    .from(auditLogs)
    .leftJoin(companies, eq(companies.id, auditLogs.companyId))
    .where(
      and(
        options.companyId ? eq(auditLogs.companyId, options.companyId) : undefined,
        options.resource ? eq(auditLogs.resource, options.resource) : undefined,
        after
          ? or(
              lt(auditLogs.occurredAt, after.occurredAt),
              and(eq(auditLogs.occurredAt, after.occurredAt), lt(auditLogs.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
    .limit(options.limit + 1);

  const page = rows.slice(0, options.limit);
  const last = page.at(-1);
  return {
    logs: page.map((log) => ({ ...log, companyName: log.companyName ?? "Platforma" })),
    nextCursor: rows.length > options.limit && last ? encodeCursor(last.occurredAt, last.id) : null,
  };
}
