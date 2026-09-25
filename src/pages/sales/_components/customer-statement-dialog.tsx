/**
 * MIJOZ HISOB-KITOBI (akt) — boshlang'ich qoldiq → har bir operatsiya → yakuniy qoldiq, FROM → TO.
 *
 * Manba — buxgalteriya jurnali (server hisoblaydi): sotuv, to'lov, qaytarish, pul qaytarish, hamyon, keshbek, tuzatish,
 * bekor qilingan to'lov (teskari yozuv) — hammasi o'z sanasida. Oyma-oy jadval va qarz yoshi ham shu yerda; kesh
 * (`total_debt`) jurnal bilan mos kelmasa — ogohlantirish. Excel va PDF xuddi shu ma'lumotdan.
 */
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, FileSpreadsheet, FileText, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useApiQuery } from "@/lib/query.ts";
import { errorMessage } from "@/lib/api.ts";
import { cn } from "@/lib/utils.ts";
import { useActiveCompany, usePermissions } from "@/hooks/use-company.ts";
import { downloadBlob } from "@/components/csv/xlsx.ts";
import {
  AGING_LABELS, documentText, money, monthLabel, statementPdf, statementXlsx,
  type CustomerStatement, type StatementAgingBucket,
} from "../_lib/customer-statement.ts";
import PaymentReversalDialog from "./payment-reversal-dialog.tsx";
import DepositReversalDialog from "./deposit-reversal-dialog.tsx";

const iso = (date: Date) => new Date(date.getTime() + 5 * 3600_000).toISOString().slice(0, 10);
const today = () => iso(new Date());

function presets() {
  const now = new Date(Date.now() + 5 * 3600_000);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = (year: number, month: number, day: number) => new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
  return [
    { label: "Bu oy", from: d(y, m, 1), to: today() },
    { label: "O'tgan oy", from: d(y, m - 1, 1), to: d(y, m, 0) },
    { label: "Oxirgi 3 oy", from: d(y, m - 2, 1), to: today() },
    { label: "Yil boshidan", from: d(y, 0, 1), to: today() },
  ];
}

const KIND_COLORS: Record<string, string> = {
  sale: "text-foreground",
  payment: "text-emerald-700 dark:text-emerald-400",
  payment_reversal: "text-destructive",
  return: "text-sky-700 dark:text-sky-400",
  refusal: "text-orange-700 dark:text-orange-400",
  wallet_reversal: "text-destructive",
  refund: "text-amber-700 dark:text-amber-400",
  adjustment: "text-violet-700 dark:text-violet-400",
};

export default function CustomerStatementDialog({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const [range, setRange] = useState(() => presets()[3]!);
  const [reversing, setReversing] = useState<string | null>(null);
  const [reversingDeposit, setReversingDeposit] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);
  const { can } = usePermissions();
  const company = useActiveCompany().data?.company;
  const query = useApiQuery<CustomerStatement>(`/api/sales/customers/${customerId}/statement`, { from: range.from, to: range.to });
  const data = query.data;

  const exportAs = async (kind: "xlsx" | "pdf") => {
    if (!data) return;
    setExporting(kind);
    try {
      const file = kind === "xlsx"
        ? await statementXlsx(data, company?.name ?? "BUM ERP")
        : await statementPdf(data, { name: company?.name ?? "BUM ERP", taxId: company?.taxId ?? undefined, phone: company?.phone ?? undefined, address: company?.address ?? undefined });
      downloadBlob(file.blob, file.filename);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setExporting(null);
    }
  };

  const closing = data ? Number(data.closing.debt) : 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-6xl" data-testid="customer-statement">
        <DialogHeader>
          <DialogTitle>Hisob-kitob akti{data ? `: ${data.customer.name}` : ""}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-xs">Dan</Label>
            <Input type="date" className="h-9 w-40" value={range.from} data-testid="statement-from"
              onChange={(event) => event.target.value && setRange({ ...range, label: "", from: event.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Gacha</Label>
            <Input type="date" className="h-9 w-40" value={range.to} data-testid="statement-to"
              onChange={(event) => event.target.value && setRange({ ...range, label: "", to: event.target.value })} />
          </div>
          {presets().map((preset) => (
            <Button key={preset.label} size="sm" variant={range.label === preset.label ? "default" : "secondary"} onClick={() => setRange(preset)}>
              {preset.label}
            </Button>
          ))}
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="secondary" disabled={!data || exporting !== null} onClick={() => void exportAs("xlsx")} data-testid="statement-xlsx">
              <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" /> Excel
            </Button>
            <Button size="sm" variant="secondary" disabled={!data || exporting !== null} onClick={() => void exportAs("pdf")} data-testid="statement-pdf">
              <FileText className="mr-1.5 h-3.5 w-3.5" /> PDF
            </Button>
          </div>
        </div>

        {!data ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-10 w-full" />)}
          </div>
        ) : (
          <div className="space-y-4">
            {!data.reconciliation.ok && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" data-testid="statement-mismatch">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Mijoz kartasidagi qarz ({money(data.reconciliation.cachedDebt)}) buxgalteriya bilan mos emas ({money(data.reconciliation.ledgerDebt)}).
                Akt buxgalteriyadan olinadi; farq {money(data.reconciliation.difference)} — moliya bo'limiga xabar bering.
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5" data-testid="statement-summary">
              {[
                { label: `Boshlang'ich (${data.from})`, value: data.opening.debt },
                { label: "Qarz oshdi (+)", value: data.totals.debit },
                { label: "Qarz kamaydi (−)", value: data.totals.credit },
                { label: `Yakuniy (${data.to})`, value: data.closing.debt, strong: true },
                { label: "Hamyon (avans)", value: data.closing.wallet },
              ].map((card) => (
                <div key={card.label} className={cn("rounded-lg border p-3", card.strong && "border-primary/40 bg-primary/5")}>
                  <p className="text-xs text-muted-foreground">{card.label}</p>
                  <p className={cn("text-lg font-semibold tabular-nums", card.strong && closing > 0 && "text-destructive")}>{money(card.value)}</p>
                </div>
              ))}
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm" data-testid="statement-lines">
                <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Sana</th>
                    <th className="px-3 py-2">Operatsiya</th>
                    <th className="px-3 py-2">Hujjat</th>
                    <th className="px-3 py-2 text-right">+ Qarz</th>
                    <th className="px-3 py-2 text-right">− Qarz</th>
                    <th className="px-3 py-2 text-right">Qoldiq</th>
                    <th className="px-3 py-2">Kiritgan</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t bg-muted/20">
                    <td className="px-3 py-2" colSpan={5}>Boshlang'ich qoldiq</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{money(data.opening.debt)}</td>
                    <td colSpan={2} />
                  </tr>
                  {data.lines.map((line) => (
                    <tr key={line.entryId} className="border-t" data-kind={line.kind}>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{line.date}</td>
                      <td className={cn("px-3 py-2", KIND_COLORS[line.kind])}>{line.label}</td>
                      <td className="px-3 py-2">
                        {documentText(line)}
                        {line.document.status === "reversed" && (line.kind === "payment" || line.kind === "wallet") && <Badge variant="outline" className="ml-1 text-[10px]">bekor</Badge>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(line.debit) ? money(line.debit) : ""}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(line.credit) ? money(line.credit) : ""}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{money(line.balance)}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{line.createdBy ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        {line.kind === "payment" && line.document.type === "customer_payment" && line.document.status === "posted" && line.document.id && can("finance.approve") && (
                          <Button size="sm" variant="ghost" className="h-7 text-xs" data-testid={`reverse-${line.document.id}`} onClick={() => setReversing(line.document.id)}>
                            <Undo2 className="mr-1 h-3 w-3" /> Bekor qilish
                          </Button>
                        )}
                        {line.kind === "wallet" && line.document.type === "customer_balance" && line.document.number === "deposit" && line.document.status === "posted" && line.document.id && can("finance.approve") && (
                          <Button size="sm" variant="ghost" className="h-7 text-xs" data-testid={`reverse-deposit-${line.document.id}`} onClick={() => setReversingDeposit(line.document.id)}>
                            <Undo2 className="mr-1 h-3 w-3" /> Bekor qilish
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {data.lines.length === 0 && (
                    <tr className="border-t"><td className="px-3 py-6 text-center text-muted-foreground" colSpan={8}>Bu davrda operatsiya yo'q</td></tr>
                  )}
                  <tr className="border-t bg-muted/20 font-semibold">
                    <td className="px-3 py-2" colSpan={3}>Yakuniy qoldiq ({data.to})</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(data.totals.debit)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(data.totals.credit)}</td>
                    <td className="px-3 py-2 text-right tabular-nums" data-testid="statement-closing">{money(data.closing.debt)}</td>
                    <td colSpan={2} />
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border">
                <p className="border-b px-3 py-2 text-sm font-medium">Oyma-oy</p>
                <table className="w-full text-sm" data-testid="statement-months">
                  <thead className="text-xs text-muted-foreground">
                    <tr><th className="px-3 py-1.5 text-left">Oy</th><th className="px-3 py-1.5 text-right">Boshi</th><th className="px-3 py-1.5 text-right">+</th><th className="px-3 py-1.5 text-right">−</th><th className="px-3 py-1.5 text-right">Oy oxiri</th></tr>
                  </thead>
                  <tbody>
                    {data.months.map((row) => (
                      <tr key={row.month} className="border-t">
                        <td className="px-3 py-1.5">{monthLabel(row.month)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{money(row.opening)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{money(row.debit)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{money(row.credit)}</td>
                        <td className="px-3 py-1.5 text-right font-medium tabular-nums">{money(row.closing)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="rounded-lg border">
                <p className="border-b px-3 py-2 text-sm font-medium">Qarz yoshi (bugungi ochiq hujjatlar)</p>
                <div className="grid grid-cols-3 gap-2 p-3" data-testid="statement-aging">
                  {(Object.keys(AGING_LABELS) as StatementAgingBucket[]).map((bucket) => (
                    <div key={bucket} className="rounded-md bg-muted/40 p-2">
                      <p className="text-[11px] text-muted-foreground">{AGING_LABELS[bucket]}</p>
                      <p className={cn("font-semibold tabular-nums", bucket !== "not_due" && Number(data.aging.buckets[bucket]) > 0 && "text-destructive")}>
                        {money(data.aging.buckets[bucket])}
                      </p>
                    </div>
                  ))}
                </div>
                {Number(data.aging.undocumented) !== 0 && (
                  <p className="px-3 pb-3 text-xs text-muted-foreground">
                    Hujjatga bog'lanmagan qarz (boshlang'ich qoldiq yoki tuzatish): <b>{money(data.aging.undocumented)}</b>
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {reversing && <PaymentReversalDialog paymentId={reversing} onClose={() => setReversing(null)} />}
        {reversingDeposit && <DepositReversalDialog customerId={customerId} depositId={reversingDeposit} onClose={() => setReversingDeposit(null)} />}
      </DialogContent>
    </Dialog>
  );
}
