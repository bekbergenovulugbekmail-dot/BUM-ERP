import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import Papa from "papaparse";
import { useApiQuery } from "@/lib/query.ts";
import { num, type StockSummary, type StockVelocityRow } from "../_lib/types.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

const VELOCITY_MAP = {
  fast: { label: "Tez sotiladi", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  slow: { label: "Sekin", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  dead: { label: "Harakatsiz", color: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400" },
};

const ABC_MAP = {
  A: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  B: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  C: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

export default function StockAnalysisSection({ days }: { days: number }) {
  const stockSummary = useApiQuery<StockSummary>("/api/analytics/reports/stock").data;
  const velocity = useApiQuery<{ products: StockVelocityRow[] }>("/api/analytics/reports/stock-velocity", { days }).data?.products;

  const handleExport = () => {
    if (!velocity) return;
    const data = velocity.map((v) => ({
      "Mahsulot": v.name,
      "SKU": v.sku ?? "",
      "Qoldiq": v.stock,
      "Sotilgan (period)": v.soldQty,
      "Kun qoldiq": v.daysOfStock ?? "∞",
      "Harakatlilik": v.velocity,
      "Qoldiq qiymati": v.value,
    }));
    const csv = Papa.unparse(data);
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ombor-tahlil-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      {!stockSummary ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Jami SKU", value: stockSummary.totalProducts, sub: "Noyob mahsulotlar" },
            { label: "Ombor qiymati", value: fmt(num(stockSummary.totalValue)) + " so'm", sub: "Joriy baholash" },
            { label: "Kam qoldiq", value: stockSummary.lowStock, sub: "Min miqdordan kam", danger: stockSummary.lowStock > 0 },
            { label: "Tugagan", value: stockSummary.outOfStock, sub: "Zaxira yo'q", danger: stockSummary.outOfStock > 0 },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-2xl p-4">
              <p className={cn("text-xl font-bold", s.danger ? "text-rose-500" : "")}>{s.value}</p>
              <p className="text-sm font-medium">{s.label}</p>
              <p className="text-xs text-muted-foreground">{s.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* ABC + Velocity table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div>
            <p className="text-sm font-semibold">Mahsulot harakatliligi va ABC tahlil</p>
            <p className="text-xs text-muted-foreground">Oxirgi {days} kun savdo ma'lumotlari asosida</p>
          </div>
          <Button size="sm" variant="secondary" onClick={handleExport} disabled={!velocity}>
            <Download className="h-3.5 w-3.5 mr-1" /> CSV export
          </Button>
        </div>
        {!velocity ? (
          <div className="p-4 space-y-1">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-xl" />)}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/30 border-b border-border">
                  <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Mahsulot</th>
                  <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">SKU</th>
                  <th className="text-center px-3 py-2.5 text-xs text-muted-foreground font-medium">ABC</th>
                  <th className="text-right px-3 py-2.5 text-xs text-muted-foreground font-medium">Qoldiq</th>
                  <th className="text-right px-3 py-2.5 text-xs text-muted-foreground font-medium">Sotilgan</th>
                  <th className="text-right px-3 py-2.5 text-xs text-muted-foreground font-medium">Kun qoldiq</th>
                  <th className="text-right px-3 py-2.5 text-xs text-muted-foreground font-medium">Qiymati</th>
                  <th className="text-center px-3 py-2.5 text-xs text-muted-foreground font-medium">Holat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {velocity.slice(0, 50).map((item) => {
                  // ABC faqat qiymati bo'yicha eng yirik 50 ta mahsulot uchun keladi
                  const abc = stockSummary?.abcData.find((a) => a.productId === item.productId)?.abc;
                  const vel = VELOCITY_MAP[item.velocity];
                  const daysLeft = item.daysOfStock;
                  return (
                    <tr key={item.productId} className="hover:bg-muted/20">
                      <td className="px-4 py-2.5 font-medium max-w-[200px] truncate">{item.name}</td>
                      <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs">{item.sku}</td>
                      <td className="px-3 py-2.5 text-center">
                        {abc && (
                          <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full", ABC_MAP[abc])}>{abc}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">{num(item.stock).toFixed(1)}</td>
                      <td className="px-3 py-2.5 text-right font-medium">{num(item.soldQty).toFixed(1)}</td>
                      <td className={cn("px-3 py-2.5 text-right", daysLeft !== null && daysLeft < 7 ? "text-rose-500 font-semibold" : daysLeft !== null && daysLeft < 30 ? "text-amber-600" : "")}>
                        {daysLeft === null ? "∞" : daysLeft + "d"}
                      </td>
                      <td className="px-3 py-2.5 text-right">{fmt(num(item.value))}</td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={cn("text-xs px-2 py-0.5 rounded-full", vel.color)}>{vel.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
