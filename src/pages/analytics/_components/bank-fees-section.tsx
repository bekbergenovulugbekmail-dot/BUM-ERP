/**
 * Hisobotlar → Bank komissiyasi: davr bo'yicha kartadan tushum (UZCARD, HUMO ...), ushlangan karta komissiyasi, bank
 * hisobiga sof tushgan summa va pul chiqarish komissiyasi (ta'minotchi, xarajat, maosh, o'tkazma) — karta turi va bank
 * hisobi bo'yicha. Hisob serverda (`GET /api/finance/reports/bank-commissions`, `finance.view`).
 */
import { TERMINAL_NETWORK_LABELS } from "@bum/shared";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { formatMoney, useCurrencies } from "@/hooks/use-currencies.ts";
import { useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import { localIsoDate, shiftIsoDate, type BankCommissionReport } from "@/pages/finance/_lib/types.ts";

const SOURCE_LABELS: Record<string, string> = {
  customer_payment: "Karta to'lovi",
  supplier_payment: "Ta'minotchiga to'lov",
  expense: "Xarajat",
  salary_payment: "Maosh",
  cash_transfer: "Hisoblar o'rtasida o'tkazma",
  cash_transaction: "Qo'lda chiqim",
};

const cents = (value: string | number) => Math.round(Number(value) * 100);

export default function BankFeesSection({ days }: { days: number }) {
  const { base } = useCurrencies();
  const dateTo = localIsoDate();
  const dateFrom = shiftIsoDate(dateTo, -(days - 1));
  const report = useApiQuery<BankCommissionReport>("/api/finance/reports/bank-commissions", { dateFrom, dateTo }).data;
  const money = (value: string | number) => formatMoney(value, base);

  if (!report) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    );
  }

  const { totals } = report;
  const cards = [
    { label: "Kartadan tushum", hint: "UZCARD, HUMO ... (mijoz to'lagan)", value: money(totals.cardTurnover), tone: "" },
    { label: "Karta komissiyasi", hint: "bank ushlab qolgan", value: money(totals.acquiring), tone: "text-rose-600 dark:text-rose-400" },
    { label: "Bank hisobiga sof", hint: "tushum − komissiya", value: money((cents(totals.cardTurnover) - cents(totals.acquiring)) / 100), tone: "text-emerald-600 dark:text-emerald-400" },
    { label: "Pul chiqarish komissiyasi", hint: "ta'minotchi, xarajat, o'tkazma", value: money(totals.outgoing), tone: "text-rose-600 dark:text-rose-400" },
    { label: "Jami bank komissiyasi", hint: `${dateFrom} — ${dateTo}`, value: money(totals.total), tone: "text-rose-600 dark:text-rose-400" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">{card.label}</p>
            <p className={cn("mt-1 text-lg font-bold tabular-nums", card.tone)}>{card.value}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{card.hint}</p>
          </div>
        ))}
      </div>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <h3 className="border-b border-border px-4 py-3 text-sm font-semibold">Karta turlari bo'yicha</h3>
        {report.byTerminal.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Davrda karta to'lovi yo'q</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-medium">Karta turi</th>
                  <th className="px-4 py-2.5 text-left font-medium">Bank hisobi</th>
                  <th className="px-4 py-2.5 text-right font-medium">Komissiya %</th>
                  <th className="px-4 py-2.5 text-right font-medium">Tushum</th>
                  <th className="px-4 py-2.5 text-right font-medium">Komissiya</th>
                  <th className="px-4 py-2.5 text-right font-medium">Hisobga sof</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border tabular-nums">
                {report.byTerminal.map((row) => (
                  <tr key={row.terminalId}>
                    <td className="px-4 py-2.5">
                      <span className="mr-2 rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[11px] font-bold text-blue-700 dark:text-blue-300">
                        {TERMINAL_NETWORK_LABELS[row.network]}
                      </span>
                      {row.name}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{row.cashAccountName}</td>
                    <td className="px-4 py-2.5 text-right">{Number(row.commissionPercent)}%</td>
                    <td className="px-4 py-2.5 text-right">{money(row.turnover)}</td>
                    <td className="px-4 py-2.5 text-right text-rose-600 dark:text-rose-400">{money(row.commission)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold">{money(row.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <h3 className="border-b border-border px-4 py-3 text-sm font-semibold">Bank hisoblari bo'yicha</h3>
        {report.byAccount.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Davrda bank komissiyasi yo'q</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-medium">Bank hisobi</th>
                  <th className="px-4 py-2.5 text-right font-medium">Kartadan tushum</th>
                  <th className="px-4 py-2.5 text-right font-medium">Karta komissiyasi</th>
                  <th className="px-4 py-2.5 text-right font-medium">Pul chiqarish komissiyasi</th>
                  <th className="px-4 py-2.5 text-right font-medium">Jami komissiya</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border tabular-nums">
                {report.byAccount.map((row) => (
                  <tr key={row.cashAccountId}>
                    <td className="px-4 py-2.5">{row.name}</td>
                    <td className="px-4 py-2.5 text-right">{money(row.cardTurnover)}</td>
                    <td className="px-4 py-2.5 text-right">{money(row.acquiring)}</td>
                    <td className="px-4 py-2.5 text-right">{money(row.outgoing)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-rose-600 dark:text-rose-400">{money(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <h3 className="border-b border-border px-4 py-3 text-sm font-semibold">Komissiyalar ro'yxati</h3>
        {report.rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Davrda bank komissiyasi yo'q</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-medium">Sana</th>
                  <th className="px-4 py-2.5 text-left font-medium">Turi</th>
                  <th className="px-4 py-2.5 text-left font-medium">Bank hisobi</th>
                  <th className="px-4 py-2.5 text-left font-medium">Tavsif</th>
                  <th className="px-4 py-2.5 text-right font-medium">To'lov summasi</th>
                  <th className="px-4 py-2.5 text-right font-medium">Komissiya</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border tabular-nums">
                {report.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{row.date}</td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      {row.terminalName ? `Karta · ${row.terminalName}` : (SOURCE_LABELS[row.sourceType] ?? row.sourceType)}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{row.cashAccountName ?? "—"}</td>
                    <td className="min-w-64 px-4 py-2.5">
                      <p>{row.description}</p>
                      <p className="text-[11px] text-muted-foreground">{row.number}</p>
                    </td>
                    <td className="px-4 py-2.5 text-right">{row.sourceAmount ? money(row.sourceAmount) : "—"}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-rose-600 dark:text-rose-400">{money(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
