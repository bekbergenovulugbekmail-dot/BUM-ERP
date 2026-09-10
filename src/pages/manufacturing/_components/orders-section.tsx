import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import {
  Plus, Play, CheckCircle, XCircle, Factory,
  ChevronDown, ChevronRight, Clock, DollarSign, Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import type { Id } from "@/convex/_generated/dataModel.d.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

const STATUS_MAP: Record<string, { label: string; color: string; dot: string }> = {
  draft: { label: "Qoralama", color: "bg-muted text-muted-foreground", dot: "bg-slate-400" },
  confirmed: { label: "Tasdiqlangan", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", dot: "bg-blue-400" },
  in_progress: { label: "Jarayonda", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", dot: "bg-amber-400" },
  completed: { label: "Yakunlandi", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", dot: "bg-emerald-400" },
  cancelled: { label: "Bekor qilindi", color: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400", dot: "bg-rose-400" },
};

export default function OrdersSection() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedOrder, setExpandedOrder] = useState<Id<"productionOrders"> | null>(null);
  const [completeDialog, setCompleteDialog] = useState<Id<"productionOrders"> | null>(null);
  const [timeDialog, setTimeDialog] = useState<Id<"productionOrders"> | null>(null);
  const [loading, setLoading] = useState(false);

  const orders = useQuery(api.manufacturing.orders.listOrders, {
    status: statusFilter !== "all" ? statusFilter as "draft" | "confirmed" | "in_progress" | "completed" | "cancelled" : undefined,
    limit: 100,
  });
  const boms = useQuery(api.manufacturing.boms.listBOMs, {});
  const warehouses = useQuery(api.warehouse.warehouses.list, {});
  const workCenters = useQuery(api.manufacturing.orders.listWorkCenters, {});
  const expandedOrderData = useQuery(
    api.manufacturing.orders.getOrder,
    expandedOrder ? { id: expandedOrder } : "skip"
  );

  const createOrder = useMutation(api.manufacturing.orders.createOrder);
  const confirmOrder = useMutation(api.manufacturing.orders.confirmOrder);
  const startOrder = useMutation(api.manufacturing.orders.startOrder);
  const completeOrder = useMutation(api.manufacturing.orders.completeOrder);
  const cancelOrder = useMutation(api.manufacturing.orders.cancelOrder);
  const addTimeLine = useMutation(api.manufacturing.orders.addTimeLine);

  const [createForm, setCreateForm] = useState({
    bomId: "", warehouseId: "", plannedQty: "1",
    plannedDate: new Date().toISOString().slice(0, 10), notes: "",
  });
  const [completeQty, setCompleteQty] = useState("1");
  const [timeForm, setTimeForm] = useState({ workCenterId: "", plannedHours: "1", actualHours: "1" });

  const handleCreate = async () => {
    if (!createForm.bomId || createForm.bomId === "none" || !createForm.warehouseId || createForm.warehouseId === "none") {
      toast.error("BOM va ombor kiritilishi shart");
      return;
    }
    setLoading(true);
    try {
      await createOrder({
        bomId: createForm.bomId as Id<"boms">,
        warehouseId: createForm.warehouseId as Id<"warehouses">,
        plannedQty: parseFloat(createForm.plannedQty) || 1,
        plannedDate: createForm.plannedDate,
        notes: createForm.notes || undefined,
      });
      toast.success("Ishlab chiqarish buyurtmasi yaratildi");
      setCreateOpen(false);
      setCreateForm({ bomId: "", warehouseId: "", plannedQty: "1", plannedDate: new Date().toISOString().slice(0, 10), notes: "" });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Xatolik"); }
    finally { setLoading(false); }
  };

  const handleComplete = async () => {
    if (!completeDialog) return;
    setLoading(true);
    try {
      await completeOrder({ id: completeDialog, producedQty: parseFloat(completeQty) || 1 });
      toast.success("Ishlab chiqarish yakunlandi. Mahsulot omborga qo'shildi.");
      setCompleteDialog(null);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Xatolik"); }
    finally { setLoading(false); }
  };

  const handleAddTime = async () => {
    if (!timeDialog || !timeForm.workCenterId || timeForm.workCenterId === "none") {
      toast.error("Ish markazi tanlang");
      return;
    }
    try {
      await addTimeLine({
        orderId: timeDialog,
        workCenterId: timeForm.workCenterId as Id<"workCenters">,
        plannedHours: parseFloat(timeForm.plannedHours) || 1,
        actualHours: parseFloat(timeForm.actualHours) || 1,
      });
      toast.success("Mehnat sarfi qayd etildi");
      setTimeDialog(null);
      setTimeForm({ workCenterId: "", plannedHours: "1", actualHours: "1" });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Xatolik"); }
  };

  const statusTabs = ["all", "draft", "confirmed", "in_progress", "completed", "cancelled"];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1.5 flex-wrap">
          {statusTabs.map((s) => {
            const info = STATUS_MAP[s];
            return (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={cn(
                  "px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer",
                  statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
                )}>
                {s === "all" ? "Barchasi" : info?.label}
              </button>
            );
          })}
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Buyurtma yaratish
        </Button>
      </div>

      {!orders ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-center">
          <Factory className="h-12 w-12 text-muted-foreground/20 mb-3" />
          <p className="text-muted-foreground">Ishlab chiqarish buyurtmalari yo'q</p>
          <Button size="sm" className="mt-3" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-1" /> Yaratish</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map((order) => {
            const st = STATUS_MAP[order.status];
            const expanded = expandedOrder === order._id;
            return (
              <div key={order._id} className="bg-card border border-border rounded-2xl overflow-hidden">
                <div
                  className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/20"
                  onClick={() => setExpandedOrder(expanded ? null : order._id)}
                >
                  <div className={cn("h-2 w-2 rounded-full flex-shrink-0", st?.dot ?? "bg-slate-400")} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold">{order.number}</span>
                      <span className={cn("text-xs px-2 py-0.5 rounded-full", st?.color)}>{st?.label}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {order.productName} · {order.plannedQty} dona · {order.warehouseName}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="text-right hidden md:block">
                      <p className="text-xs text-muted-foreground">Narxi</p>
                      <p className="text-sm font-semibold">{fmt(order.totalCost)} so'm</p>
                    </div>
                    {/* Action buttons */}
                    {order.status === "draft" && (
                      <Button size="sm" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); confirmOrder({ id: order._id }); }}>
                        Tasdiqlash
                      </Button>
                    )}
                    {order.status === "confirmed" && (
                      <Button size="sm" className="h-7 text-xs bg-amber-600 hover:bg-amber-700" onClick={(e) => { e.stopPropagation(); startOrder({ id: order._id }); }}>
                        <Play className="h-3 w-3 mr-1" /> Boshlash
                      </Button>
                    )}
                    {order.status === "in_progress" && (
                      <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={(e) => { e.stopPropagation(); setCompleteQty(String(order.plannedQty)); setCompleteDialog(order._id); }}>
                        <CheckCircle className="h-3 w-3 mr-1" /> Yakunlash
                      </Button>
                    )}
                    {["draft", "confirmed", "in_progress"].includes(order.status) && (
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={(e) => { e.stopPropagation(); cancelOrder({ id: order._id }); }}>
                        <XCircle className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </div>

                {expanded && expandedOrderData && expandedOrderData._id === order._id && (
                  <div className="border-t border-border p-4 space-y-4">
                    {/* Cost summary */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { label: "Material narxi", value: fmt(expandedOrderData.totalMaterialCost) + " so'm", icon: Layers },
                        { label: "Mehnat narxi", value: fmt(expandedOrderData.totalLaborCost) + " so'm", icon: Clock },
                        { label: "Jami narx", value: fmt(expandedOrderData.totalCost) + " so'm", icon: DollarSign },
                        { label: "Birlik narxi", value: fmt(expandedOrderData.unitCost) + " so'm", icon: Factory },
                      ].map((s) => (
                        <div key={s.label} className="bg-muted/40 rounded-xl p-3">
                          <p className="text-xs text-muted-foreground">{s.label}</p>
                          <p className="font-semibold text-sm mt-0.5">{s.value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Materials table */}
                    {expandedOrderData.materials.length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-2">Material sarfi</p>
                        <div className="rounded-xl border border-border overflow-hidden">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-muted/30 border-b border-border">
                                <th className="text-left px-3 py-2.5 text-xs text-muted-foreground font-medium">Komponent</th>
                                <th className="text-right px-3 py-2.5 text-xs text-muted-foreground font-medium">Reja</th>
                                <th className="text-right px-3 py-2.5 text-xs text-muted-foreground font-medium">Actual</th>
                                <th className="text-right px-3 py-2.5 text-xs text-muted-foreground font-medium">Narx</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {expandedOrderData.materials.map((m) => (
                                <tr key={m._id} className="hover:bg-muted/20">
                                  <td className="px-3 py-2.5 font-medium">{m.componentName}</td>
                                  <td className="px-3 py-2.5 text-right text-muted-foreground">{m.plannedQty.toFixed(2)} {m.unitName}</td>
                                  <td className={cn("px-3 py-2.5 text-right", m.actualQty > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                                    {m.actualQty > 0 ? `${m.actualQty.toFixed(2)} ${m.unitName}` : "—"}
                                  </td>
                                  <td className="px-3 py-2.5 text-right">{fmt(m.totalCost)} so'm</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Time lines */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-medium">Mehnat sarfi</p>
                        {order.status === "in_progress" && (
                          <Button size="sm" variant="secondary" onClick={() => setTimeDialog(order._id)}>
                            <Clock className="h-3.5 w-3.5 mr-1" /> Vaqt qo'shish
                          </Button>
                        )}
                      </div>
                      {expandedOrderData.timeLines.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Mehnat sarfi qayd etilmagan</p>
                      ) : (
                        <div className="space-y-1.5">
                          {expandedOrderData.timeLines.map((tl) => (
                            <div key={tl._id} className="flex items-center gap-3 bg-muted/30 rounded-xl px-3 py-2 text-sm">
                              <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                              <span className="flex-1">{tl.workCenterName}</span>
                              <span className="text-muted-foreground">{tl.actualHours}h × {fmt(tl.costPerHour)}</span>
                              <span className="font-semibold">{fmt(tl.totalCost)} so'm</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create order dialog */}
      {createOpen && (
        <Dialog open onOpenChange={(o) => !o && setCreateOpen(false)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Yangi ishlab chiqarish buyurtmasi</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Material tarkibi (BOM) *</Label>
                <Select value={createForm.bomId} onValueChange={(v) => setCreateForm({ ...createForm, bomId: v })}>
                  <SelectTrigger><SelectValue placeholder="BOM tanlang" /></SelectTrigger>
                  <SelectContent>
                    {boms?.map((b) => <SelectItem key={b._id} value={b._id}>{b.name} — {b.productName} ({b.version})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Ombor *</Label>
                  <Select value={createForm.warehouseId} onValueChange={(v) => setCreateForm({ ...createForm, warehouseId: v })}>
                    <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
                    <SelectContent>
                      {warehouses?.map((w) => <SelectItem key={w._id} value={w._id}>{w.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Miqdor *</Label>
                  <Input type="number" min="0.001" step="0.001" value={createForm.plannedQty}
                    onChange={(e) => setCreateForm({ ...createForm, plannedQty: e.target.value })} placeholder="1" />
                </div>
              </div>
              <div>
                <Label>Reja sana</Label>
                <Input type="date" value={createForm.plannedDate}
                  onChange={(e) => setCreateForm({ ...createForm, plannedDate: e.target.value })} />
              </div>
              <div>
                <Label>Izoh</Label>
                <Input value={createForm.notes} onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })} placeholder="Ixtiyoriy..." />
              </div>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setCreateOpen(false)}>Bekor</Button>
              <Button onClick={handleCreate} disabled={loading}>{loading ? "..." : "Yaratish"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Complete dialog */}
      {completeDialog && (
        <Dialog open onOpenChange={(o) => !o && setCompleteDialog(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Ishlab chiqarishni yakunlash</DialogTitle></DialogHeader>
            <div className="space-y-2">
              <Label>Ishlab chiqarilgan miqdor *</Label>
              <Input type="number" min="0.001" step="0.001" value={completeQty}
                onChange={(e) => setCompleteQty(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Ushbu miqdordagi tayyor mahsulot omborga qo'shiladi va xom ashyolar kamaytiriladi.
              </p>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setCompleteDialog(null)}>Bekor</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleComplete} disabled={loading}>
                {loading ? "..." : "Yakunlash va omborga o'tkazish"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Time dialog */}
      {timeDialog && (
        <Dialog open onOpenChange={(o) => !o && setTimeDialog(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Mehnat vaqtini qayd etish</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Ish markazi *</Label>
                <Select value={timeForm.workCenterId} onValueChange={(v) => setTimeForm({ ...timeForm, workCenterId: v })}>
                  <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
                  <SelectContent>
                    {workCenters?.map((wc) => <SelectItem key={wc._id} value={wc._id}>{wc.name} — {fmt(wc.costPerHour)} so'm/soat</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Reja soat</Label>
                  <Input type="number" min="0" step="0.5" value={timeForm.plannedHours}
                    onChange={(e) => setTimeForm({ ...timeForm, plannedHours: e.target.value })} />
                </div>
                <div>
                  <Label>Actual soat</Label>
                  <Input type="number" min="0" step="0.5" value={timeForm.actualHours}
                    onChange={(e) => setTimeForm({ ...timeForm, actualHours: e.target.value })} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setTimeDialog(null)}>Bekor</Button>
              <Button onClick={handleAddTime}>Qayd etish</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
