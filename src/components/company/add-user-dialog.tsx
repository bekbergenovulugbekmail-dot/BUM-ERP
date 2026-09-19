/**
 * MAVJUD XODIMGA DASTURGA KIRISH BERISH ("Foydalanuvchi qo'shish").
 *
 * Xodim (Employee), foydalanuvchi (User) va litsenziya — uchta alohida tushuncha:
 *   - xodim FAQAT Kadrlar → "Xodim qo'shish" da yaratiladi;
 *   - bu oyna esa MAVJUD xodimga login, rol va litsenziya beradi (yangi xodim ochmaydi).
 *
 * Server: `POST /api/hr/employees/:id/software-access` — bitta tranzaksiyada foydalanuvchi, a'zolik va
 * litsenziya yaratiladi (`hr.manage` + `employee.software_access.manage`).
 */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { FULL_ACCESS_ROLES } from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";

type Props = { open: boolean; onClose: () => void; onCreated?: () => void };

type EmployeeRow = {
  id: string;
  name: string;
  code: string;
  phone: string | null;
  positionName: string | null;
  status: string;
  userId: string | null;
};
type CompanyRole = { id: string; name: string; isActive: boolean };

const FULL_ACCESS = new Set<string>(FULL_ACCESS_ROLES);
/** Login berilgach ro'yxatlar yangilanadi: a'zolar, litsenziya, obuna, kadrlar. */
const INVALIDATE = ["/api/company", "/api/subscription", "/api/hr"];

export default function AddUserDialog({ open, onClose, onCreated }: Props) {
  if (!open) return null;
  return <AddUserForm onClose={onClose} onCreated={onCreated} />;
}

function AddUserForm({ onClose, onCreated }: Omit<Props, "open">) {
  // Manzilning birinchi bo'lagi — biznes (yoki til): Kadrlar havolasi shu bo'lak bilan quriladi
  const { lng } = useParams<{ lng: string }>();
  const employeesQuery = useApiQuery<{ employees: EmployeeRow[] }>("/api/hr/employees", { status: "active" });
  const roles = useApiQuery<{ roles: CompanyRole[] }>("/api/company/roles").data?.roles;
  const assignable = (roles ?? []).filter((role) => role.isActive && !FULL_ACCESS.has(role.name));

  /** Faqat hali logini yo'q xodimlar — mavjud login ikki marta berilmaydi. */
  const candidates = (employeesQuery.data?.employees ?? []).filter((employee) => !employee.userId);

  const [employeeId, setEmployeeId] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState("");
  const [error, setError] = useState<string | null>(null);

  const grant = useApiMutation(
    ({ id, body }: { id: string; body: Record<string, unknown> }) => api.post(`/api/hr/employees/${id}/software-access`, body),
    { invalidate: INVALIDATE },
  );

  const employee = candidates.find((row) => row.id === employeeId) ?? null;

  const submit = async () => {
    setError(null);
    if (!employee) {
      setError("Xodimni tanlang");
      return;
    }
    const loginPhone = (phone || employee.phone || "").trim();
    if (!loginPhone) {
      setError("Telefon raqam kerak — u login bo'ladi");
      return;
    }
    if (!password) {
      setError("Parol kiriting");
      return;
    }
    if (!/^\d{4,8}$/.test(pin)) {
      setError("PIN 4-8 ta raqamdan iborat bo'lishi kerak");
      return;
    }
    if (!role) {
      setError("Rolni tanlang");
      return;
    }
    try {
      await grant.mutateAsync({ id: employee.id, body: { phone: loginPhone, password, pin, role } });
      toast.success(`${employee.name} endi dasturga kira oladi`);
      onCreated?.();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md" data-testid="add-user-dialog">
        <DialogHeader>
          <DialogTitle>Foydalanuvchi qo'shish</DialogTitle>
          <DialogDescription>
            Mavjud xodimga dasturga kirish beriladi: telefon raqam login bo'ladi va bitta litsenziya band qilinadi.
            Yangi xodim <b>Kadrlar → Xodim qo'shish</b> bo'limida ochiladi.
          </DialogDescription>
        </DialogHeader>

        {employeesQuery.isLoading ? (
          <Skeleton className="h-24 rounded-xl" />
        ) : candidates.length === 0 ? (
          <div className="space-y-3 rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            <p>Logini yo'q xodim qolmadi.</p>
            <Button asChild variant="secondary" size="sm">
              <Link to={`/${lng ?? "uz"}/hr`} data-testid="go-to-employees">Kadrlar bo'limiga o'tish</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="add-user-employee">Xodim *</Label>
              <Select
                value={employeeId}
                onValueChange={(value) => {
                  setEmployeeId(value);
                  const picked = candidates.find((row) => row.id === value);
                  setPhone(picked?.phone ?? "");
                  setError(null);
                }}
              >
                <SelectTrigger className="w-full" id="add-user-employee">
                  <SelectValue placeholder="Tanlang" />
                </SelectTrigger>
                <SelectContent position="popper">
                  {candidates.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                      {item.positionName ? ` · ${item.positionName}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="add-user-phone">Telefon raqam (login) *</Label>
              <Input
                id="add-user-phone"
                placeholder="+998901234567"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="add-user-password">Parol *</Label>
                <Input
                  id="add-user-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-user-pin">PIN (4-8 raqam) *</Label>
                <Input
                  id="add-user-pin"
                  inputMode="numeric"
                  maxLength={8}
                  value={pin}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="add-user-role">Rol *</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="w-full" id="add-user-role">
                  <SelectValue placeholder="Tanlang" />
                </SelectTrigger>
                <SelectContent position="popper">
                  {assignable.map((item) => (
                    <SelectItem key={item.id} value={item.name}>{item.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {error && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" disabled={grant.isPending} onClick={onClose}>
            Bekor
          </Button>
          <Button disabled={grant.isPending || candidates.length === 0} onClick={() => void submit()}>
            {grant.isPending ? "..." : "Kirish berish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
