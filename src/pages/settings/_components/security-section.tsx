/**
 * Security Settings Section — o'z parolini almashtirish.
 *
 * Located: Settings → Xavfsizlik
 *
 * API: `POST /api/auth/password` — boshqa qurilmalardagi sessiyalar yopiladi.
 * Avtomatik bloklash (qulf ekrani) va PIN foydalanuvchi talabi bilan olib tashlangan (2026-09-11).
 */
import { useState } from "react";
import { toast } from "sonner";
import { Shield, Lock, Eye, EyeOff, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation } from "@/lib/query.ts";

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
