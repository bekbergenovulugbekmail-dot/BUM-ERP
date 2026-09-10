import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import { Plus, Target, Percent, Phone, Mail, MapPin, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import type { Id } from "@/convex/_generated/dataModel.d.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

export default function SalesRepsSection() {
  const reps = useQuery(api.crm.salesReps.list, {});
  const createRep = useMutation(api.crm.salesReps.create);
  const updateRep = useMutation(api.crm.salesReps.update);
  const removeRep = useMutation(api.crm.salesReps.remove);

  const [createOpen, setCreateOpen] = useState(false);
  const [editRep, setEditRep] = useState<Id<"salesReps"> | null>(null);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    name: "", phone: "", email: "", region: "",
    monthlyTarget: "", commission: "",
  });

  const resetForm = () => setForm({ name: "", phone: "", email: "", region: "", monthlyTarget: "", commission: "" });

  const handleCreate = async () => {
    if (!form.name) { toast.error("Ism kiritilishi shart"); return; }
    setLoading(true);
    try {
      await createRep({
        name: form.name,
        phone: form.phone || undefined,
        email: form.email || undefined,
        region: form.region || undefined,
        monthlyTarget: parseFloat(form.monthlyTarget) || 0,
        commission: parseFloat(form.commission) || 0,
      });
      toast.success("Savdo vakili qo'shildi");
      setCreateOpen(false); resetForm();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Xatolik"); }
    finally { setLoading(false); }
  };

  const handleUpdate = async () => {
    if (!editRep) return;
    setLoading(true);
    try {
      await updateRep({
        id: editRep,
        name: form.name || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        region: form.region || undefined,
        monthlyTarget: form.monthlyTarget ? parseFloat(form.monthlyTarget) : undefined,
        commission: form.commission ? parseFloat(form.commission) : undefined,
      });
      toast.success("Yangilandi");
      setEditRep(null); resetForm();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Xatolik"); }
    finally { setLoading(false); }
  };

  const openEdit = (rep: NonNullable<typeof reps>[number]) => {
    setForm({
      name: rep.name, phone: rep.phone ?? "", email: rep.email ?? "",
      region: rep.region ?? "", monthlyTarget: String(rep.monthlyTarget),
      commission: String(rep.commission),
    });
    setEditRep(rep._id);
  };

  const handleDelete = async (id: Id<"salesReps">) => {
    try { await removeRep({ id }); toast.success("O'chirildi"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Xatolik"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Savdo vakillari</h3>
        <Button size="sm" onClick={() => { resetForm(); setCreateOpen(true); }}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Qo'shish
        </Button>
      </div>

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
            <div key={rep._id} className="bg-card border border-border rounded-2xl p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold">{rep.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{rep.code}</p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(rep)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleDelete(rep._id)}>
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
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border">
                <div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
                    <Target className="h-3 w-3" /> Oylik maqsad
                  </div>
                  <p className="text-sm font-semibold">{fmt(rep.monthlyTarget)} so'm</p>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
                    <Percent className="h-3 w-3" /> Komissiya
                  </div>
                  <p className="text-sm font-semibold">{rep.commission}%</p>
                </div>
              </div>

              <div className={cn(
                "text-xs px-2 py-0.5 rounded-full w-fit",
                rep.isActive ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-muted text-muted-foreground"
              )}>
                {rep.isActive ? "Faol" : "Nofaol"}
              </div>
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
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => { setCreateOpen(false); setEditRep(null); resetForm(); }}>Bekor</Button>
              <Button onClick={editRep ? handleUpdate : handleCreate} disabled={loading}>
                {loading ? "..." : editRep ? "Saqlash" : "Qo'shish"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
