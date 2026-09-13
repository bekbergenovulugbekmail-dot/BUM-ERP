/**
 * HR API javoblari (`/api/hr/*`). Summa va miqdorlar — aniq o'nlik satr, `Number()` faqat ko'rsatish uchun.
 */

export type Department = {
  id: string;
  name: string;
  code: string;
  parentId: string | null;
  managerId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  employeeCount: number;
  positionCount: number;
};

export type Position = {
  id: string;
  departmentId: string;
  name: string;
  level: string | null;
  minSalary: string | null;
  maxSalary: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  departmentName: string;
  employeeCount: number;
};

export type EmployeeStatus = "active" | "on_leave" | "terminated";
export type SalaryType = "monthly" | "hourly" | "daily";

export type Employee = {
  id: string;
  name: string;
  code: string;
  phone: string | null;
  email: string | null;
  departmentId: string | null;
  positionId: string | null;
  managerId: string | null;
  userId: string | null;
  hireDate: string;
  birthDate: string | null;
  gender: "male" | "female" | null;
  address: string | null;
  /** Maxfiy maydonlar — faqat `hr.manage` bo'lsa keladi. */
  passportNumber?: string | null;
  inn?: string | null;
  bankAccount?: string | null;
  baseSalary: string;
  salaryType: SalaryType;
  status: EmployeeStatus;
  photoKey: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  departmentName: string | null;
  positionName: string | null;
  /** Ro'yxatda: sotuv agenti bo'lsa — agent, hudud va supervayzer. */
  salesRepId?: string | null;
  agentRegion?: string | null;
  supervisorName?: string | null;
  /** Ro'yxatda: dasturdan foydalanishi — login, a'zolik va joriy litsenziya (bepul xodimda NULL). */
  loginPhone?: string | null;
  companyRole?: string | null;
  memberActive?: boolean | null;
  licenseType?: "included" | "additional" | null;
  licenseStatus?: "active" | "pending_payment" | "expired" | "revoked" | null;
  licenseExpiresAt?: string | null;
};

export type EmployeeStats = {
  total: number;
  active: number;
  onLeave: number;
  terminated: number;
  totalSalary: string;
};

export type AttendanceStatus = "present" | "absent" | "late" | "half_day" | "holiday" | "on_leave";

export type AttendanceRecord = {
  id: string;
  employeeId: string;
  attendanceDate: string;
  checkIn: string | null;
  checkOut: string | null;
  workHours: string;
  overtime: string;
  status: AttendanceStatus;
  notes: string | null;
  employeeName: string;
  departmentName: string | null;
};

export type AttendanceStats = {
  total: number;
  present: number;
  absent: number;
  late: number;
  halfDay: number;
  onLeave: number;
  totalHours: string;
  totalOvertime: string;
};

export type SalaryStatus = "draft" | "approved" | "paid";

export type SalaryPayment = {
  id: string;
  employeeId: string;
  month: string;
  baseSalary: string;
  workDays: string;
  actualDays: string;
  overtime: string;
  overtimePay: string;
  bonus: string;
  deductions: string;
  grossSalary: string;
  taxRate: string;
  tax: string;
  netSalary: string;
  status: SalaryStatus;
  paidDate: string | null;
  approvedBy: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  employeeName: string;
  employeeCode: string;
  departmentName: string | null;
  positionName: string | null;
};

export type SalarySummary = {
  total: number;
  draft: number;
  approved: number;
  paid: number;
  totalGross: string;
  totalBonus: string;
  totalTax: string;
  totalNet: string;
};

export const toNum = (value: string | number | null | undefined) => Number(value ?? 0) || 0;

export const fmt = (value: string | number | null | undefined) =>
  new Intl.NumberFormat("uz-UZ").format(Math.round(toNum(value)));

/** "8.0000" → "8", "7.5000" → "7.5". */
export const trimQty = (value: string | number | null | undefined) => String(toNum(value));

/** Mahalliy sana (UTC emas) — "YYYY-MM-DD". */
export function localIsoDate(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
