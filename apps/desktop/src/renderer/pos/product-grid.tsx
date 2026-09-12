import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import type { PosCategory, PosProduct } from "../../shared/kassa-api.js";
import { decimalInput, fmtMoney, fmtQty, num } from "../format.ts";

const QTY = /^\d{1,14}(\.\d{1,4})?$/;

/** Rasm manzili: main jarayon keshdan yoki serverdan beradi; versiya o'zgarsa (rasm almashtirilgan) — yangi manzil. */
const productImageUrl = (product: Pick<PosProduct, "id" | "imageVersion">) =>
  product.imageVersion ? `bum-image://product/${product.id}?v=${product.imageVersion}` : null;

/** Rasm (kerak bo'lganda yuklanadi) yoki nomning bosh harflari — rasm yo'q, offline va keshda yo'q yoki buzilgan bo'lsa. */
export function ProductImage({ product, className = "", fit = "cover" }: { product: PosProduct; className?: string; fit?: "cover" | "contain" }) {
  const url = productImageUrl(product);
  const [failed, setFailed] = useState<string | null>(null);
  if (!url || failed === url) {
    const initials = product.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]!.toUpperCase())
      .join("");
    return (
      <div className={`flex select-none items-center justify-center bg-muted font-semibold text-muted-foreground ${className}`} aria-hidden>
        {initials || "?"}
      </div>
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      className={`bg-muted ${fit === "cover" ? "object-cover" : "object-contain"} ${className}`}
      onError={() => setFailed(url)}
    />
  );
}

function Price({ product, base, large = false }: { product: PosProduct; base: string; large?: boolean }) {
  if (product.price === null) return <span className="text-sm text-destructive">kurs yo'q</span>;
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span className={`font-bold tabular-nums ${product.promo ? "text-destructive" : ""} ${large ? "text-3xl" : "text-base"}`}>{fmtMoney(product.price, base)}</span>
      {product.promo && product.regularPrice && product.regularPrice !== product.price && (
        <s className={`tabular-nums text-muted-foreground ${large ? "text-base" : "text-xs"}`}>{fmtMoney(product.regularPrice, base)}</s>
      )}
    </span>
  );
}

function Stock({ product }: { product: PosProduct }) {
  const stock = num(product.stock);
  return (
    <span className={`tabular-nums ${stock < 0 ? "text-destructive" : stock === 0 ? "text-amber-600" : "text-muted-foreground"}`}>
      {fmtQty(product.stock)} {product.unitName}
    </span>
  );
}

export function PromoBadges({ product, discountPercent }: { product: PosProduct; discountPercent: number }) {
  return (
    <>
      {product.promo && <span className="rounded bg-destructive px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Aksiya</span>}
      {discountPercent > 0 && (
        <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Chegirma {trimPercent(discountPercent)}%</span>
      )}
    </>
  );
}

const trimPercent = (value: number) => String(Math.round(value * 100) / 100);

/** Mahsulot kartasi: rasm yoki nomni bosish — savatga +1; ⓘ — batafsil (katta rasm, miqdor). */
export function ProductCard({
  product,
  base,
  discountPercent,
  inCart,
  onAdd,
  onDetails,
}: {
  product: PosProduct;
  base: string;
  discountPercent: number;
  inCart: number;
  onAdd: (product: PosProduct) => void;
  onDetails: (product: PosProduct) => void;
}) {
  return (
    <div className="relative flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/60">
      <button type="button" className="relative block aspect-[4/3] w-full overflow-hidden" title={`${product.name} — savatga +1`} onClick={() => onAdd(product)}>
        <ProductImage product={product} className="h-full w-full text-3xl" />
        <span className="absolute left-1.5 top-1.5 flex flex-col items-start gap-1">
          <PromoBadges product={product} discountPercent={discountPercent} />
        </span>
        {inCart > 0 && (
          <span className="absolute right-1.5 top-1.5 min-w-6 rounded-full bg-primary px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums text-primary-foreground">
            {fmtQty(String(inCart))}
          </span>
        )}
      </button>
      <button type="button" className="flex flex-1 flex-col items-start gap-0.5 p-2 pr-8 text-left" onClick={() => onAdd(product)}>
        <span className="line-clamp-2 text-sm font-medium leading-snug">{product.name}</span>
        <Price product={product} base={base} />
        <span className="text-xs">
          <Stock product={product} />
        </span>
      </button>
      <button
        type="button"
        className="absolute bottom-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background text-xs text-muted-foreground hover:text-foreground"
        aria-label={`${product.name} — batafsil`}
        onClick={() => onDetails(product)}
      >
        ⓘ
      </button>
    </div>
  );
}

/** Kategoriya tablari (ichki kategoriyalar ota kategoriyaga qo'shilgan). */
export function CategoryChips({ categories, active, onPick }: { categories: PosCategory[]; active: string | null; onPick: (id: string | null) => void }) {
  if (categories.length === 0) return null;
  const chip = (id: string | null, label: string, count?: number) => (
    <button
      key={id ?? "all"}
      type="button"
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-sm ${
        active === id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/60"
      }`}
      onClick={() => onPick(id)}
    >
      {label}
      {count !== undefined && <span className={`text-xs tabular-nums ${active === id ? "opacity-80" : "text-muted-foreground"}`}>{count}</span>}
    </button>
  );
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      {chip(null, "Hammasi")}
      {categories.map((category) => chip(category.id, category.name, category.products))}
    </div>
  );
}

function DetailBody({ product, base, discountPercent, onAdd }: { product: PosProduct; base: string; discountPercent: number; onAdd: (product: PosProduct, quantity: string) => void }) {
  const [quantity, setQuantity] = useState("1");
  const valid = QTY.test(quantity) && num(quantity) > 0;
  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_17rem]">
      <ProductImage product={product} fit="contain" className="aspect-square w-full rounded-xl text-6xl" />
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1">
          <PromoBadges product={product} discountPercent={discountPercent} />
        </div>
        <Price product={product} base={base} large />
        {product.promo && <p className="text-sm text-destructive">Aksiya narxi{product.promo.endsAt ? ` — ${product.promo.endsAt} gacha` : ""}</p>}
        {product.salesCurrency && product.salesCurrency !== base && (
          <p className="text-xs text-muted-foreground">Narx valyutada: {fmtMoney(product.salesPrice, product.salesCurrency)}</p>
        )}
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Qoldiq</dt>
            <dd>
              <Stock product={product} />
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Soliq</dt>
            <dd className="tabular-nums">
              {trimPercent(num(product.taxRate))}% {product.taxIncluded ? "(narx ichida)" : ""}
            </dd>
          </div>
        </dl>
        <form
          className="mt-auto flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) onAdd(product, quantity);
          }}
        >
          <Input id="detail-quantity" autoFocus inputMode="decimal" className="h-11 text-base" value={quantity} onChange={(e) => setQuantity(decimalInput(e.target.value))} />
          <Button type="submit" className="h-11 shrink-0" disabled={!valid || product.price === null}>
            Savatga
          </Button>
        </form>
      </div>
    </div>
  );
}

export function ProductDetailDialog({
  product,
  base,
  discountPercent,
  onClose,
  onAdd,
}: {
  product: PosProduct | null;
  base: string;
  discountPercent: number;
  onClose: () => void;
  onAdd: (product: PosProduct, quantity: string) => void;
}) {
  return (
    <Dialog open={product !== null} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        {product && (
          <>
            <DialogHeader>
              <DialogTitle>{product.name}</DialogTitle>
              <DialogDescription>
                SKU {product.sku}
                {product.barcode ? ` · shtrix-kod ${product.barcode}` : ""}
              </DialogDescription>
            </DialogHeader>
            <DetailBody key={product.id} product={product} base={base} discountPercent={discountPercent} onAdd={onAdd} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
