/**
 * Kompaniya xodimlari — `/api/company/employees`.
 *
 * Bu sahifa FOYDALANUVCHI (login, rol, litsenziya, kirish) bilan ishlaydi. Yangi XODIM bu yerda
 * ochilmaydi — u faqat Kadrlar → "Xodim qo'shish" da yaratiladi; bu yerda mavjud xodimga login beriladi.
 *
 * Ko'rish — `users.view`. Foydalanuvchi qo'shish, tahrirlash (ism, telefon, rol, filial, omborlar,
 * mas'ul kategoriyalar), holat va parol — faqat kompaniya egasi (server ham tekshiradi).
 * To'liq huquqli rollar (Superadmin, Business Owner) tanlovda yo'q — o'z huquqini oshirib bo'lmaydi.
 *
 * Rol xodim NIMA qila olishini (ko'rish / qo'shish / o'zgartirish), omborlar va mas'ul
 * kategoriyalar esa QAYSI ma'lumotlar bilan ishlashini belgilaydi.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Search, UserCheck, UserX, UserPlus, KeyRound, Loader2, AlertTriangle, Pencil, Smartphone, Trash2 } from "lucide-react";
import { FULL_ACCESS_ROLES } from "@bum/shared";
import { Input } from "@/components/ui/input.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog.tsx";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog.tsx";
import { cn } from "@/lib/utils.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { useCurrentUser } from "@/hooks/use-auth.ts";
import { useActiveCompany } from "@/hooks/use-company.ts";
import AdditionalLicensePicker from "@/components/subscription/additional-license-picker.tsx";
import AddUserDialog from "@/components/company/add-user-dialog.tsx";
import UserDevicesDialog from "./user-devices-dialog.tsx";
import { LICENSE_STATUS_LABEL, LICENSE_TYPE_LABEL, formatDay, licenseLimitOf } from "@/lib/subscription.ts";
import type { Branch, CompanyRole, Employee } from "../_lib/types.ts";

const FULL_ACCESS = new Set<string>(FULL_ACCESS_ROLES);
const COMPANY = ["/api/company"];
const NO_BRANCH = "__none__";

type MemberPatch = {
  name?: string | null;
  phone?: string;
  role?: string;
  branchId?: string | null;
  allowedWarehouseIds?: string[];
  allowedCategoryIds?: string[];
  isActive?: boolean;
  /** Qurilma tasdig'i shu xodimga qo'llanadimi. */
  deviceCheck?: boolean;
  /** Qayta yoqishda included litsenziya tugagan bo'lsa — qo'shimcha litsenziya tarifi. */
  additionalLicensePlanId?: string;
};

type WarehouseOption = { id: string; name: string; isActive: boolean };
type CategoryOption = { id: string; name: string; parentId: string | null; isActive: boolean };

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((id) => set.has(id));
}

/** Kategoriyalar daraxt tartibida (ota → ichki), chuqurlik bilan. */
function orderCategories(categories: CategoryOption[]) {
  const ids = new Set(categories.map((c) => c.id));
  const byParent = new Map<string | null, CategoryOption[]>();
  for (const category of categories) {
    const parent = category.parentId && ids.has(category.parentId) ? category.parentId : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), category]);
  }
  const ordered: { category: CategoryOption; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const category of byParent.get(parent) ?? []) {
      ordered.push({ category, depth });
      if (depth < 20) walk(category.id, depth + 1);
    }
  };
  walk(null, 0);
  return ordered;
}

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
  /** Kompaniyadan butunlay chiqarish: a'zolik o'chadi, hisob va tarix qoladi. */
  const removeMember = useApiMutation(
    (userId: string) => api.delete<{ unlinkedEmployee: boolean }>(`/api/company/employees/${userId}`),
    { invalidate: COMPANY },
  );
  const [removeTarget, setRemoveTarget] = useState<Employee | null>(null);
  const resetPassword = useApiMutation(
    ({ userId, newPassword }: { userId: string; newPassword: string }) =>
      api.post(`/api/company/employees/${userId}/password`, { newPassword }),
    { invalidate: false },
  );

  // Yangi foydalanuvchi oynasi (umumiy komponent — Obuna sahifasida ham ishlatiladi)
  const [createOpen, setCreateOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Qayta yoqishda included litsenziya tugagan bo'lsa — qo'shimcha litsenziya tarifi tanlanadi
  const [reactivate, setReactivate] = useState<{ employee: Employee; limit: NonNullable<ReturnType<typeof licenseLimitOf>> } | null>(null);

  // Tahrirlash va parol tiklash dialoglari
  const [editTarget, setEditTarget] = useState<Employee | null>(null);
  const [resetTarget, setResetTarget] = useState<Employee | null>(null);
  /** Kimning qurilmalari ochilgan (yangi qurilmani egasi tasdiqlaydi). */
  const [deviceTarget, setDeviceTarget] = useState<Employee | null>(null);
  const [resetValue, setResetValue] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees ?? [];
    return (employees ?? []).filter(
      (e) => (e.name ?? "").toLowerCase().includes(q) || e.phone.includes(q) || e.companyRole.toLowerCase().includes(q),
    );
  }, [employees, search]);


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

  const handleRemove = async () => {
    if (!removeTarget) return;
    try {
      const result = await removeMember.mutateAsync(removeTarget.id);
      toast.success(
        result.unlinkedEmployee
          ? "Foydalanuvchi kompaniyadan chiqarildi — Kadrlar kartochkasi saqlanib qoldi"
          : "Foydalanuvchi kompaniyadan chiqarildi",
      );
      setRemoveTarget(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const patchMember = async (employee: Employee, patch: MemberPatch, success: string) => {
    try {
      await updateMember.mutateAsync({ userId: employee.id, patch });
      toast.success(success);
      setReactivate(null);
    } catch (err) {
      const reached = patch.isActive ? licenseLimitOf(err) : null;
      if (reached) setReactivate({ employee, limit: reached });
      else toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">Xodimlar boshqaruvi</p>
          <p className="text-xs text-muted-foreground">
            {isOwner
              ? "Xodim shu yerdan qo'shiladi — kassir, savdo agenti, yetkazuvchi yoki dasturga kirmaydigan xodim"
              : "Xodimlarni faqat kompaniya egasi qo'sha va o'zgartira oladi"}
          </p>
        </div>
        {isOwner && (
          <Button size="sm" onClick={() => setCreateOpen(true)} className="shrink-0">
            <UserPlus className="h-4 w-4 mr-1.5" /> Foydalanuvchi qo'shish
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/30 border-b border-border">
                  <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Xodim</th>
                  <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium hidden md:table-cell">Filial</th>
                  <th className="text-center px-4 py-3 text-xs text-muted-foreground font-medium">Rol</th>
                  <th className="text-center px-4 py-3 text-xs text-muted-foreground font-medium">Holat</th>
                  <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium hidden lg:table-cell">Litsenziya</th>
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
                  const scoped = (employee.allowedCategoryIds ?? []).length;
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
                            <p className="text-xs text-muted-foreground">
                              <span className="font-mono">{employee.phone}</span>
                              {scoped > 0 && <span> · {scoped} ta mas'ul kategoriya</span>}
                            </p>
                            {/* Foydalanuvchi qaysi Kadrlar kartochkasiga bog'langan */}
                            <p className="text-xs">
                              {employee.employeeId ? (
                                <span className="text-muted-foreground">
                                  Xodim: <span className="text-foreground">{employee.employeeName}</span>
                                  {employee.employeeCode ? <span className="font-mono"> · {employee.employeeCode}</span> : null}
                                </span>
                              ) : (
                                <span className="text-amber-700 dark:text-amber-400">Xodim biriktirilmagan</span>
                              )}
                            </p>
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
                          {/* popper: trigger'da SelectValue yo'q — "item-aligned" joylashuv ro'yxatni ko'rsatmasdi */}
                          <SelectContent position="popper">
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
                      <td className="px-4 py-3 text-xs hidden lg:table-cell">
                        {employee.licenseType && employee.licenseStatus ? (
                          <span>
                            {LICENSE_TYPE_LABEL[employee.licenseType]} ·{" "}
                            <span className={employee.licenseStatus === "active" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
                              {LICENSE_STATUS_LABEL[employee.licenseStatus]}
                            </span>
                            {employee.licenseType === "additional" && employee.licenseExpiresAt ? ` · ${formatDay(employee.licenseExpiresAt)}` : ""}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground text-xs hidden md:table-cell">
                        {employee.lastSeenAt ? new Date(employee.lastSeenAt).toLocaleDateString("uz-UZ") : "—"}
                      </td>
                      {isOwner && (
                        <td className="px-4 py-3 text-right">
                          {!locked && (
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditTarget(employee)}>
                                <Pencil className="h-3 w-3 mr-1" /> Tahrirlash
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs"
                                onClick={() => { setFormError(null); setResetValue(""); setResetTarget(employee); }}
                              >
                                <KeyRound className="h-3 w-3 mr-1" /> Parol
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs"
                                data-testid={`devices-${employee.id}`}
                                onClick={() => setDeviceTarget(employee)}
                              >
                                <Smartphone className="h-3 w-3 mr-1" /> Qurilmalar
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs text-destructive"
                                data-testid={`remove-user-${employee.id}`}
                                onClick={() => setRemoveTarget(employee)}
                              >
                                <Trash2 className="h-3 w-3 mr-1" /> O'chirish
                              </Button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Kompaniyadan chiqarish tasdig'i */}
      <AlertDialog open={removeTarget !== null} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Foydalanuvchini kompaniyadan chiqarish</AlertDialogTitle>
            <AlertDialogDescription>
              <b>{removeTarget?.name ?? removeTarget?.phone}</b> ro'yxatdan o'chiriladi va dasturga kira
              olmaydi; litsenziyasi bo'shaydi. Uning hujjatlari va tarixi joyida qoladi
              {removeTarget?.employeeId ? ", Kadrlar kartochkasi ham saqlanadi (faqat login bog'lanishi uziladi)" : ""}.
              Kerak bo'lsa keyin qaytadan "Foydalanuvchi qo'shish" bilan kirish berasiz.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMember.isPending}>Bekor qilish</AlertDialogCancel>
            <AlertDialogAction
              data-testid="remove-user-confirm"
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={removeMember.isPending}
              onClick={(event) => { event.preventDefault(); void handleRemove(); }}
            >
              {removeMember.isPending ? "O'chirilmoqda..." : "Chiqarish"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Xodimni tahrirlash */}
      {editTarget && (
        <EditEmployeeDialog
          key={editTarget.id}
          employee={editTarget}
          roles={assignableRoles}
          onClose={() => setEditTarget(null)}
        />
      )}

      {deviceTarget && (
        <UserDevicesDialog
          userId={deviceTarget.id}
          userName={deviceTarget.name ?? deviceTarget.phone}
          onClose={() => setDeviceTarget(null)}
        />
      )}

      {/* MAVJUD xodimga login berish — yangi xodim faqat Kadrlar bo'limida ochiladi */}
      <AddUserDialog open={createOpen} onClose={() => setCreateOpen(false)} />

      {/* Qayta yoqish — litsenziya tugagan */}
      <Dialog open={reactivate !== null} onOpenChange={(o) => { if (!o) setReactivate(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Litsenziya kerak</DialogTitle>
            <DialogDescription>{reactivate?.limit.message}</DialogDescription>
          </DialogHeader>
          {reactivate && (
            <AdditionalLicensePicker
              counts={reactivate.limit.counts}
              pending={updateMember.isPending}
              onSelect={(planId) => {
                void patchMember(reactivate.employee, { isActive: true, additionalLicensePlanId: planId }, "Xodim faollashtirildi — litsenziya to'lovi kutilmoqda");
              }}
            />
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setReactivate(null)}>Bekor</Button>
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
            {formError && <ErrorBanner message={formError} />}
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

// ─── Xodimni tahrirlash ───────────────────────────────────────────────────────

function EditEmployeeDialog({
  employee,
  roles,
  onClose,
}: {
  employee: Employee;
  roles: CompanyRole[];
  onClose: () => void;
}) {
  const branches = useApiQuery<{ branches: Branch[] }>("/api/company/branches").data?.branches;
  const warehouses = useApiQuery<{ warehouses: WarehouseOption[] }>("/api/inventory/warehouses").data?.warehouses;
  const categories = useApiQuery<{ categories: CategoryOption[] }>("/api/catalog/categories", { includeInactive: true })
    .data?.categories;

  const [name, setName] = useState(employee.name ?? "");
  const [phone, setPhone] = useState(employee.phone);
  const [role, setRole] = useState(employee.companyRole);
  const [branchId, setBranchId] = useState(employee.branchId ?? NO_BRANCH);
  const [warehouseIds, setWarehouseIds] = useState<string[]>(employee.allowedWarehouseIds);
  const [categoryIds, setCategoryIds] = useState<string[]>(employee.allowedCategoryIds ?? []);
  const [deviceCheck, setDeviceCheck] = useState(employee.deviceCheck !== false);
  const [error, setError] = useState<string | null>(null);

  const update = useApiMutation(
    (patch: MemberPatch) => api.patch(`/api/company/employees/${employee.id}`, patch),
    { invalidate: COMPANY },
  );

  // Joriy rol tanlovda bo'lmasa (masalan faolsizlantirilgan) ham ko'rinib tursin
  const roleOptions = roles.some((r) => r.name === employee.companyRole)
    ? roles
    : [{ id: "__current__", name: employee.companyRole } as CompanyRole, ...roles];
  const orderedCategories = useMemo(() => orderCategories(categories ?? []), [categories]);

  const toggle = (list: string[], id: string, on: boolean) =>
    on ? [...new Set([...list, id])] : list.filter((x) => x !== id);

  const handleSave = async () => {
    const patch: MemberPatch = {};
    const trimmedName = name.trim();
    if (trimmedName !== (employee.name ?? "")) patch.name = trimmedName || null;
    if (phone.trim() !== employee.phone) patch.phone = phone.trim();
    if (role !== employee.companyRole) patch.role = role;
    const nextBranch = branchId === NO_BRANCH ? null : branchId;
    if (nextBranch !== employee.branchId) patch.branchId = nextBranch;
    if (!sameIds(warehouseIds, employee.allowedWarehouseIds)) patch.allowedWarehouseIds = warehouseIds;
    if (!sameIds(categoryIds, employee.allowedCategoryIds ?? [])) patch.allowedCategoryIds = categoryIds;
    if (deviceCheck !== (employee.deviceCheck !== false)) patch.deviceCheck = deviceCheck;

    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setError(null);
    try {
      await update.mutateAsync(patch);
      toast.success(
        patch.phone
          ? "Saqlandi. Telefon o'zgargani uchun xodim yangi raqam bilan qayta kiradi."
          : "Xodim ma'lumotlari saqlandi",
      );
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Xodimni tahrirlash</DialogTitle>
          <DialogDescription>
            Rol xodim nima qila olishini, omborlar va mas'ul kategoriyalar esa qaysi ma'lumotlar bilan
            ishlashini belgilaydi.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Ism</Label>
              <Input id="edit-name" value={name} onChange={(e) => { setName(e.target.value); setError(null); }} placeholder="Ism familiya" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-phone">Telefon (login)</Label>
              <Input
                id="edit-phone"
                type="tel"
                value={phone}
                onChange={(e) => { setPhone(e.target.value); setError(null); }}
                placeholder="+998901234567"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Rol</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Rol tanlang" />
                </SelectTrigger>
                <SelectContent position="popper">
                  {roleOptions.map((r) => (
                    <SelectItem key={r.id} value={r.name}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Filial</Label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value={NO_BRANCH}>Biriktirilmagan</SelectItem>
                  {(branches ?? [])
                    .filter((b) => b.isActive || b.id === employee.branchId)
                    .map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-start justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
            <div className="min-w-0">
              <Label htmlFor="edit-device-check" className="cursor-pointer text-sm font-medium">Qurilma tasdig'i</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Yoqilgan bo'lsa xodim yangi qurilmadan kirganda siz tasdiqlashingiz kerak.
              </p>
            </div>
            <Switch id="edit-device-check" checked={deviceCheck} onCheckedChange={setDeviceCheck} />
          </div>

          <CheckList
            title="Ruxsat etilgan omborlar"
            hint="Hech biri tanlanmasa — barcha omborlar."
            loading={!warehouses}
            items={(warehouses ?? []).map((w) => ({ id: w.id, label: w.name, depth: 0 }))}
            selected={warehouseIds}
            onToggle={(id, on) => setWarehouseIds((list) => toggle(list, id, on))}
          />

          <CheckList
            title="Mas'ul kategoriyalar"
            hint="Hech biri tanlanmasa — barcha kategoriyalar. Tanlangan kategoriyaning ichki kategoriyalari ham kiradi; mahsulot, ombor, xarid va sotuvda xodim faqat shu mahsulotlar bilan ishlaydi."
            loading={!categories}
            items={orderedCategories.map(({ category, depth }) => ({
              id: category.id,
              label: category.isActive ? category.name : `${category.name} (faol emas)`,
              depth,
            }))}
            selected={categoryIds}
            onToggle={(id, on) => setCategoryIds((list) => toggle(list, id, on))}
          />

          {error && <ErrorBanner message={error} />}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Bekor</Button>
          <Button onClick={() => { void handleSave(); }} disabled={update.isPending || !phone.trim() || !role}>
            {update.isPending ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Saqlanmoqda</> : "Saqlash"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CheckList({
  title,
  hint,
  loading,
  items,
  selected,
  onToggle,
}: {
  title: string;
  hint: string;
  loading: boolean;
  items: { id: string; label: string; depth: number }[];
  selected: string[];
  onToggle: (id: string, on: boolean) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label>{title}</Label>
        <span className="text-xs text-muted-foreground">
          {selected.length === 0 ? "Hammasi" : `${selected.length} ta tanlangan`}
        </span>
      </div>
      <div className="max-h-44 overflow-y-auto rounded-lg border border-border p-1.5 space-y-0.5">
        {loading ? (
          <div className="space-y-1 p-1">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-2/3" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground px-2 py-1.5">Ro'yxat bo'sh</p>
        ) : (
          items.map((item) => (
            <label
              key={item.id}
              className="flex items-center gap-2 text-sm rounded-md py-1.5 pr-2 hover:bg-muted/50 cursor-pointer"
              style={{ paddingLeft: `${8 + item.depth * 16}px` }}
            >
              <Checkbox checked={selected.includes(item.id)} onCheckedChange={(value) => onToggle(item.id, value === true)} />
              <span className="truncate">{item.label}</span>
            </label>
          ))
        )}
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      {message}
    </div>
  );
}
