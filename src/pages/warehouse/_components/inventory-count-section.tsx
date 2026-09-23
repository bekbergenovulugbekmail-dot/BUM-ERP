import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Play, CheckCircle, ClipboardList, ChevronRight, Check, Search, Ban, PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { cn } from "@/lib/utils.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty.tsx";
import { formatQty, toNumber } from "@/pages/products/_lib/types.ts";
import type { InventoryCountDetail, InventoryCountListItem } from "../_lib/types.ts";

type Props = {
  warehouseId: string;
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  draft:       { label: "Qoralama",    color: "bg-muted text-muted-foreground" },
  in_progress: { label: "Jarayonda",   color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" },
  completed:   { label: "Yakunlangan", color: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" },
  cancelled:   { label: "Bekor",       color: "bg-destructive/10 text-destructive" },
};

export default function InventoryCountSection({ warehouseId }: Props) {
  const { can } = usePermissions();
  const canCount = can("warehouse.count");
  // Qo'llash serverda ikkala ruxsatni talab qiladi
  const canApply = canCount && can("warehouse.manage");

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [activeCountId, setActiveCountId] = useState<string | null>(null);
  const [countInputs, setCountInputs] = useState<Record<string, string>>({});
  /** Ochiq hisob ichidagi qidiruv — yuzlab mahsulotli omborda qatorni topish uchun. */
  const [itemSearch, setItemSearch] = useState("");
  /** "Topilma": omborda bor, lekin hisobda yo'q mahsulotni qo'shish. */
  const [addOpen, setAddOpen] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  /** Tuzatmalarni qo'llashdan oldingi tasdiq — nima o'zgarishi ko'rsatiladi. */
  const [confirmApply, setConfirmApply] = useState(false);

  // Ombor almashtirilganda boshqa omborning hisobi ochiq qolmasin (render paytida moslash)
  const [shownWarehouseId, setShownWarehouseId] = useState(warehouseId);
  if (shownWarehouseId !== warehouseId) {
    setShownWarehouseId(warehouseId);
    setActiveCountId(null);
    setCountInputs({});
  }

  const countsQuery = useApiQuery<{ counts: InventoryCountListItem[] }>("/api/inventory/counts", { warehouseId });
  const counts = countsQuery.data?.counts;
  const activeCount = useApiQuery<{ count: InventoryCountDetail }>(
    activeCountId ? `/api/inventory/counts/${activeCountId}` : null,
  ).data?.count;

  const createCount = useApiMutation((name: string) =>
    api.post<{ count: { id: string } }>("/api/inventory/counts", { warehouseId, name }),
  );
  const updateStatus = useApiMutation((input: { id: string; status: "in_progress" | "cancelled" }) =>
    api.post(`/api/inventory/counts/${input.id}/status`, { status: input.status }),
  );
  const updateItem = useApiMutation((input: { countId: string; itemId: string; countedQty: number }) =>
    api.patch(`/api/inventory/counts/${input.countId}/items/${input.itemId}`, { countedQty: input.countedQty }),
  );
  const applyAdjustments = useApiMutation((id: string) =>
    api.post<{ adjusted: number }>(`/api/inventory/counts/${id}/apply`),
  );
  const addItem = useApiMutation((input: { countId: string; productId: string }) =>
    api.post(`/api/inventory/counts/${input.countId}/items`, { productId: input.productId }),
  );
  // Qo'shish oynasi ochiq bo'lgandagina qidiriladi
  const productOptions = useApiQuery<{ products: { id: string; name: string; sku: string }[] }>(
    addOpen ? "/api/catalog/products" : null,
    { search: productSearch.trim() || undefined, limit: 20 },
  ).data?.products;

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      const { count } = await createCount.mutateAsync(newName.trim());
      toast.success("Inventarizatsiya yaratildi");
      setActiveCountId(count.id);
      setCreateOpen(false);
      setNewName("");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const handleStart = async (id: string) => {
    try {
      await updateStatus.mutateAsync({ id, status: "in_progress" });
      setActiveCountId(id);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const handleSaveItem = async (countId: string, itemId: string) => {
    const raw = countInputs[itemId];
    if (raw === undefined || raw.trim() === "") return;
    const value = Number(raw.replace(",", "."));
    if (!Number.isFinite(value) || value < 0) {
      toast.error("Miqdor noto'g'ri");
      return;
    }
    try {
      await updateItem.mutateAsync({ countId, itemId, countedQty: value });
      // Saqlangan qiymat serverdan keladi
      setCountInputs((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      toast.success("Saqlandi");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const handleApply = async (id: string) => {
    try {
      const { adjusted } = await applyAdjustments.mutateAsync(id);
      toast.success(`Tuzatmalar qo'llanildi (${adjusted} ta mahsulot)`);
      setConfirmApply(false);
      setActiveCountId(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const handleCancelCount = async (id: string) => {
    try {
      await updateStatus.mutateAsync({ id, status: "cancelled" });
      toast.success("Inventarizatsiya bekor qilindi");
      setActiveCountId(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  /** Omborda qoldig'i yo'q topilma ham sanaladi — mahsulot hisobga qo'shiladi. */
  const handleAddProduct = async (productId: string) => {
    if (!activeCountId) return;
    try {
      await addItem.mutateAsync({ countId: activeCountId, productId });
      toast.success("Mahsulot hisobga qo'shildi");
      setAddOpen(false);
      setProductSearch("");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const editable =
    activeCount !== undefined &&
    !activeCount.adjustmentsMade &&
    activeCount.status !== "completed" &&
    activeCount.status !== "cancelled";

  // Qo'llash natijasi: faqat SANALGAN qatorlar tuzatiladi, sanalmaganlari tegilmaydi
  const counted = activeCount?.items.filter((item) => item.countedQty !== null) ?? [];
  const notCounted = (activeCount?.items.length ?? 0) - counted.length;
  const surplusLines = counted.filter((item) => toNumber(item.difference) > 0).length;
  const shortageLines = counted.filter((item) => toNumber(item.difference) < 0).length;
  const needle = itemSearch.trim().toLowerCase();
  const visibleItems = (activeCount?.items ?? []).filter(
    (item) =>
      needle === "" ||
      item.productName.toLowerCase().includes(needle) ||
      (item.productSku ?? "").toLowerCase().includes(needle),
  );

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Inventarizatsiya seanslari</p>
        {canCount && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Yangi seansni boshlash
          </Button>
        )}
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
            <Button onClick={handleCreate} disabled={!newName.trim() || createCount.isPending}>Yaratish</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* "Topilma" qo'shish: omborda bor, hisobda yo'q mahsulot */}
      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) setProductSearch(""); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Hisobga mahsulot qo'shish</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              autoFocus
              placeholder="Nomi yoki SKU"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
            />
            <div className="max-h-64 overflow-auto rounded-lg border border-border divide-y divide-border">
              {productOptions === undefined ? (
                <div className="p-3 space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
                </div>
              ) : productOptions.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground text-center">Mahsulot topilmadi</p>
              ) : (
                productOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    disabled={addItem.isPending}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted/50 disabled:opacity-50"
                    onClick={() => void handleAddProduct(option.id)}
                  >
                    <span className="truncate">{option.name}</span>
                    <span className="ml-2 shrink-0 font-mono text-[11px] text-muted-foreground">{option.sku}</span>
                  </button>
                ))
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Omborda qoldig'i yo'q mahsulot ham qo'shiladi — sanalgan miqdor kirim bo'lib yoziladi.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Qo'llashdan oldin: nima o'zgarishi aniq ko'rsatiladi (amal qaytarilmaydi) */}
      <Dialog open={confirmApply} onOpenChange={setConfirmApply}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Tuzatmalarni qo'llash</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground text-xs">
              Sanalgan qatorlar bo'yicha ombor qoldig'i to'g'rilanadi va buxgalteriyaga yozuv tushadi.
              Bu amalni qaytarib bo'lmaydi.
            </p>
            <div className="rounded-lg border border-border divide-y divide-border text-xs">
              <div className="flex justify-between px-3 py-2">
                <span className="text-muted-foreground">Sanalgan</span>
                <span className="font-medium">{counted.length} ta</span>
              </div>
              <div className="flex justify-between px-3 py-2">
                <span className="text-muted-foreground">Ortiqcha chiqqan</span>
                <span className="font-medium text-green-600">{surplusLines} ta</span>
              </div>
              <div className="flex justify-between px-3 py-2">
                <span className="text-muted-foreground">Kam chiqqan</span>
                <span className="font-medium text-destructive">{shortageLines} ta</span>
              </div>
              <div className="flex justify-between px-3 py-2">
                <span className="text-muted-foreground">Sanalmagan (tegilmaydi)</span>
                <span className="font-medium">{notCounted} ta</span>
              </div>
            </div>
            {counted.length === 0 && (
              <p className="text-xs text-destructive">Hech bir mahsulot sanalmagan — qo'llashdan foyda yo'q.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmApply(false)}>Bekor</Button>
            <Button
              disabled={applyAdjustments.isPending || counted.length === 0 || !activeCount}
              onClick={() => activeCount && void handleApply(activeCount.id)}
            >
              Qo'llash
            </Button>
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
                {activeCount.items.filter((i) => i.countedQty !== null).length} / {activeCount.items.length} ta mahsulot sanalib bo'ldi
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => setActiveCountId(null)}>
                Yopish
              </Button>
              {editable && canCount && (
                <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
                  <PackagePlus className="h-4 w-4 mr-1" /> Mahsulot qo'shish
                </Button>
              )}
              {editable && canCount && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  disabled={updateStatus.isPending}
                  onClick={() => handleCancelCount(activeCount.id)}
                >
                  <Ban className="h-4 w-4 mr-1" /> Bekor qilish
                </Button>
              )}
              {editable && activeCount.status === "in_progress" && canApply && (
                <Button size="sm" disabled={applyAdjustments.isPending} onClick={() => setConfirmApply(true)}>
                  <CheckCircle className="h-4 w-4 mr-1" /> Tuzatmalarni qo'llash
                </Button>
              )}
            </div>
          </div>

          {/* Qidiruv — ko'p mahsulotli omborda kerakli qatorni topish */}
          <div className="px-4 py-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                className="h-8 pl-7 text-xs"
                placeholder="Mahsulot nomi yoki SKU bo'yicha qidirish"
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
              />
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
                {visibleItems.map((item) => {
                  const diff = item.difference === null ? null : toNumber(item.difference);
                  return (
                    <tr key={item.id} className="hover:bg-muted/30">
                      <td className="px-4 py-2">
                        <p className="font-medium text-xs truncate max-w-[160px]">{item.productName}</p>
                        <p className="text-[11px] text-muted-foreground font-mono">{item.productSku}</p>
                      </td>
                      <td className="px-4 py-2 text-right text-xs font-mono">
                        {formatQty(item.expectedQty)} {item.unitName}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1 justify-center">
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            className="h-7 w-20 text-xs text-center"
                            value={countInputs[item.id] ?? (item.countedQty !== null ? String(toNumber(item.countedQty)) : "")}
                            onChange={(e) =>
                              setCountInputs((p) => ({ ...p, [item.id]: e.target.value }))
                            }
                            // Sanoqchi klaviaturadan chiqmasin: Enter saqlaydi, fokusdan chiqqanda ham saqlanadi
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void handleSaveItem(activeCount.id, item.id);
                              }
                            }}
                            onBlur={() => void handleSaveItem(activeCount.id, item.id)}
                            disabled={!editable || !canCount}
                          />
                          {editable && canCount && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              disabled={updateItem.isPending}
                              onClick={() => handleSaveItem(activeCount.id, item.id)}
                            >
                              <Check className="h-3.5 w-3.5 text-green-600" />
                            </Button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right">
                        {diff !== null && diff !== 0 && (
                          <span className={cn(
                            "text-xs font-bold font-mono",
                            diff > 0 ? "text-green-600" : "text-destructive"
                          )}>
                            {diff > 0 ? "+" : ""}{formatQty(diff)}
                          </span>
                        )}
                        {diff === 0 && item.countedQty !== null && (
                          <CheckCircle className="h-3.5 w-3.5 text-green-600 ml-auto" />
                        )}
                      </td>
                      <td className="px-4 py-2"></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visibleItems.length === 0 && (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                {needle ? "Qidiruv bo'yicha mahsulot topilmadi" : "Hisobda mahsulot yo'q"}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Sessions list */}
      {countsQuery.isError ? (
        <p className="text-sm text-destructive">{errorMessage(countsQuery.error)}</p>
      ) : counts === undefined ? (
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
          {canCount && (
            <EmptyContent>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-1" /> Yaratish
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <div className="space-y-2">
          {counts.map((c) => {
            const meta = STATUS_META[c.status] ?? STATUS_META.draft;
            return (
              <div
                key={c.id}
                className="flex items-center justify-between p-4 border border-border rounded-xl hover:bg-muted/30 transition-colors cursor-pointer"
                onClick={() => setActiveCountId(c.id)}
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
                  {c.status === "draft" && canCount && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={(e) => { e.stopPropagation(); void handleStart(c.id); }}
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
