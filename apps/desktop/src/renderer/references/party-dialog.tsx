import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import type { PosCustomer, PosSupplier } from "../../shared/kassa-api.js";
import type { PartyType } from "../../shared/sync-types.js";
import { call, errorText } from "../kassa.ts";

type Kind = "customer" | "supplier";
type Party = PosCustomer | PosSupplier;

type Form = {
  partyType: PartyType;
  name: string;
  phone: string;
  contact: string;
  email: string;
  address: string;
  taxId: string;
  bankAccount: string;
  bankMfo: string;
  notes: string;
};

function formOf(kind: Kind, party: Party | null): Form {
  return {
    partyType: party?.partyType ?? (kind === "customer" ? "individual" : "legal"),
    name: party?.name ?? "",
    phone: party?.phone ?? "",
    contact: (party && ("contactName" in party ? party.contactName : party.contactPerson)) ?? "",
    email: party?.email ?? "",
    address: party?.address ?? "",
    taxId: party?.taxId ?? "",
    bankAccount: party?.bankAccount ?? "",
    bankMfo: party?.bankMfo ?? "",
    notes: party?.notes ?? "",
  };
}

/**
 * Mijoz yoki ta'minotchi: jismoniy/yuridik shaxs, rekvizitlar (STIR, hisob raqami, MFO). Yangi — internet shart emas;
 * tahrir — faqat o'zgargan maydonlar serverga boradi. Ochilganda `key` bilan qayta yaratiladi (forma boshlang'ich holati).
 */
export default function PartyDialog({
  kind,
  party,
  onClose,
  onSaved,
}: {
  kind: Kind;
  /** null — yangi. */
  party: Party | null;
  onClose: () => void;
  onSaved: (party: Party) => void;
}) {
  const [form, setForm] = useState<Form>(() => formOf(kind, party));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Form>) => setForm((current) => ({ ...current, ...patch }));
  const legal = form.partyType === "legal";

  const submit = async () => {
    setBusy(true);
    setError(null);
    const common = {
      partyType: form.partyType,
      name: form.name,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      taxId: form.taxId.trim() || null,
      // Jismoniy shaxsda bank rekvizitlari saqlanmaydi
      bankAccount: legal ? form.bankAccount.trim() || null : null,
      bankMfo: legal ? form.bankMfo.trim() || null : null,
      notes: form.notes.trim() || null,
    };
    try {
      let saved: Party;
      if (kind === "customer") {
        const body = { ...common, contactName: form.contact.trim() || null };
        saved = party ? await call("ref:customer-update", { customerId: party.id, ...body }) : await call("pos:customer-create", body);
      } else {
        const body = { ...common, contactPerson: form.contact.trim() || null };
        saved = party ? await call("ref:supplier-update", { supplierId: party.id, ...body }) : await call("purchase:supplier-create", body);
      }
      onSaved(saved);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const title = `${party ? "Tahrirlash" : kind === "customer" ? "Yangi mijoz" : "Yangi ta'minotchi"}${party ? `: ${party.name}` : ""}`;

  return (
    <Dialog open onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Internet bo'lmasa ham saqlanadi. Tahrirda faqat o'zgargan maydonlar yuboriladi — orada web'da o'zgargan maydon ustiga yozilmaydi.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex gap-1">
            {(["individual", "legal"] as const).map((type) => (
              <Button key={type} type="button" size="sm" variant={form.partyType === type ? "default" : "secondary"} onClick={() => set({ partyType: type })}>
                {type === "individual" ? "Jismoniy shaxs" : "Yuridik shaxs"}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="party-name">{legal ? "Tashkilot nomi" : "F.I.Sh."}</Label>
              <Input id="party-name" autoFocus maxLength={200} value={form.name} onChange={(e) => set({ name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="party-phone">Telefon</Label>
              <Input id="party-phone" inputMode="tel" maxLength={20} placeholder="+998 90 123 45 67" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="party-contact">{legal ? "Rahbar yoki mas'ul shaxs" : "Mas'ul shaxs"}</Label>
              <Input id="party-contact" maxLength={200} value={form.contact} onChange={(e) => set({ contact: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="party-email">Email</Label>
              <Input id="party-email" type="email" maxLength={255} value={form.email} onChange={(e) => set({ email: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="party-address">{legal ? "Yuridik manzil" : "Manzil"}</Label>
            <Input id="party-address" maxLength={1000} value={form.address} onChange={(e) => set({ address: e.target.value })} />
          </div>
          <div className={`grid gap-3 ${legal ? "grid-cols-3" : "grid-cols-1"}`}>
            <div className="space-y-1">
              <Label htmlFor="party-tax">{legal ? "STIR" : "JSHSHIR / STIR (ixtiyoriy)"}</Label>
              <Input id="party-tax" inputMode="numeric" maxLength={32} value={form.taxId} onChange={(e) => set({ taxId: e.target.value })} />
            </div>
            {legal && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="party-bank-account">Hisob raqami</Label>
                  <Input id="party-bank-account" inputMode="numeric" maxLength={64} value={form.bankAccount} onChange={(e) => set({ bankAccount: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="party-bank-mfo">Bank MFO</Label>
                  <Input id="party-bank-mfo" inputMode="numeric" maxLength={16} value={form.bankMfo} onChange={(e) => set({ bankMfo: e.target.value })} />
                </div>
              </>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="party-notes">Izoh</Label>
            <Input id="party-notes" maxLength={2000} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          </div>
          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Bekor qilish
            </Button>
            <Button type="submit" disabled={busy || form.name.trim() === ""}>
              Saqlash
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
