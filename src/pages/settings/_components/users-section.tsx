/**
 * Kompaniya xodimlari — `/api/company/employees`.
 *
 * Ko'rish — `users.view`. Xodim qo'shish, rol/holat o'zgartirish va parol tiklash —
 * faqat kompaniya egasi (server ham tekshiradi). To'liq huquqli rollar
 * (Superadmin, Business Owner) tanlovda yo'q — o'z huquqini oshirib bo'lmaydi.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Search, UserCheck, UserX, UserPlus, KeyRound, Loader2, AlertTriangle } from "lucide-react";
import { FULL_ACCESS_ROLES } from "@bum/shared";
import { Input } from "@/components/ui/input.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog.tsx";
import { cn } from "@/lib/utils.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { useCurrentUser } from "@/hooks/use-auth.ts";
import { useActiveCompany } from "@/hooks/use-company.ts";
import type { CompanyRole, Employee } from "../_lib/types.ts";

const FULL_ACCESS = new Set<string>(FULL_ACCESS_ROLES);
const COMPANY = ["/api/company"];

type MemberPatch = { role?: string; isActive?: boolean };

export default function UsersSection() {
  const [search, setSearch] = useState("");
  const currentUser = useCurrentUser();
  const { data: active } = useActiveCompany();
  const isOwner = Boolean(currentUser && active?.company.ownerId === currentUser.id);

  const employeesQuery = useApiQuery<{ employees: Employee[] }>("/api/company/employees");
  const rolesQuery = useApiQuery<{ roles: CompanyRole[] }>("/api/company/roles");
  const employees = employeesQuery.data?.employees;
  const roles = rolesQuery.data?.roles;
  const assignableRoles = useMemo(
    () => (roles ?? []).filter((r) => r.isActive && !FULL_ACCESS.has(r.name)),
    [roles],
  );

  const updateMember = useApiMutation(
    ({ userId, patch }: { userId: string; patch: MemberPatch }) => api.patch(`/api/company/employees/${userId}`, patch),
    { invalidate: COMPANY },
  );
  const createEmployee = useApiMutation(
    (body: { phone: string; password: string; name?: string; role?: string }) => api.post("/api/company/employees", body),
    { invalidate: COMPANY },
  );
  const resetPassword = useApiMutation(
    ({ userId, newPassword }: { userId: string; newPassword: string }) =>
      api.post(`/api/company/employees/${userId}/password`, { newPassword }),
    { invalidate: false },
  );

  // Yangi xodim dialogi
  const [createOpen, setCreateOpen] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // Parol tiklash dialogi
  const [resetTarget, setResetTarget] = useState<Employee | null>(null);
  const [resetValue, setResetValue] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees ?? [];
    return (employees ?? []).filter(
      (e) => (e.name ?? "").toLowerCase().includes(q) || e.phone.includes(q) || e.companyRole.toLowerCase().includes(q),
    );
  }, [employees, search]);

  const openCreate = () => {
    setFormError(null);
    setNewPhone("");
    setNewName("");
    setNewPassword("");
    setNewRole(assignableRoles.find((r) => r.name === "Kassir")?.name ?? assignableRoles[0]?.name ?? "");
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    setFormError(null);
    try {
      await createEmployee.mutateAsync({
        phone: newPhone.trim(),
        password: newPassword,
        name: newName.trim() || undefined,
        role: newRole || undefined,
      });
      toast.success("Xodim qo'shildi");
      setCreateOpen(false);
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };

  const handleReset = async () => {
    if (!resetTarget) return;
    setFormError(null);
    try {
      await resetPassword.mutateAsync({ userId: resetTarget.id, newPassword: resetValue });
      toast.success("Parol almashtirildi. Xodimning barcha sessiyalari yopildi.");
      setResetTarget(null);
      setResetValue("");
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };

  const patchMember = async (employee: Employee, patch: MemberPatch, success: string) => {
    try {
      await updateMember.mutateAsync({ userId: employee.id, patch });
      toast.success(success);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">Xodimlar boshqaruvi</p>
          <p className="text-xs text-muted-foreground">
            {isOwner
              ? "Xodim loginini oching, rol bering va faollikni boshqaring"
              : "Xodimlarni faqat kompaniya egasi qo'sha va o'zgartira oladi"}
          </p>
        </div>
        {isOwner && (
          <Button size="sm" onClick={openCreate} className="shrink-0">
            <UserPlus className="h-4 w-4 mr-1.5" /> Yangi xodim
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Ism, telefon yoki rol..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {/* Users table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {employeesQuery.error ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            {employeesQuery.error.status === 403
              ? "Xodimlar ro'yxatini ko'rish uchun ruxsat yo'q"
              : errorMessage(employeesQuery.error)}
          </div>
        ) : !employees || !roles ? (
          <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Xodimlar topilmadi</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Xodim</th>
                <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium hidden md:table-cell">Filial</th>
                <th className="text-center px-4 py-3 text-xs text-muted-foreground font-medium">Rol</th>
                <th className="text-center px-4 py-3 text-xs text-muted-foreground font-medium">Holat</th>
                <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium hidden md:table-cell">So'nggi faollik</th>
                {isOwner && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((employee) => {
                const isSelf = employee.id === currentUser?.id;
                const locked = !isOwner || isSelf || FULL_ACCESS.has(employee.companyRole);
                const role = roles.find((r) => r.name === employee.companyRole);
                const active = employee.membershipActive && employee.isActive;
                return (
                  <tr key={employee.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center font-semibold text-primary text-sm">
                          {(employee.name ?? employee.phone)[0]?.toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium">
                            {employee.name ?? "—"}
                            {isSelf && <span className="ml-1.5 text-xs text-muted-foreground">(siz)</span>}
                          </p>
                          <p className="text-xs text-muted-foreground font-mono">{employee.phone}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs hidden md:table-cell">{employee.branchName ?? "—"}</td>
                    <td className="px-4 py-3">
                      <Select
                        value={employee.companyRole}
                        disabled={locked}
                        onValueChange={(val) => {
                          if (val !== employee.companyRole) {
                            void patchMember(employee, { role: val }, "Rol yangilandi");
                          }
                        }}
                      >
                        <SelectTrigger className="h-7 text-xs w-40 mx-auto">
                          <div className="flex items-center gap-1.5 truncate">
                            <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: role?.color ?? "#6366f1" }} />
                            <span className="truncate">{employee.companyRole}</span>
                          </div>
                        </SelectTrigger>
                        <SelectContent>
                          {assignableRoles.map((r) => (
                            <SelectItem key={r.id} value={r.name}>
                              <div className="flex items-center gap-2">
                                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: r.color ?? "#6366f1" }} />
                                {r.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        disabled={locked || updateMember.isPending}
                        onClick={() =>
                          void patchMember(
                            employee,
                            { isActive: !employee.membershipActive },
                            employee.membershipActive ? "Xodim kirishi yopildi" : "Xodim faollashtirildi",
                          )
                        }
                        className={cn(
                          "inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full",
                          locked ? "cursor-default" : "cursor-pointer",
                          active
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                            : "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
                        )}
                      >
                        {active ? <UserCheck className="h-3 w-3" /> : <UserX className="h-3 w-3" />}
                        {active ? "Faol" : "Bloklangan"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground text-xs hidden md:table-cell">
                      {employee.lastSeenAt ? new Date(employee.lastSeenAt).toLocaleDateString("uz-UZ") : "—"}
                    </td>
                    {isOwner && (
                      <td className="px-4 py-3 text-right">
                        {!locked && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() => { setFormError(null); setResetValue(""); setResetTarget(employee); }}
                          >
                            <KeyRound className="h-3 w-3 mr-1" /> Parol
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Yangi xodim */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Yangi xodim</DialogTitle>
            <DialogDescription>
              Telefon raqam login bo'ladi. Parolni xodimga o'zingiz yetkazasiz — u keyin
              Sozlamalar → Xavfsizlik bo'limida o'zgartiradi.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="+998901234567"
              value={newPhone}
              onChange={(e) => { setNewPhone(e.target.value); setFormError(null); }}
            />
            <Input placeholder="Ism (ixtiyoriy)" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <Input
              type="password"
              placeholder="Dastlabki parol"
              value={newPassword}
              onChange={(e) => { setNewPassword(e.target.value); setFormError(null); }}
            />
            <Select value={newRole} onValueChange={setNewRole}>
              <SelectTrigger>
                <SelectValue placeholder="Rol tanlang" />
              </SelectTrigger>
              <SelectContent>
                {assignableRoles.map((r) => (
                  <SelectItem key={r.id} value={r.name}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {formError && (
              <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {formError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Bekor</Button>
            <Button
              onClick={() => { void handleCreate(); }}
              disabled={createEmployee.isPending || !newPhone.trim() || !newPassword}
            >
              {createEmployee.isPending ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Yaratilmoqda</> : "Yaratish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Parolni tiklash */}
      <Dialog open={resetTarget !== null} onOpenChange={(o) => { if (!o) setResetTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Parolni almashtirish</DialogTitle>
            <DialogDescription>
              {resetTarget?.name ?? "Xodim"} ({resetTarget?.phone}) uchun yangi parol.
              Almashtirilgach barcha sessiyalari yopiladi.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              type="password"
              placeholder="Yangi parol"
              value={resetValue}
              onChange={(e) => { setResetValue(e.target.value); setFormError(null); }}
            />
            {formError && (
              <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {formError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setResetTarget(null)}>Bekor</Button>
            <Button onClick={() => { void handleReset(); }} disabled={resetPassword.isPending || !resetValue}>
              {resetPassword.isPending ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Saqlanmoqda</> : "Almashtirish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
