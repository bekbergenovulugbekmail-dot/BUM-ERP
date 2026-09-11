import { useState } from "react";
import { toast } from "sonner";
import {
  Plus, Play, CheckCircle, XCircle, Factory,
  ChevronDown, ChevronRight, Clock, DollarSign, Layers, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import {
  num,
  type Bom,
  type ProductionOrder,
  type ProductionOrderDetail,
  type ProductionStatus,
  type WarehouseOption,
  type WorkCenter,
} from "../_lib/types.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

const STATUS_MAP: Record<ProductionStatus, { label: string; color: string; dot: string }> = {
  draft: { label: "Qoralama", color: "bg-muted text-muted-foreground", dot: "bg-slate-400" },
  confirmed: { label: "Tasdiqlangan", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", dot: "bg-blue-400" },
  in_progress: { label: "Jarayonda", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", dot: "bg-amber-400" },
  completed: { label: "Yakunlandi", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", dot: "bg-emerald-400" },
  cancelled: { label: "Bekor qilindi", color: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400", dot: "bg-rose-400" },
};

const STATUS_TABS = ["all", "draft", "confirmed", "in_progress", "completed", "cancelled"] as const;

const today = () => new Date().toISOString().slice(0, 10);
const emptyCreateForm = () => ({ bomId: "", warehouseId: "", plannedQty: "1", plannedDate: today(), notes: "" });
const emptyTimeForm = () => ({ workCenterId: "", plannedHours: "1", actualHours: "1" });

export default function OrdersSection() {
  const { can } = usePermissions();
  const canApprove = can("manufacturing.approve");

  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_TABS)[number]>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [completeDialog, setCompleteDialog] = useState<string | null>(null);
  const [timeDialog, setTimeDialog] = useState<string | null>(null);

  const orders = useApiQuery<{ orders: ProductionOrder[] }>("/api/manufacturing/orders", {
    status: statusFilter !== "all" ? statusFilter : undefined,
    limit: 100,
  }).data?.orders;
  const boms = useApiQuery<{ boms: Bom[] }>("/api/manufacturing/boms").data?.boms;
  const warehouses = useApiQuery<{ warehouses: WarehouseOption[] }>("/api/inventory/warehouses").data?.warehouses;
  const workCenters = useApiQuery<{ workCenters: WorkCenter[] }>("/api/manufacturing/work-centers").data?.workCenters;
  const expandedOrderData = useApiQuery<{ order: ProductionOrderDetail }>(
    expandedOrder ? `/api/manufacturing/orders/${expandedOrder}` : null,
  ).data?.order;
  // Yakunlash oynasi — faqat shu buyurtmaning materiallari
  const completeOrderData = useApiQuery<{ order: ProductionOrderDetail }>(
    completeDialog ? `/api/manufacturing/orders/${completeDialog}` : null,
  ).data?.order;

  const createOrder = useApiMutation((body: Record<string, unknown>) => api.post("/api/manufacturing/orders", body));
  const transition = useApiMutation(({ id, action }: { id: string; action: "confirm" | "start" | "cancel" }) =>
    api.post(`/api/manufacturing/orders/${id}/${action}`));
  const completeOrder = useApiMutation(({ id, ...body }: { id: string; producedQty: string; actualMaterials: { materialId: string; actualQty: string }[] }) =>
    api.post(`/api/manufacturing/orders/${id}/complete`, body));
  const addTimeLine = useApiMutation(({ orderId, ...body }: { orderId: string; workCenterId: string; plannedHours: string; actualHours: string }) =>
    api.post(`/api/manufacturing/orders/${orderId}/time-lines`, body));
  const deleteTimeLine = useApiMutation(({ orderId, timeLineId }: { orderId: string; timeLineId: string }) =>
    api.delete(`/api/manufacturing/orders/${orderId}/time-lines/${timeLineId}`));

  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [completeQty, setCompleteQty] = useState("1");
  const [actualQty, setActualQty] = useState<Record<string, string>>({});
  const [timeForm, setTimeForm] = useState(emptyTimeForm);

  const handleCreate = async () => {
    if (!createForm.bomId || createForm.bomId === "none" || !createForm.warehouseId || createForm.warehouseId === "none") {
      toast.error("BOM va ombor kiritilishi shart");
      return;
    }
    try {
      await createOrder.mutateAsync({
        bomId: createForm.bomId,
        warehouseId: createForm.warehouseId,
        plannedQty: createForm.plannedQty || "1",
        plannedDate: createForm.plannedDate,
        notes: createForm.notes || null,
      });
      toast.success("Ishlab chiqarish buyurtmasi yaratildi");
      setCreateOpen(false);
      setCreateForm(emptyCreateForm());
    } catch (e) { toast.error(errorMessage(e)); }
  };

  const runTransition = async (id: string, action: "confirm" | "start" | "cancel") => {
    try { await transition.mutateAsync({ id, action }); }
    catch (e) { toast.error(errorMessage(e)); }
  };

  const openComplete = (order: ProductionOrder) => {
    setCompleteQty(String(num(order.plannedQty)));
    setActualQty({});
    setCompleteDialog(order.id);
  };

  const handleComplete = async () => {
    if (!completeDialog || !completeOrderData) return;
    try {
      await completeOrder.mutateAsync({
        id: completeDialog,
        producedQty: completeQty || "1",
        actualMaterials: completeOrderData.materials.map((m) => ({
          materialId: m.id,
          actualQty: actualQty[m.id] ?? m.plannedQty,
        })),
      });
      toast.success("Ishlab chiqarish yakunlandi. Mahsulot omborga qo'shildi.");
      setCompleteDialog(null);
    } catch (e) {
      // Masalan: xomashyo zaxirasi yetmasa server aniq xabar qaytaradi
      toast.error(errorMessage(e));
    }
  };

  const handleAddTime = async () => {
    if (!timeDialog || !timeForm.workCenterId || timeForm.workCenterId === "none") {
      toast.error("Ish markazi tanlang");
      return;
    }
    try {
      await addTimeLine.mutateAsync({
        orderId: timeDialog,
        workCenterId: timeForm.workCenterId,
        plannedHours: timeForm.plannedHours || "0",
        actualHours: timeForm.actualHours || "0",
      });
      toast.success("Mehnat sarfi qayd etildi");
      setTimeDialog(null);
      setTimeForm(emptyTimeForm());
    } catch (e) { toast.error(errorMessage(e)); }
  };

  const handleDeleteTime = async (orderId: string, timeLineId: string) => {
    try { await deleteTimeLine.mutateAsync({ orderId, timeLineId }); }
    catch (e) { toast.error(errorMessage(e)); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1.5 flex-wrap">
          {STATUS_TABS.map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer",
                statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
              )}>
              {s === "all" ? "Barchasi" : STATUS_MAP[s].label}
            </button>
          ))}
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
            const expanded = expandedOrder === order.id;
            const editable = order.status !== "completed" && order.status !== "cancelled";
            return (
              <div key={order.id} className="bg-card border border-border rounded-2xl overflow-hidden">
                <div
                  className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/20"
                  onClick={() => setExpandedOrder(expanded ? null : order.id)}
                >
                  <div className={cn("h-2 w-2 rounded-full flex-shrink-0", st.dot)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold">{order.number}</span>
                      <span className={cn("text-xs px-2 py-0.5 rounded-full", st.color)}>{st.label}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {order.productName} · {num(order.plannedQty)} · {order.warehouseName}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="text-right hidden md:block">
                      <p className="text-xs text-muted-foreground">Narxi</p>
                      <p className="text-sm font-semibold">{fmt(num(order.totalCost))} so'm</p>
                    </div>
                    {/* Action buttons */}
                    {order.status === "draft" && canApprove && (
                      <Button size="sm" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); void runTransition(order.id, "confirm"); }}>
                        Tasdiqlash
                      </Button>
                    )}
                    {order.status === "confirmed" && (
                      <Button size="sm" className="h-7 text-xs bg-amber-600 hover:bg-amber-700" onClick={(e) => { e.stopPropagation(); void runTransition(order.id, "start"); }}>
                        <Play className="h-3 w-3 mr-1" /> Boshlash
                      </Button>
                    )}
                    {order.status === "in_progress" && (
                      <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={(e) => { e.stopPropagation(); openComplete(order); }}>
                        <CheckCircle className="h-3 w-3 mr-1" /> Yakunlash
                      </Button>
                    )}
                    {editable && (
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={(e) => { e.stopPropagation(); void runTransition(order.id, "cancel"); }}>
                        <XCircle className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </div>

                {expanded && expandedOrderData && expandedOrderData.id === order.id && (
                  <div className="border-t border-border p-4 space-y-4">
                    {/* Cost summary */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { label: "Material narxi", value: fmt(num(expandedOrderData.totalMaterialCost)) + " so'm", icon: Layers },
                        { label: "Mehnat narxi", value: fmt(num(expandedOrderData.totalLaborCost)) + " so'm", icon: Clock },
                        { label: "Jami narx", value: fmt(num(expandedOrderData.totalCost)) + " so'm", icon: DollarSign },
                        { label: "Birlik narxi", value: fmt(num(expandedOrderData.unitCost)) + " so'm", icon: Factory },
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
                                <tr key={m.id} className="hover:bg-muted/20">
                                  <td className="px-3 py-2.5 font-medium">{m.componentName}</td>
                                  <td className="px-3 py-2.5 text-right text-muted-foreground">{num(m.plannedQty).toFixed(2)} {m.unitName}</td>
                                  <td className={cn("px-3 py-2.5 text-right", num(m.actualQty) > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                                    {num(m.actualQty) > 0 ? `${num(m.actualQty).toFixed(2)} ${m.unitName}` : "—"}
                                  </td>
                                  <td className="px-3 py-2.5 text-right">{fmt(num(m.totalCost))} so'm</td>
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
                          <Button size="sm" variant="secondary" onClick={() => setTimeDialog(order.id)}>
                            <Clock className="h-3.5 w-3.5 mr-1" /> Vaqt qo'shish
                          </Button>
                        )}
                      </div>
                      {expandedOrderData.timeLines.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Mehnat sarfi qayd etilmagan</p>
                      ) : (
                        <div className="space-y-1.5">
                          {expandedOrderData.timeLines.map((tl) => (
                            <div key={tl.id} className="flex items-center gap-3 bg-muted/30 rounded-xl px-3 py-2 text-sm">
                              <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                              <span className="flex-1">{tl.workCenterName}</span>
                              <span className="text-muted-foreground">{num(tl.actualHours)}h × {fmt(num(tl.costPerHour))}</span>
                              <span className="font-semibold">{fmt(num(tl.totalCost))} so'm</span>
                              {editable && (
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => void handleDeleteTime(order.id, tl.id)}>
                                  <Trash2 className="h-3 w-3 text-destructive" />
                                </Button>
                              )}
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
                    {boms?.map((b) => <SelectItem key={b.id} value={b.id}>{b.name} — {b.productName} ({b.version})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Ombor *</Label>
                  <Select value={createForm.warehouseId} onValueChange={(v) => setCreateForm({ ...createForm, warehouseId: v })}>
                    <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
                    <SelectContent>
                      {warehouses?.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
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
              <Button onClick={handleCreate} disabled={createOrder.isPending}>{createOrder.isPending ? "..." : "Yaratish"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Complete dialog */}
      {completeDialog && (
        <Dialog open onOpenChange={(o) => !o && setCompleteDialog(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Ishlab chiqarishni yakunlash</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Ishlab chiqarilgan miqdor *</Label>
                <Input type="number" min="0.001" step="0.001" value={completeQty}
                  onChange={(e) => setCompleteQty(e.target.value)} />
              </div>
              {!completeOrderData || completeOrderData.id !== completeDialog ? (
                <Skeleton className="h-24 rounded-xl" />
              ) : completeOrderData.materials.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Haqiqiy xomashyo sarfi</Label>
                  {completeOrderData.materials.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 text-sm">
                      <span className="flex-1 truncate">{m.componentName}</span>
                      <Input
                        type="number" min="0" step="0.001" className="w-28 h-8"
                        value={actualQty[m.id] ?? String(num(m.plannedQty))}
                        onChange={(e) => setActualQty({ ...actualQty, [m.id]: e.target.value })}
                      />
                      <span className="text-xs text-muted-foreground w-10">{m.unitName}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Ushbu miqdordagi tayyor mahsulot omborga qo'shiladi va xom ashyolar kamaytiriladi.
              </p>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setCompleteDialog(null)}>Bekor</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleComplete} disabled={completeOrder.isPending || !completeOrderData}>
                {completeOrder.isPending ? "..." : "Yakunlash va omborga o'tkazish"}
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
                    {workCenters?.map((wc) => <SelectItem key={wc.id} value={wc.id}>{wc.name} — {fmt(num(wc.costPerHour))} so'm/soat</SelectItem>)}
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
              <Button onClick={handleAddTime} disabled={addTimeLine.isPending}>Qayd etish</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
