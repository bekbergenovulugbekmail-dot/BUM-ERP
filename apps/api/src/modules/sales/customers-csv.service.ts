/**
 * Mijozlarni CSV orqali eksport va import qilish.
 *
 * Eksportda qarz, balans va keshbek ham chiqadi — lekin import ularni O'ZGARTIRMAYDI: pul qiymatlari faqat hujjat
 * (to'lov, sotuv) yoki "Balansni to'g'rilash" (`/customers/:customerId/balance-adjust`) orqali o'zgaradi. Import
 * faqat yangi mijoz ochadi: har qator alohida tekshiriladi, xato qator `errors` ga tushadi va qolganlari yoziladi.
 *
 * `updateExisting: true` bo'lsa mavjud mijoz (telefon bo'yicha, telefonsiz qatorda — nom bo'yicha) o'tkazib
 * yuborilmaydi, balki faylda TO'LDIRILGAN ustunlar bo'yicha yangilanadi (bo'sh katak eski qiymatni o'chirmaydi).
 * Bu — noto'g'ri kodlashda import qilingan (matni `U+FFFD` belgilariga aylangan) yozuvlarni bir marta
 * qayta import bilan tuzatish yo'li.
 */
import { and, asc, eq } from "drizzle-orm";
import { distributionRoutes, routeCustomers, salesReps, territories } from "../../db/schema/crm.js";
import { customers } from "../../db/schema/sales.js";
import { addRouteCustomer } from "../distribution/distribution.service.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import {
  MAX_EXPORT_ROWS,
  cleanNumber,
  csvDocument,
  normalizePhone,
  optionalText,
  type ImportError,
  type ImportOutcome,
} from "../../shared/csv.js";
import type { TenantContext } from "../company/tenant.js";
import { createCustomer, updateCustomer, type CustomerInput } from "./customers.service.js";

const CSV_HEADER = [
  "Nomi",
  "Kod",
  "Turi",
  "Telefon",
  "Email",
  "Manzil",
  "Mas'ul shaxs",
  "STIR",
  "Hisob raqami",
  "MFO",
  "Shahar/tuman",
  "Mahalla",
  "Chegirma %",
  "Kredit limiti",
  "To'lov muddati (kun)",
  "Qarz",
  "Balans",
  "Keshbek",
  "Izoh",
  "Faol",
];

export async function exportCustomersCsv(conn: DbOrTx, tenant: TenantContext, options: { includeInactive?: boolean } = {}) {
  const rows = await conn
    .select({
      name: customers.name,
      code: customers.code,
      partyType: customers.partyType,
      phone: customers.phone,
      email: customers.email,
      address: customers.address,
      contactName: customers.contactName,
      taxId: customers.taxId,
      bankAccount: customers.bankAccount,
      bankMfo: customers.bankMfo,
      city: customers.city,
      district: customers.district,
      discountPercent: customers.discountPercent,
      creditLimit: customers.creditLimit,
      paymentTermDays: customers.paymentTermDays,
      totalDebt: customers.totalDebt,
      balance: customers.balance,
      cashbackBalance: customers.cashbackBalance,
      notes: customers.notes,
      isActive: customers.isActive,
    })
    .from(customers)
    .where(and(eq(customers.companyId, tenant.company.id), options.includeInactive ? undefined : eq(customers.isActive, true)))
    .orderBy(asc(customers.name), asc(customers.id))
    .limit(MAX_EXPORT_ROWS);

  return csvDocument(
    CSV_HEADER,
    rows.map((row) => [
      row.name,
      row.code,
      row.partyType === "legal" ? "Yuridik shaxs" : "Jismoniy shaxs",
      row.phone,
      row.email,
      row.address,
      row.contactName,
      row.taxId,
      row.bankAccount,
      row.bankMfo,
      row.city,
      row.district,
      row.discountPercent,
      row.creditLimit,
      row.paymentTermDays,
      row.totalDebt,
      row.balance,
      row.cashbackBalance,
      row.notes,
      row.isActive ? "ha" : "yo'q",
    ]),
  );
}

export type CustomerImportRow = {
  name?: string;
  partyType?: string;
  phone?: string;
  email?: string;
  address?: string;
  contactName?: string;
  taxId?: string;
  bankAccount?: string;
  bankMfo?: string;
  city?: string;
  district?: string;
  discountPercent?: string;
  creditLimit?: string;
  paymentTermDays?: string;
  notes?: string;
  /** Distributsiya: hudud nomi — marshrut orqali bog'lanadi (`customers` da hudud ustuni yo'q). */
  territory?: string;
  /** Distributsiya: savdo agenti nomi yoki kodi — marshrut orqali bog'lanadi. */
  salesRep?: string;
};

/** "Yuridik shaxs", "legal", "yuridik" → legal; qolgani — jismoniy. */
function partyTypeOf(value: string | undefined): "individual" | "legal" {
  const text = (value ?? "").trim().toLowerCase();
  return text.startsWith("yuridik") || text === "legal" ? "legal" : "individual";
}

/** Solishtirish uchun: bo'shliqlar bir xil, registr past. */
const foldName = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Hudud va/yoki savdo agenti bo'yicha mos FAOL marshrutni topadi.
 *
 * `customers` jadvalida hudud va agent ustuni YO'Q — bog'lanish `route_customers` → `distribution_routes`
 * orqali ketadi, marshrutda esa hudud ham, agent ham bor. Shuning uchun parallel jadval ochilmaydi:
 * mijoz mos marshrutga biriktiriladi (aynan `convertProspect` dagi naqsh).
 *
 * Aniq bitta marshrut topilmasa mijoz baribir yaratiladi — faqat ogohlantirish qaytadi.
 */
async function loadRouteIndex(tx: Tx, companyId: string) {
  const rows = await tx
    .select({
      routeId: distributionRoutes.id,
      routeName: distributionRoutes.name,
      territoryName: territories.name,
      repName: salesReps.name,
      repCode: salesReps.code,
    })
    .from(distributionRoutes)
    .leftJoin(territories, eq(distributionRoutes.territoryId, territories.id))
    .leftJoin(salesReps, eq(distributionRoutes.salesRepId, salesReps.id))
    .where(and(eq(distributionRoutes.companyId, companyId), eq(distributionRoutes.isActive, true)));

  return (territory: string, salesRep: string) => {
    const wantTerritory = foldName(territory);
    const wantRep = foldName(salesRep);
    return rows.filter(
      (route) =>
        (!wantTerritory || foldName(route.territoryName ?? "") === wantTerritory) &&
        (!wantRep || foldName(route.repName ?? "") === wantRep || foldName(route.repCode ?? "") === wantRep),
    );
  };
}

/**
 * Yangilash rejimi uchun patch: faqat faylda TO'LDIRILGAN ustunlar.
 * Bo'sh katak — "tegilmasin" degani (aks holda qisman to'ldirilgan fayl mavjud ma'lumotni o'chirib yuborardi).
 */
function providedFields(row: CustomerImportRow): Partial<CustomerInput> {
  const filled = (value: string | undefined) => (value ?? "").trim() !== "";
  const patch: Partial<CustomerInput> = {};
  if (filled(row.partyType)) patch.partyType = partyTypeOf(row.partyType);
  if (filled(row.phone)) patch.phone = optionalText(row.phone, 20);
  if (filled(row.email)) patch.email = optionalText(row.email, 255);
  if (filled(row.address)) patch.address = optionalText(row.address, 1000);
  if (filled(row.contactName)) patch.contactName = optionalText(row.contactName, 200);
  if (filled(row.taxId)) patch.taxId = optionalText(row.taxId, 32);
  if (filled(row.bankAccount)) patch.bankAccount = optionalText(row.bankAccount, 64);
  if (filled(row.bankMfo)) patch.bankMfo = optionalText(row.bankMfo, 16);
  if (filled(row.city)) patch.city = optionalText(row.city, 100);
  if (filled(row.district)) patch.district = optionalText(row.district, 100);
  if (filled(row.discountPercent)) patch.discountPercent = cleanNumber(row.discountPercent);
  if (filled(row.creditLimit)) patch.creditLimit = cleanNumber(row.creditLimit);
  if (filled(row.paymentTermDays)) patch.paymentTermDays = Number(cleanNumber(row.paymentTermDays));
  if (filled(row.notes)) patch.notes = optionalText(row.notes, 2000);
  return patch;
}

/** Mijozni marshrutga biriktiradi; allaqachon a'zo bo'lsa — tegmaydi (`rc_route_customer_key` unikal). */
async function attachRoute(tx: Tx, tenant: TenantContext, routeId: string, customerId: string, meta: RequestMeta) {
  const [member] = await tx
    .select({ id: routeCustomers.id })
    .from(routeCustomers)
    .where(and(eq(routeCustomers.routeId, routeId), eq(routeCustomers.customerId, customerId)))
    .limit(1);
  if (member) return;
  await addRouteCustomer(tx, tenant, routeId, { customerId }, meta);
}

export async function importCustomers(
  tx: Tx,
  tenant: TenantContext,
  rows: CustomerImportRow[],
  meta: RequestMeta,
  options: { dryRun?: boolean; requirePhone?: boolean; updateExisting?: boolean } = {},
): Promise<ImportOutcome> {
  const dryRun = options.dryRun === true;
  // "Tezda qo'shish" (bitta mijoz) telefonni talab qiladi; fayl importida telefon ixtiyoriy bo'lib qoladi
  const requirePhone = options.requirePhone === true;
  // Mavjud mijozni o'tkazib yubormasdan yangilash (aks holda CREATE ONLY)
  const updateExisting = options.updateExisting === true;
  // Dublikat kaliti — telefon raqami (kompaniya ichida): bazadagilar va fayl ichidagilar
  const existing = await tx
    .select({ id: customers.id, phone: customers.phone, name: customers.name })
    .from(customers)
    .where(eq(customers.companyId, tenant.company.id));
  // Bazadagi mijozlar: telefon → id va nom → id (yangilash rejimida qaysi yozuvga tegish kerakligi shundan)
  const idByPhone = new Map<string, string>();
  const idByName = new Map<string, string>();
  for (const row of existing) {
    const phone = normalizePhone(row.phone);
    // Telefonsiz qatorlar uchun zaxira kalit — nom (telefon bo'lsa, dublikat FAQAT telefon bo'yicha aniqlanadi:
    // bir xil nomli, lekin boshqa telefonli ikkita do'kon butunlay qonuniy)
    if (phone && !idByPhone.has(phone)) idByPhone.set(phone, row.id);
    const name = foldName(row.name);
    if (!idByName.has(name)) idByName.set(name, row.id);
  }
  // Fayl ICHIDAGI takrorlar: yangilash rejimida ham bitta mijoz ikki marta yozilmaydi
  const seenPhones = new Set<string>();
  const seenNames = new Set<string>();
  const matchRoutes = await loadRouteIndex(tx, tenant.company.id);
  const errors: ImportError[] = [];
  const duplicates: ImportError[] = [];
  const warnings: ImportError[] = [];
  let created = 0;
  let updated = 0;
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

    const discount = Number(cleanNumber(row.discountPercent));
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
      fail("Chegirma 0 va 100 orasida bo'lishi kerak");
      continue;
    }
    const creditLimit = Number(cleanNumber(row.creditLimit));
    if (!Number.isFinite(creditLimit) || creditLimit < 0) {
      fail("Kredit limiti noto'g'ri son");
      continue;
    }
    const termDays = Number(cleanNumber(row.paymentTermDays));
    if (!Number.isInteger(termDays) || termDays < 0 || termDays > 3650) {
      fail("To'lov muddati 0–3650 kun oralig'ida butun son bo'lishi kerak");
      continue;
    }

    // Mavjud mijoz telefon bo'yicha topiladi; telefon berilmagan qatorda — nom bo'yicha (aks holda har
    // importda bir xil do'kon qayta-qayta ochilaveradi)
    const phone = normalizePhone(row.phone);
    const nameKey = foldName(name);
    if (requirePhone && !phone) {
      fail(row.phone?.trim() ? "Telefon raqami noto'g'ri" : "Telefon majburiy");
      continue;
    }
    // Fayl ichida bir xil mijoz ikki marta — yangilash rejimida ham ikkinchisi o'tkazib yuboriladi
    if (phone ? seenPhones.has(phone) : seenNames.has(nameKey)) {
      duplicates.push({ row: line, key: name, message: "Bu qator fayl ichida takrorlangan" });
      continue;
    }
    const existingId = phone ? idByPhone.get(phone) : idByName.get(nameKey);
    // CREATE ONLY (standart): mavjud mijoz O'ZGARTIRILMAYDI
    if (existingId && !updateExisting) {
      duplicates.push({
        row: line,
        key: name,
        message: phone
          ? `Bu mijoz allaqachon mavjud (telefon: ${row.phone?.trim() ?? ""})`
          : "Bu mijoz allaqachon mavjud (shu nomli mijoz bor, telefon ko'rsatilmagan)",
      });
      continue;
    }

    // Hudud/agent — mos marshrut (mijoz yaratilgandan keyin biriktiriladi)
    const territory = row.territory?.trim() ?? "";
    const salesRep = row.salesRep?.trim() ?? "";
    let routeId: string | null = null;
    if (territory || salesRep) {
      const asked = [territory && `hudud "${territory}"`, salesRep && `agent "${salesRep}"`].filter(Boolean).join(", ");
      const hits = matchRoutes(territory, salesRep);
      if (hits.length === 1) routeId = hits[0]!.routeId;
      else if (hits.length === 0) warnings.push({ row: line, key: name, message: `Marshrut topilmadi (${asked}) — mijoz marshrutga biriktirilmadi` });
      else warnings.push({ row: line, key: name, message: `Bir nechta marshrut mos keldi (${asked}): ${hits.map((h) => h.routeName).join(", ")} — mijoz marshrutga biriktirilmadi` });
    }

    if (phone) seenPhones.add(phone);
    seenNames.add(nameKey);

    valid += 1;

    // Yangilash rejimi: faqat faylda TO'LDIRILGAN ustunlar yoziladi (bo'sh katak eski qiymatni o'chirmaydi)
    if (existingId) {
      updated += 1;
      if (dryRun) continue;
      await updateCustomer(tx, tenant, existingId, { name, ...providedFields(row) }, meta);
      if (routeId) await attachRoute(tx, tenant, routeId, existingId, meta);
      continue;
    }

    if (dryRun) continue;
    const customer = await createCustomer(
      tx,
      tenant,
      {
        name,
        partyType: partyTypeOf(row.partyType),
        phone: optionalText(row.phone, 20),
        email: optionalText(row.email, 255),
        address: optionalText(row.address, 1000),
        contactName: optionalText(row.contactName, 200),
        taxId: optionalText(row.taxId, 32),
        bankAccount: optionalText(row.bankAccount, 64),
        bankMfo: optionalText(row.bankMfo, 16),
        city: optionalText(row.city, 100),
        district: optionalText(row.district, 100),
        discountPercent: cleanNumber(row.discountPercent),
        creditLimit: cleanNumber(row.creditLimit),
        paymentTermDays: termDays,
        notes: optionalText(row.notes, 2000),
      },
      meta,
    );
    if (routeId) await addRouteCustomer(tx, tenant, routeId, { customerId: customer.id }, meta);
    created += 1;
  }

  return { created, updated, valid, errors, duplicates, warnings, dryRun };
}
