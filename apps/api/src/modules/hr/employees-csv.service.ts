/**
 * Hodimlarni CSV orqali eksport va import qilish.
 *
 * Import dasturdan foydalanish huquqini (`softwareAccess`) HECH QACHON yaratmaydi: fayldan login, parol yoki PIN
 * o'qilmaydi — import faqat kadrlar yozuvini ochadi. Dasturga kirish keyin "Dasturdan foydalanuvchi" amali orqali
 * beriladi. Maxfiy ustunlar (pasport, INN, hisob raqami, maosh) eksportga faqat `includeSalary` bilan qo'shiladi —
 * marshrut buni `hr.salary` ruxsatidan aniqlaydi.
 */
import { and, asc, eq } from "drizzle-orm";
import { departments, employees, positions } from "../../db/schema/hr.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import {
  MAX_EXPORT_ROWS,
  cleanNumber,
  csvDocument,
  normalizePhone,
  optionalText,
  parseIsoDate,
  type ImportError,
  type ImportOutcome,
} from "../../shared/csv.js";
import type { TenantContext } from "../company/tenant.js";
import { createEmployee } from "./employees.service.js";

const BASE_HEADER = ["Ism-familiya", "Kod", "Telefon", "Email", "Bo'lim", "Lavozim", "Ishga kirgan sana", "Tug'ilgan sana", "Jinsi", "Manzil", "Holati"];
const SALARY_HEADER = ["Pasport", "INN", "Hisob raqami", "Maosh", "Maosh turi"];

const GENDER_LABEL: Record<string, string> = { male: "Erkak", female: "Ayol" };
const SALARY_TYPE_LABEL: Record<string, string> = { monthly: "Oylik", hourly: "Soatlik", daily: "Kunlik" };
const STATUS_LABEL: Record<string, string> = { active: "Faol", on_leave: "Ta'tilda", terminated: "Ishdan bo'shagan" };

export async function exportEmployeesCsv(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { includeSalary: boolean; status?: "active" | "on_leave" | "terminated" },
) {
  const rows = await conn
    .select({
      name: employees.name,
      code: employees.code,
      phone: employees.phone,
      email: employees.email,
      departmentName: departments.name,
      positionName: positions.name,
      hireDate: employees.hireDate,
      birthDate: employees.birthDate,
      gender: employees.gender,
      address: employees.address,
      status: employees.status,
      passportNumber: employees.passportNumber,
      inn: employees.inn,
      bankAccount: employees.bankAccount,
      baseSalary: employees.baseSalary,
      salaryType: employees.salaryType,
    })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(positions, eq(positions.id, employees.positionId))
    .where(and(eq(employees.companyId, tenant.company.id), options.status ? eq(employees.status, options.status) : undefined))
    .orderBy(asc(employees.name), asc(employees.id))
    .limit(MAX_EXPORT_ROWS);

  const header = options.includeSalary ? [...BASE_HEADER, ...SALARY_HEADER] : BASE_HEADER;
  return csvDocument(
    header,
    rows.map((row) => {
      const base = [
        row.name,
        row.code,
        row.phone,
        row.email,
        row.departmentName,
        row.positionName,
        row.hireDate,
        row.birthDate,
        row.gender ? (GENDER_LABEL[row.gender] ?? row.gender) : "",
        row.address,
        STATUS_LABEL[row.status] ?? row.status,
      ];
      if (!options.includeSalary) return base;
      return [...base, row.passportNumber, row.inn, row.bankAccount, row.baseSalary, SALARY_TYPE_LABEL[row.salaryType] ?? row.salaryType];
    }),
  );
}

export type EmployeeImportRow = {
  name?: string;
  phone?: string;
  email?: string;
  department?: string;
  position?: string;
  hireDate?: string;
  birthDate?: string;
  gender?: string;
  address?: string;
  passportNumber?: string;
  inn?: string;
  bankAccount?: string;
  baseSalary?: string;
  salaryType?: string;
};

function genderOf(value: string | undefined): "male" | "female" | null {
  const text = (value ?? "").trim().toLowerCase();
  if (!text) return null;
  if (text.startsWith("erkak") || text === "male" || text === "m") return "male";
  if (text.startsWith("ayol") || text === "female" || text === "f") return "female";
  return null;
}

function salaryTypeOf(value: string | undefined): "monthly" | "hourly" | "daily" | null {
  const text = (value ?? "").trim().toLowerCase();
  if (!text) return "monthly";
  if (text.startsWith("oy") || text === "monthly") return "monthly";
  if (text.startsWith("soat") || text === "hourly") return "hourly";
  if (text.startsWith("kun") || text === "daily") return "daily";
  return null;
}

export async function importEmployees(
  tx: Tx,
  tenant: TenantContext,
  rows: EmployeeImportRow[],
  meta: RequestMeta,
  options: { dryRun?: boolean } = {},
): Promise<ImportOutcome> {
  const companyId = tenant.company.id;
  const dryRun = options.dryRun === true;
  const departmentIndex = new Map(
    (await tx.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.companyId, companyId)))
      .map((row) => [row.name.trim().toLowerCase(), row.id]),
  );
  const positionIndex = new Map(
    (await tx.select({ id: positions.id, name: positions.name }).from(positions).where(eq(positions.companyId, companyId)))
      .map((row) => [row.name.trim().toLowerCase(), row.id]),
  );

  // Dublikat kaliti — telefon raqami (kompaniya ichida)
  const takenPhones = new Set(
    (await tx.select({ phone: employees.phone }).from(employees).where(eq(employees.companyId, companyId)))
      .map((row) => normalizePhone(row.phone))
      .filter((phone): phone is string => Boolean(phone)),
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
      fail("Ism-familiya majburiy");
      continue;
    }
    if (name.length > 200) {
      fail("Ism-familiya juda uzun (200 belgidan ko'p)");
      continue;
    }

    const hireDate = parseIsoDate(row.hireDate);
    if (!hireDate) {
      fail("Ishga kirgan sana majburiy va YYYY-MM-DD ko'rinishida bo'lishi kerak");
      continue;
    }
    if (row.birthDate?.trim() && !parseIsoDate(row.birthDate)) {
      fail("Tug'ilgan sana YYYY-MM-DD ko'rinishida bo'lishi kerak");
      continue;
    }

    const departmentName = row.department?.trim();
    const departmentId = departmentName ? departmentIndex.get(departmentName.toLowerCase()) : undefined;
    if (departmentName && !departmentId) {
      fail(`Bo'lim topilmadi: ${departmentName}`);
      continue;
    }
    const positionName = row.position?.trim();
    const positionId = positionName ? positionIndex.get(positionName.toLowerCase()) : undefined;
    if (positionName && !positionId) {
      fail(`Lavozim topilmadi: ${positionName}`);
      continue;
    }

    const salaryType = salaryTypeOf(row.salaryType);
    if (!salaryType) {
      fail("Maosh turi: oylik, soatlik yoki kunlik");
      continue;
    }
    const salary = Number(cleanNumber(row.baseSalary));
    if (!Number.isFinite(salary) || salary < 0) {
      fail("Maosh noto'g'ri son");
      continue;
    }

    // CREATE ONLY: shu telefonli hodim bo'lsa yangi yozuv ochilmaydi
    const phone = normalizePhone(row.phone);
    if (phone && takenPhones.has(phone)) {
      duplicates.push({ row: line, key: name, message: `Bu telefon bilan hodim allaqachon bor: ${row.phone?.trim() ?? ""}` });
      continue;
    }

    valid += 1;
    if (phone) takenPhones.add(phone);
    if (dryRun) continue;
    // `softwareAccess` berilmaydi — import login, parol va PIN yaratmaydi
    await createEmployee(
      tx,
      tenant,
      {
        name,
        phone: optionalText(row.phone, 20),
        email: optionalText(row.email, 255),
        departmentId: departmentId ?? null,
        positionId: positionId ?? null,
        hireDate,
        birthDate: parseIsoDate(row.birthDate),
        gender: genderOf(row.gender),
        address: optionalText(row.address, 1000),
        passportNumber: optionalText(row.passportNumber, 32),
        inn: optionalText(row.inn, 32),
        bankAccount: optionalText(row.bankAccount, 64),
        baseSalary: cleanNumber(row.baseSalary),
        salaryType,
      },
      meta,
    );
    created += 1;
  }

  return { created, valid, errors, duplicates, warnings, dryRun };
}
