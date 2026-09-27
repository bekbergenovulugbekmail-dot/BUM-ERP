/**
 * Kassa va sotuvchilar hisoboti (Tahlil → "Kassa va sotuvchilar"):
 *  - Kassa sverkasi (`finance.view`): Boshlang'ich + naqd tushum + kirim − qaytarish − xarajat ± o'tkazmalar = Kutilgan;
 *    Ortiqcha/kamomad; Yakuniy — manba harakatlaridan (`/api/analytics/reports/kassa`);
 *  - Kassirlar: smena, chek, sotuv, usul bo'yicha tushum, ortiqcha/kamomad;
 *  - Sotuvchilar: sotuv, dona, chegirma, qaytarish, sof, tannarx, YF, marja, KPI bonus (Rule Builder);
 *  - To'lov usullari: summa va ulush.
 */
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { usePermissions } from "@/hooks/use-company.ts";
import { useApiQuery } from "@/lib/query.ts";

const fmt = (value: string | number | null | undefined) =>
  value === null || value === undefined ? "—" : Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 });

function rangeOf(days: number) {
  const now = new Date(Date.now() + 5 * 3_600_000);
  const to = now.toISOString().slice(0, 10);
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { from: start.toISOString().slice(0, 10), to };
}

function Table({ title, testId, head, rows, empty }: { title: string; testId: string; head: string[]; rows: ReactNode[][]; empty: string }) {
  return (
    <section className="space-y-2 rounded-2xl border border-border bg-card p-4" data-testid={testId}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                {head.map((cell, index) => (
                  <th key={cell} className={`px-2 py-1.5 font-medium ${index === 0 ? "text-left" : "text-right"}`}>{cell}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} className="border-t border-border/60">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className={`px-2 py-1.5 tabular-nums ${cellIndex === 0 ? "text-left font-medium" : "text-right"}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type KassaRow = {
  id: string; name: string; code: string | null; warehouseName: string; opening: string; cashSales: string; otherIn: string; supplierRefunds: string;
  transfersIn: string; refunds: string; salesReversals: string; expenses: string; supplierPayments: string; otherOut: string; transfersOut: string;
  expected: string; overShort: string; closing: string; balanceNow: string; shifts: { count: number; closed: number; counted: string; difference: string };
};
type CashierRow = { cashierId: string; cashierName: string; shifts: number; receipts: number; sales: string; cash: string; card: string; bank: string; returns: string; over: string; short: string };
type SellerRow = {
  employeeId: string; name: string; receipts: number; units: string; discount: string; sales: string; returns: string; netSales: string;
  cogs: string | null; grossProfit: string | null; marginPercent: string | null; bonus: string; kpi: { metric: string; metricValue: string; amount: string }[];
};
type MethodRow = { label: string; count: number; amount: string; sharePercent: string };

export default function KassaReportsSection({ days }: { days: number }) {
  const { can } = usePermissions();
  const range = rangeOf(days);
  const canFinance = can("finance.view");
  const kassa = useApiQuery<{ kassas: KassaRow[] }>(canFinance ? "/api/analytics/reports/kassa" : null, range).data?.kassas;
  const cashiers = useApiQuery<{ cashiers: CashierRow[] }>("/api/analytics/reports/cashiers", range).data?.cashiers;
  const sellers = useApiQuery<{ sellers: SellerRow[]; kpiMonth: string; profitHidden: boolean }>("/api/analytics/reports/sellers", range).data;
  const methods = useApiQuery<{ methods: MethodRow[]; total: string }>("/api/analytics/reports/payment-methods", range).data;

  if (!cashiers || !sellers || !methods) return <Skeleton className="h-64 rounded-2xl" />;
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Davr: {range.from} — {range.to}</p>
      {canFinance && kassa && (
        <Table
          title="Kassa sverkasi (manba harakatlaridan)"
          testId="report-kassa"
          head={["Kassa", "Boshlang'ich", "Naqd tushum", "Kirim", "O'tkazma (+)", "Qaytarish", "Xarajat", "Chiqim", "O'tkazma (−)", "Kutilgan", "Ortiqcha/kamomad", "Yakuniy"]}
          empty="POS kassalar yo'q (Moliya → Kassa: kassani omborga biriktiring)"
          rows={kassa.map((row) => [
            <span key="n">{row.code ? `${row.code} · ${row.name}` : row.name}<span className="block text-[11px] font-normal text-muted-foreground">{row.warehouseName} · {row.shifts.count} smena</span></span>,
            fmt(row.opening),
            fmt(row.cashSales),
            fmt(Number(row.otherIn) + Number(row.supplierRefunds)),
            fmt(row.transfersIn),
            fmt(Number(row.refunds) + Number(row.salesReversals)),
            fmt(row.expenses),
            fmt(Number(row.supplierPayments) + Number(row.otherOut)),
            fmt(row.transfersOut),
            fmt(row.expected),
            <span key="d" className={Number(row.overShort) < 0 ? "text-rose-600" : Number(row.overShort) > 0 ? "text-emerald-600" : ""}>{fmt(row.overShort)}</span>,
            <span key="c" title={`Hozirgi balans: ${fmt(row.balanceNow)}`}>{fmt(row.closing)}</span>,
          ])}
        />
      )}
      <Table
        title="Kassirlar"
        testId="report-cashiers"
        head={["Kassir", "Smena", "Chek", "Sotuv", "Naqd", "Karta", "Bank", "Qaytarish", "Ortiqcha", "Kamomad"]}
        empty="Bu davrda smena yo'q"
        rows={cashiers.map((row) => [row.cashierName ?? "—", row.shifts, row.receipts, fmt(row.sales), fmt(row.cash), fmt(row.card), fmt(row.bank), fmt(row.returns), fmt(row.over), fmt(row.short)])}
      />
      <Table
        title={`Sotuvchilar (KPI — ${sellers.kpiMonth})`}
        testId="report-sellers"
        head={["Sotuvchi", "Chek", "Dona", "Sotuv", "Chegirma", "Qaytarish", "Sof", "Tannarx", "Yalpi foyda", "Marja %", "KPI bonus"]}
        empty="Bu davrda sotuvchi tanlangan chek yo'q (kassada «Sotuvchi» tanlanadi)"
        rows={sellers.sellers.map((row) => [
          row.name,
          row.receipts,
          fmt(row.units),
          fmt(row.sales),
          fmt(row.discount),
          fmt(row.returns),
          fmt(row.netSales),
          fmt(row.cogs),
          fmt(row.grossProfit),
          row.marginPercent === null ? "—" : fmt(row.marginPercent),
          <span key="b" title={row.kpi.map((line) => `${line.metric}: ${fmt(line.metricValue)} → ${fmt(line.amount)}`).join("\n")}>{fmt(row.bonus)}</span>,
        ])}
      />
      <Table
        title={`To'lov usullari — jami ${fmt(methods.total)}`}
        testId="report-payment-methods"
        head={["Usul", "To'lovlar", "Summa", "Ulush %"]}
        empty="Bu davrda to'lov yo'q"
        rows={methods.methods.map((row) => [row.label, row.count, fmt(row.amount), fmt(row.sharePercent)])}
      />
    </div>
  );
}
