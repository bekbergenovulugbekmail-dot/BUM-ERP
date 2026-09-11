/**
 * Xarid oynasidan chiqmasdan yangi yetkazuvchi qo'shish. Kod serverda avtomatik (S-0001).
 */
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Truck } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation } from "@/lib/query.ts";
import type { Supplier } from "../_lib/types.ts";

type Props = {
  onClose: () => void;
  onCreated: (supplier: Supplier) => void;
};

export default function QuickSupplierDialog({ onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useApiMutation(
    (body: object) => api.post<{ supplier: Supplier }>("/api/purchase/suppliers", body),
    { invalidate: ["/api/purchase/suppliers"] },
  );

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!name.trim() || create.isPending) return;
    setError(null);
    try {
      const { supplier } = await create.mutateAsync({
        name: name.trim(),
        phone: phone.trim() || null,
        contactPerson: contactPerson.trim() || null,
      });
      toast.success(`Yetkazuvchi qo'shildi: ${supplier.name}`);
      onCreated(supplier);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-primary" />
            Yangi yetkazuvchi
          </DialogTitle>
          <DialogDescription>Saqlangach xarid buyurtmasiga darhol tanlanadi.</DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => { void handleSave(e); }} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="quick-supplier-name">Nomi *</Label>
            <Input
              id="quick-supplier-name"
              autoFocus
              value={name}
              onChange={(e) => { setName(e.target.value); setError(null); }}
              placeholder="Masalan: Artel savdo"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="quick-supplier-phone">Telefon</Label>
              <Input id="quick-supplier-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+998901234567" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quick-supplier-contact">Mas'ul shaxs</Label>
              <Input id="quick-supplier-contact" value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} />
            </div>
          </div>
          {error && (
            <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Bekor</Button>
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              {create.isPending ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Saqlanmoqda</> : "Qo'shish"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
