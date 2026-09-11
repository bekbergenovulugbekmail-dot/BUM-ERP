/**
 * Convex eksportidan PostgreSQL'ga ko'chirish (PHASE 15).
 *
 * Kirish: `npx convex export --path export.zip` → ochilgan papka (`<jadval>/documents.jsonl`).
 *
 * Qoidalar:
 *  - qayta ishga tushirsa bo'ladi: har yozuv `legacy_id` (Convex `_id`) bo'yicha upsert; ID xaritasi
 *    bazadagi mavjud `legacy_id` lardan ham to'ldiriladi
 *  - har yozuv alohida savepoint'da — cheklov buzilishi butun importni to'xtatmaydi, hisobotga yoziladi
 *  - kompaniyasiz yoki bog'liq yozuvi topilmagan yozuvlar o'tkazib yuboriladi (Convex ularni tenantlarga ko'rsatmasdi)
 *  - takrorlangan kod/raqamga qo'shimcha qo'yiladi ("A1" → "A1-2"), ikkinchi "asosiy" belgisi olinadi — ogohlantirish bilan
 *  - float summalar aniq o'nlikka yaxlitlanadi; buxgalteriya yozuvi qatorlari bilan bitta savepoint'da,
 *    jami qatorlardan qayta hisoblanadi; ±1 so'mdan ko'p balanslanmagan "posted" yozuv qoralama bo'lib keladi
 *  - parol xeshlari (lucia scrypt) ko'chiriladi, birinchi kirishda argon2id ga almashadi; qayta importda
 *    yangi tizimda o'zgargan parol ustidan yozilmaydi. PIN (SHA-256) ko'chirilmaydi — qayta o'rnatiladi
 *  - tashqi URL'lar (mahsulot rasmi, logo, avatar, chek, xodim surati) ko'chirilmaydi — saqlangan XSS yo'li
 *  - bootstrap admin maqomi import qilinmaydi; takliflar ko'chirilmaydi (yakuniy qaror)
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { LEGACY_PERMISSION_ALIASES, isPermission } from "@bum/shared";
import { batches, brands, categories, products, unitConversions, units } from "../db/schema/catalog.js";
import { crmTables } from "./tables.js";
import { accounts, cashAccounts, cashTransactions, expenses, journalEntries, journalLines } from "../db/schema/finance.js";
import { attendances, departments, employees, leaves, positions, salaryPayments } from "../db/schema/hr.js";
import { inventoryCountItems, inventoryCounts, stockLevels, stockMovements, warehouseZones, warehouses } from "../db/schema/inventory.js";
import { bomItems, boms, productionMaterials, productionOrders, productionTimeLines, workCenters } from "../db/schema/manufacturing.js";
import { notifications } from "../db/schema/notifications.js";
import { auditLogs, branches, companies, companyMembers, roles, settings, users } from "../db/schema/platform.js";
import {
  purchaseOrderItems,
  purchaseOrders,
  purchaseReceiptItems,
  purchaseReceipts,
  supplierPayments,
  suppliers,
} from "../db/schema/purchase.js";
import { customerPayments, customers, posShifts, salesOrderItems, salesOrders } from "../db/schema/sales.js";
import { withTransaction, type Tx } from "../db/transaction.js";
import { fromMinor, mulDivRound, rescale, toMinor } from "../shared/decimal.js";
import { seedFinanceDefaults } from "../modules/finance/accounts.service.js";
import {
  bool,
  creationDate,
  creationIsoDate,
  email,
  int,
  internalLink,
  isNegative,
  isoDate,
  money,
  moneyOrNull,
  oneOf,
  percent,
  phone,
  qty,
  qtyOrNull,
  text,
  timeOfDay,
  timestamp,
  type ConvexDoc,
} from "./convert.js";

export type TableReport = {
  read: number;
  imported: number;
  skipped: number;
  reasons: Record<string, number>;
  warnings: Record<string, number>;
};

export type ImportReport = {
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  tables: Record<string, TableReport>;
  reconciliation: Record<string, string | number>;
};

type LegacyTable = PgTable & { id: PgColumn; legacyId: PgColumn };

class DryRunRollback extends Error {}

// ─── Kontekst ────────────────────────────────────────────────────────────────

class Context {
  /** Convex `_id` → PostgreSQL UUID (Convex ID'lari jadvallar bo'ylab noyob). */
  readonly ids = new Map<string, string>();
  /** Yangi UUID → kompaniya UUID (companyId'si yo'q Convex jadvallari uchun). */
  readonly companyOf = new Map<string, string>();
  readonly report: Record<string, TableReport> = {};

  constructor(
    readonly tx: Tx,
    readonly dir: string,
  ) {}

  table(name: string): TableReport {
    return (this.report[name] ??= { read: 0, imported: 0, skipped: 0, reasons: {}, warnings: {} });
  }

  skip(name: string, reason: string) {
    const table = this.table(name);
    table.skipped += 1;
    table.reasons[reason] = (table.reasons[reason] ?? 0) + 1;
  }

  warn(name: string, warning: string) {
    const table = this.table(name);
    table.warnings[warning] = (table.warnings[warning] ?? 0) + 1;
  }

  ref(value: unknown): string | null {
    return typeof value === "string" ? this.ids.get(value) ?? null : null;
  }

  async load(name: string): Promise<ConvexDoc[]> {
    const file = join(this.dir, name, "documents.jsonl");
    if (!existsSync(file)) return [];
    const docs = (await readFile(file, "utf8"))
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as ConvexDoc);
    this.table(name).read += docs.length;
    return docs;
  }

  /** Majburiy havolalar; bittasi topilmasa yozuv o'tkazib yuboriladi (sabab bir marta). */
  refs<K extends string>(name: string, doc: ConvexDoc, fields: Record<K, unknown>): Record<K, string> | null {
    const out = {} as Record<K, string>;
    for (const [field, value] of Object.entries(fields) as [K, unknown][]) {
      const id = this.ref(value);
      if (!id) {
        this.skip(name, field === "companyId" ? "kompaniya topilmadi (kompaniyasiz yozuv)" : `bog'liq yozuv topilmadi: ${field}`);
        return null;
      }
      out[field] = id;
    }
    return out;
  }
}

function pgError(error: unknown): { code?: string; constraint?: string } {
  const candidate = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  return candidate.cause?.code ? candidate.cause : candidate;
}

const DATA_ERRORS = new Set(["23505", "23514", "23503", "23502", "22P02", "22003", "22007", "22008"]);

/** Savepoint'da upsert; cheklov buzilsa — hisobotga, import davom etadi. */
async function save<T extends LegacyTable>(
  ctx: Context,
  name: string,
  table: T,
  doc: ConvexDoc,
  values: Omit<T["$inferInsert"], "legacyId">,
  update?: Partial<T["$inferInsert"]>,
): Promise<string | null> {
  try {
    const id = await ctx.tx.transaction(async (sp) => {
      const rows = (await sp
        .insert(table)
        .values({ ...values, legacyId: doc._id } as never)
        .onConflictDoUpdate({ target: table.legacyId, set: (update ?? values) as never })
        .returning({ id: table.id })) as { id: string }[];
      return rows[0]!.id;
    });
    ctx.ids.set(doc._id, id);
    ctx.table(name).imported += 1;
    return id;
  } catch (error) {
    const { code, constraint } = pgError(error);
    if (code && DATA_ERRORS.has(code)) {
      ctx.skip(name, `baza cheklovi: ${constraint ?? code}`);
      return null;
    }
    throw error;
  }
}

/** Kompaniya (yoki boshqa) doirasida noyob kod: bandi bo'lsa "-2", "-3" … qo'shiladi. */
class UniqueValues {
  private readonly taken = new Map<string, string>();

  static async load(ctx: Context, table: string, scopeSql: string, column: string) {
    const unique = new UniqueValues();
    const result = await ctx.tx.execute<{ scope: string | null; value: string | null; legacy_id: string | null }>(
      sql`select ${sql.raw(scopeSql)} as scope, ${sql.identifier(column)} as value, legacy_id from ${sql.identifier(table)}`,
    );
    for (const row of result.rows) {
      if (row.value !== null) unique.taken.set(`${row.scope}|${row.value}`, row.legacy_id ?? "");
    }
    return unique;
  }

  claim(scope: string, value: string, legacyId: string, maxLength: number): { value: string; renamed: boolean } {
    let candidate = value.slice(0, maxLength);
    for (let n = 2; ; n++) {
      const key = `${scope}|${candidate}`;
      const owner = this.taken.get(key);
      if (owner === undefined || owner === legacyId) {
        this.taken.set(key, legacyId);
        return { value: candidate, renamed: candidate !== value };
      }
      const suffix = `-${n}`;
      candidate = value.slice(0, maxLength - suffix.length) + suffix;
    }
  }
}

/** "Faqat bittasi" belgilari (asosiy filial/ombor/kassa, ochiq smena): ikkinchisi olinadi. */
class SingleFlags {
  private readonly owners = new Map<string, string>();

  static async load(ctx: Context, table: string, scopeColumn: string, condition: string) {
    const flags = new SingleFlags();
    const result = await ctx.tx.execute<{ scope: string; legacy_id: string | null }>(
      sql`select ${sql.identifier(scopeColumn)}::text as scope, legacy_id from ${sql.identifier(table)} where ${sql.raw(condition)}`,
    );
    for (const row of result.rows) flags.owners.set(row.scope, row.legacy_id ?? "");
    return flags;
  }

  claim(scope: string, legacyId: string): boolean {
    const owner = this.owners.get(scope);
    if (owner === undefined || owner === legacyId) {
      this.owners.set(scope, legacyId);
      return true;
    }
    return false;
  }
}

function codeFor(ctx: Context, name: string, unique: UniqueValues, scope: string, doc: ConvexDoc, value: unknown, max: number, fallback: string) {
  const raw = text(value, max) ?? fallback;
  const claimed = unique.claim(scope, raw, doc._id, max);
  if (claimed.renamed) ctx.warn(name, "takrorlangan kod/raqam — qo'shimcha qo'yildi");
  return claimed.value;
}

async function preloadIds(ctx: Context) {
  const tables = await ctx.tx.execute<{ table_name: string }>(
    sql`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'legacy_id'`,
  );
  for (const { table_name } of tables.rows) {
    const rows = await ctx.tx.execute<{ id: string; legacy_id: string }>(
      sql`select id, legacy_id from ${sql.identifier(table_name)} where legacy_id is not null`,
    );
    for (const row of rows.rows) ctx.ids.set(row.legacy_id, row.id);
  }
}

// ─── Platforma ───────────────────────────────────────────────────────────────

const ROLE_NAMES: Record<string, string> = {
  owner: "Business Owner",
  "business owner": "Business Owner",
  superadmin: "Superadmin",
  director: "Direktor",
  accountant: "Buxgalter",
  cashier: "Kassir",
  viewer: "Ko'ruvchi",
};

async function importPlatform(ctx: Context) {
  const passwords = new Map(
    (await ctx.load("authAccounts"))
      .filter((a) => a.provider === "password" && typeof a.secret === "string")
      .map((a) => [a.userId as string, a.secret as string]),
  );

  const userDocs = await ctx.load("users");
  for (const doc of userDocs) {
    const phoneValue = phone(doc.phone) ?? phone(doc.email);
    if (!phoneValue) {
      ctx.skip("users", "telefon raqami yo'q yoki noto'g'ri");
      continue;
    }
    const secret = passwords.get(doc._id) ?? null;
    const profile = {
      phone: phoneValue,
      name: text(doc.name, 200),
      email: email(doc.email),
      isActive: bool(doc.isActive, true),
      isPlatformAdmin: bool(doc.isPlatformAdmin, false),
      autoLockSeconds: Math.max(0, int(doc.autoLockTimeoutSeconds, 30)),
      lastSeenAt: timestamp(doc.lastSeen),
      createdAt: creationDate(doc),
    };
    // Qayta importda yangi tizimda o'zgargan parol ustidan yozilmaydi
    await save(ctx, "users", users, doc, { ...profile, passwordHash: secret, passwordAlgo: secret ? "scrypt" : "argon2id" }, profile);
    if (!secret) ctx.warn("users", "parolsiz — SMS orqali tiklash yoki admin o'rnatishi kerak");
    if (doc.pinHash) ctx.warn("users", "PIN ko'chirilmadi — qayta o'rnatiladi");
    if (doc.avatar || doc.image) ctx.warn("users", "tashqi avatar URL ko'chirilmadi");
  }

  const slugs = await UniqueValues.load(ctx, "companies", "'all'", "slug");
  const companyDocs = await ctx.load("companies");
  for (const doc of companyDocs) {
    const rawSlug = text(doc.slug, 40);
    const slug = rawSlug && /^[a-z0-9-]{3,40}$/.test(rawSlug) ? slugs.claim("all", rawSlug, doc._id, 40).value : null;
    const country = text(doc.country)?.toUpperCase();
    const currency = text(doc.currency)?.toUpperCase();
    await save(ctx, "companies", companies, doc, {
      name: text(doc.name, 200) ?? "Nomsiz kompaniya",
      legalName: text(doc.legalName, 300),
      taxId: text(doc.taxId, 32),
      phone: text(doc.phone, 20),
      email: email(doc.email),
      website: text(doc.website, 255),
      address: text(doc.address),
      city: text(doc.city, 100),
      region: text(doc.region, 100),
      country: country && country.length === 2 ? country : "UZ",
      currency: currency && currency.length === 3 ? currency : "UZS",
      language: oneOf(doc.language, ["uz", "ru", "kk"] as const, "uz"),
      slug,
      ownerId: ctx.ref(doc.ownerId),
      status: oneOf(doc.status, ["active", "trial", "pending", "suspended", "cancelled"] as const, "active"),
      isDefault: bool(doc.isDefault, false),
      isActive: bool(doc.isActive, true),
      isPlatformTenant: bool(doc.isPlatformTenant, false),
      suspendedAt: timestamp(doc.suspendedAt),
      suspendReason: text(doc.suspendReason),
      trialEndsAt: timestamp(doc.trialEndsAt),
      createdAt: creationDate(doc),
    });
    if (rawSlug && slug !== rawSlug) ctx.warn("companies", "slug noto'g'ri yoki band — o'zgartirildi/olib tashlandi");
    if (doc.logoUrl) ctx.warn("companies", "tashqi logo URL ko'chirilmadi");
  }

  for (const doc of userDocs) {
    const userId = ctx.ref(doc._id);
    const companyId = ctx.ref(doc.activeCompanyId);
    if (userId && companyId) await ctx.tx.update(users).set({ activeCompanyId: companyId }).where(eq(users.id, userId));
  }

  const branchCodes = await UniqueValues.load(ctx, "branches", "company_id::text", "code");
  const defaultBranches = await SingleFlags.load(ctx, "branches", "company_id", "is_default");
  for (const doc of await ctx.load("branches")) {
    const r = ctx.refs("branches", doc, { companyId: doc.companyId });
    if (!r) continue;
    let isDefault = bool(doc.isDefault, false);
    if (isDefault && !defaultBranches.claim(r.companyId, doc._id)) {
      isDefault = false;
      ctx.warn("branches", "ikkinchi asosiy filial — oddiy filial qilindi");
    }
    await save(ctx, "branches", branches, doc, {
      companyId: r.companyId,
      name: text(doc.name, 200) ?? "Filial",
      code: codeFor(ctx, "branches", branchCodes, r.companyId, doc, doc.code, 32, "BR"),
      address: text(doc.address),
      city: text(doc.city, 100),
      phone: text(doc.phone, 20),
      isDefault,
      isActive: bool(doc.isActive, true),
      createdAt: creationDate(doc),
    });
  }

  for (const doc of await ctx.load("roles")) {
    const companyId = doc.companyId === undefined ? null : ctx.ref(doc.companyId);
    if (doc.companyId !== undefined && !companyId) {
      ctx.skip("roles", "kompaniya topilmadi (kompaniyasiz yozuv)");
      continue;
    }
    const name = text(doc.name, 100) ?? "Rol";
    const [existing] = await ctx.tx
      .select({ id: roles.id, legacyId: roles.legacyId })
      .from(roles)
      .where(and(companyId ? eq(roles.companyId, companyId) : isNull(roles.companyId), eq(roles.name, name)))
      .limit(1);
    if (existing && existing.legacyId !== doc._id) {
      // Standart rol (seed) yoki kompaniya bilan yaratilgan rol — ustidan yozilmaydi, faqat bog'lanadi
      ctx.ids.set(doc._id, existing.id);
      ctx.warn("roles", "mavjud rolga bog'landi (ruxsatlar yangi tizimdagicha)");
      continue;
    }
    const permissions = Array.isArray(doc.permissions)
      ? [...new Set((doc.permissions as unknown[]).flatMap((p) => {
          if (typeof p !== "string") return [];
          const mapped = LEGACY_PERMISSION_ALIASES[p] ?? p;
          return isPermission(mapped) ? [mapped] : [];
        }))]
      : [];
    await save(ctx, "roles", roles, doc, {
      companyId,
      name,
      description: text(doc.description),
      color: text(doc.color, 16),
      permissions,
      isSystem: bool(doc.isSystem, false),
      isActive: bool(doc.isActive, true),
      memberCount: Math.max(0, int(doc.memberCount, 0)),
      createdAt: creationDate(doc),
    });
  }

  for (const doc of await ctx.load("settings")) {
    const companyId = doc.companyId === undefined ? null : ctx.ref(doc.companyId);
    if (doc.companyId !== undefined && !companyId) {
      ctx.skip("settings", "kompaniya topilmadi (kompaniyasiz yozuv)");
      continue;
    }
    await save(ctx, "settings", settings, doc, {
      companyId,
      key: text(doc.key, 100) ?? "unknown",
      value: typeof doc.value === "string" ? doc.value : JSON.stringify(doc.value ?? ""),
      description: text(doc.description),
      group: text(doc.group, 50) ?? "general",
      updatedBy: ctx.ref(doc.updatedBy),
      createdAt: creationDate(doc),
    });
  }
}

async function importMembers(ctx: Context) {
  for (const doc of await ctx.load("companyMembers")) {
    const r = ctx.refs("companyMembers", doc, { companyId: doc.companyId, userId: doc.userId });
    if (!r) continue;
    const rawRole = text(doc.companyRole, 100) ?? "Kassir";
    const companyRole = ROLE_NAMES[rawRole.toLowerCase()] ?? rawRole;
    if (companyRole !== rawRole) ctx.warn("companyMembers", "rol nomi yangi nomga moslashtirildi");
    const allowed = Array.isArray(doc.allowedWarehouseIds)
      ? (doc.allowedWarehouseIds as unknown[]).map((id) => ctx.ref(id)).filter((id): id is string => id !== null)
      : [];
    await save(ctx, "companyMembers", companyMembers, doc, {
      companyId: r.companyId,
      userId: r.userId,
      companyRole,
      roleId: null,
      branchId: ctx.ref(doc.branchId),
      allowedWarehouseIds: allowed,
      isActive: bool(doc.isActive, true),
      joinedAt: timestamp(doc.joinedAt) ?? creationDate(doc),
      createdAt: creationDate(doc),
    });
  }
}

// ─── Katalog va ombor ────────────────────────────────────────────────────────

async function importCatalog(ctx: Context) {
  for (const doc of await ctx.load("units")) {
    const name = text(doc.name, 60) ?? "birlik";
    if (!ctx.ids.has(doc._id)) {
      const [existing] = await ctx.tx.select({ id: units.id }).from(units).where(eq(units.name, name)).limit(1);
      if (existing) {
        ctx.ids.set(doc._id, existing.id);
        ctx.warn("units", "mavjud birlikka bog'landi");
        continue;
      }
    }
    await save(ctx, "units", units, doc, {
      name,
      shortName: text(doc.shortName, 16) ?? name.slice(0, 16),
      isBase: bool(doc.isBase, false),
      createdAt: creationDate(doc),
    });
  }

  const categoryDocs = await ctx.load("categories");
  for (const doc of categoryDocs) {
    const r = ctx.refs("categories", doc, { companyId: doc.companyId });
    if (!r) continue;
    const id = await save(ctx, "categories", categories, doc, {
      companyId: r.companyId,
      name: text(doc.name, 200) ?? "Kategoriya",
      description: text(doc.description),
      sortOrder: int(doc.sortOrder, 0),
      isActive: bool(doc.isActive, true),
      createdAt: creationDate(doc),
    });
    if (id) ctx.companyOf.set(id, r.companyId);
  }
  for (const doc of categoryDocs) {
    const id = ctx.ref(doc._id);
    const parentId = ctx.ref(doc.parentId);
    if (id && parentId && parentId !== id && ctx.companyOf.get(parentId) === ctx.companyOf.get(id)) {
      await ctx.tx.update(categories).set({ parentId }).where(eq(categories.id, id));
    }
  }

  const brandNames = await UniqueValues.load(ctx, "brands", "company_id::text", "name");
  for (const doc of await ctx.load("brands")) {
    const r = ctx.refs("brands", doc, { companyId: doc.companyId });
    if (!r) continue;
    await save(ctx, "brands", brands, doc, {
      companyId: r.companyId,
      name: codeFor(ctx, "brands", brandNames, r.companyId, doc, doc.name, 200, "Brend"),
      description: text(doc.description),
      isActive: bool(doc.isActive, true),
      createdAt: creationDate(doc),
    });
  }

  const skus = await UniqueValues.load(ctx, "products", "company_id::text", "sku");
  for (const doc of await ctx.load("products")) {
    const r = ctx.refs("products", doc, { companyId: doc.companyId, baseUnitId: doc.baseUnitId });
    if (!r) continue;
    if (doc.costingMethod && doc.costingMethod !== "average") ctx.warn("products", "tannarx usuli AVCO ga o'tkazildi");
    if (doc.imageUrl) ctx.warn("products", "tashqi rasm URL ko'chirilmadi");
    const id = await save(ctx, "products", products, doc, {
      companyId: r.companyId,
      name: text(doc.name, 300) ?? "Mahsulot",
      sku: codeFor(ctx, "products", skus, r.companyId, doc, doc.sku, 64, "SKU"),
      barcode: text(doc.barcode, 64),
      qrCode: text(doc.qrCode, 128),
      description: text(doc.description),
      categoryId: ctx.ref(doc.categoryId),
      brandId: ctx.ref(doc.brandId),
      manufacturer: text(doc.manufacturer, 200),
      baseUnitId: r.baseUnitId,
      purchaseUnitId: ctx.ref(doc.purchaseUnitId),
      salesUnitId: ctx.ref(doc.salesUnitId),
      purchasePrice: nonNegative(qty(doc.purchasePrice)),
      salesPrice: nonNegative(qty(doc.salesPrice)),
      wholesalePrice: qtyOrNull(doc.wholesalePrice),
      retailPrice: qtyOrNull(doc.retailPrice),
      promoPrice: qtyOrNull(doc.promoPrice),
      promoPriceEnd: isoDate(doc.promoPriceEnd),
      taxRate: percent(doc.taxRate),
      taxIncluded: bool(doc.taxIncluded, true),
      minStock: qty(doc.minStock),
      maxStock: qtyOrNull(doc.maxStock),
      reorderPoint: qtyOrNull(doc.reorderPoint),
      trackBatch: bool(doc.trackBatch, false),
      trackExpiry: bool(doc.trackExpiry, false),
      shelfLifeDays: typeof doc.shelfLifeDays === "number" ? int(doc.shelfLifeDays, 0) : null,
      costingMethod: "average",
      isActive: bool(doc.isActive, true),
      isSaleable: bool(doc.isSaleable, true),
      isPurchaseable: bool(doc.isPurchaseable, true),
      isManufactured: bool(doc.isManufactured, false),
      weight: qtyOrNull(doc.weight),
      weightUnit: text(doc.weightUnit, 16),
      createdAt: creationDate(doc),
    });
    if (id) ctx.companyOf.set(id, r.companyId);
  }

  for (const doc of await ctx.load("unitConversions")) {
    const productId = ctx.ref(doc.productId);
    const companyId = productId ? ctx.companyOf.get(productId) : undefined;
    if (!productId || !companyId) {
      ctx.skip("unitConversions", "kompaniyasiz (global) konversiya — kompaniya o'zi qayta kiritadi");
      continue;
    }
    const r = ctx.refs("unitConversions", doc, { fromUnitId: doc.fromUnitId, toUnitId: doc.toUnitId });
    if (!r) continue;
    const factor = qtyOrNull(doc.factor);
    if (!factor || toMinor(factor, 4) <= 0n) {
      ctx.skip("unitConversions", "koeffitsient noto'g'ri");
      continue;
    }
    await save(ctx, "unitConversions", unitConversions, doc, {
      companyId,
      productId,
      fromUnitId: r.fromUnitId,
      toUnitId: r.toUnitId,
      factor,
      createdAt: creationDate(doc),
    });
  }
}

const nonNegative = (value: string) => (isNegative(value) ? "0" : value);

async function importInventory(ctx: Context) {
  const codes = await UniqueValues.load(ctx, "warehouses", "company_id::text", "code");
  const defaults = await SingleFlags.load(ctx, "warehouses", "company_id", "is_default");
  for (const doc of await ctx.load("warehouses")) {
    const r = ctx.refs("warehouses", doc, { companyId: doc.companyId });
    if (!r) continue;
    let isDefault = bool(doc.isDefault, false);
    if (isDefault && !defaults.claim(r.companyId, doc._id)) {
      isDefault = false;
      ctx.warn("warehouses", "ikkinchi asosiy ombor — oddiy ombor qilindi");
    }
    const id = await save(ctx, "warehouses", warehouses, doc, {
      companyId: r.companyId,
      name: text(doc.name, 200) ?? "Ombor",
      code: codeFor(ctx, "warehouses", codes, r.companyId, doc, doc.code, 32, "WH"),
      address: text(doc.address),
      city: text(doc.city, 100),
      phone: text(doc.phone, 20),
      managerId: ctx.ref(doc.managerId),
      isDefault,
      isActive: bool(doc.isActive, true),
      notes: text(doc.notes),
      createdAt: creationDate(doc),
    });
    if (id) ctx.companyOf.set(id, r.companyId);
  }

  for (const doc of await ctx.load("warehouseZones")) {
    const r = ctx.refs("warehouseZones", doc, { warehouseId: doc.warehouseId });
    if (!r) continue;
    await save(ctx, "warehouseZones", warehouseZones, doc, {
      companyId: ctx.companyOf.get(r.warehouseId)!,
      warehouseId: r.warehouseId,
      name: text(doc.name, 100) ?? "Zona",
      type: oneOf(doc.type, ["zone", "rack", "shelf", "bin"] as const, "zone"),
      isActive: bool(doc.isActive, true),
      createdAt: creationDate(doc),
    });
  }

  const suppliersLater = new Map<string, string>();
  for (const doc of await ctx.load("batches")) {
    const r = ctx.refs("batches", doc, { productId: doc.productId, unitId: doc.unitId });
    if (!r) continue;
    const quantity = qty(doc.quantity);
    const id = await save(ctx, "batches", batches, doc, {
      companyId: ctx.companyOf.get(r.productId)!,
      productId: r.productId,
      batchNumber: text(doc.batchNumber, 64) ?? "—",
      supplierId: null,
      warehouseId: ctx.ref(doc.warehouseId),
      manufacturedDate: isoDate(doc.manufacturedDate),
      expiryDate: isoDate(doc.expiryDate),
      quantity: nonNegative(quantity),
      unitId: r.unitId,
      costPrice: nonNegative(qty(doc.costPrice)),
      notes: text(doc.notes),
      createdAt: creationDate(doc),
    });
    if (id && typeof doc.supplierId === "string") suppliersLater.set(id, doc.supplierId);
    if (isNegative(quantity)) ctx.warn("batches", "manfiy miqdor 0 qilindi");
  }

  const levelKeys = new Set<string>();
  for (const doc of await ctx.load("stockLevels")) {
    const r = ctx.refs("stockLevels", doc, { productId: doc.productId, warehouseId: doc.warehouseId });
    if (!r) continue;
    const key = `${r.productId}|${r.warehouseId}`;
    if (levelKeys.has(key)) {
      ctx.skip("stockLevels", "takrorlangan mahsulot+ombor qoldig'i");
      continue;
    }
    levelKeys.add(key);
    const quantity = qty(doc.quantity);
    if (isNegative(quantity)) ctx.warn("stockLevels", "manfiy qoldiq 0 qilindi — inventarizatsiya tavsiya etiladi");
    await save(ctx, "stockLevels", stockLevels, doc, {
      companyId: ctx.companyOf.get(r.warehouseId)!,
      productId: r.productId,
      warehouseId: r.warehouseId,
      quantity: nonNegative(quantity),
      reservedQty: nonNegative(qty(doc.reservedQty)),
      avgCostPrice: nonNegative(qty(doc.avgCostPrice)),
      createdAt: creationDate(doc),
    });
  }
  return suppliersLater;
}

// ─── Moliya ──────────────────────────────────────────────────────────────────

function ledgerReference(ctx: Context, value: unknown): string | null {
  if (typeof value !== "string") return null;
  return ctx.ref(value) ?? ctx.ref(value.split("-").pop());
}

async function importFinance(ctx: Context) {
  const accountCodes = await UniqueValues.load(ctx, "accounts", "company_id::text", "code");
  const accountDocs = await ctx.load("accounts");
  for (const doc of accountDocs) {
    const r = ctx.refs("accounts", doc, { companyId: doc.companyId });
    if (!r) continue;
    const id = await save(ctx, "accounts", accounts, doc, {
      companyId: r.companyId,
      code: codeFor(ctx, "accounts", accountCodes, r.companyId, doc, doc.code, 32, "ACC"),
      name: text(doc.name, 200) ?? "Hisob",
      type: oneOf(doc.type, ["asset", "liability", "equity", "income", "expense"] as const, "asset"),
      subtype: text(doc.subtype, 64),
      currency: text(doc.currency, 3)?.toUpperCase() ?? "UZS",
      balance: money(doc.balance),
      description: text(doc.description),
      isActive: bool(doc.isActive, true),
      createdAt: creationDate(doc),
    });
    if (id) ctx.companyOf.set(id, r.companyId);
  }
  for (const doc of accountDocs) {
    const id = ctx.ref(doc._id);
    const parentId = ctx.ref(doc.parentId);
    if (id && parentId && parentId !== id && ctx.companyOf.get(parentId) === ctx.companyOf.get(id)) {
      await ctx.tx.update(accounts).set({ parentId }).where(eq(accounts.id, id));
    }
  }

  const cashDefaults = await SingleFlags.load(ctx, "cash_accounts", "company_id", "is_default");
  for (const doc of await ctx.load("cashAccounts")) {
    const r = ctx.refs("cashAccounts", doc, { companyId: doc.companyId });
    if (!r) continue;
    let isDefault = bool(doc.isDefault, false);
    if (isDefault && !cashDefaults.claim(r.companyId, doc._id)) {
      isDefault = false;
      ctx.warn("cashAccounts", "ikkinchi asosiy kassa — oddiy kassa qilindi");
    }
    const balance = money(doc.balance);
    if (isNegative(balance)) ctx.warn("cashAccounts", "manfiy kassa qoldig'i — tekshirish kerak");
    const id = await save(ctx, "cashAccounts", cashAccounts, doc, {
      companyId: r.companyId,
      name: text(doc.name, 200) ?? "Kassa",
      type: oneOf(doc.type, ["cash", "bank"] as const, "cash"),
      currency: text(doc.currency, 3)?.toUpperCase() ?? "UZS",
      bankName: text(doc.bankName, 200),
      accountNumber: text(doc.accountNumber, 64),
      balance,
      isDefault,
      isActive: bool(doc.isActive, true),
      createdAt: creationDate(doc),
    });
    if (id) ctx.companyOf.set(id, r.companyId);
  }

  // Buxgalteriya yozuvi va qatorlari birga — kechiktirilgan balans triggeri commit'da tekshiradi
  const linesByEntry = new Map<string, ConvexDoc[]>();
  for (const line of await ctx.load("journalLines")) {
    const list = linesByEntry.get(line.entryId as string) ?? [];
    list.push(line);
    linesByEntry.set(line.entryId as string, list);
  }
  const entryNumbers = await UniqueValues.load(ctx, "journal_entries", "company_id::text", "number");
  const references = new Set<string>();
  for (const doc of await ctx.load("journalEntries")) {
    const r = ctx.refs("journalEntries", doc, { companyId: doc.companyId });
    if (!r) continue;

    const lines = (linesByEntry.get(doc._id) ?? []).flatMap((line) => {
      const accountId = ctx.ref(line.accountId);
      const debit = money(line.debit);
      const credit = money(line.credit);
      const d = toMinor(debit);
      const c = toMinor(credit);
      if (!accountId || ctx.companyOf.get(accountId) !== r.companyId || d < 0n || c < 0n || (d === 0n) === (c === 0n)) {
        ctx.skip("journalLines", !accountId ? "bog'liq yozuv topilmadi: accountId" : "noto'g'ri qator (debet va kredit)");
        return [];
      }
      return [{ line, accountId, debit, credit, d, c }];
    });
    const totalDebit = lines.reduce((s, l) => s + l.d, 0n);
    const totalCredit = lines.reduce((s, l) => s + l.c, 0n);
    let status = oneOf(doc.status, ["draft", "posted", "voided"] as const, "posted");
    const diff = totalDebit > totalCredit ? totalDebit - totalCredit : totalCredit - totalDebit;
    if (status === "posted" && (lines.length < 2 || diff > 100n)) {
      status = "draft";
      ctx.warn("journalEntries", "balanslanmagan yoki qatorsiz — qoralama sifatida");
    }
    // Sarlavha CHECK'i (je_balanced) har qanday holatda ±1 so'm talab qiladi: haqiqiy summalar izohga yoziladi
    let notes = text(doc.notes);
    let headerDebit = totalDebit;
    let headerCredit = totalCredit;
    if (diff > 100n) {
      headerDebit = headerCredit = totalDebit > totalCredit ? totalDebit : totalCredit;
      const original = `Convex'dan balanslanmagan holda kelgan: debet ${fromMinor(totalDebit)}, kredit ${fromMinor(totalCredit)}`;
      notes = notes ? `${notes}\n${original}` : original;
    }
    let referenceType = text(doc.referenceType, 50);
    let referenceId = ledgerReference(ctx, doc.referenceId);
    const referenceKey = `${r.companyId}|${referenceType}|${referenceId}`;
    if (referenceType && referenceId && status !== "voided") {
      if (references.has(referenceKey)) {
        referenceType = null;
        referenceId = null;
        ctx.warn("journalEntries", "bitta hujjatga ikkinchi yozuv — hujjat bog'lanishi olindi");
      } else {
        references.add(referenceKey);
      }
    }

    const values = {
      companyId: r.companyId,
      number: codeFor(ctx, "journalEntries", entryNumbers, r.companyId, doc, doc.number, 32, "JE"),
      entryDate: isoDate(doc.date) ?? creationIsoDate(doc),
      description: text(doc.description) ?? "—",
      referenceType,
      referenceId,
      status,
      totalDebit: fromMinor(headerDebit),
      totalCredit: fromMinor(headerCredit),
      createdBy: ctx.ref(doc.createdBy),
      notes,
      createdAt: creationDate(doc),
    };
    try {
      const entryId = await ctx.tx.transaction(async (sp) => {
        const [entry] = await sp
          .insert(journalEntries)
          .values({ ...values, legacyId: doc._id })
          .onConflictDoUpdate({ target: journalEntries.legacyId, set: values })
          .returning({ id: journalEntries.id });
        await sp.delete(journalLines).where(eq(journalLines.entryId, entry!.id));
        if (lines.length > 0) {
          await sp.insert(journalLines).values(
            lines.map((l) => ({
              companyId: r.companyId,
              entryId: entry!.id,
              accountId: l.accountId,
              debit: l.debit,
              credit: l.credit,
              description: text(l.line.description),
              legacyId: l.line._id,
              createdAt: creationDate(l.line),
            })),
          );
        }
        return entry!.id;
      });
      ctx.ids.set(doc._id, entryId);
      ctx.table("journalEntries").imported += 1;
      ctx.table("journalLines").imported += lines.length;
    } catch (error) {
      const { code, constraint } = pgError(error);
      if (!code || !DATA_ERRORS.has(code)) throw error;
      ctx.skip("journalEntries", `baza cheklovi: ${constraint ?? code}`);
    }
  }

  const expenseNumbers = await UniqueValues.load(ctx, "expenses", "company_id::text", "number");
  for (const doc of await ctx.load("expenses")) {
    const r = ctx.refs("expenses", doc, { companyId: doc.companyId });
    if (!r) continue;
    if (doc.attachmentUrl) ctx.warn("expenses", "tashqi chek URL ko'chirilmadi");
    await save(ctx, "expenses", expenses, doc, {
      companyId: r.companyId,
      number: codeFor(ctx, "expenses", expenseNumbers, r.companyId, doc, doc.number, 32, "EXP"),
      category: text(doc.category, 64) ?? "boshqa",
      description: text(doc.description) ?? "—",
      amount: money(doc.amount),
      currency: text(doc.currency, 3)?.toUpperCase() ?? "UZS",
      expenseDate: isoDate(doc.date) ?? creationIsoDate(doc),
      accountId: ctx.ref(doc.accountId),
      paidBy: text(doc.paidBy, 200),
      status: oneOf(doc.status, ["pending", "approved", "paid"] as const, "pending"),
      notes: text(doc.notes),
      createdBy: ctx.ref(doc.createdBy),
      createdAt: creationDate(doc),
    });
  }
}

async function importCashTransactions(ctx: Context) {
  for (const doc of await ctx.load("cashTransactions")) {
    const r = ctx.refs("cashTransactions", doc, { cashAccountId: doc.cashAccountId });
    if (!r) continue;
    await save(ctx, "cashTransactions", cashTransactions, doc, {
      companyId: ctx.companyOf.get(r.cashAccountId)!,
      cashAccountId: r.cashAccountId,
      type: oneOf(doc.type, ["in", "out", "transfer"] as const, "in"),
      amount: money(doc.amount),
      currency: text(doc.currency, 3)?.toUpperCase() ?? "UZS",
      txDate: isoDate(doc.date) ?? creationIsoDate(doc),
      description: text(doc.description) ?? "—",
      category: text(doc.category, 64),
      referenceType: text(doc.referenceType, 50),
      referenceId: ledgerReference(ctx, doc.referenceId),
      balanceAfter: money(doc.balanceAfter),
      createdBy: ctx.ref(doc.createdBy),
      createdAt: creationDate(doc),
    });
  }
}

// ─── Xarid va savdo ──────────────────────────────────────────────────────────

const PAYMENT_METHODS = ["cash", "bank", "card", "transfer"] as const;

async function importPurchase(ctx: Context, batchSuppliers: Map<string, string>) {
  const supplierCodes = await UniqueValues.load(ctx, "suppliers", "company_id::text", "code");
  for (const doc of await ctx.load("suppliers")) {
    const r = ctx.refs("suppliers", doc, { companyId: doc.companyId });
    if (!r) continue;
    await save(ctx, "suppliers", suppliers, doc, {
      companyId: r.companyId,
      name: text(doc.name, 200) ?? "Ta'minotchi",
      code: codeFor(ctx, "suppliers", supplierCodes, r.companyId, doc, doc.code, 32, "SUP"),
      contactPerson: text(doc.contactPerson, 200),
      phone: text(doc.phone, 20),
      email: email(doc.email),
      address: text(doc.address),
      taxId: text(doc.taxId, 32),
      bankAccount: text(doc.bankAccount, 64),
      paymentTermDays: Math.max(0, int(doc.paymentTermDays, 0)),
      currency: text(doc.currency, 3)?.toUpperCase() ?? "UZS",
      totalDebt: money(doc.totalDebt),
      totalPurchased: money(doc.totalPurchased),
      isActive: bool(doc.isActive, true),
      notes: text(doc.notes),
      createdAt: creationDate(doc),
    });
  }
  for (const [batchId, supplierLegacy] of batchSuppliers) {
    const supplierId = ctx.ref(supplierLegacy);
    if (supplierId) await ctx.tx.update(batches).set({ supplierId }).where(eq(batches.id, batchId));
  }

  const numbers = await UniqueValues.load(ctx, "purchase_orders", "company_id::text", "number");
  for (const doc of await ctx.load("purchaseOrders")) {
    const r = ctx.refs("purchaseOrders", doc, { companyId: doc.companyId, supplierId: doc.supplierId, warehouseId: doc.warehouseId });
    if (!r) continue;
    const id = await save(ctx, "purchaseOrders", purchaseOrders, doc, {
      companyId: r.companyId,
      number: codeFor(ctx, "purchaseOrders", numbers, r.companyId, doc, doc.number, 32, "PO"),
      supplierId: r.supplierId,
      warehouseId: r.warehouseId,
      status: oneOf(doc.status, ["draft", "confirmed", "partial", "received", "invoiced", "paid", "cancelled"] as const, "draft"),
      orderDate: isoDate(doc.orderDate) ?? creationIsoDate(doc),
      expectedDate: isoDate(doc.expectedDate),
      currency: text(doc.currency, 3)?.toUpperCase() ?? "UZS",
      exchangeRate: qty(doc.exchangeRate, "1"),
      subtotal: nonNegative(money(doc.subtotal)),
      taxAmount: nonNegative(money(doc.taxAmount)),
      discountAmount: nonNegative(money(doc.discountAmount)),
      totalAmount: nonNegative(money(doc.totalAmount)),
      paidAmount: nonNegative(money(doc.paidAmount)),
      notes: text(doc.notes),
      createdBy: ctx.ref(doc.createdBy),
      createdAt: creationDate(doc),
    });
    if (id) ctx.companyOf.set(id, r.companyId);
  }

  for (const doc of await ctx.load("purchaseOrderItems")) {
    const r = ctx.refs("purchaseOrderItems", doc, { orderId: doc.orderId, productId: doc.productId, unitId: doc.unitId });
    if (!r) continue;
    const ordered = qty(doc.orderedQty);
    let received = nonNegative(qty(doc.receivedQty));
    if (toMinor(received, 4) > toMinor(ordered, 4)) {
      received = ordered;
      ctx.warn("purchaseOrderItems", "qabul qilingan miqdor buyurtmadan ortiq — buyurtma miqdoriga tenglandi");
    }
    const id = await save(ctx, "purchaseOrderItems", purchaseOrderItems, doc, {
      companyId: ctx.companyOf.get(r.orderId)!,
      orderId: r.orderId,
      productId: r.productId,
      unitId: r.unitId,
      orderedQty: ordered,
      receivedQty: received,
      unitPrice: nonNegative(qty(doc.unitPrice)),
      taxRate: percent(doc.taxRate),
      discountPercent: percent(doc.discountPercent),
      lineTotal: nonNegative(money(doc.lineTotal)),
      notes: text(doc.notes),
      createdAt: creationDate(doc),
    });
    if (id) ctx.companyOf.set(id, ctx.companyOf.get(r.orderId)!);
  }

  for (const doc of await ctx.load("purchaseReceipts")) {
    const r = ctx.refs("purchaseReceipts", doc, { orderId: doc.orderId, supplierId: doc.supplierId, warehouseId: doc.warehouseId });
    if (!r) continue;
    const id = await save(ctx, "purchaseReceipts", purchaseReceipts, doc, {
      companyId: ctx.companyOf.get(r.orderId)!,
      orderId: r.orderId,
      supplierId: r.supplierId,
      warehouseId: r.warehouseId,
      receiptDate: isoDate(doc.receiptDate) ?? creationIsoDate(doc),
      notes: text(doc.notes),
      createdBy: ctx.ref(doc.createdBy),
      createdAt: creationDate(doc),
    });
    if (id) ctx.companyOf.set(id, ctx.companyOf.get(r.orderId)!);
  }

  for (const doc of await ctx.load("purchaseReceiptItems")) {
    const r = ctx.refs("purchaseReceiptItems", doc, {
      receiptId: doc.receiptId,
      orderItemId: doc.orderItemId,
      productId: doc.productId,
      unitId: doc.unitId,
    });
    if (!r) continue;
    const receivedQty = qty(doc.receivedQty);
    const unitPrice = nonNegative(qty(doc.unitPrice));
    await save(ctx, "purchaseReceiptItems", purchaseReceiptItems, doc, {
      companyId: ctx.companyOf.get(r.receiptId)!,
      receiptId: r.receiptId,
      orderItemId: r.orderItemId,
      productId: r.productId,
      unitId: r.unitId,
      receivedQty,
      unitPrice,
      lineTotal: fromMinor(rescale(toMinor(receivedQty, 4) * toMinor(unitPrice, 4), 8, 2)),
      batchNumber: text(doc.batchNumber, 64),
      expiryDate: isoDate(doc.expiryDate),
      createdAt: creationDate(doc),
    });
  }

  const paymentReferences = new Set<string>();
  for (const doc of await ctx.load("supplierPayments")) {
    const r = ctx.refs("supplierPayments", doc, { supplierId: doc.supplierId });
    if (!r) continue;
    const companyId = ctx.ref(doc.companyId);
    if (!companyId) {
      ctx.skip("supplierPayments", "kompaniya topilmadi (kompaniyasiz yozuv)");
      continue;
    }
    let reference = text(doc.reference, 100);
    if (reference) {
      const key = `${companyId}|${r.supplierId}|${reference}`;
      if (paymentReferences.has(key)) {
        reference = null;
        ctx.warn("supplierPayments", "takrorlangan to'lov reference — olib tashlandi");
      } else paymentReferences.add(key);
    }
    await save(ctx, "supplierPayments", supplierPayments, doc, {
      companyId,
      supplierId: r.supplierId,
      orderId: ctx.ref(doc.orderId),
      amount: money(doc.amount),
      currency: text(doc.currency, 3)?.toUpperCase() ?? "UZS",
      exchangeRate: qty(doc.exchangeRate, "1"),
      paymentDate: isoDate(doc.paymentDate) ?? creationIsoDate(doc),
      method: oneOf(doc.method, PAYMENT_METHODS, "cash"),
      reference,
      notes: text(doc.notes),
      cashAccountId: ctx.ref(doc.cashAccountId),
      journalEntryId: ctx.ref(doc.journalEntryId),
      createdBy: ctx.ref(doc.createdBy),
      createdAt: creationDate(doc),
    });
  }
}

async function importSales(ctx: Context) {
  const customerCodes = await UniqueValues.load(ctx, "customers", "company_id::text", "code");
  for (const doc of await ctx.load("customers")) {
    const r = ctx.refs("customers", doc, { companyId: doc.companyId });
    if (!r) continue;
    await save(ctx, "customers", customers, doc, {
      companyId: r.companyId,
      name: text(doc.name, 200) ?? "Mijoz",
      code: codeFor(ctx, "customers", customerCodes, r.companyId, doc, doc.code, 32, "C"),
      phone: text(doc.phone, 20),
      email: email(doc.email),
      address: text(doc.address),
      taxId: text(doc.taxId, 32),
      discountPercent: percent(doc.discountPercent),
      creditLimit: nonNegative(money(doc.creditLimit)),
      paymentTermDays: Math.max(0, int(doc.paymentTermDays, 0)),
      currency: text(doc.currency, 3)?.toUpperCase() ?? "UZS",
      totalDebt: money(doc.totalDebt),
      totalPurchased: money(doc.totalPurchased),
      isActive: bool(doc.isActive, true),
      notes: text(doc.notes),
      createdAt: creationDate(doc),
    });
  }

  const openShifts = await SingleFlags.load(ctx, "pos_shifts", "warehouse_id", "status = 'open'");
  for (const doc of await ctx.load("posShifts")) {
    const r = ctx.refs("posShifts", doc, { warehouseId: doc.warehouseId });
    if (!r) continue;
    let status = oneOf(doc.status, ["open", "closed"] as const, "closed");
    if (status === "open" && !openShifts.claim(r.warehouseId, doc._id)) {
      status = "closed";
      ctx.warn("posShifts", "omborda ikkinchi ochiq smena — yopilgan deb belgilandi");
    }
    await save(ctx, "posShifts", posShifts, doc, {
      companyId: ctx.companyOf.get(r.warehouseId)!,
      warehouseId: r.warehouseId,
      cashierId: null,
      cashierName: text(doc.cashierName, 200),
      status,
      openedAt: timestamp(doc.openedAt) ?? creationDate(doc),
      closedAt: timestamp(doc.closedAt),
      openingCash: money(doc.openingCash),
      closingCash: moneyOrNull(doc.closingCash),
      totalSales: money(doc.totalSales),
      totalCash: money(doc.totalCash),
      totalCard: money(doc.totalCard),
      receiptCount: Math.max(0, int(doc.receiptCount, 0)),
      notes: text(doc.notes),
      createdAt: creationDate(doc),
    });
  }

  const orderNumbers = await UniqueValues.load(ctx, "sales_orders", "company_id::text", "number");
  for (const doc of await ctx.load("salesOrders")) {
    const r = ctx.refs("salesOrders", doc, { companyId: doc.companyId, warehouseId: doc.warehouseId });
    if (!r) continue;
    const id = await save(ctx, "salesOrders", salesOrders, doc, {
      companyId: r.companyId,
      number: codeFor(ctx, "salesOrders", orderNumbers, r.companyId, doc, doc.number, 32, "SO"),
      customerId: ctx.ref(doc.customerId),
      warehouseId: r.warehouseId,
      status: oneOf(doc.status, ["draft", "confirmed", "shipped", "delivered", "returned", "cancelled"] as const, "draft"),
      orderDate: isoDate(doc.orderDate) ?? creationIsoDate(doc),
      deliveryDate: isoDate(doc.deliveryDate),
      currency: text(doc.currency, 3)?.toUpperCase() ?? "UZS",
      exchangeRate: qty(doc.exchangeRate, "1"),
      subtotal: nonNegative(money(doc.subtotal)),
      taxAmount: nonNegative(money(doc.taxAmount)),
      discountAmount: nonNegative(money(doc.discountAmount)),
      totalAmount: nonNegative(money(doc.totalAmount)),
      paidAmount: nonNegative(money(doc.paidAmount)),
      isPos: bool(doc.isPOS, false),
      posShiftId: ctx.ref(doc.posShiftId),
      notes: text(doc.notes),
      createdBy: ctx.ref(doc.createdBy),
      createdAt: creationDate(doc),
    });
    if (id) ctx.companyOf.set(id, r.companyId);
  }

  for (const doc of await ctx.load("salesOrderItems")) {
    const r = ctx.refs("salesOrderItems", doc, { orderId: doc.orderId, productId: doc.productId, unitId: doc.unitId });
    if (!r) continue;
    await save(ctx, "salesOrderItems", salesOrderItems, doc, {
      companyId: ctx.companyOf.get(r.orderId)!,
      orderId: r.orderId,
      productId: r.productId,
      unitId: r.unitId,
      quantity: qty(doc.qty),
      unitPrice: nonNegative(qty(doc.unitPrice)),
      taxRate: percent(doc.taxRate),
      discountPercent: percent(doc.discountPercent),
      lineTotal: nonNegative(money(doc.lineTotal)),
      costPrice: nonNegative(qty(doc.costPrice)),
      notes: text(doc.notes),
      createdAt: creationDate(doc),
    });
  }

  const references = new Set<string>();
  for (const doc of await ctx.load("customerPayments")) {
    const r = ctx.refs("customerPayments", doc, { companyId: doc.companyId });
    if (!r) continue;
    let reference = text(doc.reference, 100);
    if (reference) {
      if (references.has(`${r.companyId}|${reference}`)) {
        reference = null;
        ctx.warn("customerPayments", "takrorlangan to'lov reference — olib tashlandi");
      } else references.add(`${r.companyId}|${reference}`);
    }
    await save(ctx, "customerPayments", customerPayments, doc, {
      companyId: r.companyId,
      customerId: ctx.ref(doc.customerId),
      orderId: ctx.ref(doc.orderId),
      amount: money(doc.amount),
      currency: text(doc.currency, 3)?.toUpperCase() ?? "UZS",
      exchangeRate: qty(doc.exchangeRate, "1"),
      paymentDate: isoDate(doc.paymentDate) ?? creationIsoDate(doc),
      method: oneOf(doc.method, PAYMENT_METHODS, "cash"),
      reference,
      notes: text(doc.notes),
      cashAccountId: ctx.ref(doc.cashAccountId),
      journalEntryId: ctx.ref(doc.journalEntryId),
      createdBy: ctx.ref(doc.createdBy),
      createdAt: creationDate(doc),
    });
  }
}

async function importStockHistory(ctx: Context) {
  for (const doc of await ctx.load("stockMovements")) {
    const r = ctx.refs("stockMovements", doc, { productId: doc.productId, warehouseId: doc.warehouseId, unitId: doc.unitId });
    if (!r) continue;
    await save(ctx, "stockMovements", stockMovements, doc, {
      companyId: ctx.companyOf.get(r.warehouseId)!,
      type: oneOf(
        doc.type,
        ["receive", "issue", "transfer_out", "transfer_in", "adjust", "writeoff", "return_in", "return_out", "count"] as const,
        "adjust",
      ),
      productId: r.productId,
      warehouseId: r.warehouseId,
      zoneId: ctx.ref(doc.zoneId),
      batchId: ctx.ref(doc.batchId),
      quantity: qty(doc.quantity),
      unitId: r.unitId,
      costPrice: nonNegative(qty(doc.costPrice)),
      referenceType: text(doc.referenceType, 50),
      referenceId: ledgerReference(ctx, doc.referenceId),
      notes: text(doc.notes),
      performedBy: ctx.ref(doc.performedBy),
      occurredAt: timestamp(doc.date) ?? creationDate(doc),
      createdAt: creationDate(doc),
    });
  }

  for (const doc of await ctx.load("inventoryCounts")) {
    const r = ctx.refs("inventoryCounts", doc, { warehouseId: doc.warehouseId });
    if (!r) continue;
    const id = await save(ctx, "inventoryCounts", inventoryCounts, doc, {
      companyId: ctx.companyOf.get(r.warehouseId)!,
      warehouseId: r.warehouseId,
      name: text(doc.name, 200) ?? "Inventarizatsiya",
      status: oneOf(doc.status, ["draft", "in_progress", "completed", "cancelled"] as const, "draft"),
      countedBy: ctx.ref(doc.countedBy),
      startedAt: timestamp(doc.startedAt),
      completedAt: timestamp(doc.completedAt),
      adjustmentsMade: bool(doc.adjustmentsMade, false),
      notes: text(doc.notes),
      createdAt: creationDate(doc),
    });
    if (id) ctx.companyOf.set(id, ctx.companyOf.get(r.warehouseId)!);
  }

  for (const doc of await ctx.load("inventoryCountItems")) {
    const r = ctx.refs("inventoryCountItems", doc, { countId: doc.countId, productId: doc.productId });
    if (!r) continue;
    await save(ctx, "inventoryCountItems", inventoryCountItems, doc, {
      companyId: ctx.companyOf.get(r.countId)!,
      countId: r.countId,
      productId: r.productId,
      expectedQty: qty(doc.expectedQty),
      countedQty: qtyOrNull(doc.countedQty),
      difference: qtyOrNull(doc.difference),
      notes: text(doc.notes),
      createdAt: creationDate(doc),
    });
  }
}

// ─── HR va ishlab chiqarish ──────────────────────────────────────────────────

async function importHr(ctx: Context) {
  const departmentCodes = await UniqueValues.load(ctx, "departments", "company_id::text", "code");
  const departmentDocs = await ctx.load("departments");
  for (const doc of departmentDocs) {
    const r = ctx.refs("departments", doc, { companyId: doc.companyId });
    if (!r) continue;
    const id = await save(ctx, "departments", departments, doc, {
      companyId: r.companyId,
      name: text(doc.name, 200) ?? "Bo'lim",
      code: codeFor(ctx, "departments", departmentCodes, r.companyId, doc, doc.code, 32, "DEP"),
      isActive: bool(doc.isActive, true),
      createdAt: creationDate(doc),
    });
    if (id) ctx.companyOf.set(id, r.companyId);
  }

  for (const doc of await ctx.load("positions")) {
    const r = ctx.refs("positions", doc, { departmentId: doc.departmentId });
    if (!r) continue;
    let minSalary = moneyOrNull(doc.minSalary);
    let maxSalary = moneyOrNull(doc.maxSalary);
    if (minSalary && maxSalary && toMinor(minSalary) > toMinor(maxSalary)) {
      [minSalary, maxSalary] = [maxSalary, minSalary];
      ctx.warn("positions", "maosh oralig'i teskari — almashtirildi");
    }
    await save(ctx, "positions", positions, doc, {
      companyId: ctx.companyOf.get(r.departmentId)!,
      departmentId: r.departmentId,
      name: text(doc.name, 200) ?? "Lavozim",
      level: text(doc.level, 64),
      minSalary,
      maxSalary,
      isActive: bool(doc.isActive, true),
      createdAt: creationDate(doc),
    });
  }

  const employeeCodes = await UniqueValues.load(ctx, "employees", "company_id::text", "code");
  const employeeDocs = await ctx.load("employees");
  for (const doc of employeeDocs) {
    const r = ctx.refs("employees", doc, { companyId: doc.companyId });
    if (!r) continue;
    const hireDate = isoDate(doc.hireDate);
    if (!hireDate) ctx.warn("employees", "ishga qabul sanasi yo'q — yaratilgan sana qo'yildi");
    if (doc.photoUrl) ctx.warn("employees", "tashqi surat URL ko'chirilmadi");
    const id = await save(ctx, "employees", employees, doc, {
      companyId: r.companyId,
      name: text(doc.name, 200) ?? "Xodim",
      code: codeFor(ctx, "employees", employeeCodes, r.companyId, doc, doc.code, 32, "EMP"),
      phone: text(doc.phone, 20),
      email: email(doc.email),
      departmentId: ctx.ref(doc.departmentId),
      positionId: ctx.ref(doc.positionId),
      hireDate: hireDate ?? creationIsoDate(doc),
      birthDate: isoDate(doc.birthDate),
      gender: doc.gender === "male" || doc.gender === "female" ? doc.gender : null,
      address: text(doc.address),
      passportNumber: text(doc.passportNumber, 32),
      inn: text(doc.inn, 32),
      bankAccount: text(doc.bankAccount, 64),
      baseSalary: nonNegative(money(doc.baseSalary)),
      salaryType: oneOf(doc.salaryType, ["monthly", "hourly", "daily"] as const, "monthly"),
      status: oneOf(doc.status, ["active", "on_leave", "terminated"] as const, "active"),
      notes: text(doc.notes),
      createdAt: creationDate(doc),
    });
    if (id) ctx.companyOf.set(id, r.companyId);
  }

  for (const doc of employeeDocs) {
    const id = ctx.ref(doc._id);
    const managerId = ctx.ref(doc.managerId);
    if (id && managerId && managerId !== id) await ctx.tx.update(employees).set({ managerId }).where(eq(employees.id, id));
  }
  for (const doc of departmentDocs) {
    const id = ctx.ref(doc._id);
    if (!id) continue;
    const parentId = ctx.ref(doc.parentId);
    const managerId = ctx.ref(doc.managerId);
    await ctx.tx
      .update(departments)
      .set({ parentId: parentId && parentId !== id ? parentId : null, managerId })
      .where(eq(departments.id, id));
  }

  const attendanceKeys = new Set<string>();
  for (const doc of await ctx.load("attendances")) {
    const r = ctx.refs("attendances", doc, { employeeId: doc.employeeId });
    if (!r) continue;
    const date = isoDate(doc.date);
    if (!date || attendanceKeys.has(`${r.employeeId}|${date}`)) {
      ctx.skip("attendances", date ? "takrorlangan xodim+sana davomati" : "sana yo'q");
      continue;
    }
    attendanceKeys.add(`${r.employeeId}|${date}`);
    await save(ctx, "attendances", attendances, doc, {
      companyId: ctx.companyOf.get(r.employeeId)!,
      employeeId: r.employeeId,
      attendanceDate: date,
      checkIn: timeOfDay(doc.checkIn),
      checkOut: timeOfDay(doc.checkOut),
      workHours: nonNegative(qty(doc.workHours)),
      overtime: nonNegative(qty(doc.overtime)),
      status: oneOf(doc.status, ["present", "absent", "late", "half_day", "holiday", "on_leave"] as const, "present"),
      notes: text(doc.notes),
      createdAt: creationDate(doc),
    });
  }

  for (const doc of await ctx.load("leaves")) {
    const r = ctx.refs("leaves", doc, { employeeId: doc.employeeId });
    if (!r) continue;
    let startDate = isoDate(doc.startDate) ?? creationIsoDate(doc);
    let endDate = isoDate(doc.endDate) ?? startDate;
    if (endDate < startDate) [startDate, endDate] = [endDate, startDate];
    let days = qty(doc.days);
    if (toMinor(days, 4) <= 0n) {
      days = String(Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1);
      ctx.warn("leaves", "kunlar soni noto'g'ri — sanalardan hisoblandi");
    }
    await save(ctx, "leaves", leaves, doc, {
      companyId: ctx.companyOf.get(r.employeeId)!,
      employeeId: r.employeeId,
      type: oneOf(doc.type, ["annual", "sick", "unpaid", "maternity", "other"] as const, "other"),
      startDate,
      endDate,
      days,
      status: oneOf(doc.status, ["pending", "approved", "rejected"] as const, "pending"),
      reason: text(doc.reason),
      approvedBy: ctx.ref(doc.approvedBy),
      notes: text(doc.notes),
      createdAt: creationDate(doc),
    });
  }

  const salaryKeys = new Set<string>();
  for (const doc of await ctx.load("salaryPayments")) {
    const r = ctx.refs("salaryPayments", doc, { employeeId: doc.employeeId });
    if (!r) continue;
    const month = typeof doc.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(doc.month) ? doc.month : null;
    if (!month || salaryKeys.has(`${r.employeeId}|${month}`)) {
      ctx.skip("salaryPayments", month ? "takrorlangan xodim+oy maoshi" : "oy noto'g'ri");
      continue;
    }
    salaryKeys.add(`${r.employeeId}|${month}`);
    const net = toMinor(money(doc.netSalary));
    const tax = toMinor(nonNegative(money(doc.tax)));
    const deductions = toMinor(nonNegative(money(doc.deductions)));
    if (net < 0n) {
      ctx.skip("salaryPayments", "manfiy qo'lga summa");
      continue;
    }
    // Convex hisoblangan summani saqlamagan: qo'lga = hisoblangan − soliq − ushlab qolish
    const gross = net + tax + deductions;
    await save(ctx, "salaryPayments", salaryPayments, doc, {
      companyId: ctx.companyOf.get(r.employeeId)!,
      employeeId: r.employeeId,
      month,
      baseSalary: nonNegative(money(doc.baseSalary)),
      workDays: nonNegative(qty(doc.workDays)),
      actualDays: nonNegative(qty(doc.actualDays)),
      overtime: nonNegative(qty(doc.overtime)),
      overtimePay: nonNegative(money(doc.overtimePay)),
      bonus: nonNegative(money(doc.bonus)),
      deductions: fromMinor(deductions),
      grossSalary: fromMinor(gross),
      taxRate: gross > 0n ? fromMinor(mulDivRound(tax, 10000n, gross)) : "12",
      tax: fromMinor(tax),
      netSalary: fromMinor(net),
      status: oneOf(doc.status, ["draft", "approved", "paid"] as const, "draft"),
      paidDate: isoDate(doc.paidDate),
      notes: text(doc.notes),
      createdBy: ctx.ref(doc.createdBy),
      createdAt: creationDate(doc),
    });
  }
}

async function importManufacturing(ctx: Context) {
  const workCenterCodes = await UniqueValues.load(ctx, "work_centers", "company_id::text", "code");
  for (const doc of await ctx.load("workCenters")) {
    const r = ctx.refs("workCenters", doc, { companyId: doc.companyId });
    if (!r) continue;
    await save(ctx, "workCenters", workCenters, doc, {
      companyId: r.companyId,
      name: text(doc.name, 200) ?? "Ish markazi",
      code: codeFor(ctx, "workCenters", workCenterCodes, r.companyId, doc, doc.code, 32, "WC"),
      type: oneOf(doc.type, ["machine", "labor", "subcontract"] as const, "machine"),
      costPerHour: nonNegative(money(doc.costPerHour)),
      isActive: bool(doc.isActive, true),
      createdAt: creationDate(doc),
    });
  }

  const versions = await UniqueValues.load(ctx, "boms", "company_id::text || ':' || product_id::text", "version");
  for (const doc of await ctx.load("boms")) {
    const r = ctx.refs("boms", doc, { companyId: doc.companyId, productId: doc.productId, unitId: doc.unitId });
    if (!r) continue;
    const id = await save(ctx, "boms", boms, doc, {
      companyId: r.companyId,
      productId: r.productId,
      name: text(doc.name, 200) ?? "Retsept",
      version: codeFor(ctx, "boms", versions, `${r.companyId}:${r.productId}`, doc, doc.version, 32, "1"),
      quantity: qty(doc.quantity, "1"),
      unitId: r.unitId,
      isActive: bool(doc.isActive, true),
      notes: text(doc.notes),
      createdAt: creationDate(doc),
    });
    if (id) ctx.companyOf.set(id, r.companyId);
  }

  for (const doc of await ctx.load("bomItems")) {
    const r = ctx.refs("bomItems", doc, { bomId: doc.bomId, productId: doc.productId, unitId: doc.unitId });
    if (!r) continue;
    await save(ctx, "bomItems", bomItems, doc, {
      companyId: ctx.companyOf.get(r.bomId)!,
      bomId: r.bomId,
      productId: r.productId,
      quantity: qty(doc.quantity),
      unitId: r.unitId,
      scrapPercent: percent(doc.scrapPercent),
      notes: text(doc.notes),
      createdAt: creationDate(doc),
    });
  }

  const numbers = await UniqueValues.load(ctx, "production_orders", "company_id::text", "number");
  for (const doc of await ctx.load("productionOrders")) {
    const r = ctx.refs("productionOrders", doc, {
      companyId: doc.companyId,
      bomId: doc.bomId,
      productId: doc.productId,
      warehouseId: doc.warehouseId,
    });
    if (!r) continue;
    const id = await save(ctx, "productionOrders", productionOrders, doc, {
      companyId: r.companyId,
      number: codeFor(ctx, "productionOrders", numbers, r.companyId, doc, doc.number, 32, "MO"),
      bomId: r.bomId,
      productId: r.productId,
      warehouseId: r.warehouseId,
      plannedQty: qty(doc.plannedQty),
      producedQty: nonNegative(qty(doc.producedQty)),
      status: oneOf(doc.status, ["draft", "confirmed", "in_progress", "completed", "cancelled"] as const, "draft"),
      plannedDate: isoDate(doc.plannedDate) ?? creationIsoDate(doc),
      startedAt: timestamp(doc.startedAt),
      completedAt: timestamp(doc.completedAt),
      totalMaterialCost: money(doc.totalMaterialCost),
      totalLaborCost: money(doc.totalLaborCost),
      totalCost: money(doc.totalCost),
      unitCost: qty(doc.unitCost),
      notes: text(doc.notes),
      createdBy: ctx.ref(doc.createdBy),
      createdAt: creationDate(doc),
    });
    if (id) ctx.companyOf.set(id, r.companyId);
  }

  for (const doc of await ctx.load("productionMaterials")) {
    const r = ctx.refs("productionMaterials", doc, { orderId: doc.orderId, productId: doc.productId, unitId: doc.unitId });
    if (!r) continue;
    await save(ctx, "productionMaterials", productionMaterials, doc, {
      companyId: ctx.companyOf.get(r.orderId)!,
      orderId: r.orderId,
      productId: r.productId,
      plannedQty: nonNegative(qty(doc.plannedQty)),
      actualQty: nonNegative(qty(doc.actualQty)),
      unitId: r.unitId,
      unitCost: qty(doc.unitCost),
      totalCost: money(doc.totalCost),
      createdAt: creationDate(doc),
    });
  }

  for (const doc of await ctx.load("productionTimeLines")) {
    const r = ctx.refs("productionTimeLines", doc, { orderId: doc.orderId, workCenterId: doc.workCenterId });
    if (!r) continue;
    await save(ctx, "productionTimeLines", productionTimeLines, doc, {
      companyId: ctx.companyOf.get(r.orderId)!,
      orderId: r.orderId,
      workCenterId: r.workCenterId,
      plannedHours: nonNegative(qty(doc.plannedHours)),
      actualHours: nonNegative(qty(doc.actualHours)),
      costPerHour: nonNegative(money(doc.costPerHour)),
      totalCost: nonNegative(money(doc.totalCost)),
      createdAt: creationDate(doc),
    });
  }
}

// ─── CRM ─────────────────────────────────────────────────────────────────────

async function importCrm(ctx: Context) {
  const { salesReps, leads, activities, customerSegments, customerSegmentMembers, distributionRoutes, routeCustomers, routeVisits } = crmTables;

  const repCodes = await UniqueValues.load(ctx, "sales_reps", "company_id::text", "code");
  for (const doc of await ctx.load("salesReps")) {
    const r = ctx.refs("salesReps", doc, { companyId: doc.companyId });
    if (!r) continue;
    await save(ctx, "salesReps", salesReps, doc, {
      companyId: r.companyId,
      name: text(doc.name, 200) ?? "Agent",
      code: codeFor(ctx, "salesReps", repCodes, r.companyId, doc, doc.code, 32, "SR"),
      phone: text(doc.phone, 20),
      email: email(doc.email),
      userId: ctx.ref(doc.userId),
      region: text(doc.region, 100),
      monthlyTarget: nonNegative(money(doc.monthlyTarget)),
      commission: percent(doc.commission),
      isActive: bool(doc.isActive, true),
      notes: text(doc.notes),
      createdAt: creationDate(doc),
    });
  }

  for (const doc of await ctx.load("leads")) {
    const r = ctx.refs("leads", doc, { companyId: doc.companyId });
    if (!r) continue;
    await save(ctx, "leads", leads, doc, {
      companyId: r.companyId,
      name: text(doc.name, 200) ?? "Lid",
      companyName: text(doc.company, 200),
      phone: text(doc.phone, 20),
      email: email(doc.email),
      source: oneOf(doc.source, ["website", "referral", "social", "cold_call", "exhibition", "other"] as const, "other"),
      stage: oneOf(doc.stage, ["new", "contacted", "qualified", "proposal", "won", "lost"] as const, "new"),
      estimatedValue: moneyOrNull(doc.estimatedValue),
      customerId: ctx.ref(doc.customerId),
      salesRepId: ctx.ref(doc.salesRepId),
      expectedCloseDate: isoDate(doc.expectedCloseDate),
      notes: text(doc.notes),
      lostReason: text(doc.lostReason),
      createdAt: creationDate(doc),
    });
  }

  for (const doc of await ctx.load("activities")) {
    const r = ctx.refs("activities", doc, { companyId: doc.companyId });
    if (!r) continue;
    await save(ctx, "activities", activities, doc, {
      companyId: r.companyId,
      type: oneOf(doc.type, ["call", "meeting", "email", "note", "task"] as const, "note"),
      title: text(doc.title, 300) ?? "—",
      description: text(doc.description),
      customerId: ctx.ref(doc.customerId),
      leadId: ctx.ref(doc.leadId),
      activityDate: isoDate(doc.date) ?? creationIsoDate(doc),
      dueDate: isoDate(doc.dueDate),
      status: oneOf(doc.status, ["planned", "done", "cancelled"] as const, "done"),
      outcome: text(doc.outcome),
      createdBy: ctx.ref(doc.createdBy),
      createdAt: creationDate(doc),
    });
  }

  const segmentNames = await UniqueValues.load(ctx, "customer_segments", "company_id::text", "name");
  for (const doc of await ctx.load("customerSegments")) {
    const r = ctx.refs("customerSegments", doc, { companyId: doc.companyId });
    if (!r) continue;
    const id = await save(ctx, "customerSegments", customerSegments, doc, {
      companyId: r.companyId,
      name: codeFor(ctx, "customerSegments", segmentNames, r.companyId, doc, doc.name, 200, "Segment"),
      description: text(doc.description),
      color: text(doc.color, 16) ?? "#64748b",
      isActive: bool(doc.isActive, true),
      createdAt: creationDate(doc),
    });
    if (id) ctx.companyOf.set(id, r.companyId);
  }

  const memberKeys = new Set<string>();
  for (const doc of await ctx.load("customerSegmentMembers")) {
    const r = ctx.refs("customerSegmentMembers", doc, { segmentId: doc.segmentId, customerId: doc.customerId });
    if (!r) continue;
    if (memberKeys.has(`${r.segmentId}|${r.customerId}`)) {
      ctx.skip("customerSegmentMembers", "takrorlangan a'zolik");
      continue;
    }
    memberKeys.add(`${r.segmentId}|${r.customerId}`);
    await save(ctx, "customerSegmentMembers", customerSegmentMembers, doc, {
      companyId: ctx.companyOf.get(r.segmentId)!,
      segmentId: r.segmentId,
      customerId: r.customerId,
      createdAt: creationDate(doc),
    });
  }

  for (const doc of await ctx.load("distributionRoutes")) {
    const r = ctx.refs("distributionRoutes", doc, { companyId: doc.companyId });
    if (!r) continue;
    // Convex UI'da 0 = dushanba … 6 = yakshanba edi; API'da 0 = yakshanba … 6 = shanba
    const days = Array.isArray(doc.days)
      ? [
          ...new Set(
            (doc.days as unknown[])
              .filter((d): d is number => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6)
              .map((d) => (d + 1) % 7),
          ),
        ].sort((a, b) => a - b)
      : [];
    const id = await save(ctx, "distributionRoutes", distributionRoutes, doc, {
      companyId: r.companyId,
      name: text(doc.name, 200) ?? "Marshrut",
      salesRepId: ctx.ref(doc.salesRepId),
      description: text(doc.description),
      days,
      color: text(doc.color, 16),
      isActive: bool(doc.isActive, true),
      createdAt: creationDate(doc),
    });
    if (id) ctx.companyOf.set(id, r.companyId);
  }

  const routeKeys = new Set<string>();
  for (const doc of await ctx.load("routeCustomers")) {
    const r = ctx.refs("routeCustomers", doc, { routeId: doc.routeId, customerId: doc.customerId });
    if (!r) continue;
    if (routeKeys.has(`${r.routeId}|${r.customerId}`)) {
      ctx.skip("routeCustomers", "takrorlangan marshrut mijozi");
      continue;
    }
    routeKeys.add(`${r.routeId}|${r.customerId}`);
    await save(ctx, "routeCustomers", routeCustomers, doc, {
      companyId: ctx.companyOf.get(r.routeId)!,
      routeId: r.routeId,
      customerId: r.customerId,
      sortOrder: int(doc.sortOrder, 0),
      visitNotes: text(doc.visitNotes),
      createdAt: creationDate(doc),
    });
  }

  for (const doc of await ctx.load("routeVisits")) {
    const r = ctx.refs("routeVisits", doc, { routeId: doc.routeId });
    if (!r) continue;
    await save(ctx, "routeVisits", routeVisits, doc, {
      companyId: ctx.companyOf.get(r.routeId)!,
      routeId: r.routeId,
      salesRepId: ctx.ref(doc.salesRepId),
      visitDate: isoDate(doc.date) ?? creationIsoDate(doc),
      status: oneOf(doc.status, ["planned", "in_progress", "completed", "cancelled"] as const, "planned"),
      customersVisited: Math.max(0, int(doc.customersVisited, 0)),
      ordersCreated: Math.max(0, int(doc.ordersCreated, 0)),
      totalAmount: nonNegative(money(doc.totalAmount)),
      notes: text(doc.notes),
      createdAt: creationDate(doc),
    });
  }
}

// ─── Bildirishnoma va audit ──────────────────────────────────────────────────

async function importLogs(ctx: Context) {
  for (const doc of await ctx.load("notifications")) {
    const r = ctx.refs("notifications", doc, { companyId: doc.companyId });
    if (!r) continue;
    if (doc.link && !internalLink(doc.link)) ctx.warn("notifications", "tashqi havola olib tashlandi");
    const createdAt = timestamp(doc.createdAt) ?? creationDate(doc);
    await save(ctx, "notifications", notifications, doc, {
      companyId: r.companyId,
      userId: ctx.ref(doc.userId),
      type: oneOf(
        doc.type,
        ["low_stock", "expiring_soon", "pending_approval", "overdue_payment", "leave_request", "po_received", "production_complete", "system"] as const,
        "system",
      ),
      severity: oneOf(doc.severity, ["info", "warning", "error", "success"] as const, "info"),
      title: text(doc.title, 300) ?? "—",
      message: text(doc.message) ?? "—",
      isRead: bool(doc.isRead, false),
      isGlobal: bool(doc.isGlobal, !doc.userId),
      relatedType: text(doc.relatedType, 50),
      relatedId: ctx.ref(doc.relatedId),
      link: internalLink(doc.link),
      createdAt,
    });
  }

  for (const doc of await ctx.load("auditLogs")) {
    const companyId = doc.companyId === undefined ? null : ctx.ref(doc.companyId);
    let details: unknown = null;
    if (typeof doc.details === "string" && doc.details) {
      try {
        details = JSON.parse(doc.details);
      } catch {
        details = { text: doc.details };
      }
    }
    await save(ctx, "auditLogs", auditLogs, doc, {
      companyId,
      userId: ctx.ref(doc.userId),
      userName: text(doc.userName, 200),
      action: text(doc.action, 100) ?? "unknown",
      resource: text(doc.resource, 100) ?? "unknown",
      resourceId: text(doc.resourceId, 64),
      details,
      ipAddress: text(doc.ipAddress, 64),
      userAgent: text(doc.userAgent),
      severity: oneOf(doc.severity, ["info", "warning", "error"] as const, "info"),
      occurredAt: timestamp(doc.timestamp) ?? creationDate(doc),
      createdAt: creationDate(doc),
    });
  }
}

// ─── Solishtirish ────────────────────────────────────────────────────────────

async function reconcile(ctx: Context) {
  const result = await ctx.tx.execute<Record<string, string | number>>(sql`
    select
      (select count(*)::int from companies where legacy_id is not null) as companies,
      (select count(*)::int from users where legacy_id is not null) as users,
      (select coalesce(sum(quantity * avg_cost_price), 0)::numeric(18,2)::text from stock_levels where legacy_id is not null) as stock_value,
      (select coalesce(sum(total_debt), 0)::numeric(18,2)::text from suppliers where legacy_id is not null) as supplier_debt,
      (select coalesce(sum(total_debt), 0)::numeric(18,2)::text from customers where legacy_id is not null) as customer_debt,
      (select coalesce(sum(balance), 0)::numeric(18,2)::text from cash_accounts where legacy_id is not null) as cash_balance,
      (select count(*)::int from journal_entries where legacy_id is not null and status = 'posted') as posted_entries,
      (select (coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0))::numeric(18,2)::text
         from journal_lines l join journal_entries e on e.id = l.entry_id
        where e.legacy_id is not null and e.status = 'posted') as journal_imbalance
  `);
  return result.rows[0] ?? {};
}

// ─── Kirish nuqtasi ──────────────────────────────────────────────────────────

export async function importConvexExport(dir: string, options: { dryRun?: boolean } = {}): Promise<ImportReport> {
  const startedAt = new Date().toISOString();
  let finished: ImportReport | null = null;

  try {
    await withTransaction(async (tx) => {
      const ctx = new Context(tx, dir);
      await preloadIds(ctx);

      await importPlatform(ctx);
      await importCatalog(ctx);
      const batchSuppliers = await importInventory(ctx);
      await importMembers(ctx);
      await importFinance(ctx);
      await importPurchase(ctx, batchSuppliers);
      await importSales(ctx);
      await importStockHistory(ctx);
      await importCashTransactions(ctx);
      await importHr(ctx);
      await importManufacturing(ctx);
      await importCrm(ctx);
      await importLogs(ctx);

      // Convex'da hisoblar rejasi bo'lmagan kompaniyalarga standart hisoblar va kassa (idempotent)
      const imported = await tx.select({ id: companies.id, currency: companies.currency }).from(companies).where(sql`${companies.legacyId} is not null`);
      for (const company of imported) await seedFinanceDefaults(tx, company.id, company.currency);

      // Kechiktirilgan tekshiruvlar (buxgalteriya balansi) shu yerda ishga tushadi — quruq ishga tushirishda ham
      await tx.execute(sql`set constraints all immediate`);

      finished = {
        dryRun: Boolean(options.dryRun),
        startedAt,
        finishedAt: new Date().toISOString(),
        tables: ctx.report,
        reconciliation: await reconcile(ctx),
      };
      if (options.dryRun) throw new DryRunRollback();
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }
  return finished!;
}
