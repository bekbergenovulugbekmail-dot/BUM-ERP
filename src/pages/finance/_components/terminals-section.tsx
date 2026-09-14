/**
 * Karta terminallari (UZCARD, HUMO, VISA ...) — `/api/finance/terminals`. Har terminal bank hisobiga bog'lanadi: kassada
 * yoki dostavkada shu terminal tanlansa, karta tushumi o'sha hisobga va uning buxgalteriya hisobiga yoziladi.
 * Ekvayring API ulanmagan — to'lov avtomatik tasdiqlanmaydi, kassir terminal chekiga qarab kiritadi.
 * Terminal o'chirilmaydi, faolsizlantiriladi (eski to'lovlar bog'lanishi saqlanadi).
 */
import { useState } from "react";
import { toast } from "sonner";
import { CreditCard, Info, Pencil, Plus } from "lucide-react";
import { TERMINAL_NETWORKS, TERMINAL_NETWORK_LABELS, type TerminalNetwork } from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { usePermissions } from "@/hooks/use-company.ts";
import { formatMoney, useCurrencies } from "@/hooks/use-currencies.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import type { CashAccount, PaymentTerminal } from "../_lib/types.ts";

type TerminalBody = {
  name: string;
  network: TerminalNetwork;
  provider: string | null;
  cashAccountId: string;
  branchId: string | null;
  terminalIdentifier: string | null;
  commissionPercent: string;
  showInPos: boolean;
  isActive: boolean;
};

const NO_BRANCH = "none";
const PERCENT_RE = /^\d{1,3}(\.\d{1,2})?$/;

export default function TerminalsSection() {
  const { can } = usePermissions();
  const canManage = can("finance.manage");
  const currencies = useCurrencies();
  const terminals = useApiQuery<{ terminals: PaymentTerminal[] }>("/api/finance/terminals", { includeInactive: true }).data?.terminals;
  const bankAccounts = (useApiQuery<{ cashAccounts: CashAccount[] }>("/api/finance/cash-accounts").data?.cashAccounts ?? []).filter(
    (account) => account.type === "bank" && account.currency === currencies.base,
  );
  const branches = useApiQuery<{ branches: { id: string; name: string }[] }>("/api/company/branches").data?.branches ?? [];
  const [editing, setEditing] = useState<PaymentTerminal | "new" | null>(null);

  const save = useApiMutation(
    ({ id, body }: { id: string | null; body: Partial<TerminalBody> }) =>
      id ? api.patch(`/api/finance/terminals/${id}`, body) : api.post("/api/finance/terminals", body),
    { invalidate: ["/api/finance/terminals"] },
  );

  const toggleActive = async (terminal: PaymentTerminal) => {
    try {
      await save.mutateAsync({ id: terminal.id, body: { isActive: !terminal.isActive } });
      toast.success(terminal.isActive ? "Terminal faolsizlantirildi" : "Terminal faollashtirildi");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Karta terminallari</h3>
          <p className="text-xs text-muted-foreground">Karta tushumi qaysi bank hisobiga tushishini belgilaydi</p>
        </div>
        {canManage && (
          <Button size="sm" variant="secondary" disabled={bankAccounts.length === 0} onClick={() => setEditing("new")}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Terminal qo'shish
          </Button>
        )}
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Bank ekvayring API'si ulanmagan: terminal to'lovi avtomatik tasdiqlanmaydi. Kassir terminal chekiga qarab summani kiritadi, pul
          terminal bog'langan bank hisobiga yoziladi.
        </span>
      </div>

      {canManage && bankAccounts.length === 0 && (
        <p className="text-sm text-amber-700 dark:text-amber-400">Avval "Kassa & Bank" bo'limida asosiy valyutadagi bank hisobini qo'shing.</p>
      )}

      {!terminals ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
        </div>
      ) : terminals.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          Terminal qo'shilmagan — kassada karta to'lovi asosiy bank hisobiga yoziladi
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
                <th className="px-4 py-2.5 text-left font-medium">Terminal</th>
                <th className="px-4 py-2.5 text-left font-medium">Bank hisobi</th>
                <th className="px-4 py-2.5 text-right font-medium">Komissiya</th>
                <th className="px-4 py-2.5 text-left font-medium">Filial</th>
                <th className="px-4 py-2.5 text-center font-medium">Holat</th>
                {canManage && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {terminals.map((terminal) => (
                <tr key={terminal.id} className={cn(!terminal.isActive && "opacity-60")}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-blue-500/10 px-2 py-0.5 text-[11px] font-bold tracking-wide text-blue-700 dark:text-blue-300">
                        {TERMINAL_NETWORK_LABELS[terminal.network]}
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium">{terminal.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {[terminal.provider, terminal.terminalIdentifier ? `TID ${terminal.terminalIdentifier}` : null].filter(Boolean).join(" · ") || "—"}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <p>{terminal.cashAccountName}</p>
                    <p className="text-xs text-muted-foreground">{[terminal.bankName, terminal.accountNumber].filter(Boolean).join(" · ") || "—"}</p>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{Number(terminal.commissionPercent) > 0 ? `${Number(terminal.commissionPercent)}%` : "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{terminal.branchName ?? "Hamma filial"}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs",
                        terminal.isActive
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {terminal.isActive ? "Faol" : "Faol emas"}
                    </span>
                    {terminal.isActive && !terminal.showInPos && <p className="mt-0.5 text-[11px] text-muted-foreground">kassada yashirin</p>}
                  </td>
                  {canManage && (
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" aria-label="Tahrirlash" onClick={() => setEditing(terminal)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => void toggleActive(terminal)}>
                          {terminal.isActive ? "O'chirish" : "Yoqish"}
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <TerminalDialog
          terminal={editing === "new" ? null : editing}
          bankAccounts={bankAccounts}
          branches={branches}
          busy={save.isPending}
          onClose={() => setEditing(null)}
          onSubmit={async (body) => {
            try {
              await save.mutateAsync({ id: editing === "new" ? null : editing.id, body });
              toast.success(editing === "new" ? "Terminal qo'shildi" : "Terminal saqlandi");
              setEditing(null);
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }}
        />
      )}
    </div>
  );
}

function TerminalDialog({
  terminal,
  bankAccounts,
  branches,
  busy,
  onClose,
  onSubmit,
}: {
  terminal: PaymentTerminal | null;
  bankAccounts: CashAccount[];
  branches: { id: string; name: string }[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: TerminalBody) => Promise<void>;
}) {
  const [name, setName] = useState(terminal?.name ?? "");
  const [network, setNetwork] = useState<TerminalNetwork>(terminal?.network ?? "uzcard");
  const [provider, setProvider] = useState(terminal?.provider ?? "");
  const [cashAccountId, setCashAccountId] = useState(terminal?.cashAccountId ?? bankAccounts[0]?.id ?? "");
  const [branchId, setBranchId] = useState(terminal?.branchId ?? NO_BRANCH);
  const [identifier, setIdentifier] = useState(terminal?.terminalIdentifier ?? "");
  const [isActive, setIsActive] = useState(terminal?.isActive ?? true);
  const [commission, setCommission] = useState(terminal ? String(Number(terminal.commissionPercent)) : "0");
  const [showInPos, setShowInPos] = useState(terminal?.showInPos ?? true);
  const commissionText = commission.trim().replace(",", ".") || "0";
  const commissionValid = PERCENT_RE.test(commissionText) && Number(commissionText) <= 100;
  const valid = name.trim().length > 0 && cashAccountId !== "" && commissionValid;
  // Misol: 100 000 so'm to'lovda ushlanadigan komissiya
  const example = commissionValid ? Math.round(100_000 * Number(commissionText)) / 100 : 0;
  // Tahrirda faolsizlantirilgan hisob ham ro'yxatda ko'rinsin
  const accountOptions = terminal && !bankAccounts.some((account) => account.id === terminal.cashAccountId)
    ? [...bankAccounts, { id: terminal.cashAccountId, name: terminal.cashAccountName } as CashAccount]
    : bankAccounts;
  const currency = accountOptions.find((account) => account.id === cashAccountId)?.currency ?? bankAccounts[0]?.currency ?? "UZS";

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" /> {terminal ? "Terminalni tahrirlash" : "Yangi terminal"}
          </DialogTitle>
          <DialogDescription>Karta tushumi tanlangan bank hisobiga yoziladi</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="terminal-name">Nomi *</Label>
              <Input id="terminal-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="UZCARD kassa 1" />
            </div>
            <div className="space-y-1">
              <Label>To'lov tizimi</Label>
              <Select value={network} onValueChange={(value) => setNetwork(value as TerminalNetwork)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TERMINAL_NETWORKS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {TERMINAL_NETWORK_LABELS[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Bank hisobi *</Label>
            <Select value={cashAccountId} onValueChange={setCashAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="Bank hisobini tanlang" />
              </SelectTrigger>
              <SelectContent>
                {accountOptions.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                    {account.bankName ? ` · ${account.bankName}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="terminal-provider">Ekvayer bank</Label>
              <Input id="terminal-provider" value={provider} maxLength={100} onChange={(e) => setProvider(e.target.value)} placeholder="Kapitalbank" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="terminal-identifier">Terminal ID (TID)</Label>
              <Input id="terminal-identifier" value={identifier} maxLength={64} onChange={(e) => setIdentifier(e.target.value)} />
            </div>
          </div>
          {branches.length > 0 && (
            <div className="space-y-1">
              <Label>Filial</Label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_BRANCH}>Hamma filial</SelectItem>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="terminal-commission">Bank komissiyasi (ekvayring), %</Label>
            <Input
              id="terminal-commission"
              inputMode="decimal"
              value={commission}
              onChange={(e) => setCommission(e.target.value)}
              placeholder="0.25"
              className={cn(!commissionValid && "border-destructive")}
            />
            <p className="text-[11px] text-muted-foreground">
              {commissionValid && example > 0
                ? `${formatMoney(100_000, currency)} to'lovda ${formatMoney(example, currency)} komissiya ushlanadi — bank hisobiga ${formatMoney(100_000 - example, currency)} tushadi, komissiya "Bank komissiyasi" xarajati bo'ladi`
                : "Komissiya yo'q bo'lsa 0 qoldiring"}
            </p>
          </div>
          <label className="flex cursor-pointer items-center justify-between rounded-xl border border-border px-3 py-2.5 text-sm">
            <span>Kassada ko'rsatish (to'lov tugmasi)</span>
            <Switch checked={showInPos} onCheckedChange={setShowInPos} />
          </label>
          <label className="flex cursor-pointer items-center justify-between rounded-xl border border-border px-3 py-2.5 text-sm">
            <span>Faol</span>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Bekor
          </Button>
          <Button
            disabled={!valid || busy}
            onClick={() =>
              void onSubmit({
                name: name.trim(),
                network,
                provider: provider.trim() || null,
                cashAccountId,
                branchId: branchId === NO_BRANCH ? null : branchId,
                terminalIdentifier: identifier.trim() || null,
                commissionPercent: commissionText,
                showInPos,
                isActive,
              })
            }
          >
            {busy ? "..." : "Saqlash"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
