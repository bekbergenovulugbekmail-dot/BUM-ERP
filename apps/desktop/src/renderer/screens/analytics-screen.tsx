import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import type { AppStatus } from "../../shared/kassa-api.js";
import type { AnalyticsReport, AmountLine, BalanceGroup } from "../../shared/sync-types.js";
import { fmtMoney, fmtQty, num } from "../format.ts";
import { call, errorText } from "../kassa.ts";

type Tab = "kpi" | "sales" | "cash" | "debts" | "products" | "categories";

const TABS: { key: Tab; label: string }[] = [
  { key: "kpi", label: "Asosiy ko'rsatkichlar" },
  { key: "sales", label: "Savdo" },
  { key: "cash", label: "Kirim-chiqim" },
  { key: "debts", label: "Qarzdorlik-haqdorlik" },
  { key: "products", label: "Mahsulotlar tahlili" },
  { key: "categories", label: "Kategoriya bo'yicha tannarx" },
];

const pad2 = (value: number) => String(value).padStart(2, "0");
const dayText = (at: Date) => `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`;

function presetRange(preset: "today" | "7" | "30" | "month"): { from: string; to: string } {
  const now = new Date();
  const to = dayText(now);
  if (preset === "today") return { from: to, to };
  if (preset === "month") return { from: dayText(new Date(now.getFullYear(), now.getMonth(), 1)), to };
  const start = new Date(now);
  start.setDate(start.getDate() - (Number(preset) - 1));
  return { from: dayText(start), to };
}

/**
 * Analitika: asosiy ko'rsatkichlar, savdo (kunlar, to'lov turlari, kassirlar), kirim-chiqim, qarzdorlik-haqdorlik,
 * mahsulotlar tahlili, kategoriya bo'yicha tannarx. Internet bilan — serverdan (ombor bo'yicha), bo'lmasa — shu kassa
 * hujjatlaridan.
 */
export default function AnalyticsScreen({ status, onExit }: { status: AppStatus; onExit: () => void }) {
  const [range, setRange] = useState(() => presetRange("today"));
  const [localOnly, setLocalOnly] = useState(false);
  const [tab, setTab] = useState<Tab>("kpi");
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);
  const base = status.company?.currency ?? "UZS";
  const allowed = status.cashier?.permissions.includes("analytics.view") ?? false;

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    call("analytics:report", { ...range, source: localOnly ? "local" : "auto" }).then(
      (value) => {
        if (cancelled) return;
        setReport(value);
        setError(null);
        setLoading(false);
      },
      (err: unknown) => {
        if (cancelled) return;
        setError(errorText(err));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [range, localOnly, allowed, version]);

  const money = (value: string | null | undefined) => (value == null ? "—" : fmtMoney(value, base));
  const reload = (next?: { from: string; to: string }) => {
    setLoading(true);
    if (next) setRange(next);
    else setVersion((value) => value + 1);
  };

  return (
    <main className="grid h-full grid-rows-[auto_auto_1fr] bg-muted/40">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2">
        <Button size="sm" variant="secondary" onClick={onExit}>
          ← Bosh sahifa
        </Button>
        <h1 className="font-semibold">Analitika</h1>
        <div className="flex flex-wrap items-center gap-1">
          {(
            [
              ["today", "Bugun"],
              ["7", "7 kun"],
              ["30", "30 kun"],
              ["month", "Bu oy"],
            ] as const
          ).map(([key, label]) => (
            <Button key={key} size="sm" variant="secondary" onClick={() => reload(presetRange(key))}>
              {label}
            </Button>
          ))}
          <Input id="analytics-from" type="date" className="h-8 w-36" value={range.from} max={range.to} onChange={(e) => e.target.value && reload({ ...range, from: e.target.value })} />
          <span className="text-muted-foreground">—</span>
          <Input id="analytics-to" type="date" className="h-8 w-36" value={range.to} min={range.from} onChange={(e) => e.target.value && reload({ ...range, to: e.target.value })} />
        </div>
        <label htmlFor="analytics-local" className="flex items-center gap-2 text-sm">
          <input
            id="analytics-local"
            type="checkbox"
            checked={localOnly}
            onChange={(e) => {
              setLoading(true);
              setLocalOnly(e.target.checked);
            }}
          />
          Faqat shu kassa
        </label>
        <Button size="sm" className="ml-auto" disabled={loading} onClick={() => reload()}>
          {loading ? "Yuklanmoqda…" : "Yangilash"}
        </Button>
      </header>

      <nav className="flex flex-wrap items-center gap-1 border-b border-border bg-card/60 px-4 py-1.5">
        {TABS.map((item) => (
          <Button key={item.key} size="sm" variant={tab === item.key ? "default" : "ghost"} onClick={() => setTab(item.key)}>
            {item.label}
          </Button>
        ))}
        {report && (
          <span className={`ml-auto text-xs ${report.source === "server" ? "text-pos-success" : "text-pos-warning"}`}>
            {report.source === "server" ? "Server" : "Offline"} · {report.scope}
          </span>
        )}
      </nav>

      <div className="min-h-0 overflow-auto p-3">
        {!allowed && <p className="rounded-lg bg-pos-warning/10 px-4 py-3 text-pos-warning">Analitika uchun ruxsat kerak: analytics.view.</p>}
        {error && <p className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        {report && tab === "kpi" && <KpiTab report={report} money={money} />}
        {report && tab === "sales" && <SalesTab report={report} money={money} />}
        {report && tab === "cash" && <CashTab report={report} money={money} />}
        {report && tab === "debts" && <DebtsTab report={report} money={money} />}
        {report && tab === "products" && <ProductsTab report={report} money={money} />}
        {report && tab === "categories" && <CategoriesTab report={report} money={money} />}
      </div>
    </main>
  );
}

type Money = (value: string | null | undefined) => string;

function Tile({ label, value, hint, tone = "" }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function KpiTab({ report, money }: { report: AnalyticsReport; money: Money }) {
  const k = report.kpis;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Tile label="Sof tushum" value={money(k.netRevenue)} hint={`Savdo ${money(k.revenue)} − qaytarish ${money(k.returns)}`} />
      <Tile label="Yalpi foyda" value={money(k.grossProfit)} hint={k.margin ? `Marja ${k.margin}% · tannarx ${money(k.cogs)}` : undefined} tone={num(k.grossProfit) < 0 ? "text-destructive" : "text-pos-success"} />
      <Tile label="Cheklar" value={String(k.receipts)} hint={`O'rtacha chek ${money(k.averageReceipt)}`} />
      <Tile label="Sotilgan mahsulot" value={fmtQty(k.itemsSold)} hint="asosiy birlikda" />
      <Tile label="Xaridlar" value={money(k.purchases)} />
      <Tile label="Xarajatlar" value={money(k.expenses)} />
      <Tile label="Ombor qiymati" value={money(k.stockValue)} hint="tannarxda, hozirgi holat" />
      <Tile label="Mijozlar" value={String(k.customers)} />
    </div>
  );
}

function Bars({ rows, money }: { rows: AnalyticsReport["daily"]; money: Money }) {
  const max = Math.max(1, ...rows.map((row) => num(row.revenue)));
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="mb-3 text-sm font-semibold">Kunlar bo'yicha savdo</p>
      <div className="flex h-48 items-end gap-1 overflow-x-auto">
        {rows.map((row) => (
          <div key={row.date} className="flex min-w-8 flex-1 flex-col items-center gap-1" title={`${row.date}: ${money(row.revenue)}, ${row.receipts} chek`}>
            <div className="w-full rounded-t bg-primary/70" style={{ height: `${Math.max(2, (num(row.revenue) / max) * 160)}px` }} />
            <span className="text-[10px] text-muted-foreground">{row.date.slice(5)}</span>
          </div>
        ))}
        {rows.length === 0 && <p className="m-auto text-sm text-muted-foreground">Savdo yo'q</p>}
      </div>
    </div>
  );
}

function Lines({ title, lines, money, total }: { title: string; lines: AmountLine[]; money: Money; total?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="mb-2 text-sm font-semibold">{title}</p>
      <ul className="divide-y divide-border text-sm">
        {lines.map((line) => (
          <li key={line.key} className="flex justify-between gap-3 py-1.5">
            <span>{line.label}</span>
            <span className="tabular-nums">{money(line.amount)}</span>
          </li>
        ))}
        {lines.length === 0 && <li className="py-1.5 text-muted-foreground">Yo'q</li>}
        {total !== undefined && (
          <li className="flex justify-between gap-3 py-1.5 font-semibold">
            <span>Jami</span>
            <span className="tabular-nums">{money(total)}</span>
          </li>
        )}
      </ul>
    </div>
  );
}

function SalesTab({ report, money }: { report: AnalyticsReport; money: Money }) {
  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="space-y-3">
        <Bars rows={report.daily} money={money} />
        <div className="overflow-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/80 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Sana</th>
                <th className="px-3 py-2 text-right">Cheklar</th>
                <th className="px-3 py-2 text-right">Savdo</th>
                <th className="px-3 py-2 text-right">Qaytarish</th>
                <th className="px-3 py-2 text-right">Foyda</th>
              </tr>
            </thead>
            <tbody>
              {report.daily.map((row) => (
                <tr key={row.date} className="border-t border-border">
                  <td className="px-3 py-1.5">{row.date}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{row.receipts}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(row.revenue)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(row.returns)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(row.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="space-y-3">
        <Lines title="To'lov turlari" lines={report.payments} money={money} />
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="mb-2 text-sm font-semibold">Kassirlar</p>
          <ul className="divide-y divide-border text-sm">
            {report.cashiers.map((row) => (
              <li key={row.name} className="flex justify-between gap-3 py-1.5">
                <span>
                  {row.name} <span className="text-xs text-muted-foreground">· {row.receipts} chek</span>
                </span>
                <span className="tabular-nums">{money(row.revenue)}</span>
              </li>
            ))}
            {report.cashiers.length === 0 && <li className="py-1.5 text-muted-foreground">Yo'q</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}

function CashTab({ report, money }: { report: AnalyticsReport; money: Money }) {
  const flow = report.cashFlow;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Kirim" value={money(flow.totalIncome)} tone="text-pos-success" />
        <Tile label="Chiqim" value={money(flow.totalExpense)} tone="text-destructive" />
        <Tile label="Sof pul oqimi" value={money(flow.net)} tone={num(flow.net) < 0 ? "text-destructive" : ""} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Lines title="Kirim manbalari" lines={flow.income} money={money} total={flow.totalIncome} />
        <Lines title="Chiqim yo'nalishlari" lines={flow.expense} money={money} total={flow.totalExpense} />
      </div>
    </div>
  );
}

function BalanceCard({ title, hint, group, money, tone }: { title: string; hint: string; group: BalanceGroup; money: Money; tone: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold">{title}</p>
        <p className={`text-xl font-bold tabular-nums ${tone}`}>{money(group.total)}</p>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        {hint} · {group.count} ta
      </p>
      <ul className="divide-y divide-border text-sm">
        {group.top.map((row) => (
          <li key={row.id} className="flex justify-between gap-3 py-1.5">
            <span className="min-w-0 truncate">
              {row.name}
              {row.phone && <span className="ml-2 text-xs text-muted-foreground">{row.phone}</span>}
            </span>
            <span className="tabular-nums">{money(row.amount)}</span>
          </li>
        ))}
        {group.top.length === 0 && <li className="py-1.5 text-muted-foreground">Yo'q</li>}
      </ul>
    </div>
  );
}

function DebtsTab({ report, money }: { report: AnalyticsReport; money: Money }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <BalanceCard title="Qarzdorlik: mijozlar qarzi" hint="bizga to'lashi kerak" group={report.receivables} money={money} tone="text-pos-warning" />
      <BalanceCard title="Haqdorlik: ta'minotchilarga qarzimiz" hint="biz to'lashimiz kerak" group={report.payables} money={money} tone="text-destructive" />
      <BalanceCard title="Mijozlar balansi (oldindan to'lov)" hint="mijozlar oldidagi majburiyat" group={report.customerBalances} money={money} tone="" />
      <BalanceCard title="Ta'minotchilarga avans" hint="ta'minotchilar bizga qarzdor" group={report.supplierAdvances} money={money} tone="text-pos-success" />
    </div>
  );
}

function ProductsTab({ report, money }: { report: AnalyticsReport; money: Money }) {
  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="overflow-auto rounded-xl border border-border bg-card">
        <p className="px-4 pt-3 text-sm font-semibold">Eng ko'p sotilganlar (tushum bo'yicha)</p>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Mahsulot</th>
              <th className="px-3 py-2 text-right">Miqdor</th>
              <th className="px-3 py-2 text-right">Tushum</th>
              <th className="px-3 py-2 text-right">Tannarx</th>
              <th className="px-3 py-2 text-right">Foyda</th>
            </tr>
          </thead>
          <tbody>
            {report.products.top.map((row) => (
              <tr key={row.productId} className="border-t border-border">
                <td className="px-3 py-1.5">
                  {row.name} <span className="text-xs text-muted-foreground">{row.sku}</span>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtQty(row.quantity)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(row.revenue)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(row.cogs)}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${num(row.profit) < 0 ? "text-destructive" : ""}`}>{money(row.profit)}</td>
              </tr>
            ))}
            {report.products.top.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  Savdo yo'q
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="overflow-auto rounded-xl border border-border bg-card">
        <p className="px-4 pt-3 text-sm font-semibold">Sotilmayotganlar (qoldiq bor, davrda sotuv yo'q)</p>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Mahsulot</th>
              <th className="px-3 py-2 text-right">Qoldiq</th>
              <th className="px-3 py-2 text-right">Qiymati</th>
            </tr>
          </thead>
          <tbody>
            {report.products.slow.map((row) => (
              <tr key={row.productId} className="border-t border-border">
                <td className="px-3 py-1.5">
                  {row.name} <span className="text-xs text-muted-foreground">{row.sku}</span>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtQty(row.stock)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(row.value)}</td>
              </tr>
            ))}
            {report.products.slow.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                  Yo'q
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CategoriesTab({ report, money }: { report: AnalyticsReport; money: Money }) {
  return (
    <div className="overflow-auto rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/80 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Kategoriya</th>
            <th className="px-3 py-2 text-right">Sotilgan</th>
            <th className="px-3 py-2 text-right">Tushum</th>
            <th className="px-3 py-2 text-right">Sotilgan tannarxi</th>
            <th className="px-3 py-2 text-right">Foyda</th>
            <th className="px-3 py-2 text-right">Qoldiq</th>
            <th className="px-3 py-2 text-right">Qoldiq tannarxi</th>
          </tr>
        </thead>
        <tbody>
          {report.categories.map((row) => (
            <tr key={row.categoryId ?? "none"} className="border-t border-border">
              <td className="px-3 py-1.5 font-medium">{row.name}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{fmtQty(row.soldQty)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{money(row.revenue)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{money(row.cogs)}</td>
              <td className={`px-3 py-1.5 text-right tabular-nums ${num(row.profit) < 0 ? "text-destructive" : ""}`}>{money(row.profit)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{fmtQty(row.stockQty)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{money(row.stockValue)}</td>
            </tr>
          ))}
          {report.categories.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                Ma'lumot yo'q
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
