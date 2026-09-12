import type { CSSProperties } from "react";
import { concreteTheme, customThemeTokens, isDarkTheme, type PosCustomTheme, type PosThemeChoice } from "../../shared/themes.js";

const PRODUCTS = [
  { name: "Olma", price: "18 000", unit: "kg", stock: "125 kg", promo: true },
  { name: "Non", price: "4 000", unit: "dona", stock: "48 dona", promo: false },
  { name: "Sut 1 l", price: "12 500", unit: "dona", stock: "Tugagan", promo: false, out: true },
  { name: "Choy", price: "32 000", unit: "dona", stock: "20 dona", promo: false },
];

/**
 * Kassa ekranining kichraytirilgan ko'rinishi: yon panel, yuqori panel (holatlar), kategoriya, mahsulot kartalari, savat,
 * jami, to'lov progressi va to'lov tugmasi. `data-theme` faqat shu blok ichida — ilova mavzusi, savat va sotuvga tegmaydi.
 */
export function PosThemePreview({
  theme,
  custom = null,
  prefersDark = false,
  mini = false,
}: {
  theme: PosThemeChoice;
  custom?: PosCustomTheme | null;
  prefersDark?: boolean;
  mini?: boolean;
}) {
  const concrete = concreteTheme(theme, prefersDark, custom);
  const active = concrete === "custom" ? custom : null;
  const style = { ...(active ? (customThemeTokens(active) as CSSProperties) : {}), background: "var(--pos-backdrop)" } as CSSProperties;
  const products = mini ? PRODUCTS.slice(0, 2) : PRODUCTS;
  return (
    <div
      data-theme={concrete}
      data-testid="pos-theme-preview"
      style={style}
      className={`${isDarkTheme(concrete, active) ? "dark" : ""} flex h-full w-full select-none overflow-hidden text-foreground ${mini ? "text-[6px]" : "text-[11px]"}`}
      aria-hidden
    >
      <div className={`pos-glass flex flex-col items-center bg-sidebar ${mini ? "w-3 gap-1 py-1" : "w-9 gap-2 py-2"}`}>
        {[0, 1, 2, 3, 4].slice(0, mini ? 3 : 5).map((index) => (
          <span key={index} className={`rounded-sm ${index === 0 ? "bg-sidebar-primary" : "bg-sidebar-foreground/30"} ${mini ? "h-1.5 w-1.5" : "h-5 w-5"}`} />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className={`pos-glass flex items-center justify-between border-b border-border bg-pos-topbar text-pos-topbar-foreground ${mini ? "px-1 py-0.5" : "px-2.5 py-1.5"}`}>
          <span className="font-bold">BUM POS</span>
          {!mini && (
            <span className="flex items-center gap-1.5">
              <span className="rounded-full bg-pos-success/15 px-1.5 font-medium text-pos-success">● Online</span>
              <span className="rounded-full bg-pos-info/15 px-1.5 font-medium text-pos-info">🖨 Tayyor</span>
              <span className="text-muted-foreground">12:30</span>
            </span>
          )}
        </div>
        <div className={`flex min-h-0 flex-1 ${mini ? "gap-0.5 p-0.5" : "gap-2 p-2"}`}>
          <div className={`flex min-w-0 flex-1 flex-col ${mini ? "gap-0.5" : "gap-1.5"}`}>
            {!mini && (
              <div className="flex gap-1">
                {["Hammasi", "Meva", "Non", "Sut"].map((label, index) => (
                  <span
                    key={label}
                    className={`rounded-md px-2 py-0.5 font-semibold ${index === 0 ? "bg-pos-category-active text-pos-category-active-foreground" : "bg-pos-category text-pos-category-foreground"}`}
                  >
                    {label}
                  </span>
                ))}
              </div>
            )}
            <div className={`grid ${mini ? "grid-cols-2 gap-0.5" : "grid-cols-2 gap-1.5"}`}>
              {products.map((product) => (
                <div key={product.name} className="overflow-hidden rounded-(--radius) border border-border bg-card text-card-foreground shadow-pos">
                  <div className={`relative bg-accent ${mini ? "h-3" : "h-9"}`}>
                    {product.promo && !mini && (
                      <span className="absolute top-1 left-1 rounded bg-pos-promotion px-1 text-[8px] font-bold text-pos-promotion-foreground">AKSIYA</span>
                    )}
                  </div>
                  <div className={mini ? "px-0.5 py-px" : "px-1.5 py-1"}>
                    <span className="block truncate font-semibold">{product.name}</span>
                    <span className="block font-bold text-pos-price">
                      {product.price} {!mini && <span className="font-normal text-muted-foreground">/ {product.unit}</span>}
                    </span>
                    {!mini && <span className={`block ${product.out ? "text-pos-stock-out" : "text-pos-stock-ok"}`}>● {product.stock}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className={`pos-glass flex flex-col rounded-(--radius) border border-border bg-pos-cart text-card-foreground shadow-pos ${mini ? "w-[38%] gap-0.5 p-0.5" : "w-[40%] gap-1 p-1.5"}`}>
            {(mini ? ["Olma × 2"] : ["Olma × 2", "Non × 1", "Choy × 1"]).map((line) => (
              <span key={line} className="flex items-center justify-between">
                <span className="truncate">{line}</span>
                {!mini && <span className="rounded bg-secondary px-1 text-secondary-foreground">− 1 +</span>}
              </span>
            ))}
            <div className={`mt-auto rounded-(--radius) bg-pos-total text-pos-total-foreground ${mini ? "px-0.5" : "px-1.5 py-1"}`}>
              {!mini && <span className="block opacity-80">JAMI</span>}
              <b className={`block ${mini ? "" : "text-base"}`}>72 000</b>
            </div>
            {!mini && (
              <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
                <span className="w-[40%] bg-pos-success" />
                <span className="w-[35%] bg-pos-info" />
                <span className="w-[25%] bg-primary" />
              </div>
            )}
            <span className={`rounded-(--radius) bg-pos-action text-center font-bold text-pos-action-foreground ${mini ? "py-px" : "py-1.5"}`}>
              {mini ? "YAKUNLASH" : "SAVDONI YAKUNLASH"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
