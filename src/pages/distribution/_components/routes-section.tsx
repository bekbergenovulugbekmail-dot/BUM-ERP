import { useState } from "react";
import { toast } from "sonner";
import { Plus, Route, Users, Calendar, ChevronDown, ChevronUp, Trash2, UserPlus, Sparkles, MapPin, MapPinOff } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import CsvToolbar from "@/components/csv/csv-toolbar.tsx";
import CustomerFilters from "@/components/customers/customer-filters.tsx";
import TerritoriesDialog from "./territories-dialog.tsx";
import {
  customerFilterParams,
  emptyCustomerFilter,
  type CustomerFilter,
} from "@/components/customers/customer-filter.ts";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import {
  toApiDay,
  type CustomerOption,
  type DistributionRoute,
  type RouteDetail,
  type RouteVisit,
  type SalesRep,
  type Territory,
  type VisitStatus,
} from "../_lib/types.ts";

const DAY_LABELS = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];

const ROUTE_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#3b82f6", "#ec4899", "#14b8a6"];

const STATUS_LABELS: Record<VisitStatus, string> = {
  planned: "Rejalashtirilgan", in_progress: "Jarayonda",
  completed: "Bajarildi", cancelled: "Bekor qilindi",
};
const STATUS_COLORS: Record<VisitStatus, string> = {
  planned: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  in_progress: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  cancelled: "bg-muted text-muted-foreground",
};

const today = () => new Date().toISOString().slice(0, 10);

/** Marshrutlarni hudud bo'yicha guruhlaydi (hududsiz eski marshrutlar oxirida). */
function groupByTerritory(routes: DistributionRoute[]): [string, DistributionRoute[]][] {
  const groups = new Map<string, DistributionRoute[]>();
  for (const route of routes) {
    const key = route.territoryName ?? "Hududsiz";
    groups.set(key, [...(groups.get(key) ?? []), route]);
  }
  return [...groups.entries()].sort(([a], [b]) => (a === "Hududsiz" ? 1 : b === "Hududsiz" ? -1 : a.localeCompare(b)));
}

export default function RoutesSection() {
  const routes = useApiQuery<{ routes: DistributionRoute[] }>("/api/distribution/routes").data?.routes;
  const salesReps = useApiQuery<{ salesReps: SalesRep[] }>("/api/distribution/sales-reps").data?.salesReps;
  const territories = useApiQuery<{ territories: Territory[] }>("/api/distribution/territories").data?.territories;
  /** Marshrutga qo'shish oynasidagi ro'yxat: hudud va tartib SERVERDA saralanadi. */
  const [custFilter, setCustFilter] = useState<CustomerFilter>(emptyCustomerFilter);
  const customers = useApiQuery<{ customers: CustomerOption[] }>("/api/sales/customers", {
    limit: 500,
    ...customerFilterParams(custFilter),
  }).data?.customers;
  const visits = useApiQuery<{ visits: RouteVisit[] }>("/api/distribution/visits", { limit: 20 }).data?.visits;

  const createRoute = useApiMutation((body: Record<string, unknown>) => api.post("/api/distribution/routes", body));
  const deleteRoute = useApiMutation((id: string) => api.delete(`/api/distribution/routes/${id}`));
  /** Ro'yxatdan belgilangan mijozlar bitta so'rovda qo'shiladi; marshrutda bori `skipped` bo'lib qaytadi. */
  const addCustomers = useApiMutation(({ routeId, customerIds }: { routeId: string; customerIds: string[] }) =>
    api.post<{ added: number; skipped: number }>(`/api/distribution/routes/${routeId}/customers`, { customerIds }));
  const removeCustomer = useApiMutation(({ routeId, memberId }: { routeId: string; memberId: string }) =>
    api.delete(`/api/distribution/routes/${routeId}/customers/${memberId}`));
  const createVisit = useApiMutation((body: Record<string, unknown>) => api.post("/api/distribution/visits", body));
  const updateVisit = useApiMutation(({ id, status }: { id: string; status: VisitStatus }) =>
    api.patch(`/api/distribution/visits/${id}`, { status }));
  // Mijozlar eng qisqa yo'l tartibiga (koordinatasizlari oxirida)
  const optimizeRoute = useApiMutation((id: string) =>
    api.post<{ plan: { totalMeters: number; stops: unknown[] } }>(`/api/distribution/routes/${id}/optimize`, { apply: true }), { invalidate: ["/api/distribution"] });

  const [createOpen, setCreateOpen] = useState(false);
  /** Hududlar oynasi: marshrut hudud tarkibida bo'ladi, shuning uchun avval hudud ochiladi. */
  const [territoriesOpen, setTerritoriesOpen] = useState(false);
  const [expandedRoute, setExpandedRoute] = useState<string | null>(null);
  const [addCustOpen, setAddCustOpen] = useState<string | null>(null);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [visitDialogRoute, setVisitDialogRoute] = useState<string | null>(null);

  const [form, setForm] = useState({ name: "", territoryId: "", salesRepId: "", description: "", color: ROUTE_COLORS[0] });
  /** Qo'shish oynasi: qidiruv matni va belgilangan mijozlar. */
  const [custSearch, setCustSearch] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [visitDate, setVisitDate] = useState(today());
  const [visitNotes, setVisitNotes] = useState("");

  const expandedRouteData = useApiQuery<{ route: RouteDetail }>(
    expandedRoute ? `/api/distribution/routes/${expandedRoute}` : null,
  ).data?.route;

  const run = async (action: () => Promise<unknown>, success?: string) => {
    try {
      await action();
      if (success) toast.success(success);
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    }
  };

  const handleCreate = async () => {
    if (!form.name.trim()) { toast.error("Nom kiritilishi shart"); return; }
    if (!form.territoryId) { toast.error("Avval hududni tanlang — marshrut hudud tarkibida bo'ladi"); return; }
    const ok = await run(() => createRoute.mutateAsync({
      name: form.name,
      territoryId: form.territoryId,
      salesRepId: form.salesRepId && form.salesRepId !== "none" ? form.salesRepId : null,
      description: form.description || null,
      // UI dushanbadan boshlanadi, API — yakshanbadan
      days: selectedDays.map(toApiDay),
      color: form.color,
    }), "Marshrut qo'shildi");
    if (ok) {
      setCreateOpen(false);
      setForm({ name: "", territoryId: "", salesRepId: "", description: "", color: ROUTE_COLORS[0] });
      setSelectedDays([]);
    }
  };

  const closeAddCustomers = () => {
    setAddCustOpen(null);
    setCustSearch("");
    setPicked([]);
    setCustFilter(emptyCustomerFilter);
  };

  const handleAddCustomers = async () => {
    if (!addCustOpen || picked.length === 0) return;
    const routeId = addCustOpen;
    const ok = await run(async () => {
      const result = await addCustomers.mutateAsync({ routeId, customerIds: picked });
      toast.success(
        result.skipped > 0
          ? `${result.added} ta mijoz qo'shildi, ${result.skipped} tasi marshrutda bor edi`
          : `${result.added} ta mijoz qo'shildi`,
      );
    });
    if (ok) closeAddCustomers();
  };

  /**
   * Qo'shish oynasidagi ro'yxat: qidiruv nomi, kodi, telefoni va manzili bo'yicha filtrlaydi.
   * Marshrutda bor mijozlar ko'rinadi, lekin belgilanmaydi — takror qo'shish ma'nosiz.
   */
  const inRoute = new Set(
    addCustOpen && expandedRouteData?.id === addCustOpen
      ? expandedRouteData.customers.map((member) => member.customerId)
      : [],
  );
  const custQuery = custSearch.trim().toLowerCase();
  const filteredCustomers = (customers ?? []).filter(
    (customer) =>
      !custQuery ||
      [customer.name, customer.code, customer.phone, customer.address, customer.city, customer.district].some((field) =>
        (field ?? "").toLowerCase().includes(custQuery),
      ),
  );
  /** "Hammasi" faqat shu filtrda belgilanadigan (marshrutda bo'lmagan) mijozlarga tegishli. */
  const selectable = filteredCustomers.filter((customer) => !inRoute.has(customer.id));
  const allPicked = selectable.length > 0 && selectable.every((customer) => picked.includes(customer.id));

  const handleCreateVisit = async () => {
    if (!visitDialogRoute) return;
    // Agent ko'rsatilmasa server marshrut agentini qo'yadi
    const ok = await run(() => createVisit.mutateAsync({
      routeId: visitDialogRoute,
      visitDate,
      notes: visitNotes || null,
    }), "Tashrif rejalashtirildi");
    if (ok) { setVisitDialogRoute(null); setVisitNotes(""); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Distribyutsiya marshrutlari</h3>
        <div className="flex flex-wrap items-center gap-2">
          <CsvToolbar
            exportUrl="/api/distribution/routes/export"
            filename="marshrutlar"
            importUrl="/api/distribution/routes/import"
            invalidate={["/api/distribution/routes"]}
            canImport
            columns={[
              { key: "name", aliases: ["Nomi", "name"], required: true, example: "Luchevoy" },
              // Hudud majburiy: marshrut shu hudud tarkibida ochiladi (yo'q bo'lsa hudud yaratiladi)
              { key: "territory", aliases: ["Hudud", "territory"], required: true, example: "Urganch", shared: true },
              { key: "salesRep", aliases: ["Sotuv agenti", "salesRep"], example: "Bekzod Bekzod", shared: true },
              // 0 - yakshanba, 1 - dushanba ... 6 - shanba; bo'sh joy bilan ajratiladi
              { key: "days", aliases: ["Kunlar (0-6)", "Kunlar", "days"], example: "1 3 5", shared: true },
              { key: "description", aliases: ["Tavsif", "description"], example: "Markaziy do'konlar" },
              { key: "color", aliases: ["Rang", "color"], example: "#2563eb", shared: true },
            ]}
          />
          <Button size="sm" variant="secondary" data-testid="territories-open" onClick={() => setTerritoriesOpen(true)}>
            <MapPin className="h-3.5 w-3.5 mr-1" /> Hududlar
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Marshrut qo'shish
          </Button>
        </div>
      </div>

      {!routes ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
      ) : routes.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Route className="h-12 w-12 mx-auto mb-3 opacity-20" />
          <p>Marshrut yo'q</p>
          <Button size="sm" className="mt-3" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-1" /> Yaratish</Button>
        </div>
      ) : (
        <div className="space-y-5">
          {groupByTerritory(routes).map(([territoryName, list]) => (
            <div key={territoryName} className="space-y-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" /> {territoryName}
                <span className="font-normal normal-case tabular-nums">· {list.length} ta marshrut</span>
              </p>
              {list.map((route) => (
            <div key={route.id} className="bg-card border border-border rounded-2xl overflow-hidden">
              <div
                className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/20"
                onClick={() => setExpandedRoute(expandedRoute === route.id ? null : route.id)}
              >
                <div className="h-3 w-3 rounded-full flex-shrink-0" style={{ background: route.color ?? "#6366f1" }} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">{route.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {route.salesRepName && <span>{route.salesRepName}</span>}
                    <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {route.customerCount} ta mijoz</span>
                    <div className="flex gap-0.5">
                      {DAY_LABELS.map((d, i) => (
                        <span key={i} className={cn(
                          "w-5 h-5 rounded text-[10px] flex items-center justify-center",
                          route.days.includes(toApiDay(i)) ? "bg-primary/20 text-primary font-bold" : "text-muted-foreground"
                        )}>{d}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); setVisitDialogRoute(route.id); }}>
                    <Calendar className="h-3.5 w-3.5 mr-1" /> Tashrif
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={(e) => { e.stopPropagation(); void run(() => deleteRoute.mutateAsync(route.id), "Marshrut o'chirildi"); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                  {expandedRoute === route.id ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </div>
              </div>

              {expandedRoute === route.id && expandedRouteData && expandedRouteData.id === route.id && (
                <div className="border-t border-border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Mijozlar tartibi</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={optimizeRoute.isPending || expandedRouteData.customers.length < 2}
                        title="Mijozlarni eng qisqa yo'l tartibiga qo'yish (koordinatasizlari oxirida)"
                        onClick={() => void run(async () => {
                          const result = await optimizeRoute.mutateAsync(route.id);
                          toast.success(`Optimal tartib saqlandi · ${(result.plan.totalMeters / 1000).toFixed(1)} km`);
                        })}
                      >
                        <Sparkles className="h-3.5 w-3.5 mr-1" /> Optimal tartib
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setAddCustOpen(route.id)}>
                        <UserPlus className="h-3.5 w-3.5 mr-1" /> Mijoz qo'shish
                      </Button>
                    </div>
                  </div>
                  {expandedRouteData.customers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Mijozlar yo'q</p>
                  ) : (
                    <div className="space-y-1.5">
                      {expandedRouteData.customers.map((rc, i) => (
                        <div key={rc.id} className="flex items-center gap-3 bg-muted/30 rounded-xl px-3 py-2">
                          <span className="text-xs font-bold text-muted-foreground w-5">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <p className="flex items-center gap-1.5 text-sm font-medium">
                              {(rc.latitude === null || rc.longitude === null) && (
                                <MapPinOff className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-label="Koordinata yo'q" />
                              )}
                              {rc.customerName}
                            </p>
                            {(rc.phone || rc.city || rc.district) && (
                              <p className="text-xs text-muted-foreground">
                                {[[rc.city, rc.district].filter(Boolean).join(" → "), rc.phone].filter(Boolean).join(" · ")}
                              </p>
                            )}
                          </div>
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => void run(() => removeCustomer.mutateAsync({ routeId: route.id, memberId: rc.id }))}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Recent visits */}
      {visits && visits.length > 0 && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-sm font-semibold">So'nggi tashriflar</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground">Marshrut</th>
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground">Sana</th>
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground">Vakil</th>
                <th className="text-right px-4 py-2.5 text-xs text-muted-foreground">Mijozlar</th>
                <th className="text-right px-4 py-2.5 text-xs text-muted-foreground">Buyurtmalar</th>
                <th className="text-center px-4 py-2.5 text-xs text-muted-foreground">Holat</th>
                <th className="w-32 px-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visits.map((v) => (
                <tr key={v.id} className="hover:bg-muted/20">
                  <td className="px-4 py-2.5 font-medium">{v.routeName}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{v.visitDate}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{v.salesRepName ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right">{v.customersVisited}</td>
                  <td className="px-4 py-2.5 text-right">{v.ordersCreated}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={cn("text-xs px-2 py-0.5 rounded-full", STATUS_COLORS[v.status])}>
                      {STATUS_LABELS[v.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {/* Ketma-ketlik: rejalashtirilgan → jarayonda → bajarildi; yakunlanmagani bekor qilinadi */}
                    {(v.status === "planned" || v.status === "in_progress") && (
                      <div className="flex gap-1">
                        {v.status === "planned" && (
                          <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => void run(() => updateVisit.mutateAsync({ id: v.id, status: "in_progress" }))}>Boshlash</Button>
                        )}
                        <Button size="sm" variant="ghost" className="h-6 text-xs text-emerald-600" onClick={() => void run(() => updateVisit.mutateAsync({ id: v.id, status: "completed" }))}>Yakunlash</Button>
                        <Button size="sm" variant="ghost" className="h-6 text-xs text-destructive" onClick={() => void run(() => updateVisit.mutateAsync({ id: v.id, status: "cancelled" }))}>Bekor</Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Hududlar: avval hudud ochiladi, keyin unga marshrut qo'shiladi */}
      {territoriesOpen && <TerritoriesDialog onClose={() => setTerritoriesOpen(false)} />}

      {/* Create Route dialog */}
      {createOpen && (
        <Dialog open onOpenChange={(o) => !o && setCreateOpen(false)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Yangi marshrut</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Nomi *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Shimoliy marshrut" />
              </div>
              <div>
                <Label>Hudud *</Label>
                <Select value={form.territoryId} onValueChange={(v) => setForm({ ...form, territoryId: v })}>
                  <SelectTrigger data-testid="route-territory"><SelectValue placeholder="Tanlang" /></SelectTrigger>
                  <SelectContent>
                    {(territories ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {(territories?.length ?? 0) === 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Hudud yo'q — avval «Hududlar» dan qo'shing (masalan, Urganch).
                  </p>
                )}
              </div>
              <div>
                <Label>Savdo vakili</Label>
                <Select value={form.salesRepId} onValueChange={(v) => setForm({ ...form, salesRepId: v })}>
                  <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {salesReps?.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Tashrif kunlari</Label>
                <div className="flex gap-2 mt-1.5">
                  {DAY_LABELS.map((d, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedDays((prev) => prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i])}
                      className={cn(
                        "w-9 h-9 rounded-lg text-xs font-medium transition-all cursor-pointer border",
                        selectedDays.includes(i) ? "bg-primary text-primary-foreground border-primary" : "border-border bg-muted hover:bg-accent"
                      )}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label>Rang</Label>
                <div className="flex gap-2 mt-1.5">
                  {ROUTE_COLORS.map((c) => (
                    <button key={c} onClick={() => setForm({ ...form, color: c })}
                      className={cn("h-7 w-7 rounded-full transition-all cursor-pointer border-2", form.color === c ? "border-foreground scale-110" : "border-transparent")}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setCreateOpen(false)}>Bekor</Button>
              <Button onClick={handleCreate} disabled={createRoute.isPending}>{createRoute.isPending ? "..." : "Yaratish"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Marshrutga mijoz qo'shish: qidiruv, belgilash va "hammasi" — bir necha mijoz birdan qo'shiladi */}
      {addCustOpen && (
        <Dialog open onOpenChange={(open) => !open && closeAddCustomers()}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Marshrutga mijoz qo'shish</DialogTitle>
              <DialogDescription>
                Kerakli mijozlarni belgilang — hammasi bitta so'rovda qo'shiladi. Marshrutda bor mijoz
                ro'yxatda "marshrutda" deb turadi va qayta qo'shilmaydi.
              </DialogDescription>
            </DialogHeader>

            <Input
              autoFocus
              data-testid="route-customer-search"
              placeholder="Qidirish: nomi, telefon, manzil yoki kod..."
              value={custSearch}
              onChange={(event) => setCustSearch(event.target.value)}
            />

            {/* Hudud va tartib — Sotuv → Mijozlar dagi bilan bir xil panel (qarz bu yerda ahamiyatsiz) */}
            <CustomerFilters value={custFilter} onChange={setCustFilter} showDebt={false} />

            {!customers ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium" htmlFor="route-customer-all">
                    <Checkbox
                      id="route-customer-all"
                      data-testid="route-customer-all"
                      checked={allPicked}
                      disabled={selectable.length === 0}
                      onCheckedChange={(checked) =>
                        setPicked((current) =>
                          checked === true
                            ? [...new Set([...current, ...selectable.map((customer) => customer.id)])]
                            : current.filter((id) => !selectable.some((customer) => customer.id === id)),
                        )
                      }
                    />
                    Hammasi
                    <span className="font-normal text-muted-foreground">({selectable.length} ta)</span>
                  </label>
                  <span className="text-xs text-muted-foreground">Belgilangan: {picked.length}</span>
                </div>

                <div className="max-h-[45vh] space-y-1 overflow-y-auto rounded-lg border border-border p-1">
                  {filteredCustomers.length === 0 ? (
                    <p className="px-3 py-6 text-center text-sm text-muted-foreground">Mijoz topilmadi</p>
                  ) : (
                    filteredCustomers.map((customer) => {
                      const already = inRoute.has(customer.id);
                      const place = [customer.city, customer.district, customer.address].filter(Boolean).join(" · ");
                      return (
                        <label
                          key={customer.id}
                          htmlFor={`route-customer-${customer.id}`}
                          className={cn(
                            "flex items-start gap-3 rounded-lg px-2 py-2",
                            already ? "opacity-60" : "cursor-pointer hover:bg-muted/50",
                          )}
                        >
                          <Checkbox
                            id={`route-customer-${customer.id}`}
                            className="mt-0.5"
                            disabled={already}
                            checked={already || picked.includes(customer.id)}
                            onCheckedChange={(checked) =>
                              setPicked((current) =>
                                checked === true
                                  ? [...current, customer.id]
                                  : current.filter((id) => id !== customer.id),
                              )
                            }
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">{customer.name}</span>
                              {already && <span className="shrink-0 text-[11px] text-muted-foreground">marshrutda</span>}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {[customer.code, customer.phone, place].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </>
            )}

            <DialogFooter>
              <Button variant="secondary" onClick={closeAddCustomers} disabled={addCustomers.isPending}>Bekor</Button>
              <Button
                data-testid="route-customer-add"
                onClick={() => { void handleAddCustomers(); }}
                disabled={picked.length === 0 || addCustomers.isPending}
              >
                {addCustomers.isPending ? "..." : `Qo'shish (${picked.length})`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Create visit dialog */}
      {visitDialogRoute && (
        <Dialog open onOpenChange={(o) => !o && setVisitDialogRoute(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Tashrif rejalashtirish</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Sana</Label>
                <Input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} />
              </div>
              <div>
                <Label>Izoh</Label>
                <Input value={visitNotes} onChange={(e) => setVisitNotes(e.target.value)} placeholder="Ixtiyoriy..." />
              </div>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setVisitDialogRoute(null)}>Bekor</Button>
              <Button onClick={handleCreateVisit} disabled={createVisit.isPending}>Saqlash</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/** Hududlar ro'yxati: qo'shish, nomini o'zgartirish va o'chirish (marshruti borini o'chirib bo'lmaydi). */
