import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { MapPin, Plus, Edit, Check } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog.tsx";

export default function BranchesSection() {
  const branches = useQuery(api.companies.listBranches);
  const createBranch = useMutation(api.companies.createBranch);
  const updateBranch = useMutation(api.companies.updateBranch);

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", code: "", address: "", city: "", phone: "", isDefault: false });
  const [loading, setLoading] = useState(false);

  const resetForm = () => {
    setForm({ name: "", code: "", address: "", city: "", phone: "", isDefault: false });
    setEditId(null);
  };

  type Branch = { _id: string; name: string; code: string; address?: string; city?: string; phone?: string; isDefault: boolean; isActive: boolean };

  const handleOpen = (branch?: Branch) => {
    if (branch) {
      setEditId(branch._id);
      setForm({
        name: branch.name,
        code: branch.code,
        address: branch.address ?? "",
        city: branch.city ?? "",
        phone: branch.phone ?? "",
        isDefault: branch.isDefault,
      });
    } else {
      resetForm();
    }
    setOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.code.trim()) {
      toast.error("Nom va kod majburiy");
      return;
    }
    setLoading(true);
    try {
      if (editId) {
        await updateBranch({
          id: editId as Parameters<typeof updateBranch>[0]["id"],
          name: form.name,
          address: form.address || undefined,
          city: form.city || undefined,
          phone: form.phone || undefined,
          isDefault: form.isDefault,
        });
        toast.success("Filial yangilandi");
      } else {
        await createBranch({
          name: form.name,
          code: form.code,
          address: form.address || undefined,
          city: form.city || undefined,
          phone: form.phone || undefined,
          isDefault: form.isDefault,
        });
        toast.success("Filial yaratildi");
      }
      setOpen(false);
      resetForm();
    } catch (e) {
      toast.error("Xatolik yuz berdi");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary" />
              Filiallar
            </CardTitle>
            <CardDescription>Kompaniyangizning barcha filiallari</CardDescription>
          </div>
          <Button size="sm" onClick={() => handleOpen()}>
            <Plus className="h-4 w-4 mr-1.5" />
            Yangi filial
          </Button>
        </CardHeader>
        <CardContent>
          {branches === undefined ? (
            <div className="text-sm text-muted-foreground py-4 text-center">Yuklanmoqda...</div>
          ) : branches.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">Hali filiallar yo'q</div>
          ) : (
            <div className="space-y-2">
              {branches.map((branch: Branch) => (
                <div key={branch._id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/30">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <MapPin className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{branch.name}</span>
                        <Badge variant="outline" className="text-xs font-mono">{branch.code}</Badge>
                        {branch.isDefault && (
                          <Badge className="text-xs">
                            <Check className="h-3 w-3 mr-1" />
                            Asosiy
                          </Badge>
                        )}
                        {!branch.isActive && <Badge variant="destructive" className="text-xs">Noaktiv</Badge>}
                      </div>
                      {(branch.city || branch.address) && (
                        <p className="text-xs text-muted-foreground">{[branch.city, branch.address].filter(Boolean).join(", ")}</p>
                      )}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleOpen(branch)}>
                    <Edit className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editId ? "Filialni tahrirlash" : "Yangi filial"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Nomi *</Label>
                <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="Asosiy filial" />
              </div>
              <div className="space-y-1.5">
                <Label>Kodi *</Label>
                <Input value={form.code} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))} placeholder="BR-001" disabled={!!editId} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Shahar</Label>
                <Input value={form.city} onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))} placeholder="Toshkent" />
              </div>
              <div className="space-y-1.5">
                <Label>Telefon</Label>
                <Input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} placeholder="+998..." />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Manzil</Label>
              <Input value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} placeholder="Ko'cha, bino" />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm((p) => ({ ...p, isDefault: e.target.checked }))} className="rounded" />
              <span className="text-sm">Asosiy filial</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>Bekor</Button>
            <Button onClick={handleSave} disabled={loading}>{loading ? "Saqlanmoqda..." : "Saqlash"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
