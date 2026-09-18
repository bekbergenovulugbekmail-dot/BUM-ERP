import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, Search, Users, Phone, Building2, Pencil, Trash2, User, MapPin, UserCheck, MonitorSmartphone, MonitorOff } from "lucide-react";
import { FULL_ACCESS_ROLES } from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import CsvToolbar from "@/components/csv/csv-toolbar.tsx";
import NewEmployeeDialog from "@/components/company/new-employee-dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import AdditionalLicensePicker from "@/components/subscription/additional-license-picker.tsx";
import { LICENSE_STATUS_LABEL, LICENSE_TYPE_LABEL, formatDay, licenseLimitOf } from "@/lib/subscription.ts";
import {
  fmt, localIsoDate,
  type Department, type Employee, type EmployeeStatus, type Position, type SalaryType,
} from "../_lib/types.ts";

const STATUS_MAP: Record<EmployeeStatus, { label: string; color: string; dot: string }> = {
  active: { label: "Faol", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", dot: "bg-emerald-400" },
  on_leave: { label: "Ta'tilda", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", dot: "bg-amber-400" },
  terminated: { label: "Ishdan bo'shatilgan", color: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400", dot: "bg-rose-400" },
};

const FULL_ACCESS = new Set<string>(FULL_ACCESS_ROLES);
const PIN_RE = /^\d{4,8}$/;

type RoleOption = { id: string; name: string; isActive: boolean };

type FormState = {
  name: string; phone: string; email: string;
  departmentId: string; positionId: string;
  hireDate: string; baseSalary: string;
  salaryType: SalaryType;
  birthDate: string; gender: "" | "male" | "female";
  address: string; bankAccount: string; notes: string;
  status: EmployeeStatus;
};

/** Dasturdan foydalanadigan xodim uchun login ma'lumotlari (parol va PIN serverda faqat xesh). */
type Credentials = { phone: string; password: string; pin: string; role: string };

const emptyForm = (): FormState => ({
  name: "", phone: "", email: "", departmentId: "", positionId: "",
  hireDate: localIsoDate(), baseSalary: "",
  salaryType: "monthly", birthDate: "",
  gender: "", address: "", bankAccount: "", notes: "", status: "active",
});

const emptyCredentials = (phone = ""): Credentials => ({ phone, password: "", pin: "", role: "Kassir" });

/** Bo'sh maydon `null` — tahrirda ma'lumotni tozalash mumkin. */
function toBody(form: FormState, includeSensitive: boolean) {
  return {
    name: form.name.trim(),
    phone: form.phone.trim() || null,
    email: form.email.trim() || null,
    departmentId: form.departmentId || null,
    positionId: form.positionId || null,
    hireDate: form.hireDate,
    birthDate: form.birthDate || null,
    gender: form.gender || null,
    address: form.address.trim() || null,
    baseSalary: form.baseSalary || "0",
    salaryType: form.salaryType,
    notes: form.notes.trim() || null,
    ...(includeSensitive ? { bankAccount: form.bankAccount.trim() || null } : {}),
  };
}

type EmployeeBody = ReturnType<typeof toBody>;
type SoftwareAccessBody = Credentials & { additionalLicensePlanId?: string };

function credentialsError(credentials: Credentials): string | null {
  if (!credentials.phone.trim()) return "Login uchun telefon raqam kiriting";
  if (credentials.password.length < 8) return "Parol kamida 8 ta belgidan iborat bo'lishi kerak";
  if (!PIN_RE.test(credentials.pin)) return "PIN 4-8 ta raqamdan iborat bo'lishi kerak";
  if (!credentials.role) return "Rol tanlang";
  return null;
}

export default function EmployeesSection() {
  const { t } = useTranslation("distribution");
  const { can } = usePermissions();
  const canManage = can("hr.manage");
  const canSoftware = canManage && can("employee.software_access.manage");
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | EmployeeStatus>("all");
  const [editEmployee, setEditEmployee] = useState<string | null>(null);
  /** Yagona "Xodim qo'shish" oynasi (Sozlamalar bo'limidagi bilan bir xil komponent). */
  const [addOpen, setAddOpen] = useState(false);
  const [accessTarget, setAccessTarget] = useState<Employee | null>(null);

  const employeesQuery = useApiQuery<{ employees: Employee[] }>("/api/hr/employees", {
    search: search.trim().length > 1 ? search.trim() : undefined,
    departmentId: deptFilter !== "all" ? deptFilter : undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
  });
  const employees = employeesQuery.data?.employees;
  const departments = useApiQuery<{ departments: Department[] }>("/api/hr/departments").data?.departments;
  const positions = useApiQuery<{ positions: Position[] }>("/api/hr/positions").data?.positions;
  const roles = useApiQuery<{ roles: RoleOption[] }>(canSoftware ? "/api/company/roles" : null).data?.roles;
  const assignableRoles = (roles ?? []).filter((role) => role.isActive && !FULL_ACCESS.has(role.name));

  const updateEmployee = useApiMutation(({ id, ...body }: EmployeeBody & { id: string; status: EmployeeStatus }) =>
    api.patch(`/api/hr/employees/${id}`, body),
  );
  const deleteEmployee = useApiMutation((id: string) => api.delete(`/api/hr/employees/${id}`));
  const disableAccess = useApiMutation((id: string) => api.delete(`/api/hr/employees/${id}/software-access`));

  const [localEditForm, setLocalEditForm] = useState<FormState>(emptyForm);

  const openEdit = (emp: Employee) => {
    setEditEmployee(emp.id);
    setLocalEditForm({
      name: emp.name, phone: emp.phone ?? "", email: emp.email ?? "",
      departmentId: emp.departmentId ?? "", positionId: emp.positionId ?? "",
      hireDate: emp.hireDate, baseSalary: emp.baseSalary,
      salaryType: emp.salaryType, birthDate: emp.birthDate ?? "",
      gender: emp.gender ?? "",
      address: emp.address ?? "", bankAccount: emp.bankAccount ?? "", notes: emp.notes ?? "",
      status: emp.status,
    });
  };

  const handleUpdate = async () => {
    if (!editEmployee) return;
    if (!localEditForm.name.trim()) { toast.error("Ism kiritilishi shart"); return; }
    try {
      await updateEmployee.mutateAsync({
        id: editEmployee,
        ...toBody(localEditForm, canManage),
        status: localEditForm.status,
      });
      toast.success("Xodim yangilandi");
      setEditEmployee(null);
    } catch (e) { toast.error(errorMessage(e)); }
  };

  // Davomat/maosh tarixi bor xodim o'chirilmaydi — server rad etadi, holatni "ishdan bo'shatilgan" qilish kerak
  const handleDelete = async (id: string) => {
    if (!confirm("O'chirishni tasdiqlaysizmi?")) return;
    try {
      await deleteEmployee.mutateAsync(id);
      toast.success("Xodim o'chirildi");
    } catch (e) { toast.error(errorMessage(e)); }
  };

  const handleMakeFree = async (emp: Employee) => {
    if (!confirm(`${emp.name} dasturdan uziladi: kirishi yopiladi, sessiyalari tugaydi, litsenziya bo'shaydi. Xodim ma'lumotlari saqlanadi. Davom etasizmi?`)) return;
    try {
      await disableAccess.mutateAsync(emp.id);
      toast.success("Xodim bepul xodimga aylantirildi");
    } catch (e) { toast.error(errorMessage(e)); }
  };

  const loading = updateEmployee.isPending;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Xodim qidirish..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Bo'lim" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Barcha bo'limlar</SelectItem>
            {departments?.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Barcha holat</SelectItem>
            <SelectItem value="active">Faol</SelectItem>
            <SelectItem value="on_leave">Ta'tilda</SelectItem>
            <SelectItem value="terminated">Ishdan ketgan</SelectItem>
          </SelectContent>
        </Select>
        {/* Xodim qo'shish YAGONA forma orqali: kassir, savdo agenti, yetkazuvchi yoki bepul xodim */}
        {canManage && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Xodim qo'shish
          </Button>
        )}
        {/* Maxfiy ustunlar (pasport, INN, hisob raqami, maosh) faqat maosh ruxsati bilan chiqadi */}
        <CsvToolbar
          exportUrl="/api/hr/employees/export"
          exportParams={can("hr.salary") ? { includeSalary: true } : undefined}
          filename="hodimlar"
          importUrl="/api/hr/employees/import"
          invalidate={["/api/hr/employees"]}
          canImport={canManage}
          columns={[
            { key: "name", aliases: ["Ism-familiya", "name"], required: true, example: "Anvar Karimov" },
            { key: "phone", aliases: ["Telefon", "phone"], example: "+998901234567" },
            { key: "email", aliases: ["Email", "email"], example: "anvar@mail.uz" },
            { key: "department", aliases: ["Bo'lim", "department"], example: "Savdo" },
            { key: "position", aliases: ["Lavozim", "position"], example: "Sotuvchi" },
            { key: "hireDate", aliases: ["Ishga kirgan sana", "hireDate"], required: true, example: "2026-01-15" },
            { key: "birthDate", aliases: ["Tug'ilgan sana", "birthDate"], example: "1995-04-20" },
            { key: "gender", aliases: ["Jinsi", "gender"], example: "Erkak" },
            { key: "address", aliases: ["Manzil", "address"], example: "Urganch, Al-Xorazmiy 12" },
            { key: "passportNumber", aliases: ["Pasport", "passportNumber"], example: "AA1234567" },
            { key: "inn", aliases: ["INN", "inn"], example: "123456789" },
            { key: "bankAccount", aliases: ["Hisob raqami", "bankAccount"], example: "20208000000000000001" },
            { key: "baseSalary", aliases: ["Maosh", "baseSalary"], example: "4000000" },
            { key: "salaryType", aliases: ["Maosh turi", "salaryType"], example: "Oylik" },
          ]}
        />
      </div>

      {/* List */}
      {!employees ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        </div>
      ) : employees.length === 0 ? (
        <div className="text-center py-16">
          <Users className="h-12 w-12 mx-auto mb-3 text-muted-foreground/20" />
          <p className="text-muted-foreground">Xodimlar topilmadi</p>
          {canManage && (
            <Button size="sm" className="mt-3" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Xodim qo'shish
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {employees.map((emp) => {
            const st = STATUS_MAP[emp.status];
            const usesSoftware = Boolean(emp.memberActive && emp.licenseType);
            return (
              <div key={emp.id} className="bg-card border border-border rounded-2xl p-4 group hover:border-primary/30 transition-all">
                <div className="flex items-start gap-3">
                  <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-bold text-lg flex-shrink-0">
                    {emp.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{emp.name}</p>
                        <p className="text-xs font-mono text-muted-foreground">{emp.code}</p>
                      </div>
                      <span className={cn("text-xs px-2 py-0.5 rounded-full flex-shrink-0", st.color)}>{st.label}</span>
                    </div>
                    <div className="mt-2 space-y-1">
                      {emp.positionName && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <User className="h-3 w-3" /> {emp.positionName}
                        </div>
                      )}
                      {emp.departmentName && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Building2 className="h-3 w-3" /> {emp.departmentName}
                        </div>
                      )}
                      {emp.phone && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Phone className="h-3 w-3" /> {emp.phone}
                        </div>
                      )}
                      {emp.salesRepId && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1.5">
                            <MapPin className="h-3 w-3" /> {t("team.region")}: {emp.agentRegion || "—"}
                          </span>
                          <span className="flex items-center gap-1.5">
                            <UserCheck className="h-3 w-3" /> {t("team.supervisor")}: {emp.supervisorName ?? t("team.no_supervisor")}
                          </span>
                        </div>
                      )}
                      <AccessBadge employee={emp} now={employeesQuery.dataUpdatedAt} />
                    </div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">Oylik maosh</p>
                    <p className="font-bold">{fmt(emp.baseSalary)} so'm</p>
                  </div>
                  {canManage && (
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      {canSoftware && emp.status !== "terminated" && (
                        usesSoftware ? (
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" title="Bepul xodimga aylantirish"
                            disabled={disableAccess.isPending} onClick={() => { void handleMakeFree(emp); }}>
                            <MonitorOff className="h-3.5 w-3.5 mr-1" /> Bepul
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" title="Dasturga ulash"
                            onClick={() => setAccessTarget(emp)}>
                            <MonitorSmartphone className="h-3.5 w-3.5 mr-1" /> Dastur
                          </Button>
                        )
                      )}
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(emp)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive"
                        onClick={() => handleDelete(emp.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <NewEmployeeDialog open={addOpen} onClose={() => setAddOpen(false)} />

      {/* Edit dialog */}
      {editEmployee && (
        <Dialog open onOpenChange={(o) => !o && setEditEmployee(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Xodimni tahrirlash</DialogTitle></DialogHeader>
            <EmployeeForm
              form={localEditForm} setForm={setLocalEditForm}
              departments={departments ?? []}
              positions={positions ?? []}
              showSensitive={canManage}
              showStatus
            />
            <DialogFooter>
              <Button variant="secondary" onClick={() => setEditEmployee(null)}>Bekor</Button>
              <Button onClick={handleUpdate} disabled={loading}>{loading ? "..." : "Saqlash"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {accessTarget && (
        <SoftwareAccessDialog key={accessTarget.id} employee={accessTarget} roles={assignableRoles} onClose={() => setAccessTarget(null)} />
      )}
    </div>
  );
}

/** 💻 Dasturdan foydalanadi · litsenziya turi · holat — yoki 🆓 Bepul. `now` — ro'yxat olingan vaqt. */
function AccessBadge({ employee, now }: { employee: Employee; now: number }) {
  if (!employee.memberActive || !employee.licenseType || !employee.licenseStatus) {
    return <p className="text-xs text-muted-foreground">🆓 Bepul · Dastur: Yo'q</p>;
  }
  const expired =
    employee.licenseType === "additional" &&
    employee.licenseExpiresAt !== null &&
    employee.licenseExpiresAt !== undefined &&
    new Date(employee.licenseExpiresAt).getTime() <= now;
  const status = expired ? "expired" : employee.licenseStatus;
  return (
    <p className="text-xs">
      <span className="text-primary font-medium">💻 Dasturdan foydalanadi</span>
      <span className="text-muted-foreground"> · License: {LICENSE_TYPE_LABEL[employee.licenseType]}</span>
      <span className={cn(" ", status === "active" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
        {" · "}{LICENSE_STATUS_LABEL[status]}
        {employee.licenseType === "additional" && employee.licenseExpiresAt ? ` (${formatDay(employee.licenseExpiresAt)} gacha)` : ""}
      </span>
    </p>
  );
}

function CredentialsFields({ value, onChange, roles }: { value: Credentials; onChange: (next: Credentials) => void; roles: RoleOption[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <Label htmlFor="software-phone">Telefon (login) *</Label>
        <Input id="software-phone" type="tel" value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} placeholder="+998901234567" />
      </div>
      <div>
        <Label>Rol *</Label>
        <Select value={value.role} onValueChange={(role) => onChange({ ...value, role })}>
          <SelectTrigger><SelectValue placeholder="Rol tanlang" /></SelectTrigger>
          <SelectContent position="popper">
            {roles.map((role) => <SelectItem key={role.id} value={role.name}>{role.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="software-password">Parol * (kamida 8 belgi)</Label>
        <Input id="software-password" type="password" autoComplete="new-password" value={value.password} onChange={(e) => onChange({ ...value, password: e.target.value })} />
      </div>
      <div>
        <Label htmlFor="software-pin">PIN * (4-8 raqam, ekran qulfi uchun)</Label>
        <Input
          id="software-pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={value.pin}
          onChange={(e) => onChange({ ...value, pin: e.target.value.replace(/\D/g, "").slice(0, 8) })}
        />
      </div>
    </div>
  );
}

/** Bepul xodimni dasturga ulash: yangi login yoki bog'liq hisobni qayta yoqish. */
function SoftwareAccessDialog({ employee, roles, onClose }: { employee: Employee; roles: RoleOption[]; onClose: () => void }) {
  const hasAccount = Boolean(employee.userId);
  const [credentials, setCredentials] = useState<Credentials>(() => emptyCredentials(employee.phone ?? ""));
  const [limit, setLimit] = useState<ReturnType<typeof licenseLimitOf>>(null);
  const enable = useApiMutation((body: Partial<SoftwareAccessBody>) => api.post(`/api/hr/employees/${employee.id}/software-access`, body));

  const submit = async (additionalLicensePlanId?: string) => {
    if (!hasAccount) {
      const problem = credentialsError(credentials);
      if (problem) { toast.error(problem); return; }
    }
    try {
      await enable.mutateAsync({
        ...(hasAccount ? {} : { ...credentials, phone: credentials.phone.trim() }),
        ...(additionalLicensePlanId ? { additionalLicensePlanId } : {}),
      });
      toast.success(additionalLicensePlanId ? "Xodim ulandi — to'lov tasdiqlanguncha kira olmaydi" : "Xodim dasturga ulandi");
      onClose();
    } catch (e) {
      const reached = licenseLimitOf(e);
      if (reached) setLimit(reached);
      else toast.error(errorMessage(e));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Dasturga ulash — {employee.name}</DialogTitle>
          <DialogDescription>
            Bu xodim BUM ERP dasturidan foydalanadi. Software license kerak.
            {hasAccount ? " Xodimning avvalgi logini qayta yoqiladi." : " Login, parol, PIN va rol belgilang."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!hasAccount && <CredentialsFields value={credentials} onChange={(next) => { setCredentials(next); setLimit(null); }} roles={roles} />}
          {limit && <AdditionalLicensePicker counts={limit.counts} pending={enable.isPending} onSelect={(planId) => { void submit(planId); }} />}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Bekor</Button>
          <Button onClick={() => { void submit(); }} disabled={enable.isPending}>{enable.isPending ? "..." : "Ulash"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmployeeForm({ form, setForm, departments, positions, showSensitive, showStatus }: {
  form: FormState;
  setForm: (f: FormState) => void;
  departments: { id: string; name: string }[];
  positions: { id: string; name: string; departmentId: string }[];
  showSensitive: boolean;
  showStatus?: boolean;
}) {
  const filteredPositions = form.departmentId
    ? positions.filter((p) => p.departmentId === form.departmentId)
    : positions;

  return (
    <div className="grid grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto pr-1">
      <div className="col-span-2">
        <Label>To'liq ism *</Label>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Abdullayev Sherzod" />
      </div>
      <div>
        <Label>Telefon</Label>
        <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+998 90 000 00 00" />
      </div>
      <div>
        <Label>Email</Label>
        <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="example@gmail.com" />
      </div>
      <div>
        <Label>Bo'lim</Label>
        <Select value={form.departmentId || "none"} onValueChange={(v) => setForm({ ...form, departmentId: v === "none" ? "" : v, positionId: "" })}>
          <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— Bo'limsiz —</SelectItem>
            {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Lavozim</Label>
        <Select value={form.positionId || "none"} onValueChange={(v) => setForm({ ...form, positionId: v === "none" ? "" : v })}>
          <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— Lavozimisiz —</SelectItem>
            {filteredPositions.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Ishga qabul sanasi *</Label>
        <Input type="date" value={form.hireDate} onChange={(e) => setForm({ ...form, hireDate: e.target.value })} />
      </div>
      <div>
        <Label>Tug'ilgan sana</Label>
        <Input type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} />
      </div>
      <div>
        <Label>Jinsi</Label>
        <Select value={form.gender || "none"} onValueChange={(v) => setForm({ ...form, gender: v === "none" ? "" : v as "male" | "female" })}>
          <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— Ko'rsatilmagan —</SelectItem>
            <SelectItem value="male">Erkak</SelectItem>
            <SelectItem value="female">Ayol</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Ish haqi turi</Label>
        <Select value={form.salaryType} onValueChange={(v) => setForm({ ...form, salaryType: v as SalaryType })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="monthly">Oylik</SelectItem>
            <SelectItem value="hourly">Soatlik</SelectItem>
            <SelectItem value="daily">Kunlik</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Asosiy maosh (so'm) *</Label>
        <Input type="number" min="0" value={form.baseSalary} onChange={(e) => setForm({ ...form, baseSalary: e.target.value })} placeholder="3000000" />
      </div>
      {showStatus && (
        <div>
          <Label>Holat</Label>
          <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as EmployeeStatus })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Faol</SelectItem>
              <SelectItem value="on_leave">Ta'tilda</SelectItem>
              <SelectItem value="terminated">Ishdan bo'shatilgan</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="col-span-2">
        <Label>Manzil</Label>
        <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Toshkent, Chilonzor tumani..." />
      </div>
      {showSensitive && (
        <div className="col-span-2">
          <Label>Bank hisob raqami</Label>
          <Input value={form.bankAccount} onChange={(e) => setForm({ ...form, bankAccount: e.target.value })} placeholder="20208000000000000000" />
        </div>
      )}
      <div className="col-span-2">
        <Label>Izoh</Label>
        <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Ixtiyoriy..." />
      </div>
    </div>
  );
}
