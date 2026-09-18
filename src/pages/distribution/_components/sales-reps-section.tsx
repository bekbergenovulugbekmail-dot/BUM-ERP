import { useState } from "react";
import { toast } from "sonner";
import { Plus, Target, Percent, Phone, Mail, MapPin, Pencil, Trash2, KeyRound, Wallet, Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import NewEmployeeDialog from "@/components/company/new-employee-dialog.tsx";
import { useTranslation } from "react-i18next";
import { num, type SalesRep } from "../_lib/types.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

const NO_USER = "none";

const emptyForm = () => ({ name: "", phone: "", email: "", region: "", monthlyTarget: "", commission: "", userId: NO_USER });

type RepCash = {
  agent: { id: string; code: string; name: string | null };
  balance: string;
  currency: string;
  cashAccountId: string | null;
  handovers: { id: string; amount: string; txDate: string; description: string | null }[];
};

/**
 * Agentdagi "yo'ldagi naqd" (mijozlardan yig'ilgan, kassaga topshirilmagan) va uni kassaga topshirish —
 * yetkazuvchidagi bilan bir xil qoida: summa agentdagidan oshmaydi, pul agentdan yechilib kassaga o'tadi.
 */
function RepCashDialog({ rep, onClose }: { rep: SalesRep; onClose: () => void }) {
  const { can } = usePermissions();
  const path = `/api/distribution/sales-reps/${rep.id}/cash`;
  const cash = useApiQuery<{ cash: RepCash }>(path).data?.cash;
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const handover = useApiMutation(
    (body: { amount: string; notes: string | null }) => api.post(`/api/distribution/sales-reps/${rep.id}/cash-handover`, body),
    { invalidate: ["/api/distribution", "/api/finance"] },
  );
  const balance = num(cash?.balance ?? 0);
  const canHandover = can("distribution.manage") && balance > 0;

  const submit = async () => {
    try {
      await handover.mutateAsync({ amount: amount.trim() || String(balance), notes: notes.trim() || null });
      toast.success("Naqd kassaga topshirildi");
      setAmount("");
      setNotes("");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !handover.isPending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{rep.name} — yo'ldagi naqd</DialogTitle>
        </DialogHeader>
        {!cash ? (
          <Skeleton className="h-32 rounded-xl" />
        ) : (
          <div className="space-y-3">
            <div className="flex items-baseline justify-between rounded-xl bg-muted/40 px-4 py-3">
              <span className="text-sm text-muted-foreground">Agentda turgan naqd</span>
              <span className="text-lg font-bold tabular-nums">{fmt(balance)} {cash.currency}</span>
            </div>
            {canHandover ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="rep-cash-amount">Summa</Label>
                  <Input id="rep-cash-amount" type="number" min={0} step="any" placeholder={String(balance)} value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="rep-cash-notes">Izoh</Label>
                  <Input id="rep-cash-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
              </div>
            ) : (
              balance <= 0 && <p className="text-sm text-muted-foreground">Topshiriladigan naqd yo'q</p>
            )}
            {cash.handovers.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Oxirgi topshirishlar</p>
                <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
                  {cash.handovers.map((row) => (
                    <li key={row.id} className="flex justify-between gap-2">
                      <span className="truncate text-muted-foreground">{row.txDate}</span>
                      <span className="tabular-nums">{fmt(num(row.amount))}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="secondary" disabled={handover.isPending} onClick={onClose}>Yopish</Button>
          {canHandover && (
            <Button disabled={handover.isPending} onClick={() => void submit()}>
              {handover.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Kassaga topshirish
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** `GET /api/company/employees` — agentga bog'lanadigan tizim foydalanuvchisi (login). */
type EmployeeOption = { id: string; name: string | null; phone: string; companyRole: string; membershipActive: boolean };

export default function SalesRepsSection() {
  const { t } = useTranslation("distribution");
  const { can } = usePermissions();
  const reps = useApiQuery<{ salesReps: SalesRep[] }>("/api/distribution/sales-reps", { includeInactive: true }).data?.salesReps;
  // `users.view` bo'lmasa ro'yxat kelmaydi — bog'lash maydoni ko'rsatilmaydi
  const employees = useApiQuery<{ employees: EmployeeOption[] }>("/api/company/employees").data?.employees;
  const employeeName = (id: string | null) => {
    const employee = employees?.find((e) => e.id === id);
    return employee ? (employee.name ?? employee.phone) : null;
  };
  const createRep = useApiMutation((body: Record<string, unknown>) => api.post("/api/distribution/sales-reps", body));
  const updateRep = useApiMutation(({ id, ...body }: { id: string } & Record<string, unknown>) =>
    api.patch(`/api/distribution/sales-reps/${id}`, body));
  const removeRep = useApiMutation((id: string) => api.delete(`/api/distribution/sales-reps/${id}`));

  const [createOpen, setCreateOpen] = useState(false);
  const [editRep, setEditRep] = useState<string | null>(null);
  const [cashRep, setCashRep] = useState<SalesRep | null>(null);
  /** Yagona "Xodim qo'shish" oynasi. */
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const resetForm = () => setForm(emptyForm());
  const saving = createRep.isPending || updateRep.isPending;

  const handleCreate = async () => {
    if (!form.name.trim()) { toast.error("Ism kiritilishi shart"); return; }
    try {
      await createRep.mutateAsync({
        name: form.name,
        phone: form.phone || null,
        email: form.email || null,
        region: form.region || null,
        monthlyTarget: form.monthlyTarget || "0",
        commission: form.commission || "0",
        ...(employees ? { userId: form.userId !== NO_USER ? form.userId : null } : {}),
      });
      toast.success("Savdo vakili qo'shildi");
      setCreateOpen(false); resetForm();
    } catch (e) { toast.error(errorMessage(e)); }
  };

  const handleUpdate = async () => {
    if (!editRep) return;
    if (!form.name.trim()) { toast.error("Ism kiritilishi shart"); return; }
    try {
      // Forma joriy qiymatlar bilan to'ldiriladi — bo'sh maydon ma'lumotni tozalaydi
      await updateRep.mutateAsync({
        id: editRep,
        name: form.name,
        phone: form.phone || null,
        email: form.email || null,
        region: form.region || null,
        ...(form.monthlyTarget ? { monthlyTarget: form.monthlyTarget } : {}),
        ...(form.commission ? { commission: form.commission } : {}),
        ...(employees ? { userId: form.userId !== NO_USER ? form.userId : null } : {}),
      });
      toast.success("Yangilandi");
      setEditRep(null); resetForm();
    } catch (e) { toast.error(errorMessage(e)); }
  };

  const openEdit = (rep: SalesRep) => {
    setForm({
      name: rep.name, phone: rep.phone ?? "", email: rep.email ?? "",
      region: rep.region ?? "", monthlyTarget: String(num(rep.monthlyTarget)),
      commission: String(num(rep.commission)),
      userId: rep.userId ?? NO_USER,
    });
    setEditRep(rep.id);
  };

  const handleDelete = async (id: string) => {
    // Lid, marshrut yoki tashrifi bor agent o'chirilmaydi — server sababini qaytaradi
    try { await removeRep.mutateAsync(id); toast.success("O'chirildi"); }
    catch (e) { toast.error(errorMessage(e)); }
  };

  const toggleActive = async (rep: SalesRep) => {
    try {
      await updateRep.mutateAsync({ id: rep.id, isActive: !rep.isActive });
      toast.success(rep.isActive ? "Faolsizlantirildi" : "Faollashtirildi");
    } catch (e) { toast.error(errorMessage(e)); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Savdo vakillari</h3>
        {/* Savdo agenti yagona "Xodim qo'shish" formasidan: rol "Sotuv agenti" bo'lsa profil ham yaratiladi */}
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Xodim qo'shish
        </Button>
      </div>

      {!reps ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}
        </div>
      ) : reps.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>Savdo vakillari yo'q</p>
          <p className="mt-1 text-xs">
            Xodim "Sotuv agenti" roli bilan qo'shilsa, profili shu yerda paydo bo'ladi.
          </p>
          <Button size="sm" className="mt-3" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Xodim qo'shish
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {reps.map((rep) => (
            <div key={rep.id} className="bg-card border border-border rounded-2xl p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold">{rep.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{rep.code}</p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Yo'ldagi naqd" onClick={() => setCashRep(rep)}>
                    <Wallet className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(rep)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => void handleDelete(rep.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5 text-sm">
                {rep.phone && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="h-3.5 w-3.5 flex-shrink-0" /> {rep.phone}
                  </div>
                )}
                {rep.email && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="h-3.5 w-3.5 flex-shrink-0" /> {rep.email}
                  </div>
                )}
                {rep.region && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5 flex-shrink-0" /> {rep.region}
                  </div>
                )}
                {rep.userId && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <KeyRound className="h-3.5 w-3.5 flex-shrink-0" /> {employeeName(rep.userId) ?? "Tizim foydalanuvchisi bog'langan"}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border">
                <div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
                    <Target className="h-3 w-3" /> Oylik maqsad
                  </div>
                  <p className="text-sm font-semibold">{fmt(num(rep.monthlyTarget))} so'm</p>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
                    <Percent className="h-3 w-3" /> Komissiya
                  </div>
                  <p className="text-sm font-semibold">{num(rep.commission)}%</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void toggleActive(rep)}
                title={rep.isActive ? "Faolsizlantirish" : "Faollashtirish"}
                className={cn(
                  "text-xs px-2 py-0.5 rounded-full w-fit cursor-pointer",
                  rep.isActive ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-muted text-muted-foreground"
                )}
              >
                {rep.isActive ? "Faol" : "Nofaol"}
              </button>
            </div>
          ))}
        </div>
      )}

      <NewEmployeeDialog open={addOpen} onClose={() => setAddOpen(false)} />
      {cashRep && <RepCashDialog rep={cashRep} onClose={() => setCashRep(null)} />}

      {/* Create / Edit dialog */}
      {(createOpen || editRep) && (
        <Dialog open onOpenChange={(o) => { if (!o) { setCreateOpen(false); setEditRep(null); resetForm(); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editRep ? "Tahrirlash" : "Yangi savdo vakili"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Ism-familiya *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Karimov Sardor" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Telefon</Label>
                  <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+998 90 ..." />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="example@email.com" />
                </div>
                <div>
                  <Label>Hudud / Viloyat</Label>
                  <Input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder="Toshkent" />
                </div>
                <div>
                  <Label>Oylik maqsad (so'm)</Label>
                  <Input type="number" min="0" value={form.monthlyTarget} onChange={(e) => setForm({ ...form, monthlyTarget: e.target.value })} placeholder="0" />
                </div>
                <div>
                  <Label>Komissiya (%)</Label>
                  <Input type="number" min="0" max="100" step="0.1" value={form.commission} onChange={(e) => setForm({ ...form, commission: e.target.value })} placeholder="5" />
                </div>
              </div>
              {employees && (
                <div>
                  <Label>Tizim foydalanuvchisi (login)</Label>
                  <Select value={form.userId} onValueChange={(v) => setForm({ ...form, userId: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_USER}>Bog'lanmagan</SelectItem>
                      {employees
                        .filter((e) => e.membershipActive)
                        .map((e) => (
                          <SelectItem key={e.id} value={e.id}>{e.name ?? e.phone} · {e.companyRole}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Bog'langan xodim "Sotuv agenti" roli bilan kirganda mobil agent ish joyi ochiladi.
                  </p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => { setCreateOpen(false); setEditRep(null); resetForm(); }}>Bekor</Button>
              <Button onClick={editRep ? handleUpdate : handleCreate} disabled={saving}>
                {saving ? "..." : editRep ? "Saqlash" : "Qo'shish"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
