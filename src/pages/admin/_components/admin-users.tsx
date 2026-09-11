/**
 * Admin Users — platformadagi barcha foydalanuvchilar — `GET /api/platform/users`.
 *
 * Qoidalar (server tekshiradi, UI ham aks ettiradi):
 *  - platforma adminini tayinlash/olib tashlash — FAQAT bootstrap admin
 *  - bootstrap admin va boshqa platforma adminlarining paroli/holatiga tegilmaydi
 *  - parol tiklansa yoki bloklansa foydalanuvchining barcha sessiyalari yopiladi
 * Alohida "Yangi foydalanuvchi" yo'q: egasi akkaunti "Yangi kompaniya" bilan, xodimlarniki — kompaniya egasi tomonidan ochiladi.
 */
import { useState } from "react";
import { toast } from "sonner";
import {
  Search, Shield, ShieldOff, User, Building2,
  Phone, KeyRound, Info, Loader2, AlertTriangle, Crown, Ban, CheckCircle,
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
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { useCurrentUser } from "@/hooks/use-auth.ts";
import { useDebounce } from "@/hooks/use-debounce.ts";
import type { PlatformUser } from "../_lib/types.ts";

const PLATFORM = ["/api/platform"];
const LIMIT = 200;

export default function AdminUsers() {
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [revokeTarget, setRevokeTarget] = useState<PlatformUser | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const currentUser = useCurrentUser();
  const usersQuery = useApiQuery<{ users: PlatformUser[]; total: number }>("/api/platform/users", {
    search: debouncedSearch.trim() || undefined,
    limit: LIMIT,
  });
  const users = usersQuery.data?.users;

  // Joriy admin bootstrap adminmi — ro'yxatdagi o'z qatoridan (/me da bu maydon yo'q)
  const selfRow = users?.find((u) => u.id === currentUser?.id);
  const canAppointAdmins = selfRow?.isBootstrapAdmin === true;

  const setPlatformAdmin = useApiMutation(
    ({ userId, isPlatformAdmin }: { userId: string; isPlatformAdmin: boolean }) =>
      api.post(`/api/platform/users/${userId}/platform-admin`, { isPlatformAdmin }),
    { invalidate: PLATFORM },
  );
  const setStatus = useApiMutation(
    ({ userId, isActive }: { userId: string; isActive: boolean }) =>
      api.post(`/api/platform/users/${userId}/status`, { isActive }),
    { invalidate: PLATFORM },
  );
  const resetPassword = useApiMutation(
    ({ userId, newPassword }: { userId: string; newPassword: string }) =>
      api.post(`/api/platform/users/${userId}/password`, { newPassword }),
    { invalidate: false },
  );

  // Parol tiklash dialogi
  const [resetTarget, setResetTarget] = useState<PlatformUser | null>(null);
  const [resetValue, setResetValue] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const handleReset = async () => {
    if (!resetTarget) return;
    setFormError(null);
    try {
      await resetPassword.mutateAsync({ userId: resetTarget.id, newPassword: resetValue });
      toast.success("Parol almashtirildi. Foydalanuvchi qayta kirishi kerak.");
      setResetTarget(null);
      setResetValue("");
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };

  const handleGrant = async (user: PlatformUser) => {
    setBusyId(user.id);
    try {
      await setPlatformAdmin.mutateAsync({ userId: user.id, isPlatformAdmin: true });
      toast.success("Platforma admini huquqlari berildi");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    setBusyId(revokeTarget.id);
    try {
      await setPlatformAdmin.mutateAsync({ userId: revokeTarget.id, isPlatformAdmin: false });
      toast.success("Admin huquqlari olindi");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
      setRevokeTarget(null);
    }
  };

  const handleToggleActive = async (user: PlatformUser) => {
    setBusyId(user.id);
    try {
      await setStatus.mutateAsync({ userId: user.id, isActive: !user.isActive });
      toast.success(user.isActive ? "Foydalanuvchi bloklandi, sessiyalari yopildi" : "Foydalanuvchi faollashtirildi");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Foydalanuvchilar</h1>
          <p className="text-sm text-white/40 mt-0.5">
            {usersQuery.data ? `${usersQuery.data.total} ta foydalanuvchi` : "Yuklanmoqda..."}
            {usersQuery.data && usersQuery.data.total > LIMIT && ` (birinchi ${LIMIT} tasi — qidiruvdan foydalaning)`}
          </p>
        </div>
      </div>

      {/* Qoidalar */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-500/8 border border-blue-500/20">
        <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
        <div className="text-xs text-blue-300/80 space-y-1">
          <p className="font-semibold text-blue-300">Akkauntlar qanday ochiladi</p>
          <p>
            Biznes egasining loginini <strong>Yangi kompaniya</strong> bo'limi ochadi, xodimlar loginini
            kompaniya egasi o'zi ochadi. Platforma adminini faqat bootstrap admin tayinlaydi.
            Parol almashtirilsa yoki foydalanuvchi bloklansa, uning barcha sessiyalari yopiladi.
          </p>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Ism yoki telefon..."
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
            {usersQuery.error ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-white/40 text-sm">
                  {errorMessage(usersQuery.error)}
                </td>
              </tr>
            ) : users === undefined ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-white/5">
                  {Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className="h-5 w-full bg-white/5" />
                    </td>
                  ))}
                </tr>
              ))
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-white/30 text-sm">
                  Foydalanuvchilar topilmadi
                </td>
              </tr>
            ) : (
              users.map((u) => {
                const isSelf = currentUser?.id === u.id;
                // Server: bootstrap va platforma adminlariga oddiy admin amallari ta'sir qilmaydi
                const manageable = !u.isBootstrapAdmin && !u.isPlatformAdmin && !isSelf;
                return (
                  <tr key={u.id} className="border-b border-white/5 hover:bg-white/4 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0 font-bold text-primary text-sm">
                          {(u.name ?? u.phone)[0]?.toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-white">
                            {u.name ?? "—"}
                            {isSelf && <span className="ml-1.5 text-xs text-white/30">(siz)</span>}
                          </p>
                          {!u.isActive && (
                            <span className="text-[10px] font-medium text-red-400">Bloklangan</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-xs text-white/60 font-mono">
                        <Phone className="h-3 w-3 text-white/30" />
                        {u.phone}
                      </div>
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
                      {u.isBootstrapAdmin ? (
                        <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 w-fit">
                          <Crown className="h-3 w-3" />
                          Bootstrap admin
                        </span>
                      ) : u.isPlatformAdmin ? (
                        <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-400 w-fit">
                          <Shield className="h-3 w-3" />
                          Platform Admin
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-white/50">
                          <User className="h-3 w-3" />
                          Foydalanuvchi
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-white/40 tabular-nums">
                      {u.lastSeenAt
                        ? format(new Date(u.lastSeenAt), "dd.MM.yyyy HH:mm")
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {canAppointAdmins && !u.isBootstrapAdmin && !isSelf && (
                          !u.isPlatformAdmin ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busyId === u.id || !u.isActive}
                              onClick={() => { void handleGrant(u); }}
                              className="bg-purple-500/15 border-purple-500/30 text-purple-300 hover:bg-purple-500/25 h-7 text-xs"
                            >
                              <Shield className="h-3 w-3 mr-1" />
                              Admin
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busyId === u.id}
                              onClick={() => setRevokeTarget(u)}
                              className="bg-red-500/10 border-red-500/30 text-red-300 hover:bg-red-500/20 h-7 text-xs"
                            >
                              <ShieldOff className="h-3 w-3 mr-1" />
                              Adminlikni olish
                            </Button>
                          )
                        )}
                        {manageable && (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busyId === u.id}
                              onClick={() => { void handleToggleActive(u); }}
                              className="bg-white/5 border-white/10 text-white/40 hover:text-white/70 h-7 text-xs"
                            >
                              {u.isActive
                                ? <><Ban className="h-3 w-3 mr-1" />Bloklash</>
                                : <><CheckCircle className="h-3 w-3 mr-1" />Faollashtirish</>}
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setFormError(null);
                                setResetValue("");
                                setResetTarget(u);
                              }}
                              className="bg-white/5 border-white/10 text-white/40 hover:text-white/70 h-7 text-xs"
                            >
                              <KeyRound className="h-3 w-3 mr-1" />
                              Parol
                            </Button>
                          </>
                        )}
                        {isSelf && <span className="text-xs text-white/30">Siz</span>}
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
              {revokeTarget?.name ?? revokeTarget?.phone} foydalanuvchisidan platforma admin huquqlarini olib
              tashlamoqchimisiz? Bu amalni keyinroq qaytarish mumkin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Bekor qilish</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { void handleRevoke(); }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Adminlikni olish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Parolni almashtirish */}
      <Dialog open={resetTarget !== null} onOpenChange={(o) => { if (!o) setResetTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Parolni almashtirish</DialogTitle>
            <DialogDescription>
              {resetTarget?.name ?? "Foydalanuvchi"} ({resetTarget?.phone}) uchun yangi parol.
              Almashtirilgach barcha sessiyalari bekor qilinadi.
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
              disabled={resetPassword.isPending || !resetValue}
            >
              {resetPassword.isPending ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Saqlanmoqda</> : "Almashtirish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
