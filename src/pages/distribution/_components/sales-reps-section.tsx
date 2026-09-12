import { useState } from "react";
import { toast } from "sonner";
import { Plus, Target, Percent, Phone, Mail, MapPin, Pencil, Trash2, KeyRound } from "lucide-react";
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
import { useTranslation } from "react-i18next";
import CreateAgentDialog from "@/components/sales-agent/create-agent-dialog.tsx";
import { num, type SalesRep } from "../_lib/types.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

const NO_USER = "none";

const emptyForm = () => ({ name: "", phone: "", email: "", region: "", monthlyTarget: "", commission: "", userId: NO_USER });

/** `GET /api/company/employees` — agentga bog'lanadigan tizim foydalanuvchisi (login). */
type EmployeeOption = { id: string; name: string | null; phone: string; companyRole: string; membershipActive: boolean };

export default function SalesRepsSection() {
  const { t } = useTranslation("distribution");
  const { can } = usePermissions();
  const [agentOpen, setAgentOpen] = useState(false);
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
        <div className="flex gap-2">
          {can("sales_agent.agents.manage") && (
            <Button size="sm" onClick={() => setAgentOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> {t("team.add")}
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => { resetForm(); setCreateOpen(true); }}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Qo'shish
          </Button>
        </div>
      </div>
      {agentOpen && <CreateAgentDialog onClose={() => setAgentOpen(false)} />}

      {!reps ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}
        </div>
      ) : reps.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>Savdo vakillari yo'q</p>
          <Button size="sm" className="mt-3" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-1" /> Qo'shish</Button>
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
