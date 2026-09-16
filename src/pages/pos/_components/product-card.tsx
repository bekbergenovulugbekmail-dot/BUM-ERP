/**
 * Web kassa mahsulot kartasi — desktop kassadagi (`apps/desktop/src/renderer/pos/product-grid.tsx`) bilan bir xil
 * konsepsiya:
 *   - rasm yoki nomni bosish → savatga +1 (tasdiqlash oynasisiz), qayta bosish → miqdor +1 (qoldiqdan oshmaydi);
 *   - sensorli ekranda uzoq bosish, sichqonchada o'ng tugma yoki ⓘ → batafsil oyna: katta rasm va miqdor steppery.
 * Rasm mavjud `ProductImage` (`/api/files/url`) orqali yuklanadi; rasmi yo'q mahsulotda nom bosh harflari ko'rinadi.
 */
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Info, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { cn } from "@/lib/utils.ts";
import { ProductImage } from "@/pages/products/_lib/product-image.tsx";
import type { ProductOption } from "@/pages/sales/_lib/types.ts";
import { productInitials, stockState } from "../_lib/product-display.ts";

/** Sensorli ekranda uzoq bosish — batafsil oyna (oddiy bosish darhol savatga). */
const LONG_PRESS_MS = 550;
const QTY_RE = /^\d{1,9}(\.\d{1,4})?$/;

const fmt = (value: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(value));
const trimQty = (value: number) => String(Math.round(value * 10000) / 10000);

const STOCK_TONE = {
  out: "text-destructive",
  low: "text-amber-600 dark:text-amber-400",
  ok: "text-emerald-600 dark:text-emerald-400",
} as const;

export type PosCardItem = {
  product: ProductOption;
  /** Asosiy valyutadagi joriy narx (aksiya bo'lsa — aksiya narxi). */
  price: number;
  /** Aksiyadagi eski narx (chizilgan holda ko'rsatiladi); aksiya yo'q — null. */
  regularPrice: number | null;
  stock: number;
  /** Qoldiq ma'lumoti mavjudmi (ombor tanlanmagan bo'lsa — ko'rsatilmaydi). */
  showStock: boolean;
  /** Savatdagi joriy miqdor — kartada belgi bo'lib turadi. */
  inCart: number;
  /** Valyutadagi narx izohi ("12 000 USD") — narx boshqa valyutada bo'lsa. */
  currencyNote?: string | null;
};

function StockLine({ item }: { item: PosCardItem }) {
  if (!item.showStock) return null;
  const state = stockState(item.stock, Number(item.product.minStock ?? 0));
  const label = state === "out" ? (item.stock < 0 ? "Minus" : "Tugagan") : state === "low" ? "Kam" : "Bor";
  const unit = item.product.baseUnitName ?? "";
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium tabular-nums", STOCK_TONE[state])}>
      <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
      {label} · {trimQty(item.stock)} {unit}
    </span>
  );
}

function Price({ item, large = false }: { item: PosCardItem; large?: boolean }) {
  const unit = item.product.baseUnitName;
  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5">
      <span className={cn("font-bold tabular-nums text-primary", large ? "text-3xl" : "text-sm")}>{fmt(item.price)}</span>
      <span className={cn("text-muted-foreground", large ? "text-base" : "text-[11px]")}>so'm{unit ? ` / ${unit}` : ""}</span>
      {item.regularPrice !== null && item.regularPrice !== item.price && (
        <s className={cn("w-full text-muted-foreground tabular-nums", large ? "text-base" : "text-[10px]")}>{fmt(item.regularPrice)}</s>
      )}
    </span>
  );
}

/**
 * Mahsulot kartasi: rasm katta maydonda, ustida aksiya va savat belgisi; pastda nom, narx va qoldiq.
 * Bosish — savatga; ⓘ, o'ng tugma yoki uzoq bosish — batafsil.
 */
export function ProductCard({
  item,
  onAdd,
  onDetails,
}: {
  item: PosCardItem;
  onAdd: (product: ProductOption) => void;
  onDetails: (product: ProductOption) => void;
}) {
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
      onDetails(item.product);
    }, LONG_PRESS_MS);
  };
  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  const add = () => {
    // Uzoq bosishdan keyingi "click" savatga qo'shmasin
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    onAdd(item.product);
  };

  const soldOut = item.showStock && item.stock <= 0;

  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden rounded-xl border bg-card transition-all",
        item.inCart > 0 ? "border-primary/50 shadow-sm" : "border-border hover:border-primary/30",
      )}
    >
      <button
        type="button"
        className="flex flex-1 flex-col text-left disabled:cursor-not-allowed disabled:opacity-40"
        title={`${item.product.name} — savatga +1`}
        aria-label={`${item.product.name} — savatga qo'shish`}
        disabled={soldOut}
        onClick={add}
        onPointerDown={startPress}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onContextMenu={(event) => {
          event.preventDefault();
          onDetails(item.product);
        }}
      >
        <span className="relative block aspect-[3/2] w-full overflow-hidden bg-muted">
          <ProductImage
            productId={item.product.id}
            imageKey={item.product.imageKey ?? null}
            alt=""
            className={cn("h-full w-full", soldOut && "opacity-60 grayscale")}
            fallback={
              <span className="flex h-full w-full items-center justify-center bg-muted text-xl font-semibold text-muted-foreground" aria-hidden>
                {productInitials(item.product.name)}
              </span>
            }
          />
          {item.regularPrice !== null && (
            <span className="absolute top-2 left-2 rounded-md bg-destructive px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-destructive-foreground uppercase">
              Aksiya
            </span>
          )}
          {item.inCart > 0 && (
            <span className="absolute top-2 right-2 min-w-6 rounded-full bg-primary px-1.5 py-0.5 text-center text-xs font-bold tabular-nums text-primary-foreground">
              {trimQty(item.inCart)}
            </span>
          )}
        </span>
        <span className="flex flex-1 flex-col gap-0.5 p-2.5 pr-9">
          <span className="line-clamp-2 text-xs font-medium leading-tight">{item.product.name}</span>
          <span className="font-mono text-[10px] text-muted-foreground">{item.product.sku}</span>
          <Price item={item} />
          {item.currencyNote && <span className="text-[10px] text-muted-foreground">{item.currencyNote}</span>}
          <StockLine item={item} />
        </span>
      </button>
      <button
        type="button"
        className="absolute right-2 bottom-2 flex size-7 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground"
        aria-label={`${item.product.name} — batafsil`}
        onClick={() => onDetails(item.product)}
      >
        <Info className="size-3.5" />
      </button>
    </div>
  );
}

/** Oyna tanasi: miqdor holati mahsulotga bog'liq — `key` bilan qayta yaratiladi, shuning uchun effekt kerak emas. */
function DetailBody({ item, onAdd }: { item: PosCardItem; onAdd: (product: ProductOption, quantity: number) => void }) {
  const [quantity, setQuantity] = useState("1");
  const normalized = quantity.replace(",", ".");
  const value = Number(normalized);
  const valid = QTY_RE.test(normalized) && value > 0;
  const soldOut = item.showStock && item.stock <= 0;
  const step = (delta: number) => {
    const next = Math.max(0, Math.round((value + delta) * 10000) / 10000);
    setQuantity(next > 0 ? String(next) : "1");
  };

  return (
    <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_16rem]">
      <ProductImage
        productId={item.product.id}
        imageKey={item.product.imageKey ?? null}
        alt={item.product.name}
        className="aspect-square w-full rounded-xl object-contain"
        fallback={
          <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-muted text-5xl font-semibold text-muted-foreground" aria-hidden>
            {productInitials(item.product.name)}
          </div>
        }
      />
      <div className="flex flex-col gap-3">
        {item.regularPrice !== null && (
          <span className="w-fit rounded-md bg-destructive px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-destructive-foreground uppercase">
            Aksiya
          </span>
        )}
        <Price item={item} large />
        {item.currencyNote && <p className="text-xs text-muted-foreground">{item.currencyNote}</p>}
        <StockLine item={item} />
        <form
          className="mt-auto space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !soldOut) onAdd(item.product, value);
          }}
        >
          <div className="flex items-center overflow-hidden rounded-xl border border-border bg-background">
            <button type="button" aria-label="Kamaytirish" className="flex h-11 w-11 items-center justify-center hover:bg-muted" onClick={() => step(-1)}>
              <Minus className="size-4" />
            </button>
            <Input
              id="pos-detail-quantity"
              inputMode="decimal"
              className="h-11 flex-1 rounded-none border-0 text-center text-lg font-bold shadow-none focus-visible:ring-0"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
            <button type="button" aria-label="Ko'paytirish" className="flex h-11 w-11 items-center justify-center hover:bg-muted" onClick={() => step(1)}>
              <Plus className="size-4" />
            </button>
          </div>
          <Button type="submit" className="h-11 w-full text-base font-bold" disabled={!valid || soldOut}>
            {soldOut ? "Omborda yo'q" : "Savatga"}
          </Button>
        </form>
      </div>
    </div>
  );
}

/** Batafsil oyna: katta rasm, narx, qoldiq va miqdor steppery ("Savatga" bilan). */
export function ProductDetailDialog({
  item,
  onClose,
  onAdd,
}: {
  item: PosCardItem | null;
  onClose: () => void;
  onAdd: (product: ProductOption, quantity: number) => void;
}) {
  if (!item) return null;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{item.product.name}</DialogTitle>
          <DialogDescription>
            SKU {item.product.sku}
            {item.product.barcode ? ` · shtrix-kod ${item.product.barcode}` : ""}
          </DialogDescription>
        </DialogHeader>
        <DetailBody key={item.product.id} item={item} onAdd={onAdd} />
      </DialogContent>
    </Dialog>
  );
}
