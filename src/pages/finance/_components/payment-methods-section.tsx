/**
 * To'lov usullari (Moliya → Kassa) — `/api/finance/payment-methods`. Usul — sozlama: kanonik tur (naqd / karta / bank /
 * o'tkazma) va mavjud terminal yoki hisobga havola; yangi pul hisobi yaratilmaydi. Usulni kassalarga cheklash mumkin
 * (bo'sh — barcha kassalarda). Tur keyin o'zgarmaydi; usul o'chirilmaydi, faolsizlantiriladi (tarixiy to'lovlar saqlanadi).
 */
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import type { CashAccount, PaymentTerminal } from "../_lib/types.ts";

type Kind = "cash" | "card" | "bank" | "transfer";
type PaymentMethod = {
  id: string;
  name: string;
  kind: Kind;
  terminalId: string | null;
  cashAccountId: string | null;
  terminalName: string | null;
  accountName: string | null;
  showInPos: boolean;
  isActive: boolean;
  sortOrder: number;
  kassaIds: string[];
};

const PATH = "/api/finance/payment-methods";
const KIND_LABELS: Record<Kind, string> = { cash: "Naqd", card: "Karta", bank: "Bank", transfer: "O'tkazma" };
const NONE = "none";

function KassaChecklist({ kassas, value, onChange }: { kassas: CashAccount[]; value: string[]; onChange: (ids: string[]) => void }) {
  if (kassas.length === 0) return <p className="text-xs text-muted-foreground">POS kassalar yo'q — usul hamma joyda ishlaydi.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {kassas.map((kassa) => {
        const checked = value.includes(kassa.id);
        return (
          <label key={kassa.id} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onChange(checked ? value.filter((id) => id !== kassa.id) : [...value, kassa.id])}
            />
            {kassa.code ? `${kassa.code} · ${kassa.name}` : kassa.name}
          </label>
        );
      })}
    </div>
  );
}

export default function PaymentMethodsSection({ accounts }: { accounts: CashAccount[] }) {
  const methods = useApiQuery<{ paymentMethods: PaymentMethod[] }>(PATH, { includeInactive: true }).data?.paymentMethods;
  const terminals = useApiQuery<{ terminals: PaymentTerminal[] }>("/api/finance/terminals").data?.terminals ?? [];
  const kassas = accounts.filter((account) => account.type === "cash" && account.isActive && account.warehouseId);
  const moneyAccounts = accounts.filter((account) => account.type !== "cash" && account.isActive);
  const invalidate = { invalidate: [PATH, "/api/sales/pos/payment-options"] };
  const create = useApiMutation((body: object) => api.post(PATH, body), invalidate);
  const update = useApiMutation(({ id, ...patch }: { id: string } & Record<string, unknown>) => api.patch(`${PATH}/${id}`, patch), invalidate);
  const bootstrap = useApiMutation(() => api.post<{ created: PaymentMethod[] }>(`${PATH}/bootstrap`), invalidate);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("card");
  const [link, setLink] = useState(NONE);
  const [kassaIds, setKassaIds] = useState<string[]>([]);
  const [editingKassas, setEditingKassas] = useState<{ id: string; ids: string[] } | null>(null);

  const run = async (action: () => Promise<unknown>, message: string) => {
    try {
      await action();
      toast.success(message);
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    }
  };

  const submit = async () => {
    if (!name.trim()) return toast.error("Nomini kiriting");
    const [linkType, linkId] = link === NONE ? [null, null] : link.split(":");
    const ok = await run(
      () =>
        create.mutateAsync({
          name: name.trim(),
          kind,
          ...(linkType === "t" ? { terminalId: linkId } : {}),
          ...(linkType === "a" ? { cashAccountId: linkId } : {}),
          ...(kassaIds.length > 0 ? { kassaIds } : {}),
        }),
      "To'lov usuli qo'shildi",
    );
    if (ok) {
      setOpen(false);
      setName("");
      setLink(NONE);
      setKassaIds([]);
    }
  };

  const kassaLabel = (ids: string[]) =>
    ids.length === 0 ? "Barcha kassalar" : ids.map((id) => kassas.find((kassa) => kassa.id === id)?.code ?? accounts.find((a) => a.id === id)?.name ?? "?").join(", ");

  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-3" data-testid="payment-methods-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">To'lov usullari</h3>
          <p className="text-xs text-muted-foreground">Kassadagi tugmalar. Usul mavjud terminal yoki hisobga bog'lanadi — yangi hisob ochilmaydi.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={bootstrap.isPending} onClick={() => void run(() => bootstrap.mutateAsync(), "Mavjud terminallardan usullar tayyorlandi")}>
            <Wand2 className="mr-1 h-4 w-4" /> Mavjuddan tayyorlash
          </Button>
          <Button size="sm" onClick={() => setOpen(true)} data-testid="add-payment-method">
            <Plus className="mr-1 h-4 w-4" /> Usul qo'shish
          </Button>
        </div>
      </div>

      {methods && methods.length === 0 && (
        <p className="text-xs text-muted-foreground">Usullar sozlanmagan — kassada Naqd, terminallar va bank hisoblari ko'rinadi.</p>
      )}
      {methods && methods.length > 0 && (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="px-2 py-1 text-left font-medium">Nomi</th>
                <th className="px-2 py-1 text-left font-medium">Turi</th>
                <th className="px-2 py-1 text-left font-medium">Pul qayerga</th>
                <th className="px-2 py-1 text-left font-medium">Kassalar</th>
                <th className="px-2 py-1 text-center font-medium">Kassada</th>
                <th className="px-2 py-1 text-center font-medium">Faol</th>
              </tr>
            </thead>
            <tbody>
              {methods.map((method) => (
                <tr key={method.id} className="border-t border-border/60">
                  <td className="px-2 py-1.5 font-medium">{method.name}</td>
                  <td className="px-2 py-1.5">{KIND_LABELS[method.kind]}</td>
                  <td className="px-2 py-1.5 text-xs text-muted-foreground">
                    {method.kind === "cash" ? "Smena kassasi" : method.terminalName ? `Terminal: ${method.terminalName}` : method.accountName ?? "Asosiy bank hisobi"}
                  </td>
                  <td className="px-2 py-1.5 text-xs">
                    {editingKassas?.id === method.id ? (
                      <div className="space-y-1">
                        <KassaChecklist kassas={kassas} value={editingKassas.ids} onChange={(ids) => setEditingKassas({ id: method.id, ids })} />
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            className="h-7"
                            onClick={() =>
                              void run(() => update.mutateAsync({ id: method.id, kassaIds: editingKassas.ids }), "Kassalar saqlandi").then((ok) => ok && setEditingKassas(null))
                            }
                          >
                            Saqlash
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditingKassas(null)}>Bekor</Button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" className="underline decoration-dotted" onClick={() => setEditingKassas({ id: method.id, ids: method.kassaIds })}>
                        {kassaLabel(method.kassaIds)}
                      </button>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <Switch checked={method.showInPos} onCheckedChange={(showInPos) => void run(() => update.mutateAsync({ id: method.id, showInPos }), "Saqlandi")} />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <Switch checked={method.isActive} onCheckedChange={(isActive) => void run(() => update.mutateAsync({ id: method.id, isActive }), "Saqlandi")} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>To'lov usuli</DialogTitle>
            <DialogDescription>Masalan: UZCARD, HUMO, Payme, Click. Pul bog'langan terminal yoki hisobga tushadi.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nomi</Label>
              <Input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Payme" data-testid="payment-method-name" />
            </div>
            <div>
              <Label>Turi</Label>
              <Select value={kind} onValueChange={(value) => { setKind(value as Kind); setLink(NONE); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(KIND_LABELS) as Kind[]).map((key) => (
                    <SelectItem key={key} value={key}>{KIND_LABELS[key]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {kind !== "cash" && (
              <div>
                <Label>Pul qayerga tushadi</Label>
                <Select value={link} onValueChange={setLink}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Asosiy bank hisobi</SelectItem>
                    {kind === "card" && terminals.filter((t) => t.isActive).map((terminal) => (
                      <SelectItem key={terminal.id} value={`t:${terminal.id}`}>Terminal: {terminal.name}</SelectItem>
                    ))}
                    {moneyAccounts.map((account) => (
                      <SelectItem key={account.id} value={`a:${account.id}`}>{account.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Qaysi kassalarda (bo'sh — hammasida)</Label>
              <KassaChecklist kassas={kassas} value={kassaIds} onChange={setKassaIds} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>Bekor</Button>
            <Button onClick={() => void submit()} disabled={create.isPending} data-testid="payment-method-save">Saqlash</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
