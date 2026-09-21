/**
 * Distributsiya → Mijozlar: do'konlar ro'yxati va ularni tizimga kiritishning uchta yo'li.
 *
 * "Yangi mijoz" bitta sodda tanlov oynasini ochadi:
 *   + Tezda qo'shish — bitta do'kon uchun kichik forma (nomi va telefoni majburiy);
 *   ↑ Import qilish  — .xlsx yoki .csv fayl, avval PREVIEW, keyin yozish;
 *   ↓ Excel shablon  — kutilayotgan ustunlar bilan tayyor .xlsx.
 *
 * Mijoz `customers` jadvalida saqlanadi (Savdo → Mijozlar bilan BIR XIL manba — parallel jadval yo'q).
 * "Hudud" va "Savdo agenti" esa mavjud bog'lanish orqali ishlaydi: mos FAOL marshrut topilsa mijoz
 * `route_customers` ga qo'shiladi (marshrutda hudud ham, agent ham bor). Mos marshrut topilmasa mijoz
 * baribir yaratiladi va ogohlantirish chiqadi.
 *
 * Uchala yo'l ham BITTA server tekshiruvidan o'tadi — `POST /api/sales/customers/import`
 * (tezda qo'shishda bitta qator va `requirePhone`). Shuning uchun dublikat qoidasi hamma joyda bir xil.
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import { FileDown, MapPin, Phone, Plus, Search, Upload, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { useDebounce } from "@/hooks/use-debounce.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import CsvToolbar, { type CsvToolbarHandle } from "@/components/csv/csv-toolbar.tsx";
import CustomerFilters from "@/components/customers/customer-filters.tsx";
import {
  customerFilterParams,
  emptyCustomerFilter,
  type CustomerFilter,
} from "@/components/customers/customer-filter.ts";
import type { DistributionRoute, Territory } from "../_lib/types.ts";

/** Import/tezda qo'shish ustunlari — shablon, fayl moslash va tezda qo'shish shu ro'yxatdan quriladi. */
const CUSTOMER_COLUMNS = [
  { key: "name", aliases: ["Mijoz nomi", "Nomi", "name"], required: true, example: "Anvar aka do'koni" },
  { key: "phone", aliases: ["Telefon", "phone"], required: true, example: "+998901234567" },
  { key: "contactName", aliases: ["Kontakt shaxs", "Mas'ul shaxs", "contactName"], example: "Anvar Karimov" },
  { key: "address", aliases: ["Manzil", "address"], example: "Urganch, Al-Xorazmiy 12" },
  { key: "territory", aliases: ["Hudud", "territory"], example: "Urganch" },
  { key: "notes", aliases: ["Izoh", "notes"], example: "Ertalab yetkaziladi" },
  { key: "salesRep", aliases: ["Savdo agenti", "Agent", "salesRep"], example: "Alisher Yusupov" },
  { key: "creditLimit", aliases: ["Kredit limiti", "creditLimit"], example: "1000000" },
  { key: "paymentTermDays", aliases: ["To'lov sharti", "To'lov muddati (kun)", "paymentTermDays"], example: "14" },
];

type QuickForm = {
  name: string;
  phone: string;
  contactName: string;
  address: string;
  territory: string;
  notes: string;
  salesRep: string;
  creditLimit: string;
  paymentTermDays: string;
};

const emptyQuick = (): QuickForm => ({
  name: "", phone: "", contactName: "", address: "", territory: "", notes: "", salesRep: "", creditLimit: "", paymentTermDays: "",
});

const NONE = "__none__";

type ImportIssue = { row: number; key?: string | null; message: string };
type ImportOutcome = { created: number; errors: ImportIssue[]; duplicates?: ImportIssue[]; warnings?: ImportIssue[] };

type CustomerRow = {
  id: string;
  name: string;
  code: string;
  phone: string | null;
  address: string | null;
  contactName: string | null;
  city: string | null;
  district: string | null;
};

export default function CustomersSection() {
  const { can } = usePermissions();
  const canManage = can("crm.manage");

  const [search, setSearch] = useState("");
  const [debounced] = useDebounce(search.trim(), 300);
  /** "Yangi mijoz" — uchta tanlov oynasi. */
  const [chooserOpen, setChooserOpen] = useState(false);
  const [quick, setQuick] = useState<QuickForm | null>(null);
  const toolbarRef = useRef<CsvToolbarHandle>(null);

  /** Hudud va tartib bo'yicha saralash — Sotuv → Mijozlar dagi bilan bir xil panel. */
  const [filter, setFilter] = useState<CustomerFilter>(emptyCustomerFilter);
  const customersQuery = useApiQuery<{ customers: CustomerRow[] }>("/api/sales/customers", {
    limit: 200,
    ...(debounced ? { search: debounced } : {}),
    ...customerFilterParams(filter),
  });
  const customers = customersQuery.data?.customers;

  // Hudud va agent tanlash uchun — marshrutlardan yig'iladi (mijoz marshrut orqali bog'lanadi)
  const territories = useApiQuery<{ territories: Territory[] }>("/api/distribution/territories").data?.territories;
  const routes = useApiQuery<{ routes: DistributionRoute[] }>("/api/distribution/routes").data?.routes;
  const repNames = [...new Set((routes ?? []).map((route) => route.salesRepName).filter((name): name is string => Boolean(name)))].sort();

  const saveQuick = useApiMutation(
    (form: QuickForm) =>
      api.post<ImportOutcome>("/api/sales/customers/import", {
        // Tezda qo'shish = bitta qatorli import: tekshiruv va dublikat qoidasi import bilan AYNAN bir xil
        requirePhone: true,
        rows: [
          {
            name: form.name.trim(),
            phone: form.phone.trim(),
            ...(form.contactName.trim() ? { contactName: form.contactName.trim() } : {}),
            ...(form.address.trim() ? { address: form.address.trim() } : {}),
            ...(form.territory.trim() ? { territory: form.territory.trim() } : {}),
            ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
            ...(form.salesRep.trim() ? { salesRep: form.salesRep.trim() } : {}),
            ...(form.creditLimit.trim() ? { creditLimit: form.creditLimit.trim() } : {}),
            ...(form.paymentTermDays.trim() ? { paymentTermDays: form.paymentTermDays.trim() } : {}),
          },
        ],
      }),
    { invalidate: ["/api/sales/customers", "/api/distribution/routes"] },
  );

  const handleQuickSave = async () => {
    if (!quick) return;
    if (!quick.name.trim()) { toast.error("Mijoz nomi majburiy"); return; }
    if (!quick.phone.trim()) { toast.error("Telefon majburiy"); return; }
    try {
      const outcome = await saveQuick.mutateAsync(quick);
      // Server bitta qatorni tekshirdi: xato yoki dublikat bo'lsa oyna yopilmaydi
      const problem = outcome.errors[0] ?? outcome.duplicates?.[0];
      if (outcome.created === 0) {
        toast.error(problem?.message ?? "Mijoz saqlanmadi");
        return;
      }
      for (const warning of outcome.warnings ?? []) toast.warning(warning.message);
      toast.success("Mijoz qo'shildi");
      setQuick(null); // ro'yxat yangilanadi (invalidate) va yangi mijoz darhol ko'rinadi
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const choose = (action: "quick" | "import" | "template") => {
    setChooserOpen(false);
    if (action === "quick") setQuick(emptyQuick());
    if (action === "import") toolbarRef.current?.openImport();
    if (action === "template") toolbarRef.current?.downloadTemplate();
  };

  const field = (key: keyof QuickForm, value: string) => setQuick((prev) => (prev ? { ...prev, [key]: value } : prev));

  return (
    <div className="space-y-4">
      {/* Qidiruv va yagona "Yangi mijoz" tugmasi */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Mijoz qidirish..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {canManage && (
          <Button className="w-full sm:w-auto" data-testid="dist-new-customer" onClick={() => setChooserOpen(true)}>
            <UserPlus className="h-4 w-4 mr-1.5" /> Yangi mijoz
          </Button>
        )}
      </div>

      <CustomerFilters
        value={filter}
        onChange={setFilter}
        trailing={
          customers && (
            <span className="text-xs text-muted-foreground">
              {customers.length} ta mijoz{customers.length === 200 && " (birinchi 200 ta — qidiruvni aniqlashtiring)"}
            </span>
          )
        }
      />

      {/* Tugmalari yashirilgan CsvToolbar: import va shablon "Yangi mijoz" oynasidan ochiladi */}
      <CsvToolbar
        ref={toolbarRef}
        hideToolbar
        templateFormat="xlsx"
        exportUrl="/api/sales/customers/export"
        filename="mijozlar"
        importUrl="/api/sales/customers/import"
        invalidate={["/api/sales/customers", "/api/distribution/routes"]}
        canImport={canManage}
        canUpdateExisting
        columns={CUSTOMER_COLUMNS}
      />

      {!customers ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-24 rounded-2xl" />)}
        </div>
      ) : customers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <Users className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            {debounced ? "Bunday mijoz topilmadi" : "Hali mijoz yo'q — \"Yangi mijoz\" bilan qo'shing"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3" data-testid="dist-customer-list">
          {customers.map((customer) => (
            <div key={customer.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium leading-tight">{customer.name}</p>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{customer.code}</span>
              </div>
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                {customer.phone && (
                  <p className="flex items-center gap-1.5"><Phone className="h-3 w-3" /> {customer.phone}</p>
                )}
                {(customer.address ?? customer.city) && (
                  <p className="flex items-center gap-1.5">
                    <MapPin className="h-3 w-3" /> {customer.address ?? [customer.city, customer.district].filter(Boolean).join(", ")}
                  </p>
                )}
                {customer.contactName && (
                  <p className="flex items-center gap-1.5"><UserPlus className="h-3 w-3" /> {customer.contactName}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* "Yangi mijoz": uchta sodda tanlov (telefonda ham qulay — tugmalar to'liq kenglikda) */}
      <Dialog open={chooserOpen} onOpenChange={setChooserOpen}>
        <DialogContent className="sm:max-w-md" data-testid="dist-customer-chooser">
          <DialogHeader>
            <DialogTitle>Yangi mijoz</DialogTitle>
            <DialogDescription>Qanday qo'shishni tanlang.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Button variant="outline" className="h-auto justify-start gap-3 py-3" data-testid="dist-choose-quick" onClick={() => choose("quick")}>
              <Plus className="h-5 w-5 shrink-0 text-emerald-500" />
              <span className="text-left">
                <span className="block font-medium">Tezda qo'shish</span>
                <span className="block text-xs font-normal text-muted-foreground">Bitta do'kon — nomi va telefoni</span>
              </span>
            </Button>
            <Button variant="outline" className="h-auto justify-start gap-3 py-3" data-testid="dist-choose-import" onClick={() => choose("import")}>
              <Upload className="h-5 w-5 shrink-0 text-blue-500" />
              <span className="text-left">
                <span className="block font-medium">Import qilish</span>
                <span className="block text-xs font-normal text-muted-foreground">Excel (.xlsx) yoki CSV — avval tekshiriladi</span>
              </span>
            </Button>
            <Button variant="outline" className="h-auto justify-start gap-3 py-3" data-testid="dist-choose-template" onClick={() => choose("template")}>
              <FileDown className="h-5 w-5 shrink-0 text-amber-500" />
              <span className="text-left">
                <span className="block font-medium">Excel shablon</span>
                <span className="block text-xs font-normal text-muted-foreground">Ustunlari tayyor .xlsx fayl</span>
              </span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Tezda qo'shish: kichik forma — majburiysi ikkitagina */}
      <Dialog open={quick !== null} onOpenChange={(open) => !open && !saveQuick.isPending && setQuick(null)}>
        <DialogContent className="sm:max-w-lg" data-testid="dist-quick-customer">
          <DialogHeader>
            <DialogTitle>Tezda qo'shish</DialogTitle>
            <DialogDescription>Mijoz nomi va telefoni majburiy; qolgani keyin ham to'ldiriladi.</DialogDescription>
          </DialogHeader>
          {quick && (
            <div className="grid max-h-[60vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Mijoz nomi *</Label>
                <Input data-testid="quick-name" value={quick.name} onChange={(e) => field("name", e.target.value)} placeholder="Anvar aka do'koni" />
              </div>
              <div className="space-y-1.5">
                <Label>Telefon *</Label>
                <Input data-testid="quick-phone" value={quick.phone} onChange={(e) => field("phone", e.target.value)} placeholder="+998901234567" />
              </div>
              <div className="space-y-1.5">
                <Label>Kontakt shaxs</Label>
                <Input value={quick.contactName} onChange={(e) => field("contactName", e.target.value)} placeholder="Anvar Karimov" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Manzil</Label>
                <Input value={quick.address} onChange={(e) => field("address", e.target.value)} placeholder="Urganch, Al-Xorazmiy 12" />
              </div>
              <div className="space-y-1.5">
                <Label>Hudud</Label>
                <Select value={quick.territory || NONE} onValueChange={(value) => field("territory", value === NONE ? "" : value)}>
                  <SelectTrigger data-testid="quick-territory"><SelectValue placeholder="Tanlanmagan" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Tanlanmagan</SelectItem>
                    {(territories ?? []).map((territory) => (
                      <SelectItem key={territory.id} value={territory.name}>{territory.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Savdo agenti</Label>
                <Select value={quick.salesRep || NONE} onValueChange={(value) => field("salesRep", value === NONE ? "" : value)}>
                  <SelectTrigger data-testid="quick-rep"><SelectValue placeholder="Tanlanmagan" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Tanlanmagan</SelectItem>
                    {repNames.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Kredit limiti</Label>
                <Input inputMode="decimal" value={quick.creditLimit} onChange={(e) => field("creditLimit", e.target.value)} placeholder="1000000" />
              </div>
              <div className="space-y-1.5">
                <Label>To'lov sharti (kun)</Label>
                <Input inputMode="numeric" value={quick.paymentTermDays} onChange={(e) => field("paymentTermDays", e.target.value)} placeholder="14" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Izoh</Label>
                <Input value={quick.notes} onChange={(e) => field("notes", e.target.value)} placeholder="Ertalab yetkaziladi" />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Hudud va savdo agenti tanlansa, mijoz shu hududdagi agent marshrutiga qo'shiladi.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setQuick(null)} disabled={saveQuick.isPending}>Bekor</Button>
            <Button data-testid="quick-save" onClick={() => void handleQuickSave()} disabled={saveQuick.isPending}>
              {saveQuick.isPending ? "..." : "Saqlash"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
