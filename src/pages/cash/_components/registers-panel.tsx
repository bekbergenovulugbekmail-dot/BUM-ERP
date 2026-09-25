/**
 * KASSALAR — har kassa mas'ul xodim bilan (Bito "Kassa" bo'limi oqimi, BUM ERP qoidalari bilan).
 *
 * Mas'ul xodim (`cash.own`) faqat o'z kassasini ko'radi: kirim, chiqim, o'tkazma (masalan, asosiy kassaga topshirish),
 * ayirboshlash va hisobot. Rahbar hamma kassani ko'radi, to'lov usulini tuzatadi, hujjatni tasdiqlaydi yoki bekor
 * qiladi. Kassa ochish, mas'ul biriktirish va qoldiqni o'rnatish — "Kassa & Bank" bo'limida (rahbar).
 */
import { useState } from "react";
import { toast } from "sonner";
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, BadgeCheck, FileBarChart, Repeat, Undo2, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import { cn } from "@/lib/utils.ts";
import CashDocumentDialog from "./cash-document-dialog.tsx";
import { KIND_LABELS, TYPE_LABELS, localToday, money, type CashDocument, type CashDocumentKind, type CashRegister, type CashReport } from "../_lib/types.ts";

export default function RegistersPanel() {
  const { can } = usePermissions();
  const query = useApiQuery<{ registers: CashRegister[]; scope: "all" | "own" }>("/api/finance/cash/registers");
  const registers = query.data?.registers;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<CashDocumentKind | null>(null);
  const selected = registers?.find((row) => row.id === selectedId) ?? registers?.[0] ?? null;

  if (query.isLoading) return <Skeleton className="h-40 w-full" />;
  if (query.error) return <p className="p-4 text-sm text-destructive">{errorMessage(query.error)}</p>;
  if (!registers || registers.length === 0) {
    return (
      <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground" data-testid="registers-empty">
        {query.data?.scope === "own" ? "Sizga kassa biriktirilmagan — rahbarga murojaat qiling." : "Faol kassa yo'q."}
      </p>
    );
  }

  const actions: { kind: CashDocumentKind; label: string; icon: typeof ArrowDownToLine; show: boolean }[] = [
    { kind: "income", label: "Kirim", icon: ArrowDownToLine, show: true },
    { kind: "expense", label: "Chiqim", icon: ArrowUpFromLine, show: true },
    { kind: "transfer", label: "O'tkazish", icon: ArrowLeftRight, show: true },
    { kind: "method_exchange", label: "Usulni ayirboshlash", icon: Repeat, show: registers.length > 1 },
    { kind: "currency_exchange", label: "Valyuta ayirboshlash", icon: Repeat, show: registers.some((row) => row.currency !== selected?.currency) },
    { kind: "method_correction", label: "Usulni tuzatish", icon: Wrench, show: can("finance.manage") },
  ];

  return (
    <div className="space-y-4" data-testid="registers-panel">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {registers.map((row) => (
          <button
            key={row.id}
            type="button"
            data-testid={`register-${row.id}`}
            onClick={() => setSelectedId(row.id)}
            className={cn("rounded-lg border p-3 text-left transition-colors hover:bg-muted/40", selected?.id === row.id && "border-primary ring-1 ring-primary")}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{row.name}</span>
              <Badge variant="outline" className="text-[10px]">{TYPE_LABELS[row.type]}{row.isDefault ? " · asosiy" : ""}</Badge>
            </div>
            <p className="mt-1 text-lg font-semibold tabular-nums" data-testid={`register-balance-${row.id}`}>{money(row.balance, row.currency)}</p>
            <p className="text-xs text-muted-foreground">Mas'ul: {row.employeeName ?? "—"}</p>
          </button>
        ))}
      </div>

      {selected && (
        <>
          <div className="flex flex-wrap gap-2">
            {actions.filter((action) => action.show).map((action) => (
              <Button key={action.kind} size="sm" variant="secondary" data-testid={`register-action-${action.kind}`} onClick={() => setDialog(action.kind)}>
                <action.icon className="mr-1.5 h-4 w-4" /> {action.label}
              </Button>
            ))}
          </div>
          <RegisterReport register={selected} />
          <DocumentsList register={selected} />
        </>
      )}

      {dialog && selected && <CashDocumentDialog kind={dialog} register={selected} registers={registers} onClose={() => setDialog(null)} />}
    </div>
  );
}

function RegisterReport({ register }: { register: CashRegister }) {
  const [from, setFrom] = useState(() => `${localToday().slice(0, 8)}01`);
  const [to, setTo] = useState(localToday);
  const report = useApiQuery<CashReport>(`/api/finance/cash/registers/${register.id}/report`, { from, to }).data;

  const row = (label: string, value: string, sign: "+" | "−" | "=", testId?: string) => (
    <div className="flex items-center justify-between py-0.5" data-testid={testId}>
      <span className="text-muted-foreground">{sign} {label}</span>
      <span className="tabular-nums">{money(value, register.currency)}</span>
    </div>
  );

  return (
    <div className="rounded-lg border p-3 text-sm" data-testid="register-report">
      <div className="mb-2 flex flex-wrap items-end gap-2">
        <FileBarChart className="mb-2 h-4 w-4 text-muted-foreground" />
        <div>
          <Label className="text-xs">Dan</Label>
          <Input type="date" className="h-8 w-40" value={from} onChange={(event) => setFrom(event.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Gacha</Label>
          <Input type="date" className="h-8 w-40" value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
      </div>
      {!report ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            {row("Boshlang'ich qoldiq", report.opening, "=", "report-opening")}
            {row("Kirim", report.totals.income, "+")}
            {row("Chiqim", report.totals.expense, "−")}
            {row("O'tkazma kirdi", report.totals.transferIn, "+")}
            {row("O'tkazma chiqdi", report.totals.transferOut, "−")}
            {row("Ayirboshlash kirdi", report.totals.exchangeIn, "+")}
            {row("Ayirboshlash chiqdi", report.totals.exchangeOut, "−")}
            {row("Tuzatish kirdi", report.totals.correctionIn, "+")}
            {row("Tuzatish chiqdi", report.totals.correctionOut, "−")}
            {(Number(report.totals.reversalIn) > 0 || Number(report.totals.reversalOut) > 0) && (
              <>
                {row("Bekor qilish (kirdi)", report.totals.reversalIn, "+")}
                {row("Bekor qilish (chiqdi)", report.totals.reversalOut, "−")}
              </>
            )}
            <div className="mt-1 flex items-center justify-between border-t pt-1 font-semibold" data-testid="report-closing">
              <span>= Yakuniy qoldiq</span>
              <span className="tabular-nums">{money(report.closing, register.currency)}</span>
            </div>
            {!report.consistent && (
              <p className="mt-1 text-xs text-destructive" data-testid="report-inconsistent">
                Diqqat: hisoblangan qoldiq ({money(report.closing)}) kassa qoldig'iga ({money(report.currentBalance)}) teng emas — moliya bo'limiga xabar bering.
              </p>
            )}
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Batafsil</p>
            {report.lines.length === 0 && <p className="text-xs text-muted-foreground">Bu davrda harakat yo'q</p>}
            {report.lines.map((line) => (
              <div key={`${line.group}-${line.label}`} className="flex items-center justify-between py-0.5 text-xs">
                <span>{line.direction === "in" ? "+" : "−"} {line.label} <span className="text-muted-foreground">({line.count})</span></span>
                <span className="tabular-nums">{money(line.amount, register.currency)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentsList({ register }: { register: CashRegister }) {
  const { can } = usePermissions();
  const documents = useApiQuery<{ documents: CashDocument[] }>("/api/finance/cash-documents", { cashAccountId: register.id, limit: 30 }).data?.documents;
  const [reversing, setReversing] = useState<CashDocument | null>(null);
  const approve = useApiMutation((id: string) => api.post(`/api/finance/cash-documents/${id}/approve`), {
    invalidate: ["/api/finance/cash-documents"],
  });

  return (
    <div className="overflow-x-auto rounded-lg border" data-testid="register-documents">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Hujjat</th>
            <th className="px-3 py-2 text-left">Tur</th>
            <th className="px-3 py-2 text-left">Qayerdan → qayerga</th>
            <th className="px-3 py-2 text-right">Summa</th>
            <th className="px-3 py-2 text-left">Sabab</th>
            <th className="px-3 py-2 text-left">Kiritdi / tasdiqladi</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {(documents ?? []).map((doc) => (
            <tr key={doc.id} className="border-t" data-testid={`cash-doc-row-${doc.number}`}>
              <td className="whitespace-nowrap px-3 py-2">
                <div className="font-medium">{doc.number}</div>
                <div className="text-xs text-muted-foreground">{doc.docDate}</div>
              </td>
              <td className="px-3 py-2">
                {KIND_LABELS[doc.kind]}
                {doc.categoryName && <div className="text-xs text-muted-foreground">{doc.categoryName}</div>}
                {doc.status === "reversed" && <Badge variant="outline" className="ml-1 text-[10px]">bekor</Badge>}
              </td>
              <td className="px-3 py-2 text-xs">{doc.fromCashAccountName ?? "—"} → {doc.toCashAccountName ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                {money(doc.amount, doc.currency)}
                {doc.toAmount && doc.toAmount !== doc.amount && <div className="text-xs text-muted-foreground">→ {money(doc.toAmount, doc.toCurrency ?? doc.currency)}</div>}
                {Number(doc.difference) !== 0 && <div className={cn("text-xs", Number(doc.difference) > 0 ? "text-emerald-600" : "text-destructive")}>farq {money(doc.difference)}</div>}
              </td>
              <td className="px-3 py-2 text-xs">{doc.reason}{doc.reversalReason && <div className="text-destructive">Bekor: {doc.reversalReason}</div>}</td>
              <td className="px-3 py-2 text-xs">
                {doc.createdByName ?? "—"}
                <div className="text-muted-foreground">{doc.approvedByName ? `✓ ${doc.approvedByName}` : "tasdiqlanmagan"}</div>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right">
                {doc.status === "posted" && !doc.approvedBy && can("finance.approve") && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" data-testid={`cash-doc-approve-${doc.number}`} onClick={() => approve.mutateAsync(doc.id).then(() => toast.success("Tasdiqlandi")).catch((error) => toast.error(errorMessage(error)))}>
                    <BadgeCheck className="mr-1 h-3 w-3" /> Tasdiqlash
                  </Button>
                )}
                {doc.status === "posted" && can("finance.approve") && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" data-testid={`cash-doc-reverse-${doc.number}`} onClick={() => setReversing(doc)}>
                    <Undo2 className="mr-1 h-3 w-3" /> Bekor qilish
                  </Button>
                )}
              </td>
            </tr>
          ))}
          {documents && documents.length === 0 && (
            <tr className="border-t"><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Kassa hujjatlari yo'q</td></tr>
          )}
        </tbody>
      </table>
      {reversing && <ReverseDialog document={reversing} onClose={() => setReversing(null)} />}
    </div>
  );
}

function ReverseDialog({ document, onClose }: { document: CashDocument; onClose: () => void }) {
  const preview = useApiQuery<{ blockers: string[] }>(`/api/finance/cash-documents/${document.id}/reversal`).data;
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reverse = useApiMutation(() => api.post(`/api/finance/cash-documents/${document.id}/reverse`, { reason }), {
    invalidate: ["/api/finance/cash", "/api/finance/cash-documents", "/api/finance/cash-accounts", "/api/finance/dashboard"],
  });
  const blocked = !preview || preview.blockers.length > 0;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="cash-doc-reverse-dialog">
        <DialogHeader>
          <DialogTitle>{document.number} — bekor qilish</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Hujjat o'chirilmaydi: pul qaytadi, teskari yozuvlar tarixda qoladi.</p>
        {preview?.blockers.map((blocker) => <p key={blocker} className="text-sm text-destructive">{blocker}</p>)}
        {!blocked && (
          <div>
            <Label htmlFor="cash-doc-reverse-reason">Sabab (majburiy)</Label>
            <Textarea id="cash-doc-reverse-reason" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Yopish</Button>
          <Button
            variant="destructive"
            disabled={blocked || reason.trim().length < 3 || reverse.isPending}
            onClick={() => reverse.mutateAsync().then(() => { toast.success("Bekor qilindi"); onClose(); }).catch((err) => setError(errorMessage(err)))}
          >
            Bekor qilish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
