import { useState } from "react";
import { toast } from "sonner";
import { Plus, ArrowUpRight, ArrowDownLeft, Wallet, Building2 } from "lucide-react";
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
import { fmt, localIsoDate, toNum, type CashAccount, type CashTransaction } from "../_lib/types.ts";

const CATEGORIES = ["sotuv", "xarid", "ijara", "maosh", "kommunal", "transport", "boshqa"];

const CATEGORY_LABELS: Record<string, string> = {
  transfer: "o'tkazma",
  opening_balance: "boshlang'ich qoldiq",
  salary: "maosh",
};

type CashTransactionBody = {
  cashAccountId: string;
  type: "in" | "out";
  amount: string;
  description: string;
  category: string;
  txDate: string;
};

type CashAccountBody = {
  name: string;
  type: "cash" | "bank";
  bankName: string | null;
  accountNumber: string | null;
  openingBalance?: string;
};

export default function CashAccountsSection() {
  const { can } = usePermissions();
  const canManage = can("finance.manage");
  const accounts = useApiQuery<{ cashAccounts: CashAccount[] }>("/api/finance/cash-accounts").data?.cashAccounts;
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [txDialog, setTxDialog] = useState<"in" | "out" | null>(null);
  const [createAccountOpen, setCreateAccountOpen] = useState(false);

  const selectedAccount = accounts?.find((a) => a.id === selectedAccountId) ?? accounts?.[0];

  const transactions = useApiQuery<{ transactions: CashTransaction[]; nextCursor: string | null }>(
    selectedAccount ? `/api/finance/cash-accounts/${selectedAccount.id}/transactions` : null,
    { limit: 50 },
  ).data?.transactions;

  const recordTx = useApiMutation((body: CashTransactionBody) => api.post("/api/finance/cash-transactions", body));
  const createAccount = useApiMutation((body: CashAccountBody) => api.post("/api/finance/cash-accounts", body));

  const [txAmount, setTxAmount] = useState("");
  const [txDesc, setTxDesc] = useState("");
  const [txCategory, setTxCategory] = useState("boshqa");

  const [acctName, setAcctName] = useState("");
  const [acctType, setAcctType] = useState<"cash" | "bank">("cash");
  const [acctBank, setAcctBank] = useState("");
  const [acctNumber, setAcctNumber] = useState("");
  const [acctOpening, setAcctOpening] = useState("");

  const handleTx = async () => {
    if (!selectedAccount || !txDialog) return;
    if (!(toNum(txAmount) > 0)) { toast.error("Summa musbat bo'lishi kerak"); return; }
    try {
      await recordTx.mutateAsync({
        cashAccountId: selectedAccount.id,
        type: txDialog,
        amount: txAmount,
        description: txDesc.trim() || (txDialog === "in" ? "Kirim" : "Chiqim"),
        category: txCategory,
        txDate: localIsoDate(),
      });
      toast.success(txDialog === "in" ? "Kirim qayd etildi" : "Chiqim qayd etildi");
      setTxDialog(null); setTxAmount(""); setTxDesc("");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const handleCreateAccount = async () => {
    if (!acctName.trim()) { toast.error("Nom kiritilishi shart"); return; }
    try {
      await createAccount.mutateAsync({
        name: acctName.trim(),
        type: acctType,
        bankName: acctType === "bank" ? acctBank.trim() || null : null,
        accountNumber: acctType === "bank" ? acctNumber.trim() || null : null,
        openingBalance: toNum(acctOpening) > 0 ? acctOpening : undefined,
      });
      toast.success("Kassa/bank hisobi qo'shildi");
      setCreateAccountOpen(false);
      setAcctName(""); setAcctBank(""); setAcctNumber(""); setAcctOpening("");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      {/* Account cards */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Kassa & Bank hisoblar</h3>
        {canManage && (
          <Button size="sm" variant="secondary" onClick={() => setCreateAccountOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Hisob qo'shish
          </Button>
        )}
      </div>

      {!accounts ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
      ) : accounts.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Kassa yoki bank hisobi yo'q</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {accounts.map((acct) => (
            <button
              key={acct.id}
              onClick={() => setSelectedAccountId(acct.id)}
              className={cn(
                "text-left p-4 rounded-2xl border transition-all cursor-pointer",
                selectedAccount?.id === acct.id
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
                  <p className="text-sm font-medium">
                    {acct.name}
                    {acct.isDefault && <span className="ml-1.5 text-[10px] text-primary">asosiy</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">{acct.type === "cash" ? "Naqd" : acct.bankName ?? "Bank"}</p>
                </div>
              </div>
              <p className="text-xl font-bold">{fmt(acct.balance)} so'm</p>
            </button>
          ))}
        </div>
      )}

      {/* Transaction actions */}
      {selectedAccount && canManage && (
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
                  <tr key={tx.id} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 text-muted-foreground">{tx.txDate}</td>
                    <td className="px-4 py-2.5">
                      <p>{tx.description}</p>
                      {tx.category && (
                        <p className="text-xs text-muted-foreground capitalize">{CATEGORY_LABELS[tx.category] ?? tx.category}</p>
                      )}
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
                <Input type="number" min="0" step="0.01" value={txAmount} onChange={(e) => setTxAmount(e.target.value)} placeholder="0" />
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
              <Button onClick={handleTx} disabled={recordTx.isPending}>
                {recordTx.isPending ? "..." : "Qayd etish"}
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
                <Input type="number" min="0" step="0.01" value={acctOpening} onChange={(e) => setAcctOpening(e.target.value)} placeholder="0" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setCreateAccountOpen(false)}>Bekor</Button>
              <Button onClick={handleCreateAccount} disabled={createAccount.isPending}>
                {createAccount.isPending ? "..." : "Qo'shish"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
