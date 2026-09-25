import { useState } from "react";
import { CircleDollarSign, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { cn } from "@/lib/utils.ts";
import { useApiQuery } from "@/lib/query.ts";
import { num } from "../_lib/types.ts";
import CustomerStatementDialog from "./customer-statement-dialog.tsx";
import ReceivablesHistory from "./receivables-history.tsx";

/**
 * Debitorlik yoshi — ochiq hujjatlarning to'lov muddatiga nisbatan taqsimoti.
 * Manba bitta: yakunlangan sotuvning to'lanmagan qoldig'i (mijoz keshi emas).
 */
type Bucket = "current" | "d0_7" | "d8_30" | "d31_60" | "d61_90" | "d90_plus";
type Totals = Record<Bucket, string> & { total: string };

type AgingCustomer = {
  customerId: string;
  customerName: string;
  customerCode: string;
  phone: string | null;
  totals: Totals;
  oldestDueDate: string | null;
  maxDaysOverdue: number;
};

type AgingItem = {
  orderId: string;
  number: string;
  customerId: string;
  customerName: string;
  orderDate: string;
  dueDate: string;
  daysOverdue: number;
  bucket: Bucket;
  totalAmount: string;
  paidAmount: string;
  remaining: string;
};

const BUCKETS: { key: Bucket; label: string; color: string }[] = [
  { key: "current", label: "Muddati kelmagan", color: "text-muted-foreground" },
  { key: "d0_7", label: "1–7 kun", color: "text-amber-500 dark:text-amber-300" },
  { key: "d8_30", label: "8–30 kun", color: "text-amber-600 dark:text-amber-400" },
  { key: "d31_60", label: "31–60 kun", color: "text-orange-600 dark:text-orange-400" },
  { key: "d61_90", label: "61–90 kun", color: "text-red-600 dark:text-red-400" },
  { key: "d90_plus", label: "90+ kun", color: "text-red-700 dark:text-red-300" },
];

const fmt = (value: string) => new Intl.NumberFormat("uz-UZ").format(Math.round(num(value)));

export default function ReceivablesAging() {
  /** Qarz yoshi (bugungi ochiq hujjatlar) | istalgan sanaga | oyma-oy tarix. */
  const [mode, setMode] = useState<"aging" | "as_of" | "monthly">("aging");
  const [statementFor, setStatementFor] = useState<string | null>(null);
  const [bucket, setBucket] = useState<"all" | Bucket>("all");
  const [view, setView] = useState<"customers" | "orders">("customers");

  const query = useApiQuery<{ asOf: string; totals: Totals; customers: AgingCustomer[]; items: AgingItem[] }>(
    mode === "aging" ? "/api/sales/receivables/aging" : null,
    { bucket: bucket === "all" ? undefined : bucket, limit: 1000 },
  );
  const data = query.data;

  const modes = (
    <div className="flex flex-wrap gap-1 rounded-lg bg-muted/50 p-1 text-sm" data-testid="receivables-modes">
      {([["aging", "Qarz yoshi"], ["as_of", "Istalgan sanaga"], ["monthly", "Oyma-oy"]] as const).map(([key, label]) => (
        <button key={key} type="button" data-testid={`receivables-mode-${key}`}
          className={cn("rounded-md px-3 py-1.5", mode === key ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}
          onClick={() => setMode(key)}>{label}</button>
      ))}
    </div>
  );
  const statement = statementFor && <CustomerStatementDialog customerId={statementFor} onClose={() => setStatementFor(null)} />;

  if (mode !== "aging") {
    return (
      <div className="flex h-full flex-col gap-4">
        {modes}
        <ReceivablesHistory mode={mode} onOpenCustomer={setStatementFor} />
        {statement}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {modes}
      {statement}
      {/* Yosh guruhlari — jami summalar */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {BUCKETS.map((item) => (
          <Card key={item.key} className={cn("cursor-pointer transition-colors", bucket === item.key && "border-primary")}>
            <CardContent
              className="p-3"
              onClick={() => setBucket(bucket === item.key ? "all" : item.key)}
            >
              <p className="text-xs text-muted-foreground">{item.label}</p>
              {data ? (
                <p className={cn("text-lg font-semibold tabular-nums", item.color)}>{fmt(data.totals[item.key])}</p>
              ) : (
                <Skeleton className="mt-1 h-6 w-20" />
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Select value={view} onValueChange={(value) => setView(value as typeof view)}>
            <SelectTrigger className="h-9 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="customers">Mijozlar kesimi</SelectItem>
              <SelectItem value="orders">Hujjatlar kesimi</SelectItem>
            </SelectContent>
          </Select>
          {data && (
            <p className="text-sm text-muted-foreground">
              {data.asOf} holatiga · jami <span className="font-semibold text-foreground">{fmt(data.totals.total)}</span> so'm
            </p>
          )}
        </div>
      </div>

      {!data ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <CircleDollarSign className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Ochiq qarz yo'q</p>
            <p className="text-sm text-muted-foreground">Yakunlangan sotuvlarning hammasi to'langan.</p>
          </CardContent>
        </Card>
      ) : view === "customers" ? (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/60 backdrop-blur">
              <tr className="text-left">
                <th className="px-3 py-2.5 font-medium text-muted-foreground">Mijoz</th>
                {BUCKETS.map((item) => (
                  <th key={item.key} className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                    {item.label}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Jami</th>
                <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Eng kech</th>
              </tr>
            </thead>
            <tbody>
              {data.customers.map((row) => (
                <tr key={row.customerId} className="border-t">
                  <td className="px-3 py-2.5">
                    <button type="button" className="text-left font-medium hover:underline" title="Hisob-kitob akti"
                      data-testid={`aging-customer-${row.customerId}`} onClick={() => setStatementFor(row.customerId)}>
                      {row.customerName}
                    </button>
                    <p className="text-xs text-muted-foreground">{row.customerCode}</p>
                  </td>
                  {BUCKETS.map((item) => (
                    <td key={item.key} className="px-3 py-2.5 text-right tabular-nums">
                      {num(row.totals[item.key]) > 0 ? fmt(row.totals[item.key]) : "—"}
                    </td>
                  ))}
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{fmt(row.totals.total)}</td>
                  <td className="px-3 py-2.5 text-right">
                    {row.maxDaysOverdue > 0 ? (
                      <Badge variant="secondary" className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400">
                        <ShieldAlert className="mr-1 h-3 w-3" />
                        {row.maxDaysOverdue} kun
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/60 backdrop-blur">
              <tr className="text-left">
                <th className="px-3 py-2.5 font-medium text-muted-foreground">Hujjat</th>
                <th className="px-3 py-2.5 font-medium text-muted-foreground">Mijoz</th>
                <th className="px-3 py-2.5 font-medium text-muted-foreground">Muddat</th>
                <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Summa</th>
                <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">To'langan</th>
                <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Qoldiq</th>
                <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Kechikish</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.orderId} className="border-t">
                  <td className="px-3 py-2.5">
                    <p className="font-medium">{row.number}</p>
                    <p className="text-xs text-muted-foreground">{row.orderDate}</p>
                  </td>
                  <td className="px-3 py-2.5">{row.customerName}</td>
                  <td className="px-3 py-2.5">{row.dueDate}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmt(row.totalAmount)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmt(row.paidAmount)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{fmt(row.remaining)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {row.daysOverdue > 0 ? <span className="text-red-600 dark:text-red-400">{row.daysOverdue} kun</span> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
