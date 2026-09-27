/**
 * Ta'minotchi qarzi yoshi (`GET /api/purchase/suppliers-aging`) — kreditorlar subhisobidan FIFO, server tayyor beradi.
 * Muddat = qabul sanasi + ta'minotchining to'lov muddati. Ortiqcha to'lov — avans. Jami (netto) = 2000 hisob qoldig'i.
 */
import { useState } from "react";
import { Truck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { errorMessage } from "@/lib/api.ts";
import { useApiQuery } from "@/lib/query.ts";
import { num, todayLocal } from "../_lib/types.ts";
import SupplierStatementDialog from "./supplier-statement-dialog.tsx";

type Bucket = "current" | "d0_7" | "d8_30" | "d31_60" | "d61_90" | "d90_plus";
type Amounts = Record<Bucket, string> & { total: string; advance: string; net: string };
type Row = Amounts & { id: string; name: string; code: string | null; paymentTermDays: number; oldestOpenDate: string | null };
type Aging = { asOf: string; totals: Amounts; suppliers: Row[] };

const BUCKETS: { key: Bucket; label: string }[] = [
  { key: "current", label: "Muddati kelmagan" },
  { key: "d0_7", label: "1–7 kun" },
  { key: "d8_30", label: "8–30 kun" },
  { key: "d31_60", label: "31–60 kun" },
  { key: "d61_90", label: "61–90 kun" },
  { key: "d90_plus", label: "90+ kun" },
];

const fmt = (value: string) => new Intl.NumberFormat("uz-UZ").format(Math.round(num(value)));
const cell = (value: string) => (num(value) !== 0 ? fmt(value) : "—");

export default function SupplierAging() {
  const [asOf, setAsOf] = useState(todayLocal());
  const [statementFor, setStatementFor] = useState<string | null>(null);
  const query = useApiQuery<Aging>("/api/purchase/suppliers-aging", { asOf: asOf || undefined });
  const data = query.data;

  return (
    <div className="flex h-full flex-col gap-4" data-testid="supplier-aging">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="supplier-aging-asof">Sanaga</Label>
          <Input id="supplier-aging-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="h-9 w-44" />
        </div>
        {data && (
          <p className="text-sm text-muted-foreground">
            Qarz <span className="font-semibold text-foreground">{fmt(data.totals.total)}</span> · avans {fmt(data.totals.advance)} · netto{" "}
            <span className="font-semibold text-foreground" data-testid="supplier-aging-net">{fmt(data.totals.net)}</span> so'm
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {BUCKETS.map((item) => (
          <Card key={item.key}>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              {data ? <p className="text-lg font-semibold tabular-nums">{fmt(data.totals[item.key])}</p> : <Skeleton className="mt-1 h-6 w-20" />}
            </CardContent>
          </Card>
        ))}
      </div>

      {query.error ? (
        <p className="text-sm text-destructive">{errorMessage(query.error)}</p>
      ) : !data ? (
        <Skeleton className="h-48 w-full" />
      ) : data.suppliers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Truck className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Ta'minotchilar oldida ochiq qarz yo'q</p>
          </CardContent>
        </Card>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/60 backdrop-blur">
              <tr className="text-left">
                <th className="px-3 py-2.5 font-medium text-muted-foreground">Ta'minotchi</th>
                {BUCKETS.map((item) => (
                  <th key={item.key} className="px-3 py-2.5 text-right font-medium text-muted-foreground">{item.label}</th>
                ))}
                <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Avans</th>
                <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Netto</th>
              </tr>
            </thead>
            <tbody>
              {data.suppliers.map((row) => (
                <tr key={row.id} className="border-t" data-testid={`supplier-aging-row-${row.id}`}>
                  <td className="px-3 py-2.5">
                    <button type="button" className="text-left font-medium hover:underline" title="Hisob-kitob akti" onClick={() => setStatementFor(row.id)}>
                      {row.name}
                    </button>
                    <p className="text-xs text-muted-foreground">
                      {row.code ?? ""}{row.paymentTermDays > 0 ? ` · muddat ${row.paymentTermDays} kun` : ""}
                    </p>
                  </td>
                  {BUCKETS.map((item) => (
                    <td key={item.key} className="px-3 py-2.5 text-right tabular-nums">{cell(row[item.key])}</td>
                  ))}
                  <td className="px-3 py-2.5 text-right tabular-nums">{cell(row.advance)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{fmt(row.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {statementFor && <SupplierStatementDialog supplierId={statementFor} onClose={() => setStatementFor(null)} />}
    </div>
  );
}
