/**
 * Maosh bo'limidagi sozlash kartochkasi: har xodimning ish haqi turi (oylik / soatlik / kunlik) va
 * miqdori shu yerdan kiritiladi (xodim qo'shish oynasida so'ralmaydi), hamda muntazam qo'shimcha
 * to'lovlar — yo'l puli, ovqat puli va boshqalar — xodimga va davrga biriktiriladi.
 *
 * API: `PATCH /api/hr/employees/:id` (maosh), `GET|POST|PATCH|DELETE /api/hr/allowances`.
 * Ruxsat: maoshni ko'rish va o'zgartirish — `hr.salary`.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { localIsoDate } from "../_lib/types.ts";

type SalaryType = "monthly" | "hourly" | "daily";
type AllowanceKind = "transport" | "meal" | "phone" | "housing" | "other";

type Employee = { id: string; name: string; status: string; baseSalary: string; salaryType: SalaryType };
type Allowance = {
  id: string;
  employeeId: string;
  employeeName: string;
  kind: AllowanceKind;
  label: string | null;
  amount: string;
  startMonth: string;
  endMonth: string | null;
  isActive: boolean;
};

const SALARY_TYPES: { value: SalaryType; label: string }[] = [
  { value: "monthly", label: "Oylik" },
  { value: "hourly", label: "Soatlik" },
  { value: "daily", label: "Kunlik" },
];

const ALLOWANCE_KINDS: { value: AllowanceKind; label: string }[] = [
  { value: "transport", label: "Yo'l puli" },
  { value: "meal", label: "Ovqat puli" },
  { value: "phone", label: "Aloqa" },
  { value: "housing", label: "Turar joy" },
  { value: "other", label: "Boshqa" },
];

const kindLabel = (allowance: Allowance) =>
  allowance.kind === "other"
    ? allowance.label || "Boshqa"
    : ALLOWANCE_KINDS.find((kind) => kind.value === allowance.kind)?.label ?? allowance.kind;

const money = (value: string) => Number(value || 0).toLocaleString("uz-UZ");

export default function SalarySetupCard({ canManage }: { canManage: boolean }) {
  const thisMonth = localIsoDate().slice(0, 7);
  const employees = useApiQuery<{ employees: Employee[] }>("/api/hr/employees", { limit: 200 }).data?.employees;
  const allowances = useApiQuery<{ allowances: Allowance[] }>("/api/hr/allowances").data?.allowances;

  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ salaryType: "monthly" as SalaryType, baseSalary: "" });
  const [addOpen, setAddOpen] = useState(false);
  const [allowanceForm, setAllowanceForm] = useState({
    employeeId: "",
    kind: "transport" as AllowanceKind,
    label: "",
    amount: "",
    startMonth: thisMonth,
    endMonth: "",
  });

  const saveSalary = useApiMutation(({ id, ...body }: { id: string; salaryType: SalaryType; baseSalary: string }) =>
    api.patch(`/api/hr/employees/${id}`, body),
  );
  const createAllowance = useApiMutation((body: Record<string, unknown>) => api.post("/api/hr/allowances", body), {
    invalidate: ["/api/hr/allowances"],
  });
  const removeAllowance = useApiMutation((id: string) => api.delete(`/api/hr/allowances/${id}`), {
    invalidate: ["/api/hr/allowances"],
  });

  const active = (employees ?? []).filter((employee) => employee.status !== "terminated");

  const openEdit = (employee: Employee) => {
    setEditing(employee.id);
    setForm({ salaryType: employee.salaryType, baseSalary: employee.baseSalary });
  };

  const handleSaveSalary = async () => {
    if (!editing) return;
    if (!(Number(form.baseSalary) >= 0)) {
      toast.error("Maosh musbat son bo'lishi kerak");
      return;
    }
    try {
      await saveSalary.mutateAsync({ id: editing, salaryType: form.salaryType, baseSalary: form.baseSalary || "0" });
      toast.success("Maosh saqlandi");
      setEditing(null);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const handleAddAllowance = async () => {
    if (!allowanceForm.employeeId) {
      toast.error("Xodimni tanlang");
      return;
    }
    if (!(Number(allowanceForm.amount) > 0)) {
      toast.error("Summa musbat bo'lishi kerak");
      return;
    }
    try {
      await createAllowance.mutateAsync({
        employeeId: allowanceForm.employeeId,
        kind: allowanceForm.kind,
        ...(allowanceForm.kind === "other" ? { label: allowanceForm.label.trim() } : {}),
        amount: allowanceForm.amount,
        startMonth: allowanceForm.startMonth,
        ...(allowanceForm.endMonth ? { endMonth: allowanceForm.endMonth } : {}),
      });
      toast.success("Qo'shimcha to'lov qo'shildi");
      setAddOpen(false);
      setAllowanceForm({ employeeId: "", kind: "transport", label: "", amount: "", startMonth: thisMonth, endMonth: "" });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const handleRemove = async (allowance: Allowance) => {
    if (!confirm(`${allowance.employeeName}: ${kindLabel(allowance)} o'chirilsinmi?`)) return;
    try {
      await removeAllowance.mutateAsync(allowance.id);
      toast.success("O'chirildi");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Wallet className="h-4 w-4" /> Maosh va qo'shimcha to'lovlar
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Xodimning ish haqi turi (oylik, soatlik, kunlik) va miqdori shu yerda; yo'l puli va ovqat puli kabi
              to'lovlar xodimga va davrga biriktiriladi va maosh hisoblanganda avtomatik qo'shiladi.
            </p>
          </div>
          {canManage && (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Qo'shimcha to'lov
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Ish haqi turi va miqdori */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-2">Xodim</th>
                <th className="py-2 pr-2">Ish haqi turi</th>
                <th className="py-2 pr-2 text-right">Miqdori</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {!employees ? (
                <tr><td colSpan={4} className="py-3 text-muted-foreground">Yuklanmoqda...</td></tr>
              ) : active.length === 0 ? (
                <tr><td colSpan={4} className="py-3 text-muted-foreground">Xodim yo'q</td></tr>
              ) : (
                active.map((employee) => (
                  <tr key={employee.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-2 font-medium">{employee.name}</td>
                    <td className="py-2 pr-2">{SALARY_TYPES.find((type) => type.value === employee.salaryType)?.label}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{money(employee.baseSalary)} so'm</td>
                    <td className="py-2 text-right">
                      {canManage && (
                        <Button size="sm" variant="ghost" onClick={() => openEdit(employee)}>
                          O'zgartirish
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Qo'shimcha to'lovlar */}
        <div>
          <p className="mb-2 text-sm font-medium">Qo'shimcha to'lovlar</p>
          {!allowances ? (
            <p className="text-sm text-muted-foreground">Yuklanmoqda...</p>
          ) : allowances.length === 0 ? (
            <p className="text-sm text-muted-foreground">Hali qo'shimcha to'lov biriktirilmagan</p>
          ) : (
            <ul className="divide-y divide-border">
              {allowances.map((allowance) => (
                <li key={allowance.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {allowance.employeeName} · {kindLabel(allowance)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {money(allowance.amount)} so'm / oy · {allowance.startMonth} dan{" "}
                      {allowance.endMonth ? `${allowance.endMonth} gacha` : "muddatsiz"}
                      {allowance.isActive ? "" : " · to'xtatilgan"}
                    </p>
                  </div>
                  {canManage && (
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void handleRemove(allowance)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>

      {/* Ish haqi turi va miqdori */}
      {editing && (
        <Dialog open onOpenChange={(open) => !open && setEditing(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Ish haqi</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Ish haqi turi</Label>
                <Select value={form.salaryType} onValueChange={(value) => setForm({ ...form, salaryType: value as SalaryType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SALARY_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Soatlik va kunlikda miqdor bir soat/kun uchun; KPI mukofoti alohida qoidalar bo'yicha qo'shiladi.
                </p>
              </div>
              <div>
                <Label>Miqdori (so'm)</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.baseSalary}
                  onChange={(event) => setForm({ ...form, baseSalary: event.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setEditing(null)}>Bekor</Button>
              <Button onClick={() => void handleSaveSalary()} disabled={saveSalary.isPending}>Saqlash</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Qo'shimcha to'lov qo'shish */}
      {addOpen && (
        <Dialog open onOpenChange={(open) => !open && setAddOpen(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Qo'shimcha to'lov</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Xodim *</Label>
                <Select value={allowanceForm.employeeId} onValueChange={(value) => setAllowanceForm({ ...allowanceForm, employeeId: value })}>
                  <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
                  <SelectContent>
                    {active.map((employee) => (
                      <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Turi *</Label>
                <Select value={allowanceForm.kind} onValueChange={(value) => setAllowanceForm({ ...allowanceForm, kind: value as AllowanceKind })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALLOWANCE_KINDS.map((kind) => (
                      <SelectItem key={kind.value} value={kind.value}>{kind.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {allowanceForm.kind === "other" && (
                <div>
                  <Label>Nomi *</Label>
                  <Input
                    value={allowanceForm.label}
                    onChange={(event) => setAllowanceForm({ ...allowanceForm, label: event.target.value })}
                    placeholder="Masalan: Telefon aloqasi"
                  />
                </div>
              )}
              <div>
                <Label>Bir oylik summa (so'm) *</Label>
                <Input
                  type="number"
                  min="0"
                  value={allowanceForm.amount}
                  onChange={(event) => setAllowanceForm({ ...allowanceForm, amount: event.target.value })}
                  placeholder="300000"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Qaysi oydan *</Label>
                  <Input
                    type="month"
                    value={allowanceForm.startMonth}
                    onChange={(event) => setAllowanceForm({ ...allowanceForm, startMonth: event.target.value })}
                  />
                </div>
                <div>
                  <Label>Qaysi oygacha</Label>
                  <Input
                    type="month"
                    value={allowanceForm.endMonth}
                    onChange={(event) => setAllowanceForm({ ...allowanceForm, endMonth: event.target.value })}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">Bo'sh — muddatsiz</p>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setAddOpen(false)}>Bekor</Button>
              <Button onClick={() => void handleAddAllowance()} disabled={createAllowance.isPending}>Qo'shish</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
