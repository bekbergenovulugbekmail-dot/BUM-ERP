import { useState } from "react";
import { toast } from "sonner";
import { Plus, Phone, Users, Mail, FileText, CheckSquare, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import CustomerCombobox from "@/components/customers/customer-combobox.tsx";
import type { Activity, ActivityType, CustomerOption } from "../_lib/types.ts";

const ACTIVITY_TYPES = [
  { key: "call", label: "Qo'ng'iroq", icon: Phone, color: "text-blue-500 bg-blue-500/10" },
  { key: "meeting", label: "Uchrashuv", icon: Users, color: "text-violet-500 bg-violet-500/10" },
  { key: "email", label: "Email", icon: Mail, color: "text-amber-500 bg-amber-500/10" },
  { key: "note", label: "Eslatma", icon: FileText, color: "text-slate-500 bg-slate-500/10" },
  { key: "task", label: "Vazifa", icon: CheckSquare, color: "text-emerald-500 bg-emerald-500/10" },
] as const;

const typeMap = Object.fromEntries(ACTIVITY_TYPES.map((t) => [t.key, t]));

const today = () => new Date().toISOString().slice(0, 10);
const emptyForm = () => ({
  type: "call" as ActivityType,
  title: "", description: "",
  customerId: "none",
  activityDate: today(),
  outcome: "",
});

export default function ActivitiesSection() {
  const recent = useApiQuery<{ activities: Activity[] }>("/api/crm/activities", { limit: 30 }).data?.activities;
  /** Tanlangan mijoz — qidiruvli ro'yxatdan (butun ro'yxat yuklanmaydi). */
  const [customer, setCustomer] = useState<CustomerOption | null>(null);

  const createActivity = useApiMutation((body: Record<string, unknown>) => api.post("/api/crm/activities", body));
  const removeActivity = useApiMutation((id: string) => api.delete(`/api/crm/activities/${id}`));

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const handleCreate = async () => {
    if (!form.title.trim()) { toast.error("Sarlavha kiritilishi shart"); return; }
    try {
      await createActivity.mutateAsync({
        type: form.type,
        title: form.title,
        description: form.description || null,
        customerId: form.customerId !== "none" ? form.customerId : null,
        activityDate: form.activityDate,
        outcome: form.outcome || null,
      });
      toast.success("Faoliyat qo'shildi");
      setOpen(false);
      setForm(emptyForm());
      setCustomer(null);
    } catch (e) { toast.error(errorMessage(e)); }
  };

  const handleRemove = async (id: string) => {
    try { await removeActivity.mutateAsync(id); }
    catch (e) { toast.error(errorMessage(e)); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Faoliyatlar tarixi</h3>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Qo'shish
        </Button>
      </div>

      {/* Type filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {ACTIVITY_TYPES.map((t) => (
          <div key={t.key} className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium", t.color)}>
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </div>
        ))}
      </div>

      {!recent ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : recent.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-3 opacity-20" />
          <p>Faoliyatlar yo'q</p>
          <Button size="sm" className="mt-3" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> Qo'shish</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {recent.map((act) => {
            const typeInfo = typeMap[act.type];
            const Icon = typeInfo?.icon ?? FileText;
            return (
              <div key={act.id} className="flex items-start gap-3 bg-card border border-border rounded-xl p-3">
                <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5", typeInfo?.color ?? "bg-muted text-muted-foreground")}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <p className="text-sm font-medium">{act.title}</p>
                    <span className="text-xs text-muted-foreground">{act.activityDate}</span>
                    {(act.customerName ?? act.leadName) && (
                      <span className="text-xs text-muted-foreground">· {act.customerName ?? act.leadName}</span>
                    )}
                  </div>
                  {act.description && <p className="text-xs text-muted-foreground mt-0.5">{act.description}</p>}
                  {act.outcome && <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">Natija: {act.outcome}</p>}
                </div>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleRemove(act.id)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Yangi faoliyat</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Tur</Label>
                <div className="flex gap-2 flex-wrap mt-1.5">
                  {ACTIVITY_TYPES.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setForm({ ...form, type: t.key })}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all cursor-pointer",
                        form.type === t.key ? "border-primary bg-primary/10" : "border-border hover:border-primary/30"
                      )}
                    >
                      <t.icon className="h-3.5 w-3.5" /> {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label>Sarlavha *</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Qo'ng'iroq qilindi..." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Mijoz</Label>
                  <CustomerCombobox
                    testId="activity-customer"
                    selected={customer}
                    onSelect={(next) => { setCustomer(next); setForm({ ...form, customerId: next?.id ?? "none" }); }}
                    clearLabel="—"
                  />
                </div>
                <div>
                  <Label>Sana</Label>
                  <Input type="date" value={form.activityDate} onChange={(e) => setForm({ ...form, activityDate: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Tavsif</Label>
                <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Qisqacha tavsif..." />
              </div>
              <div>
                <Label>Natija</Label>
                <Input value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })} placeholder="Kelishildi / Rad etildi..." />
              </div>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setOpen(false)}>Bekor</Button>
              <Button onClick={handleCreate} disabled={createActivity.isPending}>{createActivity.isPending ? "..." : "Saqlash"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
