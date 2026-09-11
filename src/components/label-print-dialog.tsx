/**
 * Etiketka chop etish — shablon (Sozlamalar → Etiketka), mahsulotlar va nusxa soni, jonli ko'rinish.
 * Qidiruv orqali yana mahsulot qo'shiladi: bir nechta mahsulot bitta chop etishda.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Minus, Plus, Printer, Search, Tag, Trash2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { useApiQuery } from "@/lib/query.ts";
import { useDebounce } from "@/hooks/use-debounce.ts";
import { useActiveCompany } from "@/hooks/use-company.ts";
import { usePrintSettings } from "@/hooks/use-print-settings.ts";
import { printHtml } from "@/lib/print/receipt-html.ts";
import { buildLabelsHtml, labelCode, toLabelProduct, type LabelItem } from "@/lib/print/label-html.ts";
import type { ProductListItem } from "@/pages/products/_lib/types.ts";

const MAX_LABELS = 2000;

type Props = {
  initialItems: LabelItem[];
  onClose: () => void;
};

export default function LabelPrintDialog({ initialItems, onClose }: Props) {
  const { labels } = usePrintSettings();
  const companyName = useActiveCompany().data?.company.name;
  const [templateId, setTemplateId] = useState<string | null>(null);
  const template =
    labels.templates.find((t) => t.id === (templateId ?? labels.defaultTemplateId)) ?? labels.templates[0]!;

  const [items, setItems] = useState<LabelItem[]>(initialItems);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search.trim(), 250);
  const found = useApiQuery<{ products: ProductListItem[] }>(
    debouncedSearch ? "/api/catalog/products" : null,
    { search: debouncedSearch, limit: 8, isActive: true },
  ).data?.products;

  const total = items.reduce((sum, item) => sum + item.quantity, 0);
  const first = items.find((item) => item.quantity > 0);
  const previewHtml = first
    ? buildLabelsHtml(
        [{ product: first.product, quantity: template.layout === "a4" ? template.columns : 1 }],
        template,
        { companyName, previewWidthPx: 340 },
      )
    : null;

  const setQuantity = (index: number, quantity: number) =>
    setItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, quantity: Math.max(0, Math.min(MAX_LABELS, Math.round(quantity) || 0)) } : item,
      ),
    );

  const addProduct = (product: ProductListItem) => {
    setItems((prev) =>
      prev.some((item) => item.product.id === product.id)
        ? prev.map((item) => (item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item))
        : [...prev, { product: toLabelProduct(product), quantity: 1 }],
    );
    setSearch("");
  };

  const handlePrint = () => {
    if (total === 0) { toast.error("Etiketka soni 0"); return; }
    if (total > MAX_LABELS) { toast.error(`Bir martada ko'pi bilan ${MAX_LABELS} ta etiketka`); return; }
    printHtml(buildLabelsHtml(items, template, { companyName }));
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-primary" />
            Etiketka chop etish
          </DialogTitle>
          <DialogDescription>Shablonlar Sozlamalar → Etiketka bo'limida sozlanadi.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_340px] gap-4">
          <div className="space-y-3 min-w-0">
            <div className="space-y-1.5">
              <Label>Shablon</Label>
              <Select value={template.id} onValueChange={setTemplateId}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent position="popper">
                  {labels.templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} · {t.widthMm}×{t.heightMm} mm
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Mahsulot qo'shish: nomi, SKU, shtrix-kod"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {debouncedSearch && found && (
                <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-xl border border-border bg-popover shadow-lg">
                  {found.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-muted-foreground">Topilmadi</p>
                  ) : (
                    found.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => addProduct(product)}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent cursor-pointer"
                      >
                        <span className="truncate">{product.name}</span>
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">{product.sku}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="max-h-72 overflow-y-auto rounded-xl border border-border divide-y divide-border">
              {items.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">Mahsulot qo'shing</p>
              ) : (
                items.map((item, index) => (
                  <div key={item.product.id} className="flex items-center gap-1.5 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.product.name}</p>
                      <p className="text-[11px] text-muted-foreground font-mono truncate">{labelCode(item.product)}</p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setQuantity(index, item.quantity - 1)}>
                      <Minus className="h-3 w-3" />
                    </Button>
                    <Input
                      type="number"
                      min={0}
                      max={MAX_LABELS}
                      className="h-8 w-16 text-center"
                      value={item.quantity}
                      onChange={(e) => setQuantity(index, Number(e.target.value))}
                    />
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setQuantity(index, item.quantity + 1)}>
                      <Plus className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Olib tashlash"
                      onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="space-y-3">
            {previewHtml ? (
              <iframe
                title="Etiketka ko'rinishi"
                sandbox=""
                srcDoc={previewHtml}
                className="w-full h-64 rounded-xl border border-border bg-muted/40"
              />
            ) : (
              <div className="h-64 rounded-xl border border-dashed border-border flex items-center justify-center text-sm text-muted-foreground">
                Ko'rinish
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {template.layout === "roll" ? "Termal etiketka printeri — har etiketka alohida" : `A4 varaq — ${template.columns} ustun`}
              {" · "}{template.widthMm}×{template.heightMm} mm
            </p>
            <Button className="w-full" onClick={handlePrint} disabled={total === 0}>
              <Printer className="h-4 w-4 mr-2" /> {total} ta etiketka chop etish
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
