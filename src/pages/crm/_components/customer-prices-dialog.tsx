/**
 * Mijoz bilan kelishilgan narxlar (`/api/sales/customer-prices`): ko'rish — `sales.view`, qo'shish/yopish — `sales.edit`
 * (server tekshiradi). Yangi narx shu mahsulot × birlikning oldingi narxini yopadi — tarix saqlanadi (server).
 * Narx sotuv, POS va agent buyurtmasida avtomatik qo'llanadi.
 */
import { useState } from "react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { usePermissions } from "@/hooks/use-company.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";

type Price = {
  id: string;
  productName: string;
  sku: string | null;
  unitName: string;
  price: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  notes: string | null;
};
type ProductOption = {
  id: string;
  name: string;
  sku: string | null;
  salesPrice: string;
  unitOptions?: { unitId: string; shortName: string; factor: string }[];
};

const money = (value: string) => new Intl.NumberFormat("uz-UZ").format(Number(value));
const localToday = () => new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);

export default function CustomerPricesDialog({ customer, onClose }: { customer: { id: string; name: string }; onClose: () => void }) {
  const { can } = usePermissions();
  const canEdit = can("sales.edit");
  const [showHistory, setShowHistory] = useState(false);
  const prices = useApiQuery<{ prices: Price[] }>("/api/sales/customer-prices", {
    customerId: customer.id,
    activeOnly: showHistory ? undefined : "true",
    limit: 1000,
  });

  const [search, setSearch] = useState("");
  const [debounced] = useDebounce(search.trim(), 300);
  const products =
    useApiQuery<{ products: ProductOption[] }>(
      canEdit ? "/api/catalog/products" : null,
      { isActive: true, limit: 30, withUnits: true, search: debounced || undefined },
      { placeholderData: (previous) => previous },
    ).data?.products ?? [];
  const [productId, setProductId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [price, setPrice] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(localToday());
  const [notes, setNotes] = useState("");
  const product = products.find((row) => row.id === productId);

  const save = useApiMutation((body: object) => api.post("/api/sales/customer-prices", body), { invalidate: ["/api/sales"] });
  const close = useApiMutation((priceId: string) => api.delete(`/api/sales/customer-prices/${priceId}`), { invalidate: ["/api/sales"] });

  const handleSave = async () => {
    const amount = Number(price.replace(/\s/g, "").replace(",", "."));
    if (!productId || !unitId) return toast.error("Mahsulot va birlikni tanlang");
    if (!(amount > 0)) return toast.error("Narx noldan katta bo'lsin");
    try {
      await save.mutateAsync({ customerId: customer.id, productId, unitId, price: String(amount), effectiveFrom, notes: notes.trim() || null });
      toast.success("Kelishilgan narx saqlandi");
      setPrice("");
      setNotes("");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const handleClose = async (row: Price) => {
    try {
      await close.mutateAsync(row.id);
      toast.success(`${row.productName}: narx yopildi`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const list = prices.data?.prices;
  const today = localToday();
  const isCurrent = (row: Price) => row.isActive && (!row.effectiveTo || row.effectiveTo >= today);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Kelishilgan narxlar — {customer.name}</DialogTitle>
          <DialogDescription>Sotuv, POS va agent buyurtmasida shu mijozga avtomatik qo'llanadi.</DialogDescription>
        </DialogHeader>

        {canEdit && (
          <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_7rem_8rem_9rem]" data-testid="customer-price-form">
            <div className="sm:col-span-4">
              <Label htmlFor="customer-price-search">Mahsulot</Label>
              <Input id="customer-price-search" placeholder="Nomi yoki SKU" value={search} onChange={(e) => setSearch(e.target.value)} />
              {products.length > 0 && (
                <select
                  aria-label="Mahsulotni tanlash"
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={productId}
                  onChange={(e) => {
                    const next = products.find((row) => row.id === e.target.value);
                    setProductId(e.target.value);
                    setUnitId(next?.unitOptions?.[0]?.unitId ?? "");
                  }}
                >
                  <option value="">— tanlang —</option>
                  {products.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}{row.sku ? ` (${row.sku})` : ""} · {money(row.salesPrice)}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <Label htmlFor="customer-price-unit">Birlik</Label>
              <select
                id="customer-price-unit"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
                disabled={!product}
              >
                {(product?.unitOptions ?? []).map((unit) => (
                  <option key={unit.unitId} value={unit.unitId}>{unit.shortName}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="customer-price-value">Narx</Label>
              <Input id="customer-price-value" inputMode="decimal" placeholder="0" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="customer-price-from">Boshlanish</Label>
              <Input id="customer-price-from" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button className="w-full" onClick={() => void handleSave()} disabled={save.isPending} data-testid="customer-price-save">
                {save.isPending ? "..." : "Saqlash"}
              </Button>
            </div>
            <div className="sm:col-span-4">
              <Input aria-label="Izoh" placeholder="Izoh (ixtiyoriy)" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={showHistory} onChange={(e) => setShowHistory(e.target.checked)} />
          Tarixni ham ko'rsatish (yopilgan narxlar)
        </label>

        {prices.error && <p className="text-sm text-destructive">{errorMessage(prices.error)}</p>}
        {!list && !prices.error && <Skeleton className="h-32" />}
        {list && list.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Kelishilgan narx yo'q.</p>}
        {list && list.length > 0 && (
          <div className="max-h-[45vh] overflow-auto rounded-lg border" data-testid="customer-price-list">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/60">
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Mahsulot</th>
                  <th className="px-3 py-2 font-medium">Birlik</th>
                  <th className="px-3 py-2 text-right font-medium">Narx</th>
                  <th className="px-3 py-2 font-medium">Amal qiladi</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {list.map((row) => (
                  <tr key={row.id} className={isCurrent(row) ? "border-t" : "border-t text-muted-foreground"}>
                    <td className="px-3 py-2">
                      <p className="font-medium">{row.productName}</p>
                      {row.notes && <p className="text-xs text-muted-foreground">{row.notes}</p>}
                    </td>
                    <td className="px-3 py-2">{row.unitName}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(row.price)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{row.effectiveFrom} — {row.effectiveTo ?? "…"}</td>
                    <td className="px-3 py-2 text-right">
                      {canEdit && isCurrent(row) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={`${row.productName} narxini yopish`}
                          onClick={() => void handleClose(row)}
                          disabled={close.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
