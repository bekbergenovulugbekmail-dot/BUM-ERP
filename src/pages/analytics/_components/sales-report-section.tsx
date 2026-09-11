import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import Papa from "papaparse";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { useApiQuery } from "@/lib/query.ts";
import { num, type PurchaseSummary, type SalesSummary, type TopCustomer } from "../_lib/types.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

function downloadCsv(data: Record<string, unknown>[], filename: string) {
  const csv = Papa.unparse(data);
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function SalesReportSection({ days }: { days: number }) {
  const sales = useApiQuery<SalesSummary>("/api/analytics/reports/sales", { days }).data;
  const topCustomers = useApiQuery<{ customers: TopCustomer[] }>("/api/analytics/reports/top-customers", { days, limit: 20 }).data?.customers;
  const purchase = useApiQuery<PurchaseSummary>("/api/analytics/reports/purchases", { days }).data;

  const topProducts = (sales?.topProducts ?? []).map((p) => ({ name: p.name, qty: num(p.quantity) }));

  return (
    <div className="space-y-4">
      {/* Sales KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {!sales ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)
        ) : [
          { label: "Jami buyurtmalar", value: sales.totalOrders },
          { label: "Jami daromad", value: fmt(num(sales.totalRevenue)) + " so'm" },
          { label: "To'langan", value: fmt(num(sales.paidRevenue)) + " so'm" },
          { label: "Qarzdorlik", value: fmt(num(sales.totalRevenue) - num(sales.paidRevenue)) + " so'm" },
        ].map((s) => (
          <div key={s.label} className="bg-card border border-border rounded-2xl p-4">
            <p className="text-xl font-bold">{s.value}</p>
            <p className="text-sm font-medium">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Top products bar chart + purchase stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold">Top mahsulotlar (sotilgan miqdor)</p>
          </div>
          {!sales ? <Skeleton className="h-52 rounded-xl" /> : (
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={topProducts} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                <Tooltip formatter={(v) => [String(v), "Sotildi"]} />
                <Bar dataKey="qty" fill="#6366f1" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-card border border-border rounded-2xl p-5">
          <p className="text-sm font-semibold mb-3">Xarid va savdo balansi</p>
          {!purchase || !sales ? <Skeleton className="h-52 rounded-xl" /> : (
            <div className="space-y-3">
              {[
                { label: "Sotuvdan daromad", value: num(sales.totalRevenue), color: "bg-emerald-500" },
                { label: "Xarid summasi", value: num(purchase.totalAmount), color: "bg-indigo-500" },
                { label: "Xarid to'langan", value: num(purchase.paidAmount), color: "bg-blue-400" },
                { label: "Xarid qarzdorligi", value: num(purchase.debtAmount), color: "bg-rose-500" },
              ].map((item) => {
                const max = Math.max(num(sales.totalRevenue), num(purchase.totalAmount), 1);
                return (
                  <div key={item.label} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{item.label}</span>
                      <span className="font-medium">{fmt(item.value)} so'm</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full">
                      <div className={`h-full ${item.color} rounded-full`} style={{ width: `${Math.min(100, Math.max(0, (item.value / max) * 100))}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Top customers table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <p className="text-sm font-semibold">Mijozlar hisoboti</p>
          <Button size="sm" variant="secondary" disabled={!topCustomers}
            onClick={() => topCustomers && downloadCsv(
              topCustomers.map((c) => ({ "Mijoz": c.name, "Buyurtmalar": c.orders, "Jami summa": c.amount })),
              `mijozlar-${new Date().toISOString().slice(0, 10)}.csv`
            )}>
            <Download className="h-3.5 w-3.5 mr-1" /> CSV
          </Button>
        </div>
        {!topCustomers ? (
          <div className="p-4 space-y-1">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-xl" />)}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">#</th>
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Mijoz</th>
                <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Buyurtmalar</th>
                <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Jami summa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {topCustomers.map((c, i) => (
                <tr key={c.customerId} className="hover:bg-muted/20">
                  <td className="px-4 py-2.5 text-muted-foreground">{i + 1}</td>
                  <td className="px-4 py-2.5 font-medium">{c.name}</td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground">{c.orders}</td>
                  <td className="px-4 py-2.5 text-right font-bold">{fmt(num(c.amount))} so'm</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
