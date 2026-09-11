import { useState } from "react";
import { toast } from "sonner";
import { Plus, Cog, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { num, type WorkCenter, type WorkCenterType } from "../_lib/types.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

const TYPE_LABELS: Record<WorkCenterType, { label: string; color: string }> = {
  machine: { label: "Mashina", color: "text-blue-600 bg-blue-500/10" },
  labor: { label: "Mehnat", color: "text-emerald-600 bg-emerald-500/10" },
  subcontract: { label: "Subpudrat", color: "text-orange-600 bg-orange-500/10" },
};

const emptyForm = () => ({ name: "", type: "machine" as WorkCenterType, costPerHour: "" });

export default function WorkCentersSection() {
  const workCenters = useApiQuery<{ workCenters: WorkCenter[] }>("/api/manufacturing/work-centers").data?.workCenters;
  const createWC = useApiMutation((body: Record<string, unknown>) => api.post("/api/manufacturing/work-centers", body));
  const deleteWC = useApiMutation((id: string) => api.delete(`/api/manufacturing/work-centers/${id}`));

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const handleCreate = async () => {
    if (!form.name.trim()) { toast.error("Nom kiritilishi shart"); return; }
    try {
      await createWC.mutateAsync({ name: form.name, type: form.type, costPerHour: form.costPerHour || "0" });
      toast.success("Ish markazi qo'shildi");
      setOpen(false);
      setForm(emptyForm());
    } catch (e) { toast.error(errorMessage(e)); }
  };

  const handleDelete = async (id: string) => {
    // Vaqt yozuvlari bor markaz o'chirilmaydi — server sababini qaytaradi
    try { await deleteWC.mutateAsync(id); toast.success("O'chirildi"); }
    catch (e) { toast.error(errorMessage(e)); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Ish markazlari (Work Centers)</h3>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Qo'shish
        </Button>
      </div>

      {!workCenters ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
      ) : workCenters.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Cog className="h-12 w-12 mx-auto mb-3 opacity-20" />
          <p>Ish markazlari yo'q</p>
          <Button size="sm" className="mt-3" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> Qo'shish</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {workCenters.map((wc) => {
            const typeInfo = TYPE_LABELS[wc.type];
            return (
              <div key={wc.id} className="bg-card border border-border rounded-2xl p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center", typeInfo?.color ?? "bg-muted")}>
                      <Cog className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-semibold text-sm">{wc.name}</p>
                      <p className="text-xs font-mono text-muted-foreground">{wc.code}</p>
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => void handleDelete(wc.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
                <div className="flex items-center justify-between">
                  <span className={cn("text-xs px-2 py-0.5 rounded-full", typeInfo?.color ?? "bg-muted text-muted-foreground")}>
                    {typeInfo?.label ?? wc.type}
                  </span>
                  <span className="text-sm font-bold">{fmt(num(wc.costPerHour))} so'm/soat</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Yangi ish markazi</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Nomi *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="1-Tikuv mashinasi" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Turi</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as WorkCenterType })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="machine">Mashina</SelectItem>
                      <SelectItem value="labor">Mehnat</SelectItem>
                      <SelectItem value="subcontract">Subpudrat</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Soatlik narxi (so'm)</Label>
                  <Input type="number" min="0" value={form.costPerHour}
                    onChange={(e) => setForm({ ...form, costPerHour: e.target.value })} placeholder="50000" />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setOpen(false)}>Bekor</Button>
              <Button onClick={handleCreate} disabled={createWC.isPending}>{createWC.isPending ? "..." : "Qo'shish"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
