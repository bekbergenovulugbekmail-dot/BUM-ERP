/**
 * Ta'minotchi bilan hisob-kitob akti (`GET /api/purchase/suppliers/:id/statement`, AUD-020). Ma'lumot serverdan tayyor
 * keladi (jurnal kontragent subhisobidan): boshlang'ich qoldiq, operatsiyalar (qabul, to'lov, qaytarish, bekor qilish),
 * yakuniy qoldiq va kesh = jurnal solishtiruvi. Bu yerda hech narsa qayta hisoblanmaydi. Excel — shu ma'lumotdan.
 */
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, FileSpreadsheet } from "lucide-react";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { downloadBlob } from "@/components/csv/xlsx.ts";
import { useActiveCompany } from "@/hooks/use-company.ts";
import { errorMessage } from "@/lib/api.ts";
import { useApiQuery } from "@/lib/query.ts";

type Line = { date: string; entryNumber: string | null; label: string; document: string | null; description: string | null; increase: string; decrease: string; balance: string };
type Statement = {
  supplier: { id: string; name: string; code: string | null };
  from: string;
  to: string;
  opening: string;
  lines: Line[];
  totals: { increase: string; decrease: string };
  closing: string;
  reconciliation: { ledgerDebt: string; cachedDebt: string; difference: string; ok: boolean };
};

const money = (value: string | number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Number(value));
const localToday = () => new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);

async function statementXlsx(statement: Statement, companyName: string) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BUM ERP";
  const sheet = workbook.addWorksheet("Akt");
  sheet.addRow([`${companyName} — ta'minotchi bilan hisob-kitob akti`]).font = { bold: true, size: 13 };
  sheet.addRow([`Ta'minotchi: ${statement.supplier.name}${statement.supplier.code ? ` (${statement.supplier.code})` : ""}`]);
  sheet.addRow([`Davr: ${statement.from} — ${statement.to}`]);
  sheet.addRow([]);
  sheet.addRow(["Boshlang'ich qoldiq", "", "", "", "", Number(statement.opening)]).font = { bold: true };
  const header = sheet.addRow(["Sana", "Operatsiya", "Hujjat", "Qarz oshdi (+)", "Qarz kamaydi (−)", "Qoldiq", "Izoh"]);
  header.font = { bold: true };
  for (const line of statement.lines) {
    sheet.addRow([line.date, line.label, line.document ?? "", Number(line.increase) || null, Number(line.decrease) || null, Number(line.balance), line.description ?? ""]);
  }
  sheet.addRow(["Jami", "", "", Number(statement.totals.increase), Number(statement.totals.decrease), ""]).font = { bold: true };
  sheet.addRow(["Yakuniy qoldiq", "", "", "", "", Number(statement.closing)]).font = { bold: true };
  for (const column of [4, 5, 6]) sheet.getColumn(column).numFmt = "#,##0.00";
  sheet.columns.forEach((column, index) => { column.width = [12, 22, 16, 16, 16, 16, 40][index] ?? 14; });
  const buffer = await workbook.xlsx.writeBuffer();
  return { blob: new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename: `akt-${statement.supplier.name}-${statement.to}.xlsx` };
}

export default function SupplierStatementDialog({ supplierId, onClose }: { supplierId: string; onClose: () => void }) {
  const company = useActiveCompany().data?.company;
  const [range, setRange] = useState(() => ({ from: `${localToday().slice(0, 4)}-01-01`, to: localToday() }));
  const query = useApiQuery<Statement>(`/api/purchase/suppliers/${supplierId}/statement`, range);
  const statement = query.data;

  const handleExcel = async () => {
    if (!statement) return;
    try {
      const { blob, filename } = await statementXlsx(statement, company?.name ?? "BUM ERP");
      downloadBlob(blob, filename);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Hisob-kitob akti{statement ? ` — ${statement.supplier.name}` : ""}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="supplier-act-from">Dan</Label>
            <Input id="supplier-act-from" type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="supplier-act-to">Gacha</Label>
            <Input id="supplier-act-to" type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
          </div>
          <Button variant="secondary" onClick={() => void handleExcel()} disabled={!statement}>
            <FileSpreadsheet className="mr-1 h-4 w-4" /> Excel
          </Button>
          {statement && (
            statement.reconciliation.ok ? (
              <Badge variant="secondary" data-testid="supplier-act-reconciled">Kesh = jurnal</Badge>
            ) : (
              <Badge className="bg-rose-600" data-testid="supplier-act-mismatch">
                <AlertTriangle className="mr-1 h-3 w-3" /> Kesh ≠ jurnal: {money(statement.reconciliation.difference)}
              </Badge>
            )
          )}
        </div>
        {query.error && <p className="text-sm text-destructive">{errorMessage(query.error)}</p>}
        {!statement && !query.error && <Skeleton className="h-48" />}
        {statement && (
          <div className="-mx-1 max-h-[55vh] overflow-auto" data-testid="supplier-act">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="text-xs text-muted-foreground">
                  <th className="px-2 py-1.5 text-left font-medium">Sana</th>
                  <th className="px-2 py-1.5 text-left font-medium">Operatsiya</th>
                  <th className="px-2 py-1.5 text-left font-medium">Hujjat</th>
                  <th className="px-2 py-1.5 text-right font-medium">Qarz oshdi</th>
                  <th className="px-2 py-1.5 text-right font-medium">Qarz kamaydi</th>
                  <th className="px-2 py-1.5 text-right font-medium">Qoldiq</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border/60 font-medium">
                  <td className="px-2 py-1.5" colSpan={5}>Boshlang'ich qoldiq ({statement.from})</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(statement.opening)}</td>
                </tr>
                {statement.lines.map((line, index) => (
                  <tr key={`${line.entryNumber ?? index}-${index}`} className="border-t border-border/60">
                    <td className="px-2 py-1.5 whitespace-nowrap">{line.date}</td>
                    <td className="px-2 py-1.5">{line.label}</td>
                    <td className="px-2 py-1.5 font-mono text-xs">{line.document ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{Number(line.increase) ? money(line.increase) : ""}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{Number(line.decrease) ? money(line.decrease) : ""}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{money(line.balance)}</td>
                  </tr>
                ))}
                <tr className="border-t border-border font-semibold">
                  <td className="px-2 py-1.5" colSpan={3}>Jami / yakuniy qoldiq ({statement.to})</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(statement.totals.increase)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(statement.totals.decrease)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums" data-testid="supplier-act-closing">{money(statement.closing)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
