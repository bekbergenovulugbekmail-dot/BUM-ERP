/**
 * Security Settings Section — o'z paroli, PIN (o'rnatish, o'zgartirish, o'chirish), auto-lock
 *
 * Located: Settings → Xavfsizlik
 *
 * API: `/api/auth/password`, `/api/auth/pin`, `/pin/change`, `/pin/remove`, `/auto-lock`, `GET /security`.
 * PIN/auto-lock o'zgarsa (xato urinishda ham — bloklash holati) `/api/auth/security` qayta olinadi.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Shield, Lock, Eye, EyeOff, Check, X,
  Clock, KeyRound, Trash2, Edit3, Info,
  ShieldCheck, ShieldOff,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select.tsx";
import { lockScreen, useSecuritySettings } from "@/hooks/use-lock-screen.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation } from "@/lib/query.ts";

type PinMode = "idle" | "set" | "change" | "remove";

const SECURITY = ["/api/auth/security"];

const TIMEOUT_OPTIONS = [
  { value: "0",   label: "O'chirilgan (lock yo'q)" },
  { value: "15",  label: "15 soniya" },
  { value: "30",  label: "30 soniya (standart)" },
  { value: "60",  label: "1 daqiqa" },
  { value: "120", label: "2 daqiqa" },
  { value: "300", label: "5 daqiqa" },
  { value: "600", label: "10 daqiqa" },
];

function PinInput({
  label, value, onChange, showToggle = true, placeholder = "••••••",
}: {
  label: string; value: string; onChange: (v: string) => void;
  showToggle?: boolean; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      <div className="relative">
        <Input
          type={show ? "text" : "password"}
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 8))}
          placeholder={placeholder}
          className="pr-10 font-mono text-xl tracking-widest"
          autoComplete="one-time-code"
        />
        {showToggle && (
          <button
            type="button"
            onClick={() => setShow(!show)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
}

export default function SecuritySection() {
  const queryClient = useQueryClient();
  const securitySettings = useSecuritySettings();
  const setPinMutation = useApiMutation((pin: string) => api.post("/api/auth/pin", { pin }), { invalidate: SECURITY });
  const changePinMutation = useApiMutation(
    (body: { oldPin: string; newPin: string }) => api.post("/api/auth/pin/change", body),
    { invalidate: SECURITY },
  );
  const removePinMutation = useApiMutation(
    (currentPin: string) => api.post("/api/auth/pin/remove", { currentPin }),
    { invalidate: SECURITY },
  );
  const setAutoLockTimeoutMutation = useApiMutation(
    (seconds: number) => api.put("/api/auth/auto-lock", { seconds }),
    { invalidate: SECURITY },
  );

  const [mode, setMode] = useState<PinMode>("idle");

  // Form state
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [oldPin, setOldPin] = useState("");

  const hasPIN = securitySettings?.hasPIN ?? false;
  const timeout = securitySettings?.autoLockTimeoutSeconds ?? 30;
  const busy = setPinMutation.isPending || changePinMutation.isPending || removePinMutation.isPending;

  const resetForm = () => {
    setNewPin(""); setConfirmPin(""); setOldPin("");
    setMode("idle");
  };

  /** Xato PIN urinishi ham serverda hisoblanadi — bloklash holati yangilansin. */
  const failed = (err: unknown) => {
    toast.error(errorMessage(err));
    void queryClient.invalidateQueries({ queryKey: SECURITY });
  };

  const handleSetPin = async () => {
    if (newPin.length < 4) return toast.error("PIN kamida 4 ta raqam bo'lishi kerak");
    if (newPin !== confirmPin) return toast.error("PIN kodlar mos emas");
    try {
      await setPinMutation.mutateAsync(newPin);
      toast.success("PIN muvaffaqiyatli o'rnatildi");
      resetForm();
    } catch (err) {
      failed(err);
    }
  };

  const handleChangePin = async () => {
    if (!oldPin) return toast.error("Eski PINni kiriting");
    if (newPin.length < 4) return toast.error("Yangi PIN kamida 4 ta raqam bo'lishi kerak");
    if (newPin !== confirmPin) return toast.error("Yangi PIN kodlar mos emas");
    try {
      await changePinMutation.mutateAsync({ oldPin, newPin });
      toast.success("PIN muvaffaqiyatli o'zgartirildi");
      resetForm();
    } catch (err) {
      failed(err);
    }
  };

  const handleRemovePin = async () => {
    if (!oldPin) return toast.error("Amalni tasdiqlash uchun PIN kiriting");
    try {
      await removePinMutation.mutateAsync(oldPin);
      toast.success("PIN o'chirildi");
      resetForm();
    } catch (err) {
      failed(err);
    }
  };

  const handleTimeoutChange = async (val: string) => {
    try {
      await setAutoLockTimeoutMutation.mutateAsync(parseInt(val, 10));
      toast.success("Auto-lock sozlama saqlandi");
    } catch (err) {
      toast.error(errorMessage(err, "Saqlashda xatolik"));
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Shield className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-bold">Xavfsizlik</h2>
          <p className="text-sm text-muted-foreground">Parol, PIN kod va avtomatik bloklash sozlamalari</p>
        </div>
      </div>

      <PasswordCard />

      {/* Info banner */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-500/8 border border-blue-500/20">
        <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
        <div className="text-sm text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">PIN nima?</p>
          <p>
            PIN — bu tezkor bloklash ekranini ochish uchun qisqa raqamli kod.
            U to'liq parolni almashtirolmaydi — faqat mavjud sessiyani ochadi.
            Belgilangan vaqt faolsizlikdan keyin ekran avtomatik bloklanadi.
          </p>
        </div>
      </div>

      {/* PIN Status Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              PIN kod
            </CardTitle>
            {hasPIN ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-green-600 dark:text-green-400 bg-green-500/10 px-2.5 py-1 rounded-full">
                <ShieldCheck className="h-3.5 w-3.5" />
                O'rnatilgan
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
                <ShieldOff className="h-3.5 w-3.5" />
                O'rnatilmagan
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {securitySettings?.isPinLocked && securitySettings.pinLockedUntil && (
            <p className="text-xs text-destructive">
              PIN vaqtincha bloklangan: {new Date(securitySettings.pinLockedUntil).toLocaleTimeString("uz-UZ")} gacha
            </p>
          )}

          {/* Action buttons */}
          {mode === "idle" && (
            <div className="flex flex-wrap gap-2">
              {!hasPIN ? (
                <Button onClick={() => setMode("set")} className="gap-2">
                  <KeyRound className="h-4 w-4" />
                  PIN o'rnatish
                </Button>
              ) : (
                <>
                  <Button variant="secondary" onClick={() => setMode("change")} className="gap-2">
                    <Edit3 className="h-4 w-4" />
                    Yangilash
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setMode("remove")}
                    className="gap-2 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                    O'chirish
                  </Button>
                </>
              )}
            </div>
          )}

          {/* Set PIN form */}
          {mode === "set" && (
            <div className="space-y-4 p-4 rounded-xl border border-border bg-muted/30">
              <p className="text-sm font-medium">Yangi PIN o'rnatish</p>
              <p className="text-xs text-muted-foreground">4 dan 8 tagacha raqam kiriting</p>
              <PinInput label="PIN kod" value={newPin} onChange={setNewPin} />
              <PinInput label="PIN kodni tasdiqlang" value={confirmPin} onChange={setConfirmPin} />
              <div className="flex gap-2">
                <Button onClick={handleSetPin} disabled={busy || newPin.length < 4 || newPin !== confirmPin} className="gap-2">
                  {busy ? <span className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" /> : <Check className="h-4 w-4" />}
                  Saqlash
                </Button>
                <Button variant="ghost" onClick={resetForm}><X className="h-4 w-4 mr-1" />Bekor</Button>
              </div>
            </div>
          )}

          {/* Change PIN form */}
          {mode === "change" && (
            <div className="space-y-4 p-4 rounded-xl border border-border bg-muted/30">
              <p className="text-sm font-medium">PIN kodni o'zgartirish</p>
              <PinInput label="Joriy PIN" value={oldPin} onChange={setOldPin} placeholder="Eski PIN" />
              <PinInput label="Yangi PIN" value={newPin} onChange={setNewPin} />
              <PinInput label="Yangi PINni tasdiqlang" value={confirmPin} onChange={setConfirmPin} />
              <div className="flex gap-2">
                <Button onClick={handleChangePin} disabled={busy || !oldPin || newPin.length < 4 || newPin !== confirmPin} className="gap-2">
                  {busy ? <span className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" /> : <Check className="h-4 w-4" />}
                  Saqlash
                </Button>
                <Button variant="ghost" onClick={resetForm}><X className="h-4 w-4 mr-1" />Bekor</Button>
              </div>
            </div>
          )}

          {/* Remove PIN form */}
          {mode === "remove" && (
            <div className="space-y-4 p-4 rounded-xl border border-destructive/20 bg-destructive/5">
              <p className="text-sm font-medium text-destructive">PINni o'chirish</p>
              <p className="text-xs text-muted-foreground">
                PINni o'chirishni tasdiqlash uchun joriy PINni kiriting
              </p>
              <PinInput label="Joriy PIN" value={oldPin} onChange={setOldPin} placeholder="Tasdiqlash uchun PIN" />
              <div className="flex gap-2">
                <Button variant="destructive" onClick={handleRemovePin} disabled={busy || !oldPin} className="gap-2">
                  {busy ? <span className="h-4 w-4 border-2 border-destructive-foreground/30 border-t-destructive-foreground rounded-full animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  O'chirish
                </Button>
                <Button variant="ghost" onClick={resetForm}><X className="h-4 w-4 mr-1" />Bekor</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Auto-lock timeout */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            Avtomatik bloklash vaqti
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Foydalanuvchi ko'rsatilgan vaqt davomida faol bo'lmasa, ekran avtomatik bloklanadi.
          </p>
          <div className="flex items-center gap-3">
            <Select
              value={String(timeout)}
              onValueChange={(val) => { void handleTimeoutChange(val); }}
              disabled={securitySettings === undefined || setAutoLockTimeoutMutation.isPending}
            >
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEOUT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {timeout === 0 && (
              <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <Info className="h-3.5 w-3.5" />
                PIN bloklash o'chirilgan
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Manual lock button */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" />
            Hozir bloklash
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Ekranni hozir qo'lda bloklash. PIN o'rnatilgan bo'lsa PIN bilan, bo'lmasa parol bilan ochiladi.
          </p>
          <Button
            variant="secondary"
            onClick={() => lockScreen()}
            className="gap-2"
          >
            <Lock className="h-4 w-4" />
            Ekranni bloklash
          </Button>
        </CardContent>
      </Card>

      {/* Security info */}
      <div className="text-xs text-muted-foreground space-y-1.5 p-4 rounded-xl border border-border bg-muted/20">
        <p className="font-medium text-foreground">Xavfsizlik ma'lumotlari</p>
        <ul className="space-y-1 list-disc list-inside">
          <li>Parol va PIN serverda argon2id xeshi sifatida saqlanadi</li>
          <li>5 marta noto'g'ri PIN → 5 daqiqa bloklash</li>
          <li>PIN boshqa kompaniya yoki foydalanuvchi uchun ishlamaydi</li>
          <li>Parol almashtirilsa boshqa qurilmalardagi sessiyalar yopiladi</li>
          <li>Tizimdan chiqish PIN ni bekor qiladi — qayta parol bilan kirish kerak</li>
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
