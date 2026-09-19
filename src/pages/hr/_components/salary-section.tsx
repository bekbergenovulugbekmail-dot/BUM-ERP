import { useState } from "react";
import { toast } from "sonner";
import { DollarSign, Play, CreditCard, FileDown, Undo2 } from "lucide-react";
import { FULL_ACCESS_ROLES } from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { generatePayslipPDF } from "@/lib/pdf/payslip-pdf.ts";
import { useActiveCompany, usePermissions } from "@/hooks/use-company.ts";
import { useCurrentUser } from "@/hooks/use-auth.ts";
import { BankCommissionHint } from "@/components/payments/bank-commission-hint.tsx";
import { fmt, localIsoDate, toNum, trimQty, type SalaryPayment, type SalarySummary } from "../_lib/types.ts";
import SalarySetupCard from "./salary-setup-card.tsx";

const STATUS_MAP = {
  draft: { label: "Qoralama", color: "bg-muted text-muted-foreground" },
  approved: { label: "Tasdiqlangan", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  paid: { label: "To'landi", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
};

type PaymentMethod = "cash" | "bank" | "card" | "transfer";
const METHOD_LABELS: Record<PaymentMethod, string> = { cash: "Naqd", bank: "Bank", card: "Karta", transfer: "O'tkazma" };
const AUTO_ACCOUNT = "auto";

type CashAccountOption = { id: string; name: string; type: "cash" | "bank"; balance: string; currency: string; outgoingCommissionPercent: string };
type SalaryPatch = { id: string; bonus: string; deductions: string; notes: string | null };
type PayBody = { id: string; method: PaymentMethod; cashAccountId: string | null; paidDate: string };

export default function SalarySection() {
  const thisMonth = localIsoDate().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [payDialog, setPayDialog] = useState<SalaryPayment | null>(null);
  const [editDialog, setEditDialog] = useState<string | null>(null);
  const [payDate, setPayDate] = useState(localIsoDate());
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [payAccount, setPayAccount] = useState(AUTO_ACCOUNT);
  const [editForm, setEditForm] = useState({ bonus: "0", deductions: "0", notes: "" });

  const currentUser = useCurrentUser();
  const { can } = usePermissions();
  const activeCompany = useActiveCompany().data;
  const company = activeCompany?.company;
  const canPrepare = can("hr.salary");
  const canApprove = can("hr.approve");
  // Tayyorlagan foydalanuvchi o'zi tasdiqlay olmaydi (kompaniya egasi va superadmindan tashqari) — server ham tekshiradi
  const isFullAccess = (FULL_ACCESS_ROLES as readonly string[]).includes(activeCompany?.membership.companyRole ?? "");

  const validMonth = /^\d{4}-\d{2}$/.test(month);
  const payments = useApiQuery<{ salaries: SalaryPayment[] }>(validMonth ? "/api/hr/salaries" : null, { month }).data?.salaries;
  const summary = useApiQuery<SalarySummary>(validMonth ? "/api/hr/salaries/summary" : null, { month }).data;
  // Kassa ro'yxati moliya ruxsatini talab qiladi — bo'lmasa to'lov usuli bo'yicha avtomatik tanlanadi
  const cashAccounts = useApiQuery<{ cashAccounts: CashAccountOption[] }>(
    payDialog ? "/api/finance/cash-accounts" : null,
  ).data?.cashAccounts;

  const generateSalary = useApiMutation((body: { month: string }) =>
    api.post<{ created: number; attendanceBased: boolean }>("/api/hr/salaries/generate", body),
  );
  const updatePayment = useApiMutation(({ id, ...body }: SalaryPatch) => api.patch(`/api/hr/salaries/${id}`, body));
  const approvePayment = useApiMutation((id: string) => api.post(`/api/hr/salaries/${id}/approve`));
  const revertPayment = useApiMutation((id: string) => api.post(`/api/hr/salaries/${id}/revert`));
  const markPaid = useApiMutation(({ id, ...body }: PayBody) => api.post(`/api/hr/salaries/${id}/pay`, body));

  const handleGenerate = async () => {
    if (!validMonth) { toast.error("Oyni tanlang"); return; }
    try {
      const { created, attendanceBased } = await generateSalary.mutateAsync({ month });
      if (created === 0) toast.info("Bu oy uchun maosh allaqachon yaratilgan");
      else toast.success(`${created} ta xodim uchun maosh hisoblandi${attendanceBased ? " (davomat bo'yicha)" : " (to'liq oy)"}`);
    } catch (e) { toast.error(errorMessage(e)); }
  };

  const handleEdit = async () => {
    if (!editDialog) return;
    try {
      await updatePayment.mutateAsync({
        id: editDialog,
        bonus: editForm.bonus || "0",
        deductions: editForm.deductions || "0",
        notes: editForm.notes.trim() || null,
      });
      toast.success("Maosh yangilandi");
      setEditDialog(null);
    } catch (e) { toast.error(errorMessage(e)); }
  };

  const handleAction = async (action: () => Promise<unknown>, message: string) => {
    try { await action(); toast.success(message); }
    catch (e) { toast.error(errorMessage(e)); }
  };

  const handlePrintPayslip = (p: SalaryPayment) => {
    generatePayslipPDF({
      company: {
        name: company?.name ?? "BUM ERP",
        legalName: company?.legalName ?? undefined,
        taxId: company?.taxId ?? undefined,
        address: company?.address ?? undefined,
        phone: company?.phone ?? undefined,
        email: company?.email ?? undefined,
      },
      employeeName: p.employeeName,
      employeeCode: p.employeeCode,
      department: p.departmentName ?? "—",
      position: p.positionName ?? "—",
      period: p.month,
      workingDays: toNum(p.workDays),
      presentDays: toNum(p.actualDays),
      absentDays: 0,
      lateDays: 0,
      halfDays: 0,
      baseSalary: toNum(p.baseSalary),
      overtimePay: toNum(p.overtimePay),
      bonuses: toNum(p.bonus),
      grossSalary: toNum(p.grossSalary),
      inpsTax: toNum(p.tax),
      otherDeductions: toNum(p.deductions),
      totalDeductions: toNum(p.tax) + toNum(p.deductions),
      netSalary: toNum(p.netSalary),
      currency: company?.currency,
      status: p.status,
      notes: p.notes ?? undefined,
    });
  };

  const openPay = (p: SalaryPayment) => {
    setPayDialog(p);
    setPayDate(localIsoDate());
    setPayMethod("cash");
    setPayAccount(AUTO_ACCOUNT);
  };

  // To'lov: kassa/bank chiqimi va jurnal yozuvi serverda bitta tranzaksiyada
  const handlePay = async () => {
    if (!payDialog) return;
    try {
      await markPaid.mutateAsync({
        id: payDialog.id,
        method: payMethod,
        cashAccountId: payAccount === AUTO_ACCOUNT ? null : payAccount,
        paidDate: payDate,
      });
      toast.success("Maosh to'landi");
      setPayDialog(null);
    } catch (e) { toast.error(errorMessage(e)); }
  };

  return (
    <div className="space-y-4">
      {/* Ish haqi turi, miqdori va qo'shimcha to'lovlar — maosh hisoblashdan oldin shu yerda sozlanadi */}
      <SalarySetupCard canManage={canPrepare} />

      {/* Header controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">Oy:</Label>
          <Input type="month" className="w-36 h-8 text-sm" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        {canPrepare && (
          <Button size="sm" onClick={handleGenerate} disabled={generateSalary.isPending} variant="secondary">
            <Play className="h-3.5 w-3.5 mr-1" /> {generateSalary.isPending ? "Hisoblanmoqda..." : "Maosh hisoblash"}
          </Button>
        )}
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
          {canPrepare && (
            <Button size="sm" className="mt-3" onClick={handleGenerate} disabled={generateSalary.isPending}>
              <Play className="h-4 w-4 mr-1" /> Maosh hisoblash
            </Button>
          )}
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
                const preparedByMe = p.createdBy !== null && p.createdBy === currentUser?.id;
                const mayApprove = canApprove && (!preparedByMe || isFullAccess);
                return (
                  <tr key={p.id} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-medium">{p.employeeName}</td>
                    <td className="px-4 py-2.5 text-muted-foreground text-xs">{p.positionName ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right text-muted-foreground">{trimQty(p.actualDays)}/{trimQty(p.workDays)}</td>
                    <td className="px-3 py-2.5 text-right text-emerald-600">{toNum(p.bonus) > 0 ? `+${fmt(p.bonus)}` : "—"}</td>
                    <td className="px-3 py-2.5 text-right text-rose-600">{fmt(p.tax)}</td>
                    <td className="px-3 py-2.5 text-right font-bold">{fmt(p.netSalary)} so'm</td>
                    <td className="px-3 py-2.5">
                      <span className={cn("text-xs px-2 py-0.5 rounded-full", st.color)}>{st.label}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-1 justify-end">
                        {p.status === "draft" && canPrepare && (
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs"
                            onClick={() => { setEditDialog(p.id); setEditForm({ bonus: trimQty(p.bonus), deductions: trimQty(p.deductions), notes: p.notes ?? "" }); }}>
                            Tahrirlash
                          </Button>
                        )}
                        {p.status === "draft" && mayApprove && (
                          <Button size="sm" className="h-6 px-2 text-xs bg-blue-600 hover:bg-blue-700"
                            disabled={approvePayment.isPending}
                            onClick={() => handleAction(() => approvePayment.mutateAsync(p.id), "Maosh tasdiqlandi")}>
                            Tasdiqlash
                          </Button>
                        )}
                        {p.status === "approved" && canApprove && (
                          <>
                            <Button size="sm" className="h-6 px-2 text-xs bg-emerald-600 hover:bg-emerald-700"
                              onClick={() => openPay(p)}>
                              <CreditCard className="h-3 w-3 mr-1" /> To'lash
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6" title="Qoralamaga qaytarish"
                              disabled={revertPayment.isPending}
                              onClick={() => handleAction(() => revertPayment.mutateAsync(p.id), "Qoralamaga qaytarildi")}>
                              <Undo2 className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                          </>
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
              <Button onClick={handleEdit} disabled={updatePayment.isPending}>Saqlash</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Pay dialog */}
      {payDialog && (
        <Dialog open onOpenChange={(o) => !o && setPayDialog(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Maoshni to'lash</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {payDialog.employeeName} · {payDialog.month} —{" "}
                <span className="font-semibold text-foreground">{fmt(payDialog.netSalary)} so'm</span>
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>To'lov usuli</Label>
                  <Select value={payMethod} onValueChange={(v) => setPayMethod(v as PaymentMethod)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => (
                        <SelectItem key={m} value={m}>{METHOD_LABELS[m]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>To'lov sanasi</Label>
                  <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
                </div>
              </div>
              {cashAccounts && cashAccounts.length > 0 && (
                <div>
                  <Label>Kassa / bank</Label>
                  <Select value={payAccount} onValueChange={setPayAccount}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={AUTO_ACCOUNT}>Avtomatik (naqd — asosiy kassa, boshqasi — bank)</SelectItem>
                      {cashAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name} ({fmt(a.balance)} so'm)</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {payAccount !== AUTO_ACCOUNT && (
                <BankCommissionHint account={cashAccounts?.find((a) => a.id === payAccount)} amount={payDialog.netSalary} />
              )}
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setPayDialog(null)}>Bekor</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handlePay} disabled={markPaid.isPending}>
                {markPaid.isPending ? "..." : "To'lash"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
