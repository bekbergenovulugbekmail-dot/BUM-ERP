/**
 * Kompaniya modullari: holat, yoqish/o'chirish (bog'liqliklar bilan), tarix va audit.
 *
 *  - Yozuv yo'q — yoqilgan (modullar joriy etilgunga qadar ochilgan kompaniyalar to'liq ishlashda davom etadi).
 *  - Yoqish: bog'liq modullar (`dependsOn`) yoqilgan bo'lishi shart; o'chirish: unga bog'liq yoqilgan modul qolmasin.
 *  - O'chirish ma'lumotni o'chirmaydi — faqat kirishni yopadi (module-guard.ts); qayta yoqilganda hammasi avvalgidek.
 *  - Har o'zgarish — `company_module_history` va audit (MODULE_ENABLED / MODULE_DISABLED).
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  AppError,
  MODULE_KEYS,
  MODULE_REGISTRY,
  badRequest,
  isModuleKey,
  moduleDependents,
  notFound,
  withModuleDependencies,
  type CompanyModuleStates,
  type ModuleKey,
} from "@bum/shared";
import { companies, companyModuleHistory, companyModules, users } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";

export type ModuleChangeSource = "owner" | "platform" | "registration";

/** Faqat reyestrdagi modullar — tizim qismlari (dashboard, obuna, sozlamalar ...) bu yerda yo'q, o'zgartirib bo'lmaydi. */
export const moduleKeySchema = z.enum(MODULE_KEYS);
export const moduleListSchema = z.array(moduleKeySchema).max(MODULE_KEYS.length);
export const moduleParamsSchema = z.object({ key: moduleKeySchema });
export const moduleChangeBodySchema = z.strictObject({ enabled: z.boolean(), reason: z.string().trim().max(500).optional() });

const moduleNames = (keys: readonly ModuleKey[]) => keys.map((key) => MODULE_REGISTRY[key].name).join(", ");

export async function companyModuleStates(conn: DbOrTx, companyId: string): Promise<CompanyModuleStates> {
  const rows = await conn
    .select({ moduleKey: companyModules.moduleKey, enabled: companyModules.enabled })
    .from(companyModules)
    .where(eq(companyModules.companyId, companyId));
  const states = Object.fromEntries(MODULE_KEYS.map((key) => [key, true])) as CompanyModuleStates;
  for (const row of rows) if (isModuleKey(row.moduleKey)) states[row.moduleKey] = row.enabled;
  return states;
}

/** Ro'yxatdagi modullardan kamida bittasi yoqilganmi (umumiy API — masalan, mijozlar savdo, POS va CRM uchun). */
export async function isAnyModuleEnabled(conn: DbOrTx, companyId: string, keys: readonly ModuleKey[]): Promise<boolean> {
  const rows = await conn
    .select({ moduleKey: companyModules.moduleKey, enabled: companyModules.enabled })
    .from(companyModules)
    .where(and(eq(companyModules.companyId, companyId), inArray(companyModules.moduleKey, [...keys])));
  return keys.some((key) => rows.find((row) => row.moduleKey === key)?.enabled ?? true);
}

export function moduleDisabledError(keys: readonly ModuleKey[]) {
  return new AppError("MODULE_DISABLED", `${moduleNames(keys)} moduli kompaniyada o'chirilgan`, {
    reason: "module_disabled",
    module: keys[0],
    modules: keys,
  });
}

export async function assertModuleEnabled(conn: DbOrTx, companyId: string, ...keys: ModuleKey[]): Promise<void> {
  if (!(await isAnyModuleEnabled(conn, companyId, keys))) throw moduleDisabledError(keys);
}

export async function listCompanyModules(conn: DbOrTx, companyId: string) {
  const rows = await conn.select().from(companyModules).where(eq(companyModules.companyId, companyId));
  return MODULE_KEYS.map((key) => {
    const row = rows.find((item) => item.moduleKey === key);
    const definition = MODULE_REGISTRY[key];
    return {
      key,
      name: definition.name,
      description: definition.description,
      icon: definition.icon,
      dependsOn: definition.dependsOn,
      dependents: moduleDependents(key),
      enabled: row?.enabled ?? true,
      enabledAt: row?.enabledAt ?? null,
      disabledAt: row?.disabledAt ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

export async function moduleHistory(conn: DbOrTx, companyId: string, limit = 50) {
  return conn
    .select({
      id: companyModuleHistory.id,
      moduleKey: companyModuleHistory.moduleKey,
      enabled: companyModuleHistory.enabled,
      source: companyModuleHistory.source,
      reason: companyModuleHistory.reason,
      changedBy: companyModuleHistory.changedBy,
      changedByName: users.name,
      createdAt: companyModuleHistory.createdAt,
    })
    .from(companyModuleHistory)
    .leftJoin(users, eq(users.id, companyModuleHistory.changedBy))
    .where(eq(companyModuleHistory.companyId, companyId))
    .orderBy(desc(companyModuleHistory.createdAt), desc(companyModuleHistory.id))
    .limit(limit);
}

export async function assertCompanyExists(conn: DbOrTx, companyId: string) {
  const [row] = await conn.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!row) throw notFound("Kompaniya topilmadi");
}

export async function setCompanyModule(
  tx: Tx,
  input: {
    companyId: string;
    key: ModuleKey;
    enabled: boolean;
    actor: { id: string; name: string | null };
    source: Exclude<ModuleChangeSource, "registration">;
    reason?: string | null;
  },
  meta: RequestMeta,
) {
  const { companyId, key, enabled, actor } = input;
  // Kompaniya qatori qulflanadi — bir vaqtdagi ikki o'zgarish bog'liqlik tekshiruvini chetlab o'tmasin
  const [company] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).limit(1).for("update");
  if (!company) throw notFound("Kompaniya topilmadi");
  const states = await companyModuleStates(tx, companyId);
  if (states[key] === enabled) return { changed: false, modules: await listCompanyModules(tx, companyId) };

  if (enabled) {
    const missing = MODULE_REGISTRY[key].dependsOn.filter((dependency) => !states[dependency]);
    if (missing.length > 0) {
      throw badRequest(`Avval ${moduleNames(missing)} modulini yoqing`, { reason: "module_dependency_disabled", module: key, requires: missing });
    }
  } else {
    const dependents = moduleDependents(key).filter((dependent) => states[dependent]);
    if (dependents.length > 0) {
      throw badRequest(`Avval ${moduleNames(dependents)} modulini o'chiring — u ${MODULE_REGISTRY[key].name} moduliga bog'liq`, {
        reason: "module_has_dependents",
        module: key,
        dependents,
      });
    }
  }

  const now = new Date();
  await tx
    .insert(companyModules)
    .values({
      companyId,
      moduleKey: key,
      enabled,
      enabledAt: enabled ? now : null,
      disabledAt: enabled ? null : now,
      changedBy: actor.id,
    })
    .onConflictDoUpdate({
      target: [companyModules.companyId, companyModules.moduleKey],
      set: { enabled, ...(enabled ? { enabledAt: now } : { disabledAt: now }), changedBy: actor.id, updatedAt: now },
    });
  await tx.insert(companyModuleHistory).values({
    companyId,
    moduleKey: key,
    enabled,
    source: input.source,
    reason: input.reason ?? null,
    changedBy: actor.id,
  });
  await writeAuditLog(
    {
      userId: actor.id,
      userName: actor.name,
      companyId,
      action: enabled ? "MODULE_ENABLED" : "MODULE_DISABLED",
      resource: "company_modules",
      resourceId: key,
      details: { module: key, source: input.source, ...(input.reason ? { reason: input.reason } : {}) },
      ...meta,
    },
    tx,
  );
  return { changed: true, modules: await listCompanyModules(tx, companyId) };
}

/**
 * Yangi kompaniya: tanlangan modullar (bog'liqliklari avtomatik qo'shiladi) yoqiladi, qolganlari o'chiq yoziladi.
 * Tanlov berilmasa — yozuv yo'q, hammasi yoqilgan (platforma admini yaratgan va eski mijozlar uchun moslik).
 */
export async function seedCompanyModules(
  tx: Tx,
  companyId: string,
  selected: readonly ModuleKey[] | undefined,
  actorId: string,
  source: ModuleChangeSource,
) {
  if (!selected) return;
  const enabledKeys = new Set(withModuleDependencies(selected));
  const now = new Date();
  await tx.insert(companyModules).values(
    MODULE_KEYS.map((key) => ({
      companyId,
      moduleKey: key,
      enabled: enabledKeys.has(key),
      enabledAt: enabledKeys.has(key) ? now : null,
      disabledAt: enabledKeys.has(key) ? null : now,
      changedBy: actorId,
    })),
  );
  await tx
    .insert(companyModuleHistory)
    .values(MODULE_KEYS.map((key) => ({ companyId, moduleKey: key, enabled: enabledKeys.has(key), source, changedBy: actorId })));
}
