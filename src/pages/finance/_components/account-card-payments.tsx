/**
 * Bank hisobi ichida: shu hisobga tushadigan karta to'lovlari (UZCARD, HUMO, VISA ...) — `/api/finance/terminals`.
 * Har karta turi kassada alohida to'lov tugmasi; to'lov shu bank hisobiga tushadi va komissiya (%) har to'lovda avtomatik
 * ushlanadi ("Bank komissiyasi" xarajati). Bank ekvayring API ulanmagan — kassir terminal chekiga qarab summani kiritadi.
 * Karta turi o'chirilmaydi, faolsizlantiriladi (eski to'lovlar bog'lanishi saqlanadi).
 */
import { useState } from "react";
import { toast } from "sonner";
import { CreditCard, Pencil, Plus } from "lucide-react";
import { TERMINAL_NETWORKS, TERMINAL_NETWORK_LABELS, type TerminalNetwork } from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { usePermissions } from "@/hooks/use-company.ts";
import { formatMoney, useCurrencies } from "@/hooks/use-currencies.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import { localIsoDate, type BankCommissionReport, type CashAccount, type PaymentTerminal } from "../_lib/types.ts";

type CardTypeBody = {
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
const cents = (value: string) => Math.round(Number(value) * 100);

/** Tanlangan bank hisobi — joriy oy: kartadan tushum, ushlangan karta komissiyasi, sof tushum va pul chiqarish komissiyasi. */
export function AccountCommissionSummary({ account }: { account: CashAccount }) {
  const today = localIsoDate();
  const report = useApiQuery<BankCommissionReport>("/api/finance/reports/bank-commissions", {
    dateFrom: `${today.slice(0, 8)}01`,
    dateTo: today,
    cashAccountId: account.id,
  }).data;
  if (!report) return null;
  const { totals } = report;
  const items = [
    { label: "Kartadan tushum (bu oy)", value: formatMoney(totals.cardTurnover, account.currency), tone: "" },
    { label: "Karta komissiyasi", value: formatMoney(totals.acquiring, account.currency), tone: "text-rose-600 dark:text-rose-400" },
    { label: "Hisobga sof tushdi", value: formatMoney((cents(totals.cardTurnover) - cents(totals.acquiring)) / 100, account.currency), tone: "text-emerald-600 dark:text-emerald-400" },
    { label: "Pul chiqarish komissiyasi", value: formatMoney(totals.outgoing, account.currency), tone: "text-rose-600 dark:text-rose-400" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Bank komissiyasi — bu oy">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-border bg-card px-3 py-2">
          <p className="text-[11px] text-muted-foreground">{item.label}</p>
          <p className={cn("text-sm font-bold tabular-nums", item.tone)}>{item.value}</p>
        </div>
      ))}
    </div>
  );
}

export default function AccountCardPayments({ account }: { account: CashAccount }) {
  const { can } = usePermissions();
  const canManage = can("finance.manage");
  const currencies = useCurrencies();
  const all = useApiQuery<{ terminals: PaymentTerminal[] }>("/api/finance/terminals", { includeInactive: true }).data?.terminals;
  const cardTypes = all?.filter((terminal) => terminal.cashAccountId === account.id);
  const branches = useApiQuery<{ branches: { id: string; name: string }[] }>(canManage ? "/api/company/branches" : null).data?.branches ?? [];
  const [editing, setEditing] = useState<PaymentTerminal | "new" | null>(null);
  const baseCurrency = account.currency === currencies.base;

  const save = useApiMutation(
    ({ id, body }: { id: string | null; body: Partial<CardTypeBody> }) =>
      id ? api.patch(`/api/finance/terminals/${id}`, body) : api.post("/api/finance/terminals", body),
    { invalidate: ["/api/finance/terminals"] },
  );

  const toggleActive = async (cardType: PaymentTerminal) => {
    try {
      await save.mutateAsync({ id: cardType.id, body: { isActive: !cardType.isActive } });
      toast.success(cardType.isActive ? "Karta turi o'chirildi" : "Karta turi yoqildi");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-semibold">
            <CreditCard className="h-4 w-4" /> Karta to'lovlari shu hisobga
          </p>
          <p className="text-xs text-muted-foreground">UZCARD, HUMO ... — kassada alohida tugma; bank komissiyasi har to'lovda avtomatik ushlanadi</p>
        </div>
        {canManage && baseCurrency && (
          <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Karta turi qo'shish
          </Button>
        )}
      </div>

      {!baseCurrency ? (
        <p className="text-xs text-muted-foreground">Karta to'lovi faqat asosiy valyutadagi ({currencies.base}) bank hisobiga tushadi</p>
      ) : !cardTypes ? (
        <p className="text-xs text-muted-foreground">Yuklanmoqda...</p>
      ) : cardTypes.length === 0 ? (
        <p className="text-xs text-muted-foreground">Karta turi qo'shilmagan — kassadagi umumiy «Karta» to'lovi asosiy bank hisobiga komissiyasiz yoziladi</p>
      ) : (
        <ul className="divide-y divide-border">
          {cardTypes.map((cardType) => (
            <li key={cardType.id} className={cn("flex flex-wrap items-center gap-2 py-2", !cardType.isActive && "opacity-60")}>
              <span className="rounded-md bg-blue-500/10 px-2 py-0.5 text-[11px] font-bold tracking-wide text-blue-700 dark:text-blue-300">
                {TERMINAL_NETWORK_LABELS[cardType.network]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{cardType.name}</p>
                <p className="text-xs text-muted-foreground">
                  {[
                    Number(cardType.commissionPercent) > 0 ? `komissiya ${Number(cardType.commissionPercent)}%` : "komissiyasiz",
                    cardType.showInPos ? "kassada" : "kassada yashirin",
                    cardType.isActive ? null : "o'chirilgan",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {canManage && (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" aria-label={`${cardType.name} — tahrirlash`} onClick={() => setEditing(cardType)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => void toggleActive(cardType)}>
                    {cardType.isActive ? "O'chirish" : "Yoqish"}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <CardTypeDialog
          cardType={editing === "new" ? null : editing}
          account={account}
          branches={branches}
          busy={save.isPending}
          onClose={() => setEditing(null)}
          onSubmit={async (body) => {
            try {
              await save.mutateAsync({ id: editing === "new" ? null : editing.id, body });
              toast.success(editing === "new" ? "Karta turi qo'shildi" : "Karta turi saqlandi");
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

function CardTypeDialog({
  cardType,
  account,
  branches,
  busy,
  onClose,
  onSubmit,
}: {
  cardType: PaymentTerminal | null;
  account: CashAccount;
  branches: { id: string; name: string }[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: CardTypeBody) => Promise<void>;
}) {
  const [network, setNetwork] = useState<TerminalNetwork>(cardType?.network ?? "uzcard");
  const [name, setName] = useState(cardType?.name ?? "");
  const [provider, setProvider] = useState(cardType?.provider ?? account.bankName ?? "");
  const [branchId, setBranchId] = useState(cardType?.branchId ?? NO_BRANCH);
  const [identifier, setIdentifier] = useState(cardType?.terminalIdentifier ?? "");
  const [isActive, setIsActive] = useState(cardType?.isActive ?? true);
  const [commission, setCommission] = useState(cardType ? String(Number(cardType.commissionPercent)) : "0");
  const [showInPos, setShowInPos] = useState(cardType?.showInPos ?? true);
  const commissionText = commission.trim().replace(",", ".") || "0";
  const commissionValid = PERCENT_RE.test(commissionText) && Number(commissionText) <= 100;
  // Misol: 100 000 so'm to'lovda ushlanadigan komissiya
  const example = commissionValid ? Math.round(100_000 * Number(commissionText)) / 100 : 0;

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" /> {cardType ? "Karta turini tahrirlash" : "Karta turi qo'shish"}
          </DialogTitle>
          <DialogDescription>To'lov «{account.name}» hisobiga tushadi</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="card-network">To'lov tizimi</Label>
              <Select value={network} onValueChange={(value) => setNetwork(value as TerminalNetwork)}>
                <SelectTrigger id="card-network">
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
            <div className="space-y-1">
              <Label htmlFor="terminal-name">Kassadagi nomi</Label>
              <Input id="terminal-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder={TERMINAL_NETWORK_LABELS[network]} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="terminal-commission">Bank komissiyasi, %</Label>
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
                ? `${formatMoney(100_000, account.currency)} to'lovda ${formatMoney(example, account.currency)} komissiya ushlanadi — «${account.name}» hisobiga ${formatMoney(100_000 - example, account.currency)} tushadi, komissiya "Bank komissiyasi" xarajati bo'ladi`
                : "Komissiya yo'q bo'lsa 0 qoldiring"}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="terminal-provider">Bank</Label>
              <Input id="terminal-provider" value={provider} maxLength={100} onChange={(e) => setProvider(e.target.value)} placeholder="Kapitalbank" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="terminal-identifier">Terminal ID (ixtiyoriy)</Label>
              <Input id="terminal-identifier" value={identifier} maxLength={64} onChange={(e) => setIdentifier(e.target.value)} />
            </div>
          </div>
          {branches.length > 0 && (
            <div className="space-y-1">
              <Label htmlFor="card-branch">Filial</Label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger id="card-branch">
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
            disabled={!commissionValid || busy}
            onClick={() =>
              void onSubmit({
                name: name.trim() || TERMINAL_NETWORK_LABELS[network],
                network,
                provider: provider.trim() || null,
                cashAccountId: account.id,
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
