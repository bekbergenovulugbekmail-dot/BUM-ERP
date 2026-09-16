import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, CheckCircle, Receipt, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import { BankCommissionHint } from "@/components/payments/bank-commission-hint.tsx";
import CsvToolbar from "@/components/csv/csv-toolbar.tsx";
import {
  fmt, localIsoDate, toNum,
  type CashAccount, type Expense, type ExpenseStats, type ExpenseStatus,
} from "../_lib/types.ts";

const CATEGORIES = [
  "ijara", "maosh", "kommunal", "transport", "oziq-ovqat",
  "reklama", "ta'mirlash", "jihozlar", "soliq", "boshqa"
];

const STATUS_LABELS: Record<string, string> = {
  pending: "Kutilmoqda", approved: "Tasdiqlangan", paid: "To'langan",
};
const STATUS_COLORS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  approved: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
};

type ExpenseBody = {
  category: string;
  description: string;
  amount: string;
  expenseDate: string;
  paidBy: string | null;
  notes: string | null;
};

type StatusBody = { id: string; status: ExpenseStatus; cashAccountId?: string | null; paidDate?: string };

const DEFAULT_CASH = "default";

export default function ExpensesSection() {
  const { can } = usePermissions();
  const canManage = can("finance.manage");
  const canApprove = can("finance.approve");

  const [statusFilter, setStatusFilter] = useState<"all" | ExpenseStatus>("all");
  const [createOpen, setCreateOpen] = useState(false);

  const [category, setCategory] = useState("boshqa");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(localIsoDate());
  const [paidBy, setPaidBy] = useState("");
  const [notes, setNotes] = useState("");

  const [payExpense, setPayExpense] = useState<Expense | null>(null);
  const [payCashAccount, setPayCashAccount] = useState(DEFAULT_CASH);
  const [payDate, setPayDate] = useState(localIsoDate());

  const expenses = useApiQuery<{ expenses: Expense[]; nextCursor: string | null }>("/api/finance/expenses", {
    status: statusFilter !== "all" ? statusFilter : undefined,
    limit: 100,
  }).data?.expenses;
  const expStats = useApiQuery<ExpenseStats>("/api/finance/expenses/stats").data;
  const cashAccounts = useApiQuery<{ cashAccounts: CashAccount[] }>(
    payExpense ? "/api/finance/cash-accounts" : null,
  ).data?.cashAccounts;

  const createExpense = useApiMutation((body: ExpenseBody) => api.post("/api/finance/expenses", body));
  const updateStatus = useApiMutation(({ id, ...body }: StatusBody) => api.post(`/api/finance/expenses/${id}/status`, body));
  const removeExpense = useApiMutation((id: string) => api.delete(`/api/finance/expenses/${id}`));

  const handleCreate = async () => {
    if (!description.trim()) { toast.error("Tavsif kiritilishi shart"); return; }
    if (!(toNum(amount) > 0)) { toast.error("Summa musbat bo'lishi kerak"); return; }
    try {
      await createExpense.mutateAsync({
        category,
        description: description.trim(),
        amount,
        expenseDate: date,
        paidBy: paidBy.trim() || null,
        notes: notes.trim() || null,
      });
      toast.success("Xarajat qo'shildi");
      setCreateOpen(false);
      setDescription(""); setAmount(""); setNotes(""); setPaidBy("");
    } catch (err) { toast.error(errorMessage(err)); }
  };

  const handleStatus = async (id: string, status: ExpenseStatus, message: string) => {
    try { await updateStatus.mutateAsync({ id, status }); toast.success(message); }
    catch (err) { toast.error(errorMessage(err)); }
  };

  const openPay = (exp: Expense) => {
    setPayExpense(exp);
    setPayCashAccount(DEFAULT_CASH);
    setPayDate(localIsoDate());
  };

  // To'lov: kassa chiqimi + jurnal yozuvi serverda bitta tranzaksiyada
  const handlePay = async () => {
    if (!payExpense) return;
    try {
      await updateStatus.mutateAsync({
        id: payExpense.id,
        status: "paid",
        cashAccountId: payCashAccount === DEFAULT_CASH ? null : payCashAccount,
        paidDate: payDate,
      });
      toast.success("Xarajat to'landi");
      setPayExpense(null);
    } catch (err) { toast.error(errorMessage(err)); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Xarajatni o'chirishni tasdiqlaysizmi?")) return;
    try { await removeExpense.mutateAsync(id); toast.success("O'chirildi"); }
    catch (err) { toast.error(errorMessage(err)); }
  };

  return (
    <div className="space-y-4">
      {/* Stats row */}
      {expStats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Bu oy", value: fmt(expStats.totalThisMonth) + " so'm" },
            { label: "Xarajatlar soni", value: String(expStats.countThisMonth) + " ta" },
            { label: "Kutilayotgan", value: fmt(expStats.pendingAmount) + " so'm" },
            { label: "Kutilayotgan soni", value: String(expStats.pendingCount) + " ta" },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-3">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="font-bold mt-1">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {(["all", "pending", "approved", "paid"] as const).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer",
                statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
              )}>
              {s === "all" ? "Barchasi" : STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Eksport ekrandagi filtr bo'yicha; import xarajatni "kutilmoqda" holatida ochadi */}
          <CsvToolbar
            exportUrl="/api/finance/expenses/export"
            exportParams={statusFilter === "all" ? undefined : { status: statusFilter }}
            filename="xarajatlar"
            importUrl="/api/finance/expenses/import"
            invalidate={["/api/finance/expenses"]}
            canImport={canManage}
            columns={[
              { key: "category", aliases: ["Kategoriya", "category"] },
              { key: "description", aliases: ["Tavsif", "description"] },
              { key: "amount", aliases: ["Summa", "amount"] },
              { key: "expenseDate", aliases: ["Sana", "expenseDate"] },
              { key: "paidBy", aliases: ["To'lagan", "paidBy"] },
              { key: "notes", aliases: ["Izoh", "notes"] },
            ]}
          />
          {canManage && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Xarajat qo'shish
            </Button>
          )}
        </div>
      </div>

      {!expenses ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}</div>
      ) : expenses.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-center">
          <Receipt className="h-12 w-12 text-muted-foreground/20 mb-3" />
          <p className="text-muted-foreground">Xarajatlar yo'q</p>
          {canManage && (
            <Button className="mt-3" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Xarajat qo'shish
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Raqam</th>
                <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Tavsif</th>
                <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Kategoriya</th>
                <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Sana</th>
                <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">Summa</th>
                <th className="text-center px-4 py-3 text-xs text-muted-foreground font-medium">Holat</th>
                <th className="px-3 py-3 w-28"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {expenses.map((exp) => (
                <tr key={exp.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3 font-mono text-xs">{exp.number}</td>
                  <td className="px-4 py-3">
                    <p>{exp.description}</p>
                    {exp.paidBy && <p className="text-xs text-muted-foreground">{exp.paidBy}</p>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground capitalize">{exp.category}</td>
                  <td className="px-4 py-3 text-muted-foreground">{exp.expenseDate}</td>
                  <td className="px-4 py-3 text-right font-semibold text-rose-600 dark:text-rose-400">
                    {fmt(exp.amount)} so'm
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={cn("text-xs px-2 py-0.5 rounded-full", STATUS_COLORS[exp.status] ?? "")}>
                      {STATUS_LABELS[exp.status] ?? exp.status}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex gap-1 justify-end">
                      {exp.status === "pending" && canApprove && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs"
                          onClick={() => handleStatus(exp.id, "approved", "Tasdiqlandi")}>
                          <CheckCircle className="h-3 w-3 mr-0.5" /> Tasdiqlash
                        </Button>
                      )}
                      {exp.status === "approved" && canApprove && (
                        <>
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-emerald-600" onClick={() => openPay(exp)}>
                            To'landi
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Kutilayotganga qaytarish"
                            onClick={() => handleStatus(exp.id, "pending", "Kutilayotganga qaytarildi")}>
                            <Undo2 className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                        </>
                      )}
                      {exp.status !== "paid" && canManage && (
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleDelete(exp.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create dialog */}
      {createOpen && (
        <Dialog open onOpenChange={(o) => !o && setCreateOpen(false)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Yangi xarajat</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Tavsif *</Label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Xarajat tavsifi..." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Kategoriya</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Summa (so'm) *</Label>
                  <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Sana</Label>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div>
                  {/* Kassa to'lov paytida tanlanadi — bu yerda kim to'lagani */}
                  <Label>To'lovchi</Label>
                  <Input value={paidBy} onChange={(e) => setPaidBy(e.target.value)} placeholder="Ixtiyoriy..." />
                </div>
              </div>
              <div>
                <Label>Izoh</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ixtiyoriy..." />
              </div>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setCreateOpen(false)}>Bekor</Button>
              <Button onClick={handleCreate} disabled={createExpense.isPending}>{createExpense.isPending ? "..." : "Qo'shish"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Pay dialog */}
      {payExpense && (
        <Dialog open onOpenChange={(o) => !o && setPayExpense(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Xarajatni to'lash</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {payExpense.number} · {payExpense.description} —{" "}
                <span className="font-semibold text-foreground">{fmt(payExpense.amount)} so'm</span>
              </p>
              <div>
                <Label>Kassa / bank</Label>
                <Select value={payCashAccount} onValueChange={setPayCashAccount}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_CASH}>Asosiy kassa</SelectItem>
                    {cashAccounts?.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} ({fmt(a.balance)} so'm)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <BankCommissionHint account={cashAccounts?.find((a) => a.id === payCashAccount)} amount={payExpense.amount} />
              <div>
                <Label>To'lov sanasi</Label>
                <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setPayExpense(null)}>Bekor</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handlePay} disabled={updateStatus.isPending}>
                {updateStatus.isPending ? "..." : "To'lash"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
