import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

const TYPE_LABELS: Record<string, string> = {
  asset: "Aktiv", liability: "Passiv", equity: "Kapital",
  income: "Daromad", expense: "Xarajat",
};
const TYPE_COLORS: Record<string, string> = {
  asset: "text-blue-600 dark:text-blue-400",
  liability: "text-rose-600 dark:text-rose-400",
  equity: "text-purple-600 dark:text-purple-400",
  income: "text-emerald-600 dark:text-emerald-400",
  expense: "text-orange-600 dark:text-orange-400",
};
const TYPE_BG: Record<string, string> = {
  asset: "bg-blue-500/10", liability: "bg-rose-500/10",
  equity: "bg-purple-500/10", income: "bg-emerald-500/10", expense: "bg-orange-500/10",
};

export default function AccountsSection() {
  const accounts = useQuery(api.finance.accounts.list, {});

  if (!accounts) {
    return <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}</div>;
  }

  const grouped: Record<string, typeof accounts> = {};
  for (const acct of accounts) {
    if (!grouped[acct.type]) grouped[acct.type] = [];
    grouped[acct.type].push(acct);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Hisoblar rejasi (Chart of Accounts)</h3>
        <span className="text-xs text-muted-foreground">{accounts.length} ta hisob</span>
      </div>

      {Object.entries(grouped).map(([type, accts]) => (
        <div key={type} className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className={cn("flex items-center gap-2 px-4 py-3 border-b border-border", TYPE_BG[type])}>
            <span className={cn("text-sm font-semibold", TYPE_COLORS[type])}>
              {TYPE_LABELS[type] ?? type}
            </span>
            <span className="text-xs text-muted-foreground">({accts.length} ta)</span>
            <span className={cn("ml-auto text-sm font-bold", TYPE_COLORS[type])}>
              {fmt(accts.reduce((s, a) => s + a.balance, 0))} so'm
            </span>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {accts.map((acct) => (
                <tr key={acct._id} className="hover:bg-muted/20">
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground w-20">{acct.code}</td>
                  <td className="px-4 py-2.5 font-medium">{acct.name}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground capitalize">{acct.subtype ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right font-semibold">
                    {fmt(acct.balance)} so'm
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
