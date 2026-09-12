import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Info, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import type { PosCategory, PosProduct } from "../../shared/kassa-api.js";
import { decimalInput, fmtMoney, fmtQty, num } from "../format.ts";

const QTY = /^\d{1,14}(\.\d{1,4})?$/;
/** Sensorli ekranda uzoq bosish — batafsil oyna (tezkor sotuvda oddiy bosish darhol savatga). */
const LONG_PRESS_MS = 550;

/** Rasm manzili: main jarayon keshdan yoki serverdan beradi; versiya o'zgarsa (rasm almashtirilgan) — yangi manzil. */
const productImageUrl = (product: { id: string; imageVersion?: string | null }) =>
  product.imageVersion ? `bum-image://product/${product.id}?v=${product.imageVersion}` : null;

type ImageSource = { id: string; name: string; imageVersion?: string | null };

/** Rasm (kerak bo'lganda yuklanadi) yoki nomning bosh harflari — rasm yo'q, offline va keshda yo'q yoki buzilgan bo'lsa. */
export function ProductImage({ product, className = "", fit = "cover" }: { product: ImageSource; className?: string; fit?: "cover" | "contain" }) {
  const url = productImageUrl(product);
  const [failed, setFailed] = useState<string | null>(null);
  if (!url || failed === url) {
    // Bosh harflar faqat harf/raqamdan ("Non (tandir)" → "NT", qavs emas)
    const initials = product.name
      .split(/\s+/)
      .map((word) => /[\p{L}\p{N}]/u.exec(word)?.[0])
      .filter((letter): letter is string => !!letter)
      .slice(0, 2)
      .join("")
      .toUpperCase();
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

/** Qoldiq holati: tugagan (≤ 0), kam (minimal qoldiqqa yetgan), bor. Rang bilan birga matn — faqat rangga tayanilmaydi. */
function stockState(product: Pick<PosProduct, "stock" | "minStock">): "out" | "low" | "ok" {
  const stock = num(product.stock);
  if (stock <= 0) return "out";
  const min = num(product.minStock);
  return min > 0 && stock <= min ? "low" : "ok";
}

const STOCK_TONE = { out: "text-pos-stock-out", low: "text-pos-stock-low", ok: "text-pos-stock-ok" } as const;

function Stock({ product }: { product: PosProduct }) {
  const state = stockState(product);
  const label = state === "out" ? (num(product.stock) < 0 ? "Minus" : "Tugagan") : state === "low" ? "Kam" : "Bor";
  return (
    <span className={`inline-flex items-center gap-1 font-medium tabular-nums ${STOCK_TONE[state]}`}>
      <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
      {label} · {fmtQty(product.stock)} {product.unitName}
    </span>
  );
}

function Price({ product, base, large = false }: { product: PosProduct; base: string; large?: boolean }) {
  if (product.price === null) return <span className="text-sm font-medium text-pos-danger">kurs yo'q</span>;
  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5">
      <span className={`font-extrabold tabular-nums ${product.promo ? "text-pos-promotion" : "text-pos-price"} ${large ? "text-3xl" : "text-lg leading-tight"}`}>
        {fmtMoney(product.price, base)}
      </span>
      <span className={`text-muted-foreground ${large ? "text-base" : "text-xs"}`}>/ {product.unitName}</span>
      {product.promo && product.regularPrice && product.regularPrice !== product.price && (
        <s className={`w-full tabular-nums text-muted-foreground ${large ? "text-base" : "text-xs"}`}>{fmtMoney(product.regularPrice, base)}</s>
      )}
    </span>
  );
}

export function PromoBadges({ product, discountPercent }: { product: PosProduct; discountPercent: number }) {
  return (
    <>
      {product.promo && (
        <span className="rounded-md bg-pos-promotion px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-pos-promotion-foreground uppercase shadow-pos">Aksiya</span>
      )}
      {discountPercent > 0 && (
        <span className="rounded-md bg-pos-success px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-pos-success-foreground uppercase shadow-pos">
          Chegirma {trimPercent(discountPercent)}%
        </span>
      )}
    </>
  );
}

const trimPercent = (value: number) => String(Math.round(value * 100) / 100);

/**
 * Mahsulot kartasi: rasm yoki nomni bosish — savatga +1 (tasdiqlash oynasisiz), qisqa "bosildi" signali; uzoq bosish, o'ng
 * tugma yoki ⓘ — batafsil. Klaviatura: Tab bilan tanlanadi, Enter/Probel — qo'shish.
 */
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
  const [pop, setPop] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  useEffect(
    () => () => {
      if (pressTimer.current) clearTimeout(pressTimer.current);
    },
    [],
  );

  const startPress = (event: PointerEvent) => {
    if (event.pointerType === "mouse") return;
    longPressed.current = false;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      onDetails(product);
    }, LONG_PRESS_MS);
  };
  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  const add = () => {
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    setPop(false);
    requestAnimationFrame(() => setPop(true));
    onAdd(product);
  };
  const state = stockState(product);

  return (
    <div
      className={`pos-motion group relative flex flex-col overflow-hidden rounded-(--radius) border bg-card text-card-foreground shadow-pos transition-[box-shadow,border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-pos-hover ${
        inCart > 0 ? "border-primary/70" : "border-border"
      }`}
    >
      <button
        type="button"
        className={`flex flex-1 flex-col text-left ${pop ? "pos-pop" : ""}`}
        title={`${product.name} — savatga +1`}
        onClick={add}
        onAnimationEnd={() => setPop(false)}
        onPointerDown={startPress}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onContextMenu={(event) => {
          event.preventDefault();
          onDetails(product);
        }}
      >
        <span className="relative block aspect-[3/2] w-full overflow-hidden bg-muted">
          <ProductImage product={product} className={`h-full w-full text-3xl ${state === "out" ? "opacity-60 grayscale" : ""}`} />
          <span className="absolute top-2 left-2 flex flex-col items-start gap-1">
            <PromoBadges product={product} discountPercent={discountPercent} />
          </span>
          {inCart > 0 && (
            <span className="absolute top-2 right-2 min-w-7 rounded-full bg-primary px-2 py-0.5 text-center text-sm font-bold tabular-nums text-primary-foreground shadow-pos">
              {fmtQty(String(inCart))}
            </span>
          )}
        </span>
        <span className="flex flex-1 flex-col gap-1 p-2.5 pr-10">
          <span className="line-clamp-2 text-sm font-semibold leading-snug">{product.name}</span>
          <Price product={product} base={base} />
          <span className="text-xs">
            <Stock product={product} />
          </span>
        </span>
      </button>
      <button
        type="button"
        className="absolute right-2 bottom-2 flex size-8 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground"
        aria-label={`${product.name} — batafsil`}
        onClick={() => onDetails(product)}
      >
        <Info className="size-4" />
      </button>
    </div>
  );
}

/** Kategoriya tablari: gorizontal aylantiriladi; ← → tugmalari bilan tanlash (klaviatura), katta bosish maydoni (sensorli ekran). */
export function CategoryChips({ categories, active, onPick }: { categories: PosCategory[]; active: string | null; onPick: (id: string | null) => void }) {
  if (categories.length === 0) return null;
  const items: { id: string | null; name: string; products?: number }[] = [{ id: null, name: "Hammasi" }, ...categories];
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next = (index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    onPick(items[next]!.id);
    (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label="Kategoriyalar"
      className="pos-scroll-x flex shrink-0 gap-(--pos-gap) overflow-x-auto pr-8 pb-1"
      // Sichqoncha g'ildiragi (vertikal) — tablarni gorizontal aylantiradi
      onWheel={(event) => {
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY;
      }}
    >
      {items.map((item, index) => {
        const selected = active === item.id;
        return (
          <button
            key={item.id ?? "all"}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onKeyDown={(event) => onKey(event, index)}
            onClick={() => onPick(item.id)}
            className={`pos-motion flex h-(--pos-tap-size) shrink-0 items-center gap-2 whitespace-nowrap rounded-(--radius) border px-4 text-sm font-semibold transition-colors ${
              selected ? "border-transparent bg-pos-category-active text-pos-category-active-foreground shadow-pos" : "border-border bg-pos-category text-pos-category-foreground hover:border-primary/60"
            }`}
          >
            {item.name}
            {item.products !== undefined && (
              <span className={`rounded-full px-1.5 text-xs tabular-nums ${selected ? "bg-pos-category-active-foreground/20" : "bg-background/70 text-muted-foreground"}`}>{item.products}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function DetailBody({ product, base, discountPercent, onAdd }: { product: PosProduct; base: string; discountPercent: number; onAdd: (product: PosProduct, quantity: string) => void }) {
  const [quantity, setQuantity] = useState("1");
  const valid = QTY.test(quantity) && num(quantity) > 0;
  const step = (delta: number) => {
    const next = Math.max(0, Math.round((num(quantity) + delta) * 10000) / 10000);
    setQuantity(next > 0 ? String(next) : "1");
  };
  return (
    <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_18rem]">
      <ProductImage product={product} fit="contain" className="aspect-square w-full rounded-(--radius) text-6xl" />
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1">
          <PromoBadges product={product} discountPercent={discountPercent} />
        </div>
        <Price product={product} base={base} large />
        {product.promo && <p className="text-sm font-medium text-pos-promotion">Aksiya narxi{product.promo.endsAt ? ` — ${product.promo.endsAt} gacha` : ""}</p>}
        {product.salesCurrency && product.salesCurrency !== base && (
          <p className="text-xs text-muted-foreground">Narx valyutada: {fmtMoney(product.salesPrice, product.salesCurrency)}</p>
        )}
        <dl className="space-y-1.5 text-sm">
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
          className="mt-auto space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) onAdd(product, quantity);
          }}
        >
          <div className="flex items-center overflow-hidden rounded-(--radius) border border-border bg-background">
            <button type="button" aria-label="Kamaytirish" className="flex h-12 w-12 items-center justify-center hover:bg-muted" onClick={() => step(-1)}>
              <Minus className="size-5" />
            </button>
            <Input
              id="detail-quantity"
              autoFocus
              inputMode="decimal"
              className="h-12 flex-1 rounded-none border-0 text-center text-xl font-bold shadow-none focus-visible:ring-0"
              value={quantity}
              onChange={(e) => setQuantity(decimalInput(e.target.value))}
            />
            <button type="button" aria-label="Ko'paytirish" className="flex h-12 w-12 items-center justify-center hover:bg-muted" onClick={() => step(1)}>
              <Plus className="size-5" />
            </button>
          </div>
          <Button type="submit" className="h-12 w-full bg-pos-action text-base font-bold text-pos-action-foreground hover:bg-pos-action-hover" disabled={!valid || product.price === null}>
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
              <DialogTitle className="text-xl">{product.name}</DialogTitle>
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
