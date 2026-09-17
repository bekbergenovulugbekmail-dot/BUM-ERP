/**
 * Yangi dasturdan foydalanuvchi xodim qo'shish — `POST /api/company/employees` (faqat kompaniya egasi).
 *
 * Litsenziya qoidasi shu yerda ko'rinadi: bo'sh included litsenziya bo'lsa xodim darhol yaratiladi,
 * tugagan bo'lsa server `license_limit_reached` qaytaradi va qo'shimcha litsenziya tarifi tanlanmaguncha
 * hech narsa yaratilmaydi. Ikki joydan ochiladi: Sozlamalar → Foydalanuvchilar va Obuna sahifasi.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { FULL_ACCESS_ROLES } from "@bum/shared";
import { Input } from "@/components/ui/input.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import AdditionalLicensePicker from "@/components/subscription/additional-license-picker.tsx";
import { licenseLimitOf } from "@/lib/subscription.ts";

const FULL_ACCESS = new Set<string>(FULL_ACCESS_ROLES);
/** Xodim qo'shilgach obuna va litsenziya sanoqlari ham yangilanishi kerak. */
const INVALIDATE = ["/api/company", "/api/subscription"];

type CompanyRole = { id: string; name: string; isActive: boolean };

type Props = {
  open: boolean;
  onClose: () => void;
  /** Muvaffaqiyatli yaratilgandan keyin (masalan, ro'yxatni yangilash uchun). */
  onCreated?: () => void;
};

/** Yopiq holatda umuman chizilmaydi — shuning uchun har ochilishda maydonlar toza bo'ladi. */
export default function NewEmployeeDialog({ open, onClose, onCreated }: Props) {
  if (!open) return null;
  return <NewEmployeeForm onClose={onClose} onCreated={onCreated} />;
}

function NewEmployeeForm({ onClose, onCreated }: Omit<Props, "open">) {
  const roles = useApiQuery<{ roles: CompanyRole[] }>("/api/company/roles").data?.roles;
  const assignable = (roles ?? []).filter((role) => role.isActive && !FULL_ACCESS.has(role.name));

  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [pickedRole, setPickedRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Included litsenziya tugagan — qo'shimcha tarif tanlanmaguncha xodim yaratilmaydi. */
  const [limit, setLimit] = useState<ReturnType<typeof licenseLimitOf>>(null);

  const create = useApiMutation(
    (body: { phone: string; password: string; name?: string; role?: string; pin?: string; additionalLicensePlanId?: string }) =>
      api.post<{ payment: { id: string } | null }>("/api/company/employees", body),
    { invalidate: INVALIDATE },
  );

  // Sukut bo'yicha rol ro'yxatdan hisoblanadi — foydalanuvchi tanlaguncha
  const role = pickedRole ?? assignable.find((item) => item.name === "Kassir")?.name ?? assignable[0]?.name ?? "";

  const submit = async (additionalLicensePlanId?: string) => {
    setError(null);
    if (pin && !/^\d{4,8}$/.test(pin)) {
      setError("PIN 4-8 ta raqamdan iborat bo'lishi kerak");
      return;
    }
    try {
      const result = await create.mutateAsync({
        phone: phone.trim(),
        password,
        name: name.trim() || undefined,
        role: role || undefined,
        pin: pin || undefined,
        additionalLicensePlanId,
      });
      toast.success(
        result.payment
          ? "Xodim qo'shildi. Qo'shimcha litsenziya to'lovi tasdiqlanguncha u dasturga kira olmaydi."
          : "Xodim qo'shildi",
      );
      onCreated?.();
      onClose();
    } catch (err) {
      const reached = licenseLimitOf(err);
      if (reached) setLimit(reached);
      else setError(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="new-employee-dialog">
        <DialogHeader>
          <DialogTitle>Yangi foydalanuvchi</DialogTitle>
          <DialogDescription>
            Telefon raqam login bo'ladi. Har bir foydalanuvchi bitta litsenziyani band qiladi —
            bo'sh litsenziya qolmagan bo'lsa qo'shimcha tarif tanlanadi.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-employee-phone">Telefon raqam</Label>
            <Input
              id="new-employee-phone"
              placeholder="+998901234567"
              value={phone}
              onChange={(event) => { setPhone(event.target.value); setError(null); }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-employee-name">Ism (ixtiyoriy)</Label>
            <Input id="new-employee-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-employee-password">Dastlabki parol</Label>
            <Input
              id="new-employee-password"
              type="password"
              value={password}
              onChange={(event) => { setPassword(event.target.value); setError(null); }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-employee-pin">PIN — ekran qulfi uchun (4-8 raqam, ixtiyoriy)</Label>
            <Input
              id="new-employee-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(event) => { setPin(event.target.value.replace(/\D/g, "").slice(0, 8)); setError(null); }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-employee-role">Rol</Label>
            <Select value={role} onValueChange={setPickedRole}>
              <SelectTrigger className="w-full" id="new-employee-role">
                <SelectValue placeholder="Rol tanlang" />
              </SelectTrigger>
              <SelectContent position="popper">
                {assignable.map((item) => (
                  <SelectItem key={item.id} value={item.name}>{item.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            Filial, omborlar va mas'ul kategoriyalarni Sozlamalar → Foydalanuvchilar bo'limida "Tahrirlash" orqali belgilaysiz.
          </p>

          {limit && (
            <AdditionalLicensePicker
              counts={limit.counts}
              pending={create.isPending}
              onSelect={(planId) => { void submit(planId); }}
            />
          )}
          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Bekor</Button>
          <Button
            data-testid="new-employee-submit"
            onClick={() => { void submit(); }}
            disabled={create.isPending || !phone.trim() || !password}
          >
            {create.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Qo'shish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
