import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CalendarRange, Trash2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { todayLocal } from "@/pages/sales/_lib/types.ts";
import { cn } from "@/lib/utils.ts";
import { fromApiDay, toApiDay, type DistributionRoute, type RouteAssignment, type SalesRep } from "../_lib/types.ts";
import { DAY_CHIPS, DAY_NAMES } from "../_lib/schedule.ts";
import WeeklyScheduleGrid from "./weekly-schedule-grid.tsx";

const shiftDate = (iso: string, days: number) => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const WEEKDAYS = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];
const dayLabel = (iso: string) => `${iso} · ${WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]}`;

/**
 * Hudud va kun — ikki bosqich:
 *
 *  1. **Haftalik jadval (doimiy):** marshrutga agent va hafta kunlari belgilanadi. Agent o'z dasturiga
 *     kirganda shu kunga to'g'ri keladigan marshrutlari chiqadi (`routesForAgent`: sanaga biriktirish
 *     bo'lmasa, agentning o'z marshrutlari hafta kuni bo'yicha olinadi).
 *  2. **Kunlik o'zgartirish:** aniq sanaga boshqa agentni biriktirish. Shu kun uchun jadvaldan USTUN
 *     turadi (bemorlik, almashinuv), keyingi haftaga ta'sir qilmaydi.
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
  /** Haftalik jadval marshrutning o'zida saqlanadi: agenti va hafta kunlari. */
  const saveWeekly = useApiMutation(
    ({ routeId, body }: { routeId: string; body: { salesRepId: string | null; days: number[] } }) =>
      api.patch(`/api/distribution/routes/${routeId}`, body),
    { invalidate: ["/api/distribution"] },
  );

  const [form, setForm] = useState(() => ({ routeId: "", salesRepId: "", assignDate: todayLocal(), deliveryDate: "" }));
  /** Haftalik jadval formasi: kunlar UI tartibida (0 — dushanba). */
  const [weekly, setWeekly] = useState<{ routeId: string; salesRepId: string; days: number[] }>({
    routeId: "",
    salesRepId: "",
    days: [],
  });

  /** Marshrut tanlansa — uning hozirgi agenti va kunlari formaga tushadi. */
  const pickWeeklyRoute = (routeId: string) => {
    const route = routes?.find((item) => item.id === routeId);
    setWeekly({
      routeId,
      salesRepId: route?.salesRepId ?? "",
      days: (route?.days ?? []).map(fromApiDay).sort((a, b) => a - b),
    });
  };

  const toggleWeeklyDay = (day: number) =>
    setWeekly((current) => ({
      ...current,
      days: current.days.includes(day) ? current.days.filter((item) => item !== day) : [...current.days, day].sort((a, b) => a - b),
    }));

  const handleWeeklySave = async () => {
    if (!weekly.routeId) { toast.error("Marshrutni tanlang"); return; }
    if (!weekly.salesRepId) { toast.error("Agentni tanlang"); return; }
    if (weekly.days.length === 0) { toast.error("Kamida bitta hafta kunini belgilang"); return; }
    try {
      await saveWeekly.mutateAsync({
        routeId: weekly.routeId,
        body: { salesRepId: weekly.salesRepId, days: weekly.days.map(toApiDay) },
      });
      toast.success("Haftalik jadval saqlandi — agent shu kunlarda bu marshrutni ko'radi");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

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

  /**
   * Kunlar tugmasi BELGILAYDI/OLIB TASHLAYDI, almashtirmaydi. Marshrutni boshqa kunga
   * "ko'chiraman" degan odam yangi kunni bosadi-yu eskisini o'chirmaydi — natijada marshrut
   * ikki kunda yuriladi va agentga ikkala kuni ham chiqadi. Shuning uchun saqlashdan OLDIN
   * nima o'zgarayotgani va agentning o'sha kuni bandmi — shu yerda yozib turiladi.
   */
  const weeklyRoute = (routes ?? []).find((route) => route.id === weekly.routeId);
  const savedDays = (weeklyRoute?.days ?? []).map(fromApiDay).sort((a, b) => a - b);
  const addedDays = weekly.days.filter((day) => !savedDays.includes(day));
  const removedDays = savedDays.filter((day) => !weekly.days.includes(day));
  const changed = addedDays.length > 0 || removedDays.length > 0;
  /** Faqat bitta kun qo'shilgan va eskisi turibdi — "ko'chirish" niyati shu, bir bosishda bajariladi. */
  const moveTarget = addedDays.length === 1 && weekly.days.length > 1 ? addedDays[0]! : null;
  const conflicts = weekly.days
    .map((day) => ({
      day,
      others: (routes ?? []).filter(
        (route) =>
          route.id !== weekly.routeId && route.salesRepId === weekly.salesRepId && route.days.includes(toApiDay(day)),
      ),
    }))
    .filter((row) => row.others.length > 0);
  /** Agent shu kuni boshqa marshrutda band — tugmaning o'zida belgilanadi. */
  const busyDays = new Set(
    Array.from({ length: 7 }, (_, day) => day).filter((day) =>
      (routes ?? []).some(
        (route) => route.id !== weekly.routeId && route.salesRepId === weekly.salesRepId && route.days.includes(toApiDay(day)),
      ),
    ),
  );

  return (
    <div className="space-y-5">
      {/* 1-bosqich: doimiy haftalik jadval — agent har hafta shu kunlarda shu marshrutda ishlaydi */}
      <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold">Haftalik jadval (doimiy)</p>
          <p className="text-xs text-muted-foreground">
            Marshrutga agent va hafta kunlarini belgilang — agent o'z dasturiga kirganda o'sha kunning
            marshrutlari chiqadi. Har hafta takrorlanadi.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.4fr_1fr] md:items-end">
          <div>
            <Label>Marshrut (hudud)</Label>
            <Select value={weekly.routeId} onValueChange={pickWeeklyRoute}>
              <SelectTrigger data-testid="weekly-route"><SelectValue placeholder="Tanlang" /></SelectTrigger>
              <SelectContent position="popper">
                {routes?.map((route) => (
                  <SelectItem key={route.id} value={route.id}>{route.name} · {route.customerCount} ta do'kon</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Agent</Label>
            <Select
              value={weekly.salesRepId}
              onValueChange={(value) => setWeekly((current) => ({ ...current, salesRepId: value }))}
            >
              <SelectTrigger data-testid="weekly-agent"><SelectValue placeholder="Tanlang" /></SelectTrigger>
              <SelectContent position="popper">
                {reps?.map((rep) => <SelectItem key={rep.id} value={rep.id}>{rep.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label>Hafta kunlari</Label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {DAY_CHIPS.map((label, day) => (
              <button
                key={label}
                type="button"
                data-testid={`weekly-day-${day}`}
                aria-pressed={weekly.days.includes(day)}
                onClick={() => toggleWeeklyDay(day)}
                title={busyDays.has(day) ? `${DAY_NAMES[day]}: agent boshqa marshrutda band` : DAY_NAMES[day]}
                className={cn(
                  "relative h-9 w-11 rounded-lg border text-xs font-medium transition-colors cursor-pointer",
                  weekly.days.includes(day)
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-muted hover:bg-accent",
                  busyDays.has(day) && !weekly.days.includes(day) && "border-amber-500",
                )}
              >
                {label}
                {busyDays.has(day) && (
                  <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-500" />
                )}
              </button>
            ))}
          </div>
        </div>

        {weekly.routeId && (
          <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
            <p className="text-xs">
              <span className="text-muted-foreground">Hozir: </span>
              <span className="font-medium">{savedDays.length === 0 ? "kun belgilanmagan" : savedDays.map((day) => DAY_NAMES[day]).join(", ")}</span>
              {changed && (
                <>
                  <span className="text-muted-foreground"> → bo'ladi: </span>
                  <span className="font-semibold">
                    {weekly.days.length === 0 ? "kun belgilanmagan" : weekly.days.map((day) => DAY_NAMES[day]).join(", ")}
                  </span>
                </>
              )}
            </p>
            {changed && (
              <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                {addedDays.map((day) => (
                  <span key={`a${day}`} className="font-medium text-emerald-600 dark:text-emerald-400">+ {DAY_NAMES[day]}</span>
                ))}
                {removedDays.map((day) => (
                  <span key={`r${day}`} className="font-medium text-destructive">− {DAY_NAMES[day]}</span>
                ))}
              </p>
            )}
            {moveTarget !== null && (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-muted-foreground">
                  Marshrut {weekly.days.length} kunda yuriladigan bo'ladi. Faqat ko'chirmoqchimisiz?
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  data-testid="weekly-move-only"
                  onClick={() => setWeekly((current) => ({ ...current, days: [moveTarget] }))}
                >
                  Faqat {DAY_NAMES[moveTarget]} qoldirish
                </Button>
              </div>
            )}
            {conflicts.length > 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" /> Bu agent o'sha kuni allaqachon band
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {conflicts.map((row) => (
                    <li key={row.day}>
                      {DAY_NAMES[row.day]}: {row.others.map((route) => `${route.name} (${route.customerCount})`).join(", ")}
                      {" — jami "}
                      {row.others.reduce((sum, route) => sum + route.customerCount, 0) + (weeklyRoute?.customerCount ?? 0)} do'kon
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <Button data-testid="weekly-save" onClick={() => void handleWeeklySave()} disabled={saveWeekly.isPending}>
            <CalendarRange className="h-4 w-4 mr-1.5" /> {saveWeekly.isPending ? "..." : "Jadvalni saqlash"}
          </Button>
        </div>

        <WeeklyScheduleGrid routes={routes ?? []} selectedRouteId={weekly.routeId || undefined} onPick={pickWeeklyRoute} />
      </div>

      {/* 2-bosqich: aniq sanaga o'zgartirish — shu kun uchun jadvaldan ustun turadi */}
      <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold">Kunlik o'zgartirish (bir martalik)</p>
          <p className="text-xs text-muted-foreground">
            Faqat tanlangan sanaga: marshrutni boshqa agentga berish (almashinuv, bemorlik). Haftalik
            jadval o'zgarmaydi.
          </p>
        </div>
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
          Bu haftada kunlik o'zgartirish yo'q — agentlar yuqoridagi haftalik jadval bo'yicha ishlaydi
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
