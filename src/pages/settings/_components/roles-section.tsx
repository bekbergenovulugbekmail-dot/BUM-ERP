import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import { Plus, Edit2, Trash2, Shield, Check } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { PERMISSIONS, ALL_PERMISSIONS } from "@/lib/permissions.ts";
import type { Permission } from "@/lib/permissions.ts";
import { cn } from "@/lib/utils.ts";
import type { Id } from "@/convex/_generated/dataModel.d.ts";

type RoleFormData = {
  name: string;
  description: string;
  color: string;
  permissions: Permission[];
};

const COLORS = ["#6366f1", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#ef4444", "#94a3b8"];

const groupedPermissions = ALL_PERMISSIONS.reduce<Record<string, Permission[]>>((acc, p) => {
  const group = PERMISSIONS[p].group;
  if (!acc[group]) acc[group] = [];
  acc[group].push(p);
  return acc;
}, {});

export default function RolesSection() {
  const roles = useQuery(api.admin.listRoles);
  const seedDefaultRoles = useMutation(api.admin.seedDefaultRoles);
  const createRole = useMutation(api.admin.createRole);
  const updateRole = useMutation(api.admin.updateRole);
  const deleteRole = useMutation(api.admin.deleteRole);

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<Id<"roles"> | null>(null);
  const [form, setForm] = useState<RoleFormData>({ name: "", description: "", color: "#6366f1", permissions: [] });

  const handleOpen = (role?: { _id: Id<"roles">; name: string; description?: string; color?: string; permissions: string[] }) => {
    if (role) {
      setEditId(role._id);
      setForm({ name: role.name, description: role.description ?? "", color: role.color ?? "#6366f1", permissions: role.permissions as Permission[] });
    } else {
      setEditId(null);
      setForm({ name: "", description: "", color: "#6366f1", permissions: [] });
    }
    setOpen(true);
  };

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
    try {
      if (editId) {
        await updateRole({ id: editId, ...form });
        toast.success("Rol yangilandi");
      } else {
        await createRole(form);
        toast.success("Rol yaratildi");
      }
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Xatolik");
    }
  };

  const handleDelete = async (id: Id<"roles">, isSystem: boolean) => {
    if (isSystem) return toast.error("Tizim rollarini o'chirish mumkin emas");
    try {
      await deleteRole({ id });
      toast.success("Rol o'chirildi");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Xatolik");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">Rollar va ruxsatlar</p>
          <p className="text-xs text-muted-foreground">Har bir rol uchun granular ruxsatlar sozlang</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => seedDefaultRoles()}>
            Standart rollar
          </Button>
          <Button size="sm" onClick={() => handleOpen()}>
            <Plus className="h-4 w-4 mr-1" /> Yangi rol
          </Button>
        </div>
      </div>

      {!roles ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {roles.map((role) => (
            <div key={role._id} className="bg-card border border-border rounded-2xl p-4 space-y-3">
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
                <div className="flex gap-1">
                  <button onClick={() => handleOpen(role)} className="p-1.5 rounded-lg hover:bg-accent cursor-pointer">
                    <Edit2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                  {!role.isSystem && (
                    <button onClick={() => handleDelete(role._id, role.isSystem)} className="p-1.5 rounded-lg hover:bg-destructive/10 cursor-pointer">
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="bg-muted px-2 py-0.5 rounded-full">{role.permissions.length} ruxsat</span>
                <span className="bg-muted px-2 py-0.5 rounded-full">{role.memberCount} foydalanuvchi</span>
                {role.isSystem && <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full">Tizim</span>}
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
          ))}
        </div>
      )}

      {/* Role dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Rolni tahrirlash" : "Yangi rol yaratish"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">Rol nomi *</label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Menejer" />
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
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>Bekor qilish</Button>
              <Button onClick={handleSave}>Saqlash</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
