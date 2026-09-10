import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import { Plus, Route, Users, Calendar, ChevronDown, ChevronUp, Pencil, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import type { Id } from "@/convex/_generated/dataModel.d.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

const DAY_LABELS = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];
const DAY_NAMES = ["Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba", "Yakshanba"];

const ROUTE_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#3b82f6", "#ec4899", "#14b8a6"];

const STATUS_LABELS: Record<string, string> = {
  planned: "Rejalashtirilgan", in_progress: "Jarayonda",
  completed: "Bajarildi", cancelled: "Bekor qilindi",
};
const STATUS_COLORS: Record<string, string> = {
  planned: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  in_progress: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  cancelled: "bg-muted text-muted-foreground",
};

export default function DistributionSection() {
  const routes = useQuery(api.crm.distribution.listRoutes, {});
  const salesReps = useQuery(api.crm.salesReps.list, { onlyActive: true });
  const customers = useQuery(api.sales.customers.list, { limit: 500 });
  const visits = useQuery(api.crm.distribution.listVisits, { limit: 20 });

  const createRoute = useMutation(api.crm.distribution.createRoute);
  const deleteRoute = useMutation(api.crm.distribution.deleteRoute);
  const addCustomer = useMutation(api.crm.distribution.addCustomerToRoute);
  const removeCustomer = useMutation(api.crm.distribution.removeCustomerFromRoute);
  const createVisit = useMutation(api.crm.distribution.createVisit);
  const updateVisit = useMutation(api.crm.distribution.updateVisit);

  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expandedRoute, setExpandedRoute] = useState<Id<"distributionRoutes"> | null>(null);
  const [addCustOpen, setAddCustOpen] = useState<Id<"distributionRoutes"> | null>(null);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [visitDialogRoute, setVisitDialogRoute] = useState<Id<"distributionRoutes"> | null>(null);

  const [form, setForm] = useState({ name: "", salesRepId: "", description: "", color: ROUTE_COLORS[0] });
  const [addCustId, setAddCustId] = useState("");
  const [visitDate, setVisitDate] = useState(new Date().toISOString().slice(0, 10));
  const [visitNotes, setVisitNotes] = useState("");

  const expandedRouteData = useQuery(
    api.crm.distribution.getRoute,
    expandedRoute ? { id: expandedRoute } : "skip"
  );

  const handleCreate = async () => {
    if (!form.name) { toast.error("Nom kiritilishi shart"); return; }
    setLoading(true);
    try {
      await createRoute({
        name: form.name,
        salesRepId: form.salesRepId && form.salesRepId !== "none" ? form.salesRepId as Id<"salesReps"> : undefined,
        description: form.description || undefined,
        days: selectedDays,
        color: form.color,
      });
      toast.success("Marshrut qo'shildi");
      setCreateOpen(false);
      setForm({ name: "", salesRepId: "", description: "", color: ROUTE_COLORS[0] });
      setSelectedDays([]);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Xatolik"); }
    finally { setLoading(false); }
  };

  const handleAddCustomer = async () => {
    if (!addCustOpen || !addCustId || addCustId === "none") return;
    try {
      await addCustomer({ routeId: addCustOpen, customerId: addCustId as Id<"customers"> });
      toast.success("Mijoz qo'shildi");
      setAddCustOpen(null); setAddCustId("");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Xatolik"); }
  };

  const handleCreateVisit = async () => {
    if (!visitDialogRoute) return;
    try {
      const route = routes?.find((r) => r._id === visitDialogRoute);
      await createVisit({
        routeId: visitDialogRoute,
        salesRepId: route?.salesRepId as Id<"salesReps"> | undefined,
        date: visitDate,
        notes: visitNotes || undefined,
      });
      toast.success("Tashrif rejalashtirildi");
      setVisitDialogRoute(null); setVisitNotes("");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Xatolik"); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Distribyutsiya marshrutlari</h3>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Marshrut qo'shish
        </Button>
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
        <div className="space-y-3">
          {routes.map((route) => (
            <div key={route._id} className="bg-card border border-border rounded-2xl overflow-hidden">
              <div
                className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/20"
                onClick={() => setExpandedRoute(expandedRoute === route._id ? null : route._id)}
              >
                <div className="h-3 w-3 rounded-full flex-shrink-0" style={{ background: route.color ?? "#6366f1" }} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">{route.name}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    {route.repName && <span>{route.repName}</span>}
                    <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {route.customerCount} ta mijoz</span>
                    <div className="flex gap-0.5">
                      {DAY_LABELS.map((d, i) => (
                        <span key={i} className={cn(
                          "w-5 h-5 rounded text-[10px] flex items-center justify-center",
                          route.days.includes(i) ? "bg-primary/20 text-primary font-bold" : "text-muted-foreground"
                        )}>{d}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); setVisitDialogRoute(route._id); }}>
                    <Calendar className="h-3.5 w-3.5 mr-1" /> Tashrif
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={(e) => { e.stopPropagation(); deleteRoute({ id: route._id }); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                  {expandedRoute === route._id ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </div>
              </div>

              {expandedRoute === route._id && expandedRouteData && (
                <div className="border-t border-border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Mijozlar tartibi</p>
                    <Button size="sm" variant="secondary" onClick={() => setAddCustOpen(route._id)}>
                      <UserPlus className="h-3.5 w-3.5 mr-1" /> Mijoz qo'shish
                    </Button>
                  </div>
                  {expandedRouteData.customers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Mijozlar yo'q</p>
                  ) : (
                    <div className="space-y-1.5">
                      {expandedRouteData.customers.filter(Boolean).map((rc, i) => rc && (
                        <div key={rc._id} className="flex items-center gap-3 bg-muted/30 rounded-xl px-3 py-2">
                          <span className="text-xs font-bold text-muted-foreground w-5">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{rc.customerName}</p>
                            {rc.phone && <p className="text-xs text-muted-foreground">{rc.phone}</p>}
                          </div>
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => removeCustomer({ id: rc._id })}>
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
                <th className="w-24 px-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visits.map((v) => (
                <tr key={v._id} className="hover:bg-muted/20">
                  <td className="px-4 py-2.5 font-medium">{v.routeName}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{v.date}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{v.repName ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right">{v.customersVisited}</td>
                  <td className="px-4 py-2.5 text-right">{v.ordersCreated}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={cn("text-xs px-2 py-0.5 rounded-full", STATUS_COLORS[v.status])}>
                      {STATUS_LABELS[v.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {v.status === "planned" && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => updateVisit({ id: v._id, status: "in_progress" })}>Boshlash</Button>
                        <Button size="sm" variant="ghost" className="h-6 text-xs text-emerald-600" onClick={() => updateVisit({ id: v._id, status: "completed" })}>Yakunlash</Button>
                      </div>
                    )}
                    {v.status === "in_progress" && (
                      <Button size="sm" variant="ghost" className="h-6 text-xs text-emerald-600" onClick={() => updateVisit({ id: v._id, status: "completed" })}>Yakunlash</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
                <Label>Savdo vakili</Label>
                <Select value={form.salesRepId} onValueChange={(v) => setForm({ ...form, salesRepId: v })}>
                  <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {salesReps?.map((r) => <SelectItem key={r._id} value={r._id}>{r.name}</SelectItem>)}
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
              <Button onClick={handleCreate} disabled={loading}>{loading ? "..." : "Yaratish"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Add customer dialog */}
      {addCustOpen && (
        <Dialog open onOpenChange={(o) => !o && setAddCustOpen(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Marshrut ga mijoz qo'shish</DialogTitle></DialogHeader>
            <div>
              <Label>Mijoz</Label>
              <Select value={addCustId} onValueChange={setAddCustId}>
                <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {customers?.map((c) => <SelectItem key={c._id} value={c._id}>{c.name} — {c.phone ?? ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setAddCustOpen(null)}>Bekor</Button>
              <Button onClick={handleAddCustomer}>Qo'shish</Button>
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
              <Button onClick={handleCreateVisit}>Saqlash</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
