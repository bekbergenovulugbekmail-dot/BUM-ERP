import { useState } from "react";
import { toast } from "sonner";
import { Plus, ArrowUpRight, ArrowDownLeft, Wallet, Building2, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { cn } from "@/lib/utils.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import { formatMoney, useCurrencies } from "@/hooks/use-currencies.ts";
import { BankCommissionHint } from "@/components/payments/bank-commission-hint.tsx";
import AccountCardPayments, { AccountCommissionSummary } from "./account-card-payments.tsx";
import PendingSettlements from "./pending-settlements.tsx";
import SetBalanceDialog from "@/components/balances/set-balance-dialog.tsx";
import {
  CASH_ACCOUNT_TYPE_LABELS,
  isPendingAccountType,
  localIsoDate,
  toNum,
  type Account,
  type CashAccount,
  type CashAccountType,
  type CashTransaction,
} from "../_lib/types.ts";

const DEFAULT_LEDGER = "default";
const NO_SETTLEMENT = "none";
/** Mas'ul xodim tanlanmagan (rahbar kassasi). */
const NO_EMPLOYEE = "none";
const PERCENT_RE = /^\d{1,3}(\.\d{1,2})?$/;

type AccountPatch = Partial<
  Pick<CashAccount, "ledgerAccountId" | "showInPos" | "outgoingCommissionPercent" | "settlesToCashAccountId" | "settlementCommissionPercent">
>;

/** Bank hisobi sozlamalari: kassada ko'rsatish (darhol saqlanadi) va pul chiqarish komissiyasi. */
function BankAccountSettings({ account, busy, onSave }: { account: CashAccount; busy: boolean; onSave: (patch: AccountPatch, message: string) => void }) {
  const [commission, setCommission] = useState(String(Number(account.outgoingCommissionPercent)));
  const text = commission.trim().replace(",", ".") || "0";
  const valid = PERCENT_RE.test(text) && Number(text) <= 100;
  const changed = valid && Number(text) !== Number(account.outgoingCommissionPercent);
  const example = valid ? Math.round(1_000_000 * Number(text)) / 100 : 0;
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3 text-sm">
      <label className="flex cursor-pointer items-center gap-2">
        <Switch
          checked={account.showInPos}
          disabled={busy}
          onCheckedChange={(showInPos) => onSave({ showInPos }, showInPos ? "Hisob kassada to'lov usuli sifatida ko'rinadi" : "Hisob kassada yashirildi")}
        />
        <span>Kassada «{account.name}» tugmasi (bank o'tkazmasi)</span>
      </label>
      <div className="space-y-1">
        <Label htmlFor="bank-outgoing-commission" className="text-xs text-muted-foreground">Pul chiqarish komissiyasi, %</Label>
        <div className="flex gap-2">
          <Input
            id="bank-outgoing-commission"
            inputMode="decimal"
            className={cn("h-8 w-24", !valid && "border-destructive")}
            value={commission}
            onChange={(e) => setCommission(e.target.value)}
          />
          <Button size="sm" variant="secondary" disabled={!changed || busy} onClick={() => onSave({ outgoingCommissionPercent: text }, "Komissiya saqlandi")}>
            Saqlash
          </Button>
        </div>
      </div>
      <p className="basis-full text-[11px] text-muted-foreground">
        {valid && example > 0
          ? `Masalan: ta'minotchiga ${formatMoney(1_000_000, account.currency)} — hisobdan ${formatMoney(1_000_000 + example, account.currency)} chiqadi, ${formatMoney(example, account.currency)} "Bank komissiyasi" xarajati`
          : "Komissiya 0 — pul chiqarishda qo'shimcha yechilmaydi"}
      </p>
    </div>
  );
}

/** Kutilayotgan hisob (karta/hamyon): qaysi bank hisobiga qirqiladi va qirqimda ushlanadigan komissiya. */
function SettlementSettings({
  account,
  bankAccounts,
  busy,
  onSave,
}: {
  account: CashAccount;
  bankAccounts: CashAccount[];
  busy: boolean;
  onSave: (patch: AccountPatch, message: string) => void;
}) {
  const [commission, setCommission] = useState(String(Number(account.settlementCommissionPercent)));
  const text = commission.trim().replace(",", ".") || "0";
  const valid = PERCENT_RE.test(text) && Number(text) <= 100;
  const changed = valid && Number(text) !== Number(account.settlementCommissionPercent);
  const example = valid ? Math.round(1_000_000 * Number(text)) / 100 : 0;
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3 text-sm">
      <div className="space-y-1">
        <Label htmlFor="settles-to" className="text-xs text-muted-foreground">Qaysi bank hisobiga qirqiladi</Label>
        <Select
          value={account.settlesToCashAccountId ?? NO_SETTLEMENT}
          onValueChange={(value) =>
            onSave({ settlesToCashAccountId: value === NO_SETTLEMENT ? null : value }, "Qirqim hisobi saqlandi")
          }
        >
          <SelectTrigger id="settles-to" className="h-8 w-64 max-w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_SETTLEMENT}>Tanlanmagan</SelectItem>
            {bankAccounts.map((bank) => <SelectItem key={bank.id} value={bank.id}>{bank.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="settlement-commission" className="text-xs text-muted-foreground">Qirqim komissiyasi, %</Label>
        <div className="flex gap-2">
          <Input
            id="settlement-commission"
            inputMode="decimal"
            className={cn("h-8 w-24", !valid && "border-destructive")}
            value={commission}
            onChange={(e) => setCommission(e.target.value)}
          />
          <Button size="sm" variant="secondary" disabled={!changed || busy} onClick={() => onSave({ settlementCommissionPercent: text }, "Komissiya saqlandi")}>
            Saqlash
          </Button>
        </div>
      </div>
      <p className="basis-full text-[11px] text-muted-foreground">
        {valid && example > 0
          ? `Masalan: ${formatMoney(1_000_000, account.currency)} qirqilsa — ${formatMoney(example, account.currency)} komissiya, bank hisobiga ${formatMoney(1_000_000 - example, account.currency)}`
          : "Komissiya 0 — qirqimda to'liq summa bank hisobiga tushadi"}
      </p>
    </div>
  );
}

const CATEGORIES = ["sotuv", "xarid", "ijara", "maosh", "kommunal", "transport", "boshqa"];

const CATEGORY_LABELS: Record<string, string> = {
  transfer: "o'tkazma",
  opening_balance: "boshlang'ich qoldiq",
  salary: "maosh",
  sales: "sotuv",
};

type CashTransactionBody = {
  cashAccountId: string;
  type: "in" | "out";
  amount: string;
  description: string;
  category: string;
  /** Maqsad — moliya moddasi (majburiy). */
  counterAccountId: string;
  txDate: string;
};

type CashAccountBody = {
  name: string;
  type: CashAccountType;
  bankName: string | null;
  accountNumber: string | null;
  openingBalance?: string;
  /** Standart — asosiy valyuta. */
  currency?: string;
  showInPos?: boolean;
  outgoingCommissionPercent?: string;
  /** Kutilayotgan hisob uchun: qirqim manzili va komissiyasi. */
  settlesToCashAccountId?: string | null;
  settlementCommissionPercent?: string;
  /** Kassaning mas'ul xodimi (rahbar kassasi mas'ulsiz bo'ladi). */
  employeeId?: string | null;
};

export default function CashAccountsSection() {
  const { can } = usePermissions();
  const canManage = can("finance.manage");
  const currencies = useCurrencies();
  const accounts = useApiQuery<{ cashAccounts: CashAccount[] }>("/api/finance/cash-accounts").data?.cashAccounts;
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [txDialog, setTxDialog] = useState<"in" | "out" | null>(null);
  const [createAccountOpen, setCreateAccountOpen] = useState(false);
  /** Qoldiqni to'g'rilash — moliyaviy tasdiq ruxsati bilan. */
  const canAdjustBalance = can("finance.approve");
  const [adjustOpen, setAdjustOpen] = useState(false);

  const selectedAccount = accounts?.find((a) => a.id === selectedAccountId) ?? accounts?.[0];
  /** Qirqim manzili bo'la oladigan hisoblar. */
  const bankAccounts = accounts?.filter((account) => account.type === "bank" && account.isActive) ?? [];

  const transactions = useApiQuery<{ transactions: CashTransaction[]; nextCursor: string | null }>(
    selectedAccount ? `/api/finance/cash-accounts/${selectedAccount.id}/transactions` : null,
    { limit: 50 },
  ).data?.transactions;

  const recordTx = useApiMutation((body: CashTransactionBody) => api.post("/api/finance/cash-transactions", body));
  const createAccount = useApiMutation((body: CashAccountBody) => api.post("/api/finance/cash-accounts", body));
  // Kassaga mas'ul qilib biriktiriladigan xodimlar (faol kartochkalar)
  const employees = useApiQuery<{ employees: { id: string; name: string; code: string; status: string }[] }>(
    canManage ? "/api/hr/employees" : null,
  ).data?.employees.filter((employee) => employee.status === "active");
  // Kassaga bog'lanadigan buxgalteriya hisoblari — faol aktivlar
  const ledgerOptions = useApiQuery<{ accounts: Account[] }>(canManage ? "/api/finance/accounts" : null, { type: "asset" })
    .data?.accounts.filter((account) => account.isActive);
  // Maqsad ro'yxati: kirim uchun daromad, chiqim uchun xarajat moddalari
  const purposeOptions = useApiQuery<{ accounts: Account[] }>(
    txDialog ? "/api/finance/accounts" : null,
    { type: txDialog === "in" ? "income" : "expense" },
  ).data?.accounts.filter((account) => account.isActive);

  const updateAccount = useApiMutation(
    ({ id, patch }: { id: string; patch: AccountPatch }) => api.patch(`/api/finance/cash-accounts/${id}`, patch),
    { invalidate: ["/api/finance/cash-accounts", "/api/finance/settlements"] },
  );
  const saveAccount = async (patch: AccountPatch, message: string) => {
    if (!selectedAccount) return;
    try {
      await updateAccount.mutateAsync({ id: selectedAccount.id, patch });
      toast.success(message);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const linkLedger = (ledgerAccountId: string | null) => saveAccount({ ledgerAccountId }, "Buxgalteriya hisobi bog'landi");

  const [txAmount, setTxAmount] = useState("");
  const [txDesc, setTxDesc] = useState("");
  const [txCategory, setTxCategory] = useState("boshqa");
  /** Maqsad (moliya moddasi) — MAJBURIY: kirimda daromad, chiqimda xarajat moddasi. */
  const [txPurpose, setTxPurpose] = useState("");

  const [acctName, setAcctName] = useState("");
  const [acctType, setAcctType] = useState<CashAccountType>("cash");
  const [acctSettlesTo, setAcctSettlesTo] = useState(NO_SETTLEMENT);
  const [acctSettlementCommission, setAcctSettlementCommission] = useState("");
  const [acctBank, setAcctBank] = useState("");
  const [acctNumber, setAcctNumber] = useState("");
  const [acctOpening, setAcctOpening] = useState("");
  const [acctCurrency, setAcctCurrency] = useState("");
  const [acctCommission, setAcctCommission] = useState("");
  const [acctShowInPos, setAcctShowInPos] = useState(false);
  const [acctEmployee, setAcctEmployee] = useState(NO_EMPLOYEE);

  const handleTx = async () => {
    if (!selectedAccount || !txDialog) return;
    if (!(toNum(txAmount) > 0)) { toast.error("Summa musbat bo'lishi kerak"); return; }
    if (!txPurpose) { toast.error("Maqsadni tanlang"); return; }
    try {
      await recordTx.mutateAsync({
        cashAccountId: selectedAccount.id,
        type: txDialog,
        amount: txAmount,
        description: txDesc.trim() || (txDialog === "in" ? "Kirim" : "Chiqim"),
        category: txCategory,
        counterAccountId: txPurpose,
        txDate: localIsoDate(),
      });
      toast.success(txDialog === "in" ? "Kirim qayd etildi" : "Chiqim qayd etildi");
      setTxDialog(null); setTxAmount(""); setTxDesc(""); setTxPurpose("");
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
        ...(acctCurrency && acctCurrency !== currencies.base ? { currency: acctCurrency } : {}),
        ...(acctType === "bank"
          ? { showInPos: acctShowInPos, ...(acctCommission.trim() ? { outgoingCommissionPercent: acctCommission.trim().replace(",", ".") } : {}) }
          : {}),
        ...(isPendingAccountType(acctType)
          ? {
              ...(acctSettlesTo !== NO_SETTLEMENT ? { settlesToCashAccountId: acctSettlesTo } : {}),
              ...(acctSettlementCommission.trim() ? { settlementCommissionPercent: acctSettlementCommission.trim().replace(",", ".") } : {}),
            }
          : {}),
        ...(acctEmployee !== NO_EMPLOYEE ? { employeeId: acctEmployee } : {}),
      });
      toast.success("Hisob qo'shildi");
      setCreateAccountOpen(false);
      setAcctName(""); setAcctBank(""); setAcctNumber(""); setAcctOpening(""); setAcctCurrency(""); setAcctCommission(""); setAcctShowInPos(false);
      setAcctSettlesTo(NO_SETTLEMENT); setAcctSettlementCommission(""); setAcctEmployee(NO_EMPLOYEE);
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
                  acct.type === "cash" ? "bg-emerald-500/10" : isPendingAccountType(acct.type) ? "bg-violet-500/10" : "bg-blue-500/10"
                )}>
                  {acct.type === "cash" ? (
                    <Wallet className="h-4 w-4 text-emerald-500" />
                  ) : isPendingAccountType(acct.type) ? (
                    <CreditCard className="h-4 w-4 text-violet-500" />
                  ) : (
                    <Building2 className="h-4 w-4 text-blue-500" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium">
                    {acct.name}
                    {acct.isDefault && <span className="ml-1.5 text-[10px] text-primary">asosiy</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {acct.type === "cash"
                      ? "Naqd"
                      : acct.type === "card"
                        ? "Karta — kutilayotgan"
                        : acct.type === "ewallet"
                          ? "Hamyon — kutilayotgan"
                          : acct.bankName ?? "Bank"}
                    {acct.employeeName ? ` · ${acct.employeeName}` : ""}
                    {acct.type === "bank" && acct.showInPos ? " · kassada" : ""}
                    {acct.type === "bank" && Number(acct.outgoingCommissionPercent) > 0 ? ` · chiqim ${Number(acct.outgoingCommissionPercent)}%` : ""}
                  </p>
                </div>
              </div>
              <p className="text-xl font-bold">{formatMoney(acct.balance, acct.currency)}</p>
            </button>
          ))}
        </div>
      )}

      {/* Kutilayotgan karta/hamyon puli va qirqim */}
      <PendingSettlements />

      {/* Buxgalteriya hisobi: bir nechta bank hisobi hisoblar rejasida alohida ko'rinsin (bo'lmasa 1010 / 1020) */}
      {selectedAccount && canManage && ledgerOptions && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Label htmlFor="cash-account-ledger" className="text-xs text-muted-foreground">Buxgalteriya hisobi</Label>
          <Select
            value={selectedAccount.ledgerAccountId ?? DEFAULT_LEDGER}
            onValueChange={(value) => void linkLedger(value === DEFAULT_LEDGER ? null : value)}
          >
            <SelectTrigger id="cash-account-ledger" className="h-8 w-72 max-w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_LEDGER}>
                {selectedAccount.type === "cash"
                  ? "Umumiy: 1010 Naqd kassa"
                  : isPendingAccountType(selectedAccount.type)
                    ? "Umumiy: 1030 Kutilayotgan to'lovlar"
                    : "Umumiy: 1020 Bank hisobi"}
              </SelectItem>
              {ledgerOptions.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.code} {account.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Bank hisobi: kassada to'lov usuli sifatida ko'rsatish va pul chiqarish komissiyasi */}
      {selectedAccount && canManage && selectedAccount.type === "bank" && (
        <BankAccountSettings
          key={selectedAccount.id}
          account={selectedAccount}
          busy={updateAccount.isPending}
          onSave={(patch, message) => void saveAccount(patch, message)}
        />
      )}

      {/* Kutilayotgan hisob: qirqim manzili va komissiyasi */}
      {selectedAccount && canManage && isPendingAccountType(selectedAccount.type) && (
        <SettlementSettings
          key={selectedAccount.id}
          account={selectedAccount}
          bankAccounts={bankAccounts}
          busy={updateAccount.isPending}
          onSave={(patch, message) => void saveAccount(patch, message)}
        />
      )}

      {/* Bank hisobi: bu oygi karta tushumi va komissiyalar, shu hisobga tushadigan karta turlari (UZCARD, HUMO) */}
      {selectedAccount && selectedAccount.type === "bank" && <AccountCommissionSummary key={`sum-${selectedAccount.id}`} account={selectedAccount} />}
      {selectedAccount && selectedAccount.type === "bank" && <AccountCardPayments key={`cards-${selectedAccount.id}`} account={selectedAccount} />}

      {/* Transaction actions */}
      {selectedAccount && canManage && (
        <div className="flex gap-2">
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setTxDialog("in")}>
            <ArrowUpRight className="h-4 w-4 mr-1" /> Kirim
          </Button>
          <Button size="sm" variant="secondary" className="text-rose-600 border-rose-200 dark:border-rose-800" onClick={() => setTxDialog("out")}>
            <ArrowDownLeft className="h-4 w-4 mr-1" /> Chiqim
          </Button>
          {canAdjustBalance && (
            <Button size="sm" variant="secondary" onClick={() => setAdjustOpen(true)}>
              Qoldiqni to'g'rilash
            </Button>
          )}
        </div>
      )}

      {selectedAccount && adjustOpen && (
        <SetBalanceDialog
          title={`${selectedAccount.name} — qoldiqni to'g'rilash`}
          description="Farq kirim yoki chiqim bo'lib hisob tarixida ko'rinadi; buxgalteriyada boshqa daromad yoki xarajat bilan yopiladi"
          fields={[{ key: "balance", label: `Qoldiq (${selectedAccount.currency})`, current: selectedAccount.balance }]}
          endpoint={`/api/finance/cash-accounts/${selectedAccount.id}/set-balance`}
          invalidate={["/api/finance/cash-accounts", "/api/finance/dashboard", "/api/finance/settlements"]}
          onClose={() => setAdjustOpen(false)}
        />
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
                      <p>
                        {tx.description}
                        {tx.category === "bank komissiyasi" && (
                          <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                            komissiya
                          </span>
                        )}
                      </p>
                      {tx.category && (
                        <p className="text-xs text-muted-foreground capitalize">{CATEGORY_LABELS[tx.category] ?? tx.category}</p>
                      )}
                    </td>
                    <td className={cn(
                      "px-4 py-2.5 text-right font-semibold",
                      tx.type === "in" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                    )}>
                      {tx.type === "in" ? "+" : "-"}{formatMoney(tx.amount, selectedAccount.currency)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">
                      {formatMoney(tx.balanceAfter, selectedAccount.currency)}
                    </td>
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
                <Label>Summa ({selectedAccount?.currency ?? currencies.base})</Label>
                <Input type="number" min="0" step="0.01" value={txAmount} onChange={(e) => setTxAmount(e.target.value)} placeholder="0" />
              </div>
              {txDialog === "out" && <BankCommissionHint account={selectedAccount} amount={txAmount} />}
              <div>
                <Label>Tavsif</Label>
                <Input value={txDesc} onChange={(e) => setTxDesc(e.target.value)} placeholder="Nima uchun?" />
              </div>
              <div>
                <Label htmlFor="cash-purpose">
                  Maqsad * — {txDialog === "in" ? "daromad moddasi" : "xarajat moddasi"}
                </Label>
                <Select value={txPurpose} onValueChange={setTxPurpose}>
                  <SelectTrigger id="cash-purpose" data-testid="cash-purpose">
                    <SelectValue placeholder="Tanlang" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {(purposeOptions ?? []).map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.code} — {account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Hisobotda pul nima uchun kirgani/chiqqani shu bo'yicha ko'rinadi.
                </p>
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
              <Button data-testid="cash-tx-save" onClick={handleTx} disabled={recordTx.isPending || !txPurpose}>
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
                <Select value={acctType} onValueChange={(v) => setAcctType(v as CashAccountType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(CASH_ACCOUNT_TYPE_LABELS) as CashAccountType[]).map((type) => (
                      <SelectItem key={type} value={type}>{CASH_ACCOUNT_TYPE_LABELS[type]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isPendingAccountType(acctType) && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Terminal puli bank o'tkazguncha shu hisobda turadi — qirqishda komissiya ushlanadi
                  </p>
                )}
              </div>
              {/* Mas'ul xodim: rahbar kassasi mas'ulsiz, qolgan kassalar xodimga biriktiriladi */}
              <div>
                <Label>Mas'ul xodim</Label>
                <Select value={acctEmployee} onValueChange={setAcctEmployee}>
                  <SelectTrigger><SelectValue placeholder="Rahbar kassasi (mas'ulsiz)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_EMPLOYEE}>Rahbar kassasi (mas'ulsiz)</SelectItem>
                    {(employees ?? []).map((employee) => (
                      <SelectItem key={employee.id} value={employee.id}>
                        {employee.name} · {employee.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">Kassa pulini kim yuritishi — hisobotlarda shu xodim ko'rinadi.</p>
              </div>
              {currencies.codes.length > 1 && (
                <div>
                  <Label>Valyuta</Label>
                  <Select value={acctCurrency || currencies.base} onValueChange={setAcctCurrency}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {currencies.codes.map((code) => <SelectItem key={code} value={code}>{code}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
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
                  <div>
                    <Label>Pul chiqarish komissiyasi, %</Label>
                    <Input inputMode="decimal" value={acctCommission} onChange={(e) => setAcctCommission(e.target.value)} placeholder="1" />
                    <p className="mt-1 text-[11px] text-muted-foreground">Ta'minotchi, xarajat, maosh va o'tkazmada avtomatik yechiladi</p>
                  </div>
                  <label className="flex cursor-pointer items-center justify-between rounded-xl border border-border px-3 py-2 text-sm">
                    <span>Kassada bank o'tkazmasi tugmasi</span>
                    <Switch checked={acctShowInPos} onCheckedChange={setAcctShowInPos} />
                  </label>
                </>
              )}
              {isPendingAccountType(acctType) && (
                <>
                  <div>
                    <Label>Qaysi bank hisobiga qirqiladi</Label>
                    <Select value={acctSettlesTo} onValueChange={setAcctSettlesTo}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_SETTLEMENT}>Keyinroq tanlanadi</SelectItem>
                        {bankAccounts.map((bank) => <SelectItem key={bank.id} value={bank.id}>{bank.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Qirqim komissiyasi, %</Label>
                    <Input
                      inputMode="decimal"
                      value={acctSettlementCommission}
                      onChange={(e) => setAcctSettlementCommission(e.target.value)}
                      placeholder="0.25"
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">Qirqishda ushlanadi — bank hisobiga qolgani tushadi</p>
                  </div>
                </>
              )}
              <div>
                <Label>Boshlang'ich qoldiq ({acctCurrency || currencies.base})</Label>
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
