/**
 * Mijozlar ro'yxati — CRM bo'limining asosiy jadvali (`/api/sales/customers`).
 *
 * Ilgari Sotuv modulining "Mijozlar" tabida edi: mijoz esa faqat sotuvga emas, kassa, distributsiya,
 * dostavka va CRM faoliyatiga ham tegishli — shuning uchun egasining qaroriga ko'ra CRM ga ko'chirildi.
 * Ma'lumot va endpointlar o'zgarmagan; Distributsiya → Mijozlar do'kon/marshrut ko'rinishi bo'lib qoladi.
 *
 * Ko'rish — `sales.view`, o'zgartirish — `crm.manage`, balansni to'g'rilash — `finance.approve`.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Plus, UserPlus, Phone, Mail, MapPin, Pencil, LocateFixed, User, Navigation, Wallet, Archive, ArchiveRestore, X } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog.tsx";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { useDebounce } from "@/hooks/use-debounce.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import SetBalanceDialog from "@/components/balances/set-balance-dialog.tsx";
import CsvToolbar from "@/components/csv/csv-toolbar.tsx";
import CustomerFilters from "@/components/customers/customer-filters.tsx";
import SuggestInput from "@/components/ui/suggest-input.tsx";
import {
  customerFilterParams,
  emptyCustomerFilter,
  type CustomerFilter,
  type CustomerRegion,
} from "@/components/customers/customer-filter.ts";
// Mijoz turi sotuv modulida ta'riflangan (`/api/sales/customers` javobi) — CRM shu turni ishlatadi
import { num, type Customer } from "@/pages/sales/_lib/types.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));


type CustomerForm = {
  name: string;
  partyType: "individual" | "legal";
  phone: string;
  email: string;
  address: string;
  contactName: string;
  taxId: string;
  bankAccount: string;
  bankMfo: string;
  latitude: string;
  longitude: string;
  city: string;
  district: string;
  creditLimit: string;
  paymentTermDays: string;
};

const emptyForm = (): CustomerForm => ({
  name: "", partyType: "individual", phone: "", email: "", address: "", contactName: "",
  taxId: "", bankAccount: "", bankMfo: "",
  latitude: "", longitude: "", city: "", district: "", creditLimit: "", paymentTermDays: "",
});

const formOf = (c: Customer): CustomerForm => ({
  name: c.name,
  partyType: c.partyType ?? "individual",
  phone: c.phone ?? "",
  email: c.email ?? "",
  address: c.address ?? "",
  contactName: c.contactName ?? "",
  taxId: c.taxId ?? "",
  bankAccount: c.bankAccount ?? "",
  bankMfo: c.bankMfo ?? "",
  latitude: c.latitude ?? "",
  longitude: c.longitude ?? "",
  city: c.city ?? "",
  district: c.district ?? "",
  creditLimit: num(c.creditLimit) > 0 ? String(num(c.creditLimit)) : "",
  paymentTermDays: c.paymentTermDays > 0 ? String(c.paymentTermDays) : "",
});

type DialogState = { mode: "create" } | { mode: "edit"; id: string } | null;

export default function CustomersSection() {
  const { can } = usePermissions();
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search.trim(), 300);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [form, setForm] = useState<CustomerForm>(emptyForm);
  const [locating, setLocating] = useState(false);
  /** Balansni to'g'rilash — moliyaviy tasdiq ruxsati bilan. */
  const canAdjustBalance = can("finance.approve");
  const [adjusting, setAdjusting] = useState<Customer | null>(null);

  /** Arxiv ko'rinishi: nofaol qilingan mijozlar (ro'yxatdan chiqarilgan, lekin tarixi saqlanadi). */
  const [showArchive, setShowArchive] = useState(false);
  /** Arxivga ko'chirish yoki qaytarish tasdig'i. */
  const [archiving, setArchiving] = useState<Customer | null>(null);

  /** Saralash: hudud, tartib va "qarzi borlar" — hammasi serverda (ro'yxat chegarasi 200 ta). */
  const [filter, setFilter] = useState<CustomerFilter>(emptyCustomerFilter);

  const loaded = useApiQuery<{ customers: Customer[] }>(
    "/api/sales/customers",
    {
      search: debouncedSearch || undefined,
      // Arxiv ko'rinishida server faol va nofaolni birga qaytaradi — nofaollari shu yerda ajratiladi
      includeInactive: showArchive || undefined,
      ...customerFilterParams(filter),
    },
    { placeholderData: (previous) => previous },
  ).data?.customers;
  const customers = loaded && (showArchive ? loaded.filter((customer) => !customer.isActive) : loaded);
  const saveCustomer = useApiMutation(({ id, body }: { id?: string; body: Record<string, unknown> }) =>
    id ? api.patch(`/api/sales/customers/${id}`, body) : api.post("/api/sales/customers", body),
  );
  const setArchived = useApiMutation(
    ({ id, isActive }: { id: string; isActive: boolean }) => api.patch(`/api/sales/customers/${id}`, { isActive }),
    { invalidate: ["/api/sales/customers", "/api/distribution"] },
  );

  /**
   * Arxivga ko'chirish — yozuv o'chirilmaydi: mijoz ro'yxatlardan (sotuv, kassa, marshrut tanlovi) chiqadi,
   * hujjatlari va tarixi joyida qoladi. Qarzi bor mijozni server arxivlamaydi.
   */
  const handleArchive = async () => {
    if (!archiving) return;
    const restore = !archiving.isActive;
    try {
      await setArchived.mutateAsync({ id: archiving.id, isActive: restore });
      toast.success(restore ? "Mijoz arxivdan qaytarildi" : "Mijoz arxivga ko'chirildi");
      setArchiving(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const set = (patch: Partial<CustomerForm>) => setForm((previous) => ({ ...previous, ...patch }));
  const openCreate = () => { setForm(emptyForm()); setDialog({ mode: "create" }); };
  const openEdit = (customer: Customer) => { setForm(formOf(customer)); setDialog({ mode: "edit", id: customer.id }); };

  const handleSave = async () => {
    if (!dialog) return;
    if (!form.name.trim()) { toast.error("Ism kiritilishi shart"); return; }
    const hasLatitude = form.latitude.trim() !== "";
    const hasLongitude = form.longitude.trim() !== "";
    if (hasLatitude !== hasLongitude) { toast.error("Kenglik va uzunlik birga kiritiladi"); return; }
    try {
      await saveCustomer.mutateAsync({
        id: dialog.mode === "edit" ? dialog.id : undefined,
        body: {
          name: form.name.trim(),
          partyType: form.partyType,
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          address: form.address.trim() || null,
          contactName: form.contactName.trim() || null,
          taxId: form.taxId.trim() || null,
          // Jismoniy shaxsda bank rekvizitlari saqlanmaydi
          bankAccount: form.partyType === "legal" ? form.bankAccount.trim() || null : null,
          bankMfo: form.partyType === "legal" ? form.bankMfo.trim() || null : null,
          // Bo'sh — koordinata o'chiriladi
          latitude: hasLatitude ? Number(form.latitude) : null,
          longitude: hasLongitude ? Number(form.longitude) : null,
          city: form.city.trim() || null,
          district: form.district.trim() || null,
          ...(form.creditLimit.trim() ? { creditLimit: form.creditLimit.trim() } : {}),
          ...(form.paymentTermDays.trim() ? { paymentTermDays: Number(form.paymentTermDays) } : {}),
        },
      });
      toast.success(dialog.mode === "edit" ? "Mijoz yangilandi" : "Mijoz qo'shildi");
      setDialog(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  // Do'kon ichida turib koordinatani olish (agent yoki supervayzer telefonidan)
  const fillCurrentLocation = () => {
    if (!("geolocation" in navigator)) { toast.error("Brauzer joylashuvni aniqlay olmaydi"); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        set({ latitude: position.coords.latitude.toFixed(6), longitude: position.coords.longitude.toFixed(6) });
        setLocating(false);
        toast.success(`Joylashuv olindi (±${Math.round(position.coords.accuracy)} m)`);
      },
      (error) => {
        setLocating(false);
        toast.error(error.code === error.PERMISSION_DENIED ? "Joylashuvga ruxsat berilmadi" : "Joylashuvni aniqlab bo'lmadi");
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  const canManage = can("crm.manage");

  /**
   * Shahar va mahalla tanlovi — HUDUDLAR MA'LUMOTNOMASIDAN (Distributsiya → Hududlar):
   * shahar/tuman darajasidagi hududlar, mahallalar esa tanlangan shahar ichidagilari.
   * Ruxsat bo'lmasa (403) yoki ma'lumotnoma bo'sh bo'lsa — mijozlarda allaqachon yozilgan qiymatlar
   * ishlatiladi (`/customers/regions`), ya'ni ro'yxat hech qachon bo'sh qolmaydi.
   * Yangi joy yozilsa, mijoz saqlanganda server uni ma'lumotnomaga ham qo'shib qo'yadi.
   */
  const regions =
    useApiQuery<{ regions: CustomerRegion[] }>("/api/sales/customers/regions", { includeInactive: true }).data
      ?.regions ?? [];
  const territories =
    useApiQuery<{ territories: { id: string; name: string; kind: string; parentId: string | null }[] }>(
      "/api/distribution/territories",
    ).data?.territories ?? [];

  const cityText = form.city.trim().toLowerCase();
  const citySuggestions = [
    ...new Set([
      ...territories.filter((territory) => territory.kind === "district").map((territory) => territory.name),
      ...regions.map((region) => region.city).filter((city): city is string => Boolean(city)),
    ]),
  ].sort();
  const selectedCity = territories.find(
    (territory) => territory.kind === "district" && territory.name.toLowerCase() === cityText,
  );
  const districtSuggestions = [
    ...new Set([
      ...territories
        .filter(
          (territory) =>
            territory.kind === "neighborhood" && (!selectedCity || territory.parentId === selectedCity.id),
        )
        .map((territory) => territory.name),
      ...regions
        .filter((region) => !cityText || region.city?.toLowerCase() === cityText)
        .map((region) => region.district)
        .filter((district): district is string => Boolean(district)),
    ]),
  ].sort();
  /** Ro'yxatda yo'q qiymat — yangi hudud bo'lib qo'shiladi (foydalanuvchi buni bilib tursin). */
  const newCity = form.city.trim() !== "" && !citySuggestions.some((city) => city.toLowerCase() === cityText);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input
          className="max-w-sm"
          placeholder="Mijoz qidirish..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <CsvToolbar
            exportUrl="/api/sales/customers/export"
            // Arxiv ko'rinishida eksport arxivdagilarni ham oladi
            exportParams={{ includeInactive: showArchive || undefined }}
            filename="mijozlar"
            importUrl="/api/sales/customers/import"
            invalidate={["/api/sales/customers"]}
            canImport={canManage}
            canUpdateExisting
            columns={[
              { key: "name", aliases: ["Nomi", "name"], required: true, example: "Anvar aka do'koni" },
              { key: "partyType", aliases: ["Turi", "partyType"], example: "Jismoniy shaxs", shared: true },
              { key: "phone", aliases: ["Telefon", "phone"], example: "+998901234567" },
              { key: "email", aliases: ["Email", "email"], example: "anvar@mail.uz" },
              { key: "address", aliases: ["Manzil", "address"], example: "Urganch, Al-Xorazmiy 12" },
              { key: "contactName", aliases: ["Mas'ul shaxs", "contactName"], example: "Anvar Karimov" },
              { key: "taxId", aliases: ["STIR", "taxId"], example: "302123456" },
              { key: "bankAccount", aliases: ["Hisob raqami", "bankAccount"], example: "20208000000000000001" },
              { key: "bankMfo", aliases: ["MFO", "bankMfo"], example: "00014" },
              { key: "city", aliases: ["Shahar/tuman", "city"], example: "Urganch", shared: true },
              { key: "district", aliases: ["Mahalla", "district"], example: "Gulobod", shared: true },
              { key: "discountPercent", aliases: ["Chegirma %", "discountPercent"], example: "5" },
              { key: "creditLimit", aliases: ["Kredit limiti", "creditLimit"], example: "1000000" },
              { key: "paymentTermDays", aliases: ["To'lov muddati (kun)", "paymentTermDays"], example: "14", shared: true },
            ]}
          />
          <Button
            size="sm"
            variant={showArchive ? "default" : "secondary"}
            data-testid="customers-archive-toggle"
            onClick={() => setShowArchive((current) => !current)}
          >
            <Archive className="h-3.5 w-3.5 mr-1" /> {showArchive ? "Faol mijozlar" : "Arxiv"}
          </Button>
          {canManage && !showArchive && (
            <Button onClick={openCreate}>
              <UserPlus className="h-4 w-4 mr-1.5" /> Mijoz qo'shish
            </Button>
          )}
        </div>
      </div>

      {/* Saralash: hudud, tartib va qarz — serverda bajariladi, ya'ni 200 ta chegarasidan tashqaridagilar ham topiladi */}
      <CustomerFilters
        value={filter}
        onChange={setFilter}
        includeInactive={showArchive}
        trailing={
          customers && (
            <span className="text-xs text-muted-foreground">
              {customers.length} ta mijoz{customers.length === 200 && " (birinchi 200 ta — qidiruvni aniqlashtiring)"}
            </span>
          )
        }
      />

      {!customers ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        </div>
      ) : customers.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          {showArchive ? <Archive className="h-12 w-12 text-muted-foreground/30 mb-3" /> : <UserPlus className="h-12 w-12 text-muted-foreground/30 mb-3" />}
          <p className="text-muted-foreground">{showArchive ? "Arxivda mijoz yo'q" : "Mijozlar yo'q"}</p>
          {canManage && !showArchive && (
            <Button className="mt-4" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" /> Birinchi mijozni qo'shing
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {customers.map((c) => {
            const debt = num(c.totalDebt);
            return (
              <div
                key={c.id}
                className={`bg-card border border-border rounded-2xl p-4 space-y-2 ${c.isActive ? "" : "opacity-70"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{c.name}</p>
                    <p className="text-xs font-mono text-muted-foreground">
                      {c.code}
                      {c.partyType === "legal" && <span className="ml-2 font-sans text-primary">Yuridik shaxs</span>}
                      {!c.isActive && <span className="ml-2 font-sans text-muted-foreground">Arxivda</span>}
                    </p>
                  </div>
                  <div className="flex items-start gap-1">
                    <div className="flex flex-col items-end gap-1">
                      {debt > 0 && (
                        <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full">
                          Qarz: {fmt(debt)} so'm
                        </span>
                      )}
                      {num(c.balance) > 0 && (
                        <span className="text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full">
                          Balans: {fmt(num(c.balance))} so'm
                        </span>
                      )}
                      {num(c.cashbackBalance) > 0 && (
                        <span className="text-xs bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 px-2 py-0.5 rounded-full">
                          Keshbek: {fmt(num(c.cashbackBalance))} so'm
                        </span>
                      )}
                    </div>
                    {canAdjustBalance && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Balansni to'g'rilash"
                        aria-label={`${c.name} balansini to'g'rilash`}
                        onClick={() => setAdjusting(c)}
                      >
                        <Wallet className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {canManage && (
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Tahrirlash" onClick={() => openEdit(c)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        data-testid={`customer-archive-${c.code}`}
                        title={c.isActive ? "Arxivga ko'chirish" : "Arxivdan qaytarish"}
                        aria-label={`${c.name} — ${c.isActive ? "arxivga ko'chirish" : "arxivdan qaytarish"}`}
                        onClick={() => setArchiving(c)}
                      >
                        {c.isActive ? <Archive className="h-3.5 w-3.5" /> : <ArchiveRestore className="h-3.5 w-3.5" />}
                      </Button>
                    )}
                    {adjusting?.id === c.id && (
                      <SetBalanceDialog
                        title={`${c.name} — balansni to'g'rilash`}
                        description="Faqat o'zgargan qiymat yuboriladi; farq buxgalteriyada boshqa daromad yoki xarajat bo'lib yopiladi"
                        fields={[
                          { key: "balance", label: "Balans (hamyon)", current: c.balance },
                          { key: "totalDebt", label: "Qarz", current: c.totalDebt },
                          { key: "cashback", label: "Keshbek", current: c.cashbackBalance },
                        ]}
                        endpoint={`/api/sales/customers/${c.id}/balance-adjust`}
                        invalidate={["/api/sales/customers"]}
                        onClose={() => setAdjusting(null)}
                      />
                    )}
                  </div>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  {c.contactName && (
                    <div className="flex items-center gap-1.5">
                      <User className="h-3 w-3" />{c.contactName}
                    </div>
                  )}
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
                  {(c.address || c.city || c.district) && (
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3 w-3" />
                      {[[c.city, c.district].filter(Boolean).join(" → "), c.address].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  {c.latitude && c.longitude && (
                    <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                      <Navigation className="h-3 w-3" />{Number(c.latitude).toFixed(5)}, {Number(c.longitude).toFixed(5)}
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

      {/* Arxivga ko'chirish / qaytarish tasdig'i — yozuv o'chirilmaydi, tarixi saqlanadi */}
      <AlertDialog open={archiving !== null} onOpenChange={(open) => !open && setArchiving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {archiving?.isActive ? "Mijozni arxivga ko'chirish" : "Mijozni arxivdan qaytarish"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {archiving?.isActive ? (
                <>
                  <b>{archiving.name}</b> ro'yxatlardan (sotuv, kassa, marshrut tanlovi) chiqadi, lekin
                  o'chirilmaydi: hujjatlari, to'lovlari va tarixi joyida qoladi. Keyin istalgan vaqtda
                  arxivdan qaytarish mumkin. Qarzi bor mijoz arxivlanmaydi — avval hisob-kitob yopiladi.
                </>
              ) : (
                <>
                  <b>{archiving?.name}</b> yana faol mijozlar ro'yxatiga qaytadi va hujjatlarda tanlanadigan
                  bo'ladi.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={setArchived.isPending}>Bekor qilish</AlertDialogCancel>
            <AlertDialogAction
              data-testid="customer-archive-confirm"
              disabled={setArchived.isPending}
              onClick={(event) => { event.preventDefault(); void handleArchive(); }}
            >
              {setArchived.isPending ? "..." : archiving?.isActive ? "Arxivga ko'chirish" : "Qaytarish"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {dialog && (
        <Dialog open onOpenChange={(o) => !o && setDialog(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{dialog.mode === "edit" ? "Mijozni tahrirlash" : "Yangi mijoz"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex gap-1">
                {(["individual", "legal"] as const).map((type) => (
                  <Button key={type} type="button" size="sm" variant={form.partyType === type ? "default" : "secondary"} onClick={() => set({ partyType: type })}>
                    {type === "individual" ? "Jismoniy shaxs" : "Yuridik shaxs"}
                  </Button>
                ))}
              </div>
              <div>
                <Label>{form.partyType === "legal" ? "Tashkilot nomi *" : "Ism *"}</Label>
                <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder={form.partyType === "legal" ? "MChJ \"Rizo Trade\"" : "Mijoz yoki do'kon nomi"} />
              </div>
              <div className={form.partyType === "legal" ? "grid grid-cols-3 gap-3" : ""}>
                <div>
                  <Label>{form.partyType === "legal" ? "STIR" : "JSHSHIR / STIR"}</Label>
                  <Input value={form.taxId} maxLength={32} onChange={(e) => set({ taxId: e.target.value })} placeholder={form.partyType === "legal" ? "9 xonali" : "Ixtiyoriy"} />
                </div>
                {form.partyType === "legal" && (
                  <>
                    <div>
                      <Label>Hisob raqami</Label>
                      <Input value={form.bankAccount} maxLength={64} onChange={(e) => set({ bankAccount: e.target.value })} placeholder="20 xonali" />
                    </div>
                    <div>
                      <Label>MFO</Label>
                      <Input value={form.bankMfo} maxLength={16} onChange={(e) => set({ bankMfo: e.target.value })} placeholder="00000" />
                    </div>
                  </>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Telefon</Label>
                  <Input value={form.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+998 90 123 45 67" />
                </div>
                <div>
                  <Label>Mas'ul shaxs</Label>
                  <Input value={form.contactName} onChange={(e) => set({ contactName: e.target.value })} placeholder="Egasi yoki sotuvchi" />
                </div>
              </div>
              <div>
                <Label>Email</Label>
                <Input value={form.email} onChange={(e) => set({ email: e.target.value })} placeholder="example@email.com" />
              </div>
              <div>
                <Label>Manzil</Label>
                <Input value={form.address} onChange={(e) => set({ address: e.target.value })} placeholder="Ko'cha, uy, mo'ljal..." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="customer-city">Shahar / tuman</Label>
                  {/* Avval kiritilgan hududlar taklif bo'lib chiqadi — har safar qo'lda yozish shart emas */}
                  <SuggestInput
                    id="customer-city"
                    testId="customer-city"
                    maxLength={100}
                    placeholder="Urganch"
                    value={form.city}
                    options={citySuggestions}
                    onChange={(city) => set({ city })}
                  />
                  {newCity && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Ro'yxatda yo'q — saqlanganda yangi shahar/tuman sifatida hududlar ma'lumotnomasiga qo'shiladi
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="customer-district">Mahalla / hudud</Label>
                  <SuggestInput
                    id="customer-district"
                    testId="customer-district"
                    maxLength={100}
                    placeholder="Luchevoy"
                    value={form.district}
                    options={districtSuggestions}
                    onChange={(district) => set({ district })}
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <Label>Joylashuv (agent masofasi va geofence)</Label>
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={fillCurrentLocation} disabled={locating}>
                    <LocateFixed className="h-3.5 w-3.5 mr-1" /> {locating ? "Aniqlanmoqda..." : "Joriy joylashuv"}
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-1">
                  <Input type="number" step="any" value={form.latitude} onChange={(e) => set({ latitude: e.target.value })} placeholder="Kenglik: 41.311081" />
                  <Input type="number" step="any" value={form.longitude} onChange={(e) => set({ longitude: e.target.value })} placeholder="Uzunlik: 69.240562" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Kredit limiti (so'm)</Label>
                  <Input type="number" min="0" value={form.creditLimit} onChange={(e) => set({ creditLimit: e.target.value })} placeholder="0 — cheklanmagan" />
                </div>
                <div>
                  <Label>To'lov muddati (kun)</Label>
                  <Input type="number" min="0" value={form.paymentTermDays} onChange={(e) => set({ paymentTermDays: e.target.value })} placeholder="0" />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setDialog(null)}>Bekor</Button>
              <Button onClick={handleSave} disabled={saveCustomer.isPending}>
                {saveCustomer.isPending ? "..." : dialog.mode === "edit" ? "Saqlash" : "Qo'shish"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
