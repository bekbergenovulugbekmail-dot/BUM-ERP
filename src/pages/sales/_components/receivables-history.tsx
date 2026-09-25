/**
 * Mijozlar qarzi TARIXDA: "istalgan sanaga" va "oyma-oy" (qaysi oygacha qarzdor bo'lgan).
 *
 * Manba — buxgalteriya jurnali, mijoz subhisobi (server: `/api/sales/receivables/as-of` va `/history`). Joriy
 * "qarz yoshi" esa ochiq hujjatlardan — ikkalasi bir mijoz uchun bugungi sanada bir xil summani ko'rsatadi.
 */
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import { money, monthLabel } from "../_lib/customer-statement.ts";

type AsOf = {
  date: string;
  customers: { customerId: string; name: string; code: string | null; phone: string | null; debt: string; wallet: string; lastOperation: string | null }[];
  totals: { debt: string; overpaid: string; wallet: string };
  ledger: { account1100: string; assigned: string; unassigned: string } | null;
};

type History = {
  months: string[];
  customers: { customerId: string; name: string; code: string | null; opening: string; months: { month: string; closing: string }[]; lastInDebt: string | null }[];
};

const today = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
const monthsAgo = (count: number) => {
  const now = new Date(Date.now() + 5 * 3600_000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - count, 1)).toISOString().slice(0, 10);
};

export default function ReceivablesHistory({ mode, onOpenCustomer }: { mode: "as_of" | "monthly"; onOpenCustomer: (id: string) => void }) {
  const [date, setDate] = useState(today);
  const [range, setRange] = useState({ from: monthsAgo(5), to: today() });
  const asOf = useApiQuery<AsOf>(mode === "as_of" ? "/api/sales/receivables/as-of" : null, { date });
  const history = useApiQuery<History>(mode === "monthly" ? "/api/sales/receivables/history" : null, range);

  if (mode === "as_of") {
    const data = asOf.data;
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="receivables-as-of">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">Sana holatiga</Label>
            <Input type="date" className="h-9 w-44" value={date} max={today()} data-testid="as-of-date"
              onChange={(event) => event.target.value && setDate(event.target.value)} />
          </div>
          {data && (
            <div className="flex flex-wrap gap-3 text-sm">
              <Card><CardContent className="p-2.5"><p className="text-xs text-muted-foreground">Mijozlar qarzi</p><p className="font-semibold tabular-nums text-destructive" data-testid="as-of-total">{money(data.totals.debt)}</p></CardContent></Card>
              <Card><CardContent className="p-2.5"><p className="text-xs text-muted-foreground">Ortiqcha to'lov</p><p className="font-semibold tabular-nums">{money(data.totals.overpaid)}</p></CardContent></Card>
              <Card><CardContent className="p-2.5"><p className="text-xs text-muted-foreground">Hamyonlarda</p><p className="font-semibold tabular-nums">{money(data.totals.wallet)}</p></CardContent></Card>
              {data.ledger && Number(data.ledger.unassigned) !== 0 && (
                <Card><CardContent className="p-2.5"><p className="text-xs text-muted-foreground">1100 da mijozsiz qatorlar</p><p className="font-semibold tabular-nums text-amber-600">{money(data.ledger.unassigned)}</p></CardContent></Card>
              )}
            </div>
          )}
        </div>
        {!data ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/60 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Mijoz</th>
                  <th className="px-3 py-2 text-right">{data.date} holatiga qarz</th>
                  <th className="px-3 py-2 text-right">Hamyon</th>
                  <th className="px-3 py-2 text-right">Oxirgi operatsiya</th>
                </tr>
              </thead>
              <tbody>
                {data.customers.map((row) => (
                  <tr key={row.customerId} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => onOpenCustomer(row.customerId)}>
                    <td className="px-3 py-2"><p className="font-medium">{row.name}</p><p className="text-xs text-muted-foreground">{row.code}</p></td>
                    <td className={cn("px-3 py-2 text-right font-semibold tabular-nums", Number(row.debt) > 0 && "text-destructive")}>{money(row.debt)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Number(row.wallet) ? money(row.wallet) : "—"}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{row.lastOperation ?? "—"}</td>
                  </tr>
                ))}
                {data.customers.length === 0 && <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">Bu sanada qarz yo'q</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  const data = history.data;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="receivables-monthly">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs">Dan (oy)</Label>
          <Input type="date" className="h-9 w-44" value={range.from} onChange={(event) => event.target.value && setRange({ ...range, from: event.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Gacha</Label>
          <Input type="date" className="h-9 w-44" value={range.to} onChange={(event) => event.target.value && setRange({ ...range, to: event.target.value })} />
        </div>
        <p className="text-xs text-muted-foreground">Har oy OXIRIDAGI qarz · ko'pi bilan 24 oy · mijozni bosing — akt ochiladi</p>
      </div>
      {history.error ? (
        <p className="text-sm text-destructive">{history.error.message}</p>
      ) : !data ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Mijoz</th>
                {data.months.map((month) => <th key={month} className="whitespace-nowrap px-3 py-2 text-right">{monthLabel(month)}</th>)}
                <th className="px-3 py-2 text-right">Oxirgi qarzdor oy</th>
              </tr>
            </thead>
            <tbody>
              {data.customers.map((row) => (
                <tr key={row.customerId} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => onOpenCustomer(row.customerId)}>
                  <td className="px-3 py-2"><p className="font-medium">{row.name}</p><p className="text-xs text-muted-foreground">{row.code}</p></td>
                  {row.months.map((month) => (
                    <td key={month.month} className={cn("px-3 py-2 text-right tabular-nums", Number(month.closing) > 0 ? "text-destructive" : "text-muted-foreground")}>
                      {Number(month.closing) ? money(month.closing) : "—"}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right">{row.lastInDebt ? monthLabel(row.lastInDebt) : "—"}</td>
                </tr>
              ))}
              {data.customers.length === 0 && <tr><td colSpan={data.months.length + 2} className="px-3 py-8 text-center text-muted-foreground">Bu davrda qarz bo'lmagan</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
