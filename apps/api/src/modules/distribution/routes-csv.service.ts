/**
 * Marshrutlarni CSV orqali eksport va import qilish.
 *
 * Hafta kunlari faylda raqam bilan yoziladi: 0 = yakshanba … 6 = shanba ("1,3,5"). Import marshrutning o'zini ochadi;
 * marshrutga do'konlar keyin "Mijoz qo'shish" orqali biriktiriladi (fayl bilan emas — tartib va geografiya muhim).
 */
import { and, asc, eq } from "drizzle-orm";
import { distributionRoutes, salesReps, territories } from "../../db/schema/crm.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import {
  MAX_EXPORT_ROWS,
  csvDocument,
  normalizeKey,
  optionalText,
  type ImportError,
  type ImportOutcome,
} from "../../shared/csv.js";
import type { TenantContext } from "../company/tenant.js";
import { createRoute } from "./distribution.service.js";
import { findOrCreateTerritory } from "./territories.service.js";

const CSV_HEADER = ["Nomi", "Hudud", "Sotuv agenti", "Kunlar (0-6)", "Tavsif", "Rang", "Faol"];

export async function exportRoutesCsv(conn: DbOrTx, tenant: TenantContext, options: { includeInactive?: boolean } = {}) {
  const rows = await conn
    .select({
      name: distributionRoutes.name,
      territoryName: territories.name,
      salesRepName: salesReps.name,
      days: distributionRoutes.days,
      description: distributionRoutes.description,
      color: distributionRoutes.color,
      isActive: distributionRoutes.isActive,
    })
    .from(distributionRoutes)
    .leftJoin(salesReps, eq(salesReps.id, distributionRoutes.salesRepId))
    .leftJoin(territories, eq(territories.id, distributionRoutes.territoryId))
    .where(
      and(
        eq(distributionRoutes.companyId, tenant.company.id),
        options.includeInactive ? undefined : eq(distributionRoutes.isActive, true),
      ),
    )
    .orderBy(asc(distributionRoutes.name), asc(distributionRoutes.id))
    .limit(MAX_EXPORT_ROWS);

  return csvDocument(
    CSV_HEADER,
    rows.map((row) => [
      row.name,
      row.territoryName,
      row.salesRepName,
      (row.days ?? []).join(" "),
      row.description,
      row.color,
      row.isActive ? "ha" : "yo'q",
    ]),
  );
}

export type RouteImportRow = {
  name?: string;
  /** Hudud nomi — marshrut shu hudud tarkibida ochiladi (bo'lmasa hudud yaratiladi). */
  territory?: string;
  salesRep?: string;
  days?: string;
  description?: string;
  color?: string;
};

/** "1,3,5" yoki "1 3 5" → [1,3,5]; noto'g'ri qiymat bo'lsa `null`. */
function parseDays(value: string | undefined): number[] | null {
  const text = (value ?? "").trim();
  if (!text) return [];
  const parts = text.split(/[,;\s]+/).filter(Boolean);
  const days: number[] = [];
  for (const part of parts) {
    const day = Number(part);
    if (!Number.isInteger(day) || day < 0 || day > 6) return null;
    days.push(day);
  }
  return [...new Set(days)];
}

export async function importRoutes(
  tx: Tx,
  tenant: TenantContext,
  rows: RouteImportRow[],
  meta: RequestMeta,
  options: { dryRun?: boolean } = {},
): Promise<ImportOutcome> {
  const companyId = tenant.company.id;
  const dryRun = options.dryRun === true;
  const repIndex = new Map(
    (await tx.select({ id: salesReps.id, name: salesReps.name }).from(salesReps).where(eq(salesReps.companyId, companyId)))
      .map((row) => [row.name.trim().toLowerCase(), row.id]),
  );

  const knownTerritories = new Set(
    (await tx.select({ name: territories.name }).from(territories).where(eq(territories.companyId, companyId)))
      .map((row) => row.name.trim().toLowerCase()),
  );

  // Dublikat kaliti — marshrut nomi (kompaniya ichida)
  const takenNames = new Set(
    (await tx.select({ name: distributionRoutes.name }).from(distributionRoutes).where(eq(distributionRoutes.companyId, companyId)))
      .map((row) => normalizeKey(row.name))
      .filter((value): value is string => Boolean(value)),
  );
  const errors: ImportError[] = [];
  const duplicates: ImportError[] = [];
  const warnings: ImportError[] = [];
  let created = 0;
  let valid = 0;

  for (const [index, row] of rows.entries()) {
    const line = index + 1;
    const name = row.name?.trim() ?? "";
    const fail = (message: string) => errors.push({ row: line, key: name || null, message });

    if (!name) {
      fail("Nomi majburiy");
      continue;
    }
    if (name.length > 200) {
      fail("Nomi juda uzun (200 belgidan ko'p)");
      continue;
    }

    const days = parseDays(row.days);
    if (!days) {
      fail("Kunlar 0 (yakshanba) va 6 (shanba) orasidagi raqamlar bo'lishi kerak, masalan \"1,3,5\"");
      continue;
    }

    // Hudud majburiy: marshrut hudud tarkibida bo'ladi (faylda yangi hudud bo'lsa — ochiladi)
    const territoryName = row.territory?.trim();
    if (!territoryName) {
      fail("Hudud majburiy — marshrut hudud tarkibida bo'ladi");
      continue;
    }
    if (territoryName.length > 200) {
      fail("Hudud nomi juda uzun (200 belgidan ko'p)");
      continue;
    }

    const repName = row.salesRep?.trim();
    const salesRepId = repName ? repIndex.get(repName.toLowerCase()) : undefined;
    if (repName && !salesRepId) {
      fail(`Sotuv agenti topilmadi: ${repName}`);
      continue;
    }

    // CREATE ONLY: shu nomli marshrut bo'lsa yangi yozuv ochilmaydi
    const nameKey = normalizeKey(name);
    if (nameKey && takenNames.has(nameKey)) {
      duplicates.push({ row: line, key: name, message: `"${name}" nomli marshrut allaqachon bor` });
      continue;
    }

    valid += 1;
    if (nameKey) takenNames.add(nameKey);
    if (dryRun) {
      if (!knownTerritories.has(territoryName.toLowerCase())) {
        warnings.push({ row: line, key: name, message: `Yangi hudud ochiladi: ${territoryName}` });
      }
      continue;
    }
    const territoryId = await findOrCreateTerritory(tx, tenant, territoryName, meta);
    knownTerritories.add(territoryName.toLowerCase());
    await createRoute(
      tx,
      tenant,
      {
        name,
        territoryId,
        salesRepId: salesRepId ?? null,
        days,
        description: optionalText(row.description, 2000),
        color: optionalText(row.color, 16),
      },
      meta,
    );
    created += 1;
  }

  return { created, valid, errors, duplicates, warnings, dryRun };
}
