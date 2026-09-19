/**
 * NARXLARNI TAKLIF QILISH — xarid qatorida narxni tarixdan tanlash.
 *
 * Qoida: taklif hech qachon o'zi qo'llanmaydi. Har bir qiymat yonida "Olish" tugmasi bor;
 * foydalanuvchi bosmaguncha qatordagi narx o'zgarmaydi. Manba — serverdagi xarid va sotuv
 * tarixi (`GET /api/catalog/products/:id/price-suggestions`), ruxsat `products.view_cost`.
 */
import { Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { errorMessage } from "@/lib/api.ts";
import { useApiQuery } from "@/lib/query.ts";
import { formatMoney } from "@/hooks/use-currencies.ts";

export type PriceSuggestionData = {
  productId: string;
  unitId: string;
  unitName: string;
  lastPurchase: { price: string; date: string; supplierName: string | null } | null;
  avgPurchasePrice: string | null;
  lastSalesPrice: string | null;
  currentPurchasePrice: string;
  currentSalesPrice: string;
};

type Props = {
  productId: string;
  unitId: string;
  /** Qator valyutasi — takliflar asosiy valyutadan shu valyutaga keltiriladi. */
  currency: string;
  /** 1 birlik qator valyutasi necha asosiy valyuta (0 yoki NaN — kurs yo'q). */
  rate: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Foydalanuvchi tanlagan xarid narxi. */
  onPickPurchase: (value: number) => void;
  /** Foydalanuvchi tanlagan sotuv narxi (qabulda yoziladigan yangi narx). */
  onPickSales: (value: number) => void;
};

export default function PriceSuggestions(props: Props) {
  const { productId, unitId, currency, rate, open, onOpenChange } = props;

  const query = useApiQuery<PriceSuggestionData>(
    open && productId ? `/api/catalog/products/${productId}/price-suggestions` : null,
    unitId ? { unitId } : undefined,
    { staleTime: 60_000 },
  );

  /** Asosiy valyutadagi taklif → qator valyutasi; kurs yo'q bo'lsa taklif ko'rsatilmaydi. */
  const inLineCurrency = (value: string | null | undefined): number | null => {
    if (value === null || value === undefined) return null;
    const amount = Number(value);
    if (!Number.isFinite(amount) || !Number.isFinite(rate) || rate <= 0) return null;
    return Math.round((amount / rate) * 100) / 100;
  };

  const data = query.data;
  const rows: { key: string; label: string; hint?: string; value: number | null; apply: (value: number) => void }[] = [
    {
      key: "last-purchase",
      label: "Oxirgi xarid narxi",
      hint: data?.lastPurchase ? [data.lastPurchase.date, data.lastPurchase.supplierName].filter(Boolean).join(" · ") : undefined,
      value: inLineCurrency(data?.lastPurchase?.price),
      apply: props.onPickPurchase,
    },
    {
      key: "avg-purchase",
      label: "O'rtacha xarid narxi",
      hint: "oxirgi 20 xarid bo'yicha",
      value: inLineCurrency(data?.avgPurchasePrice),
      apply: props.onPickPurchase,
    },
    {
      key: "current-purchase",
      label: "Kartochkadagi kirim narxi",
      value: inLineCurrency(data?.currentPurchasePrice),
      apply: props.onPickPurchase,
    },
    {
      key: "last-sales",
      label: "Oldingi sotuv narxi",
      hint: "sotuv narxi maydoniga qo'yiladi",
      value: inLineCurrency(data?.lastSalesPrice),
      apply: props.onPickSales,
    },
    {
      key: "current-sales",
      label: "Kartochkadagi sotuv narxi",
      hint: "sotuv narxi maydoniga qo'yiladi",
      value: inLineCurrency(data?.currentSalesPrice),
      apply: props.onPickSales,
    },
  ];

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          title="Narxlarni taklif qilish"
          aria-label="Narxlarni taklif qilish"
          disabled={!productId}
          data-testid="price-suggest-trigger"
        >
          <Lightbulb className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" data-testid="price-suggestions">
        <div className="border-b border-border px-3 py-2">
          <p className="text-xs font-semibold">Narxlarni taklif qilish</p>
          <p className="text-[11px] text-muted-foreground">
            Narx o'z-o'zidan o'zgarmaydi — kerakligini "Olish" bilan tanlaysiz
            {data?.unitName ? ` (${data.unitName} uchun)` : ""}
          </p>
        </div>

        {query.isLoading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-6 rounded-md" />
            <Skeleton className="h-6 rounded-md" />
            <Skeleton className="h-6 rounded-md" />
          </div>
        ) : query.error ? (
          <p className="px-3 py-3 text-xs text-destructive" role="alert">{errorMessage(query.error)}</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.key} className="flex items-center justify-between gap-2 px-3 py-2" data-testid={`suggestion-${row.key}`}>
                <div className="min-w-0">
                  <p className="truncate text-xs">{row.label}</p>
                  {row.hint && <p className="truncate text-[11px] text-muted-foreground">{row.hint}</p>}
                </div>
                {row.value === null ? (
                  <span className="shrink-0 text-xs text-muted-foreground">ma'lumot yo'q</span>
                ) : (
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-xs font-medium tabular-nums">{formatMoney(row.value, currency)}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => {
                        row.apply(row.value!);
                        onOpenChange(false);
                      }}
                    >
                      Olish
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
