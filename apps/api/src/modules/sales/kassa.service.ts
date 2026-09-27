/**
 * KASSA (POS pul qutisi) — 2026-09-27, ko'p kassa.
 *
 * Kassa = mavjud naqd hisob (`cash_accounts`, type `cash`) — yangi pul tizimi EMAS: balans, harakatlar (`cash_transactions`),
 * 1010 jurnal xaritasi va hisobotlar avvalgidek. Kassa omborga (`warehouse_id`) va mas'ul xodimga (`employee_id`) bog'lanadi;
 * bitta omborda bir nechta kassa bir vaqtda ishlaydi (har kassada BITTA ochiq smena — bazada unikal indeks + bu yerda).
 *
 * XAVFSIZLIK (HIGH, 2026-09-27): kassadagi NAQD pul qaysi hisobga tushishini server `smena → kassa` zanjiridan aniqlaydi.
 * Mijoz yuborgan `cashAccountId` ishonchli emas: boshqa kassani ko'rsatsa — rad (offline sinxronda — smena kassasiga
 * yo'naltiriladi va nomuvofiqlik yoziladi). Kassasiz (tarixiy) smena — asosiy kassa, avvalgi xulq.
 */
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { AppError, badRequest, notFound } from "@bum/shared";
import { employees } from "../../db/schema/hr.js";
import { cashAccounts } from "../../db/schema/finance.js";
import { posShifts } from "../../db/schema/sales.js";
import type { DbOrTx } from "../../db/transaction.js";
import { effectivePermissions, type TenantContext } from "../company/tenant.js";
import { companyCurrency } from "../finance/accounts.service.js";
import { warehouses } from "../../db/schema/inventory.js";
import { allowedWarehouses } from "../inventory/warehouses.service.js";

const kassaFields = {
  id: cashAccounts.id,
  name: cashAccounts.name,
  code: cashAccounts.code,
  type: cashAccounts.type,
  currency: cashAccounts.currency,
  warehouseId: cashAccounts.warehouseId,
  employeeId: cashAccounts.employeeId,
  isActive: cashAccounts.isActive,
  isDefault: cashAccounts.isDefault,
  balance: cashAccounts.balance,
  deliveryAgentId: cashAccounts.deliveryAgentId,
  salesRepId: cashAccounts.salesRepId,
};

/** Omborga bog'langan kassalar bormi — bo'lsa web smena kassasiz ochilmaydi (kassa tanlash majburiy). */
export async function warehouseKassas(conn: DbOrTx, companyId: string, warehouseId: string) {
  return conn
    .select(kassaFields)
    .from(cashAccounts)
    .where(and(eq(cashAccounts.companyId, companyId), eq(cashAccounts.warehouseId, warehouseId), eq(cashAccounts.type, "cash"), eq(cashAccounts.isActive, true)))
    .orderBy(asc(cashAccounts.code), asc(cashAccounts.name));
}

/** Foydalanuvchining xodim yozuvlari (kassa mas'ulligi uchun). */
async function userEmployeeIds(conn: DbOrTx, tenant: TenantContext) {
  const rows = await conn
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.companyId, tenant.company.id), eq(employees.userId, tenant.user.id)));
  return rows.map((row) => row.id);
}

/**
 * Smena uchun kassa: shu kompaniya, naqd, asosiy valyuta, faol, agent hisobi emas, ombori mos (yoki omborsiz);
 * mas'uliyat — kassaga mas'ul xodim biriktirilgan bo'lsa, faqat o'sha xodim yoki rahbar (`sales.approve`).
 */
export async function assertKassaForShift(conn: DbOrTx, tenant: TenantContext, cashAccountId: string, warehouseId: string) {
  const [kassa] = await conn
    .select(kassaFields)
    .from(cashAccounts)
    .where(and(eq(cashAccounts.id, cashAccountId), eq(cashAccounts.companyId, tenant.company.id)))
    .limit(1);
  if (!kassa) throw notFound("Kassa topilmadi");
  if (kassa.type !== "cash") throw badRequest("Kassa sifatida faqat naqd hisob tanlanadi");
  if (!kassa.isActive) throw badRequest("Kassa faol emas");
  if (kassa.deliveryAgentId || kassa.salesRepId) throw badRequest("Agentning yo'ldagi naqd hisobi kassa bo'la olmaydi");
  if (kassa.currency !== (await companyCurrency(conn, tenant.company.id))) throw badRequest("Kassa asosiy valyutada bo'lishi kerak");
  // POS kassa — faqat shu omborga biriktirilgan, asosiy bo'lmagan kassa (asosiy kassa — inkassatsiya manzili; omborsiz
  // hisob — moliya registri, POS kassa emas)
  if (kassa.isDefault) throw badRequest("Asosiy kassa POS smena kassasi bo'la olmaydi");
  if (kassa.warehouseId !== warehouseId) throw badRequest(kassa.warehouseId ? "Kassa boshqa omborga tegishli" : "Kassa bu omborga biriktirilmagan");
  if (kassa.employeeId) {
    const mine = await userEmployeeIds(conn, tenant);
    if (!mine.includes(kassa.employeeId) && !(await effectivePermissions(conn, tenant)).includes("sales.approve")) {
      throw new AppError("FORBIDDEN", "Bu kassa boshqa kassirga biriktirilgan", { reason: "kassa_not_assigned" });
    }
  }
  return kassa;
}

/** Foydalanuvchi shu omborda smena ocha oladigan kassalar (POS "Smena ochish" oynasi uchun). */
export async function kassasForUser(conn: DbOrTx, tenant: TenantContext, warehouseId: string) {
  // Ombor shu kompaniyaniki bo'lmasa — 404 (begona ombor ID'si bo'sh ro'yxat emas, "topilmadi")
  const [warehouse] = await conn
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.id, warehouseId), eq(warehouses.companyId, tenant.company.id)))
    .limit(1);
  if (!warehouse) throw notFound("Ombor topilmadi");
  const list = await warehouseKassas(conn, tenant.company.id, warehouseId);
  const canAny = (await effectivePermissions(conn, tenant)).includes("sales.approve");
  const mine = canAny ? [] : await userEmployeeIds(conn, tenant);
  const openShifts = list.length
    ? await conn
        .select({ cashAccountId: posShifts.cashAccountId, cashierName: posShifts.cashierName, id: posShifts.id })
        .from(posShifts)
        .where(and(eq(posShifts.companyId, tenant.company.id), eq(posShifts.status, "open")))
    : [];
  return list
    .filter((kassa) => canAny || !kassa.employeeId || mine.includes(kassa.employeeId))
    .map((kassa) => {
      const open = openShifts.find((shift) => shift.cashAccountId === kassa.id);
      return { id: kassa.id, name: kassa.name, code: kassa.code, balance: kassa.balance, openShift: open ? { id: open.id, cashierName: open.cashierName } : null };
    });
}

/** Smena kassasi: `null` — kassasiz (tarixiy) smena, pul asosiy kassaga (avvalgi xulq). */
export async function shiftCashAccount(conn: DbOrTx, companyId: string, shiftId: string) {
  const [row] = await conn
    .select({ cashAccountId: posShifts.cashAccountId })
    .from(posShifts)
    .where(and(eq(posShifts.id, shiftId), eq(posShifts.companyId, companyId)))
    .limit(1);
  if (!row) throw notFound("Smena topilmadi");
  return row.cashAccountId;
}

export async function defaultCashAccountId(conn: DbOrTx, companyId: string) {
  const [row] = await conn
    .select({ id: cashAccounts.id })
    .from(cashAccounts)
    .where(and(eq(cashAccounts.companyId, companyId), eq(cashAccounts.isDefault, true)))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Smenadagi NAQD (asosiy valyuta) harakati qaysi hisobga yozilishi — server aniqlaydi. Mijoz boshqa hisob ko'rsatsa — rad.
 * Qaytaradi: smena kassasi yoki `null` (tarixiy smena — asosiy kassa, `recordCashTransaction` o'zi tanlaydi).
 */
export async function enforceShiftCash(conn: DbOrTx, companyId: string, shiftId: string, requested: string | null | undefined) {
  const kassa = await shiftCashAccount(conn, companyId, shiftId);
  if (requested) {
    const expected = kassa ?? (await defaultCashAccountId(conn, companyId));
    if (requested !== expected) {
      throw new AppError("FORBIDDEN", "Naqd pul faqat shu smenaning kassasiga tushadi", { reason: "cash_account_not_shift_kassa" });
    }
  }
  return kassa;
}

/** Qurilma kassasi mosligi: kassa qurilma omboriga tegishli (yoki omborsiz), naqd va faol. */
export async function assertKassaForDevice(conn: DbOrTx, companyId: string, cashAccountId: string, warehouseId: string) {
  const [kassa] = await conn
    .select(kassaFields)
    .from(cashAccounts)
    .where(and(eq(cashAccounts.id, cashAccountId), eq(cashAccounts.companyId, companyId)))
    .limit(1);
  if (!kassa) throw notFound("Kassa topilmadi");
  if (kassa.type !== "cash" || !kassa.isActive || kassa.deliveryAgentId || kassa.salesRepId) throw badRequest("Qurilmaga faqat faol naqd kassa biriktiriladi");
  if (kassa.isDefault) throw badRequest("Asosiy kassa qurilma kassasi bo'la olmaydi");
  if (kassa.warehouseId !== warehouseId) throw badRequest(kassa.warehouseId ? "Kassa boshqa omborga tegishli" : "Kassa qurilma omboriga biriktirilmagan");
  return kassa;
}

/** Kassada ochiq smena bormi (kassani o'zgartirish/o'chirishdan oldin). */
export async function kassaHasOpenShift(conn: DbOrTx, companyId: string, cashAccountId: string) {
  const [row] = await conn
    .select({ id: posShifts.id })
    .from(posShifts)
    .where(and(eq(posShifts.companyId, companyId), eq(posShifts.status, "open"), eq(posShifts.cashAccountId, cashAccountId)))
    .limit(1);
  return Boolean(row);
}


/**
 * Kassalar paneli (rahbar): har POS kassa — ombor, balans (kassadagi pul), ochiq smena (kassir, cheklar, tushum usul
 * bo'yicha). Ruxsat berilmagan omborlar kassalari ko'rinmaydi.
 */
export async function kassaBoard(conn: DbOrTx, tenant: TenantContext) {
  const allowed = allowedWarehouses(tenant);
  const list = await conn
    .select({ ...kassaFields, warehouseName: warehouses.name })
    .from(cashAccounts)
    .innerJoin(warehouses, eq(warehouses.id, cashAccounts.warehouseId))
    .where(
      and(
        eq(cashAccounts.companyId, tenant.company.id),
        isNotNull(cashAccounts.warehouseId),
        eq(cashAccounts.type, "cash"),
        ...(allowed ? [inArray(cashAccounts.warehouseId, allowed.length ? allowed : ["00000000-0000-0000-0000-000000000000"])] : []),
      ),
    )
    .orderBy(asc(warehouses.name), asc(cashAccounts.code), asc(cashAccounts.name));
  const ids = list.map((kassa) => kassa.id);
  const open = ids.length
    ? await conn
        .select({
          id: posShifts.id,
          cashAccountId: posShifts.cashAccountId,
          cashierName: posShifts.cashierName,
          deviceId: posShifts.deviceId,
          openedAt: posShifts.openedAt,
          receiptCount: posShifts.receiptCount,
          totalSales: posShifts.totalSales,
          totalCash: posShifts.totalCash,
          totalCard: posShifts.totalCard,
          totalBank: posShifts.totalBank,
          totalReturns: posShifts.totalReturns,
          openingBalance: posShifts.openingBalance,
        })
        .from(posShifts)
        .where(and(eq(posShifts.companyId, tenant.company.id), eq(posShifts.status, "open"), inArray(posShifts.cashAccountId, ids)))
    : [];
  return list.map((kassa) => ({
    id: kassa.id,
    name: kassa.name,
    code: kassa.code,
    warehouseId: kassa.warehouseId,
    warehouseName: kassa.warehouseName,
    isActive: kassa.isActive,
    balance: kassa.balance,
    openShift: open.find((shift) => shift.cashAccountId === kassa.id) ?? null,
  }));
}
