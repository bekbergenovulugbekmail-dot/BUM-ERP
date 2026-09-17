/**
 * Ombor → Katalog: mahsulot, xom ashyo va yarim tayyor mahsulotlar bitta ro'yxatda.
 *
 * Uchalasi ham bitta katalogda (`products.kind`) — qoldiq, harakat va inventarizatsiya ular uchun
 * bir xil ishlaydi. Shu yerdan yangisini qo'shsa bo'ladi: tur oldindan tanlangan holda ochiladi.
 *
 * Ko'rish — `products.view`, qo'shish — `products.create` (serverda ham tekshiriladi).
 */
import { useState } from "react";
import { toast } from "sonner";
import { Boxes, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog.tsx";
import { cn } from "@/lib/utils.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { useDebounce } from "@/hooks/use-debounce.ts";
import { usePermissions } from "@/hooks/use-company.ts";

const INVALIDATE = ["/api/catalog/products"];

export type ProductKind = "product" | "raw_material" | "semi_finished";

const KINDS: { key: ProductKind; label: string; hint: string; tone: string }[] = [
  {
    key: "product",
    label: "Mahsulot",
    hint: "Sotiladigan tayyor mahsulot",
    tone: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  },
  {
    key: "raw_material",
    label: "Xom ashyo",
    hint: "Ishlab chiqarishga kiradi, odatda sotilmaydi",
    tone: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  },
  {
    key: "semi_finished",
    label: "Yarim tayyor",
    hint: "Ishlab chiqarilgan, yana boshqa mahsulotga kiradi",
    tone: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  },
];
const kindOf = (key: string) => KINDS.find((item) => item.key === key);

type Item = {
  id: string;
  name: string;
  sku: string;
  kind: ProductKind;
  baseUnitName: string | null;
  categoryName: string | null;
  isActive: boolean;
};
type Unit = { id: string; name: string; shortName: string };

export default function CatalogSection() {
  const { can } = usePermissions();
  const canCreate = can("products.create");
  const [kind, setKind] = useState<ProductKind | "all">("all");
  const [search, setSearch] = useState("");
  const [debounced] = useDebounce(search.trim(), 250);
  const [adding, setAdding] = useState<ProductKind | null>(null);

  const items = useApiQuery<{ products: Item[] }>("/api/catalog/products", {
    limit: 200,
    isActive: true,
    ...(kind === "all" ? {} : { kind }),
    ...(debounced ? { search: debounced } : {}),
  }).data?.products;

  return (
    <div className="flex h-full flex-col gap-3 p-1">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5" data-testid="catalog-kinds">
          <button
            type="button"
            onClick={() => setKind("all")}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer",
              kind === "all" ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent",
            )}
          >
            Hammasi
          </button>
          {KINDS.map((item) => (
            <button
              key={item.key}
              type="button"
              title={item.hint}
              onClick={() => setKind(item.key)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer",
                kind === item.key ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nomi yoki SKU..."
            aria-label="Katalogdan qidirish"
            className="h-9 w-56 pl-9"
          />
        </div>
        {canCreate && (
          <Button size="sm" data-testid="catalog-add" onClick={() => setAdding(kind === "all" ? "product" : kind)}>
            <Plus className="h-4 w-4 mr-1" /> Qo'shish
          </Button>
        )}
      </div>

      {!items ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          <Boxes className="mb-2 h-8 w-8 opacity-30" />
          {kind === "all" ? "Katalog bo'sh" : `"${kindOf(kind)?.label}" turida yozuv yo'q`}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border" data-testid="catalog-list">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80 text-left text-xs text-muted-foreground backdrop-blur">
              <tr>
                <th className="px-4 py-2 font-medium">Nomi</th>
                <th className="px-4 py-2 font-medium">SKU</th>
                <th className="px-4 py-2 font-medium">Turi</th>
                <th className="px-4 py-2 font-medium">Birlik</th>
                <th className="px-4 py-2 font-medium">Kategoriya</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2 font-medium">{item.name}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{item.sku}</td>
                  <td className="px-4 py-2">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", kindOf(item.kind)?.tone)}>
                      {kindOf(item.kind)?.label ?? item.kind}
                    </span>
                  </td>
                  <td className="px-4 py-2">{item.baseUnitName ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{item.categoryName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && <AddDialog kind={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}

function AddDialog({ kind, onClose }: { kind: ProductKind; onClose: () => void }) {
  const units = useApiQuery<{ units: Unit[] }>("/api/catalog/units").data?.units;
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [unitId, setUnitId] = useState("");
  const [current, setCurrent] = useState<ProductKind>(kind);
  const [error, setError] = useState<string | null>(null);

  const create = useApiMutation((body: object) => api.post("/api/catalog/products", body), { invalidate: INVALIDATE });
  const unit = unitId || units?.[0]?.id || "";

  const submit = async () => {
    setError(null);
    try {
      await create.mutateAsync({
        name: name.trim(),
        ...(sku.trim() ? { sku: sku.trim() } : {}),
        baseUnitId: unit,
        kind: current,
        // Xom ashyo va yarim tayyor sotuvga chiqmaydi; yarim tayyor ishlab chiqariladi
        isSaleable: current === "product",
        isPurchaseable: current !== "semi_finished",
        isManufactured: current === "semi_finished",
      });
      toast.success(`${kindOf(current)?.label} qo'shildi`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="catalog-dialog">
        <DialogHeader>
          <DialogTitle>Katalogga qo'shish</DialogTitle>
          <DialogDescription>{kindOf(current)?.hint}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="catalog-kind">Turi</Label>
            <Select value={current} onValueChange={(value) => setCurrent(value as ProductKind)}>
              <SelectTrigger id="catalog-kind" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent position="popper">
                {KINDS.map((item) => (
                  <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="catalog-name">Nomi</Label>
            <Input id="catalog-name" value={name} onChange={(event) => { setName(event.target.value); setError(null); }} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="catalog-sku">SKU (bo'sh qoldirilsa avtomatik)</Label>
            <Input id="catalog-sku" value={sku} onChange={(event) => setSku(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="catalog-unit">O'lchov birligi</Label>
            <Select value={unit} onValueChange={setUnitId}>
              <SelectTrigger id="catalog-unit" className="w-full"><SelectValue placeholder="Tanlang" /></SelectTrigger>
              <SelectContent position="popper">
                {(units ?? []).map((item) => (
                  <SelectItem key={item.id} value={item.id}>{item.name} ({item.shortName})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            Narx, qoldiq chegarasi va boshqa maydonlarni Mahsulotlar sahifasida to'ldirasiz.
          </p>
          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Bekor</Button>
          <Button data-testid="catalog-save" disabled={create.isPending || !name.trim() || !unit} onClick={() => { void submit(); }}>
            Qo'shish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
