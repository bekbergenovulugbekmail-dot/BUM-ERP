import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import { DollarSign, Play, CheckCircle, CreditCard, Plus, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { generatePayslipPDF } from "@/lib/pdf/payslip-pdf.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

const STATUS_MAP = {
  draft: { label: "Qoralama", color: "bg-muted text-muted-foreground" },
  approved: { label: "Tasdiqlangan", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  paid: { label: "To'landi", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
};

export default function SalarySection() {
  const thisMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [loading, setLoading] = useState(false);
  const [payDialog, setPayDialog] = useState<Id<"salaryPayments"> | null>(null);
  const [editDialog, setEditDialog] = useState<Id<"salaryPayments"> | null>(null);
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [editForm, setEditForm] = useState({ bonus: "0", deductions: "0", notes: "" });

  const payments = useQuery(api.hr.salary.listSalaryPayments, { month });
  const summary = useQuery(api.hr.salary.getMonthSummary, { month });
  const company = useQuery(api.admin.getCompany, {});

  const generateSalary = useMutation(api.hr.salary.generateMonthlySalary);
  const approvePayment = useMutation(api.hr.salary.approveSalaryPayment);
  const markPaid = useMutation(api.hr.salary.markSalaryPaid);
  const updatePayment = useMutation(api.hr.salary.updateSalaryPayment);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const count = await generateSalary({ month });
      if (count === 0) toast.info("Bu oy uchun maosh allaqachon yaratilgan");
      else toast.success(`${count} ta xodim uchun maosh hisoblandi`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Xatolik"); }
    finally { setLoading(false); }
  };

  const handleEdit = async () => {
    if (!editDialog) return;
    try {
      await updatePayment({
        id: editDialog,
        bonus: parseFloat(editForm.bonus) || 0,
        deductions: parseFloat(editForm.deductions) || 0,
        notes: editForm.notes || undefined,
      });
      toast.success("Maosh yangilandi");
      setEditDialog(null);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Xatolik"); }
  };

  const handlePrintPayslip = (p: typeof payments extends (infer T)[] | undefined ? T : never) => {
    if (!p) return;
    generatePayslipPDF({
      company: {
        name: company?.name ?? "BUM ERP",
        legalName: company?.legalName,
        taxId: company?.taxId,
        address: company?.address,
        phone: company?.phone,
        email: company?.email,
      },
      employeeName: p.employeeName ?? "—",
      employeeCode: String(p.employeeId).slice(-6),
      department: p.departmentName ?? "—",
      position: p.positionName ?? "—",
      period: month,
      workingDays: p.workDays,
      presentDays: p.actualDays,
      absentDays: 0,
      lateDays: 0,
      halfDays: 0,
      baseSalary: p.baseSalary,
      overtimePay: p.overtimePay ?? 0,
      bonuses: p.bonus,
      grossSalary: p.baseSalary + (p.overtimePay ?? 0) + p.bonus,
      inpsTax: p.tax,
      otherDeductions: p.deductions,
      totalDeductions: p.tax + p.deductions,
      netSalary: p.netSalary,
      status: p.status,
      notes: p.notes,
    });
  };

  const handlePay = async () => {
    if (!payDialog) return;
    try {
      await markPaid({ id: payDialog, paidDate: payDate });
      toast.success("Maosh to'landi deb belgilandi");
      setPayDialog(null);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Xatolik"); }
  };

  return (
    <div className="space-y-4">
      {/* Header controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">Oy:</Label>
          <Input type="month" className="w-36 h-8 text-sm" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <Button size="sm" onClick={handleGenerate} disabled={loading} variant="secondary">
          <Play className="h-3.5 w-3.5 mr-1" /> {loading ? "Hisoblanmoqda..." : "Maosh hisoblash"}
        </Button>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Jami xodimlar", value: summary.total },
            { label: "To'landi", value: summary.paid },
            { label: "Jami gross", value: `${fmt(summary.totalGross)} so'm` },
            { label: "Jami sof maosh", value: `${fmt(summary.totalNet)} so'm` },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-3">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-lg font-bold mt-0.5">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Payments table */}
      {!payments ? (
        <div className="space-y-1">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
      ) : payments.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <DollarSign className="h-12 w-12 mx-auto mb-3 opacity-20" />
          <p>Bu oy uchun maosh hisoblari yo'q</p>
          <Button size="sm" className="mt-3" onClick={handleGenerate} disabled={loading}>
            <Play className="h-4 w-4 mr-1" /> Maosh hisoblash
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Xodim</th>
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Lavozim</th>
                <th className="text-right px-3 py-2.5 text-xs text-muted-foreground font-medium">Ish kuni</th>
                <th className="text-right px-3 py-2.5 text-xs text-muted-foreground font-medium">Bonus</th>
                <th className="text-right px-3 py-2.5 text-xs text-muted-foreground font-medium">Soliq</th>
                <th className="text-right px-3 py-2.5 text-xs text-muted-foreground font-medium">Sof maosh</th>
                <th className="text-left px-3 py-2.5 text-xs text-muted-foreground font-medium">Holat</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {payments.map((p) => {
                const st = STATUS_MAP[p.status];
                return (
                  <tr key={p._id} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-medium">{p.employeeName ?? "—"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground text-xs">{p.positionName ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right text-muted-foreground">{p.actualDays}/{p.workDays}</td>
                    <td className="px-3 py-2.5 text-right text-emerald-600">{p.bonus > 0 ? `+${fmt(p.bonus)}` : "—"}</td>
                    <td className="px-3 py-2.5 text-right text-rose-600">{fmt(p.tax)}</td>
                    <td className="px-3 py-2.5 text-right font-bold">{fmt(p.netSalary)} so'm</td>
                    <td className="px-3 py-2.5">
                      <span className={cn("text-xs px-2 py-0.5 rounded-full", st.color)}>{st.label}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-1 justify-end">
                        {p.status === "draft" && (
                          <>
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs"
                              onClick={() => { setEditDialog(p._id); setEditForm({ bonus: String(p.bonus), deductions: String(p.deductions), notes: p.notes ?? "" }); }}>
                              Tahrirlash
                            </Button>
                            <Button size="sm" className="h-6 px-2 text-xs bg-blue-600 hover:bg-blue-700"
                              onClick={() => approvePayment({ id: p._id })}>
                              Tasdiqlash
                            </Button>
                          </>
                        )}
                        {p.status === "approved" && (
                          <Button size="sm" className="h-6 px-2 text-xs bg-emerald-600 hover:bg-emerald-700"
                            onClick={() => { setPayDialog(p._id); setPayDate(new Date().toISOString().slice(0, 10)); }}>
                            <CreditCard className="h-3 w-3 mr-1" /> To'lash
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" className="h-6 w-6"
                          title="PDF yuklash"
                          onClick={() => handlePrintPayslip(p)}>
                          <FileDown className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit dialog */}
      {editDialog && (
        <Dialog open onOpenChange={(o) => !o && setEditDialog(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Maoshni tahrirlash</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Bonus (so'm)</Label><Input type="number" min="0" value={editForm.bonus} onChange={(e) => setEditForm({ ...editForm, bonus: e.target.value })} /></div>
              <div><Label>Ushlanmalar (so'm)</Label><Input type="number" min="0" value={editForm.deductions} onChange={(e) => setEditForm({ ...editForm, deductions: e.target.value })} /></div>
              <div><Label>Izoh</Label><Input value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} placeholder="Ixtiyoriy..." /></div>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setEditDialog(null)}>Bekor</Button>
              <Button onClick={handleEdit}>Saqlash</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Pay dialog */}
      {payDialog && (
        <Dialog open onOpenChange={(o) => !o && setPayDialog(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Maoshni to'lash</DialogTitle></DialogHeader>
            <div className="space-y-2">
              <Label>To'lov sanasi</Label>
              <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setPayDialog(null)}>Bekor</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handlePay}>To'landi deb belgilash</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
