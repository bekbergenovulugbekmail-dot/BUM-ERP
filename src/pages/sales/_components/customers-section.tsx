import { useState } from "react";
import { toast } from "sonner";
import { Plus, UserPlus, Phone, Mail, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { useDebounce } from "@/hooks/use-debounce.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import { num, type Customer } from "../_lib/types.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

type CustomerForm = { name: string; phone: string; email: string; address: string };

export default function CustomersSection() {
  const { can } = usePermissions();
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search.trim(), 300);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");

  const customers = useApiQuery<{ customers: Customer[] }>(
    "/api/sales/customers",
    { search: debouncedSearch || undefined },
    { placeholderData: (previous) => previous },
  ).data?.customers;
  const createCustomer = useApiMutation((body: CustomerForm) =>
    api.post("/api/sales/customers", {
      name: body.name.trim(),
      phone: body.phone || null,
      email: body.email || null,
      address: body.address || null,
    }),
  );

  const handleCreate = async () => {
    if (!name.trim()) { toast.error("Ism kiritilishi shart"); return; }
    try {
      await createCustomer.mutateAsync({ name, phone, email, address });
      toast.success("Mijoz qo'shildi");
      setCreateOpen(false);
      setName(""); setPhone(""); setEmail(""); setAddress("");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const canCreate = can("crm.manage");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Input
          className="max-w-sm"
          placeholder="Mijoz qidirish..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {canCreate && (
          <Button onClick={() => setCreateOpen(true)}>
            <UserPlus className="h-4 w-4 mr-1.5" /> Mijoz qo'shish
          </Button>
        )}
      </div>

      {!customers ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        </div>
      ) : customers.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <UserPlus className="h-12 w-12 text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground">Mijozlar yo'q</p>
          {canCreate && (
            <Button className="mt-4" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Birinchi mijozni qo'shing
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {customers.map((c) => {
            const debt = num(c.totalDebt);
            return (
              <div key={c.id} className="bg-card border border-border rounded-2xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{c.name}</p>
                    <p className="text-xs font-mono text-muted-foreground">{c.code}</p>
                  </div>
                  {debt > 0 && (
                    <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full">
                      Qarz: {fmt(debt)} so'm
                    </span>
                  )}
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  {c.phone && (
                    <div className="flex items-center gap-1.5">
                      <Phone className="h-3 w-3" />{c.phone}
                    </div>
                  )}
                  {c.email && (
                    <div className="flex items-center gap-1.5">
                      <Mail className="h-3 w-3" />{c.email}
                    </div>
                  )}
                  {c.address && (
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3 w-3" />{c.address}
                    </div>
                  )}
                </div>
                <div className="pt-1 border-t border-border/50 flex justify-between text-xs text-muted-foreground">
                  <span>Jami xarid</span>
                  <span className="font-medium">{fmt(num(c.totalPurchased))} so'm</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {createOpen && (
        <Dialog open onOpenChange={(o) => !o && setCreateOpen(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Yangi mijoz</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Ism *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mijoz ismi" />
              </div>
              <div>
                <Label>Telefon</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+998 90 123 45 67" />
              </div>
              <div>
                <Label>Email</Label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="example@email.com" />
              </div>
              <div>
                <Label>Manzil</Label>
                <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Shahar, ko'cha..." />
              </div>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setCreateOpen(false)}>Bekor</Button>
              <Button onClick={handleCreate} disabled={createCustomer.isPending}>
                {createCustomer.isPending ? "..." : "Qo'shish"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
