/**
 * Xodim qo'shish — BITTA joy (`POST /api/company/employees`, faqat kompaniya egasi).
 *
 * Kim bo'lishidan qat'i nazar — kassir, savdo agenti, yetkazuvchi yoki boshqa xodim — shu bitta
 * forma ishlatiladi. Rol tanlanganda server shunga mos profilni ham o'zi yaratadi:
 * "Sotuv agenti" → savdo agenti profili, "Dostavka agenti" → yetkazuvchi profili. Shuning uchun
 * Distribyutsiya, Dostavka va HR bo'limlarida alohida "qo'shish" formasi yo'q.
 *
 * Litsenziya qoidasi shu yerda ko'rinadi: bo'sh included litsenziya bo'lsa xodim darhol yaratiladi,
 * tugagan bo'lsa server `license_limit_reached` qaytaradi va qo'shimcha litsenziya tarifi tanlanmaguncha
 * hech narsa yaratilmaydi.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { FULL_ACCESS_ROLES } from "@bum/shared";
import { Input } from "@/components/ui/input.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import AdditionalLicensePicker from "@/components/subscription/additional-license-picker.tsx";
import { licenseLimitOf } from "@/lib/subscription.ts";

const FULL_ACCESS = new Set<string>(FULL_ACCESS_ROLES);
/** Xodim qo'shilgach obuna, litsenziya, agent va yetkazuvchi ro'yxatlari ham yangilanadi. */
const INVALIDATE = ["/api/company", "/api/subscription", "/api/distribution", "/api/delivery", "/api/hr", "/api/sales-agent"];

/** Shu rollar tanlansa server profilni ham yaratadi (nomlar serverdagi bilan bir xil). */
const SALES_AGENT_ROLE = "Sotuv agenti";
const DELIVERY_AGENT_ROLE = "Dostavka agenti";

type NamedRow = { id: string; name: string };
type PositionRow = { id: string; name: string; departmentId: string };

const VEHICLES = [
  { value: "car", label: "Yengil avtomobil" },
  { value: "motorcycle", label: "Mototsikl" },
  { value: "bicycle", label: "Velosiped" },
  { value: "foot", label: "Piyoda" },
  { value: "truck", label: "Yuk mashinasi" },
];

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
  // Kadrlar bo'limida ochilgan bo'lim va lavozimlar (ruxsat bo'lmasa — bo'sh, maydonlar ko'rinmaydi)
  const departments = useApiQuery<{ departments: NamedRow[] }>("/api/hr/departments").data?.departments ?? [];
  const positions = useApiQuery<{ positions: PositionRow[] }>("/api/hr/positions").data?.positions ?? [];

  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [pickedRole, setPickedRole] = useState<string | null>(null);
  /** Xodim dasturga kiradimi: o'chirilsa login ham, litsenziya ham berilmaydi (faqat ro'yxatda qoladi). */
  const [softwareAccess, setSoftwareAccess] = useState(true);
  /** Qurilma tasdig'i: yangi telefon/kompyuterdan kirish egasining tasdig'ini talab qiladimi. */
  const [deviceCheck, setDeviceCheck] = useState(true);
  const [hireDate, setHireDate] = useState("");
  /** Kadrlar kartochkasi uchun: tanlanmasa "Asosiy" bo'limi va rol nomidagi lavozim ochiladi. */
  const [departmentId, setDepartmentId] = useState("");
  const [positionId, setPositionId] = useState("");
  const [region, setRegion] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Included litsenziya tugagan — qo'shimcha tarif tanlanmaguncha xodim yaratilmaydi. */
  const [limit, setLimit] = useState<ReturnType<typeof licenseLimitOf>>(null);

  const create = useApiMutation(
    (body: Record<string, unknown>) => api.post<{ payment: { id: string } | null }>("/api/company/employees", body),
    { invalidate: INVALIDATE },
  );

  // Sukut bo'yicha rol ro'yxatdan hisoblanadi — foydalanuvchi tanlaguncha
  const role = pickedRole ?? assignable.find((item) => item.name === "Kassir")?.name ?? assignable[0]?.name ?? "";
  const isSalesAgent = role === SALES_AGENT_ROLE;
  const isDeliveryAgent = role === DELIVERY_AGENT_ROLE;
  /** Agent va yetkazuvchi profili ism bilan yaratiladi — bu rollarda ism majburiy. */
  const nameRequired = isSalesAgent || isDeliveryAgent;

  /** Muvaffaqiyat xabari: nima yaratilgani va keyin qayerda ko'rinishi. */
  const created = (pendingPayment: boolean) => {
    if (pendingPayment) return "Xodim qo'shildi. Qo'shimcha litsenziya to'lovi tasdiqlanguncha u dasturga kira olmaydi.";
    if (!softwareAccess) return "Xodim qo'shildi (dasturga kirmaydi, litsenziya band qilmaydi)";
    if (isSalesAgent) return "Savdo agenti qo'shildi — profili Distribyutsiya bo'limida ko'rinadi";
    if (isDeliveryAgent) return "Yetkazuvchi qo'shildi — profili Dostavka bo'limida ko'rinadi";
    return "Xodim qo'shildi";
  };

  const submit = async (additionalLicensePlanId?: string) => {
    setError(null);
    if (pin && !/^\d{4,8}$/.test(pin)) {
      setError("PIN 4-8 ta raqamdan iborat bo'lishi kerak");
      return;
    }
    if ((nameRequired || !softwareAccess) && !name.trim()) {
      setError("Ism-familiya kiritilishi shart");
      return;
    }
    try {
      const result = await create.mutateAsync({
        phone: phone.trim(),
        softwareAccess,
        ...(softwareAccess ? { password, pin: pin || undefined, deviceCheck, additionalLicensePlanId } : {}),
        name: name.trim() || undefined,
        role: role || undefined,
        ...(hireDate ? { hireDate } : {}),
        ...(departmentId ? { departmentId } : {}),
        ...(positionId ? { positionId } : {}),
        ...(isSalesAgent && region.trim() ? { region: region.trim() } : {}),
        ...(isDeliveryAgent && vehicleType ? { vehicleType } : {}),
        ...(isDeliveryAgent && vehicleNumber.trim() ? { vehicleNumber: vehicleNumber.trim() } : {}),
      });
      toast.success(created(Boolean(result.payment)));
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md" data-testid="new-employee-dialog">
        <DialogHeader>
          <DialogTitle>Xodim qo'shish</DialogTitle>
          <DialogDescription>
            Kassir, savdo agenti, yetkazuvchi — hammasi shu yerdan qo'shiladi. Telefon raqam login bo'ladi.
            Har bir xodim bitta litsenziyani band qiladi — bo'sh litsenziya qolmagan bo'lsa qo'shimcha tarif tanlanadi.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
            <div className="min-w-0">
              <Label htmlFor="new-employee-software" className="cursor-pointer text-sm font-medium">Dasturga kiradi</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                O'chirilsa login va litsenziya berilmaydi — xodim faqat ro'yxatda qoladi (masalan yuk tashuvchi).
              </p>
            </div>
            <Switch
              id="new-employee-software"
              checked={softwareAccess}
              onCheckedChange={(value) => { setSoftwareAccess(value); setError(null); }}
            />
          </div>
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
            <Label htmlFor="new-employee-name">Ism-familiya{nameRequired ? "" : " (ixtiyoriy)"}</Label>
            <Input id="new-employee-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          {softwareAccess && (
            <>
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
            </>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="new-employee-role">{softwareAccess ? "Rol" : "Lavozim"}</Label>
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
            {(isSalesAgent || isDeliveryAgent) && (
              <p className="text-xs text-muted-foreground">
                {isSalesAgent
                  ? "Savdo agenti profili ham yaratiladi."
                  : "Yetkazuvchi profili ham yaratiladi."}
              </p>
            )}
          </div>

          {/* Kadrlar kartochkasi: bo'lim, lavozim va ishga kirgan sana (xodim Kadrlar ro'yxatida shular bilan chiqadi) */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {departments.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="new-employee-department">Bo'lim</Label>
                <Select
                  value={departmentId || "none"}
                  onValueChange={(value) => {
                    setDepartmentId(value === "none" ? "" : value);
                    setPositionId("");
                  }}
                >
                  <SelectTrigger className="w-full" id="new-employee-department">
                    <SelectValue placeholder="Asosiy" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="none">— Asosiy —</SelectItem>
                    {departments.map((item) => (
                      <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {positions.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="new-employee-position">Lavozim</Label>
                <Select value={positionId || "none"} onValueChange={(value) => setPositionId(value === "none" ? "" : value)}>
                  <SelectTrigger className="w-full" id="new-employee-position">
                    <SelectValue placeholder="Rol nomi bilan" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="none">— Rol nomi bilan —</SelectItem>
                    {(departmentId ? positions.filter((item) => item.departmentId === departmentId) : positions).map((item) => (
                      <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="new-employee-hire-date">Ishga kirgan sana</Label>
              <Input id="new-employee-hire-date" type="date" value={hireDate} onChange={(event) => setHireDate(event.target.value)} />
            </div>
          </div>

          {(isSalesAgent || isDeliveryAgent) && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {isSalesAgent && (
                <div className="space-y-1.5">
                  <Label htmlFor="new-employee-region">Hudud (ixtiyoriy)</Label>
                  <Input id="new-employee-region" maxLength={100} value={region} onChange={(event) => setRegion(event.target.value)} />
                </div>
              )}
              {isDeliveryAgent && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-employee-vehicle">Transport (ixtiyoriy)</Label>
                    <Select value={vehicleType} onValueChange={setVehicleType}>
                      <SelectTrigger className="w-full" id="new-employee-vehicle">
                        <SelectValue placeholder="Tanlang" />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {VEHICLES.map((item) => (
                          <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="new-employee-vehicle-number">Davlat raqami (ixtiyoriy)</Label>
                    <Input
                      id="new-employee-vehicle-number"
                      maxLength={32}
                      value={vehicleNumber}
                      onChange={(event) => setVehicleNumber(event.target.value)}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {softwareAccess && (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
            <div className="min-w-0">
              <Label htmlFor="new-employee-device-check" className="cursor-pointer text-sm font-medium">
                Qurilma tasdig'i
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Yoqilgan bo'lsa: xodim yangi telefon yoki kompyuterdan kirganda siz tasdiqlamaguncha kira olmaydi.
                O'chirilgan bo'lsa: faqat parol tekshiriladi.
              </p>
            </div>
            <Switch id="new-employee-device-check" checked={deviceCheck} onCheckedChange={setDeviceCheck} />
          </div>
          )}

          <p className="text-xs text-muted-foreground">
            Filial, omborlar va mas'ul kategoriyalarni shu bo'limdagi "Tahrirlash" orqali belgilaysiz.
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
            disabled={create.isPending || !phone.trim() || (softwareAccess && !password)}
          >
            {create.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Qo'shish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
