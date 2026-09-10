import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import { Plus, Trash2, CheckCircle, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";

import type { Id } from "@/convex/_generated/dataModel.d.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

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

export default function ExpensesSection() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const [category, setCategory] = useState("boshqa");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [paidBy, setPaidBy] = useState("cash");
  const [notes, setNotes] = useState("");

  const expenses = useQuery(api.finance.expenses.list, {
    status: statusFilter !== "all" ? statusFilter as "pending" | "approved" | "paid" : undefined,
    limit: 100,
  });
  const createExpense = useMutation(api.finance.expenses.create);
  const updateStatus = useMutation(api.finance.expenses.updateStatus);
  const removeExpense = useMutation(api.finance.expenses.remove);
  const expStats = useQuery(api.finance.expenses.getStats, {});

  const handleCreate = async () => {
    if (!description || !amount) { toast.error("Tavsif va summa kiritilishi shart"); return; }
    setLoading(true);
    try {
      await createExpense({ category, description, amount: parseFloat(amount), date, paidBy, notes: notes || undefined });
      toast.success("Xarajat qo'shildi");
      setCreateOpen(false);
      setDescription(""); setAmount(""); setNotes("");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Xatolik"); }
    finally { setLoading(false); }
  };

  const handleApprove = async (id: Id<"expenses">) => {
    try { await updateStatus({ id, status: "approved" }); toast.success("Tasdiqlandi"); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Xatolik"); }
  };

  const handlePay = async (id: Id<"expenses">) => {
    try { await updateStatus({ id, status: "paid" }); toast.success("To'langan deb belgilandi"); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Xatolik"); }
  };

  const handleDelete = async (id: Id<"expenses">) => {
    try { await removeExpense({ id }); toast.success("O'chirildi"); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Xatolik"); }
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
          {["all", "pending", "approved", "paid"].map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer",
                statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
              )}>
              {s === "all" ? "Barchasi" : STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Xarajat qo'shish
        </Button>
      </div>

      {!expenses ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}</div>
      ) : expenses.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-center">
          <Receipt className="h-12 w-12 text-muted-foreground/20 mb-3" />
          <p className="text-muted-foreground">Xarajatlar yo'q</p>
          <Button className="mt-3" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Xarajat qo'shish
          </Button>
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
                <tr key={exp._id} className="hover:bg-muted/20">
                  <td className="px-4 py-3 font-mono text-xs">{exp.number}</td>
                  <td className="px-4 py-3">{exp.description}</td>
                  <td className="px-4 py-3 text-muted-foreground capitalize">{exp.category}</td>
                  <td className="px-4 py-3 text-muted-foreground">{exp.date}</td>
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
                      {exp.status === "pending" && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleApprove(exp._id)}>
                          <CheckCircle className="h-3 w-3 mr-0.5" /> Tasdiqlash
                        </Button>
                      )}
                      {exp.status === "approved" && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-emerald-600" onClick={() => handlePay(exp._id)}>
                          To'lash
                        </Button>
                      )}
                      {exp.status !== "paid" && (
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleDelete(exp._id)}>
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
                  <Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Sana</Label>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div>
                  <Label>To'lov usuli</Label>
                  <Select value={paidBy} onValueChange={setPaidBy}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Naqd</SelectItem>
                      <SelectItem value="bank">Bank</SelectItem>
                      <SelectItem value="card">Karta</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Izoh</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ixtiyoriy..." />
              </div>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setCreateOpen(false)}>Bekor</Button>
              <Button onClick={handleCreate} disabled={loading}>{loading ? "..." : "Qo'shish"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
