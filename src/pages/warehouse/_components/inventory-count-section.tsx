import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import { Plus, Play, CheckCircle, ClipboardList, ChevronRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { cn } from "@/lib/utils.ts";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty.tsx";
import type { Id, Doc } from "@/convex/_generated/dataModel.d.ts";

type Props = {
  warehouseId: Id<"warehouses">;
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  draft:       { label: "Qoralama",    color: "bg-muted text-muted-foreground" },
  in_progress: { label: "Jarayonda",   color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" },
  completed:   { label: "Yakunlangan", color: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" },
  cancelled:   { label: "Bekor",       color: "bg-destructive/10 text-destructive" },
};

export default function InventoryCountSection({ warehouseId }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [activeCountId, setActiveCountId] = useState<Id<"inventoryCounts"> | null>(null);

  const counts = useQuery(api.warehouse.inventoryCounts.list, { warehouseId });
  const activeCount = useQuery(
    api.warehouse.inventoryCounts.getById,
    activeCountId ? { id: activeCountId } : "skip"
  );

  const createCount = useMutation(api.warehouse.inventoryCounts.create);
  const updateStatus = useMutation(api.warehouse.inventoryCounts.updateStatus);
  const updateItem = useMutation(api.warehouse.inventoryCounts.updateItem);
  const applyAdjustments = useMutation(api.warehouse.inventoryCounts.applyAdjustments);

  const [countInputs, setCountInputs] = useState<Record<string, string>>({});

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      const id = await createCount({ warehouseId, name: newName.trim() });
      toast.success("Inventarizatsiya yaratildi");
      setActiveCountId(id as Id<"inventoryCounts">);
      setCreateOpen(false);
      setNewName("");
    } catch {
      toast.error("Xatolik yuz berdi");
    }
  };

  const handleStart = async (id: Id<"inventoryCounts">) => {
    await updateStatus({ id, status: "in_progress" });
    setActiveCountId(id);
  };

  const handleSaveItem = async (itemId: Id<"inventoryCountItems">) => {
    const val = parseFloat(countInputs[itemId] ?? "");
    if (isNaN(val)) return;
    await updateItem({ itemId, countedQty: val });
    toast.success("Saqlandi");
  };

  const handleApply = async (id: Id<"inventoryCounts">) => {
    try {
      await applyAdjustments({ id });
      toast.success("Tuzatmalar qo'llanildi");
      setActiveCountId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Xatolik");
    }
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Inventarizatsiya seanslari</p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Yangi seansni boshlash
        </Button>
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Yangi inventarizatsiya</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Nomi</label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Yanvar 2025 inventarizatsiya"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Bekor</Button>
            <Button onClick={handleCreate} disabled={!newName.trim()}>Yaratish</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Active count detail */}
      {activeCountId && activeCount && (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border-b border-border">
            <div>
              <p className="font-semibold text-sm">{activeCount.name}</p>
              <p className="text-xs text-muted-foreground">
                {activeCount.items.filter((i) => i.countedQty !== undefined).length} / {activeCount.items.length} ta mahsulot sanalib bo'ldi
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setActiveCountId(null)}>
                Yopish
              </Button>
              {activeCount.status === "in_progress" && !activeCount.adjustmentsMade && (
                <Button size="sm" onClick={() => handleApply(activeCountId)}>
                  <CheckCircle className="h-4 w-4 mr-1" /> Tuzatmalarni qo'llash
                </Button>
              )}
            </div>
          </div>
          <div className="overflow-auto max-h-[400px]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-left px-4 py-2 text-xs text-muted-foreground">Mahsulot</th>
                  <th className="text-right px-4 py-2 text-xs text-muted-foreground">Kutilgan</th>
                  <th className="text-center px-4 py-2 text-xs text-muted-foreground">Sanalgan</th>
                  <th className="text-right px-4 py-2 text-xs text-muted-foreground">Farq</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {activeCount.items.map((item) => {
                  const diff = item.difference;
                  return (
                    <tr key={item._id} className="hover:bg-muted/30">
                      <td className="px-4 py-2">
                        <p className="font-medium text-xs truncate max-w-[160px]">{item.productName}</p>
                        <p className="text-[11px] text-muted-foreground font-mono">{item.productSku}</p>
                      </td>
                      <td className="px-4 py-2 text-right text-xs font-mono">
                        {item.expectedQty} {item.unitName}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1 justify-center">
                          <Input
                            type="number"
                            min="0"
                            step="0.001"
                            className="h-7 w-20 text-xs text-center"
                            value={countInputs[item._id] ?? (item.countedQty?.toString() ?? "")}
                            onChange={(e) =>
                              setCountInputs((p) => ({ ...p, [item._id]: e.target.value }))
                            }
                            disabled={activeCount.adjustmentsMade}
                          />
                          {!activeCount.adjustmentsMade && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => handleSaveItem(item._id as Id<"inventoryCountItems">)}
                            >
                              <Check className="h-3.5 w-3.5 text-green-600" />
                            </Button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right">
                        {diff !== undefined && diff !== 0 && (
                          <span className={cn(
                            "text-xs font-bold font-mono",
                            diff > 0 ? "text-green-600" : "text-destructive"
                          )}>
                            {diff > 0 ? "+" : ""}{diff}
                          </span>
                        )}
                        {diff === 0 && item.countedQty !== undefined && (
                          <CheckCircle className="h-3.5 w-3.5 text-green-600 ml-auto" />
                        )}
                      </td>
                      <td className="px-4 py-2"></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sessions list */}
      {counts === undefined ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : counts.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><ClipboardList /></EmptyMedia>
            <EmptyTitle>Inventarizatsiya yo'q</EmptyTitle>
            <EmptyDescription>Birinchi inventarizatsiyani boshlang</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Yaratish
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="space-y-2">
          {counts.map((c) => {
            const meta = STATUS_META[c.status] ?? STATUS_META.draft;
            return (
              <div
                key={c._id}
                className="flex items-center justify-between p-4 border border-border rounded-xl hover:bg-muted/30 transition-colors cursor-pointer"
                onClick={() => setActiveCountId(c._id)}
              >
                <div className="flex items-center gap-3">
                  <ClipboardList className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-sm">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.warehouseName} • {c.itemCount} mahsulot
                      {c.countedItems > 0 && ` • ${c.countedItems} sanalgan`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={cn("text-[11px] px-2 py-0.5 rounded-full font-medium", meta.color)}>
                    {meta.label}
                  </span>
                  {c.status === "draft" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={(e) => { e.stopPropagation(); handleStart(c._id); }}
                    >
                      <Play className="h-3.5 w-3.5 mr-1" /> Boshlash
                    </Button>
                  )}
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
