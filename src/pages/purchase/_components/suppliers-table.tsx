import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import { Users, Plus, Phone, Mail, MapPin, Edit, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty.tsx";
import { cn } from "@/lib/utils.ts";
import type { Id } from "@/convex/_generated/dataModel.d.ts";

type Supplier = {
  _id: Id<"suppliers">;
  name: string;
  code: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  currency: string;
  paymentTermDays: number;
  isActive: boolean;
  totalDebt: number;
  totalPurchased: number;
};

type Props = { suppliers: Supplier[] | undefined };

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ", { notation: "compact" }).format(n) + " so'm";

export default function SuppliersTable({ suppliers }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    name: "", code: "", contactPerson: "", phone: "", email: "",
    address: "", currency: "UZS", paymentTermDays: 30, notes: "",
  });

  const createSupplier = useMutation(api.purchase.suppliers.create);
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!form.name || !form.code) { toast.error("Nomi va kod kiritilishi shart"); return; }
    setLoading(true);
    try {
      await createSupplier({
        name: form.name, code: form.code,
        contactPerson: form.contactPerson || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        address: form.address || undefined,
        currency: form.currency,
        paymentTermDays: form.paymentTermDays,
        notes: form.notes || undefined,
      });
      toast.success("Yetkazuvchi qo'shildi");
      setCreateOpen(false);
      setForm({ name: "", code: "", contactPerson: "", phone: "", email: "", address: "", currency: "UZS", paymentTermDays: 30, notes: "" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Xatolik");
    } finally { setLoading(false); }
  };

  if (suppliers === undefined) {
    return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{suppliers.length} ta yetkazuvchi</p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Yetkazuvchi qo'shish
        </Button>
      </div>

      {suppliers.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Users /></EmptyMedia>
            <EmptyTitle>Yetkazuvchilar yo'q</EmptyTitle>
            <EmptyDescription>Birinchi yetkazuvchini qo'shing</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Qo'shish
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {suppliers.map((s) => (
            <div key={s._id} className="border border-border rounded-xl p-4 hover:bg-muted/30 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-sm">{s.name}</h3>
                  <p className="text-xs text-muted-foreground font-mono">{s.code}</p>
                </div>
                <Badge variant={s.isActive ? "secondary" : "outline"} className="text-[10px]">
                  {s.isActive ? "Faol" : "Nofaol"}
                </Badge>
              </div>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                {s.phone && <div className="flex items-center gap-1.5"><Phone className="h-3 w-3" />{s.phone}</div>}
                {s.email && <div className="flex items-center gap-1.5"><Mail className="h-3 w-3" />{s.email}</div>}
                {s.address && <div className="flex items-center gap-1.5"><MapPin className="h-3 w-3" />{s.address}</div>}
              </div>
              <div className="mt-3 pt-3 border-t border-border flex gap-4 text-xs">
                <div>
                  <p className="text-muted-foreground">Jami xarid</p>
                  <p className="font-bold">{fmt(s.totalPurchased)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Qarz</p>
                  <p className={cn("font-bold", s.totalDebt > 0 ? "text-amber-600" : "text-green-600")}>
                    {s.totalDebt > 0 ? fmt(s.totalDebt) : "Yo'q"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Muddat</p>
                  <p className="font-medium">{s.paymentTermDays} kun</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create supplier dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Yangi yetkazuvchi</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Nomi *</Label>
                <Input value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} placeholder="OOO Rizo Trade" />
              </div>
              <div>
                <Label>Kod *</Label>
                <Input value={form.code} onChange={(e) => setForm(p => ({ ...p, code: e.target.value }))} placeholder="SUP-001" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Mas'ul shaxs</Label>
                <Input value={form.contactPerson} onChange={(e) => setForm(p => ({ ...p, contactPerson: e.target.value }))} placeholder="Ismi" />
              </div>
              <div>
                <Label>Telefon</Label>
                <Input value={form.phone} onChange={(e) => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="+998 90 123 45 67" />
              </div>
            </div>
            <div>
              <Label>Email</Label>
              <Input value={form.email} onChange={(e) => setForm(p => ({ ...p, email: e.target.value }))} placeholder="info@company.uz" />
            </div>
            <div>
              <Label>Manzil</Label>
              <Input value={form.address} onChange={(e) => setForm(p => ({ ...p, address: e.target.value }))} placeholder="Toshkent, ..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Valyuta</Label>
                <Select value={form.currency} onValueChange={(v) => setForm(p => ({ ...p, currency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UZS">UZS</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>To'lov muddati (kun)</Label>
                <Input type="number" min="0" value={form.paymentTermDays}
                  onChange={(e) => setForm(p => ({ ...p, paymentTermDays: e.target.valueAsNumber || 0 }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Bekor</Button>
            <Button onClick={handleCreate} disabled={loading}>{loading ? "..." : "Saqlash"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
