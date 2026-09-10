import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import { Plus, ArrowUpRight, ArrowDownLeft, Wallet, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import type { Id } from "@/convex/_generated/dataModel.d.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

const CATEGORIES = ["sotuv", "xarid", "ijara", "maosh", "kommunal", "transport", "boshqa"];

export default function CashAccountsSection() {
  const accounts = useQuery(api.finance.cashAccounts.list, {});
  const [selectedAccountId, setSelectedAccountId] = useState<Id<"cashAccounts"> | null>(null);
  const [txDialog, setTxDialog] = useState<"in" | "out" | null>(null);
  const [createAccountOpen, setCreateAccountOpen] = useState(false);

  const selectedAccount = accounts?.find((a) => a._id === selectedAccountId) ?? accounts?.[0];

  const transactions = useQuery(
    api.finance.cashAccounts.getTransactions,
    selectedAccount ? { cashAccountId: selectedAccount._id, limit: 50 } : "skip"
  );

  const recordTx = useMutation(api.finance.cashAccounts.recordTransaction);
  const createAccount = useMutation(api.finance.cashAccounts.createAccount);

  const [txAmount, setTxAmount] = useState("");
  const [txDesc, setTxDesc] = useState("");
  const [txCategory, setTxCategory] = useState("boshqa");
  const [txLoading, setTxLoading] = useState(false);

  const [acctName, setAcctName] = useState("");
  const [acctType, setAcctType] = useState<"cash" | "bank">("cash");
  const [acctBank, setAcctBank] = useState("");
  const [acctNumber, setAcctNumber] = useState("");
  const [acctOpening, setAcctOpening] = useState("");
  const [acctLoading, setAcctLoading] = useState(false);

  const handleTx = async () => {
    if (!selectedAccount || !txAmount || !txDialog) return;
    setTxLoading(true);
    try {
      await recordTx({
        cashAccountId: selectedAccount._id,
        type: txDialog,
        amount: parseFloat(txAmount),
        description: txDesc || (txDialog === "in" ? "Kirim" : "Chiqim"),
        category: txCategory,
        date: new Date().toISOString().slice(0, 10),
      });
      toast.success(txDialog === "in" ? "Kirim qayd etildi" : "Chiqim qayd etildi");
      setTxDialog(null); setTxAmount(""); setTxDesc("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Xatolik");
    } finally { setTxLoading(false); }
  };

  const handleCreateAccount = async () => {
    if (!acctName) { toast.error("Nom kiritilishi shart"); return; }
    setAcctLoading(true);
    try {
      await createAccount({
        name: acctName, type: acctType,
        bankName: acctBank || undefined,
        accountNumber: acctNumber || undefined,
        openingBalance: parseFloat(acctOpening) || 0,
      });
      toast.success("Kassa/bank hisobi qo'shildi");
      setCreateAccountOpen(false);
      setAcctName(""); setAcctBank(""); setAcctNumber(""); setAcctOpening("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Xatolik");
    } finally { setAcctLoading(false); }
  };

  return (
    <div className="space-y-4">
      {/* Account cards */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Kassa & Bank hisoblar</h3>
        <Button size="sm" variant="secondary" onClick={() => setCreateAccountOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Hisob qo'shish
        </Button>
      </div>

      {!accounts ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {accounts.map((acct) => (
            <button
              key={acct._id}
              onClick={() => setSelectedAccountId(acct._id)}
              className={cn(
                "text-left p-4 rounded-2xl border transition-all cursor-pointer",
                selectedAccount?._id === acct._id
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card hover:border-primary/30"
              )}
            >
              <div className="flex items-center gap-2 mb-3">
                <div className={cn(
                  "h-8 w-8 rounded-lg flex items-center justify-center",
                  acct.type === "cash" ? "bg-emerald-500/10" : "bg-blue-500/10"
                )}>
                  {acct.type === "cash"
                    ? <Wallet className="h-4 w-4 text-emerald-500" />
                    : <Building2 className="h-4 w-4 text-blue-500" />}
                </div>
                <div>
                  <p className="text-sm font-medium">{acct.name}</p>
                  <p className="text-xs text-muted-foreground">{acct.type === "cash" ? "Naqd" : acct.bankName ?? "Bank"}</p>
                </div>
              </div>
              <p className="text-xl font-bold">{fmt(acct.balance)} so'm</p>
            </button>
          ))}
        </div>
      )}

      {/* Transaction actions */}
      {selectedAccount && (
        <div className="flex gap-2">
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setTxDialog("in")}>
            <ArrowUpRight className="h-4 w-4 mr-1" /> Kirim
          </Button>
          <Button size="sm" variant="secondary" className="text-rose-600 border-rose-200 dark:border-rose-800" onClick={() => setTxDialog("out")}>
            <ArrowDownLeft className="h-4 w-4 mr-1" /> Chiqim
          </Button>
        </div>
      )}

      {/* Transactions list */}
      {selectedAccount && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-sm font-semibold">{selectedAccount.name} — harakatlar tarixi</p>
          </div>
          {!transactions ? (
            <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : transactions.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Harakatlar yo'q</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-2.5 text-xs text-muted-foreground">Sana</th>
                  <th className="text-left px-4 py-2.5 text-xs text-muted-foreground">Tavsif</th>
                  <th className="text-right px-4 py-2.5 text-xs text-muted-foreground">Miqdor</th>
                  <th className="text-right px-4 py-2.5 text-xs text-muted-foreground">Balans</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {transactions.map((tx) => (
                  <tr key={tx._id} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 text-muted-foreground">{tx.date}</td>
                    <td className="px-4 py-2.5">
                      <p>{tx.description}</p>
                      {tx.category && <p className="text-xs text-muted-foreground capitalize">{tx.category}</p>}
                    </td>
                    <td className={cn(
                      "px-4 py-2.5 text-right font-semibold",
                      tx.type === "in" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                    )}>
                      {tx.type === "in" ? "+" : "-"}{fmt(tx.amount)} so'm
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">{fmt(tx.balanceAfter)} so'm</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Transaction dialog */}
      {txDialog && (
        <Dialog open onOpenChange={(o) => !o && setTxDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{txDialog === "in" ? "Kirim qayd etish" : "Chiqim qayd etish"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Summa (so'm)</Label>
                <Input type="number" min="0" value={txAmount} onChange={(e) => setTxAmount(e.target.value)} placeholder="0" />
              </div>
              <div>
                <Label>Tavsif</Label>
                <Input value={txDesc} onChange={(e) => setTxDesc(e.target.value)} placeholder="Nima uchun?" />
              </div>
              <div>
                <Label>Kategoriya</Label>
                <Select value={txCategory} onValueChange={setTxCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setTxDialog(null)}>Bekor</Button>
              <Button onClick={handleTx} disabled={txLoading}>
                {txLoading ? "..." : "Qayd etish"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Create account dialog */}
      {createAccountOpen && (
        <Dialog open onOpenChange={(o) => !o && setCreateAccountOpen(false)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Yangi kassa/bank hisobi</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Nomi *</Label>
                <Input value={acctName} onChange={(e) => setAcctName(e.target.value)} placeholder="Asosiy kassa" />
              </div>
              <div>
                <Label>Turi</Label>
                <Select value={acctType} onValueChange={(v) => setAcctType(v as "cash" | "bank")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Naqd kassa</SelectItem>
                    <SelectItem value="bank">Bank hisobi</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {acctType === "bank" && (
                <>
                  <div>
                    <Label>Bank nomi</Label>
                    <Input value={acctBank} onChange={(e) => setAcctBank(e.target.value)} placeholder="Xalq banki" />
                  </div>
                  <div>
                    <Label>Hisob raqami</Label>
                    <Input value={acctNumber} onChange={(e) => setAcctNumber(e.target.value)} placeholder="2020..." />
                  </div>
                </>
              )}
              <div>
                <Label>Boshlang'ich qoldiq (so'm)</Label>
                <Input type="number" min="0" value={acctOpening} onChange={(e) => setAcctOpening(e.target.value)} placeholder="0" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setCreateAccountOpen(false)}>Bekor</Button>
              <Button onClick={handleCreateAccount} disabled={acctLoading}>
                {acctLoading ? "..." : "Qo'shish"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
