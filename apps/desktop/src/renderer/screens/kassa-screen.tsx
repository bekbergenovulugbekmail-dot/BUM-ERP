import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import type { AppStatus, DevicePrefs, LocalCashMovement, LocalCustomerPayment, PosContext, ShiftReport } from "../../shared/kassa-api.js";
import { CASH_KIND_LABELS, PAYMENT_LABELS, decimalInput, fmtMoney, fmtTime, num } from "../format.ts";
import { call, errorText } from "../kassa.ts";
import CashMovementDialog from "../pos/cash-movement-dialog.tsx";
import CustomerPaymentDialog from "../pos/customer-payment-dialog.tsx";
import { printShiftReport } from "../pos/report-html.ts";
import ShiftCloseDialog from "../pos/shift-close-dialog.tsx";

type Entry =
  | { kind: "movement"; createdAt: string; movement: LocalCashMovement }
  | { kind: "payment"; createdAt: string; payment: LocalCustomerPayment };

const SYNC_TONE: Record<string, string> = { pending: "text-pos-warning", rejected: "text-destructive", applied: "text-pos-success", discarded: "text-muted-foreground" };
const SYNC_TEXT: Record<string, string> = { pending: "navbatda", rejected: "rad etildi", applied: "serverda", discarded: "bekor qilingan" };

function ReportRows({ report, base }: { report: ShiftReport; base: string }) {
  const rows: [string, string, string?][] = [
    ["Boshlang'ich naqd", fmtMoney(report.shift.openingCash, base)],
    ["Cheklar", String(report.receipts)],
    ["Savdo", fmtMoney(report.salesTotal, base), "font-semibold"],
    ...report.byMethod.map((method): [string, string] => [
      `· ${method.label}`,
      method.key.startsWith("fx:") ? fmtMoney(method.amount, method.key.slice(3)) : fmtMoney(method.amount, base),
    ]),
    ...(report.returns.count > 0 ? [[`Qaytarishlar (${report.returns.count})`, fmtMoney(report.returns.total, base)] as [string, string]] : []),
    ...(report.customerPayments.count > 0
      ? [
          [
            `Mijoz to'lovlari (${report.customerPayments.count})`,
            fmtMoney(
              num(report.customerPayments.debtCash) + num(report.customerPayments.debtCard) + num(report.customerPayments.depositCash) + num(report.customerPayments.depositCard),
              base,
            ),
          ] as [string, string],
        ]
      : []),
    ...report.cashMovements.map((movement): [string, string] => [`${movement.label} (${movement.count})`, fmtMoney(movement.amount, base)]),
    ...(report.suppliers.payments > 0
      ? [[`Ta'minotchilarga to'lov (${report.suppliers.payments})`, fmtMoney(num(report.suppliers.paidCash) + num(report.suppliers.paidCard), base)] as [string, string]]
      : []),
    ...(report.suppliers.refunds > 0
      ? [[`Ta'minotchidan qaytgan pul (${report.suppliers.refunds})`, fmtMoney(num(report.suppliers.refundCash) + num(report.suppliers.refundCard), base)] as [string, string]]
      : []),
  ];
  return (
    <dl className="divide-y divide-border text-sm">
      {rows.map(([label, value, tone]) => (
        <div key={label} className={`flex justify-between gap-3 py-1.5 ${tone ?? ""}`}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="tabular-nums">{value}</dd>
        </div>
      ))}
      <div className="flex justify-between gap-3 py-2 text-lg font-bold">
        <dt>Kassada bo'lishi kerak</dt>
        <dd className="tabular-nums">{fmtMoney(report.expectedCash, base)}</dd>
      </div>
      {report.shift.closingCash !== null && (
        <div className="flex justify-between gap-3 py-1.5">
          <dt className="text-muted-foreground">Sanalgan / farq</dt>
          <dd className={`tabular-nums ${num(report.difference) === 0 ? "text-pos-success" : "text-pos-warning"}`}>
            {fmtMoney(report.shift.closingCash, base)} / {fmtMoney(report.difference, base)}
          </dd>
        </div>
      )}
    </dl>
  );
}

/**
 * Kassa bo'limi: joriy smena X-hisoboti (tushum turi, qaytarishlar, mijoz to'lovlari, naqd harakatlari, kutilgan naqd),
 * kirim/chiqim (inkassatsiya, almashtirish puli, xarajat), mijoz to'lovi, smenani yopish (Z-hisobot), yopilgan smenalar.
 */
export default function KassaScreen({ status, onStatus, onExit }: { status: AppStatus; onStatus: (status: AppStatus) => void; onExit: () => void }) {
  const [report, setReport] = useState<ShiftReport | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [history, setHistory] = useState<ShiftReport[]>([]);
  const [context, setContext] = useState<PosContext | null>(null);
  const [prefs, setPrefs] = useState<DevicePrefs | null>(null);
  const [direction, setDirection] = useState<"in" | "out" | null>(null);
  const [dialog, setDialog] = useState<"payment" | "close" | null>(null);
  const [viewed, setViewed] = useState<ShiftReport | null>(null);
  const [openingCash, setOpeningCash] = useState("");
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const shiftId = status.shift?.id ?? null;
  const lastSyncAt = status.sync.lastSyncAt;

  useEffect(() => {
    Promise.all([
      shiftId ? call("cash:report", {}) : Promise.resolve(null),
      call("cash:movements"),
      call("cash:customer-payments"),
      call("cash:shifts", { limit: 30 }),
      call("pos:context"),
      call("device:prefs"),
    ]).then(
      ([current, movements, payments, closed, loadedContext, devicePrefs]) => {
        setReport(current);
        setEntries(
          [
            ...movements.map((movement): Entry => ({ kind: "movement", createdAt: movement.createdAt, movement })),
            ...payments.map((payment): Entry => ({ kind: "payment", createdAt: payment.createdAt, payment })),
          ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        );
        setHistory(closed);
        setContext(loadedContext);
        setPrefs(devicePrefs);
      },
      (err: unknown) => setNotice({ tone: "error", text: errorText(err) }),
    );
  }, [shiftId, version, lastSyncAt]);

  const base = context?.baseCurrency ?? status.company?.currency ?? "UZS";
  const permissions = context?.permissions ?? status.cashier?.permissions ?? [];
  const refresh = () => {
    setVersion((value) => value + 1);
    call("app:status").then(onStatus, () => undefined);
  };

  const print = async (target: ShiftReport) => {
    if (!prefs) return;
    try {
      await printShiftReport(target, context, prefs, base);
    } catch (err) {
      setNotice({ tone: "error", text: `Chop etilmadi: ${errorText(err)}` });
    }
  };

  const openShift = async () => {
    try {
      onStatus(await call("shift:open", { openingCash: openingCash || "0" }));
      setOpeningCash("");
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err) });
    }
  };

  return (
    <main className="flex h-full flex-col bg-muted/40">
      <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-2">
        <Button size="sm" variant="secondary" onClick={onExit}>
          ← Bosh sahifa
        </Button>
        <h1 className="font-semibold">Kassa</h1>
        <span className="text-sm text-muted-foreground">
          {status.device?.code} · {status.device?.warehouseName}
          {status.shift ? ` · smena ${fmtTime(status.shift.openedAt)} dan, ${status.shift.cashierName ?? ""}` : " · smena yopiq"}
        </span>
        <span className="ml-auto text-sm">{status.cashier?.name ?? status.cashier?.phone}</span>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <section className="space-y-3">
          {report ? (
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-semibold">X-hisobot</h2>
                {report.unsynced > 0 && <span className="text-xs text-pos-warning">{report.unsynced} ta hujjat serverga yuborilmagan</span>}
              </div>
              <ReportRows report={report} base={base} />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button onClick={() => setDirection("in")}>Kirim</Button>
                <Button onClick={() => setDirection("out")}>Chiqim</Button>
                <Button variant="secondary" onClick={() => setDialog("payment")}>
                  Mijoz to'lovi
                </Button>
                <Button variant="secondary" disabled={!prefs} onClick={() => void print(report)}>
                  X-hisobot chop etish
                </Button>
                <Button variant="destructive" className="col-span-2" onClick={() => setDialog("close")}>
                  Smenani yopish (Z-hisobot)
                </Button>
              </div>
            </div>
          ) : (
            <form
              className="space-y-3 rounded-2xl border border-border bg-card p-4"
              onSubmit={(event) => {
                event.preventDefault();
                void openShift();
              }}
            >
              <h2 className="font-semibold">Smena yopiq</h2>
              <Input id="kassa-opening-cash" inputMode="decimal" placeholder="Boshlang'ich naqd" value={openingCash} onChange={(e) => setOpeningCash(decimalInput(e.target.value))} />
              <Button type="submit" className="w-full">
                Smenani ochish
              </Button>
            </form>
          )}
          {notice && (
            <p className={`rounded-lg px-3 py-2 text-sm ${notice.tone === "error" ? "bg-destructive/10 text-destructive" : "bg-pos-info/10 text-pos-info"}`}>{notice.text}</p>
          )}
        </section>

        <section className="space-y-4">
          <div className="rounded-2xl border border-border bg-card">
            <h2 className="border-b border-border px-4 py-2 font-semibold">Smenadagi kirim-chiqim va mijoz to'lovlari</h2>
            <ul className="divide-y divide-border">
              {entries.map((entry) =>
                entry.kind === "movement" ? (
                  <li key={entry.movement.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <span className={`w-16 text-xs font-semibold ${entry.movement.type === "in" ? "text-pos-success" : "text-pos-warning"}`}>
                      {entry.movement.type === "in" ? "KIRIM" : "CHIQIM"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {CASH_KIND_LABELS[entry.movement.kind]}
                        {entry.movement.category ? ` · ${entry.movement.category}` : ""}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {fmtTime(entry.movement.createdAt)} · {entry.movement.cashierName}
                        {entry.movement.notes ? ` · ${entry.movement.notes}` : ""}
                      </p>
                    </div>
                    <span className="tabular-nums">{fmtMoney(entry.movement.amount, base)}</span>
                    <span className={`w-20 text-right text-xs ${SYNC_TONE[entry.movement.sync.state]}`}>{SYNC_TEXT[entry.movement.sync.state]}</span>
                  </li>
                ) : (
                  <li key={entry.payment.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <span className="w-16 text-xs font-semibold text-pos-info">MIJOZ</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {entry.payment.customer.name} · {entry.payment.purpose === "debt" ? "qarz to'lovi" : "balansga"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {fmtTime(entry.payment.createdAt)} · {PAYMENT_LABELS[entry.payment.method]}
                        {entry.payment.sync.conflicts.includes("debt_overpaid") ? " · ortig'i balansga o'tdi" : ""}
                      </p>
                    </div>
                    <span className="tabular-nums">{fmtMoney(entry.payment.amount, base)}</span>
                    <span className={`w-20 text-right text-xs ${SYNC_TONE[entry.payment.sync.state]}`}>{SYNC_TEXT[entry.payment.sync.state]}</span>
                  </li>
                ),
              )}
              {entries.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">Hozircha yo'q</li>}
            </ul>
          </div>

          <div className="rounded-2xl border border-border bg-card">
            <h2 className="border-b border-border px-4 py-2 font-semibold">Yopilgan smenalar</h2>
            <ul className="divide-y divide-border">
              {history.map((closed) => (
                <li key={closed.shift.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {fmtTime(closed.shift.openedAt)} — {closed.shift.closedAt ? fmtTime(closed.shift.closedAt) : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {closed.shift.cashierName} · {closed.receipts} chek · farq {fmtMoney(closed.difference, base)}
                    </p>
                  </div>
                  <span className="tabular-nums">{fmtMoney(closed.salesTotal, base)}</span>
                  <Button size="sm" variant="ghost" onClick={() => setViewed(closed)}>
                    Ko'rish
                  </Button>
                </li>
              ))}
              {history.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">Bu kassada yopilgan smena yo'q</li>}
            </ul>
          </div>
        </section>
      </div>

      <CashMovementDialog
        direction={direction}
        canExpense={permissions.includes("pos.cash.expense") || permissions.includes("finance.manage")}
        onClose={() => setDirection(null)}
        onDone={() => {
          setNotice({ tone: "info", text: "Yozildi" });
          refresh();
        }}
      />
      <CustomerPaymentDialog
        open={dialog === "payment"}
        baseCurrency={base}
        onClose={() => setDialog(null)}
        onDone={(payment) => {
          setNotice({ tone: "info", text: `${payment.customer.name}: ${fmtMoney(payment.amount, base)} qabul qilindi` });
          refresh();
        }}
      />
      <ShiftCloseDialog
        open={dialog === "close"}
        shift={status.shift}
        baseCurrency={base}
        expectedCash={report?.expectedCash}
        onClose={() => setDialog(null)}
        onClosed={(next) => {
          setDialog(null);
          onStatus(next);
          call("cash:shifts", { limit: 1 }).then(
            ([closed]) => {
              if (!closed) return;
              setViewed(closed);
              if (prefs?.autoPrint) void print(closed);
            },
            () => undefined,
          );
        }}
      />
      <Dialog open={viewed !== null} onOpenChange={(value) => !value && setViewed(null)}>
        <DialogContent className="sm:max-w-md">
          {viewed && (
            <>
              <DialogHeader>
                <DialogTitle>Z-hisobot</DialogTitle>
                <DialogDescription>
                  {viewed.shift.cashierName} · {fmtTime(viewed.shift.openedAt)} — {viewed.shift.closedAt ? fmtTime(viewed.shift.closedAt) : ""}
                </DialogDescription>
              </DialogHeader>
              <ReportRows report={viewed} base={base} />
              <Button disabled={!prefs} onClick={() => void print(viewed)}>
                Chop etish
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
