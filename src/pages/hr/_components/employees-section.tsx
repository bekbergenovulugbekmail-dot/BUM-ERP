import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import {
  Plus, Search, Users, Phone, Mail, Building2,
  Pencil, Trash2, ChevronDown, User, UserCheck, UserX, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import type { Id } from "@/convex/_generated/dataModel.d.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

const STATUS_MAP = {
  active: { label: "Faol", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", dot: "bg-emerald-400" },
  on_leave: { label: "Ta'tilda", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", dot: "bg-amber-400" },
  terminated: { label: "Ishdan bo'shatilgan", color: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400", dot: "bg-rose-400" },
};

const SALARY_TYPES = { monthly: "Oylik", hourly: "Soatlik", daily: "Kunlik" };

export default function EmployeesSection() {
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState<Id<"departments"> | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "on_leave" | "terminated">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editEmployee, setEditEmployee] = useState<Id<"employees"> | null>(null);
  const [loading, setLoading] = useState(false);

  const employees = useQuery(api.hr.employees.listEmployees, {
    search: search.length > 1 ? search : undefined,
    departmentId: deptFilter !== "all" ? deptFilter : undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
  });
  const departments = useQuery(api.hr.employees.listDepartments, {});
  const positions = useQuery(api.hr.employees.listPositions, {});
  const editData = useQuery(api.hr.employees.getEmployee, editEmployee ? { id: editEmployee } : "skip");

  const createEmployee = useMutation(api.hr.employees.createEmployee);
  const updateEmployee = useMutation(api.hr.employees.updateEmployee);
  const deleteEmployee = useMutation(api.hr.employees.deleteEmployee);

  const emptyForm = {
    name: "", phone: "", email: "", departmentId: "", positionId: "",
    hireDate: new Date().toISOString().slice(0, 10), baseSalary: "",
    salaryType: "monthly" as "monthly" | "hourly" | "daily", birthDate: "",
    gender: "" as "" | "male" | "female", address: "", bankAccount: "", notes: "",
  };
  const [form, setForm] = useState(emptyForm);

  const openCreate = () => { setForm(emptyForm); setCreateOpen(true); };
  const openEdit = (id: Id<"employees">) => { setEditEmployee(id); };

  // Sync edit form when data loads
  const editForm = editData ? {
    name: editData.name, phone: editData.phone ?? "", email: editData.email ?? "",
    departmentId: editData.departmentId ?? "", positionId: editData.positionId ?? "",
    hireDate: editData.hireDate, baseSalary: String(editData.baseSalary),
    salaryType: editData.salaryType, birthDate: editData.birthDate ?? "",
    gender: (editData.gender ?? "") as "" | "male" | "female",
    address: editData.address ?? "", bankAccount: editData.bankAccount ?? "", notes: editData.notes ?? "",
  } : null;

  const [localEditForm, setLocalEditForm] = useState(emptyForm);

  const handleCreate = async () => {
    if (!form.name) { toast.error("Ism kiritilishi shart"); return; }
    setLoading(true);
    try {
      await createEmployee({
        name: form.name,
        phone: form.phone || undefined,
        email: form.email || undefined,
        departmentId: form.departmentId ? form.departmentId as Id<"departments"> : undefined,
        positionId: form.positionId ? form.positionId as Id<"positions"> : undefined,
        hireDate: form.hireDate,
        birthDate: form.birthDate || undefined,
        gender: form.gender || undefined,
        address: form.address || undefined,
        baseSalary: parseFloat(form.baseSalary) || 0,
        salaryType: form.salaryType,
        bankAccount: form.bankAccount || undefined,
        notes: form.notes || undefined,
      });
      toast.success("Xodim qo'shildi");
      setCreateOpen(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Xatolik"); }
    finally { setLoading(false); }
  };

  const handleUpdate = async () => {
    if (!editEmployee) return;
    setLoading(true);
    try {
      await updateEmployee({
        id: editEmployee,
        name: localEditForm.name || undefined,
        phone: localEditForm.phone || undefined,
        email: localEditForm.email || undefined,
        departmentId: localEditForm.departmentId ? localEditForm.departmentId as Id<"departments"> : undefined,
        positionId: localEditForm.positionId ? localEditForm.positionId as Id<"positions"> : undefined,
        baseSalary: parseFloat(localEditForm.baseSalary) || undefined,
        salaryType: localEditForm.salaryType,
        address: localEditForm.address || undefined,
        bankAccount: localEditForm.bankAccount || undefined,
        notes: localEditForm.notes || undefined,
      });
      toast.success("Xodim yangilandi");
      setEditEmployee(null);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Xatolik"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Xodim qidirish..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={deptFilter as string} onValueChange={(v) => setDeptFilter(v === "all" ? "all" : v as Id<"departments">)}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Bo'lim" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Barcha bo'limlar</SelectItem>
            {departments?.map((d) => <SelectItem key={d._id} value={d._id}>{d.name}</SelectItem>)}
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
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Xodim qo'shish
        </Button>
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
          <Button size="sm" className="mt-3" onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Xodim qo'shish</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {employees.map((emp) => {
            const st = STATUS_MAP[emp.status];
            return (
              <div key={emp._id} className="bg-card border border-border rounded-2xl p-4 group hover:border-primary/30 transition-all">
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
                    </div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">Oylik maosh</p>
                    <p className="font-bold">{fmt(emp.baseSalary)} so'm</p>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => {
                      setEditEmployee(emp._id);
                      setLocalEditForm({
                        name: emp.name, phone: emp.phone ?? "", email: emp.email ?? "",
                        departmentId: emp.departmentId ?? "", positionId: emp.positionId ?? "",
                        hireDate: emp.hireDate, baseSalary: String(emp.baseSalary),
                        salaryType: emp.salaryType, birthDate: emp.birthDate ?? "",
                        gender: (emp.gender ?? "") as "" | "male" | "female",
                        address: emp.address ?? "", bankAccount: emp.bankAccount ?? "", notes: emp.notes ?? "",
                      });
                    }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive"
                      onClick={() => { if (confirm("O'chirishni tasdiqlaysizmi?")) deleteEmployee({ id: emp._id }); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create dialog */}
      {createOpen && (
        <Dialog open onOpenChange={(o) => !o && setCreateOpen(false)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Yangi xodim qo'shish</DialogTitle></DialogHeader>
            <EmployeeForm
              form={form} setForm={setForm}
              departments={departments ?? []}
              positions={positions ?? []}
            />
            <DialogFooter>
              <Button variant="secondary" onClick={() => setCreateOpen(false)}>Bekor</Button>
              <Button onClick={handleCreate} disabled={loading}>{loading ? "..." : "Saqlash"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Edit dialog */}
      {editEmployee && (
        <Dialog open onOpenChange={(o) => !o && setEditEmployee(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Xodimni tahrirlash</DialogTitle></DialogHeader>
            <EmployeeForm
              form={localEditForm} setForm={setLocalEditForm}
              departments={departments ?? []}
              positions={positions ?? []}
            />
            <DialogFooter>
              <Button variant="secondary" onClick={() => setEditEmployee(null)}>Bekor</Button>
              <Button onClick={handleUpdate} disabled={loading}>{loading ? "..." : "Saqlash"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

type FormState = {
  name: string; phone: string; email: string;
  departmentId: string; positionId: string;
  hireDate: string; baseSalary: string;
  salaryType: "monthly" | "hourly" | "daily";
  birthDate: string; gender: "" | "male" | "female";
  address: string; bankAccount: string; notes: string;
};

function EmployeeForm({ form, setForm, departments, positions }: {
  form: FormState;
  setForm: (f: FormState) => void;
  departments: { _id: string; name: string }[];
  positions: { _id: string; name: string; departmentId: string; departmentName?: string }[];
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
            {departments.map((d) => <SelectItem key={d._id} value={d._id}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Lavozim</Label>
        <Select value={form.positionId || "none"} onValueChange={(v) => setForm({ ...form, positionId: v === "none" ? "" : v })}>
          <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— Lavozimisiz —</SelectItem>
            {filteredPositions.map((p) => <SelectItem key={p._id} value={p._id}>{p.name}</SelectItem>)}
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
        <Select value={form.salaryType} onValueChange={(v) => setForm({ ...form, salaryType: v as "monthly" | "hourly" | "daily" })}>
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
      <div className="col-span-2">
        <Label>Manzil</Label>
        <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Toshkent, Chilonzor tumani..." />
      </div>
      <div className="col-span-2">
        <Label>Bank hisob raqami</Label>
        <Input value={form.bankAccount} onChange={(e) => setForm({ ...form, bankAccount: e.target.value })} placeholder="20208000000000000000" />
      </div>
      <div className="col-span-2">
        <Label>Izoh</Label>
        <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Ixtiyoriy..." />
      </div>
    </div>
  );
}
