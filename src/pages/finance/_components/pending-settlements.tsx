/**
 * Kutilayotgan to'lovlar va qirqim: UZCARD/HUMO terminali yoki elektron hamyon puli bank o'tkazguncha shu hisobda turadi
 * ("UZCARD'dan kutilayotgan"). Bank pulni o'tkazganda "Qirqish" — komissiya ushlanib, qolgani bog'langan bank hisobiga
 * tushadi va o'sha hisob tarixida ko'rinadi.
 */
import { useState } from "react";
import { toast } from "sonner";
import { CreditCard, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import { formatMoney } from "@/hooks/use-currencies.ts";
import { toNum, type PendingSettlement } from "../_lib/types.ts";

const INVALIDATE = ["/api/finance/settlements", "/api/finance/cash-accounts", "/api/finance/dashboard"];

/** Qirqim oynasi: summa, ushlanadigan komissiya va bankka tushadigan qoldiq. */
function SettleDialog({ account, onClose }: { account: PendingSettlement; onClose: () => void }) {
  const [amount, setAmount] = useState(String(Number(account.pending)));
  const settle = useApiMutation(
    (body: { amount: string }) => api.post(`/api/finance/cash-accounts/${account.id}/settle`, body),
    { invalidate: INVALIDATE },
  );

  const value = toNum(amount);
  const pending = toNum(account.pending);
  const percent = Number(account.commissionPercent) || 0;
  const valid = value > 0 && value <= pending;
  // Serverdagi hisob bilan bir xil: summa × foiz / 100, tiyinga yaxlitlanadi
  const commission = valid ? Math.round(value * percent) / 100 : 0;
  const net = valid ? value - commission : 0;

  const handleSettle = async () => {
    if (!valid) { toast.error(`Summa 0 dan katta va ${formatMoney(pending, account.currency)} dan oshmasligi kerak`); return; }
    if (!account.settlesTo) { toast.error("Avval qaysi bank hisobiga qirqilishini tanlang"); return; }
    try {
      await settle.mutateAsync({ amount: String(value) });
      toast.success(`Qirqim: ${formatMoney(net, account.currency)} — ${account.settlesTo.name}`);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{account.name} — qirqim</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="settle-amount">Summa ({account.currency})</Label>
            <Input
              id="settle-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Kutilmoqda: {formatMoney(account.pending, account.currency)}
            </p>
          </div>
          <dl className="space-y-1 rounded-xl border border-border bg-muted/30 p-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Komissiya ({percent}%)</dt>
              <dd className="font-semibold text-rose-600 dark:text-rose-400">-{formatMoney(commission, account.currency)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{account.settlesTo?.name ?? "Bank hisobi"} ga tushadi</dt>
              <dd className="font-semibold text-emerald-600 dark:text-emerald-400">{formatMoney(net, account.currency)}</dd>
            </div>
          </dl>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Bekor</Button>
          <Button onClick={handleSettle} disabled={!valid || settle.isPending}>
            {settle.isPending ? "..." : "Qirqish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PendingSettlements() {
  const { can } = usePermissions();
  const canManage = can("finance.manage");
  const query = useApiQuery<{ accounts: PendingSettlement[] }>("/api/finance/settlements");
  const accounts = query.data?.accounts;
  const [settling, setSettling] = useState<string | null>(null);

  if (!accounts) {
    return query.isLoading ? <Skeleton className="h-24 rounded-2xl" /> : null;
  }
  if (accounts.length === 0) return null;

  const target = accounts.find((account) => account.id === settling);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Kutilayotgan to'lovlar</h3>
        <p className="text-xs text-muted-foreground">
          Terminal va hamyon puli bank o'tkazguncha shu hisobda turadi — qirqishda komissiya ushlanib, qolgani bank hisobiga tushadi
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {accounts.map((account) => (
          <div key={account.id} className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10">
                {account.type === "card"
                  ? <CreditCard className="h-4 w-4 text-violet-500" />
                  : <Wallet className="h-4 w-4 text-violet-500" />}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{account.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {account.settlesTo ? `${account.settlesTo.name} ga qirqiladi` : "Bank hisobi tanlanmagan"}
                  {Number(account.commissionPercent) > 0 ? ` · komissiya ${Number(account.commissionPercent)}%` : ""}
                </p>
              </div>
            </div>
            {account.terminals.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1">
                {account.terminals.map((terminal) => (
                  <span key={terminal.id} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    {terminal.name}
                  </span>
                ))}
              </div>
            )}
            <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Kutilmoqda</dt>
                <dd className="text-xl font-bold">{formatMoney(account.pending, account.currency)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Bugun tushdi</dt>
                <dd className="text-xl font-semibold text-muted-foreground">{formatMoney(account.today, account.currency)}</dd>
              </div>
            </dl>
            {canManage && (
              <Button
                size="sm"
                className="mt-3"
                disabled={!(toNum(account.pending) > 0) || !account.settlesTo}
                onClick={() => setSettling(account.id)}
              >
                Qirqish
              </Button>
            )}
          </div>
        ))}
      </div>
      {target && <SettleDialog key={target.id} account={target} onClose={() => setSettling(null)} />}
    </div>
  );
}
