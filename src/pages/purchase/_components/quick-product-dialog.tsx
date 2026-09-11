/**
 * Xarid oynasidan chiqmasdan yangi mahsulot qo'shish.
 * SKU bo'sh qoldirilsa serverda avtomatik raqam beriladi (1001, 1002, …).
 */
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, PackagePlus } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import type { Category, Unit } from "@/pages/products/_lib/types.ts";
import type { ProductOption } from "../_lib/types.ts";

const NO_CATEGORY = "__none__";

type Props = {
  onClose: () => void;
  onCreated: (product: ProductOption) => void;
};

export default function QuickProductDialog({ onClose, onCreated }: Props) {
  const units = useApiQuery<{ units: Unit[] }>("/api/catalog/units").data?.units;
  const categories = useApiQuery<{ categories: Category[] }>("/api/catalog/categories").data?.categories;

  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");
  const [unitId, setUnitId] = useState("");
  const [categoryId, setCategoryId] = useState(NO_CATEGORY);
  const [purchasePrice, setPurchasePrice] = useState("");
  const [salesPrice, setSalesPrice] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Standart birlik — "dona"
  if (!unitId && units?.length) {
    setUnitId((units.find((u) => u.shortName === "d") ?? units[0]!).id);
  }

  const create = useApiMutation(
    (body: object) => api.post<{ product: ProductOption }>("/api/catalog/products", body),
    { invalidate: ["/api/catalog/products"] },
  );

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!name.trim() || !unitId || create.isPending) return;
    setError(null);
    try {
      const { product } = await create.mutateAsync({
        name: name.trim(),
        ...(sku.trim() ? { sku: sku.trim() } : {}),
        barcode: barcode.trim() || null,
        baseUnitId: unitId,
        ...(categoryId !== NO_CATEGORY ? { categoryId } : {}),
        purchasePrice: purchasePrice.trim() || "0",
        salesPrice: salesPrice.trim() || "0",
        isPurchaseable: true,
        isSaleable: true,
      });
      toast.success(`Mahsulot qo'shildi: ${product.name} (SKU ${product.sku})`);
      onCreated(product);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackagePlus className="h-5 w-5 text-primary" />
            Yangi mahsulot
          </DialogTitle>
          <DialogDescription>
            Saqlangach xarid qatoriga darhol tanlanadi. Qolgan ma'lumotlarni keyin Mahsulotlar bo'limida to'ldirasiz.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => { void handleSave(e); }} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="quick-product-name">Nomi *</Label>
            <Input
              id="quick-product-name"
              autoFocus
              value={name}
              onChange={(e) => { setName(e.target.value); setError(null); }}
              placeholder="Masalan: Coca-Cola 1.5 l"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="quick-product-sku">SKU</Label>
              <Input
                id="quick-product-sku"
                value={sku}
                onChange={(e) => { setSku(e.target.value); setError(null); }}
                placeholder="Avtomatik (1001…)"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quick-product-barcode">Shtrix-kod</Label>
              <Input id="quick-product-barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Ixtiyoriy" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>O'lchov birligi *</Label>
              <Select value={unitId} onValueChange={setUnitId}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Tanlang" /></SelectTrigger>
                <SelectContent position="popper">
                  {units?.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name} ({u.shortName})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Kategoriya</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value={NO_CATEGORY}>Kategoriyasiz</SelectItem>
                  {categories?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="quick-product-purchase">Xarid narxi</Label>
              <Input
                id="quick-product-purchase"
                type="number"
                min="0"
                step="any"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quick-product-sales">Sotuv narxi</Label>
              <Input
                id="quick-product-sales"
                type="number"
                min="0"
                step="any"
                value={salesPrice}
                onChange={(e) => setSalesPrice(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Bekor</Button>
            <Button type="submit" disabled={create.isPending || !name.trim() || !unitId}>
              {create.isPending ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Saqlanmoqda</> : "Qo'shish"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
