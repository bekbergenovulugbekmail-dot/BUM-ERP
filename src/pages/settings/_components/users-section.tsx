import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import { Search, UserCheck, UserX, Shield } from "lucide-react";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { cn } from "@/lib/utils.ts";
import type { Id } from "@/convex/_generated/dataModel.d.ts";

export default function UsersSection() {
  const [search, setSearch] = useState("");
  const roles = useQuery(api.admin.listRoles);
  const users = useQuery(api.admin.listUsers, { search: search || undefined });
  const updateUserRole = useMutation(api.admin.updateUserRole);
  const toggleActive = useMutation(api.admin.toggleUserActive);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">Foydalanuvchilar boshqaruvi</p>
          <p className="text-xs text-muted-foreground">Foydalanuvchilarga rol bering va faollikni boshqaring</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Ism yoki email..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {/* Users table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {!users || !roles ? (
          <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Foydalanuvchilar topilmadi</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Foydalanuvchi</th>
                <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium hidden md:table-cell">Email</th>
                <th className="text-center px-4 py-3 text-xs text-muted-foreground font-medium">Rol</th>
                <th className="text-center px-4 py-3 text-xs text-muted-foreground font-medium">Holat</th>
                <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium hidden md:table-cell">So'nggi faollik</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((user) => (
                <tr key={user._id} className="hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center font-semibold text-primary text-sm">
                        {(user.name ?? user.email ?? "?")[0].toUpperCase()}
                      </div>
                      <span className="font-medium">{user.name ?? "—"}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{user.email ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Select
                      value={user.roleId ?? "none"}
                      onValueChange={async (val) => {
                        if (val === "none") return;
                        try {
                          await updateUserRole({ userId: user._id, roleId: val as Id<"roles"> });
                          toast.success("Rol yangilandi");
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Xatolik");
                        }
                      }}
                    >
                      <SelectTrigger className="h-7 text-xs w-36">
                        {user.roleId ? (
                          <div className="flex items-center gap-1.5">
                            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: user.roleColor ?? "#6366f1" }} />
                            <span>{user.roleName}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">Rol yo'q</span>
                        )}
                      </SelectTrigger>
                      <SelectContent>
                        {roles.map((r) => (
                          <SelectItem key={r._id} value={r._id}>
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
                      onClick={async () => {
                        await toggleActive({ userId: user._id, isActive: !(user.isActive ?? true) });
                        toast.success(user.isActive ? "Bloklandi" : "Faollashtirildi");
                      }}
                      className={cn(
                        "inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full cursor-pointer",
                        user.isActive !== false ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
                      )}
                    >
                      {user.isActive !== false ? <UserCheck className="h-3 w-3" /> : <UserX className="h-3 w-3" />}
                      {user.isActive !== false ? "Faol" : "Bloklangan"}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground text-xs hidden md:table-cell">
                    {user.lastSeen ? new Date(user.lastSeen).toLocaleDateString("uz-UZ") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
