import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Package, ChevronDown, ChevronRight, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import type { Id, Doc } from "@/convex/_generated/dataModel.d.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

type Product = Doc<"products"> & { categoryName?: string; brandName?: string; baseUnitName?: string };

export default function BOMSection() {
  const boms = useQuery(api.manufacturing.boms.listBOMs, {});
  const productsResult = useQuery(api.products.products.list, {
    paginationOpts: { numItems: 500, cursor: null },
  });
  const units = useQuery(api.products.units.list, {});

  const createBOM = useMutation(api.manufacturing.boms.createBOM);
  const deleteBOM = useMutation(api.manufacturing.boms.deleteBOM);
  const addBOMItem = useMutation(api.manufacturing.boms.addBOMItem);
  const deleteBOMItem = useMutation(api.manufacturing.boms.deleteBOMItem);

  const [createOpen, setCreateOpen] = useState(false);
  const [expandedBom, setExpandedBom] = useState<Id<"boms"> | null>(null);
  const [addItemBom, setAddItemBom] = useState<Id<"boms"> | null>(null);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({ productId: "", name: "", version: "v1.0", quantity: "1", unitId: "" });
  const [itemForm, setItemForm] = useState({ productId: "", quantity: "1", unitId: "", scrapPercent: "0" });

  const expandedBomData = useQuery(
    api.manufacturing.boms.getBOM,
    expandedBom ? { id: expandedBom } : "skip"
  );

  const handleCreate = async () => {
    if (!form.productId || form.productId === "none" || !form.name || !form.unitId || form.unitId === "none") {
      toast.error("Mahsulot, nom va o'lchov birligi kiritilishi shart");
      return;
    }
    setLoading(true);
    try {
      const bomId = await createBOM({
        productId: form.productId as Id<"products">,
        name: form.name,
        version: form.version,
        quantity: parseFloat(form.quantity) || 1,
        unitId: form.unitId as Id<"units">,
      });
      toast.success("BOM yaratildi");
      setCreateOpen(false);
      setForm({ productId: "", name: "", version: "v1.0", quantity: "1", unitId: "" });
      setExpandedBom(bomId as Id<"boms">);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Xatolik"); }
    finally { setLoading(false); }
  };

  const handleAddItem = async () => {
    if (!addItemBom || !itemForm.productId || itemForm.productId === "none" || !itemForm.unitId || itemForm.unitId === "none") {
      toast.error("Komponent va o'lchov birligi kiritilishi shart");
      return;
    }
    try {
      await addBOMItem({
        bomId: addItemBom,
        productId: itemForm.productId as Id<"products">,
        quantity: parseFloat(itemForm.quantity) || 1,
        unitId: itemForm.unitId as Id<"units">,
        scrapPercent: parseFloat(itemForm.scrapPercent) || 0,
      });
      toast.success("Komponent qo'shildi");
      setAddItemBom(null);
      setItemForm({ productId: "", quantity: "1", unitId: "", scrapPercent: "0" });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Xatolik"); }
  };

  const productList: Product[] = productsResult?.page ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Material tarkibi (BOM)</h3>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> BOM yaratish
        </Button>
      </div>

      {!boms ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>
      ) : boms.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-center">
          <Package className="h-12 w-12 text-muted-foreground/20 mb-3" />
          <p className="text-muted-foreground">BOM yo'q</p>
          <Button size="sm" className="mt-3" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-1" /> BOM yaratish</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {boms.map((bom) => (
            <div key={bom._id} className="bg-card border border-border rounded-2xl overflow-hidden">
              <div
                className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/20"
                onClick={() => setExpandedBom(expandedBom === bom._id ? null : bom._id)}
              >
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Package className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">{bom.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {bom.productName} · {bom.version} · {bom.quantity} {bom.unitName} · {bom.itemCount} ta komponent
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={(e) => { e.stopPropagation(); deleteBOM({ id: bom._id }); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                  {expandedBom === bom._id ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </div>
              </div>

              {expandedBom === bom._id && (
                <div className="border-t border-border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Komponentlar</p>
                    <Button size="sm" variant="secondary" onClick={() => setAddItemBom(bom._id)}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Komponent qo'shish
                    </Button>
                  </div>

                  {!expandedBomData ? (
                    <div className="space-y-1">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-xl" />)}</div>
                  ) : expandedBomData.items.length === 0 ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                      <AlertCircle className="h-4 w-4" />
                      Hali komponent qo'shilmagan
                    </div>
                  ) : (
                    <div className="rounded-xl border border-border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/30 border-b border-border">
                            <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Komponent</th>
                            <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Miqdor</th>
                            <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Chiqim %</th>
                            <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Birlik narx</th>
                            <th className="w-10 px-2"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {expandedBomData.items.map((item) => (
                            <tr key={item._id} className="hover:bg-muted/20">
                              <td className="px-4 py-2.5">
                                <p className="font-medium">{item.componentName}</p>
                                <p className="text-xs text-muted-foreground font-mono">{item.componentSku}</p>
                              </td>
                              <td className="px-4 py-2.5 text-right">{item.quantity} {item.unitName}</td>
                              <td className="px-4 py-2.5 text-right text-amber-600">{item.scrapPercent}%</td>
                              <td className="px-4 py-2.5 text-right text-muted-foreground">{fmt(item.unitCost)} so'm</td>
                              <td className="px-2 py-2.5 text-right">
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => deleteBOMItem({ id: item._id })}>
                                  <Trash2 className="h-3 w-3 text-destructive" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-muted/20 border-t border-border">
                            <td className="px-4 py-2.5 text-xs font-semibold text-muted-foreground" colSpan={3}>
                              Jami material narxi ({bom.quantity} {bom.unitName} uchun)
                            </td>
                            <td className="px-4 py-2.5 text-right font-bold">
                              {fmt(expandedBomData.items.reduce((s, i) => s + i.quantity * i.unitCost, 0))} so'm
                            </td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create BOM dialog */}
      {createOpen && (
        <Dialog open onOpenChange={(o) => !o && setCreateOpen(false)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Yangi BOM yaratish</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Tayyor mahsulot *</Label>
                <Select value={form.productId} onValueChange={(v) => {
                  const p = productList.find((p) => p._id === v);
                  setForm({ ...form, productId: v, name: p ? `${p.name} BOM` : form.name, unitId: p?.baseUnitId ?? form.unitId });
                }}>
                  <SelectTrigger><SelectValue placeholder="Mahsulot tanlang" /></SelectTrigger>
                  <SelectContent>
                    {productList.filter((p) => p.isManufactured).map((p) => (
                      <SelectItem key={p._id} value={p._id}>{p.name} ({p.sku})</SelectItem>
                    ))}
                    {productList.filter((p) => !p.isManufactured).map((p) => (
                      <SelectItem key={p._id} value={p._id}>{p.name} ({p.sku})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>BOM nomi *</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Asosiy BOM" />
                </div>
                <div>
                  <Label>Versiya</Label>
                  <Input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} placeholder="v1.0" />
                </div>
                <div>
                  <Label>Chiqish miqdori *</Label>
                  <Input type="number" min="0.001" step="0.001" value={form.quantity}
                    onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="1" />
                </div>
                <div>
                  <Label>O'lchov birligi *</Label>
                  <Select value={form.unitId} onValueChange={(v) => setForm({ ...form, unitId: v })}>
                    <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
                    <SelectContent>
                      {units?.map((u) => <SelectItem key={u._id} value={u._id}>{u.name} ({u.shortName})</SelectItem>)}
                    </SelectContent>
                  </Select>
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

      {/* Add BOM item dialog */}
      {addItemBom && (
        <Dialog open onOpenChange={(o) => !o && setAddItemBom(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Komponent qo'shish</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Komponent mahsulot *</Label>
                <Select value={itemForm.productId} onValueChange={(v) => {
                  const p = productList.find((p) => p._id === v);
                  setItemForm({ ...itemForm, productId: v, unitId: p?.baseUnitId ?? itemForm.unitId });
                }}>
                  <SelectTrigger><SelectValue placeholder="Xom ashyo tanlang" /></SelectTrigger>
                  <SelectContent>
                    {productList.map((p) => <SelectItem key={p._id} value={p._id}>{p.name} ({p.sku})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Miqdor *</Label>
                  <Input type="number" min="0.001" step="0.001" value={itemForm.quantity}
                    onChange={(e) => setItemForm({ ...itemForm, quantity: e.target.value })} placeholder="1" />
                </div>
                <div>
                  <Label>Birligi</Label>
                  <Select value={itemForm.unitId} onValueChange={(v) => setItemForm({ ...itemForm, unitId: v })}>
                    <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
                    <SelectContent>
                      {units?.map((u) => <SelectItem key={u._id} value={u._id}>{u.shortName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Chiqim %</Label>
                  <Input type="number" min="0" max="100" value={itemForm.scrapPercent}
                    onChange={(e) => setItemForm({ ...itemForm, scrapPercent: e.target.value })} placeholder="0" />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setAddItemBom(null)}>Bekor</Button>
              <Button onClick={handleAddItem}>Qo'shish</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
