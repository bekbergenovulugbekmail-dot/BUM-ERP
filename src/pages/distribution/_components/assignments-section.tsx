import { useState } from "react";
import { toast } from "sonner";
import { CalendarRange, Trash2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { todayLocal } from "@/pages/sales/_lib/types.ts";
import type { DistributionRoute, RouteAssignment, SalesRep } from "../_lib/types.ts";

const shiftDate = (iso: string, days: number) => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const WEEKDAYS = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];
const dayLabel = (iso: string) => `${iso} · ${WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]}`;

/**
 * Hudud va kun: marshrutni aniq sanaga agentga biriktirish (agentning "bugungi marshruti" shundan).
 * Shu kunga biriktirilgan marshrut hafta kuni jadvalidan ustun; qayta biriktirilsa — agent almashadi.
 */
export default function AssignmentsSection() {
  const [weekStart, setWeekStart] = useState(todayLocal);
  const weekEnd = shiftDate(weekStart, 6);
  const assignments = useApiQuery<{ assignments: RouteAssignment[] }>("/api/distribution/assignments", {
    dateFrom: weekStart,
    dateTo: weekEnd,
  }).data?.assignments;
  const routes = useApiQuery<{ routes: DistributionRoute[] }>("/api/distribution/routes").data?.routes;
  const reps = useApiQuery<{ salesReps: SalesRep[] }>("/api/distribution/sales-reps").data?.salesReps;

  const assign = useApiMutation((body: Record<string, unknown>) => api.post("/api/distribution/assignments", body));
  const remove = useApiMutation((id: string) => api.delete(`/api/distribution/assignments/${id}`));

  const [form, setForm] = useState(() => ({ routeId: "", salesRepId: "", assignDate: todayLocal(), deliveryDate: "" }));

  const pickRoute = (routeId: string) => {
    // Standart agent — marshrutning o'z agenti
    const route = routes?.find((r) => r.id === routeId);
    setForm((f) => ({ ...f, routeId, salesRepId: f.salesRepId || route?.salesRepId || "" }));
  };

  const handleAssign = async () => {
    if (!form.routeId || !form.salesRepId) { toast.error("Marshrut va agentni tanlang"); return; }
    try {
      await assign.mutateAsync({
        routeId: form.routeId,
        salesRepId: form.salesRepId,
        assignDate: form.assignDate,
        deliveryDate: form.deliveryDate || null,
      });
      toast.success("Marshrut biriktirildi");
      setForm((f) => ({ ...f, routeId: "", deliveryDate: "" }));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const handleRemove = async (id: string) => {
    try { await remove.mutateAsync(id); toast.success("Biriktirish olib tashlandi"); }
    catch (err) { toast.error(errorMessage(err)); }
  };

  const byDate = new Map<string, RouteAssignment[]>();
  for (const assignment of assignments ?? []) {
    byDate.set(assignment.assignDate, [...(byDate.get(assignment.assignDate) ?? []), assignment]);
  }

  return (
    <div className="space-y-5">
      <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
        <p className="text-sm font-semibold">Marshrutni sanaga biriktirish</p>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div className="md:col-span-2">
            <Label>Marshrut (hudud)</Label>
            <Select value={form.routeId} onValueChange={pickRoute}>
              <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
              <SelectContent>
                {routes?.map((r) => <SelectItem key={r.id} value={r.id}>{r.name} · {r.customerCount} ta do'kon</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Agent</Label>
            <Select value={form.salesRepId} onValueChange={(v) => setForm((f) => ({ ...f, salesRepId: v }))}>
              <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
              <SelectContent>
                {reps?.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Sana</Label>
            <Input type="date" value={form.assignDate} onChange={(e) => setForm((f) => ({ ...f, assignDate: e.target.value }))} />
          </div>
          <div>
            <Label>Yetkazib berish kuni</Label>
            <Input type="date" min={form.assignDate} value={form.deliveryDate} onChange={(e) => setForm((f) => ({ ...f, deliveryDate: e.target.value }))} />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={handleAssign} disabled={assign.isPending}>
            <CalendarRange className="h-4 w-4 mr-1.5" /> {assign.isPending ? "..." : "Biriktirish"}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">Hafta: {weekStart} — {weekEnd}</p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setWeekStart((d) => shiftDate(d, -7))}>‹</Button>
          <Input type="date" className="h-8 w-40" value={weekStart} onChange={(e) => e.target.value && setWeekStart(e.target.value)} />
          <Button size="sm" variant="secondary" onClick={() => setWeekStart((d) => shiftDate(d, 7))}>›</Button>
        </div>
      </div>

      {!assignments ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
      ) : assignments.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm">
          Bu haftaga biriktirish yo'q — agentlar hafta kuni belgilangan marshrutlari bo'yicha ishlaydi
        </div>
      ) : (
        <div className="space-y-3">
          {[...byDate].map(([date, rows]) => (
            <div key={date} className="bg-card border border-border rounded-2xl overflow-hidden">
              <div className="px-4 py-2 border-b border-border text-xs font-semibold text-muted-foreground">{dayLabel(date)}</div>
              <div className="divide-y divide-border">
                {rows.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <div className="h-3 w-3 rounded-full shrink-0" style={{ background: a.routeColor ?? "#6366f1" }} />
                    <span className="font-medium flex-1 min-w-0 truncate">{a.routeName}</span>
                    <span className="text-muted-foreground">{a.salesRepName}</span>
                    {a.deliveryDate && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Truck className="h-3.5 w-3.5" /> {a.deliveryDate}
                      </span>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => void handleRemove(a.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
