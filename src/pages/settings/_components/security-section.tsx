/**
 * Security Settings Section — o'z parolini almashtirish.
 *
 * Located: Settings → Xavfsizlik
 *
 * API: `POST /api/auth/password` — boshqa qurilmalardagi sessiyalar yopiladi; `GET /api/auth/sessions`,
 * `DELETE /api/auth/sessions/:id`, `POST /api/auth/sessions/revoke-others` — o'z sessiyalari;
 * `GET /api/auth/devices`, `POST /api/auth/devices/:id` — O'ZINING ishonchli qurilmalari
 * (bir odamda bir nechta telefon/noutbuk bo'ladi: ishonchli qurilmadan turib yangisini o'zi tasdiqlaydi).
 * Avtomatik bloklash (qulf ekrani) va PIN foydalanuvchi talabi bilan olib tashlangan (2026-09-11).
 */
import { useState } from "react";
import { toast } from "sonner";
import { Shield, Lock, Eye, EyeOff, Check, LogOut, MonitorSmartphone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";

export default function SecuritySection() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Shield className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-bold">Xavfsizlik</h2>
          <p className="text-sm text-muted-foreground">Parol va sessiya xavfsizligi</p>
        </div>
      </div>

      <PasswordCard />
      <MyDevicesCard />
      <SessionsCard />

      {/* Security info */}
      <div className="text-xs text-muted-foreground space-y-1.5 p-4 rounded-xl border border-border bg-muted/20">
        <p className="font-medium text-foreground">Xavfsizlik ma'lumotlari</p>
        <ul className="space-y-1 list-disc list-inside">
          <li>Parol serverda argon2id xeshi sifatida saqlanadi</li>
          <li>Parol almashtirilsa boshqa qurilmalardagi sessiyalar yopiladi</li>
          <li>Ketma-ket 5 ta xato kirish urinishidan keyin 15 daqiqagacha kutish kerak bo'ladi</li>
          <li>"Chiqish" tugmasi joriy qurilmadagi sessiyani to'liq tugatadi</li>
        </ul>
      </div>
    </div>
  );
}

// ─── O'z parolini almashtirish ────────────────────────────────────────────────

function PasswordCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [show, setShow] = useState(false);

  // Server boshqa sessiyalarni yopib, shu qurilma uchun yangi cookie beradi — kesh o'zgarmaydi
  const changePassword = useApiMutation(
    (body: { currentPassword: string; newPassword: string }) => api.post("/api/auth/password", body),
    { invalidate: false },
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) return toast.error("Yangi parollar mos emas");
    if (newPassword === currentPassword) return toast.error("Yangi parol joriy paroldan farq qilishi kerak");
    try {
      await changePassword.mutateAsync({ currentPassword, newPassword });
      toast.success("Parol almashtirildi. Boshqa qurilmalardagi sessiyalar yopildi.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const type = show ? "text" : "password";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" />
            Parolni almashtirish
          </CardTitle>
          <button
            type="button"
            onClick={() => setShow(!show)}
            aria-label={show ? "Parollarni yashirish" : "Parollarni ko'rsatish"}
            title={show ? "Parollarni yashirish" : "Parollarni ko'rsatish"}
            className="text-muted-foreground hover:text-foreground cursor-pointer"
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-sm">Joriy parol</Label>
            <Input type={type} autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm">Yangi parol</Label>
              <Input type={type} autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Yangi parolni tasdiqlang</Label>
              <Input type={type} autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </div>
          </div>
          <Button
            type="submit"
            className="gap-2"
            disabled={changePassword.isPending || !currentPassword || !newPassword || newPassword !== confirmPassword}
          >
            <Check className="h-4 w-4" />
            {changePassword.isPending ? "Saqlanmoqda..." : "Parolni almashtirish"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── Faol sessiyalar (o'z qurilmalari) ────────────────────────────────────────

type OwnSession = {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  locked: boolean;
  current: boolean;
};

/** Brauzer va tizim nomi (to'liq User-Agent o'rniga). */
function deviceName(userAgent: string | null): string {
  if (!userAgent) return "Noma'lum qurilma";
  const os = /Android/i.test(userAgent) ? "Android" : /iPhone|iPad/i.test(userAgent) ? "iOS" : /Windows/i.test(userAgent) ? "Windows" : /Mac OS/i.test(userAgent) ? "macOS" : /Linux/i.test(userAgent) ? "Linux" : null;
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Chrome\//.test(userAgent) ? "Chrome" : /Firefox\//.test(userAgent) ? "Firefox" : /Safari\//.test(userAgent) ? "Safari" : null;
  return [browser, os].filter(Boolean).join(" · ") || userAgent.slice(0, 60);
}

const when = (value: string | null) => (value ? new Date(value).toLocaleString("uz-UZ") : "—");

type OwnDevice = {
  id: string;
  name: string;
  status: "approved" | "pending" | "revoked";
  userAgent: string | null;
  lastIp: string | null;
  lastSeenAt: string | null;
  approvedAt: string | null;
};

const DEVICE_STATUS: Record<OwnDevice["status"], { label: string; className: string }> = {
  approved: { label: "Ishonchli", className: "text-emerald-600" },
  pending: { label: "Tasdiq kutilmoqda", className: "text-amber-600" },
  revoked: { label: "Bekor qilingan", className: "text-destructive" },
};

/** O'zining ishonchli qurilmalari: yangi telefon/noutbukni shu yerdan tasdiqlaydi. */
function MyDevicesCard() {
  const devices = useApiQuery<{ devices: OwnDevice[] }>("/api/auth/devices").data?.devices;
  const setStatus = useApiMutation(
    ({ id, status }: { id: string; status: "approved" | "revoked" }) => api.post(`/api/auth/devices/${id}`, { status }),
    { invalidate: ["/api/auth/devices"] },
  );

  const change = async (id: string, status: "approved" | "revoked") => {
    try {
      await setStatus.mutateAsync({ id, status });
      toast.success(status === "approved" ? "Qurilma tasdiqlandi" : "Qurilma bekor qilindi");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Mening qurilmalarim</CardTitle>
        <p className="text-sm text-muted-foreground">
          Yangi telefon yoki noutbukdan kirganda u «tasdiq kutilmoqda» bo'ladi. Ishonchli qurilmadan turib shu yerda
          tasdiqlang — rahbarni kutish shart emas.
        </p>
      </CardHeader>
      <CardContent>
        {!devices ? (
          <p className="text-sm text-muted-foreground">Yuklanmoqda...</p>
        ) : devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">Qurilma yo'q</p>
        ) : (
          <ul className="divide-y divide-border">
            {devices.map((device) => (
              <li key={device.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {device.name}
                    <span className={`ml-2 text-xs font-semibold ${DEVICE_STATUS[device.status].className}`}>
                      {DEVICE_STATUS[device.status].label}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {deviceName(device.userAgent)} · {device.lastIp ?? "IP noma'lum"} · oxirgi faollik {when(device.lastSeenAt)}
                  </p>
                </div>
                <div className="flex gap-2">
                  {device.status !== "approved" && (
                    <Button size="sm" disabled={setStatus.isPending} onClick={() => void change(device.id, "approved")}>
                      Tasdiqlash
                    </Button>
                  )}
                  {device.status === "approved" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={setStatus.isPending}
                      onClick={() => void change(device.id, "revoked")}
                    >
                      Bekor qilish
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SessionsCard() {
  const sessions = useApiQuery<{ sessions: OwnSession[] }>("/api/auth/sessions").data?.sessions;
  const revoke = useApiMutation((id: string) => api.delete(`/api/auth/sessions/${id}`), { invalidate: ["/api/auth/sessions"] });
  const revokeOthers = useApiMutation(() => api.post<{ revoked: number }>("/api/auth/sessions/revoke-others"), { invalidate: ["/api/auth/sessions"] });
  const others = sessions?.filter((session) => !session.current).length ?? 0;

  const endOne = async (id: string) => {
    try {
      await revoke.mutateAsync(id);
      toast.success("Sessiya tugatildi");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const endOthers = async () => {
    try {
      const { revoked } = await revokeOthers.mutateAsync();
      toast.success(`Boshqa qurilmalardan chiqildi (${revoked} ta)`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <MonitorSmartphone className="h-4 w-4 text-primary" />
            Faol sessiyalar
          </CardTitle>
          {others > 0 && (
            <Button size="sm" variant="secondary" className="gap-1.5" disabled={revokeOthers.isPending} onClick={() => void endOthers()}>
              <LogOut className="h-4 w-4" /> Boshqa qurilmalardan chiqish
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!sessions ? (
          <p className="text-sm text-muted-foreground">Yuklanmoqda...</p>
        ) : (
          <ul className="divide-y divide-border">
            {sessions.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {deviceName(session.userAgent)}
                    {session.current && <span className="ml-2 text-xs font-semibold text-emerald-600">shu qurilma</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {session.ipAddress ?? "IP noma'lum"} · kirgan {when(session.createdAt)} · oxirgi faollik {when(session.lastUsedAt)}
                  </p>
                </div>
                {!session.current && (
                  <Button size="sm" variant="ghost" className="text-destructive" disabled={revoke.isPending} onClick={() => void endOne(session.id)}>
                    Tugatish
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
