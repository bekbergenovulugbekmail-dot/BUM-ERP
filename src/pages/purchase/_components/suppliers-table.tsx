import { useState } from "react";
import { toast } from "sonner";
import { Users, Plus, Phone, Mail, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty.tsx";
import { cn } from "@/lib/utils.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation } from "@/lib/query.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import { formatMoney, useCurrencies } from "@/hooks/use-currencies.ts";
import SetBalanceDialog from "@/components/balances/set-balance-dialog.tsx";
import CsvToolbar from "@/components/csv/csv-toolbar.tsx";
import { num, type Supplier } from "../_lib/types.ts";

type Props = { suppliers: Supplier[] | undefined };

type SupplierForm = {
  name: string;
  code: string;
  partyType: "individual" | "legal";
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  taxId: string;
  bankAccount: string;
  bankMfo: string;
  paymentTermDays: number;
  notes: string;
};

const EMPTY_FORM: SupplierForm = {
  name: "", code: "", partyType: "legal", contactPerson: "", phone: "", email: "", address: "",
  taxId: "", bankAccount: "", bankMfo: "", paymentTermDays: 30, notes: "",
};

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ", { notation: "compact" }).format(n) + " so'm";

export default function SuppliersTable({ suppliers }: Props) {
  const { can } = usePermissions();
  // Qarz valyuta bo'yicha ko'rsatiladi (asosiy valyutadagi `totalDebt` — kitob qiymati)
  const { base } = useCurrencies();
  const [createOpen, setCreateOpen] = useState(false);
  /** Qarzni to'g'rilash — moliyaviy tasdiq ruxsati bilan. */
  const canAdjustDebt = can("finance.approve");
  const [adjusting, setAdjusting] = useState<Supplier | null>(null);
  const [form, setForm] = useState<SupplierForm>(EMPTY_FORM);

  const createSupplier = useApiMutation((body: SupplierForm) =>
    api.post("/api/purchase/suppliers", {
      name: body.name,
      // Bo'sh — serverda avtomatik (S-0001)
      code: body.code.trim() || undefined,
      partyType: body.partyType,
      contactPerson: body.contactPerson || null,
      phone: body.phone || null,
      email: body.email || null,
      address: body.address || null,
      taxId: body.taxId.trim() || null,
      bankAccount: body.bankAccount.trim() || null,
      bankMfo: body.bankMfo.trim() || null,
      paymentTermDays: body.paymentTermDays,
      notes: body.notes || null,
    }),
  );

  const handleCreate = async () => {
    if (!form.name.trim()) { toast.error("Nomi kiritilishi shart"); return; }
    try {
      await createSupplier.mutateAsync(form);
      toast.success("Yetkazuvchi qo'shildi");
      setCreateOpen(false);
      setForm(EMPTY_FORM);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  if (suppliers === undefined) {
    return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>;
  }

  const canCreate = can("purchase.create");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-2">
        <p className="text-sm text-muted-foreground">{suppliers.length} ta yetkazuvchi</p>
        <div className="flex flex-wrap items-center gap-2">
          <CsvToolbar
            exportUrl="/api/purchase/suppliers/export"
            filename="taminotchilar"
            importUrl="/api/purchase/suppliers/import"
            invalidate={["/api/purchase/suppliers"]}
            canImport={canCreate}
            columns={[
              { key: "name", aliases: ["Nomi", "name"], required: true, example: "Nestle Uzbekistan" },
              { key: "code", aliases: ["Kod", "code"], example: "TA-001" },
              { key: "partyType", aliases: ["Turi", "partyType"], example: "Yuridik shaxs", shared: true },
              { key: "contactPerson", aliases: ["Mas'ul shaxs", "contactPerson"], example: "Bobur Aliyev" },
              { key: "phone", aliases: ["Telefon", "phone"], example: "+998901234567" },
              { key: "email", aliases: ["Email", "email"], example: "info@nestle.uz" },
              { key: "address", aliases: ["Manzil", "address"], example: "Toshkent, Amir Temur 1" },
              { key: "taxId", aliases: ["STIR", "taxId"], example: "302123456" },
              { key: "bankAccount", aliases: ["Hisob raqami", "bankAccount"], example: "20208000000000000001" },
              { key: "bankMfo", aliases: ["MFO", "bankMfo"], example: "00014" },
              { key: "paymentTermDays", aliases: ["To'lov muddati (kun)", "paymentTermDays"], example: "30", shared: true },
            ]}
          />
          {canCreate && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Yetkazuvchi qo'shish
            </Button>
          )}
        </div>
      </div>

      {suppliers.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Users /></EmptyMedia>
            <EmptyTitle>Yetkazuvchilar yo'q</EmptyTitle>
            <EmptyDescription>Birinchi yetkazuvchini qo'shing</EmptyDescription>
          </EmptyHeader>
          {canCreate && (
            <EmptyContent>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-1" /> Qo'shish
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {suppliers.map((s) => {
            const debt = num(s.totalDebt);
            const balances = s.balances ?? [];
            const foreignDebts = balances.some((b) => b.currency !== base) ? balances : [];
            return (
              <div key={s.id} className="border border-border rounded-xl p-4 hover:bg-muted/30 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-sm">{s.name}</h3>
                    <p className="text-xs text-muted-foreground font-mono">
                      {s.code} · <span className="font-sans">{s.partyType === "individual" ? "Jismoniy shaxs" : "Yuridik shaxs"}</span>
                      {s.taxId && <span> · STIR {s.taxId}</span>}
                    </p>
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
                    <p className="font-bold">{fmt(num(s.totalPurchased))}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Qarz</p>
                    {foreignDebts.length > 0 ? (
                      foreignDebts.map((b) => (
                        <p key={b.currency} className={cn("font-bold", num(b.debt) > 0 ? "text-amber-600" : "text-green-600")}>
                          {formatMoney(b.debt, b.currency)}
                        </p>
                      ))
                    ) : (
                      <p className={cn("font-bold", debt > 0 ? "text-amber-600" : "text-green-600")}>
                        {debt > 0 ? fmt(debt) : "Yo'q"}
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-muted-foreground">Muddat</p>
                    <p className="font-medium">{s.paymentTermDays} kun</p>
                  </div>
                </div>
                {canAdjustDebt && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-3"
                    aria-label={`${s.name} qarzini to'g'rilash`}
                    onClick={() => setAdjusting(s)}
                  >
                    Qarzni to'g'rilash
                  </Button>
                )}
                {adjusting?.id === s.id && (
                  <SetBalanceDialog
                    title={`${s.name} — qarzni to'g'rilash`}
                    description="Farq buxgalteriyada boshqa daromad yoki xarajat bo'lib kreditorlar hisobiga yoziladi"
                    fields={[{ key: "totalDebt", label: "Qarz", current: s.totalDebt }]}
                    endpoint={`/api/purchase/suppliers/${s.id}/set-debt`}
                    invalidate={["/api/purchase/suppliers"]}
                    onClose={() => setAdjusting(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create supplier dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Yangi yetkazuvchi</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-1">
              {(["legal", "individual"] as const).map((type) => (
                <Button key={type} type="button" size="sm" variant={form.partyType === type ? "default" : "secondary"} onClick={() => setForm(p => ({ ...p, partyType: type }))}>
                  {type === "legal" ? "Yuridik shaxs" : "Jismoniy shaxs"}
                </Button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>{form.partyType === "legal" ? "STIR" : "JSHSHIR / STIR"}</Label>
                <Input value={form.taxId} maxLength={32} onChange={(e) => setForm(p => ({ ...p, taxId: e.target.value }))} />
              </div>
              <div>
                <Label>Hisob raqami</Label>
                <Input value={form.bankAccount} maxLength={64} onChange={(e) => setForm(p => ({ ...p, bankAccount: e.target.value }))} />
              </div>
              <div>
                <Label>MFO</Label>
                <Input value={form.bankMfo} maxLength={16} onChange={(e) => setForm(p => ({ ...p, bankMfo: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Nomi *</Label>
                <Input value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} placeholder="OOO Rizo Trade" />
              </div>
              <div>
                <Label>Kod</Label>
                <Input value={form.code} onChange={(e) => setForm(p => ({ ...p, code: e.target.value }))} placeholder="Avtomatik (S-0001)" />
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
                <Label>To'lov muddati (kun)</Label>
                <Input type="number" min="0" value={form.paymentTermDays}
                  onChange={(e) => setForm(p => ({ ...p, paymentTermDays: e.target.valueAsNumber || 0 }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Bekor</Button>
            <Button onClick={handleCreate} disabled={createSupplier.isPending}>
              {createSupplier.isPending ? "..." : "Saqlash"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
