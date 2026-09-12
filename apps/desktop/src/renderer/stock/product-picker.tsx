import { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input.tsx";
import { useHIDScanner } from "@/hooks/use-hid-scanner.ts";
import type { PosProduct } from "../../shared/kassa-api.js";
import { fmtQty } from "../format.ts";
import { call, errorText } from "../kassa.ts";

/**
 * Ombor bo'limlari uchun mahsulot tanlash: qidiruv (nomi, SKU, shtrix-kod), Enter — aniq kod, USB/Bluetooth skaner.
 * Bir ekranda bittadan ko'p bo'lmasin (skaner hammasiga yetadi).
 */
export default function ProductPicker({
  onPick,
  placeholder = "Mahsulot, SKU yoki shtrix-kod",
  refreshKey,
  className = "",
  source = "stock",
}: {
  onPick: (product: PosProduct) => void;
  placeholder?: string;
  /** O'zgarsa ro'yxat qayta yuklanadi (qoldiq yangilanishi uchun). */
  refreshKey?: unknown;
  className?: string;
  /** stock — ombor ruxsati bilan, xomashyo ham; pos — sotiladigan mahsulotlar (har bir kassir). */
  source?: "stock" | "pos";
}) {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<PosProduct[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(
      () => {
        (source === "pos" ? call("pos:products", { query }) : call("stock:products", { query })).then(
          (rows) => {
            setProducts(rows);
            setError(null);
          },
          (err: unknown) => setError(errorText(err)),
        );
      },
      query ? 150 : 0,
    );
    return () => clearTimeout(timer);
  }, [query, refreshKey, source]);

  const pickByCode = async (code: string) => {
    try {
      const product = source === "pos" ? await call("pos:product-by-code", { code }) : await call("stock:product-by-code", { code });
      if (product) {
        handlers.current.onPick(product);
        return true;
      }
      setError(`"${code}" — mahsulot topilmadi`);
    } catch (err) {
      setError(errorText(err));
    }
    return false;
  };

  const handlers = useRef({ onPick, pickByCode });
  useEffect(() => {
    handlers.current = { onPick, pickByCode };
  });
  const onScan = useCallback((code: string) => void handlers.current.pickByCode(code), []);
  useHIDScanner({ onScan, minLength: 3 });

  return (
    <div className={`flex min-h-0 flex-col gap-2 ${className}`}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const code = query.trim();
          if (!code) return;
          void pickByCode(code).then((found) => {
            if (found) setQuery("");
            else if (products.length === 1) {
              onPick(products[0]!);
              setQuery("");
              setError(null);
            }
          });
        }}
      >
        <Input id="stock-product-search" autoFocus className="h-10" placeholder={placeholder} value={query} onChange={(e) => setQuery(e.target.value)} />
      </form>
      {error && <p className="rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive">{error}</p>}
      <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto rounded-xl border border-border bg-card">
        {products.map((product) => (
          <li key={product.id}>
            <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-primary/5" onClick={() => onPick(product)}>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{product.name}</span>
                <span className="text-xs text-muted-foreground">{product.sku}</span>
              </span>
              <span className={`text-right text-xs tabular-nums ${product.stock.startsWith("-") ? "text-destructive" : "text-muted-foreground"}`}>
                {fmtQty(product.stock)} {product.unitName}
              </span>
            </button>
          </li>
        ))}
        {products.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted-foreground">Mahsulot topilmadi</li>}
      </ul>
    </div>
  );
}
