/**
 * Platforma admini: statistika, audit jurnali, foydalanuvchilar, sozlamalar.
 *
 * Convex'dan farqlar:
 *  - platformListAllUsers foydalanuvchi hujjatini to'liq qaytarardi (ichki
 *    maydonlar, PIN xeshi brauzerga yetib borardi) — endi ruxsat ro'yxati
 *  - platformGetSettings autentifikatsiyasiz ochiq edi — endi faqat platforma admini
 *  - platformListAuditLogs faqat `take(limit)` edi — endi kursor bilan sahifalash
 */
import { and, count, desc, eq, ilike, isNull, lt, or } from "drizzle-orm";
import { badRequest } from "@bum/shared";
import { auditLogs, companies, companyMembers, settings, users } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import type { SessionUser } from "../auth/session.js";
import { COMPANY_STATUSES, type CompanyStatus } from "./company.service.js";

// ─── Statistika ──────────────────────────────────────────────────────────────

export async function platformStats(conn: DbOrTx) {
  const [[companyCount], [userCount], [memberCount], statusRows] = await Promise.all([
    conn.select({ n: count() }).from(companies),
    conn.select({ n: count() }).from(users),
    conn.select({ n: count() }).from(companyMembers),
    conn.select({ status: companies.status, n: count() }).from(companies).groupBy(companies.status),
  ]);

  const byStatus = Object.fromEntries(COMPANY_STATUSES.map((s) => [s, 0])) as Record<CompanyStatus, number>;
  for (const row of statusRows) byStatus[row.status] = row.n;

  return {
    totalCompanies: companyCount?.n ?? 0,
    totalUsers: userCount?.n ?? 0,
    totalMembers: memberCount?.n ?? 0,
    byStatus,
  };
}

// ─── Audit jurnali ───────────────────────────────────────────────────────────

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

export async function listAuditLogs(
  conn: DbOrTx,
  options: { limit: number; companyId?: string; cursor?: string },
) {
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

// ─── Foydalanuvchilar ────────────────────────────────────────────────────────

export async function listUsers(
  conn: DbOrTx,
  options: { search?: string; limit: number; offset: number },
) {
  // % va _ qidiruvda oddiy belgi sifatida
  const pattern = options.search ? `%${options.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const where = pattern ? or(ilike(users.phone, pattern), ilike(users.name, pattern)) : undefined;

  const [rows, [total]] = await Promise.all([
    conn
      .select({
        id: users.id,
        phone: users.phone,
        name: users.name,
        email: users.email,
        isActive: users.isActive,
        isPlatformAdmin: users.isPlatformAdmin,
        isBootstrapAdmin: users.isBootstrapAdmin,
        activeCompanyId: users.activeCompanyId,
        activeCompanyName: companies.name,
        lastSeenAt: users.lastSeenAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .leftJoin(companies, eq(companies.id, users.activeCompanyId))
      .where(where)
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(options.limit)
      .offset(options.offset),
    conn.select({ n: count() }).from(users).where(where),
  ]);

  return { users: rows, total: total?.n ?? 0 };
}

// ─── Sozlamalar ──────────────────────────────────────────────────────────────

export type PlatformSettings = {
  registrationEnabled: boolean;
  defaultTrialDays: number;
  platformName: string;
  supportEmail: string;
};

const PLATFORM_GROUP = "platform";

const DEFAULTS: PlatformSettings = {
  registrationEnabled: true,
  defaultTrialDays: 14,
  platformName: "BUM ERP",
  supportEmail: "",
};

const DESCRIPTIONS: Record<keyof PlatformSettings, string> = {
  registrationEnabled: "Yangi kompaniya ro'yxatdan o'tishini yoqish/o'chirish",
  defaultTrialDays: "Yangi kompaniya uchun sinov muddati (kun)",
  platformName: "Platforma nomi",
  supportEmail: "Qo'llab-quvvatlash email",
};

export async function getPlatformSettings(conn: DbOrTx): Promise<PlatformSettings> {
  const rows = await conn
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(and(isNull(settings.companyId), eq(settings.group, PLATFORM_GROUP)));
  const stored = new Map(rows.map((r) => [r.key, r.value]));

  const trialDays = Number.parseInt(stored.get("defaultTrialDays") ?? "", 10);
  return {
    registrationEnabled: (stored.get("registrationEnabled") ?? String(DEFAULTS.registrationEnabled)) === "true",
    defaultTrialDays: Number.isInteger(trialDays) && trialDays >= 0 ? trialDays : DEFAULTS.defaultTrialDays,
    platformName: stored.get("platformName") ?? DEFAULTS.platformName,
    supportEmail: stored.get("supportEmail") ?? DEFAULTS.supportEmail,
  };
}

export async function savePlatformSettings(
  tx: Tx,
  actor: SessionUser,
  patch: Partial<PlatformSettings>,
  meta: RequestMeta,
): Promise<PlatformSettings> {
  const current = await getPlatformSettings(tx);
  const changes = (Object.keys(patch) as (keyof PlatformSettings)[]).filter(
    (key) => patch[key] !== undefined && patch[key] !== current[key],
  );

  for (const key of changes) {
    const value = String(patch[key]);
    // (company_id, key) NULLS NOT DISTINCT — platforma sozlamasi ham bitta qator
    await tx
      .insert(settings)
      .values({ companyId: null, key, value, description: DESCRIPTIONS[key], group: PLATFORM_GROUP, updatedBy: actor.id })
      .onConflictDoUpdate({
        target: [settings.companyId, settings.key],
        set: { value, updatedBy: actor.id, updatedAt: new Date() },
      });
  }

  if (changes.length > 0) {
    await writeAuditLog(
      {
        userId: actor.id,
        userName: actor.name,
        action: "PLATFORM_SETTINGS_UPDATED",
        resource: "settings",
        resourceId: PLATFORM_GROUP,
        severity: "warning",
        details: { changes },
        ...meta,
      },
      tx,
    );
  }

  return { ...current, ...Object.fromEntries(changes.map((key) => [key, patch[key]])) };
}
