/**
 * REYSLAR — "Yetkazishga chiqadiganlar" → hammasini tanlash → reys (yetkazuvchi × ombor × kun) → uchta hujjat:
 * mijoz nakladnoylari, omborchining yig'ma ro'yxati (2 nusxa), yetkazuvchining marshrut varag'i.
 *
 * Hujjatlar reys SNAPSHOTidan chiqadi (keyingi o'zgarishlar ularni bir-biridan ajratmaydi) va chop etishdan oldin
 * solishtiriladi (`reconcileTrip`). Terish va yuklash faqat qayd — ombordan chiqim yetkazma "boshlash"ida (Z2).
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, FileStack, PackageCheck, Printer, Route, Truck, XCircle } from "lucide-react";
import type { DocumentTemplateSchema } from "@bum/shared";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { useActiveCompany, usePermissions } from "@/hooks/use-company.ts";
import { useCurrentUser } from "@/hooks/use-auth.ts";
import { cn } from "@/lib/utils.ts";
import { PICK_STATUS_LABELS, TRIP_STATUS_LABELS, reconcileTrip, type Trip } from "@/lib/delivery/trip-documents.ts";
import type { SingleDeliveryWaybill } from "@/lib/pdf/delivery-waybill-pdf.ts";

type TripRow = { id: string; number: string; tripDate: string; status: Trip["status"]; totalAmount: string; agentName: string | null; tasks: number; warehouseName: string | null };

const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

export default function TripsSection({ money }: { money: (value: string | number) => string }) {
  const { can } = usePermissions();
  const [date, setDate] = useState(localToday);
  const [openId, setOpenId] = useState<string | null>(null);
  const outgoing = useApiQuery<{ taskIds: string[] }>("/api/delivery/trips/outgoing", { date });
  const trips = useApiQuery<{ trips: TripRow[] }>("/api/delivery/trips", { date });
  const create = useApiMutation((taskIds: string[]) => api.post<{ trips: Trip[] }>("/api/delivery/trips", { taskIds }), {
    invalidate: ["/api/delivery/trips", "/api/delivery/tasks"],
  });
  const count = outgoing.data?.taskIds.length ?? 0;

  const createAll = async () => {
    const ids = outgoing.data?.taskIds ?? [];
    if (ids.length === 0) return;
    try {
      const result = await create.mutateAsync(ids);
      toast.success(`${result.trips.length} ta reys tuzildi (${ids.length} ta yetkazma)`);
      if (result.trips[0]) setOpenId(result.trips[0].id);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-4" data-testid="trips-section">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-4">
        <div className="space-y-1">
          <Label htmlFor="trips-date">Sana</Label>
          <Input id="trips-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} className="w-44" />
        </div>
        <div className="text-sm">
          <p className="font-medium">Yetkazishga chiqadiganlar: <span data-testid="trips-outgoing-count">{count}</span> ta</p>
          <p className="text-xs text-muted-foreground">Yetkazuvchiga biriktirilgan, hali yo'lga chiqmagan va reysga kirmagan — hammasi (sahifadagi emas)</p>
        </div>
        {can("delivery.manage") && (
          <Button className="ml-auto" data-testid="trips-create-all" disabled={count === 0 || create.isPending} onClick={() => void createAll()}>
            <Route className="mr-1.5 h-4 w-4" /> Hammasini tanlab reys tuzish
          </Button>
        )}
      </div>

      {trips.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Reys</th>
                <th className="px-3 py-2 text-left">Yetkazuvchi</th>
                <th className="px-3 py-2 text-left">Ombor</th>
                <th className="px-3 py-2 text-right">Mijozlar</th>
                <th className="px-3 py-2 text-right">Summa</th>
                <th className="px-3 py-2 text-left">Holat</th>
              </tr>
            </thead>
            <tbody>
              {(trips.data?.trips ?? []).map((row) => (
                <tr key={row.id} data-testid={`trip-row-${row.number}`} className={cn("cursor-pointer border-t hover:bg-muted/30", openId === row.id && "bg-muted/40")} onClick={() => setOpenId(row.id)}>
                  <td className="px-3 py-2 font-medium">{row.number}</td>
                  <td className="px-3 py-2">{row.agentName ?? "—"}</td>
                  <td className="px-3 py-2">{row.warehouseName ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.tasks}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(row.totalAmount)}</td>
                  <td className="px-3 py-2"><Badge variant="outline">{TRIP_STATUS_LABELS[row.status]}</Badge></td>
                </tr>
              ))}
              {trips.data && trips.data.trips.length === 0 && (
                <tr className="border-t"><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Bu kunga reys yo'q</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {openId && <TripDetail tripId={openId} money={money} />}
    </div>
  );
}

function TripDetail({ tripId, money }: { tripId: string; money: (value: string | number) => string }) {
  const { can } = usePermissions();
  const company = useActiveCompany().data?.company;
  const me = useCurrentUser();
  const query = useApiQuery<{ trip: Trip }>(`/api/delivery/trips/${tripId}`);
  const trip = query.data?.trip;
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [cancelReason, setCancelReason] = useState("");
  const [printing, setPrinting] = useState<string | null>(null);
  const invalidate = { invalidate: ["/api/delivery/trips", "/api/delivery/tasks"] };
  const savePicking = useApiMutation((lines: object[]) => api.post(`/api/delivery/trips/${tripId}/picking`, { lines }), invalidate);
  const load = useApiMutation(() => api.post(`/api/delivery/trips/${tripId}/load`), invalidate);
  const out = useApiMutation(() => api.post(`/api/delivery/trips/${tripId}/out`), invalidate);
  const cancel = useApiMutation(() => api.post(`/api/delivery/trips/${tripId}/cancel`, { reason: cancelReason }), invalidate);
  const check = useMemo(() => (trip ? reconcileTrip(trip.snapshot) : null), [trip]);
  const canPick = can("warehouse.manage") || can("delivery.manage");

  if (!trip) return <Skeleton className="h-40 w-full" />;
  const companyInfo = {
    name: company?.name ?? "BUM ERP",
    legalName: company?.legalName ?? undefined,
    taxId: company?.taxId ?? undefined,
    address: company?.address ?? undefined,
    phone: company?.phone ?? undefined,
  };

  const run = async (label: string, action: () => Promise<unknown>, success: string) => {
    try {
      setPrinting(label);
      await action();
      toast.success(success);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPrinting(null);
    }
  };

  const printWaybills = async () => {
    const deliveries = trip.snapshot.tasks.map((task) => ({ ...task, orderTotal: Number(task.orderTotal), customerDebt: task.customerDebt === null || task.customerDebt === undefined ? null : Number(task.customerDebt) })) as unknown as SingleDeliveryWaybill[];
    const options = { company: companyInfo, currency: company?.currency ?? "UZS", responsibleName: me?.name ?? "—" };
    const active = await api.get<{ schema: DocumentTemplateSchema; custom: boolean }>("/api/documents/active/delivery_waybill").catch(() => null);
    if (active?.custom) {
      const { renderWaybillsWithTemplate } = await import("@/lib/pdf/delivery-template.ts");
      const doc = await renderWaybillsWithTemplate(active.schema, deliveries, options);
      doc.save(`nakladnoylar-${trip.number}.pdf`);
    } else {
      const { generateBulkDeliveryWaybillsPDF } = await import("@/lib/pdf/delivery-waybill-pdf.ts");
      await generateBulkDeliveryWaybillsPDF({ ...options, deliveries });
    }
  };
  const printPickList = async () => (await import("@/lib/pdf/trip-pdf.ts")).generateTripPickListPDF(trip, companyInfo);
  const printRoute = async () => (await import("@/lib/pdf/trip-pdf.ts")).generateRouteSheetPDF(trip, companyInfo, company?.currency ?? "UZS");

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card p-4" data-testid="trip-detail">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold">{trip.number} · {trip.tripDate}</p>
          <p className="text-sm text-muted-foreground">
            {trip.snapshot.agent.name ?? trip.snapshot.agent.code} {trip.snapshot.agent.phone ? `· ${trip.snapshot.agent.phone}` : ""} · {trip.snapshot.warehouse.name ?? "—"} · {trip.snapshot.totals.tasks} mijoz · {money(trip.totalAmount)}
          </p>
        </div>
        <Badge data-testid="trip-status">{TRIP_STATUS_LABELS[trip.status]}</Badge>
      </div>

      {check && !check.ok && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" data-testid="trip-mismatch">
          Hujjatlar mos emas — chop etilmaydi: {check.mismatches.join("; ")}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" data-testid="trip-print-waybills" disabled={!check?.ok || printing !== null} onClick={() => void run("w", printWaybills, "Nakladnoylar tayyor")}>
          <FileStack className="mr-1.5 h-4 w-4" /> Nakladnoylar ({trip.snapshot.totals.tasks})
        </Button>
        <Button size="sm" variant="secondary" data-testid="trip-print-picklist" disabled={!check?.ok || printing !== null} onClick={() => void run("p", printPickList, "Yig'ma ro'yxat tayyor (2 nusxa)")}>
          <PackageCheck className="mr-1.5 h-4 w-4" /> Yig'ma ro'yxat ×2
        </Button>
        <Button size="sm" variant="secondary" data-testid="trip-print-route" disabled={!check?.ok || printing !== null} onClick={() => void run("r", printRoute, "Marshrut varag'i tayyor")}>
          <Route className="mr-1.5 h-4 w-4" /> Marshrut varag'i
        </Button>
        <Button size="sm" data-testid="trip-print-all" disabled={!check?.ok || printing !== null} onClick={() => void run("a", async () => { await printWaybills(); await printPickList(); await printRoute(); }, "Uchala hujjat tayyor")}>
          <Printer className="mr-1.5 h-4 w-4" /> Hammasi (3 hujjat)
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Mahsulot</th>
              <th className="px-3 py-2 text-left">Birlik</th>
              <th className="px-3 py-2 text-right">Kerak</th>
              <th className="px-3 py-2 text-right">Terildi</th>
              <th className="px-3 py-2 text-left">Holat</th>
            </tr>
          </thead>
          <tbody>
            {trip.lines.map((line) => (
              <tr key={line.id} className="border-t" data-testid={`trip-line-${line.productSku ?? line.productId}`}>
                <td className="px-3 py-2">{line.productName}<div className="text-xs text-muted-foreground">{line.productSku}</div></td>
                <td className="px-3 py-2">{line.unitName}</td>
                <td className="px-3 py-2 text-right tabular-nums">{Number(line.requiredQty)}</td>
                <td className="px-3 py-2 text-right">
                  {trip.status === "picking" && canPick ? (
                    <Input
                      className="ml-auto h-8 w-24 text-right"
                      inputMode="decimal"
                      data-testid={`trip-pick-${line.productSku ?? line.productId}`}
                      value={picked[line.id] ?? (line.pickedQty !== null ? String(Number(line.pickedQty)) : "")}
                      onChange={(event) => setPicked((prev) => ({ ...prev, [line.id]: event.target.value }))}
                    />
                  ) : (
                    <span className="tabular-nums">{line.pickedQty !== null ? Number(line.pickedQty) : "—"}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <Badge variant="outline" className={cn(line.pickStatus === "missing" && "border-destructive text-destructive", line.pickStatus === "partially_picked" && "border-amber-500 text-amber-600")}>
                    {PICK_STATUS_LABELS[line.pickStatus]}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {trip.status === "picking" && canPick && (
          <>
            <Button size="sm" variant="secondary" data-testid="trip-save-picking" disabled={Object.keys(picked).length === 0 || savePicking.isPending} onClick={() => void run("s", async () => {
              await savePicking.mutateAsync(Object.entries(picked).map(([lineId, value]) => ({ lineId, pickedQty: String(Number(value.replace(",", ".")) || 0) })));
              setPicked({});
            }, "Terish saqlandi")}>
              <CheckCircle2 className="mr-1.5 h-4 w-4" /> Terishni saqlash
            </Button>
            <Button size="sm" data-testid="trip-load" disabled={load.isPending} onClick={() => void run("l", () => load.mutateAsync(), "Reys yuklandi")}>
              <Truck className="mr-1.5 h-4 w-4" /> Yuklandi
            </Button>
          </>
        )}
        {trip.status === "loaded" && can("delivery.manage") && (
          <Button size="sm" data-testid="trip-out" disabled={out.isPending} onClick={() => void run("o", () => out.mutateAsync(), "Reys yo'lga chiqdi")}>
            <Truck className="mr-1.5 h-4 w-4" /> Yo'lga chiqdi
          </Button>
        )}
        {(trip.status === "picking" || trip.status === "loaded") && can("delivery.manage") && (
          <div className="ml-auto flex items-end gap-2">
            <Textarea rows={1} className="w-64" placeholder="Bekor qilish sababi" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
            <Button size="sm" variant="destructive" disabled={cancelReason.trim().length < 3 || cancel.isPending} onClick={() => void run("c", () => cancel.mutateAsync(), "Reys bekor qilindi")}>
              <XCircle className="mr-1.5 h-4 w-4" /> Bekor qilish
            </Button>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Terish va yuklash faqat qayd: ombordan chiqim, qarz va tushum yetkazuvchi yetkazmani "boshlash"ida yoziladi.
        {trip.cancelReason ? ` Bekor qilingan: ${trip.cancelReason}` : ""}
      </p>
    </div>
  );
}
