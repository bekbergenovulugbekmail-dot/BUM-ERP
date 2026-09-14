/**
 * Serverdan qurilmaga o'zgarishlar (pull): har obyekt turi uchun `(updated_at, id)` kursori bo'yicha sahifalab.
 *
 *  - Kursor vaqti mikrosekund aniqlikda matn (JS Date millisekundgacha — teng vaqtli qatorlar o'tkazib yuborilmasin).
 *  - Qurilma har sinxron siklida kursorlarni biroz orqaga suradi (kechikib commit bo'lgan tranzaksiyalar uchun);
 *    qatorlar qurilmada `id` bo'yicha upsert qilinadi, takror kelishi zararsiz.
 *  - Faqat qurilma kompaniyasi; qoldiq — faqat qurilma ombori. Kassirlar: a'zolik yoki foydalanuvchi o'zgarsa qayta
 *    keladi (faolsizlantirilgani `active: false` bilan), ruxsatlari bilan; rol ruxsatlari o'zgarsa (rol tahriri, migratsiya,
 *    yangi ruxsat) — config xeshi o'zgaradi va hamma kassirlar qayta keladi; parol/PIN xeshlari hech qachon yuborilmaydi.
 *  - Kompaniya sozlamalari (rekvizitlar, keshbek, chek va etiketka shablonlari) — xeshi qurilmadagidan farq qilsagina (`config`).
 */
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { POS_APPEARANCE_KEY, POS_QUICK_SALE_KEY, parsePosAppearance, parsePosQuickSale } from "@bum/shared";
import { brands, categories, products, unitConversions, units } from "../../db/schema/catalog.js";
import { companyCurrencies } from "../../db/schema/finance.js";
import { stockLevels, warehouses } from "../../db/schema/inventory.js";
import { syncDeletions } from "../../db/schema/pos.js";
import { companies, companyMembers, roles, settings, users } from "../../db/schema/platform.js";
import { suppliers } from "../../db/schema/purchase.js";
import { customers } from "../../db/schema/sales.js";
import type { DbOrTx } from "../../db/transaction.js";
import { LABELS_SETTING_KEY, RECEIPT_SETTING_KEY, parseLabelSettings, parseReceiptTemplate } from "../company/print-settings.service.js";
import { permissionsFromRoles } from "../company/tenant.js";
import { paymentTerminalOptions } from "../finance/terminals.service.js";
import { getCashbackSettings } from "../sales/cashback.service.js";
import type { DeviceContext } from "./device-auth.js";

export const PULL_ENTITIES = [
  "units",
  "unitConversions",
  "categories",
  "brands",
  "products",
  "customers",
  "warehouses",
  "stockLevels",
  "currencies",
  "cashiers",
  "suppliers",
  /** Serverda butunlay o'chirilgan yozuvlar: `{ entity, entityId }` — qurilma lokal nusxani olib tashlaydi. */
  "deletions",
] as const;
export type PullEntity = (typeof PULL_ENTITIES)[number];
export type PullCursor = { t: string; id: string };
export const DEFAULT_PULL_LIMIT = 500;

const cursorText = (at: AnyPgColumn | SQL) => sql<string>`to_char((${at}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const afterCursor = (at: AnyPgColumn | SQL, id: AnyPgColumn, cursor: PullCursor | undefined) =>
  cursor ? sql`((${at}), ${id}) > (${cursor.t}::timestamptz, ${cursor.id}::uuid)` : undefined;

type Page<T> = { rows: T[]; cursor: PullCursor | null; more: boolean };

function toPage<T extends { cursorAt: string; id: string }>(rows: T[], limit: number, previous: PullCursor | undefined): Page<Omit<T, "cursorAt">> {
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    rows: pageRows.map(({ cursorAt: _cursorAt, ...row }) => row),
    cursor: last ? { t: last.cursorAt, id: last.id } : (previous ?? null),
    more: rows.length > limit,
  };
}

/**
 * Kassa uchun kompaniya sozlamalari va ularning xeshi (o'zgarmagan bo'lsa qurilmaga qayta yuborilmaydi).
 * `accessDigest` — kassirlar ruxsatlari xeshi: xeshga qo'shiladi (o'zi yuborilmaydi), ruxsat o'zgarsa config ham yangilanadi.
 */
export async function posConfig(conn: DbOrTx, companyId: string, accessDigest = "") {
  const [company] = await conn
    .select({ name: companies.name, address: companies.address, phone: companies.phone, taxId: companies.taxId, currency: companies.currency })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  const printRows = await conn
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(and(eq(settings.companyId, companyId), inArray(settings.key, [RECEIPT_SETTING_KEY, LABELS_SETTING_KEY, POS_APPEARANCE_KEY, POS_QUICK_SALE_KEY])));
  const printValue = (key: string) => printRows.find((row) => row.key === key)?.value;
  const body = {
    company: company!,
    cashback: await getCashbackSettings(conn, companyId),
    receipt: parseReceiptTemplate(printValue(RECEIPT_SETTING_KEY)),
    labels: parseLabelSettings(printValue(LABELS_SETTING_KEY)),
    /** Kassa mavzusi qulfi (web: Sozlamalar → Kassa qurilmalari). */
    appearance: parsePosAppearance(printValue(POS_APPEARANCE_KEY)),
    /** Tezkor sotuv assortimenti (web: Sozlamalar → Kassa qurilmalari), tartibi bilan. */
    quickSale: parsePosQuickSale(printValue(POS_QUICK_SALE_KEY)),
    /**
     * Faol karta terminallari (UZCARD, HUMO ...; bank hisobi ma'lumotisiz): kassada karta to'lovi terminal bo'yicha,
     * pul serverda terminal bog'langan bank hisobiga. Terminal qo'shilsa yoki o'chirilsa xesh o'zgaradi — qurilma yangisini oladi.
     */
    terminals: await paymentTerminalOptions(conn, companyId),
  };
  return { hash: createHash("sha256").update(JSON.stringify(body)).update(accessDigest).digest("hex").slice(0, 32), ...body };
}

/** Kursor vaqti mikrosekundlarda (qurilma orqaga surgan kursor boshqa kasr uzunligida bo'lishi mumkin). */
function cursorMicros(value: string): bigint {
  const match = /^(.+:\d{2})(?:\.(\d{1,6}))?Z$/.exec(value);
  return match ? BigInt(Date.parse(`${match[1]}Z`)) * 1000n + BigInt((match[2] ?? "").padEnd(6, "0")) : 0n;
}

export async function pullChanges(
  conn: DbOrTx,
  context: DeviceContext,
  cursors: Partial<Record<PullEntity, PullCursor>>,
  limit = DEFAULT_PULL_LIMIT,
  configHash?: string,
) {
  const companyId = context.company.id;
  const take = limit + 1;

  const unitRows = await conn
    .select({ id: units.id, name: units.name, shortName: units.shortName, isBase: units.isBase, isActive: units.isActive, cursorAt: cursorText(units.updatedAt) })
    .from(units)
    .where(afterCursor(units.updatedAt, units.id, cursors.units))
    .orderBy(asc(units.updatedAt), asc(units.id))
    .limit(take);

  const conversionRows = await conn
    .select({
      id: unitConversions.id,
      fromUnitId: unitConversions.fromUnitId,
      toUnitId: unitConversions.toUnitId,
      factor: unitConversions.factor,
      productId: unitConversions.productId,
      cursorAt: cursorText(unitConversions.updatedAt),
    })
    .from(unitConversions)
    .where(and(eq(unitConversions.companyId, companyId), afterCursor(unitConversions.updatedAt, unitConversions.id, cursors.unitConversions)))
    .orderBy(asc(unitConversions.updatedAt), asc(unitConversions.id))
    .limit(take);

  const categoryRows = await conn
    .select({
      id: categories.id,
      name: categories.name,
      parentId: categories.parentId,
      sortOrder: categories.sortOrder,
      isActive: categories.isActive,
      cursorAt: cursorText(categories.updatedAt),
    })
    .from(categories)
    .where(and(eq(categories.companyId, companyId), afterCursor(categories.updatedAt, categories.id, cursors.categories)))
    .orderBy(asc(categories.updatedAt), asc(categories.id))
    .limit(take);

  const brandRows = await conn
    .select({ id: brands.id, name: brands.name, isActive: brands.isActive, cursorAt: cursorText(brands.updatedAt) })
    .from(brands)
    .where(and(eq(brands.companyId, companyId), afterCursor(brands.updatedAt, brands.id, cursors.brands)))
    .orderBy(asc(brands.updatedAt), asc(brands.id))
    .limit(take);

  const productRows = await conn
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      barcode: products.barcode,
      qrCode: products.qrCode,
      categoryId: products.categoryId,
      brandId: products.brandId,
      baseUnitId: products.baseUnitId,
      salesUnitId: products.salesUnitId,
      purchaseUnitId: products.purchaseUnitId,
      purchasePrice: products.purchasePrice,
      salesPrice: products.salesPrice,
      wholesalePrice: products.wholesalePrice,
      retailPrice: products.retailPrice,
      promoPrice: products.promoPrice,
      promoPriceEnd: products.promoPriceEnd,
      /** Rasm versiyasi: o'zgarsa qurilma keshini yangilaydi; rasm `GET /products/:id/image` orqali. */
      imageKey: products.imageKey,
      purchaseCurrency: products.purchaseCurrency,
      salesCurrency: products.salesCurrency,
      taxRate: products.taxRate,
      taxIncluded: products.taxIncluded,
      minStock: products.minStock,
      trackBatch: products.trackBatch,
      trackExpiry: products.trackExpiry,
      isActive: products.isActive,
      isSaleable: products.isSaleable,
      isPurchaseable: products.isPurchaseable,
      /** Tarozi: tortiladigan mahsulot va PLU kodi (etiketka shtrix-kodi, taroziga yuborish). */
      isWeighted: products.isWeighted,
      pluCode: products.pluCode,
      cursorAt: cursorText(products.updatedAt),
    })
    .from(products)
    .where(and(eq(products.companyId, companyId), afterCursor(products.updatedAt, products.id, cursors.products)))
    .orderBy(asc(products.updatedAt), asc(products.id))
    .limit(take);

  const customerRows = await conn
    .select({
      id: customers.id,
      name: customers.name,
      code: customers.code,
      phone: customers.phone,
      address: customers.address,
      taxId: customers.taxId,
      partyType: customers.partyType,
      email: customers.email,
      contactName: customers.contactName,
      bankAccount: customers.bankAccount,
      bankMfo: customers.bankMfo,
      notes: customers.notes,
      discountPercent: customers.discountPercent,
      creditLimit: customers.creditLimit,
      totalDebt: customers.totalDebt,
      balance: customers.balance,
      cashbackBalance: customers.cashbackBalance,
      isActive: customers.isActive,
      cursorAt: cursorText(customers.updatedAt),
    })
    .from(customers)
    .where(and(eq(customers.companyId, companyId), afterCursor(customers.updatedAt, customers.id, cursors.customers)))
    .orderBy(asc(customers.updatedAt), asc(customers.id))
    .limit(take);

  const warehouseRows = await conn
    .select({
      id: warehouses.id,
      name: warehouses.name,
      code: warehouses.code,
      isDefault: warehouses.isDefault,
      isActive: warehouses.isActive,
      cursorAt: cursorText(warehouses.updatedAt),
    })
    .from(warehouses)
    .where(and(eq(warehouses.companyId, companyId), afterCursor(warehouses.updatedAt, warehouses.id, cursors.warehouses)))
    .orderBy(asc(warehouses.updatedAt), asc(warehouses.id))
    .limit(take);

  const stockRows = await conn
    .select({
      id: stockLevels.id,
      productId: stockLevels.productId,
      warehouseId: stockLevels.warehouseId,
      quantity: stockLevels.quantity,
      reservedQty: stockLevels.reservedQty,
      avgCostPrice: stockLevels.avgCostPrice,
      cursorAt: cursorText(stockLevels.updatedAt),
    })
    .from(stockLevels)
    .where(
      and(
        eq(stockLevels.companyId, companyId),
        eq(stockLevels.warehouseId, context.device.warehouseId),
        afterCursor(stockLevels.updatedAt, stockLevels.id, cursors.stockLevels),
      ),
    )
    .orderBy(asc(stockLevels.updatedAt), asc(stockLevels.id))
    .limit(take);

  const currencyRows = await conn
    .select({
      id: companyCurrencies.id,
      code: companyCurrencies.code,
      rate: companyCurrencies.rate,
      rateDate: companyCurrencies.rateDate,
      isActive: companyCurrencies.isActive,
      /** Kassada ko'rinadi: manba (qo'lda / Markaziy bank), oxirgi o'zgarish vaqti va kim o'zgartirgan. */
      source: companyCurrencies.source,
      updatedAt: companyCurrencies.updatedAt,
      updatedByName: users.name,
      cursorAt: cursorText(companyCurrencies.updatedAt),
    })
    .from(companyCurrencies)
    .leftJoin(users, eq(users.id, companyCurrencies.updatedBy))
    .where(and(eq(companyCurrencies.companyId, companyId), afterCursor(companyCurrencies.updatedAt, companyCurrencies.id, cursors.currencies)))
    .orderBy(asc(companyCurrencies.updatedAt), asc(companyCurrencies.id))
    .limit(take);

  // Kassirlar. A'zolik yoki foydalanuvchi o'zgarsa — kursor bo'yicha qayta keladi. Ruxsatlar esa a'zolik yozuvidan tashqarida
  // ham o'zgaradi (rol tahriri, migratsiya, katalogga yangi ruxsat): hamma a'zolar ruxsatlari xeshi config xeshiga qo'shiladi,
  // qurilmadagi xesh boshqa bo'lsa kassirlar kursorsiz to'liq qayta yuboriladi
  const cashierChangedAt = sql`greatest(${companyMembers.updatedAt}, ${users.updatedAt})`;
  const memberRows = await conn
    .select({
      id: companyMembers.id,
      userId: users.id,
      name: users.name,
      phone: users.phone,
      companyRole: companyMembers.companyRole,
      roleId: companyMembers.roleId,
      allowedWarehouseIds: companyMembers.allowedWarehouseIds,
      memberActive: companyMembers.isActive,
      userActive: users.isActive,
      cursorAt: cursorText(cashierChangedAt),
    })
    .from(companyMembers)
    .innerJoin(users, eq(users.id, companyMembers.userId))
    .where(eq(companyMembers.companyId, companyId))
    .orderBy(asc(cashierChangedAt), asc(companyMembers.id));
  const roleRows = await conn
    .select({ id: roles.id, name: roles.name, companyId: roles.companyId, permissions: roles.permissions, isActive: roles.isActive })
    .from(roles)
    .where(or(eq(roles.companyId, companyId), isNull(roles.companyId)));
  const allCashiers = memberRows.map(({ companyRole, roleId, memberActive, userActive, allowedWarehouseIds, ...member }) => {
    const permissions = permissionsFromRoles(companyId, { companyRole, roleId }, roleRows);
    const warehouseAllowed = allowedWarehouseIds.length === 0 || allowedWarehouseIds.includes(context.device.warehouseId);
    return {
      ...member,
      role: companyRole,
      permissions,
      /** Shu qurilmada ishlay oladi: faol a'zo va foydalanuvchi, `pos.use`, qurilma omboriga ruxsat. */
      active: memberActive && userActive && warehouseAllowed && permissions.includes("pos.use"),
    };
  });
  const accessDigest = createHash("sha256")
    .update(JSON.stringify([...allCashiers].sort((a, b) => (a.id < b.id ? -1 : 1)).map((row) => [row.id, row.role, row.permissions, row.active])))
    .digest("hex");
  const config = await posConfig(conn, companyId, accessDigest);
  const resendCashiers = configHash !== undefined && config.hash !== configHash;
  const cashierCursor = cursors.cashiers;
  const cashierRows = allCashiers
    .filter((row) => {
      if (resendCashiers || !cashierCursor) return true;
      const at = cursorMicros(row.cursorAt);
      const after = cursorMicros(cashierCursor.t);
      return at > after || (at === after && row.id > cashierCursor.id);
    })
    .slice(0, take);

  const supplierRows = await conn
    .select({
      id: suppliers.id,
      name: suppliers.name,
      code: suppliers.code,
      phone: suppliers.phone,
      partyType: suppliers.partyType,
      contactPerson: suppliers.contactPerson,
      email: suppliers.email,
      address: suppliers.address,
      taxId: suppliers.taxId,
      bankAccount: suppliers.bankAccount,
      bankMfo: suppliers.bankMfo,
      notes: suppliers.notes,
      currency: suppliers.currency,
      totalDebt: suppliers.totalDebt,
      isActive: suppliers.isActive,
      cursorAt: cursorText(suppliers.updatedAt),
    })
    .from(suppliers)
    .where(and(eq(suppliers.companyId, companyId), afterCursor(suppliers.updatedAt, suppliers.id, cursors.suppliers)))
    .orderBy(asc(suppliers.updatedAt), asc(suppliers.id))
    .limit(take);

  const deletionRows = await conn
    .select({ id: syncDeletions.id, entity: syncDeletions.entity, entityId: syncDeletions.entityId, cursorAt: cursorText(syncDeletions.deletedAt) })
    .from(syncDeletions)
    .where(and(eq(syncDeletions.companyId, companyId), afterCursor(syncDeletions.deletedAt, syncDeletions.id, cursors.deletions)))
    .orderBy(asc(syncDeletions.deletedAt), asc(syncDeletions.id))
    .limit(take);

  const entities = {
    units: toPage(unitRows, limit, cursors.units),
    unitConversions: toPage(conversionRows, limit, cursors.unitConversions),
    categories: toPage(categoryRows, limit, cursors.categories),
    brands: toPage(brandRows, limit, cursors.brands),
    products: toPage(productRows, limit, cursors.products),
    customers: toPage(customerRows, limit, cursors.customers),
    warehouses: toPage(warehouseRows, limit, cursors.warehouses),
    stockLevels: toPage(stockRows, limit, cursors.stockLevels),
    currencies: toPage(currencyRows, limit, cursors.currencies),
    cashiers: toPage(cashierRows, limit, cursors.cashiers),
    suppliers: toPage(supplierRows, limit, cursors.suppliers),
    deletions: toPage(deletionRows, limit, cursors.deletions),
  } satisfies Record<PullEntity, Page<unknown>>;

  return {
    serverTime: new Date().toISOString(),
    company: {
      id: companyId,
      name: context.company.name,
      currency: context.company.currency,
      /** Obuna holati — kassa sozlamalarida ko'rinadi. */
      status: context.company.status,
      trialEndsAt: context.company.trialEndsAt?.toISOString() ?? null,
    },
    device: context.device,
    entities,
    more: Object.values(entities).some((page) => page.more),
    config: config.hash === configHash ? null : config,
  };
}
