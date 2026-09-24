/**
 * Kompaniya rollari — `/api/company/roles` (boshqarish: `roles.manage`).
 *
 * Server qoidalari UI'da ham aks etadi:
 *  - Superadmin / Business Owner — to'liq huquqli, tahrirlanmaydi
 *  - tizim rolining nomi o'zgarmaydi va o'chirilmaydi
 *  - faqat o'zingizda bor ruxsatni bera olasiz (aks holda server xabari)
 * Standart rollar kompaniya yaratilganda serverda qo'shiladi — "Standart rollar" tugmasi kerak emas.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Edit2, Trash2, Shield, Check, Lock } from "lucide-react";
import {
  ALL_PERMISSIONS,
  FULL_ACCESS_ROLES,
  PERMISSIONS,
  isPermission,
  isResponsibleScopable,
  sanitizeRoleScopes,
  type Permission,
  type RoleScopes,
} from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { cn } from "@/lib/utils.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import type { CompanyRole } from "../_lib/types.ts";

type RoleFormData = {
  name: string;
  description: string;
  color: string;
  permissions: Permission[];
  /** "Mas'ul bo'lganlari" chegarasi qo'yilgan ruxsatlar. */
  scopes: RoleScopes;
};

type RoleBody = {
  name?: string;
  description: string | null;
  color: string | null;
  permissions: Permission[];
  scopes: RoleScopes;
};

const COLORS = ["#6366f1", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#ef4444", "#94a3b8"];
const FULL_ACCESS = new Set<string>(FULL_ACCESS_ROLES);
const COMPANY = ["/api/company"];

const groupedPermissions = ALL_PERMISSIONS.reduce<Record<string, Permission[]>>((acc, p) => {
  const group = PERMISSIONS[p].group;
  if (!acc[group]) acc[group] = [];
  acc[group].push(p);
  return acc;
}, {});

const EMPTY_FORM: RoleFormData = { name: "", description: "", color: "#6366f1", permissions: [], scopes: {} };

export default function RolesSection() {
  const { data, error } = useApiQuery<{ roles: CompanyRole[] }>("/api/company/roles");
  const roles = data?.roles;
  const { can } = usePermissions();
  const canManage = can("roles.manage");

  const createRole = useApiMutation((body: RoleBody) => api.post("/api/company/roles", body), { invalidate: COMPANY });
  const updateRole = useApiMutation(
    ({ id, body }: { id: string; body: RoleBody }) => api.patch(`/api/company/roles/${id}`, body),
    { invalidate: COMPANY },
  );
  const deleteRole = useApiMutation((id: string) => api.delete(`/api/company/roles/${id}`), { invalidate: COMPANY });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CompanyRole | null>(null);
  const [form, setForm] = useState<RoleFormData>(EMPTY_FORM);

  const handleOpen = (role?: CompanyRole) => {
    if (role) {
      setEditing(role);
      setForm({
        name: role.name,
        description: role.description ?? "",
        color: role.color ?? "#6366f1",
        permissions: role.permissions.filter(isPermission),
        scopes: sanitizeRoleScopes(role.scopes),
      });
    } else {
      setEditing(null);
      setForm(EMPTY_FORM);
    }
    setOpen(true);
  };

  const toggleScope = (p: Permission) =>
    setForm((f) => {
      const next = { ...f.scopes };
      if (next[p as keyof RoleScopes]) delete next[p as keyof RoleScopes];
      else Object.assign(next, { [p]: "responsible" });
      return { ...f, scopes: next };
    });

  const togglePermission = (p: Permission) => {
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(p) ? f.permissions.filter((x) => x !== p) : [...f.permissions, p],
    }));
  };

  const toggleGroup = (group: string) => {
    const groupPerms = groupedPermissions[group] ?? [];
    const allSelected = groupPerms.every((p) => form.permissions.includes(p));
    setForm((f) => ({
      ...f,
      permissions: allSelected
        ? f.permissions.filter((p) => !groupPerms.includes(p))
        : [...new Set([...f.permissions, ...groupPerms])],
    }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error("Rol nomi kiritilishi shart");
    if (form.permissions.length === 0) return toast.error("Kamida bitta ruxsat tanlang");
    const body: RoleBody = {
      description: form.description.trim() || null,
      color: form.color || null,
      permissions: form.permissions,
      // Ruxsat olib tashlansa chegarasi ham ketadi — "yetim" chegara qolmaydi
      scopes: sanitizeRoleScopes(
        Object.fromEntries(Object.entries(form.scopes).filter(([key]) => form.permissions.includes(key as Permission))),
      ),
    };
    try {
      if (editing) {
        // Tizim rolining nomini server o'zgartirmaydi — yuborilmaydi
        await updateRole.mutateAsync({
          id: editing.id,
          body: editing.isSystem ? body : { ...body, name: form.name.trim() },
        });
        toast.success("Rol yangilandi");
      } else {
        await createRole.mutateAsync({ ...body, name: form.name.trim() });
        toast.success("Rol yaratildi");
      }
      setOpen(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const handleDelete = async (role: CompanyRole) => {
    if (role.isSystem) return toast.error("Tizim rollarini o'chirish mumkin emas");
    if (!window.confirm(`"${role.name}" rolini o'chirasizmi?`)) return;
    try {
      await deleteRole.mutateAsync(role.id);
      toast.success("Rol o'chirildi");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const saving = createRole.isPending || updateRole.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">Rollar va ruxsatlar</p>
          <p className="text-xs text-muted-foreground">Har bir rol uchun granular ruxsatlar sozlang</p>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => handleOpen()}>
            <Plus className="h-4 w-4 mr-1" /> Yangi rol
          </Button>
        )}
      </div>

      {error ? (
        <div className="bg-card border border-border rounded-2xl p-8 text-center text-muted-foreground text-sm">
          {errorMessage(error)}
        </div>
      ) : !roles ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {roles.map((role) => {
            const fullAccess = FULL_ACCESS.has(role.name);
            return (
              <div key={role.id} className="bg-card border border-border rounded-2xl p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: (role.color ?? "#6366f1") + "20" }}>
                      <Shield className="h-4 w-4" style={{ color: role.color ?? "#6366f1" }} />
                    </div>
                    <div>
                      <p className="font-semibold text-sm">{role.name}</p>
                      <p className="text-xs text-muted-foreground">{role.description}</p>
                    </div>
                  </div>
                  {canManage && !fullAccess && (
                    <div className="flex gap-1">
                      <button onClick={() => handleOpen(role)} className="p-1.5 rounded-lg hover:bg-accent cursor-pointer">
                        <Edit2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                      {!role.isSystem && (
                        <button onClick={() => { void handleDelete(role); }} className="p-1.5 rounded-lg hover:bg-destructive/10 cursor-pointer">
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </button>
                      )}
                    </div>
                  )}
                  {fullAccess && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                  <span className="bg-muted px-2 py-0.5 rounded-full">
                    {fullAccess ? "To'liq huquq" : `${role.permissions.length} ruxsat`}
                  </span>
                  <span className="bg-muted px-2 py-0.5 rounded-full">{role.memberCount} foydalanuvchi</span>
                  {role.isSystem && <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full">Tizim</span>}
                  {!role.isActive && <span className="bg-destructive/10 text-destructive px-2 py-0.5 rounded-full">Nofaol</span>}
                </div>
                {/* Permission preview chips */}
                <div className="flex flex-wrap gap-1">
                  {role.permissions.slice(0, 5).map((p) => (
                    <span key={p} className="text-[10px] px-1.5 py-0.5 bg-muted rounded-full text-muted-foreground">{p}</span>
                  ))}
                  {role.permissions.length > 5 && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-muted rounded-full text-muted-foreground">+{role.permissions.length - 5}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Role dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Rolni tahrirlash" : "Yangi rol yaratish"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">Rol nomi *</label>
                <Input
                  value={form.name}
                  disabled={editing?.isSystem}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Menejer"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Tavsif</label>
                <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Rol tavsifi" />
              </div>
            </div>
            {/* Color picker */}
            <div className="space-y-1">
              <label className="text-xs font-medium">Rang</label>
              <div className="flex gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setForm((f) => ({ ...f, color: c }))}
                    className={cn("h-7 w-7 rounded-full border-2 cursor-pointer", form.color === c ? "border-foreground scale-110" : "border-transparent")}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>

            {/* Permissions */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium">Ruxsatlar ({form.permissions.length}/{ALL_PERMISSIONS.length})</label>
                <div className="flex gap-2">
                  <button className="text-xs text-primary cursor-pointer" onClick={() => setForm((f) => ({ ...f, permissions: [...ALL_PERMISSIONS] }))}>Barchasi</button>
                  <button className="text-xs text-muted-foreground cursor-pointer" onClick={() => setForm((f) => ({ ...f, permissions: [] }))}>Tozalash</button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Faqat o'zingizda bor ruxsatlarni boshqa rolga bera olasiz.
              </p>
              {Object.entries(groupedPermissions).map(([group, perms]) => {
                const allSelected = perms.every((p) => form.permissions.includes(p));
                const someSelected = perms.some((p) => form.permissions.includes(p));
                return (
                  <div key={group} className="border border-border rounded-xl overflow-hidden">
                    <button
                      onClick={() => toggleGroup(group)}
                      className={cn("w-full flex items-center justify-between px-3 py-2 text-xs font-medium cursor-pointer hover:bg-accent/50", allSelected ? "bg-primary/10" : someSelected ? "bg-muted/50" : "")}
                    >
                      <span>{group}</span>
                      <span className="text-muted-foreground">{perms.filter((p) => form.permissions.includes(p)).length}/{perms.length}</span>
                    </button>
                    <div className="grid grid-cols-2 gap-1 p-2">
                      {perms.map((p) => {
                        const selected = form.permissions.includes(p);
                        return (
                          <button
                            key={p}
                            onClick={() => togglePermission(p)}
                            className={cn(
                              "flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs cursor-pointer transition-colors",
                              selected ? "bg-primary/15 text-primary" : "hover:bg-accent text-muted-foreground"
                            )}
                          >
                            <div className={cn("h-3.5 w-3.5 rounded border flex items-center justify-center flex-shrink-0", selected ? "bg-primary border-primary" : "border-border")}>
                              {selected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                            </div>
                            {PERMISSIONS[p].label}
                          </button>
                        );
                      })}
                      {/*
                        Mas'uliyat chegarasi — faqat ma'noga ega ruxsatlarda va faqat ruxsat
                        tanlangan bo'lsa. Yoqilsa xodim o'ziga biriktirilganini ko'radi.
                      */}
                      {perms.filter((p) => isResponsibleScopable(p) && form.permissions.includes(p)).map((p) => (
                        <button
                          key={`${p}-scope`}
                          onClick={() => toggleScope(p)}
                          className={cn(
                            "col-span-2 flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors cursor-pointer",
                            form.scopes[p] === "responsible" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "text-muted-foreground hover:bg-accent",
                          )}
                        >
                          <div className={cn(
                            "flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded border",
                            form.scopes[p] === "responsible" ? "border-amber-500 bg-amber-500" : "border-border",
                          )}>
                            {form.scopes[p] === "responsible" && <Check className="h-2.5 w-2.5 text-white" />}
                          </div>
                          <span className="truncate">
                            {PERMISSIONS[p].label} — faqat mas&apos;ul bo&apos;lganlari
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>Bekor qilish</Button>
              <Button onClick={() => { void handleSave(); }} disabled={saving}>
                {saving ? "Saqlanmoqda..." : "Saqlash"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
