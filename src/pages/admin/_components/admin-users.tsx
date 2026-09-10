/**
 * Admin Users — all registered platform users
 */
import { useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel";
import { ConvexError } from "convex/values";
import { toast } from "sonner";
import {
  Search, Shield, ShieldOff, User, Building2,
  Phone, KeyRound, Info, UserPlus, Loader2, AlertTriangle,
} from "lucide-react";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog.tsx";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog.tsx";
import { format } from "date-fns";

export default function AdminUsers() {
  const [search, setSearch] = useState("");
  const [revokeTarget, setRevokeTarget] = useState<{ id: Id<"users">; name: string } | null>(null);
  const [busyId, setBusyId] = useState<Id<"users"> | null>(null);

  const users = useQuery(api.companies.platformListAllUsers);
  const currentUser = useQuery(api.users.getCurrentUser);
  const grantAdmin = useMutation(api.companies.platformGrantAdmin);
  const revokeAdmin = useMutation(api.companies.platformRevokeAdmin);
  const createUserAccount = useAction(api.userAdmin.createUserAccount);
  const resetUserPassword = useAction(api.userAdmin.resetUserPassword);

  // Yangi foydalanuvchi dialogi
  const [createOpen, setCreateOpen] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Parol tiklash dialogi
  const [resetTarget, setResetTarget] = useState<{ phone: string; name: string } | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  const errMessage = (err: unknown) =>
    err instanceof ConvexError
      ? (err.data as { message?: string }).message ?? "Xatolik yuz berdi"
      : "Xatolik yuz berdi";

  const handleCreate = async () => {
    setFormBusy(true);
    setFormError(null);
    try {
      const res = await createUserAccount({
        phone: newPhone.trim(),
        password: newPassword,
        name: newName.trim() || undefined,
      });
      toast.success(`Foydalanuvchi yaratildi: ${res.phone}`);
      setCreateOpen(false);
      setNewPhone("");
      setNewName("");
      setNewPassword("");
    } catch (err) {
      setFormError(errMessage(err));
    } finally {
      setFormBusy(false);
    }
  };

  const handleReset = async () => {
    if (!resetTarget) return;
    setFormBusy(true);
    setFormError(null);
    try {
      await resetUserPassword({ phone: resetTarget.phone, newPassword: resetPassword });
      toast.success("Parol almashtirildi. Foydalanuvchi qayta kirishi kerak.");
      setResetTarget(null);
      setResetPassword("");
    } catch (err) {
      setFormError(errMessage(err));
    } finally {
      setFormBusy(false);
    }
  };

  const filtered = (users ?? []).filter((u) => {
    if (!search) return true;
    return (
      (u.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (u.email ?? "").toLowerCase().includes(search.toLowerCase())
    );
  });

  const handleGrant = async (userId: Id<"users">) => {
    setBusyId(userId);
    try {
      await grantAdmin({ userId });
      toast.success("Admin huquqlari berildi");
    } catch (err) {
      const message =
        err instanceof ConvexError
          ? (err.data as { message?: string }).message ?? "Xatolik yuz berdi"
          : "Xatolik yuz berdi";
      toast.error(message);
    } finally {
      setBusyId(null);
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    setBusyId(revokeTarget.id);
    try {
      await revokeAdmin({ userId: revokeTarget.id });
      toast.success("Admin huquqlari olindi");
    } catch (err) {
      const message =
        err instanceof ConvexError
          ? (err.data as { message?: string }).message ?? "Xatolik yuz berdi"
          : "Xatolik yuz berdi";
      toast.error(message);
    } finally {
      setBusyId(null);
      setRevokeTarget(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Foydalanuvchilar</h1>
          <p className="text-sm text-white/40 mt-0.5">
            {users ? `${users.length} ta ro'yxatdan o'tgan` : "Yuklanmoqda..."}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => { setFormError(null); setCreateOpen(true); }}
          className="shrink-0"
        >
          <UserPlus className="h-4 w-4 mr-1.5" /> Yangi foydalanuvchi
        </Button>
      </div>

      {/* Password reset notice */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-500/8 border border-blue-500/20">
        <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
        <div className="text-xs text-blue-300/80 space-y-1">
          <p className="font-semibold text-blue-300">Parol tiklash haqida</p>
          <p>
            Foydalanuvchi parolini unutsa, admin shu sahifadagi{" "}
            <strong>Parol</strong> tugmasi orqali yangi parol o'rnatadi.
            Almashtirilgach foydalanuvchining barcha sessiyalari bekor
            qilinadi. Foydalanuvchi o'zi tiklay olmaydi.
          </p>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Ism, email yoki telefon..."
          className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-white/30"
        />
      </div>

      <div className="rounded-xl border border-white/8 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/8 bg-white/4">
              {["Foydalanuvchi", "Telefon", "Kompaniya", "Rol", "So'ngi faollik", "Amallar"].map((h) => (
                <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-white/40 uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users === undefined ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-white/5">
                  {Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className="h-5 w-full bg-white/5" />
                    </td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-white/30 text-sm">
                  Foydalanuvchilar topilmadi
                </td>
              </tr>
            ) : (
              filtered.map((u) => {
                const isSelf = currentUser?._id === u._id;
                return (
                  <tr key={u._id} className="border-b border-white/5 hover:bg-white/4 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0 font-bold text-primary text-sm">
                          {(u.name ?? u.email ?? "?")[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-white">{u.name ?? "—"}</p>
                          <p className="text-xs text-white/40">{u.email ?? ""}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {u.phone ? (
                        <div className="flex items-center gap-1.5 text-xs text-white/60 font-mono">
                          <Phone className="h-3 w-3 text-white/30" />
                          {u.phone}
                        </div>
                      ) : (
                        <span className="text-xs text-white/25">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {u.activeCompanyName ? (
                        <div className="flex items-center gap-1.5 text-xs text-white/60">
                          <Building2 className="h-3.5 w-3.5" />
                          {u.activeCompanyName}
                        </div>
                      ) : (
                        <span className="text-xs text-white/30">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {u.isPlatformAdmin ? (
                        <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-400 w-fit">
                          <Shield className="h-3 w-3" />
                          Platform Admin
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-white/50">
                          <User className="h-3 w-3" />
                          {u.role ?? "Foydalanuvchi"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-white/40 tabular-nums">
                      {u.lastSeen
                        ? format(new Date(u.lastSeen), "dd.MM.yyyy HH:mm")
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {!u.isPlatformAdmin ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busyId === u._id}
                            onClick={() => handleGrant(u._id)}
                            className="bg-purple-500/15 border-purple-500/30 text-purple-300 hover:bg-purple-500/25 h-7 text-xs"
                          >
                            <Shield className="h-3 w-3 mr-1" />
                            Admin
                          </Button>
                        ) : !isSelf ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busyId === u._id}
                            onClick={() => setRevokeTarget({ id: u._id, name: u.name ?? u.email ?? "foydalanuvchi" })}
                            className="bg-red-500/10 border-red-500/30 text-red-300 hover:bg-red-500/20 h-7 text-xs"
                          >
                            <ShieldOff className="h-3 w-3 mr-1" />
                            Adminlikni olish
                          </Button>
                        ) : (
                          <span className="text-xs text-white/30">Siz</span>
                        )}
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setFormError(null);
                            setResetPassword("");
                            setResetTarget({
                              phone: u.email ?? u.phone ?? "",
                              name: u.name ?? u.email ?? "",
                            });
                          }}
                          className="bg-white/5 border-white/10 text-white/40 hover:text-white/70 h-7 text-xs"
                        >
                          <KeyRound className="h-3 w-3 mr-1" />
                          Parol
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <AlertDialog open={revokeTarget !== null} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Adminlikni olishni tasdiqlang</AlertDialogTitle>
            <AlertDialogDescription>
              {revokeTarget?.name} foydalanuvchisidan platforma admin huquqlarini olib
              tashlamoqchimisiz? Bu amalni keyinroq qaytarish mumkin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Bekor qilish</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevoke}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Adminlikni olish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Yangi foydalanuvchi */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Yangi foydalanuvchi</DialogTitle>
            <DialogDescription>
              Telefon raqam login sifatida ishlatiladi. Parolni foydalanuvchiga
              o'zingiz yetkazasiz.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="+998901234567"
              value={newPhone}
              onChange={(e) => { setNewPhone(e.target.value); setFormError(null); }}
            />
            <Input
              placeholder="Ism (ixtiyoriy)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Input
              type="password"
              placeholder="Parol (kamida 8 belgi)"
              value={newPassword}
              onChange={(e) => { setNewPassword(e.target.value); setFormError(null); }}
            />
            {formError && (
              <div className="flex items-center gap-2 text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {formError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Bekor</Button>
            <Button
              onClick={() => { void handleCreate(); }}
              disabled={formBusy || !newPhone.trim() || newPassword.length < 8}
            >
              {formBusy ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Yaratilmoqda</> : "Yaratish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Parolni almashtirish */}
      <Dialog open={resetTarget !== null} onOpenChange={(o) => { if (!o) setResetTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Parolni almashtirish</DialogTitle>
            <DialogDescription>
              {resetTarget?.name} ({resetTarget?.phone}) uchun yangi parol.
              Almashtirilgach barcha sessiyalari bekor qilinadi.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              type="password"
              placeholder="Yangi parol (kamida 8 belgi)"
              value={resetPassword}
              onChange={(e) => { setResetPassword(e.target.value); setFormError(null); }}
            />
            {formError && (
              <div className="flex items-center gap-2 text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {formError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setResetTarget(null)}>Bekor</Button>
            <Button
              onClick={() => { void handleReset(); }}
              disabled={formBusy || resetPassword.length < 8}
            >
              {formBusy ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Saqlanmoqda</> : "Almashtirish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
